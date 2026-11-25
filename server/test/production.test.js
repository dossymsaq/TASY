// Рабочий режим (DEMO=0): нет демо-аккаунтов и тестовых SMS-кодов
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jetkiz-'));
Object.assign(process.env, { DB_FILE: path.join(tmp, 'test.sqlite'), DEMO: '0', SMS_MODE: 'mock' });
const app = require('../index');

let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; r(); }); }));
after(() => server.close());
const post = async (url, body) => { const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };

test('демо-аккаунтов нет', async () => {
  assert.equal((await post('/auth/login', { phone: '77000000001', password: 'admin123' })).status, 401);
});
test('тестовый SMS-режим запрещён даже если его включить', async () => {
  const cfg = await (await fetch(base + '/config')).json();
  assert.equal(cfg.sms_mode, 'off');
  const r = await post('/auth/otp/request', { phone: '77001112233' });
  assert.equal(r.status, 503);
  assert.equal(r.data.dev_code, undefined);
});
