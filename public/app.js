const API = '/api';
let state = {
  family: null,
  user: null,
  scope: 'personal', // dashboard scope
  historyScope: 'personal',
};

const CATEGORY_SUGGESTIONS = ['Groceries', 'Rent', 'Utilities', 'Salary', 'Transport', 'Dining', 'Health', 'Subscriptions', 'Entertainment', 'Savings', 'Other'];

// ---------- persistence of login ----------
function saveSession() {
  localStorage.setItem('ledger_session', JSON.stringify({ family: state.family, user: state.user }));
}
function loadSession() {
  try {
    const raw = localStorage.getItem('ledger_session');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function clearSession() {
  localStorage.removeItem('ledger_session');
}

// ---------- api helper ----------
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.code = body.code;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

function money(n) {
  const v = Number(n || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
}
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// ---------- gate ----------
const gateEl = document.getElementById('gate');
const appEl = document.getElementById('app');

document.getElementById('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('gate-code').value.trim();
  const name = document.getElementById('gate-name').value.trim();
  const errorEl = document.getElementById('gate-error');
  errorEl.textContent = '';
  try {
    const { family, user } = await api('/family/join', { method: 'POST', body: JSON.stringify({ code, name }) });
    state.family = family;
    state.user = user;
    saveSession();
    enterApp();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('switch-user').addEventListener('click', () => {
  clearSession();
  state.family = null;
  state.user = null;
  appEl.classList.add('hidden');
  gateEl.classList.remove('hidden');
});

function forceRejoin(message) {
  clearSession();
  state.family = null;
  state.user = null;
  appEl.classList.add('hidden');
  gateEl.classList.remove('hidden');
  document.getElementById('gate-error').textContent =
    message || "Your session couldn't be found. Please rejoin using your family code.";
}

// If a mutating request fails because the family/user no longer exists on the
// server (e.g. data.sqlite was reset while this browser still had an old
// session saved), bounce back to the gate instead of leaving a dead form.
function handleMutationError(err, msgEl) {
  if (err.code === 'unknown_family' || err.code === 'unknown_user') {
    forceRejoin(err.message);
    return true;
  }
  if (msgEl) msgEl.textContent = err.message;
  else alert(err.message);
  return false;
}

function enterApp() {
  gateEl.classList.add('hidden');
  appEl.classList.remove('hidden');
  document.getElementById('who-family').textContent = `${state.user.name} · ${state.family.code}`;
  populateCategoryList();
  goToView('dashboard');
  refreshDashboard();
}

// ---------- tab navigation ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => goToView(btn.dataset.view));
});

function goToView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${name}`).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'dashboard') refreshDashboard();
  if (name === 'recurring') refreshRecurring();
  if (name === 'history') refreshHistory();
  if (name === 'add') {
    document.getElementById('add-date').value = todayISO();
  }
}

document.getElementById('pending-jump').addEventListener('click', () => goToView('recurring'));

// ---------- scope toggles ----------
document.getElementById('scope-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.scope-btn');
  if (!btn) return;
  document.querySelectorAll('#scope-toggle .scope-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.scope = btn.dataset.scope;
  refreshDashboard();
});

document.getElementById('history-scope-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.scope-btn');
  if (!btn) return;
  document.querySelectorAll('#history-scope-toggle .scope-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.historyScope = btn.dataset.scope;
  refreshHistory();
});

// ---------- segmented control helper ----------
function wireSeg(containerId) {
  const container = document.getElementById(containerId);
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    [...container.children].forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
  });
}
function segValue(containerId) {
  return document.querySelector(`#${containerId} .seg-btn.active`).dataset.val;
}
wireSeg('add-type');
wireSeg('add-scope');
wireSeg('add-status');
wireSeg('rec-type');
wireSeg('rec-scope');

document.getElementById('add-status').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  document.getElementById('add-actual-wrap').classList.toggle('hidden', btn.dataset.val !== 'paid');
});

function populateCategoryList() {
  const dl = document.getElementById('cat-list');
  dl.innerHTML = CATEGORY_SUGGESTIONS.map(c => `<option value="${c}">`).join('');
}

// ---------- dashboard ----------
const PERIOD_LABELS = { daily: 'Today', weekly: 'This week', monthly: 'This month', yearly: 'This year' };

async function refreshDashboard() {
  if (!state.family) return;
  const params = new URLSearchParams({ familyId: state.family.id, scope: state.scope });
  if (state.scope === 'personal') params.set('userId', state.user.id);

  const stats = await api(`/stats?${params.toString()}`);

  const grid = document.getElementById('period-grid');
  grid.innerHTML = '';
  for (const period of ['daily', 'weekly', 'monthly', 'yearly']) {
    const s = stats[period];
    const profit = s.earned - s.spent;
    const profitClass = profit > 0 ? 'profit-positive' : (profit < 0 ? 'profit-negative' : '');
    const profitSign = profit > 0 ? '+' : (profit < 0 ? '−' : '');
    const varianceClass = s.variance > 0 ? 'variance-over' : (s.variance < 0 ? 'variance-under' : '');
    const varianceText = s.variance === 0 ? '' :
      (s.variance > 0 ? `${money(s.variance)} over expected` : `${money(Math.abs(s.variance))} under expected`);

    grid.insertAdjacentHTML('beforeend', `
      <div class="period-card">
        <div class="p-label">${PERIOD_LABELS[period]}</div>
        <div class="p-spent num ${profitClass}">${profitSign}${money(Math.abs(profit))}</div>
        <div class="p-row"><span>Earned</span><span class="num">${money(s.earned)}</span></div>
        <div class="p-row"><span>Spent</span><span class="num">${money(s.spent)}</span></div>
        ${varianceText ? `<div class="p-variance ${varianceClass}">${varianceText}</div>` : ''}
      </div>
    `);
  }

  const pendingBanner = document.getElementById('pending-banner');
  if (stats.pendingCount > 0) {
    pendingBanner.classList.remove('hidden');
    document.getElementById('pending-count-text').textContent =
      `${stats.pendingCount} recurring bill${stats.pendingCount > 1 ? 's' : ''} waiting for confirmation`;
  } else {
    pendingBanner.classList.add('hidden');
  }

  // recent activity
  const txParams = new URLSearchParams({ familyId: state.family.id, scope: state.scope });
  if (state.scope === 'personal') txParams.set('userId', state.user.id);
  const txs = await api(`/transactions?${txParams.toString()}`);
  renderTxList(document.getElementById('recent-list'), txs.slice(0, 8));
}

function renderTxList(container, txs) {
  if (txs.length === 0) {
    container.innerHTML = `<p class="empty-note">Nothing here yet.</p>`;
    return;
  }
  container.innerHTML = txs.map(tx => txItemHTML(tx)).join('');
  container.querySelectorAll('.tx-item').forEach(el => {
    el.addEventListener('click', () => openEditModal(Number(el.dataset.id)));
  });
}

function txItemHTML(tx) {
  const amount = tx.status === 'paid' ? tx.actual_amount : tx.expected_amount;
  const sign = tx.type === 'income' ? '+' : '−';
  const color = tx.type === 'income' ? 'income' : 'expense';
  const statusLabel = tx.status.replace('_', ' ');
  return `
    <div class="tx-item" data-id="${tx.id}" style="border-left-color:${tx.scope === 'family' ? 'var(--brass)' : 'var(--pine)'}">
      <div class="tx-main">
        <div class="tx-desc">${escapeHtml(tx.description)}</div>
        <div class="tx-meta">${tx.category ? escapeHtml(tx.category) + ' · ' : ''}${tx.status === 'paid' ? tx.paid_date : tx.due_date} · ${tx.scope}</div>
      </div>
      <span class="tx-status status-${tx.status}">${statusLabel}</span>
      <div class="tx-amount ${color} num">${sign}${money(amount)}</div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- add entry ----------
document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('add-msg');
  msg.textContent = '';
  msg.classList.remove('ok');

  const status = segValue('add-status');
  const expected = document.getElementById('add-expected').value;
  const actual = document.getElementById('add-actual').value;

  const payload = {
    familyId: state.family.id,
    userId: state.user.id,
    type: segValue('add-type'),
    scope: segValue('add-scope'),
    description: document.getElementById('add-desc').value.trim(),
    category: document.getElementById('add-category').value.trim() || null,
    expected_amount: expected ? Number(expected) : null,
    actual_amount: status === 'paid' ? Number(actual || expected || 0) : null,
    due_date: document.getElementById('add-date').value,
    status,
  };

  if (!payload.description || !payload.due_date) {
    msg.textContent = 'Description and date are required.';
    return;
  }

  try {
    await api('/transactions', { method: 'POST', body: JSON.stringify(payload) });
    msg.textContent = 'Added.';
    msg.classList.add('ok');
    e.target.reset();
    document.getElementById('add-date').value = todayISO();
    document.getElementById('add-actual-wrap').classList.add('hidden');
    [...document.querySelectorAll('#add-type .seg-btn')].forEach((b, i) => b.classList.toggle('active', i === 0));
    [...document.querySelectorAll('#add-scope .seg-btn')].forEach((b, i) => b.classList.toggle('active', i === 0));
    [...document.querySelectorAll('#add-status .seg-btn')].forEach((b, i) => b.classList.toggle('active', i === 0));
    refreshDashboard();
  } catch (err) {
    handleMutationError(err, msg);
  }
});

// ---------- recurring ----------
async function refreshRecurring() {
  if (!state.family) return;
  const pendingParams = new URLSearchParams({ familyId: state.family.id });
  const allPending = await api(`/transactions?${pendingParams.toString()}&status=pending_confirmation`);
  const relevant = allPending.filter(tx => tx.scope === 'family' || tx.user_id === state.user.id);

  const pendingList = document.getElementById('pending-list');
  const pendingEmpty = document.getElementById('pending-empty');
  if (relevant.length === 0) {
    pendingList.innerHTML = '';
    pendingEmpty.classList.remove('hidden');
  } else {
    pendingEmpty.classList.add('hidden');
    pendingList.innerHTML = relevant.map(tx => `
      <div class="stub" data-id="${tx.id}">
        <div class="stub-info">
          <div class="stub-desc">${escapeHtml(tx.description)}</div>
          <div class="stub-meta">Due ${tx.due_date} · ${tx.scope}${tx.category ? ' · ' + escapeHtml(tx.category) : ''}</div>
        </div>
        <div class="stub-amount num">${money(tx.expected_amount)}</div>
        <button class="stub-confirm" data-id="${tx.id}">Confirm</button>
      </div>
    `).join('');
    pendingList.querySelectorAll('.stub-confirm').forEach(btn => {
      btn.addEventListener('click', () => openConfirmModal(Number(btn.dataset.id)));
    });
  }

  const recParams = new URLSearchParams({ familyId: state.family.id });
  const recs = await api(`/recurring?${recParams.toString()}`);
  const relevantRecs = recs.filter(r => r.scope === 'family' || r.user_id === state.user.id);
  const recList = document.getElementById('recurring-list');
  if (relevantRecs.length === 0) {
    recList.innerHTML = `<p class="empty-note">No recurring templates yet.</p>`;
  } else {
    recList.innerHTML = relevantRecs.map(r => `
      <div class="tx-item" data-id="${r.id}" style="border-left-color:${r.scope === 'family' ? 'var(--brass)' : 'var(--pine)'}; ${r.active ? '' : 'opacity:0.5;'}">
        <div class="tx-main">
          <div class="tx-desc">${escapeHtml(r.description)}</div>
          <div class="tx-meta">${r.category ? escapeHtml(r.category) + ' · ' : ''}day ${r.day_of_month} of month · ${r.scope}${r.active ? '' : ' · paused'}</div>
        </div>
        <div class="tx-amount num">${money(r.amount)}</div>
      </div>
    `).join('');
    recList.querySelectorAll('.tx-item').forEach(el => {
      el.addEventListener('click', () => openRecurringEditModal(Number(el.dataset.id), relevantRecs.find(r => r.id === Number(el.dataset.id))));
    });
  }
}

document.getElementById('new-recurring-btn').addEventListener('click', () => {
  document.getElementById('recurring-form').classList.toggle('hidden');
});

document.getElementById('recurring-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('rec-msg');
  msg.textContent = '';
  msg.classList.remove('ok');
  const payload = {
    familyId: state.family.id,
    userId: state.user.id,
    type: segValue('rec-type'),
    scope: segValue('rec-scope'),
    description: document.getElementById('rec-desc').value.trim(),
    category: document.getElementById('rec-category').value.trim() || null,
    amount: Number(document.getElementById('rec-amount').value),
    day_of_month: Number(document.getElementById('rec-day').value),
  };
  if (!payload.description || !payload.amount || !payload.day_of_month) {
    msg.textContent = 'Description, amount, and day of month are required.';
    return;
  }
  try {
    await api('/recurring', { method: 'POST', body: JSON.stringify(payload) });
    msg.textContent = 'Template saved.';
    msg.classList.add('ok');
    e.target.reset();
    document.getElementById('recurring-form').classList.add('hidden');
    refreshRecurring();
  } catch (err) {
    handleMutationError(err, msg);
  }
});

// ---------- history ----------
async function refreshHistory() {
  if (!state.family) return;
  document.querySelectorAll('#history-scope-toggle .scope-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.scope === state.historyScope));
  const params = new URLSearchParams({ familyId: state.family.id, scope: state.historyScope });
  if (state.historyScope === 'personal') params.set('userId', state.user.id);
  const txs = await api(`/transactions?${params.toString()}`);
  renderTxList(document.getElementById('history-list'), txs);
}

// ---------- modal: confirm a pending recurring bill ----------
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
let modalOnSave = null;

document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-save').addEventListener('click', () => modalOnSave && modalOnSave());

function closeModal() {
  modal.classList.add('hidden');
  modalOnSave = null;
}

function openConfirmModal(txId) {
  modalTitle.textContent = 'Confirm payment';
  modalBody.innerHTML = `
    <div class="modal-row"><label>Actual amount paid</label><input id="modal-actual" type="number" step="0.01" min="0"></div>
    <div class="modal-row"><label>Date paid</label><input id="modal-paiddate" type="date" value="${todayISO()}"></div>
  `;
  modal.classList.remove('hidden');
  modalOnSave = async () => {
    const actual = document.getElementById('modal-actual').value;
    const paid_date = document.getElementById('modal-paiddate').value;
    try {
      await api(`/transactions/${txId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'paid', actual_amount: actual ? Number(actual) : null, paid_date }),
      });
      closeModal();
      refreshRecurring();
      refreshDashboard();
    } catch (err) {
      alert(err.message);
    }
  };
}

// ---------- modal: edit an existing transaction ----------
async function openEditModal(txId) {
  const params = new URLSearchParams({ familyId: state.family.id });
  const all = await api(`/transactions?${params.toString()}`);
  const tx = all.find(t => t.id === txId);
  if (!tx) return;

  modalTitle.textContent = 'Edit entry';
  modalBody.innerHTML = `
    <div class="modal-row"><label>Description</label><input id="modal-desc" type="text" value="${escapeHtml(tx.description)}"></div>
    <div class="modal-row"><label>Category</label><input id="modal-cat" type="text" value="${escapeHtml(tx.category || '')}"></div>
    <div class="modal-row"><label>Expected amount</label><input id="modal-expected" type="number" step="0.01" value="${tx.expected_amount ?? ''}"></div>
    <div class="modal-row"><label>Actual amount</label><input id="modal-actual2" type="number" step="0.01" value="${tx.actual_amount ?? ''}"></div>
    <div class="modal-row"><label>Date</label><input id="modal-date" type="date" value="${tx.due_date}"></div>
    <div class="modal-row"><label>Status</label>
      <select id="modal-status">
        <option value="planned" ${tx.status === 'planned' ? 'selected' : ''}>Planned</option>
        <option value="pending_confirmation" ${tx.status === 'pending_confirmation' ? 'selected' : ''}>Pending confirmation</option>
        <option value="paid" ${tx.status === 'paid' ? 'selected' : ''}>Paid</option>
        <option value="skipped" ${tx.status === 'skipped' ? 'selected' : ''}>Skipped</option>
      </select>
    </div>
    <div class="modal-row">
      <button type="button" id="modal-delete" class="ghost-btn" style="color:var(--brick);border-color:var(--brick);">Delete entry</button>
    </div>
  `;
  modal.classList.remove('hidden');

  document.getElementById('modal-delete').addEventListener('click', async () => {
    if (!confirm('Delete this entry?')) return;
    await api(`/transactions/${txId}`, { method: 'DELETE' });
    closeModal();
    refreshDashboard();
    refreshHistory();
  });

  modalOnSave = async () => {
    const payload = {
      description: document.getElementById('modal-desc').value.trim(),
      category: document.getElementById('modal-cat').value.trim() || null,
      expected_amount: document.getElementById('modal-expected').value ? Number(document.getElementById('modal-expected').value) : null,
      actual_amount: document.getElementById('modal-actual2').value ? Number(document.getElementById('modal-actual2').value) : null,
      due_date: document.getElementById('modal-date').value,
      status: document.getElementById('modal-status').value,
    };
    try {
      await api(`/transactions/${txId}`, { method: 'PUT', body: JSON.stringify(payload) });
      closeModal();
      refreshDashboard();
      refreshHistory();
    } catch (err) {
      alert(err.message);
    }
  };
}

// ---------- modal: edit a recurring template ----------
function openRecurringEditModal(recId, rec) {
  modalTitle.textContent = 'Edit template';
  modalBody.innerHTML = `
    <div class="modal-row"><label>Description</label><input id="modal-rdesc" type="text" value="${escapeHtml(rec.description)}"></div>
    <div class="modal-row"><label>Category</label><input id="modal-rcat" type="text" value="${escapeHtml(rec.category || '')}"></div>
    <div class="modal-row"><label>Amount</label><input id="modal-ramount" type="number" step="0.01" value="${rec.amount}"></div>
    <div class="modal-row"><label>Day of month</label><input id="modal-rday" type="number" min="1" max="31" value="${rec.day_of_month}"></div>
    <div class="modal-row"><label>Active</label>
      <select id="modal-ractive">
        <option value="1" ${rec.active ? 'selected' : ''}>Active</option>
        <option value="0" ${!rec.active ? 'selected' : ''}>Paused</option>
      </select>
    </div>
    <div class="modal-row">
      <button type="button" id="modal-rdelete" class="ghost-btn" style="color:var(--brick);border-color:var(--brick);">Delete template</button>
    </div>
  `;
  modal.classList.remove('hidden');

  document.getElementById('modal-rdelete').addEventListener('click', async () => {
    if (!confirm('Delete this recurring template? Past entries stay in history.')) return;
    await api(`/recurring/${recId}`, { method: 'DELETE' });
    closeModal();
    refreshRecurring();
  });

  modalOnSave = async () => {
    const payload = {
      description: document.getElementById('modal-rdesc').value.trim(),
      category: document.getElementById('modal-rcat').value.trim() || null,
      amount: Number(document.getElementById('modal-ramount').value),
      day_of_month: Number(document.getElementById('modal-rday').value),
      active: document.getElementById('modal-ractive').value === '1',
    };
    try {
      await api(`/recurring/${recId}`, { method: 'PUT', body: JSON.stringify(payload) });
      closeModal();
      refreshRecurring();
    } catch (err) {
      alert(err.message);
    }
  };
}

// ---------- boot ----------
(async function boot() {
  const session = loadSession();
  if (!session || !session.family || !session.user) return;
  // Re-join using the saved code + name rather than trusting cached IDs directly.
  // This is idempotent (family/join reuses existing rows) and self-heals if
  // data.sqlite was ever reset or replaced while this browser still had an
  // old session saved, instead of surfacing a broken form later.
  try {
    const { family, user } = await api('/family/join', {
      method: 'POST',
      body: JSON.stringify({ code: session.family.code, name: session.user.name }),
    });
    state.family = family;
    state.user = user;
    saveSession();
    enterApp();
  } catch (err) {
    forceRejoin('Could not reconnect to the server. Please rejoin using your family code.');
  }
})();
