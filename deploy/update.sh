#!/usr/bin/env bash
# Обновление до последней версии из git:  sudo bash /opt/jetkiz750/deploy/update.sh
set -euo pipefail
APP=/opt/jetkiz750
cd "$APP"
/opt/jetkiz750/deploy/backup.sh          # копия базы перед обновлением
git pull --ff-only
(cd server && npm ci --omit=dev --no-audit --no-fund)
systemctl restart jetkiz750
sleep 2
curl -fsS http://127.0.0.1:3000/api/health && echo " — сервер работает"
