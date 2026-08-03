const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'data.sqlite'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2F5D50',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(family_id, name),
  FOREIGN KEY(family_id) REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT 'personal',
  type TEXT NOT NULL DEFAULT 'expense',
  category TEXT,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  day_of_month INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(family_id) REFERENCES families(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT 'personal',
  type TEXT NOT NULL DEFAULT 'expense',
  category TEXT,
  description TEXT NOT NULL,
  expected_amount REAL,
  actual_amount REAL,
  due_date TEXT NOT NULL,
  paid_date TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  recurring_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(family_id) REFERENCES families(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(recurring_id) REFERENCES recurring(id)
);

CREATE INDEX IF NOT EXISTS idx_tx_family ON transactions(family_id);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_due ON transactions(due_date);
CREATE INDEX IF NOT EXISTS idx_tx_recurring ON transactions(recurring_id);
`);

module.exports = db;
