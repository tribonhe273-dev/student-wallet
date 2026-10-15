(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const monthPicker = $('#monthPicker');
  const transactionModal = $('#transactionModal');
  const transactionForm = $('#transactionForm');
  const typeInput = $('#transactionType');
  const categorySelect = $('#transactionCategory');
  const dateInput = $('#transactionDate');
  const amountInput = $('#amountInput');
  const noteInput = $('#transactionNote');
  const modalError = $('#modalError');
  const toast = $('#toast');
  const EXPENSE_EMOJIS = {
    'Ăn uống': '🍜', 'Di chuyển': '🛵', 'Học tập': '📚', 'Nhà ở': '🏠',
    'Điện thoại & Internet': '📱', 'Giải trí': '🎧', 'Mua sắm': '🛍️',
    'Sức khỏe': '🩺', 'Phí dịch vụ': '🧾', 'Khác': '✦',
    'Lương làm thêm': '💼', 'Gia đình hỗ trợ': '💝', 'Học bổng': '🎓',
    'Bán hàng / freelance': '💻'
  };
  const COLORS = ['#8d7ce9', '#5bbfad', '#f0a0ac', '#edb962', '#8db6dc', '#b49be8'];
  let categories = { income: [], expense: [] };
  let editingId = null;
  let toastTimeout = null;
  let searchTimeout = null;
  let aiSending = false;
  let pendingJsonBackup = null;
  let sortState = { key: 'date', direction: 'desc' };
  let modalReturnFocus = null;
  const aiWelcomeMessage = 'Chào bạn! Mình là Ví AI. Bạn có thể hỏi về chi tiêu, học tập, công việc, công nghệ, viết nội dung và các câu hỏi đời sống thông thường. Nếu câu hỏi vượt ngoài khả năng hoặc phạm vi hỗ trợ, mình sẽ nói rõ thay vì đoán.';
  let chatHistory = [{ role: 'assistant', content: aiWelcomeMessage }];

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  function currentMonth() { return localDateString().slice(0, 7); }
  function formatMoney(value) {
    const num = Number(value || 0);
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(num))} ₫`;
  }
  function signedMoney(value, positivePlus = false) {
    const num = Number(value || 0);
    if (num < 0) return `−${formatMoney(num)}`;
    if (positivePlus && num > 0) return `+${formatMoney(num)}`;
    return formatMoney(num);
  }
  function monthLong(month) {
    const d = new Date(`${month}-01T00:00:00`);
    return new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(d);
  }
  function monthShort(month) {
    const d = new Date(`${month}-01T00:00:00`);
    return new Intl.DateTimeFormat('vi-VN', { month: 'short' }).format(d).replace('.', '');
  }
  function dateDisplay(dateStr) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function requestOptionsSafeHeaders(headers) { return headers || {}; }
  async function api(url, options = {}) {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const requestOptions = { ...options, headers: { 'Content-Type': 'application/json', ...(requestOptionsSafeHeaders(options.headers)), ...(options.method && options.method.toUpperCase() !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) } };
    const response = await fetch(url, requestOptions);
    let data;
    try { data = await response.json(); } catch (_error) { data = {}; }
    if (!response.ok) throw new Error(data.error || 'Có lỗi xảy ra. Vui lòng thử lại.');
    if (Array.isArray(data) && url.startsWith('/api/transactions')) data.total = Number(response.headers.get('X-Total-Count') || data.length);
    return data;
  }
  function showToast(message, error = false, actionLabel = '', actionCallback = null) {
    $('#toastMessage').textContent = message;
    $('.toast-icon').textContent = error ? '!' : '✓';
    $('.toast-icon').style.background = error ? '#f4a0aa' : '#42bea5';
    const action = $('#toastAction'); action.hidden = !actionLabel; action.textContent = actionLabel; action.onclick = actionCallback;
    toast.classList.add('show');
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove('show'), actionLabel ? 5000 : 2700);
  }
  function populateCategorySelect(type, selected = '') {
    const options = categories[type] || [];
    categorySelect.innerHTML = options.map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('');
    if (selected && options.includes(selected)) categorySelect.value = selected;
  }
  function populateCategoryFilter() {
    const select = $('#categoryFilter');
    const selected = select.value || 'all';
    const combined = [...new Set([...(categories.income || []), ...(categories.expense || [])])];
    select.innerHTML = '<option value="all">Mọi danh mục</option>' + combined.map((name) => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
    select.value = combined.includes(selected) ? selected : 'all';
  }
  function setTransactionType(type) {
    typeInput.value = type;
    $$('.type-option').forEach((button) => {
      const selected = button.dataset.type === type;
      button.classList.toggle('selected', selected);
      button.classList.toggle('income-option', selected && type === 'income');
      button.classList.toggle('expense-option', selected && type === 'expense');
    });
    populateCategorySelect(type);
  }
  function openModal(transaction = null, duplicate = false) {
    modalReturnFocus = document.activeElement;
    editingId = transaction && !duplicate ? transaction.id : null;
    transactionForm.reset();
    modalError.textContent = '';
    $('#modalTitle').textContent = transaction && !duplicate ? 'Chỉnh sửa giao dịch' : duplicate ? 'Nhân bản giao dịch' : 'Thêm giao dịch mới';
    $('#saveTransactionBtn').innerHTML = transaction && !duplicate ? 'Lưu thay đổi <span>↗</span>' : 'Lưu giao dịch <span>↗</span>';
    setTransactionType(transaction?.type || 'income');
    amountInput.value = transaction ? transaction.amount : '';
    noteInput.value = transaction?.note || '';
    dateInput.value = transaction?.date || (monthPicker.value === currentMonth() ? localDateString() : `${monthPicker.value}-01`);
    if (transaction) categorySelect.value = transaction.category;
    transactionModal.classList.add('open');
    transactionModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => amountInput.focus(), 60);
  }
  function closeModal() {
    transactionModal.classList.remove('open');
    transactionModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    editingId = null;
    if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') modalReturnFocus.focus();
  }

  function renderDashboard(data) {
    $('#incomeTotal').textContent = formatMoney(data.income);
    $('#expenseTotal').textContent = formatMoney(data.expense);
    $('#netTotal').textContent = signedMoney(data.net);
    $('#netTotal').style.color = data.net < 0 ? '#df7181' : '#27314b';
    $('#balanceTotal').textContent = signedMoney(data.lifetime_balance);
    $('#balanceTotal').style.color = data.lifetime_balance < 0 ? '#df7181' : '#27314b';
    $('#heroMonth').textContent = monthLong(data.month).toLocaleUpperCase('vi-VN');
    $('#periodLabel').textContent = monthLong(data.month);

    const budget = Number(data.budget || 0);
    const spent = Number(data.expense || 0);
    const remaining = budget - spent;
    const percent = budget > 0 ? (spent / budget) * 100 : 0;
    $('#budgetAmountDisplay').textContent = budget > 0 ? formatMoney(budget) : 'Chưa thiết lập';
    $('#budgetPercent').textContent = budget > 0 ? `${Math.round(percent)}%` : '—';
    $('#budgetPercent').classList.toggle('over', budget > 0 && percent > 100);
    $('#budgetProgress').style.width = `${Math.min(100, Math.max(0, percent))}%`;
    $('#budgetProgress').classList.toggle('over', budget > 0 && percent > 100);
    $('#budgetSpentLabel').textContent = `Đã chi: ${formatMoney(spent)}`;
    if (!budget) {
      $('#budgetRemainLabel').textContent = 'Chưa có ngân sách';
      $('#budgetRemainLabel').style.color = '#6c7890';
    } else if (remaining >= 0) {
      $('#budgetRemainLabel').textContent = `Còn: ${formatMoney(remaining)}`;
      $('#budgetRemainLabel').style.color = '#239b87';
    } else {
      $('#budgetRemainLabel').textContent = `Vượt: ${formatMoney(Math.abs(remaining))}`;
      $('#budgetRemainLabel').style.color = '#d85b6d';
    }
    $('#budgetInput').value = budget || '';
    renderTrend(data.trend || []);
    renderCategories(data.categories || []);
  }

  function renderTrend(items) {
    const chart = $('#trendChart');
    const max = Math.max(0, ...items.flatMap((item) => [Number(item.income || 0), Number(item.expense || 0)]));
    if (!items.length || max === 0) {
      chart.innerHTML = '<div class="chart-placeholder">Thêm giao dịch để xem biểu đồ dòng tiền</div>';
      return;
    }
    chart.innerHTML = items.map((item) => {
      const income = Number(item.income || 0);
      const expense = Number(item.expense || 0);
      const incomeHeight = income ? Math.max(3, income / max * 100) : 2;
      const expenseHeight = expense ? Math.max(3, expense / max * 100) : 2;
      return `<div class="trend-column"><div class="bar-area"><div class="trend-bar income" style="height:${incomeHeight}%" data-value="Thu: ${escapeHTML(formatMoney(income))}" title="Thu nhập: ${escapeHTML(formatMoney(income))}"></div><div class="trend-bar expense" style="height:${expenseHeight}%" data-value="Chi: ${escapeHTML(formatMoney(expense))}" title="Chi tiêu: ${escapeHTML(formatMoney(expense))}"></div></div><span class="trend-month">${escapeHTML(monthShort(item.month))}</span></div>`;
    }).join('');
  }

  function renderCategories(items) {
    const container = $('#categoryChart');
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    $('#categoryCount').textContent = `${items.length} danh mục`;
    if (!items.length || total <= 0) {
      container.innerHTML = '<div class="empty-mini"><span>◌</span><strong>Chưa có khoản chi nào</strong><small>Thêm chi tiêu để xem phân bổ theo danh mục.</small></div>';
      return;
    }
    container.innerHTML = items.map((item, index) => {
      const amount = Number(item.amount || 0);
      const percent = amount / total * 100;
      const emoji = EXPENSE_EMOJIS[item.category] || '✦';
      return `<div class="category-row"><div class="category-row-top"><span class="category-emoji">${emoji}</span><span class="category-name">${escapeHTML(item.category)}</span><strong class="category-amount">${escapeHTML(formatMoney(amount))}</strong></div><div class="category-row-bottom"><div class="category-progress"><span style="width:${percent}%;background:${COLORS[index % COLORS.length]}"></span></div><span class="category-percent">${Math.round(percent)}%</span></div></div>`;
    }).join('');
  }

  function renderTransactions(items) {
    const body = $('#transactionRows');
    $('#transactionCount').textContent = `${items.length} giao dịch`;
    $('#tableFooterLabel').textContent = `Giao dịch trong ${monthLong(monthPicker.value)}`;
    if (!items.length) {
      const hasFilter = $('#searchInput').value.trim() || $('#typeFilter').value !== 'all' || $('#categoryFilter').value !== 'all';
      body.innerHTML = `<tr><td colspan="5" class="empty-table"><strong>${hasFilter ? 'Không tìm thấy giao dịch phù hợp' : 'Chưa có giao dịch trong tháng này'}</strong><span>${hasFilter ? 'Thử xóa bớt bộ lọc để xem kết quả.' : 'Bắt đầu ghi lại khoản thu hoặc chi đầu tiên của bạn.'}</span>${hasFilter ? '' : '<br><button class="btn btn-primary empty-add" type="button">+ Thêm giao dịch</button>'}</td></tr>`;
      const add = body.querySelector('.empty-add');
      if (add) add.addEventListener('click', () => openModal());
      return;
    }
    body.innerHTML = items.map((item) => {
      const income = item.type === 'income';
      const emoji = EXPENSE_EMOJIS[item.category] || (income ? '↗' : '✦');
      const primaryText = item.note || item.category;
      const subtitle = item.note ? item.category : (income ? 'Khoản thu' : 'Khoản chi');
      return `<tr data-id="${item.id}"><td><div class="transaction-cell"><span class="transaction-symbol ${income ? 'income' : 'expense'}">${emoji}</span><div class="transaction-name"><strong title="${escapeHTML(primaryText)}">${escapeHTML(primaryText)}</strong><span>${escapeHTML(subtitle)}</span></div></div></td><td class="date-cell">${escapeHTML(dateDisplay(item.date))}</td><td><span class="category-tag">${escapeHTML(item.category)}</span></td><td class="amount-cell ${income ? 'income' : 'expense'}">${income ? '+' : '−'}${escapeHTML(formatMoney(item.amount))}</td><td class="actions-cell"><span class="row-actions"><button type="button" class="row-action edit" data-action="edit" data-id="${item.id}" aria-label="Sửa giao dịch" title="Sửa">✎</button><button type="button" class="row-action" data-action="duplicate" data-id="${item.id}" aria-label="Nhân bản giao dịch" title="Nhân bản">⧉</button><button type="button" class="row-action delete" data-action="delete" data-id="${item.id}" aria-label="Xóa giao dịch" title="Xóa">×</button></span></td></tr>`;
    }).join('');
  }

  async function refreshAll() {
    const month = monthPicker.value || currentMonth();
    try {
      const [dashboard, transactions] = await Promise.all([
        api(`/api/dashboard?month=${encodeURIComponent(month)}`),
        api(transactionQuery())
      ]);
      renderDashboard(dashboard);
      const transactionItems = Array.isArray(transactions) ? transactions : (transactions.items || []);
      renderTransactions(transactionItems);
      $('#transactionCount').textContent = `${transactions.total ?? transactionItems.length} giao dịch`;
      loadAIInsights();
      loadExtensions();
      loadAdvancedAnalytics();
    } catch (error) {
      showToast(error.message || 'Không thể tải dữ liệu.', true);
      $('#transactionRows').innerHTML = '<tr><td colspan="5" class="table-loading">Không thể tải dữ liệu. Hãy tải lại trang.</td></tr>';
    }
  }
  function transactionQuery() {
    const params = new URLSearchParams({ month: monthPicker.value || currentMonth(), type: $('#typeFilter').value, category: $('#categoryFilter').value, search: $('#searchInput').value.trim(), sort: sortState.key, direction: sortState.direction, limit: '200', offset: '0' });
    return `/api/transactions?${params.toString()}`;
  }

  async function submitTransaction(event) {
    event.preventDefault();
    modalError.textContent = '';
    const payload = {
      type: typeInput.value,
      amount: Number(amountInput.value),
      category: categorySelect.value,
      note: noteInput.value.trim(),
      date: dateInput.value
    };
    if (!Number.isSafeInteger(payload.amount) || payload.amount <= 0) {
      modalError.textContent = 'Nhập số tiền là số nguyên lớn hơn 0.';
      amountInput.focus();
      return;
    }
    if (!payload.date) {
      modalError.textContent = 'Vui lòng chọn ngày giao dịch.';
      dateInput.focus();
      return;
    }
    const wasEditing = editingId !== null;
    const url = wasEditing ? `/api/transactions/${editingId}` : '/api/transactions';
    const submitButton = $('#saveTransactionBtn');
    submitButton.disabled = true;
    submitButton.style.opacity = '.7';
    try {
      await api(url, { method: wasEditing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      const nextMonth = payload.date.slice(0, 7);
      if (monthPicker.value !== nextMonth) monthPicker.value = nextMonth;
      closeModal();
      await refreshAll();
      showToast(wasEditing ? 'Đã cập nhật giao dịch.' : 'Đã thêm giao dịch mới.');
    } catch (error) {
      modalError.textContent = error.message;
    } finally {
      submitButton.disabled = false;
      submitButton.style.opacity = '1';
    }
  }

  async function handleTableAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === 'edit' || button.dataset.action === 'duplicate') {
      try {
        const transactions = await api(`/api/transactions?month=${encodeURIComponent(monthPicker.value)}&type=all&category=all`);
        const target = (Array.isArray(transactions) ? transactions : (transactions.items || [])).find((item) => item.id === id);
        if (!target) throw new Error('Không tìm thấy giao dịch cần thao tác.');
        openModal(button.dataset.action === 'duplicate' ? { ...target, date: localDateString() } : target, button.dataset.action === 'duplicate');
      } catch (error) { showToast(error.message, true); }
      return;
    }
    const row = button.closest('tr');
    const name = row?.querySelector('.transaction-name strong')?.textContent || 'giao dịch này';
    if (!window.confirm(`Bạn có chắc muốn xóa “${name}”? Thao tác này không thể hoàn tác.`)) return;
    try {
      const deleted = await api(`/api/transactions/${id}`, { method: 'DELETE' });
      await refreshAll();
      showToast('Đã xóa giao dịch.', false, 'Hoàn tác', async () => { try { const restored = deleted.deleted; await api('/api/transactions', { method: 'POST', body: JSON.stringify({ type: restored.type, amount: restored.amount, category: restored.category, note: restored.note, date: restored.date }) }); await refreshAll(); showToast('Đã hoàn tác thao tác xóa.'); } catch (error) { showToast(error.message, true); } });
    } catch (error) { showToast(error.message, true); }
  }

  async function saveBudget(event) {
    event.preventDefault();
    const raw = $('#budgetInput').value.trim();
    const amount = raw === '' ? 0 : Number(raw);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      showToast('Ngân sách phải là số nguyên không âm.', true);
      return;
    }
    try {
      await api('/api/budget', { method: 'PUT', body: JSON.stringify({ month: monthPicker.value, amount }) });
      await refreshAll();
      showToast(amount ? 'Đã lưu ngân sách tháng.' : 'Đã xóa giới hạn ngân sách tháng.');
    } catch (error) { showToast(error.message, true); }
  }

  function renderAIInsights(data) {
    const container = $('#aiInsights');
    const insights = Array.isArray(data.insights) ? data.insights : [];
    if (!insights.length) {
      container.innerHTML = '<div class="ai-insights-empty">Chưa có đủ dữ liệu để đưa ra nhận định.</div>';
      return;
    }
    container.innerHTML = insights.map((item) => {
      const kind = ['good', 'warning', 'neutral'].includes(item.kind) ? item.kind : 'neutral';
      return `<article class="ai-insight-item ${kind}"><span class="ai-insight-icon">${escapeHTML(item.icon || '✦')}</span><div><strong>${escapeHTML(item.title || 'Nhận định')}</strong><p>${escapeHTML(item.detail || '')}</p></div></article>`;
    }).join('');
  }

  async function loadAIInsights() {
    const month = monthPicker.value || currentMonth();
    try {
      const data = await api(`/api/ai/insights?month=${encodeURIComponent(month)}`);
      if (month === monthPicker.value) renderAIInsights(data);
    } catch (_error) {
      $('#aiInsights').innerHTML = '<div class="ai-insights-empty">Không tải được nhận định. Hãy thử tải lại trang.</div>';
    }
  }

  async function refreshAIStatus() {
    const status = $('#aiStatus');
    try {
      const data = await api('/api/ai/status');
      status.classList.toggle('online', Boolean(data.configured));
      status.classList.toggle('local', !data.configured);
      status.innerHTML = `<span class="ai-status-dot"></span><span>${data.configured ? `AI trực tuyến · ${escapeHTML(data.model || 'đã kết nối')}` : 'AI cục bộ · chưa cần API key'}</span>`;
      $('#aiChatSubtitle').textContent = data.configured
        ? `Đang kết nối mô hình ${data.model || 'AI'} · hỗ trợ câu hỏi mở và số liệu ví khi phù hợp`
        : 'AI cục bộ · phân tích ví và hỗ trợ cơ bản; cấu hình API để hỏi tự do nhiều chủ đề';
    } catch (_error) {
      status.classList.add('local');
      status.innerHTML = '<span class="ai-status-dot"></span><span>Đang dùng chế độ dự phòng</span>';
    }
  }

  function appendAIMessage(role, text) {
    const container = $('#aiMessages');
    const isUser = role === 'user';
    const message = document.createElement('div');
    message.className = `ai-message ${isUser ? 'user-message' : 'assistant-message'}`;
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = isUser ? 'Bạn' : 'AI';
    const content = document.createElement('div');
    content.className = 'message-content';
    const sender = document.createElement('span');
    sender.className = 'message-sender';
    sender.textContent = isUser ? 'Bạn' : 'Ví AI';
    const paragraph = document.createElement('p');
    paragraph.innerHTML = escapeHTML(text).replace(/\r?\n/g, '<br>');
    content.append(sender, paragraph);
    message.append(avatar, content);
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
    return message;
  }

  async function sendAIMessage(rawMessage) {
    const input = $('#aiPrompt');
    const message = String(rawMessage ?? input.value).trim();
    if (!message || aiSending) return;
    if (message.length > 1200) {
      showToast('Câu hỏi tối đa 1.200 ký tự.', true);
      return;
    }
    const priorHistory = chatHistory.slice(-8);
    input.value = '';
    aiSending = true;
    $('#aiSendBtn').disabled = true;
    $('#aiSendBtn').classList.add('sending');
    $('#aiSuggestions').classList.add('suggestions-used');
    appendAIMessage('user', message);
    chatHistory.push({ role: 'user', content: message });
    const typing = document.createElement('div');
    typing.className = 'ai-typing';
    typing.innerHTML = '<span></span><span></span><span></span><em>Ví AI đang phân tích</em>';
    $('#aiMessages').appendChild(typing);
    $('#aiMessages').scrollTop = $('#aiMessages').scrollHeight;
    try {
      const result = await api('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ month: monthPicker.value || currentMonth(), message, history: priorHistory })
      });
      typing.remove();
      const evidence = result.based_on ? `\n\nDựa trên dữ liệu tháng ${result.based_on.month}: thu ${formatMoney(result.based_on.income)}, chi ${formatMoney(result.based_on.expense)}${result.based_on.budget ? `, ngân sách ${formatMoney(result.based_on.budget)}` : ', chưa đặt ngân sách tổng'}.` : '';
      appendAIMessage('assistant', `${result.answer}${evidence}${result.warning ? `\n\n${result.warning}` : ''}`);
      chatHistory.push({ role: 'assistant', content: result.answer });
      if (result.provider === 'local-fallback') {
        $('#aiStatus').classList.remove('online');
        $('#aiStatus').classList.add('local');
        $('#aiStatus').innerHTML = '<span class="ai-status-dot"></span><span>AI trực tuyến đang gián đoạn · dùng dự phòng</span>';
      }
    } catch (error) {
      typing.remove();
      appendAIMessage('assistant', `Mình chưa thể xử lý câu hỏi này: ${error.message}`);
    } finally {
      aiSending = false;
      $('#aiSendBtn').disabled = false;
      $('#aiSendBtn').classList.remove('sending');
      input.focus();
    }
  }

  function bindAIEvents() {
    $('#aiChatForm').addEventListener('submit', (event) => {
      event.preventDefault();
      sendAIMessage();
    });
    $('#aiSuggestions').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-prompt]');
      if (button) sendAIMessage(button.dataset.prompt);
    });
    $('#aiResetBtn')?.addEventListener('click', () => {
      if (aiSending) { showToast('Hãy đợi Ví AI trả lời xong rồi đặt lại cuộc trò chuyện nhé.', true); return; }
      // Reset only in-memory chat context; never touch transactions or budgets.
      chatHistory = [{ role: 'assistant', content: aiWelcomeMessage }];
      const messages = $('#aiMessages');
      messages.innerHTML = '';
      appendAIMessage('assistant', aiWelcomeMessage);
      $('#aiSuggestions').classList.remove('suggestions-used');
      $('#aiPrompt').value = '';
      $('#aiPrompt').focus();
      showToast('Đã bắt đầu cuộc trò chuyện mới.');
    });
    $('#exportCsvBtn').addEventListener('click', () => {
      window.location.href = `/api/export.csv?month=${encodeURIComponent(monthPicker.value || currentMonth())}`;
    });
  }

  function bindEvents() {
    $('#addTransactionBtn').addEventListener('click', () => openModal());
    $('#heroAddBtn').addEventListener('click', () => openModal());
    $('#closeModalBtn').addEventListener('click', closeModal);
    $('#cancelModalBtn').addEventListener('click', closeModal);
    transactionModal.addEventListener('mousedown', (event) => { if (event.target === transactionModal) closeModal(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && transactionModal.classList.contains('open')) closeModal(); });
    $$('.type-option').forEach((button) => button.addEventListener('click', () => setTransactionType(button.dataset.type)));
    transactionForm.addEventListener('submit', submitTransaction);
    $('#budgetForm').addEventListener('submit', saveBudget);
    monthPicker.addEventListener('change', refreshAll);
    $('#typeFilter').addEventListener('change', () => {
      const type = $('#typeFilter').value;
      if (type !== 'all' && !categories[type].includes($('#categoryFilter').value)) $('#categoryFilter').value = 'all';
      refreshAll();
    });
    $('#categoryFilter').addEventListener('change', refreshAll);
    $('#searchInput').addEventListener('input', () => {
      window.clearTimeout(searchTimeout);
      searchTimeout = window.setTimeout(refreshAll, 220);
    });
    $('#clearFiltersBtn').addEventListener('click', () => {
      $('#searchInput').value = '';
      $('#typeFilter').value = 'all';
      $('#categoryFilter').value = 'all';
      refreshAll();
    });
    $('#transactionRows').addEventListener('click', handleTableAction);
    bindAIEvents();
    $$('.nav-link').forEach((link) => link.addEventListener('click', () => {
      $$('.nav-link').forEach((item) => item.classList.toggle('active', item === link));
      $('#sidebar').classList.remove('open');
    }));
    $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    document.addEventListener('click', (event) => {
      if (window.innerWidth <= 950 && $('#sidebar').classList.contains('open') && !$('#sidebar').contains(event.target) && !$('#mobileMenu').contains(event.target)) $('#sidebar').classList.remove('open');
    });
  }

  async function loadCategoryBudgets() {
    const data = await api(`/api/category-budgets?month=${encodeURIComponent(monthPicker.value || currentMonth())}`);
    const list = $('#categoryBudgetList');
    if (!list) return;
    if (!data.items.length) { list.innerHTML = '<p class="field-hint">Chưa đặt hạn mức danh mục cho tháng này.</p>'; return; }
    list.innerHTML = data.items.map((item) => {
      const percent = Number(item.percent || 0); const status = percent >= 100 ? 'Vượt hạn mức' : percent >= 80 ? 'Sắp chạm' : 'Bình thường';
      return `<div class="extension-item"><div><strong>${escapeHTML(item.category)}</strong><small>Đã chi ${escapeHTML(formatMoney(item.spent))} / ${escapeHTML(formatMoney(item.budget))}</small><div class="extension-progress"><span style="width:${Math.min(100,Math.max(0,percent))}%"></span></div></div><span class="extension-status ${percent >= 80 ? 'warn' : 'good'}">${status} · ${Math.round(percent)}%</span></div>`;
    }).join('');
  }
  async function loadRecurring() {
    const data = await api('/api/recurring'); const list = $('#recurringList'); if (!list) return;
    if (!data.length) { list.innerHTML = '<p class="field-hint">Chưa có quy tắc định kỳ. Tạo quy tắc đầu tiên ở trên.</p>'; return; }
    list.innerHTML = data.map((item) => `<div class="extension-item"><div><strong>${escapeHTML(item.category)} · ${escapeHTML(formatMoney(item.amount))}</strong><small>${item.type === 'income' ? 'Thu nhập' : 'Chi tiêu'} · ngày ${item.day_of_month} · từ ${escapeHTML(item.start_month)}${item.end_month ? ` đến ${escapeHTML(item.end_month)}` : ''} · ${item.active ? 'Đang bật' : 'Đã tạm dừng'}</small><small>${escapeHTML(item.note || '')}</small></div><div><button type="button" class="btn btn-secondary" data-recurring-toggle="${item.id}" data-active="${item.active ? '1' : '0'}">${item.active ? 'Tạm dừng' : 'Bật lại'}</button><button type="button" class="btn btn-secondary" data-recurring-skip="${item.id}">Bỏ kỳ này</button></div></div>`).join('');
  }
  async function loadExtensions() { try { await Promise.all([loadCategoryBudgets(), loadRecurring()]); } catch (error) { showToast(error.message, true); } }
  async function loadAdvancedAnalytics() {
    try {
    const data = await api(`/api/analytics?month=${encodeURIComponent(monthPicker.value || currentMonth())}`);
    renderTrend(data.months || []);
    const metrics = $('#analyticsMetrics');
    metrics.innerHTML = `<div class="metric-chip"><small>Chi trung bình/ngày</small><strong>${escapeHTML(formatMoney(data.average_daily_expense))}</strong></div><div class="metric-chip"><small>Ngày chi nhiều nhất</small><strong>${data.highest_spend_day ? `${escapeHTML(dateDisplay(data.highest_spend_day.transaction_date))} · ${escapeHTML(formatMoney(data.highest_spend_day.amount))}` : 'Chưa có dữ liệu'}</strong></div><div class="metric-chip"><small>Chi cố định</small><strong>${escapeHTML(formatMoney(data.fixed_expense))} · ${data.fixed_ratio_percent ?? 0}%</strong></div><div class="metric-chip"><small>Chi linh hoạt</small><strong>${escapeHTML(formatMoney(data.flexible_expense))}</strong></div>`;
    const lastThree = (data.months || []).slice(-3); lastThree.forEach((item, index) => { const node = $(`#compareMonth${index}`); if (node) node.textContent = monthShort(item.month); });
    const categories = [...new Set(lastThree.flatMap((item) => Object.keys(item.categories || {})))];
    $('#categoryCompareRows').innerHTML = categories.length ? categories.map((category) => `<tr><th scope="row">${escapeHTML(category)}</th>${lastThree.map((item) => `<td>${escapeHTML(formatMoney((item.categories || {})[category] || 0))}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="4">Chưa có dữ liệu chi tiêu trong 3 tháng gần nhất.</td></tr>';
    } catch (error) { showToast(error.message || 'Không tải được phân tích chuyên sâu.', true); }
  }
  async function checkLegacyData() { try { const data = await api('/api/legacy-data/status'); $('#legacyClaimBanner').hidden = !data.available; } catch (_error) { /* The banner is optional; core app remains usable. */ } }
  function fillRecurringCategories() {
    const type = $('#recurringType').value; const options = categories[type] || [];
    $('#recurringCategory').innerHTML = options.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
  }
  async function previewCsv() {
    const file = $('#csvImportFile').files[0]; if (!file) { showToast('Chọn file CSV trước.', true); return; }
    if (file.size > 2 * 1024 * 1024) { showToast('File nhập tối đa 2 MB.', true); return; }
    try {
      const data = await api('/api/import/csv-preview', { method: 'POST', body: JSON.stringify({ csv: await file.text() }) });
      $('#importPreview').innerHTML = `<p>Hợp lệ: <strong>${data.to_add}</strong> · Trùng: <strong>${data.duplicates}</strong> · Lỗi: <strong>${data.errors.length}</strong></p>${data.errors.slice(0,10).map((e) => `<p class="auth-error">Dòng ${e.row}: ${escapeHTML(e.reason)}</p>`).join('')}${data.can_import ? '<button type="button" class="btn btn-primary" id="commitCsvImport">Xác nhận nhập CSV</button>' : '<p class="field-hint">Không nhập một phần. Hãy sửa các dòng lỗi rồi xem trước lại.</p>'}`;
      $('#commitCsvImport')?.addEventListener('click', async () => { try { const result = await api('/api/import/csv-commit', { method: 'POST', body: '{}' }); showToast(`Đã nhập ${result.imported} giao dịch.`); $('#importPreview').textContent = ''; await refreshAll(); } catch (error) { showToast(error.message, true); } });
    } catch (error) { showToast(error.message, true); }
  }
  async function previewJson() {
    const file = $('#jsonImportFile').files[0]; if (!file) { showToast('Chọn file JSON trước.', true); return; }
    if (file.size > 2 * 1024 * 1024) { showToast('File sao lưu tối đa 2 MB.', true); return; }
    try {
      const payload = JSON.parse(await file.text()); pendingJsonBackup = payload;
      const data = await api('/api/backup/preview', { method: 'POST', body: JSON.stringify(payload) });
      $('#importPreview').innerHTML = `<p>Bản sao lưu: ${escapeHTML(String(data.rows))} giao dịch · Thêm mới: <strong>${data.to_add}</strong> · Trùng: ${data.duplicates} · Lỗi: ${data.errors}</p>${data.errors ? '<p class="auth-error">File có dữ liệu lỗi; chưa khôi phục.</p>' : '<button type="button" class="btn btn-primary" id="commitJsonImport">Xác nhận khôi phục JSON</button>'}`;
      $('#commitJsonImport')?.addEventListener('click', async () => { try { const result = await api('/api/backup/commit', { method: 'POST', body: JSON.stringify(pendingJsonBackup) }); showToast(`Đã khôi phục ${result.imported} giao dịch.`); $('#importPreview').textContent = ''; pendingJsonBackup = null; await refreshAll(); } catch (error) { showToast(error.message, true); } });
    } catch (error) { showToast(error.message === 'Unexpected end of JSON input' ? 'File JSON không hợp lệ.' : error.message, true); }
  }

  async function init() {
    monthPicker.value = currentMonth();
    dateInput.value = localDateString();
    bindEvents();
    $$('.sort-heading').forEach((button) => button.addEventListener('click', async () => { const key = button.dataset.sort; sortState = { key, direction: sortState.key === key && sortState.direction === 'desc' ? 'asc' : 'desc' }; await refreshAll(); }));
    $('#categoryBudgetCategory').innerHTML = (categories.expense || []).map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
    $('#recurringType')?.addEventListener('change', fillRecurringCategories);
    fillRecurringCategories();
    $('#categoryBudgetForm')?.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/category-budgets', { method: 'PUT', body: JSON.stringify({ month: monthPicker.value || currentMonth(), category: $('#categoryBudgetCategory').value, amount: Number($('#categoryBudgetAmount').value) }) }); $('#categoryBudgetAmount').value = ''; await loadCategoryBudgets(); await loadAIInsights(); showToast('Đã lưu hạn mức danh mục.'); } catch (error) { showToast(error.message, true); } });
    $('#copyCategoryBudgets')?.addEventListener('click', async () => { try { await api('/api/category-budgets/copy-previous', { method: 'POST', body: JSON.stringify({ month: monthPicker.value || currentMonth() }) }); await loadCategoryBudgets(); showToast('Đã sao chép hạn mức tháng trước.'); } catch (error) { showToast(error.message, true); } });
    $('#recurringForm')?.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/recurring', { method: 'POST', body: JSON.stringify({ type: $('#recurringType').value, category: $('#recurringCategory').value, amount: Number($('#recurringAmount').value), day_of_month: Number($('#recurringDay').value), start_month: $('#recurringStart').value, end_month: $('#recurringEnd').value || null, note: $('#recurringNote').value }) }); event.target.reset(); $('#recurringStart').value = monthPicker.value || currentMonth(); fillRecurringCategories(); await loadRecurring(); showToast('Đã tạo quy tắc định kỳ.'); } catch (error) { showToast(error.message, true); } });
    $('#recurringList')?.addEventListener('click', async (event) => { const toggle = event.target.closest('[data-recurring-toggle]'); const skip = event.target.closest('[data-recurring-skip]'); try { if (toggle) await api(`/api/recurring/${toggle.dataset.recurringToggle}`, { method: 'PATCH', body: JSON.stringify({ active: toggle.dataset.active !== '1' }) }); else if (skip) await api(`/api/recurring/${skip.dataset.recurringSkip}/skip`, { method: 'POST', body: JSON.stringify({ month: monthPicker.value || currentMonth() }) }); else return; await loadRecurring(); await refreshAll(); showToast('Đã cập nhật giao dịch định kỳ.'); } catch (error) { showToast(error.message, true); } });
    $('#previewCsvImport')?.addEventListener('click', previewCsv); $('#previewJsonImport')?.addEventListener('click', previewJson);
    $('#claimLegacyData')?.addEventListener('click', async () => { if (!window.confirm('Nhận toàn bộ giao dịch và ngân sách cũ chưa gắn tài khoản vào ví của bạn? Chỉ tiếp tục nếu đây là dữ liệu của chính bạn.')) return; try { const result = await api('/api/legacy-data/claim', { method: 'POST', body: '{}' }); $('#legacyClaimBanner').hidden = true; await refreshAll(); showToast(`Đã nhận ${result.transactions_claimed} giao dịch và ${result.budgets_claimed} ngân sách cũ.`); } catch (error) { showToast(error.message, true); } });
    const savedTheme = localStorage.getItem('vi-theme');
    if (savedTheme === 'dark' || savedTheme === 'light') document.body.dataset.theme = savedTheme;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) document.body.dataset.theme = 'dark';

    const accentNames = ['violet', 'ocean', 'mint', 'rose', 'sunset'];
    const applyAccent = (accent, persist = true) => {
      const safeAccent = accentNames.includes(accent) ? accent : 'violet';
      document.body.dataset.accent = safeAccent;
      $$('[data-accent-choice]').forEach((button) => {
        const selected = button.dataset.accentChoice === safeAccent;
        button.setAttribute('aria-pressed', String(selected));
      });
      if (persist) {
        try { localStorage.setItem('vi-accent', safeAccent); } catch (_error) { /* The theme still applies for this session. */ }
      }
    };
    let savedAccent = 'violet';
    try { savedAccent = localStorage.getItem('vi-accent') || 'violet'; } catch (_error) { /* Use the default palette when storage is blocked. */ }
    applyAccent(savedAccent, false);

    const appearanceToggle = $('#appearanceToggle');
    const appearancePopover = $('#appearancePopover');
    const closeAppearance = () => {
      if (!appearancePopover || !appearanceToggle) return;
      appearancePopover.hidden = true;
      appearanceToggle.setAttribute('aria-expanded', 'false');
    };
    appearanceToggle?.addEventListener('click', () => {
      const open = appearancePopover.hidden;
      appearancePopover.hidden = !open;
      appearanceToggle.setAttribute('aria-expanded', String(open));
    });
    $('#closeAppearance')?.addEventListener('click', closeAppearance);
    $$('[data-accent-choice]').forEach((button) => button.addEventListener('click', () => applyAccent(button.dataset.accentChoice)));
    document.addEventListener('click', (event) => {
      if (appearancePopover && !event.target.closest('.appearance-control')) closeAppearance();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAppearance(); });
    $('#themeToggle')?.addEventListener('click', () => {
      const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = next;
      try { localStorage.setItem('vi-theme', next); } catch (_error) { /* Theme is still switched for this session. */ }
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#111625' : '#f7f8fc');
    });
    document.addEventListener('keydown', (event) => { const modal = $('#transactionModal'); if (event.key === 'Escape' && modal?.classList.contains('open')) { closeModal(); return; } if (event.key === 'Tab' && modal?.classList.contains('open')) { const focusable = Array.from(modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null); if (focusable.length) { const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } } if (event.key.toLowerCase() === 'n' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) && !modal?.classList.contains('open')) { event.preventDefault(); openModal(); } });
    refreshAIStatus();
    try {
      categories = await api('/api/categories');
      populateCategorySelect('income');
      populateCategoryFilter();
      $('#categoryBudgetCategory').innerHTML = (categories.expense || []).map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
      fillRecurringCategories();
      $('#recurringStart').value = monthPicker.value;
      await checkLegacyData();
      await refreshAll();
    } catch (error) {
      showToast(error.message || 'Không thể kết nối máy chủ.', true);
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
