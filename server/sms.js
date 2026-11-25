// Отправка SMS.
// SMS_MODE=mock (по умолчанию) — SMS не отправляются, код пишется в консоль сервера
//   и возвращается в ответе API (поле dev_code) — только для разработки!
// SMS_MODE=mobizon — отправка через Mobizon (mobizon.kz), нужен MOBIZON_API_KEY.
//   Интеграция написана по документации Mobizon и ещё не проверена на реальном ключе.
// SMS_MODE=off — вход по SMS выключен.
// В рабочем режиме (DEMO=0) тестовый режим mock запрещён: иначе любой мог бы войти под чужим номером.
const { DEMO } = require('./config');
let MODE = process.env.SMS_MODE || (DEMO ? 'mock' : 'off');
if (MODE === 'mock' && !DEMO) MODE = 'off';

async function sendSms(phone, text) {
  if (MODE === 'mock') {
    console.log(`[SMS → +${phone}] ${text}`);
    return { ok: true };
  }
  if (MODE === 'mobizon') {
    const key = process.env.MOBIZON_API_KEY;
    if (!key) throw new Error('MOBIZON_API_KEY не задан');
    const url = `https://api.mobizon.kz/service/Message/SendSmsMessage?output=json&api=v1&apiKey=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ recipient: phone, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.code !== 0) throw new Error('SMS не отправлено: ' + (data.message || res.status));
    return { ok: true };
  }
  throw new Error('Неизвестный SMS_MODE');
}

module.exports = { sendSms, MODE };
