const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const cfg = require('./config');
const { db, hashPassword, checkPassword, tx } = require('./db');
const payments = require('./payments');
const sms = require('./sms');

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY); // за nginx: TRUST_PROXY=1
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { // CORS для мобильного приложения
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  if (!/^7\d{10}$/.test(d)) fail(400, 'Введите телефон в формате +7 7XX XXX XX XX');
  return d;
}
const str = (v, name, max = 300) => {
  const s = String(v ?? '').trim();
  if (!s) fail(400, `Заполните поле «${name}»`);
  if (s.length > max) fail(400, `Поле «${name}» слишком длинное`);
  return s;
};
const randCode = (len) => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(len), (b) => abc[b % abc.length]).join('');
};
// Простой счётчик попыток в памяти: не больше max событий за windowMs на ключ
const hits = new Map();
function limit(key, max, windowMs, msg = 'Слишком много попыток, попробуйте позже', { record = true } = {}) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) fail(429, msg);
  if (record) { arr.push(now); hits.set(key, arr); }
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();
const publicUser = (u) => u && ({ id: u.id, role: u.role, name: u.name, phone: u.phone, shop_name: u.shop_name, pickup_address: u.pickup_address, active: !!u.active, created_at: u.created_at });

function logEvent(orderId, status, note, actorId) {
  db.prepare('INSERT INTO order_events (order_id,status,note,actor_id) VALUES (?,?,?,?)').run(orderId, status, note || null, actorId || null);
}
function setStatus(order, status, note, actorId, extra = {}) {
  const sets = ['status = ?', "updated_at = datetime('now')"];
  const vals = [status];
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = ?`); vals.push(v); }
  if (status === 'delivered') sets.push("delivered_at = datetime('now')");
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals, order.id);
  logEvent(order.id, status, note, actorId);
  statusSms(order.id, status);
}

// SMS покупателю и продавцу о смене статуса. Отправляется после ответа API;
// если транзакция откатилась (статус в базе другой) — ничего не уходит.
function statusSms(orderId, status) {
  setImmediate(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!o || o.status !== status) return;
    const seller = db.prepare('SELECT phone, shop_name, name FROM users WHERE id = ?').get(o.seller_id);
    const courier = o.courier_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(o.courier_id) : null;
    const link = `${cfg.PUBLIC_URL}/t/${o.code}`;
    const shop = seller.shop_name || seller.name;
    const pay = o.buyer_paid ? '' : ` Оплата доставки ${cfg.PRICE_BUYER} тг онлайн или курьеру.`;
    const msg = {
      ready: [[o.buyer_phone, `${shop}: заказ «${o.item_desc}» доставит Жеткіз 750.${pay} Статус: ${link}`]],
      assigned: [[seller.phone, `Курьер ${courier?.name || ''} едет за заказом ${o.code} (${o.buyer_name}).`]],
      picked_up: [[o.buyer_phone, `Курьер ${courier?.name || ''} везёт ваш заказ. Код получения: ${o.confirm_code} — назовите его курьеру. ${link}`]],
      delivered: [[seller.phone, `Заказ ${o.code} вручён покупателю ${o.buyer_name}.`]],
      cancelled: [[o.buyer_phone, `Доставка заказа ${o.code} от ${shop} отменена.`], [seller.phone, `Заказ ${o.code} отменён.`]],
    }[status] || [];
    for (const [phone, text] of msg) sms.notify(phone, text);
  });
}
function getOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) fail(404, 'Заказ не найден');
  return o;
}
function fullOrder(o, { hideConfirm = true } = {}) {
  const seller = db.prepare('SELECT name, shop_name, phone FROM users WHERE id = ?').get(o.seller_id);
  const courier = o.courier_id ? db.prepare('SELECT name, phone FROM users WHERE id = ?').get(o.courier_id) : null;
  const events = db.prepare('SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id').all(o.id);
  const r = { ...o, seller_paid: !!o.seller_paid, buyer_paid: !!o.buyer_paid, status_text: cfg.STATUSES[o.status], seller, courier, events };
  if (hideConfirm) delete r.confirm_code;
  return r;
}

async function pay(order, payer, method, actorId) {
  const field = payer === 'seller' ? 'seller_paid' : 'buyer_paid';
  if (order[field]) fail(400, 'Уже оплачено');
  if (order.status === 'cancelled') fail(400, 'Заказ отменён');
  const amount = payer === 'seller' ? cfg.PRICE_SELLER : cfg.PRICE_BUYER;
  let ref = null;
  if (method === 'online') {
    const r = await payments.charge({ orderCode: order.code, payer, amount });
    if (!r.ok) fail(402, 'Платёж не прошёл');
    ref = r.provider_ref;
  }
  tx(() => {
    db.prepare('INSERT INTO payments (order_id,payer,amount,method,status,provider_ref) VALUES (?,?,?,?,?,?)').run(order.id, payer, amount, method, 'paid', ref);
    db.prepare(`UPDATE orders SET ${field} = 1, updated_at = datetime('now') WHERE id = ?`).run(order.id);
    const who = payer === 'seller' ? 'Продавец' : 'Покупатель';
    if (payer === 'seller' && order.status === 'new') setStatus(order, 'ready', `${who} оплатил ${amount} ₸`, actorId);
    else logEvent(order.id, order.status, `${who} оплатил ${amount} ₸${method === 'cash' ? ' (наличными курьеру)' : ''}`, actorId);
  });
}

async function cancelOrder(order, reason, actorId) {
  if (['delivered', 'cancelled'].includes(order.status)) fail(400, 'Заказ нельзя отменить');
  const paid = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'paid'").all(order.id);
  for (const p of paid) if (p.method === 'online') await payments.refund(p);
  tx(() => {
    db.prepare("UPDATE payments SET status = 'refunded' WHERE order_id = ? AND status = 'paid'").run(order.id);
    setStatus(order, 'cancelled', (reason || 'Заказ отменён') + (paid.length ? ', оплата возвращена' : ''), actorId);
  });
}

// ---------- auth ----------
function auth(...roles) {
  return (req, res, next) => {
    const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const row = token && db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
    if (!row) return res.status(401).json({ error: 'Требуется вход' });
    if (!row.active) return res.status(403).json({ error: 'Аккаунт заблокирован' });
    if (roles.length && !roles.includes(row.role)) return res.status(403).json({ error: 'Нет доступа' });
    req.user = row; req.token = token;
    next();
  };
}
function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, userId);
  return token;
}

const api = express.Router();

api.get('/config', (req, res) => res.json({
  city: cfg.CITY, price_seller: cfg.PRICE_SELLER, price_buyer: cfg.PRICE_BUYER,
  price_total: cfg.PRICE_SELLER + cfg.PRICE_BUYER, max_weight_kg: cfg.MAX_WEIGHT_KG,
  districts: cfg.DISTRICTS, statuses: cfg.STATUSES, payment_mode: payments.MODE, sms_mode: sms.MODE,
}));

// Создаёт продавца или покупателя. password === null — аккаунт только для входа по SMS.
function createAccount(b, phone, password) {
  const role = b.role === 'seller' ? 'seller' : 'client';
  const name = str(b.name, 'Имя', 100);
  if (password !== null && String(password || '').length < 6) fail(400, 'Пароль — минимум 6 символов');
  const shop = role === 'seller' ? str(b.shop_name, 'Название магазина', 100) : null;
  const pickup = role === 'seller' ? str(b.pickup_address, 'Адрес забора товара') : null;
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) fail(409, 'Этот телефон уже зарегистрирован');
  const pw = password === null ? crypto.randomBytes(24).toString('hex') : String(password);
  const r = db.prepare('INSERT INTO users (role,name,phone,shop_name,pickup_address,password_hash) VALUES (?,?,?,?,?,?)')
    .run(role, name, phone, shop, pickup, hashPassword(pw));
  return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
}

api.post('/auth/register', (req, res) => {
  const b = req.body || {};
  const user = createAccount(b, normPhone(b.phone), b.password);
  res.status(201).json({ token: newSession(user.id), user: publicUser(user) });
});

// ---------- вход по SMS-коду ----------
const otpHash = (phone, code) => crypto.createHash('sha256').update(`${phone}:${code}:${cfg.OTP_SECRET}`).digest('hex');

api.post('/auth/otp/request', async (req, res) => {
  const phone = normPhone(req.body?.phone);
  limit('otp-ip:' + req.ip, 20, 3600e3);
  const last = db.prepare("SELECT (julianday('now') - julianday(created_at)) * 86400 AS ago FROM otp_codes WHERE phone = ? ORDER BY id DESC LIMIT 1").get(phone);
  if (last && last.ago < cfg.OTP_RESEND_SEC) fail(429, `Повторно отправить код можно через ${Math.ceil(cfg.OTP_RESEND_SEC - last.ago)} сек.`);
  const { n } = db.prepare("SELECT COUNT(*) n FROM otp_codes WHERE phone = ? AND created_at > datetime('now','-1 hour')").get(phone);
  if (n >= 5) fail(429, 'Слишком много запросов кода. Попробуйте через час.');
  const user = db.prepare('SELECT active FROM users WHERE phone = ?').get(phone);
  if (user && !user.active) fail(403, 'Аккаунт заблокирован');
  const code = String(crypto.randomInt(0, 10 ** cfg.OTP_LENGTH)).padStart(cfg.OTP_LENGTH, '0');
  db.prepare("UPDATE otp_codes SET used = 1 WHERE phone = ? AND used = 0").run(phone);
  db.prepare(`INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES (?,?,datetime('now','+${cfg.OTP_TTL_MIN} minutes'))`).run(phone, otpHash(phone, code));
  await sms.send(phone, `Жеткіз 750: код входа ${code}. Никому его не сообщайте.`, { kind: 'otp', throwOnError: true })
    .catch(() => fail(502, 'Не удалось отправить SMS. Попробуйте позже.'));
  const r = { ok: true, registered: !!user, resend_sec: cfg.OTP_RESEND_SEC };
  if (sms.MODE === 'mock' && process.env.NODE_ENV !== 'production') r.dev_code = code; // только для тестового режима
  res.json(r);
});

// Проверка кода. Если номер новый — нужны данные профиля (name, role, для продавца shop_name и pickup_address);
// без них ответ { need_profile: true }, код при этом не тратится.
api.post('/auth/otp/verify', (req, res) => {
  const b = req.body || {};
  const phone = normPhone(b.phone);
  const otp = db.prepare("SELECT * FROM otp_codes WHERE phone = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1").get(phone);
  if (!otp) fail(400, 'Код устарел — запросите новый');
  if (otp.attempts >= cfg.OTP_MAX_ATTEMPTS) fail(429, 'Слишком много неверных попыток — запросите новый код');
  const ok = crypto.timingSafeEqual(Buffer.from(otpHash(phone, String(b.code || '').trim())), Buffer.from(otp.code_hash));
  if (!ok) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otp.id);
    fail(400, 'Неверный код');
  }
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  const isNew = !user;
  if (isNew) {
    if (!b.name) return res.json({ need_profile: true });
    user = createAccount(b, phone, null);
  }
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otp.id);
  if (!user.active) fail(403, 'Аккаунт заблокирован');
  res.status(isNew ? 201 : 200).json({ token: newSession(user.id), user: publicUser(user) });
});

api.post('/auth/login', (req, res) => {
  const phone = normPhone(req.body?.phone);
  const lim = (record) => limit('login:' + phone, 10, 900e3, 'Слишком много попыток входа. Подождите 15 минут или войдите по SMS-коду.', { record });
  lim(false);
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user || !checkPassword(String(req.body?.password || ''), user.password_hash)) { lim(true); fail(401, 'Неверный телефон или пароль'); }
  if (!user.active) fail(403, 'Аккаунт заблокирован');
  res.json({ token: newSession(user.id), user: publicUser(user) });
});

api.post('/auth/logout', auth(), (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

api.get('/me', auth(), (req, res) => res.json({ user: publicUser(req.user) }));

api.patch('/me', auth(), (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const name = b.name !== undefined ? str(b.name, 'Имя', 100) : u.name;
  const shop = u.role === 'seller' && b.shop_name !== undefined ? str(b.shop_name, 'Название магазина', 100) : u.shop_name;
  const pickup = u.role === 'seller' && b.pickup_address !== undefined ? str(b.pickup_address, 'Адрес забора') : u.pickup_address;
  db.prepare('UPDATE users SET name=?, shop_name=?, pickup_address=? WHERE id=?').run(name, shop, pickup, u.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

// ---------- публичное отслеживание (ссылка для покупателя) ----------
function byCode(code) {
  const o = db.prepare('SELECT * FROM orders WHERE code = ?').get(String(code || '').toUpperCase());
  if (!o) fail(404, 'Заказ не найден. Проверьте код.');
  return o;
}
api.get('/track/:code', (req, res) => {
  const o = fullOrder(byCode(req.params.code), { hideConfirm: false });
  // Покупатель видит код подтверждения — его он называет курьеру при получении
  delete o.seller.phone;
  res.json({ order: o, price_buyer: cfg.PRICE_BUYER });
});
api.post('/track/:code/pay', async (req, res) => {
  const o = byCode(req.params.code);
  await pay(o, 'buyer', 'online', null);
  res.json({ ok: true });
});

// ---------- продавец ----------
api.get('/seller/orders', auth('seller'), (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE seller_id = ? ORDER BY id DESC LIMIT 500').all(req.user.id);
  res.json({ orders: rows.map((o) => fullOrder(o)) });
});
api.get('/seller/stats', auth('seller'), (req, res) => {
  const s = db.prepare(`SELECT COUNT(*) total,
      SUM(status='delivered') delivered, SUM(status IN ('new','ready','assigned','picked_up')) active,
      COALESCE((SELECT SUM(amount) FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.seller_id=? AND p.payer='seller' AND p.status='paid'),0) spent
    FROM orders WHERE seller_id = ?`).get(req.user.id, req.user.id);
  res.json(s);
});
api.post('/seller/orders', auth('seller'), async (req, res) => {
  const b = req.body || {};
  const weight = Number(b.weight_kg);
  if (!(weight > 0)) fail(400, 'Укажите вес посылки');
  if (weight > cfg.MAX_WEIGHT_KG) fail(400, `Мы доставляем посылки до ${cfg.MAX_WEIGHT_KG} кг`);
  if (!cfg.DISTRICTS.includes(b.district)) fail(400, `Выберите район ${cfg.CITY}`);
  const data = {
    pickup: str(b.pickup_address || req.user.pickup_address, 'Адрес забора'),
    buyer_name: str(b.buyer_name, 'Имя покупателя', 100),
    buyer_phone: normPhone(b.buyer_phone),
    address: str(b.address, 'Адрес доставки'),
    item: str(b.item_desc, 'Что везём', 200),
    comment: String(b.comment || '').trim().slice(0, 500) || null,
  };
  let code; do { code = randCode(8); } while (db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code));
  const confirm = String(crypto.randomInt(1000, 10000));
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO orders (code,seller_id,pickup_address,buyer_name,buyer_phone,address,district,item_desc,weight_kg,comment,confirm_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(code, req.user.id, data.pickup, data.buyer_name, data.buyer_phone, data.address, b.district, data.item, weight, data.comment, confirm);
    logEvent(r.lastInsertRowid, 'new', 'Заказ создан', req.user.id);
    return r.lastInsertRowid;
  });
  if (b.pay_now) await pay(getOrder(id), 'seller', 'online', req.user.id);
  res.status(201).json({ order: fullOrder(getOrder(id)) });
});
function ownOrder(req) {
  const o = getOrder(req.params.id);
  if (o.seller_id !== req.user.id) fail(404, 'Заказ не найден');
  return o;
}
api.post('/seller/orders/:id/pay', auth('seller'), async (req, res) => {
  await pay(ownOrder(req), 'seller', 'online', req.user.id);
  res.json({ order: fullOrder(getOrder(req.params.id)) });
});
api.post('/seller/orders/:id/cancel', auth('seller'), async (req, res) => {
  const o = ownOrder(req);
  if (!['new', 'ready'].includes(o.status)) fail(400, 'Курьер уже назначен — отмена через поддержку');
  await cancelOrder(o, 'Отменён продавцом', req.user.id);
  res.json({ order: fullOrder(getOrder(o.id)) });
});

// ---------- покупатель (клиент) ----------
api.get('/client/orders', auth('client'), (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE buyer_phone = ? ORDER BY id DESC LIMIT 200').all(req.user.phone);
  res.json({ orders: rows.map((o) => fullOrder(o, { hideConfirm: false })) });
});

// ---------- курьер ----------
api.get('/courier/orders', auth('courier'), (req, res) => {
  const available = db.prepare("SELECT * FROM orders WHERE status = 'ready' AND courier_id IS NULL ORDER BY id").all();
  const mine = db.prepare("SELECT * FROM orders WHERE courier_id = ? AND status IN ('assigned','picked_up') ORDER BY id").all(req.user.id);
  const done = db.prepare("SELECT * FROM orders WHERE courier_id = ? AND status = 'delivered' ORDER BY delivered_at DESC LIMIT 50").all(req.user.id);
  const sellerPhone = (o) => ({ ...fullOrder(o), seller_phone: db.prepare('SELECT phone FROM users WHERE id=?').get(o.seller_id).phone });
  res.json({ available: available.map((o) => fullOrder(o)), mine: mine.map(sellerPhone), done: done.map((o) => fullOrder(o)) });
});
function courierOrder(req, statuses) {
  const o = getOrder(req.params.id);
  if (o.courier_id !== req.user.id) fail(403, 'Это не ваш заказ');
  if (!statuses.includes(o.status)) fail(400, 'Неверный статус заказа');
  return o;
}
api.post('/courier/orders/:id/take', auth('courier'), (req, res) => {
  const r = db.prepare("UPDATE orders SET courier_id = ?, status = 'assigned', updated_at = datetime('now') WHERE id = ? AND status = 'ready' AND courier_id IS NULL").run(req.user.id, req.params.id);
  if (!r.changes) fail(409, 'Заказ уже взят другим курьером');
  logEvent(Number(req.params.id), 'assigned', `Курьер: ${req.user.name}`, req.user.id);
  statusSms(Number(req.params.id), 'assigned');
  res.json({ ok: true });
});
api.post('/courier/orders/:id/pickup', auth('courier'), (req, res) => {
  const o = courierOrder(req, ['assigned']);
  setStatus(o, 'picked_up', 'Курьер забрал посылку у продавца', req.user.id);
  res.json({ ok: true });
});
api.post('/courier/orders/:id/deliver', auth('courier'), async (req, res) => {
  const o = courierOrder(req, ['picked_up']);
  if (String(req.body?.confirm_code || '').trim() !== o.confirm_code) fail(400, 'Неверный код подтверждения от покупателя');
  if (!o.buyer_paid) {
    if (!req.body?.cash_received) fail(400, `Покупатель не оплатил онлайн — получите ${cfg.PRICE_BUYER} ₸ наличными`);
    await pay(o, 'buyer', 'cash', req.user.id);
  }
  setStatus(getOrder(o.id), 'delivered', 'Посылка вручена покупателю', req.user.id);
  res.json({ ok: true });
});

// ---------- управление (админ) ----------
api.get('/admin/stats', auth('admin', 'support'), (req, res) => {
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
  const revenue = q("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='paid'").v;
  const revenueToday = q("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='paid' AND date(created_at)=date('now')").v;
  const ordersToday = q("SELECT COUNT(*) v FROM orders WHERE date(created_at)=date('now')").v;
  const deliveredToday = q("SELECT COUNT(*) v FROM orders WHERE status='delivered' AND date(delivered_at)=date('now')").v;
  const users = Object.fromEntries(db.prepare('SELECT role, COUNT(*) n FROM users GROUP BY role').all().map((r) => [r.role, r.n]));
  const openTickets = q("SELECT COUNT(*) v FROM tickets WHERE status != 'closed'").v;
  const cash = q("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='paid' AND method='cash'").v;
  const daily = db.prepare(`SELECT date(created_at) day, SUM(amount) revenue, COUNT(DISTINCT order_id) orders FROM payments
    WHERE status='paid' AND created_at >= date('now','-13 days') GROUP BY day ORDER BY day`).all();
  res.json({ byStatus, revenue, revenueToday, ordersToday, deliveredToday, users, openTickets, cash, daily });
});
api.get('/admin/orders', auth('admin', 'support'), (req, res) => {
  const where = []; const args = [];
  if (req.query.status) { where.push('status = ?'); args.push(req.query.status); }
  if (req.query.q) {
    const q = String(req.query.q).trim();
    where.push('(code LIKE ? OR buyer_phone LIKE ? OR buyer_name LIKE ? OR address LIKE ?)');
    const like = `%${q.replace(/^\+/, '')}%`; args.push(like.toUpperCase(), like, like, like);
  }
  const rows = db.prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`).all(...args);
  res.json({ orders: rows.map((o) => fullOrder(o)) });
});
api.post('/admin/orders/:id/assign', auth('admin'), (req, res) => {
  const o = getOrder(req.params.id);
  if (!['ready', 'assigned'].includes(o.status)) fail(400, 'Назначить курьера можно только оплаченному заказу');
  const c = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'courier' AND active = 1").get(req.body?.courier_id);
  if (!c) fail(400, 'Курьер не найден');
  setStatus(o, 'assigned', `Назначен курьер: ${c.name}`, req.user.id, { courier_id: c.id });
  res.json({ ok: true });
});
api.post('/admin/orders/:id/cancel', auth('admin'), async (req, res) => {
  await cancelOrder(getOrder(req.params.id), req.body?.reason ? `Отменён администратором: ${req.body.reason}` : 'Отменён администратором', req.user.id);
  res.json({ ok: true });
});
api.get('/admin/users', auth('admin'), (req, res) => {
  const rows = req.query.role
    ? db.prepare('SELECT * FROM users WHERE role = ? ORDER BY id DESC').all(req.query.role)
    : db.prepare('SELECT * FROM users ORDER BY id DESC').all();
  res.json({ users: rows.map(publicUser) });
});
api.get('/admin/notifications', auth('admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 200').all();
  res.json({ notifications: rows, sms_mode: sms.MODE });
});
api.get('/admin/couriers', auth('admin'), (req, res) => {
  const rows = db.prepare(`SELECT u.id, u.name, u.phone, u.active,
      (SELECT COUNT(*) FROM orders o WHERE o.courier_id=u.id AND o.status IN ('assigned','picked_up')) active_orders,
      (SELECT COUNT(*) FROM orders o WHERE o.courier_id=u.id AND o.status='delivered') delivered
    FROM users u WHERE role='courier' ORDER BY u.name`).all();
  res.json({ couriers: rows });
});
api.post('/admin/users', auth('admin'), (req, res) => {
  const b = req.body || {};
  if (!['courier', 'support', 'admin', 'seller'].includes(b.role)) fail(400, 'Неверная роль');
  const phone = normPhone(b.phone);
  if (String(b.password || '').length < 6) fail(400, 'Пароль — минимум 6 символов');
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) fail(409, 'Телефон уже зарегистрирован');
  const r = db.prepare('INSERT INTO users (role,name,phone,shop_name,pickup_address,password_hash) VALUES (?,?,?,?,?,?)')
    .run(b.role, str(b.name, 'Имя', 100), phone, b.shop_name || null, b.pickup_address || null, hashPassword(String(b.password)));
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
});
api.patch('/admin/users/:id', auth('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) fail(404, 'Пользователь не найден');
  if (u.id === req.user.id) fail(400, 'Нельзя изменить свой аккаунт');
  if (req.body?.active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, u.id);
    if (!req.body.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

// ---------- техподдержка ----------
const staff = (u) => u && ['support', 'admin'].includes(u.role);
function optionalAuth(req, res, next) {
  const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  req.user = token ? db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1').get(token) : null;
  next();
}
api.post('/tickets', optionalAuth, (req, res) => {
  const b = req.body || {};
  const subject = str(b.subject, 'Тема', 150);
  const body = str(b.message, 'Сообщение', 3000);
  let orderId = null;
  if (b.order_code) orderId = byCode(b.order_code).id;
  const u = req.user;
  const contactName = u ? u.name : str(b.contact_name, 'Имя', 100);
  const contactPhone = u ? u.phone : normPhone(b.contact_phone);
  const id = tx(() => {
    const r = db.prepare('INSERT INTO tickets (user_id,order_id,contact_name,contact_phone,subject) VALUES (?,?,?,?,?)').run(u?.id ?? null, orderId, contactName, contactPhone, subject);
    db.prepare('INSERT INTO ticket_messages (ticket_id,author_id,author_role,author_name,body) VALUES (?,?,?,?,?)').run(r.lastInsertRowid, u?.id ?? null, u?.role || 'guest', contactName, body);
    return r.lastInsertRowid;
  });
  res.status(201).json({ ticket: { id } });
});
const ticketList = (where, ...args) => db.prepare(`SELECT t.*, o.code order_code,
    (SELECT body FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) last_message,
    (SELECT author_role FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) last_role
  FROM tickets t LEFT JOIN orders o ON o.id=t.order_id ${where} ORDER BY (t.status='closed'), t.updated_at DESC LIMIT 300`).all(...args);
api.get('/tickets', auth(), (req, res) => {
  if (staff(req.user)) {
    const st = req.query.status;
    return res.json({ tickets: st ? ticketList('WHERE t.status = ?', st) : ticketList('') });
  }
  res.json({ tickets: ticketList('WHERE t.user_id = ?', req.user.id) });
});
function getTicket(req) {
  const t = db.prepare('SELECT t.*, o.code order_code FROM tickets t LEFT JOIN orders o ON o.id=t.order_id WHERE t.id = ?').get(req.params.id);
  if (!t || (!staff(req.user) && t.user_id !== req.user.id)) fail(404, 'Обращение не найдено');
  return t;
}
api.get('/tickets/:id', auth(), (req, res) => {
  const t = getTicket(req);
  const messages = db.prepare('SELECT author_role, author_name, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id').all(t.id);
  const order = t.order_id && staff(req.user) ? fullOrder(getOrder(t.order_id)) : null;
  res.json({ ticket: t, messages, order });
});
api.post('/tickets/:id/messages', auth(), (req, res) => {
  const t = getTicket(req);
  const body = str(req.body?.message, 'Сообщение', 3000);
  const status = staff(req.user) ? 'answered' : 'open';
  tx(() => {
    db.prepare('INSERT INTO ticket_messages (ticket_id,author_id,author_role,author_name,body) VALUES (?,?,?,?,?)').run(t.id, req.user.id, req.user.role, req.user.name, body);
    db.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, t.id);
  });
  res.json({ ok: true });
});
api.post('/tickets/:id/close', auth(), (req, res) => {
  const t = getTicket(req);
  db.prepare("UPDATE tickets SET status = 'closed', updated_at = datetime('now') WHERE id = ?").run(t.id);
  res.json({ ok: true });
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));

// ---------- сайт ----------
const WEB = path.join(__dirname, '..', 'web');
app.use(express.static(WEB, { extensions: ['html'] }));
app.get('/t/:code', (req, res) => res.sendFile(path.join(WEB, 'track.html')));

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Ошибка сервера' : err.message });
});

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && cfg.OTP_SECRET === 'dev-otp-secret') console.warn('ВНИМАНИЕ: задайте OTP_SECRET — случайную строку для защиты SMS-кодов');
  if (sms.MODE === 'mock') console.log('SMS в тестовом режиме: сообщения пишутся в консоль и в журнал (Админ → SMS)');
  app.listen(cfg.PORT, () => console.log(`Жеткіз 750 запущен: http://localhost:${cfg.PORT}`));
}
module.exports = app;
