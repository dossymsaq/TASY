// Адаптер Freedom Pay против поддельного сервера банка: создание счёта, подписанное уведомление, возврат
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SECRET = 'test-secret';
const bank = { calls: [] };
let fake, server, base;

before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = Object.fromEntries(new URLSearchParams(body));
      const script = req.url.slice(1);
      bank.calls.push({ script, p });
      const { fpSign } = require('../payments');
      const sigOk = p.pg_sig === fpSign(script, p, SECRET);
      res.setHeader('Content-Type', 'application/xml');
      if (!sigOk) return res.end('<response><pg_status>error</pg_status><pg_error_description>bad sig</pg_error_description></response>');
      if (script === 'init_payment.php') return res.end(`<?xml version="1.0"?><response><pg_status>ok</pg_status><pg_payment_id>777</pg_payment_id><pg_redirect_url>https://bank.example/pay?id=777</pg_redirect_url></response>`);
      res.end('<response><pg_status>ok</pg_status></response>');
    });
  });
  await new Promise((r) => fake.listen(0, r));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jetkiz-fp-'));
  Object.assign(process.env, {
    DB_FILE: path.join(tmp, 'db.sqlite'), PAYMENT_MODE: 'freedompay', FREEDOMPAY_MERCHANT_ID: '123',
    FREEDOMPAY_SECRET: SECRET, FREEDOMPAY_API: `http://127.0.0.1:${fake.address().port}`, PUBLIC_URL: 'https://jetkiz.test',
  });
  const app = require('../index');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fake.close(); });

const json = async (method, url, body, token) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
};
const callback = async (params) => {
  const { fpSign } = require('../payments');
  const p = { pg_salt: 'abc', ...params };
  p.pg_sig = fpSign('freedompay', p, SECRET);
  const res = await fetch(base + '/payments/callback/freedompay', { method: 'POST', body: new URLSearchParams(p) });
  return res.text();
};

test('счёт → уведомление банка → заказ оплачен → отмена с возвратом', async () => {
  const seller = (await json('POST', '/auth/login', { phone: '77000000004', password: 'seller123' })).data.token;
  const r = await json('POST', '/seller/orders', { buyer_name: 'Ербол', buyer_phone: '77012223344', address: 'ул. Кабанбай батыра, 2', district: 'Есиль', item_desc: 'Кофе', weight_kg: 1, pay_now: true }, seller);
  assert.equal(r.status, 201);
  assert.equal(r.data.pay_url, 'https://bank.example/pay?id=777');
  const init = bank.calls.find((c) => c.script === 'init_payment.php').p;
  assert.equal(init.pg_amount, '750');
  assert.equal(init.pg_currency, 'KZT');
  assert.equal(init.pg_result_url, 'https://jetkiz.test/api/payments/callback/freedompay');
  assert.equal(init.pg_success_url, `https://jetkiz.test/app?paid=${r.data.order.code}`);

  // поддельное уведомление (неверная подпись) — отклоняется
  const forged = await fetch(base + '/payments/callback/freedompay', { method: 'POST', body: new URLSearchParams({ pg_order_id: r.data.invoice, pg_result: '1', pg_amount: '750', pg_sig: 'x' }) });
  assert.match(await forged.text(), /<pg_status>rejected<\/pg_status>/);
  assert.equal((await json('GET', `/track/${r.data.order.code}`)).data.order.status, 'new');

  const reply = await callback({ pg_order_id: r.data.invoice, pg_payment_id: '777', pg_amount: '750', pg_result: '1' });
  assert.match(reply, /<pg_status>ok<\/pg_status>/);
  const sig = reply.match(/<pg_sig>(\w+)<\/pg_sig>/)[1];
  const fields = Object.fromEntries([...reply.matchAll(/<(pg_\w+)>([^<]*)<\/\1>/g)].map((m) => [m[1], m[2]]));
  assert.equal(sig, require('../payments').fpSign('freedompay', fields, SECRET), 'ответ банку подписан');
  assert.equal((await json('GET', `/track/${r.data.order.code}`)).data.order.status, 'ready');

  const c = await json('POST', `/seller/orders/${r.data.order.id}/cancel`, null, seller);
  assert.equal(c.data.order.status, 'cancelled');
  const revoke = bank.calls.find((x) => x.script === 'revoke.php').p;
  assert.equal(revoke.pg_payment_id, '777');
  assert.equal(revoke.pg_refund_amount, '750');
});
