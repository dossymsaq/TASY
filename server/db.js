const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const { DB_FILE } = require('./config');

const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('client','seller','courier','support','admin')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  shop_name TEXT,
  pickup_address TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  pickup_address TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  address TEXT NOT NULL,
  district TEXT NOT NULL,
  item_desc TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  seller_paid INTEGER NOT NULL DEFAULT 0,
  buyer_paid INTEGER NOT NULL DEFAULT 0,
  courier_id INTEGER REFERENCES users(id),
  confirm_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  actor_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  payer TEXT NOT NULL CHECK (payer IN ('seller','buyer')),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,          -- online | cash
  status TEXT NOT NULL,          -- paid | refunded
  provider_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  contact_name TEXT,
  contact_phone TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open | answered | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id INTEGER,
  author_role TEXT NOT NULL,
  author_name TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Расчёты с курьерами. Баланс = SUM(amount):
--   > 0 — сервис должен курьеру, < 0 — курьер должен сдать деньги.
--   earning  (+) заработок за доставку
--   cash     (−) курьер получил наличные от покупателя (деньги сервиса)
--   handover (+) курьер сдал наличные в кассу
--   payout   (−) сервис выплатил курьеру
CREATE TABLE IF NOT EXISTS courier_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  courier_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  type TEXT NOT NULL CHECK (type IN ('earning','cash','handover','payout')),
  amount INTEGER NOT NULL,
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_courier ON courier_ledger(courier_id);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);

-- Telegram: какой чат принадлежит какому номеру (номер подтверждён Telegram)
CREATE TABLE IF NOT EXISTS telegram_links (
  phone TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  tg_user_id INTEGER NOT NULL,
  first_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Запросы на вход через Telegram
CREATE TABLE IF NOT EXISTS tg_logins (
  token TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | used
  chat_id INTEGER,
  phone TEXT,
  first_name TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Демо-аккаунты при первом запуске
function seed() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;
  const ins = db.prepare(`INSERT INTO users (role,name,phone,shop_name,pickup_address,password_hash) VALUES (?,?,?,?,?,?)`);
  const demo = [
    ['admin', 'Администратор', '77000000001', null, null, 'admin123'],
    ['support', 'Айгерим (поддержка)', '77000000002', null, null, 'support123'],
    ['courier', 'Ерлан (курьер)', '77000000003', null, null, 'courier123'],
    ['seller', 'Дана', '77000000004', 'Dana Flowers', 'пр. Мангилик Ел, 55', 'seller123'],
    ['client', 'Асель', '77000000005', null, null, 'client123'],
  ];
  for (const [role, name, phone, shop, addr, pw] of demo) ins.run(role, name, phone, shop, addr, hashPassword(pw));
  console.log('Созданы демо-аккаунты (телефон / пароль):');
  for (const d of demo) console.log(`  ${d[0].padEnd(8)} ${d[2]} / ${d[5]}`);
}
seed();

module.exports = { db, hashPassword, checkPassword, tx };
