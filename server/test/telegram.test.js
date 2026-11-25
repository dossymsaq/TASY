// Проверка бота на имитации Telegram Bot API (настоящий Telegram не нужен)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---- имитация api.telegram.org ----
const fake = { queue: [], sent: [], nextId: 1 };
const fakeServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const params = body ? JSON.parse(body) : {};
    const method = req.url.split('/').pop();
    const reply = (result) => res.end(JSON.stringify({ ok: true, result }));
    if (method === 'getMe') return reply({ id: 1, is_bot: true, username: 'jetkiz750_test_bot' });
    if (method === 'deleteWebhook') return reply(true);
    if (method === 'sendMessage') { fake.sent.push(params); return reply({ message_id: fake.sent.length }); }
    if (method === 'getUpdates') {
      const give = () => {
        const items = fake.queue.filter((u) => u.update_id >= (params.offset || 0));
        fake.queue = [];
        reply(items);
      };
      return fake.queue.length ? give() : setTimeout(give, 30);
    }
    res.end(JSON.stringify({ ok: false, description: 'unknown method' }));
  });
});
const userSays = (from, message) => fake.queue.push({ update_id: fake.nextId++, message: { chat: { id: from.id, type: 'private' }, from, ...message } });
const waitFor = async (fn, ms = 3000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('не дождались');
};
const lastTo = (chatId) => [...fake.sent].reverse().find((m) => m.chat_id === chatId);

let app, tg, server, base;
before(async () => {
  await new Promise((r) => fakeServer.listen(0, r));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jetkiz-'));
  Object.assign(process.env, {
    DB_FILE: path.join(tmp, 'test.sqlite'), DEMO: '1', TELEGRAM_BOT_TOKEN: 'TEST',
    TELEGRAM_API: `http://127.0.0.1:${fakeServer.address().port}`, ADMIN_PHONES: '8 700 999 00 11',
    PUBLIC_URL: 'https://jetkiz750.kz',
  });
  app = require('../index');
  tg = require('../telegram');
  await tg.start();
  await new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; r(); }); });
});
after(() => { tg.stop(); server.close(); fakeServer.close(); });

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function telegramLogin(from, phoneNumber, profile) {
  const s = (await call('POST', '/auth/telegram/start')).data;
  assert.match(s.url, /^https:\/\/t\.me\/jetkiz750_test_bot\?start=/);
  assert.equal((await call('POST', '/auth/telegram/check', { token: s.token })).data.status, 'pending');
  userSays(from, { text: `/start ${s.token}` });
  await waitFor(() => lastTo(from.id)?.reply_markup?.keyboard);
  userSays(from, { contact: { phone_number: phoneNumber, user_id: from.id, first_name: from.first_name } });
  await waitFor(() => /Номер подтверждён/.test(lastTo(from.id)?.text || ''));
  let r = (await call('POST', '/auth/telegram/check', { token: s.token })).data;
  if (r.status === 'need_profile' && profile) r = (await call('POST', '/auth/telegram/check', { token: s.token, ...profile })).data;
  return { ...r, loginToken: s.token };
}

test('config отдаёт имя бота', async () => {
  assert.equal((await call('GET', '/config')).data.telegram_bot, 'jetkiz750_test_bot');
});

test('вход существующего пользователя через Telegram', async () => {
  const r = await telegramLogin({ id: 501, first_name: 'Дана' }, '+77000000004');
  assert.equal(r.status, 'ok');
  assert.equal(r.user.role, 'seller');
  assert.equal((await call('POST', '/auth/telegram/check', { token: r.loginToken })).status, 410, 'ссылка входа одноразовая');
  const me = (await call('GET', '/me', null, r.token)).data;
  assert.equal(me.telegram.linked, true);
});

test('регистрация нового покупателя и роль админа для ADMIN_PHONES', async () => {
  const n = await telegramLogin({ id: 502, first_name: 'Жанна' }, '77071112233');
  assert.equal(n.status, 'need_profile');
  assert.equal(n.first_name, 'Жанна');
  const r = await telegramLogin({ id: 502, first_name: 'Жанна' }, '77071112233', { name: 'Жанна' });
  assert.equal(r.status, 'ok');
  assert.equal(r.user.role, 'client');

  const a = await telegramLogin({ id: 503, first_name: 'Владелец' }, '77009990011', { name: 'Владелец' });
  assert.equal(a.user.role, 'admin');
});

test('чужой пересланный контакт не принимается', async () => {
  const s = (await call('POST', '/auth/telegram/start')).data;
  userSays({ id: 504, first_name: 'Хакер' }, { text: `/start ${s.token}` });
  userSays({ id: 504, first_name: 'Хакер' }, { contact: { phone_number: '77000000001', user_id: 999 } });
  await waitFor(() => /свой номер/.test(lastTo(504)?.text || ''));
  assert.equal((await call('POST', '/auth/telegram/check', { token: s.token })).data.status, 'pending');
});

test('уведомления о статусах приходят продавцу, покупателю и курьерам', async () => {
  // курьер и покупатель подключают бота без входа — просто делятся номером
  userSays({ id: 601, first_name: 'Ерлан' }, { text: '/start' });
  userSays({ id: 601, first_name: 'Ерлан' }, { contact: { phone_number: '77000000003', user_id: 601 } });
  userSays({ id: 602, first_name: 'Асель' }, { contact: { phone_number: '87000000005', user_id: 602 } });
  await waitFor(() => /Готово/.test(lastTo(602)?.text || ''));

  const login = async (phone, password) => (await call('POST', '/auth/login', { phone, password })).data.token;
  const seller = await login('77000000004', 'seller123');
  const courier = await login('77000000003', 'courier123');
  const o = (await call('POST', '/seller/orders', { buyer_name: 'Асель', buyer_phone: '77000000005', address: 'ул. Кенесары, 40', district: 'Есиль', item_desc: 'Платье', weight_kg: 1, pay_now: true }, seller)).data.order;

  await waitFor(() => /Новый заказ/.test(lastTo(601)?.text || ''));
  const toBuyer = await waitFor(() => lastTo(602));
  assert.match(toBuyer.text, new RegExp(`https://jetkiz750.kz/t/${o.code}`));
  assert.match(lastTo(501).text, /оплачен/);

  await call('POST', `/courier/orders/${o.id}/take`, null, courier);
  await call('POST', `/courier/orders/${o.id}/pickup`, null, courier);
  const picked = await waitFor(() => fake.sent.find((m) => m.chat_id === 602 && /Код получения: \d{4}/.test(m.text)));
  const code = picked.text.match(/Код получения: (\d{4})/)[1];
  await call('POST', `/courier/orders/${o.id}/deliver`, { confirm_code: code, cash_received: true }, courier);
  await waitFor(() => /доставлен/.test(lastTo(501)?.text || ''));
  await waitFor(() => /вручена/.test(lastTo(602)?.text || ''));
});

test('ответ поддержки приходит в Telegram', async () => {
  const seller = (await call('POST', '/auth/login', { phone: '77000000004', password: 'seller123' })).data.token;
  const support = (await call('POST', '/auth/login', { phone: '77000000002', password: 'support123' })).data.token;
  const t = (await call('POST', '/tickets', { subject: 'Чек', message: 'Где чек?' }, seller)).data.ticket;
  await waitFor(() => fake.sent.find((m) => m.chat_id === 503 && /Новое обращение/.test(m.text)), 3000);
  await call('POST', `/tickets/${t.id}/messages`, { message: 'Чек придёт в SMS' }, support);
  await waitFor(() => /Ответ поддержки/.test(lastTo(501)?.text || ''));
});
