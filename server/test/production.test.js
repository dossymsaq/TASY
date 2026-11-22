// Рабочий режим: демо-аккаунтов нет
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jetkiz-prod-')), 'db.sqlite');
process.env.NODE_ENV = 'production';
process.env.PUSH_MODE = 'log';

test('в production демо-аккаунты не создаются и код входа не возвращается', async () => {
  const { db } = require('../db');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  const app = require('../index');
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '77000000001', password: 'admin123' }) });
    assert.equal(login.status, 401);
    const otp = await (await fetch(base + '/auth/otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '77010000001' }) })).json();
    assert.equal(otp.ok, true);
    assert.equal(otp.dev_code, undefined, 'в рабочем режиме код не показывается');
    // SMS о статусах заказа по умолчанию не отправляются
    const { db } = require('../db');
    const { hashPassword } = require('../db');
    db.prepare("INSERT INTO users (role,name,phone,shop_name,pickup_address,password_hash) VALUES ('seller','S','77010000002','Shop','ул. 1',?)").run(hashPassword('pass123456'));
    const post = async (u, body, t) => (await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(body) })).json();
    const { token } = await post('/auth/login', { phone: '77010000002', password: 'pass123456' });
    const r = await post('/seller/orders', { buyer_name: 'B', buyer_phone: '77010000003', address: 'ул. 2', district: 'Нура', item_desc: 'X', weight_kg: 1, pay_now: true }, token);
    await post('/payments/callback/mock', { invoice: r.invoice, result: 'ok' });
    await new Promise((res) => setTimeout(res, 30));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'status'").get().n, 0, 'SMS о статусе не ушло');
  } finally { server.close(); }
});
