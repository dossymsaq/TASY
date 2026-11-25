const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jetkiz-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
process.env.SMS_MODE = 'mock';
const app = require('../index');
const { db } = require('../db');

let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; r(); }); }));
after(() => server.close());

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const login = async (phone, password) => (await call('POST', '/auth/login', { phone, password })).data.token;
// чтобы не ждать минуту между запросами кода в тестах
const resetOtpTimer = (phone) => db.prepare("UPDATE otp_codes SET created_at = datetime('now','-2 minutes') WHERE phone = ?").run(phone);

async function deliverOrder(seller, courier, { buyerPays }) {
  const o = (await call('POST', '/seller/orders', { buyer_name: 'Тест', buyer_phone: '77011234567', address: 'ул. Достык, 5', district: 'Есиль', item_desc: 'Коробка', weight_kg: 1, pay_now: true }, seller)).data.order;
  const code = (await call('GET', `/track/${o.code}`)).data.order.confirm_code;
  if (buyerPays) await call('POST', `/track/${o.code}/pay`);
  await call('POST', `/courier/orders/${o.id}/take`, null, courier);
  await call('POST', `/courier/orders/${o.id}/pickup`, null, courier);
  const r = await call('POST', `/courier/orders/${o.id}/deliver`, { confirm_code: code, cash_received: !buyerPays }, courier);
  assert.equal(r.status, 200);
}

test('учёт денег курьера: заработок, наличные, сдача и выплата', async () => {
  const seller = await login('77000000004', 'seller123');
  const courier = await login('77000000003', 'courier123');
  const admin = await login('77000000001', 'admin123');

  await deliverOrder(seller, courier, { buyerPays: true });   // +1000
  await deliverOrder(seller, courier, { buyerPays: false });  // +1000, наличные 750 на руках

  let b = (await call('GET', '/courier/balance', null, courier)).data;
  assert.equal(b.earned_today, 2000);
  assert.equal(b.deliveries_today, 2);
  assert.equal(b.cash_in_hand, 750);
  assert.equal(b.balance, 1250, 'сервис должен 2000 − 750 наличными');

  const { couriers } = (await call('GET', '/admin/couriers', null, admin)).data;
  const id = couriers[0].id;
  assert.equal(couriers[0].balance, 1250);

  assert.equal((await call('POST', `/admin/couriers/${id}/settle`, { type: 'handover', amount: 1000 }, admin)).status, 400, 'нельзя принять больше, чем на руках');
  b = (await call('POST', `/admin/couriers/${id}/settle`, { type: 'handover', amount: 750 }, admin)).data;
  assert.equal(b.cash_in_hand, 0);
  assert.equal(b.balance, 2000);
  assert.equal((await call('POST', `/admin/couriers/${id}/settle`, { type: 'payout', amount: 2500 }, admin)).status, 400, 'нельзя выплатить больше долга');
  b = (await call('POST', `/admin/couriers/${id}/settle`, { type: 'payout', amount: 2000 }, admin)).data;
  assert.equal(b.balance, 0);
  assert.equal(b.paid_out, 2000);

  const s = (await call('GET', '/admin/stats', null, admin)).data;
  assert.equal(s.revenue, 3000);
  assert.equal(s.courierCost, 2000);
  assert.equal(s.profit, 1000);
  assert.equal(s.cash, 0);
  assert.equal((await call('POST', `/admin/couriers/${id}/settle`, { type: 'payout', amount: 1 }, courier)).status, 403);
});

test('вход по SMS: регистрация нового покупателя и вход существующего', async () => {
  let r = await call('POST', '/auth/otp/request', { phone: '+7 777 111 22 33' });
  assert.equal(r.status, 200);
  assert.equal(r.data.is_new, true);
  const code = r.data.dev_code;
  assert.match(code, /^\d{4}$/);

  assert.equal((await call('POST', '/auth/otp/request', { phone: '77771112233' })).status, 429, 'повторный код не раньше чем через минуту');

  const wrong = code === '1111' ? '2222' : '1111';
  r = await call('POST', '/auth/otp/verify', { phone: '77771112233', code: wrong });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Осталось попыток: 4/);

  r = await call('POST', '/auth/otp/verify', { phone: '77771112233', code });
  assert.equal(r.status, 400, 'новому пользователю нужно имя');
  r = await call('POST', '/auth/otp/verify', { phone: '77771112233', code, name: 'Жанна' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'client');
  assert.ok(r.data.token);

  r = await call('POST', '/auth/otp/verify', { phone: '77771112233', code, name: 'Жанна' });
  assert.equal(r.status, 400, 'код одноразовый');

  resetOtpTimer('77771112233');
  r = await call('POST', '/auth/otp/request', { phone: '77771112233' });
  assert.equal(r.data.is_new, false);
  r = await call('POST', '/auth/otp/verify', { phone: '77771112233', code: r.data.dev_code });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.name, 'Жанна');
});

test('SMS: регистрация продавца и блокировка после 5 неверных попыток', async () => {
  let r = await call('POST', '/auth/otp/request', { phone: '77015556677' });
  r = await call('POST', '/auth/otp/verify', { phone: '77015556677', code: r.data.dev_code, role: 'seller', name: 'Арман', shop_name: 'Arman Shop', pickup_address: 'ул. Сарайшык, 7' });
  assert.equal(r.data.user.role, 'seller');
  assert.equal(r.data.user.shop_name, 'Arman Shop');

  resetOtpTimer('77015556677');
  r = await call('POST', '/auth/otp/request', { phone: '77015556677' });
  const code = r.data.dev_code;
  const wrong = code === '1111' ? '2222' : '1111';
  for (let i = 0; i < 5; i++) await call('POST', '/auth/otp/verify', { phone: '77015556677', code: wrong });
  r = await call('POST', '/auth/otp/verify', { phone: '77015556677', code });
  assert.equal(r.status, 429, 'после 5 ошибок даже верный код не принимается');
});
