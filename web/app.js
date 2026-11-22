// Личные кабинеты: продавец, покупатель, курьер, администратор, поддержка
const { api, esc, money, phone, date, badge, toast, timeline, store } = J;
const $view = document.getElementById('view');
const $tabs = document.getElementById('tabs');
const $dlg = document.getElementById('dlg');
const $dlgBody = document.getElementById('dlgBody');
const S = { user: null, cfg: null, tab: null };

const ROLE_NAMES = { seller: 'Продавец', client: 'Покупатель', courier: 'Курьер', admin: 'Администратор', support: 'Поддержка' };
const TABS = {
  seller: [['new', 'Новый заказ'], ['orders', 'Мои заказы'], ['support', 'Поддержка'], ['profile', 'Профиль']],
  client: [['orders', 'Мои посылки'], ['support', 'Поддержка'], ['profile', 'Профиль']],
  courier: [['available', 'Доступные'], ['mine', 'Мои доставки'], ['done', 'История'], ['support', 'Поддержка'], ['profile', 'Профиль']],
  admin: [['dash', 'Обзор'], ['orders', 'Заказы'], ['couriers', 'Курьеры'], ['users', 'Пользователи'], ['tickets', 'Обращения'], ['sms', 'Уведомления'], ['profile', 'Профиль']],
  support: [['tickets', 'Обращения'], ['orders', 'Поиск заказа'], ['profile', 'Профиль']],
};

// ---------- helpers ----------
const formData = (f) => Object.fromEntries(new FormData(f));
const shareText = (o) => `Здравствуйте! Ваш заказ из «${S.user.shop_name}» будет доставлен курьером Жеткіз 750. Оплата доставки ${money(S.cfg.price_buyer)} и отслеживание: ${location.origin}/t/${o.code}`;
function openDialog(html) { $dlgBody.innerHTML = html; $dlg.showModal(); }
$dlg.addEventListener('click', (e) => { if (e.target === $dlg || e.target.closest('[data-close]')) $dlg.close(); });

function orderCard(o, extra = '') {
  return `<div class="card order">
    <div class="row between"><span class="code">${esc(o.code)}</span>${badge(o)}</div>
    <div><b>${esc(o.buyer_name)}</b> · <a href="tel:+${esc(o.buyer_phone)}">${phone(o.buyer_phone)}</a></div>
    <div class="small">📦 ${esc(o.item_desc)} · ${o.weight_kg} кг</div>
    <div class="small">🏬 Забор: ${esc(o.pickup_address)}${o.seller ? ` (${esc(o.seller.shop_name || o.seller.name)})` : ''}</div>
    <div class="small">📍 ${esc(o.address)}, р-н ${esc(o.district)}</div>
    ${o.comment ? `<div class="small muted">💬 ${esc(o.comment)}</div>` : ''}
    <div class="small">Продавец: <span class="${o.seller_paid ? 'paid' : 'unpaid'}">${o.seller_paid ? 'оплачено' : 'не оплачено'}</span> ·
      Покупатель: <span class="${o.buyer_paid ? 'paid' : 'unpaid'}">${o.buyer_paid ? 'оплачено' : 'не оплачено'}</span></div>
    ${o.courier ? `<div class="small">🛵 ${esc(o.courier.name)} · ${phone(o.courier.phone)}</div>` : ''}
    <details><summary>История</summary>${timeline(o.events)}</details>
    ${extra ? `<div class="row">${extra}</div>` : ''}
  </div>`;
}
const list = (items, fn, empty) => items.length ? `<div class="grid">${items.map(fn).join('')}</div>` : `<div class="card muted">${empty}</div>`;

// Делегирование действий
const actions = {};
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  el.disabled = true;
  try { await actions[el.dataset.act](el.dataset, el); }
  catch (err) { toast(err.message); }
  finally { el.disabled = false; }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const err = f.querySelector('.err'); if (err) err.textContent = '';
  const btn = f.querySelector('button[type=submit],button:not([type])'); if (btn) btn.disabled = true;
  try { await forms[f.dataset.form](formData(f), f); }
  catch (ex) { if (err) err.textContent = ex.message; else toast(ex.message); }
  finally { if (btn) btn.disabled = false; }
});

// ---------- auth ----------
// Четыре входа: владелец и курьер — по паролю; продавец и клиент — по SMS-коду.
// Продавец работает по договору: новый продавец подаёт заявку, владелец её одобряет.
// Прямые ссылки: /app#owner, /app#seller, /app#register-seller, /app#client, /app#courier
const AUTH_HASH = { '#owner': 'owner', '#seller': 'seller', '#register-seller': 'seller-apply', '#client': 'client', '#courier': 'courier' };
const ROLE_CARDS = [
  ['owner', 'Владелец', 'Управление сервисом, выручка, курьеры и продавцы', 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
  ['seller', 'Продавец', 'Для магазинов, которые работают с нами по договору', 'M4 7h16l-1 13H5zM8 7a4 4 0 0 1 8 0'],
  ['client', 'Клиент', 'Посылки, отправленные на ваш номер, и их статус', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6'],
  ['courier', 'Курьер', 'Заказы, маршруты, вручение и наличные', 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
];
const demoHint = (txt) => (S.cfg?.sms_mode === 'mock' ? `<p class="small muted" style="margin:0">Демо: ${txt}</p>` : '');
function authView(mode = AUTH_HASH[location.hash] || 'choose') {
  $tabs.innerHTML = '';
  document.getElementById('who').textContent = '';
  const back = '<p class="small" style="margin:0"><a href="#" data-act="authMode" data-m="choose">← Выбрать другой вход</a></p>';
  const phoneField = '<div><label for="aPhone">Телефон</label><input id="aPhone" name="phone" type="tel" placeholder="+7 7XX XXX XX XX" autocomplete="tel" required></div>';
  const codeField = '<div data-code hidden><label for="aCode">Код из SMS</label><input id="aCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{4,6}"></div>';
  const legal = '<p class="small muted" style="margin:0">Продолжая, вы принимаете условия <a href="/offer" target="_blank">публичной оферты</a> и <a href="/privacy" target="_blank">политики конфиденциальности</a>.</p>';
  const otpTail = `<div class="err"></div><button class="btn block">Получить код по SMS</button>${legal}<p class="small" data-resend hidden><a href="#" data-act="otpResend">Отправить код ещё раз</a></p>`;
  const passwordForm = (title, note, hint) => `<h2 style="margin:0">${title}</h2><p class="small muted" style="margin:0">${note}</p>
    <form data-form="login" class="stack">${phoneField}
      <div><label for="aPass">Пароль</label><input id="aPass" name="password" type="password" autocomplete="current-password" required></div>
      <div class="err"></div><button class="btn block">Войти</button>${demoHint(hint)}</form>${back}`;
  const views = {
    choose: `<h2 style="margin:0">Вход в Жеткіз 750</h2><p class="muted" style="margin:0">Выберите, кто вы:</p>
      <div class="role-grid">${ROLE_CARDS.map(([m, t, d, icon]) => `<a href="#${m}" class="role-card" data-act="authMode" data-m="${m}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg><b>${t}</b><span>${d}</span></a>`).join('')}</div>`,
    owner: passwordForm('Вход для владельца', 'Сотрудники поддержки входят здесь же.', 'владелец 77000000001 / admin123, поддержка 77000000002 / support123'),
    courier: passwordForm('Вход для курьера', 'Логин и пароль выдаёт владелец сервиса.', 'курьер 77000000003 / courier123'),
    seller: `<h2 style="margin:0">Вход для продавца</h2><p class="small muted" style="margin:0">Для магазинов, работающих с нами по договору.</p>
      <form data-form="otp" data-kind="seller-login" class="stack"><input type="hidden" name="role" value="seller">${phoneField}${codeField}${otpTail}</form>
      <p class="small" style="margin:0">Ещё не работаете с нами? <a href="#register-seller" data-act="authMode" data-m="seller-apply">Подать заявку на подключение</a></p>
      ${demoHint('продавец 77000000004 — код подставится сам')}${back}`,
    'seller-apply': `<h2 style="margin:0">Заявка на подключение</h2><p class="small muted" style="margin:0">Доставка по Астане — 750 ₸, посылки до 2 кг. После заявки мы свяжемся с вами и заключим договор — затем откроем оформление доставок.</p>
      <form data-form="otp" data-kind="seller-apply" class="stack"><input type="hidden" name="role" value="seller">
        <div><label for="aName">Ваше имя</label><input id="aName" name="name" required></div>${phoneField}
        <div><label for="aShop">Название магазина</label><input id="aShop" name="shop_name" required></div>
        <div><label for="aAddr">Адрес, откуда забирать товар</label><input id="aAddr" name="pickup_address" placeholder="Улица, дом, офис" required></div>
        ${codeField}${otpTail}</form>
      <p class="small" style="margin:0">Уже подключены? <a href="#seller" data-act="authMode" data-m="seller">Войти</a></p>${back}`,
    client: `<h2 style="margin:0">Вход для клиента</h2><p class="small muted" style="margin:0">Посылки, отправленные на ваш номер, появятся в кабинете автоматически.</p>
      <form data-form="otp" data-kind="client" class="stack"><input type="hidden" name="role" value="client">
        <div data-profile hidden><label for="aName">Ваше имя</label><input id="aName" name="name"></div>${phoneField}${codeField}${otpTail}</form>
      ${demoHint('клиент 77000000005 — код подставится сам')}${back}`,
  };
  $view.innerHTML = `${JInstall.banner()}<div class="card stack" style="max-width:520px;margin:24px auto">${views[mode] || views.choose}</div>`;
}
actions.authMode = (d) => { history.replaceState(null, '', d.m === 'choose' ? location.pathname + location.search : (d.m === 'seller-apply' ? '#register-seller' : '#' + d.m)); authView(d.m); };
const forms = {};
forms.login = async (f) => { const r = await api('POST', '/auth/login', f); store.token = r.token; start(); };

async function otpSend(form) {
  const r = await api('POST', '/auth/otp/request', { phone: form.phone.value });
  const codeBox = form.querySelector('[data-code]');
  codeBox.hidden = false; codeBox.querySelector('input').required = true;
  form.querySelector('[data-resend]').hidden = false;
  form.querySelector('button.btn').textContent = form.dataset.kind === 'seller-apply' ? 'Отправить заявку' : 'Войти';
  form.phone.readOnly = true;
  if (r.dev_code) { form.code.value = r.dev_code; toast(`Тестовый режим: код ${r.dev_code}`); } else form.code.focus();
}
forms.otp = async (f, form) => {
  if (form.querySelector('[data-code]').hidden) return otpSend(form);
  const kind = form.dataset.kind;
  const body = kind === 'seller-login' ? { phone: f.phone, code: f.code } : f;
  const r = await api('POST', '/auth/otp/verify', body);
  if (r.need_profile) {
    if (kind === 'seller-login') { // номера нет — предложим заявку, код уже проверен
      authView('seller-apply'); history.replaceState(null, '', '#register-seller');
      const nf = document.querySelector('form[data-kind="seller-apply"]');
      nf.phone.value = f.phone; nf.phone.readOnly = true; nf.code.value = f.code;
      nf.querySelector('[data-code]').hidden = false; nf.querySelector('[data-resend]').hidden = false;
      nf.querySelector('button.btn').textContent = 'Отправить заявку';
      nf.querySelector('.err').textContent = 'Этот номер ещё не подключён. Заполните заявку — код уже подтверждён.';
      return;
    }
    const box = form.querySelector('[data-profile]');
    box.hidden = false; box.querySelector('input').required = true; box.querySelector('input').focus();
    form.querySelector('.err').textContent = 'Номер новый — укажите имя, чтобы создать кабинет.';
    return;
  }
  store.token = r.token; history.replaceState(null, '', '/app'); start();
};
actions.otpResend = async (d, el) => { await otpSend(el.closest('form')); toast('Код отправлен'); };
actions.logout = async () => { try { await api('POST', '/auth/logout'); } catch {} store.token = null; S.user = null; authView('choose'); };

// ---------- layout ----------
function renderTabs() {
  $tabs.innerHTML = TABS[S.user.role].map(([k, t]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-k="${k}">${t}</button>`).join('');
  document.getElementById('who').textContent = `${S.user.name} · ${ROLE_NAMES[S.user.role]}`;
}
actions.tab = (d) => go(d.k);
async function go(tab) {
  S.tab = tab; renderTabs();
  const view = VIEWS[S.user.role][tab] || VIEWS.common[tab];
  $view.innerHTML = '<p class="muted">Загрузка…</p>';
  try { $view.innerHTML = await view(); }
  catch (e) { if (e.status === 401) { store.token = null; return authView(); } $view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}
const reload = () => go(S.tab);

// ---------- common views ----------
const VIEWS = { common: {} };
VIEWS.common.profile = async () => {
  const u = S.user;
  return `<div class="card" style="max-width:520px">
    <h2>Профиль</h2>
    <form data-form="profile" class="stack">
      <div><label>Имя</label><input name="name" value="${esc(u.name)}" required></div>
      <div><label>Телефон</label><input value="${phone(u.phone)}" disabled></div>
      ${u.role === 'seller' ? `
        <div><label>Магазин</label><input name="shop_name" value="${esc(u.shop_name)}" required></div>
        <div><label>Адрес забора по умолчанию</label><input name="pickup_address" value="${esc(u.pickup_address)}" required></div>` : ''}
      <div class="err"></div>
      <div class="row"><button class="btn">Сохранить</button><button type="button" class="btn ghost" data-act="logout">Выйти</button></div>
    </form>
    ${['seller', 'client'].includes(u.role) ? `<details style="margin-top:24px"><summary class="small muted">Удалить аккаунт</summary>
      <div class="stack" style="margin-top:12px">
        <p class="small" style="margin:0">Имя, телефон и адрес будут стёрты, войти в этот аккаунт больше не получится. История доставок сохранится без ваших личных данных — её мы обязаны хранить по закону.${u.role === 'seller' ? ' Неоплаченные заказы будут отменены.' : ''}</p>
        <div><label for="delConfirm">Чтобы подтвердить, введите слово УДАЛИТЬ</label><input id="delConfirm" autocomplete="off"></div>
        <div class="err" id="delErr"></div>
        <div><button type="button" class="btn" style="background:var(--bad)" data-act="deleteAccount">Удалить аккаунт навсегда</button></div>
      </div></details>` : ''}
  </div>`;
};
actions.deleteAccount = async () => {
  const err = document.getElementById('delErr'); err.textContent = '';
  try { await api('DELETE', '/me', { confirm: document.getElementById('delConfirm').value.trim().toUpperCase() }); }
  catch (e) { err.textContent = e.message === 'Подтвердите удаление' ? 'Введите слово УДАЛИТЬ' : e.message; return; }
  store.token = null; S.user = null; authView('choose'); toast('Аккаунт удалён');
};
forms.profile = async (f) => { S.user = (await api('PATCH', '/me', f)).user; toast('Сохранено'); renderTabs(); };

// Поддержка для клиентов/продавцов/курьеров
VIEWS.common.support = async () => {
  const { tickets } = await api('GET', '/tickets');
  return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="card"><h2>Новое обращение</h2>
      <form data-form="newTicket" class="stack">
        <div><label>Тема</label><input name="subject" required></div>
        <div><label>Код заказа (если есть)</label><input name="order_code" placeholder="Необязательно"></div>
        <div><label>Сообщение</label><textarea name="message" required></textarea></div>
        <div class="err"></div><button class="btn">Отправить</button>
      </form></div>
    <div class="stack"><h2>Мои обращения</h2>${ticketRows(tickets)}</div>
  </div>`;
};
forms.newTicket = async (f) => { if (!f.order_code) delete f.order_code; await api('POST', '/tickets', f); toast('Обращение отправлено'); reload(); };
const TSTATUS = { open: ['Ожидает ответа', 'new'], answered: ['Есть ответ', 'ready'], closed: ['Закрыто', 'delivered'] };
function ticketRows(tickets) {
  if (!tickets.length) return '<div class="card muted">Обращений пока нет</div>';
  return tickets.map((t) => `<div class="card" style="cursor:pointer" data-act="openTicket" data-id="${t.id}">
    <div class="row between"><b>#${t.id} ${esc(t.subject)}</b><span class="badge ${TSTATUS[t.status][1]}">${TSTATUS[t.status][0]}</span></div>
    <div class="small muted">${esc(t.contact_name || '')} ${t.contact_phone ? '· ' + phone(t.contact_phone) : ''} ${t.order_code ? '· заказ ' + esc(t.order_code) : ''} · ${date(t.updated_at)}</div>
    <div class="small">${esc((t.last_message || '').slice(0, 140))}</div></div>`).join('');
}
actions.openTicket = async (d) => {
  const { ticket: t, messages, order } = await api('GET', `/tickets/${d.id}`);
  const isStaff = ['support', 'admin'].includes(S.user.role);
  openDialog(`<div class="row between"><h3 style="margin:0">#${t.id} ${esc(t.subject)}</h3><button class="btn ghost sm" data-close>✕</button></div>
    <p class="small muted">${esc(t.contact_name || '')} · ${phone(t.contact_phone)} ${t.order_code ? '· заказ ' + esc(t.order_code) : ''}</p>
    ${order ? `<details style="margin-bottom:12px"><summary>Заказ ${esc(order.code)} — ${esc(order.status_text)}</summary>${orderCard(order)}</details>` : ''}
    <div class="chat">${messages.map((m) => `<div class="msg ${['support', 'admin'].includes(m.author_role) ? 'staff' : ''}">
      <div class="who">${esc(m.author_name || ROLE_NAMES[m.author_role] || 'Гость')} · ${date(m.created_at)}</div>${esc(m.body)}</div>`).join('')}</div>
    ${t.status !== 'closed' || isStaff ? `<form data-form="reply" data-id="${t.id}" class="stack" style="margin-top:12px">
      <textarea name="message" placeholder="Ваш ответ" required></textarea><div class="err"></div>
      <div class="row"><button class="btn">Отправить</button>${t.status !== 'closed' ? `<button type="button" class="btn ghost" data-act="closeTicket" data-id="${t.id}">Закрыть обращение</button>` : ''}</div>
    </form>` : '<p class="muted">Обращение закрыто</p>'}`);
  const chat = $dlgBody.querySelector('.chat'); chat.scrollTop = chat.scrollHeight;
};
forms.reply = async (f, form) => { await api('POST', `/tickets/${form.dataset.id}/messages`, f); await actions.openTicket({ id: form.dataset.id }); if (S.tab.includes('ticket') || S.tab === 'support') reload(); };
actions.closeTicket = async (d) => { await api('POST', `/tickets/${d.id}/close`); $dlg.close(); reload(); };

// ---------- продавец ----------
const pendingNote = () => `<div class="card stack" style="max-width:760px;border-color:var(--sun)"><h2 style="margin:0">Заявка на рассмотрении</h2>
  <p style="margin:0">Спасибо, ${esc(S.user.name)}! Мы получили заявку магазина «${esc(S.user.shop_name || '')}». Менеджер свяжется с вами по номеру ${phone(S.user.phone)}, чтобы заключить договор.</p>
  <p class="muted small" style="margin:0">После подписания договора здесь откроется оформление доставок — по Астане за ${money(S.cfg.price_seller)}.</p></div>`;
VIEWS.seller = {
  new: async () => {
    const c = S.cfg;
    if (!S.user.approved) return pendingNote();
    return `<div class="card" style="max-width:760px">
      <h2>Новая доставка</h2>
      <p class="muted small">Доставка — <b>${money(c.price_seller)}</b>. Вес — до ${c.max_weight_kg} кг, в черте города ${c.city}.</p>
      <form data-form="createOrder" class="fields">
        <div><label>Имя покупателя</label><input name="buyer_name" required></div>
        <div><label>Телефон покупателя</label><input name="buyer_phone" type="tel" placeholder="+7 7XX XXX XX XX" required></div>
        <div class="full"><label>Адрес доставки</label><input name="address" placeholder="Улица, дом, подъезд, квартира" required></div>
        <div><label>Район</label><select name="district" required><option value="">Выберите</option>${c.districts.map((d) => `<option>${esc(d)}</option>`).join('')}</select></div>
        <div><label>Вес, кг (до ${c.max_weight_kg})</label><input name="weight_kg" type="number" step="0.1" min="0.1" max="${c.max_weight_kg}" required></div>
        <div class="full"><label>Что везём</label><input name="item_desc" placeholder="Например: платье, коробка 30×20 см" required></div>
        <div class="full"><label>Адрес забора</label><input name="pickup_address" value="${esc(S.user.pickup_address)}" required></div>
        <div class="full"><label>Комментарий курьеру</label><textarea name="comment" placeholder="Необязательно"></textarea></div>
        <div class="full err"></div>
        <div class="full row"><button class="btn sun">Создать и перейти к оплате ${money(c.price_seller)}</button></div>
      </form></div>`;
  },
  orders: async () => {
    const [{ orders }, st] = await Promise.all([api('GET', '/seller/orders'), api('GET', '/seller/stats')]);
    return `<div class="grid" style="margin-bottom:16px">
      <div class="card stat"><div class="v">${st.total || 0}</div><div class="l">всего заказов</div></div>
      <div class="card stat"><div class="v">${st.active || 0}</div><div class="l">в работе</div></div>
      <div class="card stat"><div class="v">${st.delivered || 0}</div><div class="l">доставлено</div></div>
      <div class="card stat"><div class="v">${money(st.spent)}</div><div class="l">оплачено за доставку</div></div>
    </div>
    ${list(orders, (o) => orderCard(o, [
      !o.seller_paid && o.status === 'new' ? `<button class="btn sun sm" data-act="sellerPay" data-id="${o.id}">Оплатить ${money(S.cfg.price_seller)}</button>` : '',
      o.status !== 'cancelled' ? `<button class="btn ghost sm" data-act="share" data-code="${o.code}">Ссылка покупателю</button>` : '',
      ['new', 'ready'].includes(o.status) ? `<button class="btn ghost sm" data-act="sellerCancel" data-id="${o.id}">Отменить</button>` : '',
    ].join('')), 'Заказов пока нет — создайте первый во вкладке «Новый заказ»')}`;
  },
};
VIEWS.seller.support = VIEWS.common.support;
// Оплата: переходим на страницу банка, после оплаты банк вернёт на /app?paid=КОД
forms.createOrder = async (f) => {
  const { pay_url } = await api('POST', '/seller/orders', { ...f, pay_now: true });
  location.href = pay_url;
};
actions.sellerPay = async (d) => { const { pay_url } = await api('POST', `/seller/orders/${d.id}/pay`); location.href = pay_url; };
// Возврат со страницы оплаты: уведомление банка может прийти с задержкой — подождём
async function afterPayment(code) {
  history.replaceState(null, '', '/app');
  for (let i = 0; i < 8; i++) {
    const o = (await api('GET', '/seller/orders')).orders.find((x) => x.code === code);
    if (!o) return go('orders');
    if (o.seller_paid) { await go('orders'); toast('Оплата прошла'); return showShare(o); }
    if (i === 0) $view.innerHTML = '<div class="card">Проверяем оплату…</div>';
    await new Promise((r) => setTimeout(r, 1500));
  }
  await go('orders');
  toast('Оплата не подтверждена. Если деньги списались — статус обновится в течение нескольких минут.');
}
actions.sellerCancel = async (d) => { if (!confirm('Отменить заказ? Оплата вернётся.')) return; await api('POST', `/seller/orders/${d.id}/cancel`); reload(); };
actions.share = async (d) => { const { orders } = await api('GET', '/seller/orders'); showShare(orders.find((o) => o.code === d.code)); };
function showShare(o) {
  const link = `${location.origin}/t/${o.code}`;
  const text = shareText(o);
  openDialog(`<div class="row between"><h3 style="margin:0">Отправьте ссылку покупателю</h3><button class="btn ghost sm" data-close>✕</button></div>
    <p class="muted small">По ссылке покупатель увидит, где его посылка.</p>
    <input value="${esc(link)}" readonly onclick="this.select()">
    <div class="row" style="margin-top:12px">
      <a class="btn" target="_blank" rel="noopener" href="https://wa.me/${esc(o.buyer_phone)}?text=${encodeURIComponent(text)}">WhatsApp</a>
      <a class="btn ghost" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}">Telegram</a>
      <button class="btn ghost" data-act="copy" data-text="${esc(text)}">Скопировать</button>
    </div>`);
}
actions.copy = async (d) => { await navigator.clipboard.writeText(d.text); toast('Скопировано'); };

// ---------- покупатель ----------
VIEWS.client = {
  orders: async () => {
    const { orders } = await api('GET', '/client/orders');
    return list(orders, (o) => orderCard(o, `
      ${!o.buyer_paid && o.status !== 'cancelled' ? `<a class="btn sun sm" href="/t/${esc(o.code)}">Оплатить ${money(S.cfg.price_buyer)}</a>` : ''}`),
    'Посылок на ваш номер пока нет');
  },
  support: VIEWS.common.support,
};

// ---------- курьер ----------
let courierData = null;
async function courierLoad() { courierData = await api('GET', '/courier/orders'); return courierData; }
VIEWS.courier = {
  available: async () => {
    const { available } = await courierLoad();
    return list(available, (o) => orderCard(o, `<button class="btn sm" data-act="take" data-id="${o.id}">Взять заказ</button>`), 'Свободных заказов нет. Обновите позже.');
  },
  mine: async () => {
    const { mine } = await courierLoad();
    return list(mine, (o) => orderCard(o, `
      ${o.status === 'assigned' ? `<a class="btn ghost sm" href="tel:+${esc(o.seller_phone)}">Позвонить продавцу</a><button class="btn sm" data-act="pickup" data-id="${o.id}">Забрал у продавца</button>` : ''}
      ${o.status === 'picked_up' ? `<button class="btn sun sm" data-act="deliverDlg" data-id="${o.id}" data-paid="${o.buyer_paid ? 1 : 0}">Вручить</button>` : ''}
      <a class="btn ghost sm" target="_blank" rel="noopener" href="https://2gis.kz/astana/search/${encodeURIComponent(o.address)}">Маршрут 2ГИС</a>`), 'Активных доставок нет');
  },
  done: async () => {
    const [{ done }, cash] = await Promise.all([courierLoad(), api('GET', '/courier/cash')]);
    return `<div class="grid" style="margin-bottom:16px">
      <div class="card stat"><div class="v">${done.length}</div><div class="l">последние доставки</div></div>
      <div class="card stat"><div class="v">${money(cash.on_hand)}</div><div class="l">наличные на руках — сдайте администратору</div>
        ${cash.items.length ? `<details class="small"><summary>${cash.items.length} заказ(ов)</summary>${cash.items.map((i) => `<div>${esc(i.code)} · ${esc(i.buyer_name)} · ${money(i.amount)}</div>`).join('')}</details>` : ''}
        ${cash.handovers[0] ? `<div class="small muted">Последняя сдача: ${money(cash.handovers[0].amount)}, ${date(cash.handovers[0].created_at)}</div>` : ''}</div>
    </div>` + list(done, (o) => orderCard(o), 'Пока пусто');
  },
  support: VIEWS.common.support,
};
actions.take = async (d) => { await api('POST', `/courier/orders/${d.id}/take`); toast('Заказ ваш'); go('mine'); };
actions.pickup = async (d) => { await api('POST', `/courier/orders/${d.id}/pickup`); reload(); };
actions.deliverDlg = (d) => openDialog(`<div class="row between"><h3 style="margin:0">Вручение посылки</h3><button class="btn ghost sm" data-close>✕</button></div>
  <form data-form="deliver" data-id="${d.id}" class="stack">
    <p class="small muted" style="margin:0">Отдайте посылку лично получателю — имя и телефон указаны в заказе.</p>
    ${d.paid === '1' ? '<p class="paid">Покупатель оплатил онлайн</p>' : `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="cash_received" required style="width:auto;min-height:0"> Получил ${money(S.cfg.price_buyer)} наличными</label>`}
    <div class="err"></div><button class="btn sun">Подтвердить вручение</button>
  </form>`);
forms.deliver = async (f, form) => { await api('POST', `/courier/orders/${form.dataset.id}/deliver`, { ...f, cash_received: !!f.cash_received }); $dlg.close(); toast('Доставлено!'); reload(); };

// ---------- администратор / поддержка ----------
let couriersCache = [];
function adminOrderExtra(o) {
  if (S.user.role !== 'admin') return '';
  const canAssign = ['ready', 'assigned'].includes(o.status);
  return [
    canAssign ? `<select data-assign="${o.id}" style="width:auto;min-height:34px;padding:4px 8px"><option value="">Назначить курьера…</option>${couriersCache.filter((c) => c.active).map((c) => `<option value="${c.id}" ${o.courier_id === c.id ? 'selected' : ''}>${esc(c.name)} (${c.active_orders})</option>`).join('')}</select>` : '',
    !['delivered', 'cancelled'].includes(o.status) ? `<button class="btn ghost sm" data-act="adminCancel" data-id="${o.id}">Отменить</button>` : '',
  ].join('');
}
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-assign]');
  if (!sel || !sel.value) return;
  try { await api('POST', `/admin/orders/${sel.dataset.assign}/assign`, { courier_id: Number(sel.value) }); toast('Курьер назначен'); reload(); }
  catch (err) { toast(err.message); }
});
actions.adminCancel = async (d) => { const reason = prompt('Причина отмены'); if (reason === null) return; await api('POST', `/admin/orders/${d.id}/cancel`, { reason }); reload(); };

let orderFilter = { status: '', q: '' };
async function ordersView() {
  if (S.user.role === 'admin') couriersCache = (await api('GET', '/admin/couriers')).couriers;
  const qs = new URLSearchParams(Object.entries(orderFilter).filter(([, v]) => v));
  const { orders } = await api('GET', '/admin/orders?' + qs);
  return `<form data-form="orderFilter" class="row" style="margin-bottom:16px">
      <input name="q" value="${esc(orderFilter.q)}" placeholder="Код, телефон, имя или адрес" style="flex:1;min-width:200px">
      <select name="status" style="width:auto"><option value="">Все статусы</option>${Object.entries(S.cfg.statuses).map(([k, v]) => `<option value="${k}" ${orderFilter.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="btn">Найти</button>
    </form>${list(orders, (o) => orderCard(o, adminOrderExtra(o)), 'Ничего не найдено')}`;
}
forms.orderFilter = async (f) => { orderFilter = f; reload(); };

async function ticketsView() {
  const { tickets } = await api('GET', '/tickets');
  const open = tickets.filter((t) => t.status === 'open').length;
  return `<p class="muted">Ожидают ответа: <b>${open}</b></p>${ticketRows(tickets)}`;
}

VIEWS.admin = {
  dash: async () => {
    const s = await api('GET', '/admin/stats');
    const max = Math.max(1, ...s.daily.map((d) => d.revenue));
    const active = (s.byStatus.ready || 0) + (s.byStatus.assigned || 0) + (s.byStatus.picked_up || 0);
    return `<div class="grid">
      <div class="card stat"><div class="v">${money(s.revenue)}</div><div class="l">выручка всего</div></div>
      <div class="card stat"><div class="v">${money(s.revenueToday)}</div><div class="l">выручка сегодня</div></div>
      <div class="card stat"><div class="v">${s.ordersToday}</div><div class="l">заказов сегодня</div></div>
      <div class="card stat"><div class="v">${s.deliveredToday}</div><div class="l">доставлено сегодня</div></div>
      <div class="card stat"><div class="v">${active}</div><div class="l">в работе сейчас</div></div>
      <div class="card stat"><div class="v">${s.byStatus.new || 0}</div><div class="l">ждут оплаты продавца</div></div>
      <div class="card stat"><div class="v">${s.openTickets}</div><div class="l">открытых обращений</div></div>
      ${s.pendingSellers ? `<div class="card stat" style="border-color:var(--sun)"><div class="v">${s.pendingSellers}</div><div class="l">заявок продавцов · <a href="#" data-act="tab" data-k="users">рассмотреть</a></div></div>` : ''}
      <div class="card stat"><div class="v">${money(s.cashOnHands)}</div><div class="l">наличные на руках у курьеров · <a href="#" data-act="tab" data-k="couriers">касса</a></div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Выручка за 14 дней</h3>
      ${s.daily.length ? `<div class="bars" style="margin-bottom:24px">${s.daily.map((d) => `<div style="height:${(d.revenue / max) * 100}%" title="${d.day}: ${money(d.revenue)}"><span>${d.day.slice(8)}</span></div>`).join('')}</div>` : '<p class="muted">Пока нет оплат</p>'}
    </div>
    <div class="card" style="margin-top:16px"><h3>Пользователи</h3><div class="row">${Object.entries(ROLE_NAMES).map(([k, v]) => `<span class="badge">${v}: ${s.users[k] || 0}</span>`).join('')}</div></div>`;
  },
  orders: ordersView,
  couriers: async () => {
    const [{ couriers }, cash] = await Promise.all([api('GET', '/admin/couriers'), api('GET', '/admin/cash')]);
    const byId = Object.fromEntries(cash.couriers.map((c) => [c.id, c]));
    return `<div class="card stat" style="margin-bottom:16px"><div class="v">${money(cash.total_on_hand)}</div><div class="l">наличные на руках у курьеров — ещё не сданы в кассу</div></div>
      <div class="card scroll"><table class="table"><tr><th>Курьер</th><th>Телефон</th><th>В работе</th><th>Доставлено</th><th>Наличные на руках</th><th>Последняя сдача</th><th>Статус</th></tr>
      ${couriers.map((c) => { const k = byId[c.id] || { on_hand: 0, items: [] }; return `<tr><td>${esc(c.name)}</td><td>${phone(c.phone)}</td><td>${c.active_orders}</td><td>${c.delivered}</td>
        <td><b>${money(k.on_hand)}</b>${k.items.length ? `<details class="small"><summary>${k.items.length} заказ(ов)</summary>${k.items.map((i) => `<div>${esc(i.code)} · ${esc(i.buyer_name)} · ${money(i.amount)} · ${date(i.created_at)}</div>`).join('')}</details>` : ''}
          ${k.on_hand ? `<div style="margin-top:6px"><button class="btn sun sm" data-act="handover" data-id="${c.id}" data-amount="${k.on_hand}" data-name="${esc(c.name)}">Принял ${money(k.on_hand)}</button></div>` : ''}</td>
        <td class="small">${k.last_handover ? `${money(k.last_handover.amount)}<br><span class="muted">${date(k.last_handover.created_at)}, ${esc(k.last_handover.admin_name)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${c.active ? '<span class="paid">активен</span>' : '<span class="unpaid">заблокирован</span>'}</td></tr>`; }).join('')}
    </table></div><p class="muted small">Курьер получает от покупателя ${money(S.cfg.price_buyer)} наличными, если тот не оплатил онлайн. Когда курьер сдаёт деньги, нажмите «Принял». Добавить курьера — во вкладке «Пользователи».</p>`;
  },
  users: async () => {
    const { users } = await api('GET', '/admin/users');
    const pending = users.filter((u) => u.role === 'seller' && !u.approved && u.active);
    const base = location.origin + location.pathname;
    const links = [['Владелец', '#owner'], ['Продавец', '#seller'], ['Заявка продавца', '#register-seller'], ['Клиент', '#client'], ['Курьер', '#courier']];
    return `${pending.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--sun)"><h3>Заявки продавцов · ${pending.length}</h3>
      <p class="small muted">Одобрите заявку после подписания договора — продавец сразу сможет оформлять доставки.</p>
      <div class="scroll"><table class="table"><tr><th>Магазин</th><th>Имя</th><th>Телефон</th><th>Адрес забора</th><th>Заявка</th><th></th></tr>
      ${pending.map((u) => `<tr><td><b>${esc(u.shop_name || '')}</b></td><td>${esc(u.name)}</td><td>${phone(u.phone)}</td><td>${esc(u.pickup_address || '')}</td><td>${date(u.created_at)}</td>
        <td><button class="btn sun sm" data-act="approveSeller" data-id="${u.id}">Одобрить</button></td></tr>`).join('')}</table></div></div>` : ''}
      <div class="card" style="margin-bottom:16px"><h3>Ссылки на вход и установку приложения</h3>
        <p class="small muted">Отправьте ссылку человеку — откроется его вход и кнопка «Установить приложение» на экран «Домой».</p>
        <div class="stack">${links.map(([t, h]) => `<div class="row between" style="flex-wrap:wrap"><span><b>${t}</b> · <span class="small muted">${esc(base + h)}</span></span>
          <button class="btn ghost sm" data-act="copyLink" data-link="${esc(base + h)}">Копировать</button></div>`).join('')}</div></div>
      <div class="card" style="margin-bottom:16px"><h3>Добавить пользователя</h3>
      <form data-form="addUser" class="fields">
        <div><label>Роль</label><select name="role"><option value="courier">Курьер</option><option value="seller">Продавец (по договору)</option><option value="support">Поддержка</option><option value="admin">Владелец / администратор</option></select></div>
        <div><label>Имя</label><input name="name" required></div>
        <div><label>Телефон</label><input name="phone" type="tel" required></div>
        <div><label>Пароль</label><input name="password" minlength="6" required></div>
        <div><label>Магазин (для продавца)</label><input name="shop_name"></div>
        <div><label>Адрес забора (для продавца)</label><input name="pickup_address"></div>
        <div class="full err"></div><div><button class="btn">Добавить</button></div>
      </form></div>
      <div class="card scroll"><table class="table"><tr><th>Имя</th><th>Роль</th><th>Телефон</th><th>Магазин</th><th>Создан</th><th></th></tr>
      ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${ROLE_NAMES[u.role]}${u.role === 'seller' && !u.approved ? ' <span class="badge new">заявка</span>' : ''}</td><td>${phone(u.phone)}</td><td>${esc(u.shop_name || '')}</td><td>${date(u.created_at)}</td>
        <td>${u.id === S.user.id ? '' : `<button class="btn ${u.active ? 'ghost' : ''} sm" data-act="toggleUser" data-id="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'Заблокировать' : 'Разблокировать'}</button>`}</td></tr>`).join('')}
      </table></div>`;
  },
  tickets: ticketsView,
  sms: async () => {
    const { notifications, sms_mode } = await api('GET', '/admin/notifications');
    const st = { mock: '<span class="muted">тест</span>', sent: '<span class="paid">отправлено</span>', failed: '<span class="unpaid">ошибка</span>' };
    return `${sms_mode === 'mock' ? '<div class="card small" style="margin-bottom:16px">Тестовый режим: SMS не отправляются, а только записываются сюда. Для реальной отправки задайте на сервере <code>SMS_MODE=mobizon</code> и <code>MOBIZON_API_KEY</code>.</div>' : ''}
      <div class="card scroll"><table class="table"><tr><th>Время</th><th>Кому</th><th>Канал</th><th>Текст</th><th>Статус</th></tr>
      ${notifications.map((n) => `<tr><td>${date(n.created_at)}</td><td>${/^7\d{10}$/.test(n.phone) ? phone(n.phone) : esc(n.phone)}</td><td>${n.kind === 'push' ? 'push' : 'SMS'}</td><td>${esc(n.text)}</td><td>${st[n.status] || esc(n.status)}${n.error ? `<div class="small muted">${esc(n.error)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Пока пусто</td></tr>'}
      </table></div>`;
  },
};
actions.handover = async (d) => {
  if (!confirm(`Подтвердите: вы получили ${money(Number(d.amount))} наличными от курьера ${d.name}?`)) return;
  await api('POST', `/admin/cash/${d.id}/handover`, { amount: Number(d.amount) });
  toast('Наличные приняты'); reload();
};
actions.approveSeller = async (d) => { await api('POST', `/admin/users/${d.id}/approve`); toast('Продавец подключён'); reload(); };
actions.copyLink = async (d) => {
  try { await navigator.clipboard.writeText(d.link); toast('Ссылка скопирована'); }
  catch { prompt('Скопируйте ссылку', d.link); }
};
forms.addUser = async (f) => { await api('POST', '/admin/users', f); toast('Сотрудник добавлен'); reload(); };
actions.toggleUser = async (d) => { await api('PATCH', `/admin/users/${d.id}`, { active: d.on === '1' }); reload(); };

VIEWS.support = { tickets: ticketsView, orders: ordersView };

// ---------- start ----------
async function start() {
  try { S.cfg = S.cfg || await api('GET', '/config'); }
  catch { $view.innerHTML = '<div class="card err">Сервер недоступен</div>'; return; }
  if (!store.token) return authView();
  try { S.user = (await api('GET', '/me')).user; }
  catch { store.token = null; return authView(); }
  const paid = new URLSearchParams(location.search).get('paid');
  if (paid && S.user.role === 'seller') { S.tab = 'orders'; renderTabs(); return afterPayment(paid); }
  go(TABS[S.user.role][0][0]);
}
start();
