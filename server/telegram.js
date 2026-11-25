// Telegram-бот: вход по номеру телефона и уведомления.
// Включается переменной TELEGRAM_BOT_TOKEN (токен выдаёт @BotFather).
// Работает через long polling — публичный домен и webhook не нужны.
const { db } = require('./db');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_BASE = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '');
const state = { enabled: !!TOKEN, username: null, running: false, offset: 0 };

async function call(method, params = {}) {
  const res = await fetch(`${API_BASE}/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

const normPhone = (p) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
};

const CONTACT_KEYBOARD = {
  keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]],
  resize_keyboard: true, one_time_keyboard: true,
};

async function send(chatId, text, extra = {}) {
  if (!state.enabled || !chatId) return;
  try { await call('sendMessage', { chat_id: chatId, text, ...extra }); }
  catch (e) { console.error('[telegram]', e.message); }
}

// Уведомление по номеру телефона (если человек подключил бота)
function notifyPhone(phone, text) {
  if (!state.enabled) return;
  const link = db.prepare('SELECT chat_id FROM telegram_links WHERE phone = ?').get(phone);
  if (link) send(link.chat_id, text);
}

async function handleUpdate(u) {
  const m = u.message;
  if (!m || !m.chat || m.chat.type !== 'private') return;
  const chatId = m.chat.id;

  if (m.text && m.text.startsWith('/start')) {
    const token = m.text.split(' ')[1];
    if (token) {
      const r = db.prepare("UPDATE tg_logins SET chat_id = ? WHERE token = ? AND status = 'pending' AND expires_at > datetime('now')").run(chatId, token);
      if (!r.changes) return send(chatId, 'Ссылка для входа устарела. Вернитесь в приложение и нажмите «Войти через Telegram» ещё раз.');
      return send(chatId, 'Жеткіз 750 — вход в аккаунт.\n\nНажмите кнопку ниже, чтобы подтвердить номер телефона.', { reply_markup: CONTACT_KEYBOARD });
    }
    return send(chatId, 'Жеткіз 750 — доставка по Астане до 2 кг.\n\nПоделитесь номером, и мы будем присылать сюда статусы ваших заказов.', { reply_markup: CONTACT_KEYBOARD });
  }

  if (m.contact) {
    // Принимаем только собственный номер пользователя, а не пересланный чужой контакт
    if (!m.from || m.contact.user_id !== m.from.id) return send(chatId, 'Пожалуйста, отправьте свой номер кнопкой «📱 Поделиться номером».', { reply_markup: CONTACT_KEYBOARD });
    const phone = normPhone(m.contact.phone_number);
    db.prepare(`INSERT INTO telegram_links (phone, chat_id, tg_user_id, first_name) VALUES (?,?,?,?)
      ON CONFLICT(phone) DO UPDATE SET chat_id = excluded.chat_id, tg_user_id = excluded.tg_user_id, first_name = excluded.first_name`)
      .run(phone, chatId, m.from.id, m.contact.first_name || m.from.first_name || null);
    const login = db.prepare("SELECT token FROM tg_logins WHERE chat_id = ? AND status = 'pending' AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1").get(chatId);
    if (login) {
      db.prepare("UPDATE tg_logins SET status = 'confirmed', phone = ?, first_name = ? WHERE token = ?").run(phone, m.contact.first_name || null, login.token);
      return send(chatId, '✅ Номер подтверждён. Вернитесь в приложение — вход выполнен.\n\nСюда будут приходить статусы ваших заказов.', { reply_markup: { remove_keyboard: true } });
    }
    return send(chatId, '✅ Готово! Теперь статусы ваших заказов будут приходить сюда.', { reply_markup: { remove_keyboard: true } });
  }

  return send(chatId, 'Я присылаю статусы заказов Жеткіз 750. Чтобы войти, нажмите «Войти через Telegram» на сайте или в приложении.');
}

async function loop() {
  while (state.running) {
    try {
      const updates = await call('getUpdates', { offset: state.offset, timeout: 25, allowed_updates: ['message'] });
      for (const u of updates) {
        state.offset = u.update_id + 1;
        try { await handleUpdate(u); } catch (e) { console.error('[telegram] update', e); }
      }
    } catch (e) {
      if (!state.running) break;
      console.error('[telegram]', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function start() {
  if (!state.enabled || state.running) return;
  try {
    state.username = (await call('getMe')).username;
    try { await call('deleteWebhook'); } catch {}
    state.running = true;
    console.log(`Telegram-бот @${state.username} запущен`);
    loop();
  } catch (e) {
    console.error('[telegram] не удалось запустить бота:', e.message);
  }
}
function stop() { state.running = false; }

module.exports = { start, stop, send, notifyPhone, state };
