// Формат запроса к Expo Push и удаление устройств, где приложение удалено
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jetkiz-push-')), 'db.sqlite');
process.env.PUSH_MODE = 'expo';
const { db } = require('../db');
const push = require('../push');

test('отправка в Expo и очистка устаревших токенов', async () => {
  const seller = db.prepare("SELECT id FROM users WHERE phone = '77000000004'").get().id;
  assert.ok(push.saveToken(seller, 'ExponentPushToken[aaaaaaaaaaaa]', 'android'));
  assert.ok(push.saveToken(seller, 'ExponentPushToken[bbbbbbbbbbbb]', 'ios'));
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ data: [{ status: 'ok', id: '1' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }] }), { status: 200 });
  };
  try {
    const sent = await push.sendToUsers([seller], { title: 'Т', body: 'Б', data: { tab: 'orders' } }, 'test');
    assert.equal(sent, 1);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls[0].url, 'https://exp.host/--/api/v2/push/send');
  assert.deepEqual(calls[0].body[0], { to: 'ExponentPushToken[aaaaaaaaaaaa]', title: 'Т', body: 'Б', data: { tab: 'orders' }, sound: 'default', priority: 'high', channelId: 'orders' });
  const left = db.prepare('SELECT token FROM push_tokens').all().map((r) => r.token);
  assert.deepEqual(left, ['ExponentPushToken[aaaaaaaaaaaa]'], 'токен удалённого приложения стёрт');
});
