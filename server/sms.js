// Отправка SMS: коды входа и уведомления о статусе заказа.
// SMS_MODE=mock (по умолчанию) — сообщения не уходят, а пишутся в консоль и в таблицу notifications
//   (админ видит их в кабинете). Код входа в этом режиме возвращается в ответе API, чтобы можно было тестировать.
// SMS_MODE=mobizon — отправка через Mobizon.kz. Нужны переменные:
//   MOBIZON_API_KEY — ключ из кабинета Mobizon, MOBIZON_FROM — согласованное имя отправителя (необязательно).
const { db } = require('./db');

const MODE = process.env.SMS_MODE || 'mock';

async function deliver(phone, text) {
  if (MODE === 'mock') { console.log(`[SMS → +${phone}] ${text}`); return; }
  if (MODE === 'mobizon') {
    const key = process.env.MOBIZON_API_KEY;
    if (!key) throw new Error('MOBIZON_API_KEY не задан');
    const body = new URLSearchParams({ recipient: phone, text });
    if (process.env.MOBIZON_FROM) body.set('from', process.env.MOBIZON_FROM);
    const res = await fetch(`https://api.mobizon.kz/service/message/sendsmsmessage?output=json&api=v1&apiKey=${encodeURIComponent(key)}`, {
      method: 'POST', body, signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.code !== 0) throw new Error(data.message || `Mobizon HTTP ${res.status}`);
    return;
  }
  throw new Error(`Неизвестный SMS_MODE: ${MODE}`);
}

const log = db.prepare('INSERT INTO notifications (phone, kind, text, status, error) VALUES (?,?,?,?,?)');

// Отправляет SMS и записывает результат в журнал. Не бросает ошибок, если throwOnError=false.
async function send(phone, text, { kind = 'status', throwOnError = false } = {}) {
  try {
    await deliver(phone, text);
    // Коды входа не храним в журнале открытым текстом
    log.run(phone, kind, kind === 'otp' ? text.replace(/\d{4,}/g, '••••') : text, MODE === 'mock' ? 'mock' : 'sent', null);
    return true;
  } catch (e) {
    console.error('SMS не отправлено:', e.message);
    log.run(phone, kind, kind === 'otp' ? 'Код входа' : text, 'failed', e.message);
    if (throwOnError) throw e;
    return false;
  }
}

// Фоновая отправка — не задерживает ответ API
const notify = (phone, text) => { if (phone) send(phone, text).catch(() => {}); };

module.exports = { send, notify, MODE };
