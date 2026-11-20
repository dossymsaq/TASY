// Push-уведомления в мобильное приложение через Expo Push Service (https://exp.host).
// Ключи не нужны; при включённой в Expo защите задайте EXPO_ACCESS_TOKEN.
// PUSH_MODE=expo (по умолчанию) — отправка; PUSH_MODE=log — только запись в журнал (для тестов и разработки).
const { db } = require('./db');

const MODE = process.env.PUSH_MODE || 'expo';
const TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]{10,200}\]$/;

const tokensOf = (userIds) => (userIds.length
  ? db.prepare(`SELECT token FROM push_tokens WHERE user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds).map((r) => r.token)
  : []);
const log = db.prepare("INSERT INTO notifications (phone, kind, text, status, error) VALUES (?, 'push', ?, ?, ?)");

async function deliver(messages) {
  if (MODE === 'log') return messages.map(() => ({ status: 'ok' }));
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.data)) throw new Error(data.errors?.[0]?.message || `Expo push HTTP ${res.status}`);
  return data.data;
}

// Отправляет push всем устройствам пользователей. Возвращает число устройств, на которые ушло сообщение.
async function sendToUsers(userIds, { title, body, data = {} }, label = '') {
  const tokens = tokensOf(userIds);
  if (!tokens.length) return 0;
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 100) { // Expo принимает до 100 сообщений за запрос
    const chunk = tokens.slice(i, i + 100);
    try {
      const tickets = await deliver(chunk.map((to) => ({ to, title, body, data, sound: 'default', priority: 'high', channelId: 'orders' })));
      tickets.forEach((t, k) => {
        if (t.status === 'ok') sent++;
        // Приложение удалено или токен устарел — больше не отправляем на это устройство
        else if (t.details?.error === 'DeviceNotRegistered') db.prepare('DELETE FROM push_tokens WHERE token = ?').run(chunk[k]);
      });
    } catch (e) { console.error('Push не отправлен:', e.message); log.run(label, `${title}: ${body}`, 'failed', e.message); }
  }
  if (sent) log.run(label, `${title}: ${body}`, MODE === 'log' ? 'mock' : 'sent', null);
  return sent;
}

function saveToken(userId, token, platform) {
  if (!TOKEN_RE.test(String(token || ''))) return false;
  db.prepare(`INSERT INTO push_tokens (token, user_id, platform) VALUES (?,?,?)
    ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = datetime('now')`).run(token, userId, String(platform || '').slice(0, 20));
  return true;
}
const removeToken = (token) => db.prepare('DELETE FROM push_tokens WHERE token = ?').run(String(token || ''));
const hasTokens = (userId) => !!db.prepare('SELECT 1 FROM push_tokens WHERE user_id = ?').get(userId);

module.exports = { MODE, sendToUsers, saveToken, removeToken, hasTokens };
