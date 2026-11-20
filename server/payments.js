// Платёжный модуль. Схема одинакова для всех провайдеров:
//   1) createInvoice() — создаём счёт у провайдера, получаем ссылку на страницу оплаты;
//   2) клиент платит на странице провайдера;
//   3) провайдер присылает уведомление (callback) на /api/payments/callback/<провайдер>
//      → parseCallback() проверяет подпись → заказ помечается оплаченным;
//   4) refund() — возврат при отмене заказа.
//
// PAYMENT_MODE=mock (по умолчанию) — тестовый провайдер: страница оплаты /pay/mock/<счёт> внутри нашего сервера.
// PAYMENT_MODE=freedompay — Freedom Pay (бывш. PayBox). Переменные: FREEDOMPAY_MERCHANT_ID, FREEDOMPAY_SECRET,
//   FREEDOMPAY_API (по умолчанию https://api.freedompay.kz), FREEDOMPAY_TESTING=1 — тестовый режим у провайдера.
//   ВНИМАНИЕ: адаптер написан по схеме API PayBox/Freedom Pay без доступа к документации —
//   при подключении сверьте имена полей и формулу подписи с документацией, которую выдаст банк,
//   и проведите тестовый платёж в режиме FREEDOMPAY_TESTING=1.
// Kaspi Pay / Halyk ePay подключаются так же: добавьте объект с теми же 4 функциями в PROVIDERS.
const crypto = require('node:crypto');

const MODE = process.env.PAYMENT_MODE || 'mock';

// ---------- тестовый провайдер ----------
const mock = {
  async createInvoice({ invoice }) {
    return { url: `/pay/mock/${invoice}`, provider_ref: null };
  },
  // Тело уведомления от тестовой страницы оплаты: { invoice, result: 'ok' | 'fail' }
  parseCallback(req) {
    const { invoice, result, amount } = req.body || {};
    return { invoice: String(invoice || ''), ok: result === 'ok', amount: amount === undefined ? undefined : Number(amount), provider_ref: `MOCK-${invoice}` };
  },
  reply(res, accepted) { res.json({ ok: accepted }); },
  async refund({ provider_ref }) { return { ok: true, provider_ref }; },
};

// ---------- Freedom Pay ----------
// Подпись: md5( имя_скрипта ; значения параметров, отсортированных по имени ; секретный ключ )
function fpSign(script, params, secret) {
  const values = Object.keys(params).filter((k) => k !== 'pg_sig').sort().map((k) => String(params[k] ?? ''));
  return crypto.createHash('md5').update([script, ...values, secret].join(';')).digest('hex');
}
const xmlField = (xml, tag) => (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1]?.trim();
const xmlEsc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const salt = () => crypto.randomBytes(8).toString('hex');

const freedompay = {
  get cfg() {
    const merchant = process.env.FREEDOMPAY_MERCHANT_ID, secret = process.env.FREEDOMPAY_SECRET;
    if (!merchant || !secret) throw new Error('Не заданы FREEDOMPAY_MERCHANT_ID / FREEDOMPAY_SECRET');
    return { merchant, secret, api: (process.env.FREEDOMPAY_API || 'https://api.freedompay.kz').replace(/\/$/, ''), testing: process.env.FREEDOMPAY_TESTING === '1' };
  },
  async call(script, params) {
    const c = this.cfg;
    const p = { pg_merchant_id: c.merchant, pg_salt: salt(), ...params };
    p.pg_sig = fpSign(script, p, c.secret);
    const res = await fetch(`${c.api}/${script}`, { method: 'POST', body: new URLSearchParams(p), signal: AbortSignal.timeout(15000) });
    const xml = await res.text();
    if (xmlField(xml, 'pg_status') !== 'ok') throw new Error(`Freedom Pay: ${xmlField(xml, 'pg_error_description') || xmlField(xml, 'pg_description') || 'HTTP ' + res.status}`);
    return xml;
  },
  async createInvoice({ invoice, amount, description, resultUrl, successUrl, failureUrl, phone }) {
    const xml = await this.call('init_payment.php', {
      pg_order_id: invoice, pg_amount: amount, pg_currency: 'KZT', pg_description: description,
      pg_result_url: resultUrl, pg_success_url: successUrl, pg_failure_url: failureUrl,
      pg_request_method: 'POST', ...(phone ? { pg_user_phone: phone } : {}),
      ...(this.cfg.testing ? { pg_testing_mode: 1 } : {}),
    });
    return { url: xmlField(xml, 'pg_redirect_url'), provider_ref: xmlField(xml, 'pg_payment_id') };
  },
  // Имя скрипта для подписи уведомления — последний сегмент адреса result_url («freedompay»)
  parseCallback(req) {
    const p = { ...req.query, ...req.body };
    const script = req.path.split('/').pop();
    if (!p.pg_sig || p.pg_sig !== fpSign(script, p, this.cfg.secret)) return { invalid: true };
    return { invoice: String(p.pg_order_id || ''), ok: String(p.pg_result) === '1', amount: Number(p.pg_amount), provider_ref: p.pg_payment_id };
  },
  reply(res, accepted, script = 'freedompay') {
    const r = { pg_status: accepted ? 'ok' : 'rejected', pg_description: accepted ? 'Оплата принята' : 'Платёж отклонён', pg_salt: salt() };
    r.pg_sig = fpSign(script, r, this.cfg.secret);
    res.type('application/xml').send(`<?xml version="1.0" encoding="utf-8"?><response>${Object.entries(r).map(([k, v]) => `<${k}>${xmlEsc(v)}</${k}>`).join('')}</response>`);
  },
  async refund({ provider_ref, amount }) {
    await this.call('revoke.php', { pg_payment_id: provider_ref, pg_refund_amount: amount });
    return { ok: true, provider_ref };
  },
};

const PROVIDERS = { mock, freedompay };
const provider = PROVIDERS[MODE];
if (!provider) throw new Error(`Неизвестный PAYMENT_MODE: ${MODE}`);

module.exports = { MODE, provider, PROVIDERS, fpSign };
