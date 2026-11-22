#!/usr/bin/env bash
# Встроенный сервер для мобильного приложения (демо-режим) → mobile/src/demo/backend.generated.js
set -euo pipefail
B=$(cd "$(dirname "$0")" && pwd); R=$(cd "$B/.." && pwd)
rm -rf "$B/srv"; mkdir -p "$B/srv" "$R/mobile/src/demo"
cp $R/server/{index,db,config,payments,sms,push,demo}.js "$B/srv/"
sed -i 's/^if (require.main === module) {/if (false) {/' "$B/srv/index.js"
grep -q '^if (false) {' "$B/srv/index.js"
cd "$B" && { [ -d node_modules ] || npm ci --no-audit --no-fund; }
npx esbuild entry-rn.js --bundle --format=cjs --platform=neutral --main-fields=main --minify --log-level=warning \
  --alias:express=./shims/express.js --alias:node:sqlite=./shims/sqlite.js --alias:node:crypto=./shims/crypto.js \
  --alias:node:path=./shims/path.js --alias:fs=./shims/path.js --alias:path=./shims/path.js --alias:crypto=./shims/crypto.js \
  --inject:./shims/inject.js --define:__dirname='"/srv"' --define:process.env.NODE_ENV='"demo"' \
  --banner:js='globalThis.__DEMO_ENV={NODE_ENV:"demo",SMS_MODE:"mock",PAYMENT_MODE:"mock",PUSH_MODE:"log",LAUNCH_MODE:"soft",PUBLIC_URL:"https://jetkiz750.kz"};' \
  --outfile="$R/mobile/src/demo/backend.generated.js"
echo "OK: mobile/src/demo/backend.generated.js ($(du -k "$R/mobile/src/demo/backend.generated.js" | cut -f1) КБ)"
