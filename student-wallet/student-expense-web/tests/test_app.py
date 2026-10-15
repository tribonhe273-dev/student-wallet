import app as app_module


def tx_payload(amount="1500000", note="test", day="2026-10-10", category="Ăn uống"):
    return {"type": "expense", "amount": amount, "category": category, "note": note, "date": day}


def headers():
    return {"X-CSRF-Token": "csrf-test-token"}


def test_parse_transaction_accepts_arbitrary_positive_integer_amounts():
    # Amounts must not be forced into 1,000-VND increments by the UI.
    for amount in ("999001", "1000000", "1000001", "1234567", "1.000.001"):
        valid, error = app_module.parse_transaction(tx_payload(amount))
        expected = int(amount.replace(".", ""))
        assert error is None and valid["amount"] == expected


def test_parse_transaction_thousands_and_reject_decimal():
    valid, error = app_module.parse_transaction(tx_payload("1.500.000"))
    assert error is None and valid["amount"] == 1_500_000
    valid, error = app_module.parse_transaction(tx_payload("1,500,000"))
    assert error is None and valid["amount"] == 1_500_000
    for amount in ("1.5", "1,5", "1.500,000", "12.34", "abc", "0", "-5"):
        valid, error = app_module.parse_transaction(tx_payload(amount))
        assert valid is None and error


def test_auth_required_and_invalid_month(client):
    assert client.get("/api/dashboard").status_code == 401
    with client.session_transaction() as sess:
        sess["user_id"] = 999
        sess["csrf_token"] = "csrf-test-token"
    assert client.get("/api/dashboard?month=not-a-month").status_code == 400


def test_transaction_crud_budget_and_csv_formula_protection(auth_client):
    c = auth_client
    response = c.post("/api/transactions", json=tx_payload(note="=1+1"), headers=headers())
    assert response.status_code == 201
    tx_id = response.json["id"]
    listed_response = c.get("/api/transactions?month=2026-10")
    listed = listed_response.json
    assert listed_response.headers["X-Total-Count"] == "1" and listed[0]["id"] == tx_id
    updated = c.put(f"/api/transactions/{tx_id}", json=tx_payload("25000", "đã sửa"), headers=headers())
    assert updated.status_code == 200 and updated.json["amount"] == 25000
    budget = c.put("/api/budget", json={"month":"2026-10","amount":500000}, headers=headers())
    assert budget.status_code == 200
    csv_response = c.get("/api/export.csv?month=2026-10")
    assert csv_response.status_code == 200
    assert "'=1+1" not in csv_response.get_data(as_text=True)  # update replaced the formula note
    c.put(f"/api/transactions/{tx_id}", json=tx_payload("25000", "=1+1"), headers=headers())
    csv_text = c.get("/api/export.csv?month=2026-10").get_data(as_text=True)
    assert "'=1+1" in csv_text
    assert c.delete(f"/api/transactions/{tx_id}", headers=headers()).status_code == 200
    assert c.delete(f"/api/transactions/{tx_id}", headers=headers()).status_code == 404


def test_user_isolation_returns_404(auth_client, app):
    c = auth_client
    created = c.post("/api/transactions", json=tx_payload(), headers=headers()).json
    from werkzeug.security import generate_password_hash
    with app.app_context():
        db = app_module.get_db()
        db.execute("INSERT INTO users(username,password_hash) VALUES(?,?)", ("other", generate_password_hash("another-password-123")))
        other_id = db.execute("SELECT id FROM users WHERE username='other'").fetchone()[0]
        db.commit()
    with c.session_transaction() as sess:
        sess["user_id"] = other_id
    assert c.get("/api/transactions?month=2026-10").headers["X-Total-Count"] == "0"
    assert c.put(f"/api/transactions/{created['id']}", json=tx_payload(), headers=headers()).status_code == 404
    assert c.delete(f"/api/transactions/{created['id']}", headers=headers()).status_code == 404


def test_category_budget_recurring_idempotency_and_end_of_month(auth_client):
    c = auth_client
    assert c.put("/api/category-budgets", json={"month":"2026-10","category":"Ăn uống","amount":1000000}, headers=headers()).status_code == 200
    rule = c.post("/api/recurring", json={"type":"expense","amount":200000,"category":"Nhà ở","note":"Tiền trọ","day_of_month":31,"start_month":"2026-02"}, headers=headers())
    assert rule.status_code == 201
    c.get("/api/transactions?month=2026-02")
    c.get("/api/transactions?month=2026-02")
    items = c.get("/api/transactions?month=2026-02").json
    assert len(items) == 1 and items[0]["date"] == "2026-02-28"


def test_finance_context_month_with_transactions_empty_and_past(auth_client, app):
    c = auth_client
    c.post("/api/transactions", json=tx_payload("30000", day="2026-09-02"), headers=headers())
    with c.session_transaction() as sess:
        uid = sess["user_id"]
    with app.test_request_context("/"):
        from flask import session
        session["user_id"] = uid
        past = app_module.finance_context("2026-09")
        empty = app_module.finance_context("2026-08")
        current = app_module.finance_context("2026-10")
    assert past["expense"] == 30000 and not past["is_current_month"]
    assert empty["transaction_count"] == 0
    assert current["is_current_month"]
    answer = app_module.local_ai_answer("ngân sách", past | {"budget":100000,"budget_used_percent":30})
    assert "Còn 1 ngày" not in answer


def test_analytics_and_backup_json(auth_client):
    c = auth_client
    c.post("/api/transactions", json=tx_payload(), headers=headers())
    data = c.get("/api/analytics?month=2026-10").json
    assert len(data["months"]) == 12
    backup = c.get("/api/backup.json")
    assert backup.status_code == 200 and backup.json["version"] == 1
    preview = c.post("/api/backup/preview", json=backup.json, headers=headers())
    assert preview.status_code == 200 and preview.json["duplicates"] == 1


def test_pagination_sort_and_ai_payload_excludes_transaction_notes(auth_client, monkeypatch):
    c = auth_client
    for amount, day, note in ((5000, "2026-10-01", "PRIVATE_NOTE_1"), (15000, "2026-10-02", "PRIVATE_NOTE_2"), (10000, "2026-10-03", "PRIVATE_NOTE_3")):
        c.post("/api/transactions", json=tx_payload(amount, note, day), headers=headers())
    page_response = c.get("/api/transactions?month=2026-10&sort=amount&direction=desc&limit=2&offset=1")
    page = page_response.json
    assert page_response.headers["X-Total-Count"] == "3" and len(page) == 2
    assert page[0]["amount"] == 10000
    captured = {}
    monkeypatch.setattr(app_module, "OPENAI_API_KEY", "test-key")
    def fake_model(messages):
        captured["messages"] = messages
        return "Tóm tắt kiểm thử."
    monkeypatch.setattr(app_module, "call_chat_model", fake_model)
    response = c.post("/api/ai/chat", json={"month":"2026-10", "message":"Tóm tắt chi tiêu tháng này", "history":[]}, headers=headers())
    assert response.status_code == 200
    serialized = str(captured["messages"])
    assert "PRIVATE_NOTE_1" not in serialized and "PRIVATE_NOTE_2" not in serialized and "PRIVATE_NOTE_3" not in serialized
    assert response.json["based_on"]["expense"] == 30000


def test_csv_import_preview_blocks_partial_import(auth_client):
    c = auth_client
    csv_text = "\ufeffNgày,Loại,Danh mục,Số tiền (VND),Ghi chú\n2026-10-04,Chi tiêu,Ăn uống,25000,Ăn sáng\n2026-10-05,Chi tiêu,Sai danh mục,10000,Lỗi"
    preview = c.post("/api/import/csv-preview", json={"csv":csv_text}, headers=headers())
    assert preview.status_code == 200
    assert preview.json["to_add"] == 1 and preview.json["errors"]
    commit = c.post("/api/import/csv-commit", json={}, headers=headers())
    assert commit.status_code == 400
    assert c.get("/api/transactions?month=2026-10").headers["X-Total-Count"] == "0"


def test_local_ai_handles_general_student_questions_without_finance_dump():
    context = {
        "month": "2026-10", "income": 5000000, "expense": 1800000, "net": 3200000,
        "transaction_count": 4, "budget": 2500000, "budget_remaining": 700000,
        "budget_used_percent": 72, "savings_rate_percent": 64, "days_in_month": 31,
        "days_elapsed": 15, "is_current_month": True,
        "categories": [{"category": "Ăn uống", "amount": 900000, "count": 3}],
        "trend": []
    }

    study_answer = app_module.local_ai_answer("Giúp tôi lập kế hoạch ôn thi trong 7 ngày", context)
    assert "25 phút" in study_answer
    assert "Tổng quan tháng" not in study_answer

    coding_answer = app_module.local_ai_answer("Tôi cần giúp đỡ với Python", context)
    assert "lập trình" in coding_answer.lower()
    assert "Tổng quan tháng" not in coding_answer

    broad_answer = app_module.local_ai_answer("Bạn có thể giúp tôi chuyện khác không?", context)
    assert "OPENAI_API_KEY" in broad_answer
    assert "Tổng quan tháng" not in broad_answer


def test_online_ai_prompt_supports_open_questions_and_context_is_separate(auth_client, monkeypatch):
    captured = {}
    monkeypatch.setattr(app_module, "OPENAI_API_KEY", "test-key")

    def fake_model(messages):
        captured["messages"] = messages
        return "Mình có thể giúp bạn lên kế hoạch học tập."

    monkeypatch.setattr(app_module, "call_chat_model", fake_model)
    response = auth_client.post(
        "/api/ai/chat",
        json={"month": "2026-10", "message": "Giúp tôi lập kế hoạch học tiếng Anh", "history": []},
        headers=headers(),
    )

    assert response.status_code == 200
    messages = captured["messages"]
    assert "Không ép mọi câu hỏi trở về chủ đề tiền bạc" in messages[0]["content"]
    assert "Dữ liệu tài chính tổng hợp" not in messages[0]["content"]
    assert "không sử dụng hoặc nhắc lại số liệu tài chính cá nhân" in messages[0]["content"]
    assert messages[-1] == {"role": "user", "content": "Giúp tôi lập kế hoạch học tiếng Anh"}
    assert response.json["based_on"] is None

    finance_response = auth_client.post(
        "/api/ai/chat",
        json={"month": "2026-10", "message": "Tóm tắt chi tiêu tháng này", "history": []},
        headers=headers(),
    )
    assert finance_response.status_code == 200
    assert "Dữ liệu tài chính tổng hợp" in captured["messages"][0]["content"]
    assert finance_response.json["based_on"]["expense"] == 0
