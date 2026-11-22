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
  status TEXT NOT NULL,          -- pending | paid | failed | refunded
  provider_ref TEXT,
  invoice TEXT UNIQUE,           -- номер счёта у платёжного провайдера
  collected_by INTEGER REFERENCES users(id), -- наличные: какой курьер получил деньги
  handover_id INTEGER REFERENCES cash_handovers(id), -- наличные: когда курьер сдал их в кассу
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Сдача наличных курьером в кассу
CREATE TABLE IF NOT EXISTS cash_handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  courier_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  admin_id INTEGER NOT NULL REFERENCES users(id),
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

-- Одноразовые коды входа по SMS (хранится только хэш кода)
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, id);

-- Устройства с мобильным приложением (push-уведомления Expo)
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_tokens(user_id);

-- Журнал отправленных SMS и push
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  kind TEXT NOT NULL,            -- otp | status | push
  text TEXT NOT NULL,
  status TEXT NOT NULL,          -- mock | sent | failed
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Миграции для баз, созданных предыдущими версиями
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('payments').includes('invoice')) {
  db.exec('ALTER TABLE payments ADD COLUMN invoice TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice)');
}
if (!cols('payments').includes('collected_by')) {
  db.exec('ALTER TABLE payments ADD COLUMN collected_by INTEGER REFERENCES users(id)');
  db.exec('ALTER TABLE payments ADD COLUMN handover_id INTEGER REFERENCES cash_handovers(id)');
  // Наличные, полученные до этой версии, считаем у курьера заказа
  db.exec("UPDATE payments SET collected_by = (SELECT courier_id FROM orders WHERE orders.id = payments.order_id) WHERE method = 'cash'");
}
db.exec('CREATE INDEX IF NOT EXISTS idx_payments_cash ON payments(collected_by, handover_id)');

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

// Демо-аккаунты при первом запуске — только для разработки и демо.
// На рабочем сервере (NODE_ENV=production) их нет: первого админа создаёт команда
//   npm run create-admin
// SEED_DEMO=1 включает демо-аккаунты принудительно, SEED_DEMO=0 — отключает.
function seed() {
  const want = process.env.SEED_DEMO ? process.env.SEED_DEMO === '1' : process.env.NODE_ENV !== 'production';
  if (!want) return;
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

// Предупреждение, если на рабочем сервере остался демо-админ с известным паролем
if (process.env.NODE_ENV === 'production') {
  const a = db.prepare("SELECT password_hash FROM users WHERE phone = '77000000001' AND active = 1").get();
  if (a && checkPassword('admin123', a.password_hash)) console.warn('ВНИМАНИЕ: активен демо-админ 77000000001 с паролем admin123 — заблокируйте его или смените пароль');
}

module.exports = { db, hashPassword, checkPassword, tx };
