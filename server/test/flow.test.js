const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jetkiz-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
const app = require('../index');

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

test('полный цикл доставки: 750 ₸ продавец + 750 ₸ покупатель = 1500 ₸', async () => {
  const seller = await login('+7 700 000 00 04', 'seller123');
  const courier = await login('87000000003', 'courier123');
  const admin = await login('77000000001', 'admin123');
  const client = await login('77000000005', 'client123');

  const order0 = { buyer_name: 'Асель', buyer_phone: '+77000000005', address: 'ул. Кенесары, 40, кв 12', district: 'Есиль', item_desc: 'Букет', weight_kg: 2.5 };
  let r = await call('POST', '/seller/orders', order0, seller);
  assert.equal(r.status, 400, 'вес больше 2 кг запрещён');

  r = await call('POST', '/seller/orders', { ...order0, weight_kg: 1.2 }, seller);
  assert.equal(r.status, 201);
  const o = r.data.order;
  assert.equal(o.status, 'new');
  assert.equal(o.confirm_code, undefined, 'продавец не видит код подтверждения');

  r = await call('POST', `/courier/orders/${o.id}/take`, null, courier);
  assert.equal(r.status, 409, 'нельзя взять неоплаченный заказ');

  r = await call('POST', `/seller/orders/${o.id}/pay`, null, seller);
  assert.equal(r.data.order.status, 'ready');

  const track = (await call('GET', `/track/${o.code}`)).data.order;
  assert.match(track.confirm_code, /^\d{4}$/);
  r = await call('POST', `/track/${o.code}/pay`);
  assert.equal(r.status, 200);
  r = await call('POST', `/track/${o.code}/pay`);
  assert.equal(r.status, 400, 'двойная оплата запрещена');

  const mine = (await call('GET', '/client/orders', null, client)).data.orders;
  assert.equal(mine.length, 1);

  assert.equal((await call('POST', `/courier/orders/${o.id}/take`, null, courier)).status, 200);
  assert.equal((await call('POST', `/courier/orders/${o.id}/pickup`, null, courier)).status, 200);
  assert.equal((await call('POST', `/courier/orders/${o.id}/deliver`, { confirm_code: '0000' }, courier)).status, 400);
  assert.equal((await call('POST', `/courier/orders/${o.id}/deliver`, { confirm_code: track.confirm_code }, courier)).status, 200);

  const stats = (await call('GET', '/admin/stats', null, admin)).data;
  assert.equal(stats.revenue, 1500);
  assert.equal(stats.byStatus.delivered, 1);
});

test('оплата наличными курьеру и отмена с возвратом', async () => {
  const seller = await login('77000000004', 'seller123');
  const courier = await login('77000000003', 'courier123');
  const admin = await login('77000000001', 'admin123');
  const base0 = { buyer_name: 'Ержан', buyer_phone: '77011112233', address: 'ул. Сыганак, 10', district: 'Нура', item_desc: 'Книга', weight_kg: 0.5, pay_now: true };

  const a = (await call('POST', '/seller/orders', base0, seller)).data.order;
  assert.equal(a.status, 'ready');
  const code = (await call('GET', `/track/${a.code}`)).data.order.confirm_code;
  await call('POST', `/courier/orders/${a.id}/take`, null, courier);
  await call('POST', `/courier/orders/${a.id}/pickup`, null, courier);
  let r = await call('POST', `/courier/orders/${a.id}/deliver`, { confirm_code: code }, courier);
  assert.equal(r.status, 400, 'без оплаты покупателя нельзя завершить');
  r = await call('POST', `/courier/orders/${a.id}/deliver`, { confirm_code: code, cash_received: true }, courier);
  assert.equal(r.status, 200);

  const b = (await call('POST', '/seller/orders', base0, seller)).data.order;
  r = await call('POST', `/seller/orders/${b.id}/cancel`, null, seller);
  assert.equal(r.data.order.status, 'cancelled');

  const stats = (await call('GET', '/admin/stats', null, admin)).data;
  assert.equal(stats.revenue, 3000, 'возврат по отменённому заказу не учитывается');
  assert.equal(stats.cash, 750);
});

test('техподдержка: гость пишет, сотрудник отвечает', async () => {
  const support = await login('77000000002', 'support123');
  const seller = await login('77000000004', 'seller123');
  let r = await call('POST', '/tickets', { subject: 'Где курьер?', message: 'Жду уже час', contact_name: 'Гость', contact_phone: '77075554433' });
  assert.equal(r.status, 201);
  const id = r.data.ticket.id;
  assert.equal((await call('GET', `/tickets/${id}`, null, seller)).status, 404, 'чужое обращение недоступно');
  await call('POST', `/tickets/${id}/messages`, { message: 'Курьер будет через 10 минут' }, support);
  const t = (await call('GET', `/tickets/${id}`, null, support)).data;
  assert.equal(t.ticket.status, 'answered');
  assert.equal(t.messages.length, 2);
  assert.equal((await call('GET', '/admin/users', null, support)).status, 403);
});

test('вход по SMS-коду: регистрация нового покупателя и вход существующего', async () => {
  const phone = '77015550011';
  let r = await call('POST', '/auth/otp/request', { phone });
  assert.equal(r.status, 200);
  assert.equal(r.data.registered, false);
  assert.match(r.data.dev_code, /^\d{4}$/);
  const code = r.data.dev_code;

  assert.equal((await call('POST', '/auth/otp/request', { phone })).status, 429, 'повторный запрос не раньше чем через минуту');
  assert.equal((await call('POST', '/auth/otp/verify', { phone, code: code === '0000' ? '1111' : '0000' })).status, 400);

  r = await call('POST', '/auth/otp/verify', { phone, code });
  assert.deepEqual(r.data, { need_profile: true }, 'для нового номера нужно имя');
  r = await call('POST', '/auth/otp/verify', { phone, code, name: 'Мадина' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'client');
  assert.equal((await call('GET', '/me', null, r.data.token)).data.user.name, 'Мадина');
  assert.equal((await call('POST', '/auth/otp/verify', { phone, code })).status, 400, 'код одноразовый');

  // существующий пользователь (демо-продавец) входит по коду
  r = await call('POST', '/auth/otp/request', { phone: '77000000004' });
  assert.equal(r.data.registered, true);
  r = await call('POST', '/auth/otp/verify', { phone: '77000000004', code: r.data.dev_code });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'seller');
});

test('неверный код: после 5 ошибок код блокируется', async () => {
  const phone = '77015550022';
  const { dev_code } = (await call('POST', '/auth/otp/request', { phone })).data;
  const wrong = dev_code === '9999' ? '0000' : '9999';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/otp/verify', { phone, code: wrong })).status, 400);
  assert.equal((await call('POST', '/auth/otp/verify', { phone, code: dev_code, name: 'X' })).status, 429);
});

test('SMS-уведомления о статусах уходят покупателю и продавцу', async () => {
  const seller = await login('77000000004', 'seller123');
  const courier = await login('77000000003', 'courier123');
  const admin = await login('77000000001', 'admin123');
  const buyer = '77019998877';
  const o = (await call('POST', '/seller/orders', { buyer_name: 'Тимур', buyer_phone: buyer, address: 'ул. Достык, 5', district: 'Есиль', item_desc: 'Часы', weight_kg: 0.3, pay_now: true }, seller)).data.order;
  await call('POST', `/courier/orders/${o.id}/take`, null, courier);
  await call('POST', `/courier/orders/${o.id}/pickup`, null, courier);
  await new Promise((r) => setTimeout(r, 20));
  const { notifications } = (await call('GET', '/admin/notifications', null, admin)).data;
  const toBuyer = notifications.filter((n) => n.phone === buyer).map((n) => n.text);
  assert.ok(toBuyer.some((t) => t.includes(`/t/${o.code}`)), 'покупатель получил ссылку отслеживания');
  const code = (await call('GET', `/track/${o.code}`)).data.order.confirm_code;
  assert.ok(toBuyer.some((t) => t.includes(`Код получения: ${code}`)), 'покупатель получил код получения');
  assert.ok(notifications.some((n) => n.phone === '77000000004' && n.text.includes(o.code)), 'продавец получил уведомление');
  assert.ok(notifications.filter((n) => n.kind === 'otp').every((n) => !/\d{4}/.test(n.text)), 'коды входа не хранятся в журнале');
  assert.equal((await call('GET', '/admin/notifications', null, seller)).status, 403);
});
