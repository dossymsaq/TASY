const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jetkiz-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
process.env.PUSH_MODE = 'log';
process.env.SMS_STATUS = '1';
process.env.SELLER_SIGNUP = '1'; // здесь проверяем и самостоятельные заявки продавцов // проверяем и SMS о статусах (в работе они выключены по умолчанию)
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
// Оплата через тестовую страницу банка: берём номер счёта из ссылки и шлём уведомление об успехе
const payOnline = async (data, result = 'ok') => call('POST', '/payments/callback/mock', { invoice: data.pay_url.split('/').pop(), result });
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

  r = await call('POST', `/courier/orders/${o.id}/take`, null, courier);
  assert.equal(r.status, 409, 'нельзя взять неоплаченный заказ');

  r = await call('POST', `/seller/orders/${o.id}/pay`, null, seller);
  assert.match(r.data.pay_url, /^\/pay\/mock\//, 'продавец получает ссылку на страницу оплаты');
  assert.equal((await call('GET', `/track/${o.code}`)).data.order.status, 'new', 'до уведомления банка заказ не оплачен');
  await payOnline(r.data, 'fail');
  assert.equal((await call('GET', `/track/${o.code}`)).data.order.status, 'new', 'отказ от оплаты не меняет заказ');
  r = await call('POST', `/seller/orders/${o.id}/pay`, null, seller);
  assert.equal((await payOnline(r.data)).data.ok, true);
  assert.equal((await call('GET', `/track/${o.code}`)).data.order.status, 'ready');

  const track = (await call('GET', `/track/${o.code}`)).data.order;
  assert.equal(track.confirm_code, undefined, 'кода получения больше нет');
  r = await call('POST', `/track/${o.code}/pay`);
  assert.equal(r.status, 200);
  await payOnline(r.data);
  r = await call('POST', `/track/${o.code}/pay`);
  assert.equal(r.status, 400, 'двойная оплата запрещена');

  const mine = (await call('GET', '/client/orders', null, client)).data.orders;
  assert.equal(mine.length, 1);

  assert.equal((await call('POST', `/courier/orders/${o.id}/take`, null, courier)).status, 200);
  assert.equal((await call('POST', `/courier/orders/${o.id}/pickup`, null, courier)).status, 200);
  assert.equal((await call('POST', `/courier/orders/${o.id}/deliver`, {}, courier)).status, 200, 'курьер вручает без кода');

  const stats = (await call('GET', '/admin/stats', null, admin)).data;
  assert.equal(stats.revenue, 1500);
  assert.equal(stats.byStatus.delivered, 1);
});

test('оплата наличными курьеру и отмена с возвратом', async () => {
  const seller = await login('77000000004', 'seller123');
  const courier = await login('77000000003', 'courier123');
  const admin = await login('77000000001', 'admin123');
  const base0 = { buyer_name: 'Ержан', buyer_phone: '77011112233', address: 'ул. Сыганак, 10', district: 'Нура', item_desc: 'Книга', weight_kg: 0.5, pay_now: true };

  let ra = (await call('POST', '/seller/orders', base0, seller)).data;
  await payOnline(ra);
  const a = (await call('GET', `/track/${ra.order.code}`)).data.order;
  assert.equal(a.status, 'ready');
  await call('POST', `/courier/orders/${a.id}/take`, null, courier);
  await call('POST', `/courier/orders/${a.id}/pickup`, null, courier);
  let r = await call('POST', `/courier/orders/${a.id}/deliver`, {}, courier);
  assert.equal(r.status, 400, 'без оплаты покупателя нельзя завершить');
  r = await call('POST', `/courier/orders/${a.id}/deliver`, { cash_received: true }, courier);
  assert.equal(r.status, 200);

  const rb = (await call('POST', '/seller/orders', base0, seller)).data;
  await payOnline(rb);
  const b = rb.order;
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
  const ro = (await call('POST', '/seller/orders', { buyer_name: 'Тимур', buyer_phone: buyer, address: 'ул. Достык, 5', district: 'Есиль', item_desc: 'Часы', weight_kg: 0.3, pay_now: true }, seller)).data;
  await payOnline(ro);
  const o = ro.order;
  await call('POST', `/courier/orders/${o.id}/take`, null, courier);
  await call('POST', `/courier/orders/${o.id}/pickup`, null, courier);
  await new Promise((r) => setTimeout(r, 20));
  const { notifications } = (await call('GET', '/admin/notifications', null, admin)).data;
  const toBuyer = notifications.filter((n) => n.phone === buyer).map((n) => n.text);
  assert.ok(toBuyer.some((t) => t.includes(`/t/${o.code}`)), 'покупатель получил ссылку отслеживания');
  assert.ok(toBuyer.some((t) => t.includes('везёт ваш заказ')), 'покупатель узнал, что курьер в пути');
  assert.ok(!toBuyer.some((t) => /Код получения/.test(t)), 'кода получения в SMS нет');
  assert.ok(notifications.some((n) => n.phone === '77000000004' && n.text.includes(o.code)), 'продавец получил уведомление');
  assert.ok(notifications.filter((n) => n.kind === 'otp').every((n) => !/\d{4}/.test(n.text)), 'коды входа не хранятся в журнале');
  assert.equal((await call('GET', '/admin/notifications', null, seller)).status, 403);
});

test('оплата: повторная оплата возвращается, неверная сумма и чужой счёт отклоняются', async () => {
  const seller = await login('77000000004', 'seller123');
  const admin = await login('77000000001', 'admin123');
  const before = (await call('GET', '/admin/stats', null, admin)).data.revenue;
  const { order: o } = (await call('POST', '/seller/orders', { buyer_name: 'Алия', buyer_phone: '77015556677', address: 'ул. Туран, 1', district: 'Есиль', item_desc: 'Шарф', weight_kg: 0.2 }, seller)).data;
  // две вкладки — два счёта, оплачены оба
  const p1 = (await call('POST', `/seller/orders/${o.id}/pay`, null, seller)).data;
  const p2 = (await call('POST', `/seller/orders/${o.id}/pay`, null, seller)).data;
  await payOnline(p1); await payOnline(p2);
  const track = (await call('GET', `/track/${o.code}`)).data.order;
  assert.equal(track.status, 'ready');
  assert.ok(track.events.some((e) => e.note.includes('Лишняя оплата')), 'вторая оплата возвращена');
  assert.equal((await call('GET', '/admin/stats', null, admin)).data.revenue - before, 750);

  const p3 = (await call('POST', `/track/${o.code}/pay`)).data;
  let r = await call('POST', '/payments/callback/mock', { invoice: p3.invoice, result: 'ok', amount: 1 });
  assert.equal(r.data.ok, false, 'сумма не совпадает');
  assert.equal((await call('GET', `/track/${o.code}`)).data.order.buyer_paid, false);
  r = await call('POST', '/payments/callback/mock', { invoice: 'NOPE', result: 'ok' });
  assert.equal(r.data.ok, false, 'несуществующий счёт');
  assert.equal((await call('POST', '/payments/callback/freedompay', {})).status, 404, 'чужой провайдер отключён');
});

test('Freedom Pay: подпись запроса и ответа', () => {
  const { fpSign } = require('../payments');
  // md5("init_payment.php;10;123;salt;secret")
  const sig = fpSign('init_payment.php', { pg_salt: 'salt', pg_merchant_id: 123, pg_amount: 10 }, 'secret');
  const expected = require('node:crypto').createHash('md5').update('init_payment.php;10;123;salt;secret').digest('hex');
  assert.equal(sig, expected, 'параметры сортируются по имени, разделитель «;», в конце секрет');
  assert.equal(fpSign('x', { a: 1, pg_sig: 'zzz' }, 's'), fpSign('x', { a: 1 }, 's'), 'pg_sig не участвует в подписи');
});

test('push: курьеры узнают о новом заказе, продавец с приложением получает push вместо SMS', async () => {
  const seller = await login('77000000004', 'seller123');
  const courier = await login('77000000003', 'courier123');
  const admin = await login('77000000001', 'admin123');
  assert.equal((await call('POST', '/me/push-token', { token: 'not-a-token' }, seller)).status, 400);
  assert.equal((await call('POST', '/me/push-token', { token: 'ExponentPushToken[seller-device-1]', platform: 'android' }, seller)).status, 200);
  assert.equal((await call('POST', '/me/push-token', { token: 'ExponentPushToken[courier-device-1]', platform: 'ios' }, courier)).status, 200);

  const r = (await call('POST', '/seller/orders', { buyer_name: 'Нурлан', buyer_phone: '77018880011', address: 'ул. Иманова, 3', district: 'Алматы', item_desc: 'Кроссовки', weight_kg: 1.5, pay_now: true }, seller)).data;
  await payOnline(r);
  await call('POST', `/courier/orders/${r.order.id}/take`, null, courier);
  await new Promise((res) => setTimeout(res, 20));
  const log = (await call('GET', '/admin/notifications', null, admin)).data.notifications;
  assert.ok(log.some((n) => n.kind === 'push' && n.phone === 'курьеры' && n.text.includes('Новый заказ · Алматы')), 'push курьерам о новом заказе');
  assert.ok(log.some((n) => n.kind === 'push' && n.phone === '77000000004' && n.text.includes(r.order.code)), 'push продавцу');
  assert.ok(!log.some((n) => n.kind === 'status' && n.phone === '77000000004' && n.text.includes(r.order.code)), 'SMS продавцу не нужно — есть приложение');
  assert.ok(log.some((n) => n.kind === 'status' && n.phone === '77018880011'), 'покупателю без приложения — SMS');

  // после выхода с устройства push туда не идут
  await call('POST', '/auth/logout', { push_token: 'ExponentPushToken[seller-device-1]' }, seller);
  const s2 = await login('77000000004', 'seller123');
  const r2 = (await call('POST', '/seller/orders', { buyer_name: 'Нурлан', buyer_phone: '77018880011', address: 'ул. Иманова, 3', district: 'Алматы', item_desc: 'Кепка', weight_kg: 0.2, pay_now: true }, s2)).data;
  await payOnline(r2);
  await call('POST', `/courier/orders/${r2.order.id}/take`, null, courier);
  await new Promise((res) => setTimeout(res, 20));
  const log2 = (await call('GET', '/admin/notifications', null, admin)).data.notifications;
  assert.ok(log2.some((n) => n.kind === 'status' && n.phone === '77000000004' && n.text.includes(r2.order.code)), 'без приложения — снова SMS');
});

test('касса курьеров: наличные числятся за курьером, пока админ их не примет', async () => {
  const seller = await login('77000000004', 'seller123');
  const courier = await login('77000000003', 'courier123');
  const admin = await login('77000000001', 'admin123');
  const before = (await call('GET', '/courier/cash', null, courier)).data.on_hand;
  const ro = (await call('POST', '/seller/orders', { buyer_name: 'Арман', buyer_phone: '77012340000', address: 'ул. Бейбитшилик, 9', district: 'Сарыарка', item_desc: 'Чехол', weight_kg: 0.1, pay_now: true }, seller)).data;
  await payOnline(ro);
  await call('POST', `/courier/orders/${ro.order.id}/take`, null, courier);
  await call('POST', `/courier/orders/${ro.order.id}/pickup`, null, courier);
  await call('POST', `/courier/orders/${ro.order.id}/deliver`, { cash_received: true }, courier);

  const mine = (await call('GET', '/courier/cash', null, courier)).data;
  assert.equal(mine.on_hand, before + 750);
  assert.ok(mine.items.some((i) => i.code === ro.order.code));
  const cash = (await call('GET', '/admin/cash', null, admin)).data;
  const c = cash.couriers.find((x) => x.phone === '77000000003');
  assert.equal(c.on_hand, before + 750);
  assert.equal((await call('GET', '/admin/stats', null, admin)).data.cashOnHands, cash.total_on_hand);

  assert.equal((await call('POST', `/admin/cash/${c.id}/handover`, { amount: 1 }, admin)).status, 409, 'сумма должна совпасть');
  assert.equal((await call('GET', '/admin/cash', null, courier)).status, 403, 'курьер не видит кассу всех');
  const r = await call('POST', `/admin/cash/${c.id}/handover`, { amount: c.on_hand }, admin);
  assert.equal(r.data.amount, c.on_hand);
  const after = (await call('GET', '/courier/cash', null, courier)).data;
  assert.equal(after.on_hand, 0);
  assert.equal(after.handovers[0].amount, c.on_hand);
  assert.equal((await call('POST', `/admin/cash/${c.id}/handover`, { amount: 0 }, admin)).status, 400, 'нечего сдавать');
});

test('удаление аккаунта: данные стёрты, номер свободен, сотрудник удалить себя не может', async () => {
  const phone = '77015557788';
  let r = await call('POST', '/auth/otp/request', { phone });
  r = await call('POST', '/auth/otp/verify', { phone, code: r.data.dev_code, name: 'Удаляемый', role: 'seller', shop_name: 'Shop', pickup_address: 'ул. Абая, 1' });
  const token = r.data.token;
  const adm = await login('77000000001', 'admin123');
  await call('POST', `/admin/users/${r.data.user.id}/approve`, null, adm);
  const o = (await call('POST', '/seller/orders', { buyer_name: 'Б', buyer_phone: '77010000099', address: 'ул. 1', district: 'Нура', item_desc: 'X', weight_kg: 0.1 }, token)).data.order;
  // покупатель успел оплатить свою часть по ещё неоплаченному продавцом заказу
  await payOnline((await call('POST', `/track/${o.code}/pay`)).data);

  assert.equal((await call('DELETE', '/me', {}, token)).status, 400, 'нужно подтверждение');
  assert.equal((await call('DELETE', '/me', { confirm: 'УДАЛИТЬ' }, token)).status, 200);
  assert.equal((await call('GET', '/me', null, token)).status, 401, 'сессии завершены');
  const t = (await call('GET', `/track/${o.code}`)).data.order;
  assert.equal(t.status, 'cancelled', 'неоплаченный заказ отменён');
  assert.ok(t.events.some((e) => e.note.includes('оплата возвращена')), 'оплата покупателя возвращена');

  const admin = await login('77000000001', 'admin123');
  const users = (await call('GET', '/admin/users', null, admin)).data.users;
  assert.ok(!users.some((u) => u.phone === phone), 'телефона больше нет в базе');
  assert.ok(users.some((u) => u.name === 'Удалённый пользователь' && !u.active));
  r = await call('POST', '/auth/otp/request', { phone });
  assert.equal(r.data.registered, false, 'номер можно зарегистрировать заново');

  const courier = await login('77000000003', 'courier123');
  assert.equal((await call('DELETE', '/me', { confirm: 'УДАЛИТЬ' }, courier)).status, 400);
});

test('продавец по договору: заявка → одобрение владельцем → заказы', async () => {
  const phone = '77016660011';
  let r = await call('POST', '/auth/otp/request', { phone });
  r = await call('POST', '/auth/otp/verify', { phone, code: r.data.dev_code, name: 'Жанар', role: 'seller', shop_name: 'Zhanar Bags', pickup_address: 'ул. Сыганак, 2' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.approved, false, 'новый продавец — заявка');
  const token = r.data.token;
  const order = { buyer_name: 'А', buyer_phone: '77010001111', address: 'ул. 1', district: 'Есиль', item_desc: 'Сумка', weight_kg: 1 };
  r = await call('POST', '/seller/orders', order, token);
  assert.equal(r.status, 403, 'до одобрения заказы недоступны');
  assert.match(r.data.error, /рассмотрении/);

  const admin = await login('77000000001', 'admin123');
  assert.ok((await call('GET', '/admin/stats', null, admin)).data.pendingSellers >= 1);
  const courier = await login('77000000003', 'courier123');
  assert.equal((await call('POST', `/admin/users/${(await call('GET', '/me', null, token)).data.user.id}/approve`, null, courier)).status, 403, 'одобряет только владелец');
  const id = (await call('GET', '/me', null, token)).data.user.id;
  r = await call('POST', `/admin/users/${id}/approve`, null, admin);
  assert.equal(r.data.user.approved, true);
  assert.equal((await call('POST', '/seller/orders', order, token)).status, 201, 'после одобрения можно');

  // покупатель регистрируется сразу, без одобрения
  r = await call('POST', '/auth/otp/request', { phone: '77016660022' });
  r = await call('POST', '/auth/otp/verify', { phone: '77016660022', code: r.data.dev_code, name: 'Клиент' });
  assert.equal(r.data.user.role, 'client');
  assert.equal(r.data.user.approved, true);
});
