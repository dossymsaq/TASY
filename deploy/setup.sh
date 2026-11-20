#!/usr/bin/env bash
# Первоначальная установка Жеткіз 750 на чистый VPS с Ubuntu 22.04/24.04.
# Код должен лежать в /opt/jetkiz750 (git clone ... /opt/jetkiz750).
#
#   sudo bash /opt/jetkiz750/deploy/setup.sh jetkiz750.kz you@example.com
#
# Скрипт можно запускать повторно — он ничего не ломает.
set -euo pipefail

DOMAIN="${1:?Укажите домен: setup.sh jetkiz750.kz you@example.com}"
EMAIL="${2:?Укажите e-mail для HTTPS-сертификата}"
APP=/opt/jetkiz750
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
[ -f "$APP/server/index.js" ] || { echo "Не найден $APP/server/index.js — сначала склонируйте репозиторий в $APP"; exit 1; }

echo "== Пакеты"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg nginx certbot python3-certbot-nginx sqlite3 ufw
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -e 'require("node:sqlite")' || { echo "Нужен Node.js 22.13 или новее"; exit 1; }

echo "== Пользователь и каталоги"
id jetkiz >/dev/null 2>&1 || useradd --system --home /var/lib/jetkiz750 --shell /usr/sbin/nologin jetkiz
install -d -o jetkiz -g jetkiz -m 750 /var/lib/jetkiz750
install -d -m 700 /var/backups/jetkiz750

echo "== Зависимости"
(cd "$APP/server" && npm ci --omit=dev --no-audit --no-fund)
chmod +x "$APP/deploy/"*.sh

echo "== Настройки"
if [ ! -f /etc/jetkiz750.env ]; then
  sed -e "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" -e "s#^OTP_SECRET=.*#OTP_SECRET=$(openssl rand -hex 32)#" \
    "$APP/deploy/env.example" > /etc/jetkiz750.env
  chmod 600 /etc/jetkiz750.env
  echo "Создан /etc/jetkiz750.env — заполните ключи SMS и платежей"
fi

echo "== Служба systemd"
cp "$APP/deploy/jetkiz750.service" "$APP/deploy/jetkiz750-backup.service" "$APP/deploy/jetkiz750-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now jetkiz750 jetkiz750-backup.timer
systemctl restart jetkiz750

echo "== nginx"
cp "$APP/deploy/proxy.conf" /etc/nginx/jetkiz750-proxy.conf
if [ ! -f /etc/nginx/sites-available/jetkiz750 ]; then
  sed "s/DOMAIN/$DOMAIN/g" "$APP/deploy/nginx.conf" > /etc/nginx/sites-available/jetkiz750
fi
ln -sf /etc/nginx/sites-available/jetkiz750 /etc/nginx/sites-enabled/jetkiz750
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "== Брандмауэр"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "== HTTPS (Let's Encrypt)"
# Домен (и www) уже должен указывать на IP этого сервера
certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN" -d "www.$DOMAIN" \
  || echo "!! Сертификат не получен. Проверьте DNS-записи A для $DOMAIN и www.$DOMAIN и запустите скрипт ещё раз."

echo "== Проверка"
sleep 2
curl -fsS http://127.0.0.1:3000/api/health && echo
echo "Готово: https://$DOMAIN"
echo "Дальше: 1) заполните /etc/jetkiz750.env и выполните: systemctl restart jetkiz750"
echo "        2) смените пароли демо-аккаунтов (или заблокируйте их в кабинете админа)"
