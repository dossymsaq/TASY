// Встроенный сервер для мобильного приложения в демо-режиме (EXPO_PUBLIC_API_URL=demo).
// Тот же код server/, SQLite через sql.js; база сохраняется функциями save/load, которые передаёт приложение.
// В React Native нет crypto.getRandomValues, а SQLite он нужен — для демо подойдёт Math.random
if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
  globalThis.crypto = Object.assign(globalThis.crypto || {}, {
    getRandomValues(arr) { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 2 ** (arr.BYTES_PER_ELEMENT * 8)); return arr; },
  });
}
const initSqlJs = require('sql.js/dist/sql-asm.js');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64enc(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 3) {
    const n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8) | (u8[i + 2] || 0);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=');
  }
  return s;
}
function b64dec(s) {
  const clean = s.replace(/=+$/, ''); const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    out[o++] = n >> 16; if (o < out.length) out[o++] = (n >> 8) & 255; if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
function parse(path) {
  const [p, q = ''] = path.split('?');
  const query = {};
  for (const kv of q.split('&').filter(Boolean)) { const [k, v = ''] = kv.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
  return { path: p, query };
}

function createDemoBackend({ load, save }) {
  let app, dbw, canSave = false, timer = null;
  let resolveApp; const appReady = new Promise((r) => (resolveApp = r));
  const persist = () => {
    if (!dbw || !canSave) return;
    try { const u8 = dbw.d.export(); dbw.d.exec('PRAGMA foreign_keys = ON'); Promise.resolve(save(b64enc(u8))).catch(() => {}); } catch (e) { console.warn('Демо: не удалось сохранить', e.message); }
  };
  const scheduleSave = () => { clearTimeout(timer); timer = setTimeout(persist, 200); };

  function handle(path, init = {}) {
    const { path: p, query } = parse(path);
    const headers = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
    const method = (init.method || 'GET').toUpperCase();
    let body = {};
    if (init.body) { try { body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; } catch { body = {}; } }
    const req = { method, url: path, path: p, query, body, headers, params: {}, ip: '127.0.0.1', get: (h) => headers[h.toLowerCase()] };
    return new Promise((resolve) => {
      const out = { status: 200, body: '' };
      const res = {
        get statusCode() { return out.status; },
        status(c) { out.status = c; return res; }, set() { return res; }, type() { return res; },
        json(o) { out.body = JSON.stringify(o); res.end(); },
        send(s) { out.body = typeof s === 'string' ? s : JSON.stringify(s); res.end(); },
        sendStatus(c) { out.status = c; res.end(); }, sendFile() { out.status = 404; res.end(); },
        end() { let data = {}; try { data = out.body ? JSON.parse(out.body) : {}; } catch {} resolve({ status: out.status, data }); if (method !== 'GET') scheduleSave(); },
      };
      app.handle(req, res, (err) => { if (err) console.error(err); res.status(err ? 500 : 404).json({ error: err ? 'Ошибка сервера' : 'Не найдено' }); });
    });
  }

  const ready = (async () => {
    const SQL = await initSqlJs();
    globalThis.__SQL = SQL;
    let saved = null;
    try { saved = await load(); } catch {}
    globalThis.__DB_BYTES = saved ? b64dec(saved) : null;
    app = require('./srv/index.js');
    dbw = require('./srv/db.js').db;
    resolveApp();
    if (!saved) await require('./srv/demo.js')('internal:');
    canSave = true;
    if (!saved) persist();
  })();

  // fetch-подобный вызов для demo.js (создание демо-заказов)
  globalThis.fetch = ((realFetch) => async (input, init) => {
    const s = typeof input === 'string' ? input : input.url;
    if (s.startsWith('internal:')) {
      await appReady;
      const r = await handle(s.slice('internal:'.length), init);
      return { ok: r.status < 400, status: r.status, json: async () => r.data };
    }
    return realFetch(input, init);
  })(globalThis.fetch);

  return {
    ready,
    async request(method, path, body, token) {
      await ready;
      return handle('/api' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    },
    async payInfo(invoice) {
      await ready;
      return dbw.prepare('SELECT p.invoice, p.amount, p.payer, p.status, o.code FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.invoice = ?').get(invoice);
    },
    saveNow: persist,
    stop() { canSave = false; clearTimeout(timer); },
  };
}
module.exports = { createDemoBackend };
