// Общие функции для сайта
window.J = (() => {
  const store = {
    get token() { try { return localStorage.getItem('jt_token'); } catch { return null; } },
    set token(v) { try { v ? localStorage.setItem('jt_token', v) : localStorage.removeItem('jt_token'); } catch {} },
  };
  async function api(method, url, body) {
    const res = await fetch('/api' + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(store.token ? { Authorization: 'Bearer ' + store.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Ошибка сети'); e.status = res.status; throw e; }
    return data;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₸';
  const phone = (p) => p ? `+${p[0]} ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7, 9)} ${p.slice(9)}` : '';
  const date = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const badge = (o) => `<span class="badge ${esc(o.status)}">${esc(o.status_text)}</span>`;
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.append(t); setTimeout(() => t.remove(), 3000);
  }
  const timeline = (events) => `<ul class="timeline">${events.map((e) => `<li><span class="muted">${date(e.created_at)}</span> — ${esc(e.note || e.status)}</li>`).join('')}</ul>`;
  return { api, esc, money, phone, date, badge, toast, timeline, store };
})();
