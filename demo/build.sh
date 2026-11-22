#!/usr/bin/env bash
set -euo pipefail
B=$(cd "$(dirname "$0")" && pwd); R=$(cd "$B/.." && pwd); OUT=$B/out
rm -rf "$B/srv" "$OUT"; mkdir -p "$B/srv" "$OUT"
cp $R/server/{index,db,config,payments,sms,push,demo}.js "$B/srv/"
sed -i 's/^if (require.main === module) {/if (false) {/' "$B/srv/index.js"
grep -q '^if (false) {' "$B/srv/index.js"
cd "$B" && [ -d node_modules ] || npm ci --no-audit --no-fund
cd "$B" && npx esbuild entry.js --bundle --format=iife --platform=browser --minify --log-level=warning \
  --alias:express=./shims/express.js --alias:node:sqlite=./shims/sqlite.js --alias:node:crypto=./shims/crypto.js \
  --alias:node:path=./shims/path.js --alias:fs=./shims/path.js --alias:path=./shims/path.js --alias:crypto=./shims/crypto.js \
  --inject:./shims/inject.js --define:__dirname='"/srv"' --define:process.env.NODE_ENV='"demo"' --banner:js='globalThis.__DEMO_ENV={NODE_ENV:"demo",SMS_MODE:"mock",PAYMENT_MODE:"mock",PUSH_MODE:"log",PUBLIC_URL:location.origin};' --outfile="$OUT/backend.js"
python3 "$B/transform.py" "$R/web" "$OUT"
