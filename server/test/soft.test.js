// Мягкий старт (LAUNCH_MODE=soft): без онлайн-оплаты и SMS, оплата наличными курьеру
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jetkiz-soft-')), 'db.sqlite');
process.env.LAUNCH_MODE = 'soft';
process.env.PUSH_MODE = 'log';
const app = require('../index');

let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; r(); }); }));
after(() => server.close());
async function call(method, url, body, token) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}
const login = async (phone, password) => (await call('POST', '/auth/login', { phone, password })).data.token;

test('мягкий старт: заявка по паролю → одобрение → наличные от продавца и покупателя', async () => {
  const cfg = (await call('GET', '/config')).data;
  assert.equal(cfg.launch_mode, 'soft');
  assert.equal(cfg.online_payments, false);
  assert.equal(cfg.sms_login, false);
  assert.equal((await call('POST', '/auth/otp/request', { phone: '77011112222' })).status, 403, 'SMS выключены');
  assert.equal((await call('POST', '/auth/register', { role: 'client', name: 'К', phone: '77011112222', password: 'secret12' })).status, 400, 'клиенты по паролю не регистрируются');

  // заявка продавца с паролем
  let r = await call('POST', '/auth/register', { role: 'seller', name: 'Гульнар', phone: '77011113333', password: 'secret12', shop_name: 'Gul Shop', pickup_address: 'ул. Абая, 5' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.approved, false);
  const admin = await login('77000000001', 'admin123');
  await call('POST', `/admin/users/${r.data.user.id}/approve`, null, admin);
  const seller = await login('77011113333', 'secret12');
  assert.ok(seller, 'продавец входит по паролю');

  // заказ сразу у курьеров, без оплаты
  r = await call('POST', '/seller/orders', { buyer_name: 'Арай', buyer_phone: '77012224444', address: 'ул. Мангилик Ел, 10', district: 'Есиль', item_desc: 'Платье', weight_kg: 1, pay_now: true }, seller);
  assert.equal(r.status, 201);
  const o = r.data.order;
  assert.equal(o.status, 'ready');
  assert.equal(r.data.pay_url, undefined, 'ссылки на оплату нет');
  assert.equal((await call('POST', `/seller/orders/${o.id}/pay`, null, seller)).status, 400);
  const t = (await call('GET', `/track/${o.code}`)).data;
  assert.equal(t.online_payments, false);
  assert.equal((await call('POST', `/track/${o.code}/pay`)).status, 400, 'онлайн-оплаты нет');

  const courier = await login('77000000003', 'courier123');
  const before = (await call('GET', '/courier/cash', null, courier)).data.on_hand;
  assert.equal((await call('POST', `/courier/orders/${o.id}/take`, null, courier)).status, 200);
  r = await call('POST', `/courier/orders/${o.id}/pickup`, {}, courier);
  assert.equal(r.status, 400, 'без наличных от продавца забрать нельзя');
  assert.equal((await call('POST', `/courier/orders/${o.id}/pickup`, { seller_cash_received: true }, courier)).status, 200);
  assert.equal((await call('POST', `/courier/orders/${o.id}/deliver`, {}, courier)).status, 400, 'нужны наличные от покупателя');
  assert.equal((await call('POST', `/courier/orders/${o.id}/deliver`, { cash_received: true }, courier)).status, 200);

  const cash = (await call('GET', '/courier/cash', null, courier)).data;
  assert.equal(cash.on_hand - before, 1500, 'у курьера 750 от продавца + 750 от покупателя');
  const done = (await call('GET', `/track/${o.code}`)).data.order;
  assert.equal(done.status, 'delivered');
  assert.ok(done.seller_paid && done.buyer_paid);
});
