// Создание администратора (или смена пароля существующему).
//   npm run create-admin
// На сервере:
//   cd /opt/jetkiz750/server && sudo -u jetkiz DB_FILE=/var/lib/jetkiz750/data.sqlite NODE_ENV=production npm run create-admin
// Можно без вопросов: ADMIN_PHONE=77011234567 ADMIN_NAME="Имя" ADMIN_PASSWORD=... npm run create-admin
const readline = require('node:readline/promises');
const { db, hashPassword } = require('./db');

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return /^7\d{10}$/.test(d) ? d : null;
}

(async () => {
  const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q, env) => process.env[env] || (rl ? (await rl.question(q)).trim() : '');
  const phone = normPhone(await ask('Телефон администратора (+7 7XX XXX XX XX): ', 'ADMIN_PHONE'));
  if (!phone) { console.error('Неверный телефон'); process.exit(1); }
  const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  const name = existing ? existing.name : await ask('Имя: ', 'ADMIN_NAME');
  if (!name) { console.error('Укажите имя'); process.exit(1); }
  const password = await ask('Пароль (не меньше 10 символов): ', 'ADMIN_PASSWORD');
  rl?.close();
  if (password.length < 10) { console.error('Пароль слишком короткий — нужно не меньше 10 символов'); process.exit(1); }
  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', password_hash = ?, active = 1 WHERE id = ?").run(hashPassword(password), existing.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    console.log(`Готово: ${phone} теперь администратор, пароль обновлён.`);
  } else {
    db.prepare("INSERT INTO users (role, name, phone, password_hash) VALUES ('admin', ?, ?, ?)").run(name, phone, hashPassword(password));
    console.log(`Готово: создан администратор ${name}, ${phone}.`);
  }
})();
