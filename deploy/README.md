# Развёртывание Жеткіз 750 на сервере

Итог: сайт и API по адресу `https://<домен>`, сервер перезапускается сам при сбое и после перезагрузки,
база копируется каждый день в 04:00.

## 1. Что нужно

- **VPS в Казахстане** (персональные данные по закону РК хранятся в РК): например PS.kz или Hoster.kz,
  Ubuntu 22.04 или 24.04, 1 vCPU, 1–2 ГБ RAM, 20 ГБ диска — хватит на старт.
- **Домен**, например `jetkiz750.kz`. В DNS создайте записи `A` для `jetkiz750.kz` и `www.jetkiz750.kz` → IP сервера.

## 2. Установка

```bash
ssh root@<IP-сервера>
apt-get update && apt-get install -y git
git clone https://github.com/dossymsaq/TASY.git /opt/jetkiz750
bash /opt/jetkiz750/deploy/setup.sh jetkiz750.kz you@example.com
```

Если репозиторий приватный — добавьте на GitHub deploy key (Settings → Deploy keys) с ключом сервера
(`ssh-keygen -t ed25519`, затем `cat ~/.ssh/id_ed25519.pub`) и клонируйте по `git@github.com:dossymsaq/TASY.git`.

Скрипт `setup.sh`:
- ставит Node.js 22, nginx, certbot, sqlite3;
- создаёт системного пользователя `jetkiz` и каталог базы `/var/lib/jetkiz750`;
- создаёт файл настроек `/etc/jetkiz750.env` (со случайным `OTP_SECRET`);
- запускает службу `jetkiz750` и таймер бэкапа;
- настраивает nginx, брандмауэр (открыты только SSH, 80, 443) и HTTPS-сертификат Let's Encrypt (продлевается автоматически).

## 3. Настройки

```bash
nano /etc/jetkiz750.env
systemctl restart jetkiz750
```

| Что | Когда |
|---|---|
| `SMS_MODE=mobizon`, `MOBIZON_API_KEY`, `MOBIZON_FROM` | после договора с Mobizon.kz |
| `PAYMENT_MODE=freedompay`, `FREEDOMPAY_MERCHANT_ID`, `FREEDOMPAY_SECRET` | после договора с Freedom Pay; сначала `FREEDOMPAY_TESTING=1`, после тестового платежа — `0` |

**Не принимайте реальные заказы с `PAYMENT_MODE=mock`**: в этом режиме оплату может «подтвердить» кто угодно.

После первого входа смените пароли демо-аккаунтов или заблокируйте их (кабинет админа → «Пользователи»)
и создайте настоящих сотрудников.

## 4. Обслуживание

```bash
systemctl status jetkiz750                # работает ли сервер
journalctl -u jetkiz750 -f                # журнал (ошибки, SMS в тестовом режиме)
bash /opt/jetkiz750/deploy/update.sh      # обновление: бэкап → git pull → перезапуск
bash /opt/jetkiz750/deploy/backup.sh      # внеплановый бэкап
ls /var/backups/jetkiz750                 # копии базы (хранятся 30 дней)
```

**Копии на другом сервере.** Сейчас бэкапы лежат на том же VPS — при потере сервера пропадут и они.
Создайте `/etc/jetkiz750-backup.env` со строкой
`BACKUP_REMOTE=user@backup-host:/backups/jetkiz750` и настройте вход по SSH-ключу на этот хост —
каждая копия будет дополнительно отправляться туда.

**Восстановление из копии:**

```bash
systemctl stop jetkiz750
zcat /var/backups/jetkiz750/data-YYYYMMDD-HHMMSS.sqlite.gz > /var/lib/jetkiz750/data.sqlite
rm -f /var/lib/jetkiz750/data.sqlite-wal /var/lib/jetkiz750/data.sqlite-shm
chown jetkiz:jetkiz /var/lib/jetkiz750/data.sqlite
systemctl start jetkiz750
```

**Мониторинг.** Подключите бесплатный внешний мониторинг (например, UptimeRobot) к адресу
`https://<домен>/api/health` — он пришлёт уведомление, если сайт перестанет отвечать.

## 5. Мобильное приложение

Адрес сервера для сборок задан в `mobile/eas.json` (`EXPO_PUBLIC_API_URL`) — замените `https://jetkiz750.kz` на свой домен.

```bash
cd mobile
npx eas-cli@latest build -p android --profile preview      # APK для проверки на телефонах
npx eas-cli@latest build -p all --profile production       # сборки для Google Play и App Store
```

## Файлы

| Файл | Назначение |
|---|---|
| `setup.sh` | первоначальная установка |
| `update.sh` | обновление до последней версии |
| `backup.sh` | резервная копия базы (с проверкой целостности) |
| `jetkiz750.service` | служба systemd |
| `jetkiz750-backup.service`, `.timer` | ежедневный бэкап в 04:00 |
| `nginx.conf`, `proxy.conf` | nginx: прокси на Node.js, сжатие, ограничение частоты входа |
| `env.example` | шаблон `/etc/jetkiz750.env` |
