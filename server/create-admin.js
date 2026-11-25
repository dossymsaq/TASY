// Создать администратора с паролем (запасной вход, если Telegram ещё не настроен).
// Использование:  node create-admin.js <телефон> <пароль> [имя]
// На Windows:     create-admin-windows.bat
require('./config');
const { db, hashPassword } = require('./db');

const [phoneArg, password, ...nameParts] = process.argv.slice(2);
let phone = String(phoneArg || '').replace(/\D/g, '');
if (phone.length === 11 && phone[0] === '8') phone = '7' + phone.slice(1);
if (!/^7\d{10}$/.test(phone) || !password || password.length < 6) {
  console.log('Использование: node create-admin.js <телефон> <пароль не короче 6 символов> [имя]');
  process.exit(1);
}
const name = nameParts.join(' ') || 'Администратор';
const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin', active = 1, password_hash = ? WHERE id = ?").run(hashPassword(password), existing.id);
  console.log(`Пользователь +${phone} теперь администратор, пароль обновлён.`);
} else {
  db.prepare("INSERT INTO users (role, name, phone, password_hash) VALUES ('admin', ?, ?, ?)").run(name, phone, hashPassword(password));
  console.log(`Создан администратор +${phone}.`);
}
