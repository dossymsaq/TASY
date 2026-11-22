const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const cfg = require('./config');
const { db, hashPassword, checkPassword, tx } = require('./db');
const payments = require('./payments');
const sms = require('./sms');
const push = require('./push');

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
const publicUser = (u) => u && ({ id: u.id, role: u.role, name: u.name, phone: u.phone, shop_name: u.shop_name, pickup_address: u.pickup_address, active: !!u.active, approved: !!u.approved, created_at: u.created_at });

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
  statusSms(order.id, status, actorId);
}

// Уведомить человека: push, если у него установлено приложение.
// SMS о статусах заказа отключены по умолчанию; SMS_STATUS=1 включает их для тех, у кого нет приложения.
async function notifyPerson(phone, { title, body, smsText, data = {} }) {
  const u = db.prepare('SELECT id FROM users WHERE phone = ? AND active = 1').get(phone);
  const pushed = u ? await push.sendToUsers([u.id], { title, body, data }, phone) : 0;
  if (smsText && cfg.SMS_STATUS && !pushed) sms.notify(phone, smsText);
}
const activeIds = (role) => db.prepare('SELECT id FROM users WHERE role = ? AND active = 1').all(role).map((r) => r.id);

// Уведомления о смене статуса заказа. Отправляются после ответа API;
// если транзакция откатилась (статус в базе другой) — ничего не уходит.
function statusSms(orderId, status, actorId = null) {
  setImmediate(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!o || o.status !== status) return;
    const seller = db.prepare('SELECT phone, shop_name, name FROM users WHERE id = ?').get(o.seller_id);
    const courier = o.courier_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(o.courier_id) : null;
    const link = `${cfg.PUBLIC_URL}/t/${o.code}`;
    const shop = seller.shop_name || seller.name;
    const pay = o.buyer_paid ? '' : ` Оплата доставки ${cfg.PRICE_BUYER} тг онлайн или курьеру.`;
    const toBuyer = (x) => notifyPerson(o.buyer_phone, { ...x, data: { order_code: o.code, tab: 'orders' } });
    const toSeller = (x) => notifyPerson(seller.phone, { ...x, data: { order_code: o.code, tab: 'orders' } });
    const toCourier = (x) => o.courier_id && o.courier_id !== actorId && push.sendToUsers([o.courier_id], { ...x, data: { order_code: o.code, tab: 'mine' } }, 'курьер');
    const jobs = {
      ready: () => {
        toBuyer({ title: `Посылка от ${shop}`, body: `«${o.item_desc}» скоро привезёт курьер.${pay}`, smsText: `${shop}: заказ «${o.item_desc}» доставит Жеткіз 750.${pay} Статус: ${link}` });
        push.sendToUsers(activeIds('courier'), { title: `Новый заказ · ${o.district}`, body: `${o.pickup_address} → ${o.address}, ${o.weight_kg} кг`, data: { order_code: o.code, tab: 'available' } }, 'курьеры');
      },
      assigned: () => {
        toSeller({ title: `Курьер едет за заказом ${o.code}`, body: `${courier?.name || 'Курьер'} заберёт посылку для ${o.buyer_name}.`, smsText: `Курьер ${courier?.name || ''} едет за заказом ${o.code} (${o.buyer_name}).` });
        toCourier({ title: `Вам назначен заказ ${o.code}`, body: `${o.pickup_address} → ${o.address}` });
      },
      picked_up: () => toBuyer({ title: 'Курьер везёт вашу посылку', body: `${courier?.name || 'Курьер'} уже в пути.`, smsText: `Курьер ${courier?.name || ''} везёт ваш заказ «${o.item_desc}». ${link}` }),
      delivered: () => toSeller({ title: `Заказ ${o.code} доставлен`, body: `Посылка вручена: ${o.buyer_name}.`, smsText: `Заказ ${o.code} вручён покупателю ${o.buyer_name}.` }),
      cancelled: () => {
        toBuyer({ title: 'Доставка отменена', body: `Заказ ${o.code} от ${shop} отменён.`, smsText: `Доставка заказа ${o.code} от ${shop} отменена.` });
        toSeller({ title: `Заказ ${o.code} отменён`, body: o.buyer_name, smsText: `Заказ ${o.code} отменён.` });
        toCourier({ title: `Заказ ${o.code} отменён`, body: 'Не забирайте и не везите эту посылку.' });
      },
    };
    Promise.resolve(jobs[status]?.()).catch((e) => console.error('Ошибка уведомления:', e.message));
  });
}
function getOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) fail(404, 'Заказ не найден');
  return o;
}
// confirm_code (старый код получения) больше не используется и наружу не отдаётся
function fullOrder(o) {
  const seller = db.prepare('SELECT name, shop_name, phone FROM users WHERE id = ?').get(o.seller_id);
  const courier = o.courier_id ? db.prepare('SELECT name, phone FROM users WHERE id = ?').get(o.courier_id) : null;
  const events = db.prepare('SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id').all(o.id);
  const r = { ...o, seller_paid: !!o.seller_paid, buyer_paid: !!o.buyer_paid, status_text: cfg.STATUSES[o.status], seller, courier, events };
  delete r.confirm_code;
  return r;
}

// ---------- оплата ----------
const paidField = (payer) => (payer === 'seller' ? 'seller_paid' : 'buyer_paid');
const priceOf = (payer) => (payer === 'seller' ? cfg.PRICE_SELLER : cfg.PRICE_BUYER);
const returnPath = (order, payer) => (payer === 'seller' ? `/app?paid=${order.code}` : `/t/${order.code}?paid=1`);

function checkPayable(order, payer) {
  if (order[paidField(payer)]) fail(400, 'Уже оплачено');
  if (order.status === 'cancelled') fail(400, 'Заказ отменён');
}
// Отмечает заказ оплаченным (вызывать внутри транзакции)
function applyPaid(order, payer, amount, method, actorId) {
  db.prepare(`UPDATE orders SET ${paidField(payer)} = 1, updated_at = datetime('now') WHERE id = ?`).run(order.id);
  const who = payer === 'seller' ? 'Продавец' : 'Покупатель';
  if (payer === 'seller' && order.status === 'new') setStatus(order, 'ready', `${who} оплатил ${amount} ₸`, actorId);
  else logEvent(order.id, order.status, `${who} оплатил ${amount} ₸${method === 'cash' ? ' (наличными курьеру)' : ''}`, actorId);
}

// Наличные курьеру — сразу считаются оплатой
function payCash(order, payer, actorId) {
  checkPayable(order, payer);
  const amount = priceOf(payer);
  tx(() => {
    db.prepare("INSERT INTO payments (order_id,payer,amount,method,status,collected_by) VALUES (?,?,?,'cash','paid',?)").run(order.id, payer, amount, actorId);
    applyPaid(order, payer, amount, 'cash', actorId);
  });
}

// Онлайн: создаём счёт у провайдера и возвращаем ссылку на страницу оплаты.
// Заказ станет оплаченным, когда провайдер пришлёт уведомление (handlePaymentCallback).
async function startOnlinePayment(order, payer) {
  checkPayable(order, payer);
  const amount = priceOf(payer);
  const invoice = `${order.code}-${payer === 'seller' ? 'S' : 'B'}-${randCode(6)}`;
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO payments (order_id,payer,amount,method,status,invoice) VALUES (?,?,?,'online','pending',?)").run(order.id, payer, amount, invoice);
  const back = cfg.PUBLIC_URL + returnPath(order, payer);
  try {
    const r = await payments.provider.createInvoice({
      invoice, amount, description: `Доставка ${order.code}, Жеткіз 750`,
      resultUrl: `${cfg.PUBLIC_URL}/api/payments/callback/${payments.MODE}`, successUrl: back, failureUrl: back,
      phone: payer === 'buyer' ? order.buyer_phone : undefined,
    });
    if (r.provider_ref) db.prepare('UPDATE payments SET provider_ref = ? WHERE id = ?').run(r.provider_ref, pid);
    return { pay_url: r.url, invoice };
  } catch (e) {
    console.error('Ошибка создания платежа:', e.message);
    db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(pid);
    fail(502, 'Платёжный сервис недоступен, попробуйте позже');
  }
}

// Уведомление от провайдера. Возвращает true, если уведомление принято.
async function handlePaymentCallback(cb) {
  if (cb.invalid) return false;
  const p = db.prepare('SELECT * FROM payments WHERE invoice = ?').get(cb.invoice);
  if (!p) return false;
  if (p.status !== 'pending') return p.status !== 'failed' || !cb.ok; // повторное уведомление — без изменений
  if (!cb.ok) { db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(p.id); return true; }
  if (cb.amount !== undefined && cb.amount !== p.amount) {
    console.error(`Сумма платежа ${p.invoice} не совпадает: ${cb.amount} вместо ${p.amount}`);
    db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(p.id);
    return false;
  }
  const order = getOrder(p.order_id);
  const ref = cb.provider_ref || p.provider_ref;
  if (order[paidField(p.payer)] || order.status === 'cancelled') {
    // Оплатили дважды (две вкладки) или заказ уже отменён — возвращаем деньги
    db.prepare("UPDATE payments SET status = 'paid', provider_ref = ? WHERE id = ?").run(ref, p.id);
    try {
      await payments.provider.refund({ provider_ref: ref, amount: p.amount });
      db.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(p.id);
      logEvent(order.id, order.status, `Лишняя оплата ${p.amount} ₸ возвращена`, null);
    } catch (e) { console.error('Не удалось вернуть лишнюю оплату', p.invoice, e.message); }
    return true;
  }
  tx(() => {
    db.prepare("UPDATE payments SET status = 'paid', provider_ref = ? WHERE id = ?").run(ref, p.id);
    applyPaid(order, p.payer, p.amount, 'online', null);
  });
  return true;
}

async function cancelOrder(order, reason, actorId) {
  if (['delivered', 'cancelled'].includes(order.status)) fail(400, 'Заказ нельзя отменить');
  const paid = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'paid'").all(order.id);
  for (const p of paid) {
    if (p.method !== 'online') continue;
    try { await payments.provider.refund({ provider_ref: p.provider_ref, amount: p.amount }); }
    catch (e) { console.error('Ошибка возврата', p.invoice, e.message); fail(502, 'Не удалось оформить возврат. Попробуйте позже или обратитесь в поддержку.'); }
    db.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(p.id);
  }
  tx(() => {
    db.prepare("UPDATE payments SET status = 'refunded' WHERE order_id = ? AND status = 'paid'").run(order.id);
    db.prepare("UPDATE payments SET status = 'failed' WHERE order_id = ? AND status = 'pending'").run(order.id);
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

// Проверка работоспособности для мониторинга (база отвечает)
api.get('/health', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });

api.get('/config', (req, res) => res.json({
  city: cfg.CITY, price_seller: cfg.PRICE_SELLER, price_buyer: cfg.PRICE_BUYER,
  price_total: cfg.PRICE_SELLER + cfg.PRICE_BUYER, max_weight_kg: cfg.MAX_WEIGHT_KG,
  districts: cfg.DISTRICTS, statuses: cfg.STATUSES, payment_mode: payments.MODE, sms_mode: sms.MODE,
  demo_hints: process.env.NODE_ENV !== 'production', // подсказки с демо-аккаунтами — не на рабочем сервере
  seller_signup: cfg.SELLER_SIGNUP,
  launch_mode: cfg.LAUNCH_MODE, online_payments: cfg.ONLINE_PAYMENTS, sms_login: cfg.SMS_LOGIN, client_accounts: cfg.SMS_LOGIN,
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
  const approved = role === 'seller' && cfg.SELLER_APPROVAL ? 0 : 1;
  const r = db.prepare('INSERT INTO users (role,name,phone,shop_name,pickup_address,password_hash,approved) VALUES (?,?,?,?,?,?,?)')
    .run(role, name, phone, shop, pickup, hashPassword(pw), approved);
  if (!approved) {
    push.sendToUsers(activeIds('admin'), { title: 'Новая заявка продавца', body: `${shop} · ${name}, +${phone}`, data: { tab: 'users' } }, 'владелец').catch(() => {});
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
}
// Продавец может оформлять заказы только после одобрения заявки владельцем
function approvedSeller(req, res, next) {
  if (!req.user.approved) return res.status(403).json({ error: 'Заявка на подключение ещё на рассмотрении. После подписания договора мы откроем доступ.' });
  next();
}

// Регистрация по паролю — только заявка продавца (номер проверит владелец при звонке).
// Клиенты регистрируются только по SMS-коду: иначе по чужому номеру можно было бы увидеть чужие посылки.
api.post('/auth/register', (req, res) => {
  const b = req.body || {};
  if (b.role !== 'seller') fail(400, 'Клиенты входят по SMS-коду');
  if (!cfg.SELLER_SIGNUP) fail(403, 'Аккаунты продавцов выдаёт владелец сервиса. Оставьте заявку «Подключить магазин» — мы позвоним.');
  const user = createAccount(b, normPhone(b.phone), b.password);
  res.status(201).json({ token: newSession(user.id), user: publicUser(user) });
});

// ---------- вход по SMS-коду ----------
const otpHash = (phone, code) => crypto.createHash('sha256').update(`${phone}:${code}:${cfg.OTP_SECRET}`).digest('hex');

const smsLoginOn = (req, res, next) => (cfg.SMS_LOGIN ? next() : res.status(403).json({ error: 'Вход по SMS пока недоступен — войдите по паролю' }));
api.post('/auth/otp/request', smsLoginOn, async (req, res) => {
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
api.post('/auth/otp/verify', smsLoginOn, (req, res) => {
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
    if (b.role === 'seller' && !cfg.SELLER_SIGNUP) fail(403, 'Этот номер не подключён. Аккаунты продавцов выдаёт владелец сервиса.');
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
  if (req.body?.push_token) push.removeToken(req.body.push_token); // на этом устройстве больше не присылать
  res.json({ ok: true });
});

// Регистрация устройства для push-уведомлений (вызывает мобильное приложение после входа)
api.post('/me/push-token', auth(), (req, res) => {
  if (!push.saveToken(req.user.id, req.body?.token, req.body?.platform)) fail(400, 'Неверный push-токен');
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

// Удаление аккаунта по просьбе пользователя (право из политики конфиденциальности).
// Запись не удаляется физически — на неё ссылаются заказы, которые закон требует хранить, —
// но имя, телефон и адрес стираются, вход становится невозможен, номер освобождается.
api.delete('/me', auth(), async (req, res) => {
  const u = req.user;
  if (!['seller', 'client'].includes(u.role)) fail(400, 'Аккаунт сотрудника удаляет администратор');
  if (String(req.body?.confirm || '') !== 'УДАЛИТЬ') fail(400, 'Подтвердите удаление');
  if (u.role === 'seller') {
    const { n } = db.prepare("SELECT COUNT(*) n FROM orders WHERE seller_id = ? AND status IN ('ready','assigned','picked_up')").get(u.id);
    if (n) fail(400, `У вас есть оплаченные заказы (${n}). Отмените их или дождитесь доставки.`);
    // Неоплаченные заказы отменяем (с возвратом, если покупатель уже успел заплатить)
    for (const o of db.prepare("SELECT * FROM orders WHERE seller_id = ? AND status = 'new'").all(u.id)) await cancelOrder(o, 'Отменён: продавец удалил аккаунт', u.id);
  }
  tx(() => {
    db.prepare(`UPDATE users SET name = 'Удалённый пользователь', phone = ?, pickup_address = NULL, active = 0,
      password_hash = ? WHERE id = ?`).run(`deleted-${u.id}`, hashPassword(crypto.randomBytes(24).toString('hex')), u.id);
    db.prepare("UPDATE tickets SET contact_name = 'Удалённый пользователь', contact_phone = NULL WHERE user_id = ?").run(u.id);
    db.prepare("UPDATE ticket_messages SET author_name = 'Удалённый пользователь' WHERE author_id = ?").run(u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM push_tokens WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(u.phone);
  });
  res.json({ ok: true });
});

// ---------- публичное отслеживание (ссылка для покупателя) ----------
function byCode(code) {
  const o = db.prepare('SELECT * FROM orders WHERE code = ?').get(String(code || '').toUpperCase());
  if (!o) fail(404, 'Заказ не найден. Проверьте код.');
  return o;
}
api.get('/track/:code', (req, res) => {
  const o = fullOrder(byCode(req.params.code));
  delete o.seller.phone;
  res.json({ order: o, price_buyer: cfg.PRICE_BUYER, online_payments: cfg.ONLINE_PAYMENTS });
});
const onlinePaymentsOn = (req, res, next) => (cfg.ONLINE_PAYMENTS ? next() : res.status(400).json({ error: 'Онлайн-оплата пока недоступна — оплатите доставку наличными курьеру' }));
api.post('/track/:code/pay', onlinePaymentsOn, async (req, res) => {
  limit('pay-ip:' + req.ip, 30, 3600e3);
  res.json(await startOnlinePayment(byCode(req.params.code), 'buyer'));
});

// Уведомления платёжного провайдера (адрес result_url)
api.all('/payments/callback/:provider', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
  if (req.params.provider !== payments.MODE) fail(404, 'Не найдено');
  let accepted = false;
  try { accepted = await handlePaymentCallback(payments.provider.parseCallback(req)); }
  catch (e) { console.error('Ошибка обработки уведомления об оплате:', e); }
  payments.provider.reply(res, accepted);
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
api.post('/seller/orders', auth('seller'), approvedSeller, async (req, res) => {
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
  // Без онлайн-оплаты заказ сразу уходит курьерам, продавец платит курьеру наличными при заборе
  if (!cfg.ONLINE_PAYMENTS) setStatus(getOrder(id), 'ready', `Оплата ${cfg.PRICE_SELLER} ₸ — наличными курьеру при заборе`, req.user.id);
  const payment = b.pay_now && cfg.ONLINE_PAYMENTS ? await startOnlinePayment(getOrder(id), 'seller') : {};
  res.status(201).json({ order: fullOrder(getOrder(id)), ...payment });
});
function ownOrder(req) {
  const o = getOrder(req.params.id);
  if (o.seller_id !== req.user.id) fail(404, 'Заказ не найден');
  return o;
}
api.post('/seller/orders/:id/pay', auth('seller'), approvedSeller, onlinePaymentsOn, async (req, res) => {
  res.json(await startOnlinePayment(ownOrder(req), 'seller'));
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
  res.json({ orders: rows.map((o) => fullOrder(o)) });
});

// ---------- курьер ----------
api.get('/courier/orders', auth('courier'), (req, res) => {
  const available = db.prepare("SELECT * FROM orders WHERE status = 'ready' AND courier_id IS NULL ORDER BY id").all();
  const mine = db.prepare("SELECT * FROM orders WHERE courier_id = ? AND status IN ('assigned','picked_up') ORDER BY id").all(req.user.id);
  const done = db.prepare("SELECT * FROM orders WHERE courier_id = ? AND status = 'delivered' ORDER BY delivered_at DESC LIMIT 50").all(req.user.id);
  const sellerPhone = (o) => ({ ...fullOrder(o), seller_phone: db.prepare('SELECT phone FROM users WHERE id=?').get(o.seller_id).phone });
  res.json({ available: available.map((o) => fullOrder(o)), mine: mine.map(sellerPhone), done: done.map((o) => fullOrder(o)) });
});
// ---------- наличные у курьеров ----------
// Наличные, которые курьер получил и ещё не сдал в кассу
const cashOnHand = (courierId) => db.prepare(`SELECT p.id, p.amount, p.created_at, o.code, o.buyer_name FROM payments p JOIN orders o ON o.id = p.order_id
  WHERE p.method = 'cash' AND p.status = 'paid' AND p.collected_by = ? AND p.handover_id IS NULL ORDER BY p.id`).all(courierId);
const handovers = (courierId, limit = 20) => db.prepare(`SELECT h.amount, h.created_at, a.name admin_name FROM cash_handovers h JOIN users a ON a.id = h.admin_id
  WHERE h.courier_id = ? ORDER BY h.id DESC LIMIT ?`).all(courierId, limit);
const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);

api.get('/courier/cash', auth('courier'), (req, res) => {
  const items = cashOnHand(req.user.id);
  res.json({ on_hand: sum(items), items, handovers: handovers(req.user.id, 10) });
});
api.get('/admin/cash', auth('admin'), (req, res) => {
  const couriers = db.prepare("SELECT id, name, phone, active FROM users WHERE role = 'courier' ORDER BY name").all().map((c) => {
    const items = cashOnHand(c.id);
    return { ...c, on_hand: sum(items), items, last_handover: handovers(c.id, 1)[0] || null };
  });
  res.json({ couriers, total_on_hand: sum(couriers.map((c) => ({ amount: c.on_hand }))) });
});
// Админ принял деньги у курьера. amount — сумма, которую админ видел на экране:
// если за это время курьер получил ещё наличные, сумма не совпадёт и придётся обновить страницу.
api.post('/admin/cash/:courierId/handover', auth('admin'), (req, res) => {
  const courier = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'courier'").get(req.params.courierId);
  if (!courier) fail(404, 'Курьер не найден');
  const result = tx(() => {
    const items = cashOnHand(courier.id);
    const total = sum(items);
    if (!total) fail(400, 'У курьера нет несданных наличных');
    if (Number(req.body?.amount) !== total) fail(409, `Сумма изменилась: сейчас у курьера ${total} ₸. Обновите страницу.`);
    const h = db.prepare('INSERT INTO cash_handovers (courier_id, amount, admin_id) VALUES (?,?,?)').run(courier.id, total, req.user.id);
    const mark = db.prepare('UPDATE payments SET handover_id = ? WHERE id = ?');
    for (const it of items) mark.run(h.lastInsertRowid, it.id);
    return { amount: total, orders: items.length };
  });
  res.json({ ok: true, ...result });
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
  statusSms(Number(req.params.id), 'assigned', req.user.id);
  res.json({ ok: true });
});
api.post('/courier/orders/:id/pickup', auth('courier'), (req, res) => {
  const o = courierOrder(req, ['assigned']);
  // Продавец не платил онлайн — курьер получает его 750 ₸ наличными при заборе
  if (!o.seller_paid) {
    if (!req.body?.seller_cash_received) fail(400, `Получите у продавца ${cfg.PRICE_SELLER} ₸ наличными`);
    payCash(o, 'seller', req.user.id);
  }
  setStatus(getOrder(o.id), 'picked_up', 'Курьер забрал посылку у продавца', req.user.id);
  res.json({ ok: true });
});
api.post('/courier/orders/:id/deliver', auth('courier'), async (req, res) => {
  const o = courierOrder(req, ['picked_up']);
  if (!o.buyer_paid) {
    if (!req.body?.cash_received) fail(400, `Покупатель не оплатил онлайн — получите ${cfg.PRICE_BUYER} ₸ наличными`);
    payCash(o, 'buyer', req.user.id);
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
  const pendingSellers = q("SELECT COUNT(*) v FROM users WHERE role = 'seller' AND approved = 0 AND active = 1").v;
  const cash = q("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='paid' AND method='cash'").v;
  const cashOnHands = q("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='paid' AND method='cash' AND handover_id IS NULL").v;
  const daily = db.prepare(`SELECT date(created_at) day, SUM(amount) revenue, COUNT(DISTINCT order_id) orders FROM payments
    WHERE status='paid' AND created_at >= date('now','-13 days') GROUP BY day ORDER BY day`).all();
  res.json({ byStatus, revenue, revenueToday, ordersToday, deliveredToday, users, openTickets, pendingSellers, cash, cashOnHands, daily });
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
      (SELECT COUNT(*) FROM orders o WHERE o.courier_id=u.id AND o.status='delivered') delivered,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.method='cash' AND p.status='paid' AND p.collected_by=u.id AND p.handover_id IS NULL) cash_on_hand
    FROM users u WHERE role='courier' ORDER BY u.name`).all();
  res.json({ couriers: rows });
});
api.post('/admin/users', auth('admin'), (req, res) => {
  const b = req.body || {};
  if (!['courier', 'support', 'admin', 'seller'].includes(b.role)) fail(400, 'Неверная роль');
  const phone = normPhone(b.phone);
  if (String(b.password || '').length < 6) fail(400, 'Пароль — минимум 6 символов');
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) fail(409, 'Телефон уже зарегистрирован');
  const shop = b.role === 'seller' ? str(b.shop_name, 'Название магазина', 100) : null;
  const pickup = b.role === 'seller' ? str(b.pickup_address, 'Адрес забора', 300) : null;
  const r = db.prepare('INSERT INTO users (role,name,phone,shop_name,pickup_address,password_hash) VALUES (?,?,?,?,?,?)')
    .run(b.role, str(b.name, 'Имя', 100), phone, shop, pickup, hashPassword(String(b.password)));
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
});
// Владелец одобряет заявку продавца (после подписания договора)
api.post('/admin/users/:id/approve', auth('admin'), (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'seller'").get(req.params.id);
  if (!u) fail(404, 'Продавец не найден');
  db.prepare('UPDATE users SET approved = 1 WHERE id = ?').run(u.id);
  notifyPerson(u.phone, { title: 'Заявка одобрена', body: 'Можно оформлять доставки в Жеткіз 750.', smsText: 'Жеткіз 750: ваша заявка одобрена, можно оформлять доставки.', data: { tab: 'new' } }).catch(() => {});
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});
api.patch('/admin/users/:id', auth('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) fail(404, 'Пользователь не найден');
  const b = req.body || {};
  // Новый пароль (владелец выдаёт или восстанавливает доступ). Все старые входы этого человека закрываются.
  if (b.password !== undefined) {
    if (String(b.password).length < 6) fail(400, 'Пароль — минимум 6 символов');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(b.password)), u.id);
    if (u.id !== req.user.id) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  if (b.name !== undefined || b.shop_name !== undefined || b.pickup_address !== undefined) {
    db.prepare('UPDATE users SET name = ?, shop_name = ?, pickup_address = ? WHERE id = ?').run(
      b.name !== undefined ? str(b.name, 'Имя', 100) : u.name,
      b.shop_name !== undefined ? (String(b.shop_name).trim() || null) : u.shop_name,
      b.pickup_address !== undefined ? (String(b.pickup_address).trim() || null) : u.pickup_address, u.id);
  }
  if (req.body?.active !== undefined) {
    if (u.id === req.user.id) fail(400, 'Нельзя заблокировать свой аккаунт');
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
  const staffIds = [...activeIds('support'), ...activeIds('admin')];
  push.sendToUsers(staffIds, { title: `Новое обращение: ${subject}`, body: `${contactName}: ${body.slice(0, 120)}`, data: { ticket_id: Number(id), tab: 'tickets' } }, 'поддержка').catch(() => {});
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
  if (staff(req.user) && t.user_id) {
    push.sendToUsers([t.user_id], { title: 'Ответ поддержки', body: body.slice(0, 150), data: { ticket_id: t.id, tab: 'support' } }, 'ответ поддержки').catch(() => {});
  }
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

// Тестовая страница оплаты (только PAYMENT_MODE=mock) — имитирует страницу банка
if (payments.MODE === 'mock') {
  app.get('/pay/mock/:invoice', (req, res) => {
    const p = db.prepare('SELECT p.*, o.code FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.invoice = ?').get(req.params.invoice);
    if (!p) return res.status(404).send('Счёт не найден');
    const back = returnPath(p, p.payer);
    res.send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тестовая оплата</title><link rel="stylesheet" href="/styles.css"></head><body><main class="wrap" style="max-width:420px;padding-top:40px">
<div class="card stack"><p class="small muted" style="margin:0">ТЕСТОВЫЙ РЕЖИМ — деньги не списываются</p>
<h2 style="margin:0">Оплата ${p.amount.toLocaleString('ru-RU')} ₸</h2><p class="muted" style="margin:0">Доставка ${p.code}, Жеткіз 750</p>
${p.status === 'pending' ? `<button class="btn sun block" data-r="ok">Оплатить</button><button class="btn ghost block" data-r="fail">Отказаться</button>` : `<p>Счёт уже обработан.</p><a class="btn block" href="${back}">Вернуться</a>`}
</div></main><script>
document.querySelectorAll('[data-r]').forEach((b) => b.onclick = async () => {
  document.querySelectorAll('[data-r]').forEach((x) => x.disabled = true);
  await fetch('/api/payments/callback/mock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice: ${JSON.stringify(p.invoice)}, result: b.dataset.r }) });
  location.href = ${JSON.stringify(back)};
});
</script></body></html>`);
  });
}

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Ошибка сервера' : err.message });
});

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && cfg.OTP_SECRET === 'dev-otp-secret') console.warn('ВНИМАНИЕ: задайте OTP_SECRET — случайную строку для защиты SMS-кодов');
  if (process.env.NODE_ENV === 'production' && payments.MODE === 'mock') console.warn('ВНИМАНИЕ: платежи в тестовом режиме (PAYMENT_MODE=mock) — любой может отметить заказ оплаченным');
  if (sms.MODE === 'mock') console.log('SMS в тестовом режиме: сообщения пишутся в консоль и в журнал (Админ → Уведомления)');
  const server = app.listen(cfg.PORT, process.env.HOST || undefined, () => {
    console.log(`Жеткіз 750 запущен: http://localhost:${cfg.PORT}`);
    if (process.env.DEMO_ORDERS === '1' && payments.MODE === 'mock') {
      require('./demo')(`http://127.0.0.1:${cfg.PORT}`).catch((e) => console.error('Демо-заказы не созданы:', e.message));
    }
  });
  // Корректная остановка (systemd посылает SIGTERM): дождаться текущих запросов и закрыть базу
  const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 10000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
module.exports = app;
