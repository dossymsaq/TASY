// Демо-бэкенд в браузере: настоящий код server/ работает поверх SQLite (sql.js), данные — в localStorage
const initSqlJs = require('sql.js/dist/sql-asm.js');
const KEY = 'jt_demo_db_v1';

// окружение задаётся в banner сборки (до загрузки модулей)

const b64 = {
  enc(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
  dec(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); },
};
const load = () => { try { const s = localStorage.getItem(KEY); return s ? b64.dec(s) : null; } catch { return null; } };

let app, dbw;
let canSave = false; // false, пока создаются демо-заказы и после «Начать заново»
let resolveApp; const appReady = new Promise((r) => (resolveApp = r));
const ready = initSqlJs().then(async (SQL) => {
  globalThis.__SQL = SQL;
  const bytes = load();
  globalThis.__DB_BYTES = bytes;
  app = require('./srv/index.js');
  dbw = require('./srv/db.js').db;
  resolveApp();
  if (!bytes) await require('./srv/demo.js')('internal:');
  canSave = true;
  if (!bytes) save();
});

// Сохраняем сразу после каждого изменения (страница может тут же перейти на другую)
// и ещё раз чуть позже — для фоновых записей (журнал уведомлений)
function saveNow() {
  if (!dbw || !canSave) return;
  try { const u8 = dbw.d.export(); dbw.d.exec('PRAGMA foreign_keys = ON'); localStorage.setItem(KEY, b64.enc(u8)); } catch (e) { console.warn('Демо: не удалось сохранить', e.message); }
}
let saveTimer = null;
function save() { saveNow(); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 100); }
addEventListener('pagehide', saveNow);

async function handle(path, init = {}) {
  const url = new URL(path, 'http://demo');
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
  const method = (init.method || 'GET').toUpperCase();
  let body = {};
  if (init.body) { try { body = JSON.parse(init.body); } catch { body = Object.fromEntries(new URLSearchParams(String(init.body))); } }
  const req = { method, url: url.pathname + url.search, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers, params: {}, ip: '127.0.0.1', get: (h) => headers[h.toLowerCase()] };
  return new Promise((resolve) => {
    const out = { status: 200, headers: { 'content-type': 'application/json' }, body: '' };
    const res = {
      get statusCode() { return out.status; },
      status(c) { out.status = c; return res; },
      set(k, v) { out.headers[k.toLowerCase()] = v; return res; },
      type(t) { out.headers['content-type'] = t; return res; },
      json(o) { out.body = JSON.stringify(o); res.end(); },
      send(s) { out.body = typeof s === 'string' ? s : JSON.stringify(s); res.end(); },
      sendStatus(c) { out.status = c; res.end(); },
      sendFile() { out.status = 404; res.end(); },
      end() { resolve(new Response(out.body || null, { status: out.status, headers: out.headers })); if (method !== 'GET') save(); },
    };
    app.handle(req, res, (err) => { if (err) console.error(err); res.status(err ? 500 : 404).json({ error: err ? 'Ошибка сервера' : 'Не найдено' }); });
  });
}

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const s = typeof input === 'string' ? input : input.url;
  if (s.startsWith('internal:')) { await appReady; return handle(s.slice('internal:'.length), init); }
  if (s.startsWith('/api/')) { await ready; return handle(s, init); }
  return realFetch(input, init);
};

// Адреса сервера → страницы демо
globalThis.jdemoUrl = (p, abs) => {
  const u = new URL(p, 'http://demo');
  let m, rel = 'index.html';
  if (u.pathname === '/app') rel = 'app.html' + u.search;
  else if ((m = u.pathname.match(/^\/t\/(\w+)$/))) rel = 'track.html?c=' + m[1] + (u.searchParams.has('paid') ? '&paid=1' : '');
  else if ((m = u.pathname.match(/^\/pay\/mock\/([\w-]+)$/))) rel = 'pay.html?i=' + m[1];
  return abs ? new URL(rel, location.href).href : rel;
};
globalThis.jdemoConfirm = () => true;          // в окне claude.ai системные диалоги не показываются
globalThis.jdemoPrompt = () => 'демо';
globalThis.jdemo = {
  ready,
  async payInfo(invoice) { await ready; return dbw.prepare('SELECT p.invoice, p.amount, p.payer, p.status, o.code FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.invoice = ?').get(invoice); },
  reset() { canSave = false; clearTimeout(saveTimer); try { localStorage.removeItem(KEY); localStorage.removeItem('jt_token'); } catch {} location.href = 'index.html'; },
};

// Плашка «демо» сверху каждой страницы
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.innerHTML = '<span><b>Демо-версия.</b> Оплата и SMS тестовые, данные хранятся только в этом браузере.</span> <button type="button">Начать заново</button>';
  bar.querySelector('button').onclick = () => globalThis.jdemo.reset();
  document.body.prepend(bar);
});
