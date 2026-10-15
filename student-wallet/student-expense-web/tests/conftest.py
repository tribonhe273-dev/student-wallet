import pytest

import app as app_module


@pytest.fixture()
def app(tmp_path, monkeypatch):
    db_path = tmp_path / "test-expenses.db"
    monkeypatch.setattr(app_module, "DATABASE", str(db_path))
    app_module.init_db()
    app_module.app.config.update(TESTING=True, SECRET_KEY="test-secret")
    yield app_module.app


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def auth_client(client, app):
    from werkzeug.security import generate_password_hash
    with app.app_context():
        db = app_module.get_db()
        db.execute("INSERT INTO users(username,password_hash) VALUES(?,?)", ("tester", generate_password_hash("secure-password-123")))
        db.commit()
        uid = db.execute("SELECT id FROM users WHERE username='tester'").fetchone()[0]
    with client.session_transaction() as sess:
        sess["user_id"] = uid
        sess["username"] = "tester"
        sess["csrf_token"] = "csrf-test-token"
    client.uid = uid
    return client
