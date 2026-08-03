const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4477;

// ---------- helpers ----------

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function daysInMonth(year, monthIndex0) { return new Date(year, monthIndex0 + 1, 0).getDate(); }

function familyExists(id) {
  return !!db.prepare('SELECT id FROM families WHERE id = ?').get(id);
}
function userInFamily(userId, familyId) {
  return !!db.prepare('SELECT id FROM users WHERE id = ? AND family_id = ?').get(userId, familyId);
}
const STALE_SESSION_MSG = "This family or user no longer exists on the server (the data may have been reset). Please rejoin using your family code.";

function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function periodRange(period, ref = new Date()) {
  const r = new Date(ref);
  r.setHours(0, 0, 0, 0);
  if (period === 'daily') {
    return [fmtDate(r), fmtDate(r)];
  }
  if (period === 'weekly') {
    const start = startOfWeek(r);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return [fmtDate(start), fmtDate(end)];
  }
  if (period === 'monthly') {
    const start = new Date(r.getFullYear(), r.getMonth(), 1);
    const end = new Date(r.getFullYear(), r.getMonth(), daysInMonth(r.getFullYear(), r.getMonth()));
    return [fmtDate(start), fmtDate(end)];
  }
  if (period === 'yearly') {
    const start = new Date(r.getFullYear(), 0, 1);
    const end = new Date(r.getFullYear(), 11, 31);
    return [fmtDate(start), fmtDate(end)];
  }
  throw new Error('bad period');
}

// Ensure every active recurring template has a transaction instance
// for every month from its creation up to the current month.
function generateDueInstances() {
  const templates = db.prepare('SELECT * FROM recurring WHERE active = 1').all();
  const today = new Date();
  const findStmt = db.prepare(
    `SELECT id FROM transactions WHERE recurring_id = ? AND strftime('%Y-%m', due_date) = ?`
  );
  const insertStmt = db.prepare(`
    INSERT INTO transactions
      (family_id, user_id, scope, type, category, description, expected_amount, actual_amount, due_date, status, recurring_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending_confirmation', ?)
  `);

  for (const t of templates) {
    const created = new Date(t.created_at.replace(' ', 'T') + 'Z');
    let cursor = new Date(created.getFullYear(), created.getMonth(), 1);
    const limit = new Date(today.getFullYear(), today.getMonth(), 1);
    let guard = 0;
    while (cursor <= limit && guard < 36) {
      guard++;
      const ym = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`;
      const exists = findStmt.get(t.id, ym);
      if (!exists) {
        const dim = daysInMonth(cursor.getFullYear(), cursor.getMonth());
        const day = Math.min(t.day_of_month, dim);
        const dueDate = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(day)}`;
        insertStmt.run(t.family_id, t.user_id, t.scope, t.type, t.category, t.description, t.amount, dueDate, t.id);
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }
}

// ---------- family / user routes ----------

app.post('/api/family/join', (req, res) => {
  const { code, name } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  const cleanCode = String(code).trim();
  const cleanName = String(name).trim();

  let family = db.prepare('SELECT * FROM families WHERE code = ?').get(cleanCode);
  if (!family) {
    const info = db.prepare('INSERT INTO families (code, name) VALUES (?, ?)').run(cleanCode, cleanCode);
    family = db.prepare('SELECT * FROM families WHERE id = ?').get(info.lastInsertRowid);
  }

  let user = db.prepare('SELECT * FROM users WHERE family_id = ? AND name = ?').get(family.id, cleanName);
  if (!user) {
    const palette = ['#2F5D50', '#B98B2E', '#6E8F63', '#A8432F', '#4A6FA5', '#8C5E9C'];
    const count = db.prepare('SELECT COUNT(*) AS c FROM users WHERE family_id = ?').get(family.id).c;
    const color = palette[count % palette.length];
    const info = db.prepare('INSERT INTO users (family_id, name, color) VALUES (?, ?, ?)').run(family.id, cleanName, color);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }

  res.json({ family, user });
});

app.get('/api/family/:familyId/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users WHERE family_id = ? ORDER BY name').all(req.params.familyId);
  res.json(users);
});

// ---------- transaction routes ----------

app.get('/api/transactions', (req, res) => {
  generateDueInstances();
  const { familyId, userId, scope, status } = req.query;
  if (!familyId) return res.status(400).json({ error: 'familyId required' });

  let query = 'SELECT * FROM transactions WHERE family_id = ?';
  const params = [familyId];

  if (scope === 'family') {
    query += " AND scope = 'family'";
  } else if (scope === 'personal') {
    query += ' AND scope = \'personal\' AND user_id = ?';
    params.push(userId);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  query += ' ORDER BY due_date DESC, id DESC';

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

app.post('/api/transactions', (req, res) => {
  const { familyId, userId, scope, type, category, description, expected_amount, actual_amount, due_date, status } = req.body;
  if (!familyId || !userId || !description || !due_date) {
    return res.status(400).json({ error: 'familyId, userId, description, due_date are required' });
  }
  if (!familyExists(familyId)) {
    return res.status(404).json({ error: STALE_SESSION_MSG, code: 'unknown_family' });
  }
  if (!userInFamily(userId, familyId)) {
    return res.status(404).json({ error: STALE_SESSION_MSG, code: 'unknown_user' });
  }
  const finalStatus = status || (actual_amount != null ? 'paid' : 'planned');
  const paidDate = finalStatus === 'paid' ? (req.body.paid_date || fmtDate(new Date())) : null;

  const info = db.prepare(`
    INSERT INTO transactions
      (family_id, user_id, scope, type, category, description, expected_amount, actual_amount, due_date, paid_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    familyId, userId, scope || 'personal', type || 'expense', category || null, description,
    expected_amount ?? null, actual_amount ?? null, due_date, paidDate, finalStatus
  );

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// Confirm / edit / update a transaction (e.g. mark a pending recurring bill as paid)
app.put('/api/transactions/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const {
    description = existing.description,
    category = existing.category,
    expected_amount = existing.expected_amount,
    actual_amount = existing.actual_amount,
    due_date = existing.due_date,
    status = existing.status,
    scope = existing.scope,
    type = existing.type,
  } = req.body;

  let paid_date = existing.paid_date;
  if (status === 'paid' && existing.status !== 'paid') {
    paid_date = req.body.paid_date || fmtDate(new Date());
  } else if (status !== 'paid') {
    paid_date = null;
  }

  db.prepare(`
    UPDATE transactions SET
      description = ?, category = ?, expected_amount = ?, actual_amount = ?,
      due_date = ?, status = ?, scope = ?, type = ?, paid_date = ?
    WHERE id = ?
  `).run(description, category, expected_amount, actual_amount, due_date, status, scope, type, paid_date, req.params.id);

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  res.json(row);
});

app.delete('/api/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- recurring template routes ----------

app.get('/api/recurring', (req, res) => {
  const { familyId, userId, scope } = req.query;
  if (!familyId) return res.status(400).json({ error: 'familyId required' });
  let query = 'SELECT * FROM recurring WHERE family_id = ?';
  const params = [familyId];
  if (scope === 'family') {
    query += " AND scope = 'family'";
  } else if (scope === 'personal') {
    query += ' AND scope = \'personal\' AND user_id = ?';
    params.push(userId);
  }
  query += ' ORDER BY day_of_month';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/recurring', (req, res) => {
  const { familyId, userId, scope, type, category, description, amount, day_of_month } = req.body;
  if (!familyId || !userId || !description || !amount || !day_of_month) {
    return res.status(400).json({ error: 'familyId, userId, description, amount, day_of_month are required' });
  }
  if (!familyExists(familyId)) {
    return res.status(404).json({ error: STALE_SESSION_MSG, code: 'unknown_family' });
  }
  if (!userInFamily(userId, familyId)) {
    return res.status(404).json({ error: STALE_SESSION_MSG, code: 'unknown_user' });
  }
  const info = db.prepare(`
    INSERT INTO recurring (family_id, user_id, scope, type, category, description, amount, day_of_month)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(familyId, userId, scope || 'personal', type || 'expense', category || null, description, amount, day_of_month);

  generateDueInstances();
  const row = db.prepare('SELECT * FROM recurring WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

app.put('/api/recurring/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM recurring WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const {
    description = existing.description,
    category = existing.category,
    amount = existing.amount,
    day_of_month = existing.day_of_month,
    active = existing.active,
    scope = existing.scope,
    type = existing.type,
  } = req.body;
  db.prepare(`
    UPDATE recurring SET description = ?, category = ?, amount = ?, day_of_month = ?, active = ?, scope = ?, type = ?
    WHERE id = ?
  `).run(description, category, amount, day_of_month, active ? 1 : 0, scope, type, req.params.id);
  res.json(db.prepare('SELECT * FROM recurring WHERE id = ?').get(req.params.id));
});

app.delete('/api/recurring/:id', (req, res) => {
  db.prepare('DELETE FROM recurring WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- stats ----------

app.get('/api/stats', (req, res) => {
  generateDueInstances();
  const { familyId, userId, scope } = req.query;
  if (!familyId) return res.status(400).json({ error: 'familyId required' });

  let scopeClause = '';
  const baseParams = [familyId];
  if (scope === 'family') {
    scopeClause = " AND scope = 'family'";
  } else {
    scopeClause = " AND scope = 'personal' AND user_id = ?";
    baseParams.push(userId);
  }

  const periods = ['daily', 'weekly', 'monthly', 'yearly'];
  const result = {};

  for (const period of periods) {
    const [start, end] = periodRange(period);

    const spent = db.prepare(`
      SELECT COALESCE(SUM(actual_amount), 0) AS v FROM transactions
      WHERE family_id = ? ${scopeClause} AND type = 'expense' AND status = 'paid' AND paid_date BETWEEN ? AND ?
    `).get(...baseParams, start, end).v;

    const earned = db.prepare(`
      SELECT COALESCE(SUM(actual_amount), 0) AS v FROM transactions
      WHERE family_id = ? ${scopeClause} AND type = 'income' AND status = 'paid' AND paid_date BETWEEN ? AND ?
    `).get(...baseParams, start, end).v;

    const upcomingExpense = db.prepare(`
      SELECT COALESCE(SUM(expected_amount), 0) AS v FROM transactions
      WHERE family_id = ? ${scopeClause} AND type = 'expense' AND status IN ('planned','pending_confirmation') AND due_date BETWEEN ? AND ?
    `).get(...baseParams, start, end).v;

    const upcomingIncome = db.prepare(`
      SELECT COALESCE(SUM(expected_amount), 0) AS v FROM transactions
      WHERE family_id = ? ${scopeClause} AND type = 'income' AND status IN ('planned','pending_confirmation') AND due_date BETWEEN ? AND ?
    `).get(...baseParams, start, end).v;

    const variance = db.prepare(`
      SELECT COALESCE(SUM(actual_amount - expected_amount), 0) AS v FROM transactions
      WHERE family_id = ? ${scopeClause} AND type = 'expense' AND status = 'paid'
        AND expected_amount IS NOT NULL AND paid_date BETWEEN ? AND ?
    `).get(...baseParams, start, end).v;

    result[period] = { range: [start, end], spent, earned, upcomingExpense, upcomingIncome, variance };
  }

  const pendingCount = db.prepare(`
    SELECT COUNT(*) AS c FROM transactions WHERE family_id = ? ${scopeClause} AND status = 'pending_confirmation'
  `).get(...baseParams).c;

  result.pendingCount = pendingCount;
  res.json(result);
});

// ---------- error handling ----------
// Catches errors thrown anywhere in the route handlers above (including
// SQLite constraint failures) and returns clean JSON instead of crashing
// the process or sending an HTML stack trace to the browser.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const isConstraint = /FOREIGN KEY|CHECK constraint/i.test(err.message || '');
  res.status(isConstraint ? 409 : 500).json({
    error: isConstraint ? STALE_SESSION_MSG : 'Something went wrong on the server. Check the terminal window for details.',
    code: isConstraint ? 'unknown_family' : undefined,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  generateDueInstances();
  console.log(`Spending tracker running:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: check your PC's LAN IP, e.g. http://<your-ip>:${PORT}`);
});
