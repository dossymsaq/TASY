// Установка сайта как приложения на экран «Домой» (PWA).
// Android/Chrome — системное окно установки; iPhone — пошаговая подсказка; Instagram/WhatsApp — открыть в браузере.
// Любой элемент с атрибутом data-install открывает установку.
window.JInstall = (() => {
  let deferred = null;
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|Telegram|WhatsApp|; wv\)/.test(ua);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; document.documentElement.classList.add('can-install'); });
  addEventListener('appinstalled', () => { deferred = null; document.querySelectorAll('.install-banner').forEach((el) => el.remove()); });

  const share = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
  function steps() {
    if (inApp) return ['Эта страница открыта внутри другого приложения (Instagram, WhatsApp, Telegram) — там установка недоступна.',
      'Нажмите <b>⋮</b> или <b>···</b> в углу и выберите <b>«Открыть в браузере»</b>.', 'В браузере снова нажмите «Установить приложение».'];
    if (isIOS) return [`Откройте эту страницу в <b>Safari</b>.`, `Нажмите <b>«Поделиться»</b> ${share} внизу экрана.`,
      'Прокрутите список и выберите <b>«На экран „Домой“»</b>.', 'Нажмите <b>«Добавить»</b> — на экране появится значок «Жеткіз 750».'];
    if (isAndroid) return ['Откройте эту страницу в <b>Chrome</b>.', 'Нажмите <b>⋮</b> в правом верхнем углу.',
      'Выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.', 'Подтвердите — значок «Жеткіз 750» появится на экране.'];
    return ['Откройте эту страницу на телефоне — приложение устанавливается на экран «Домой».',
      'На компьютере в Chrome или Edge нажмите значок установки в адресной строке.'];
  }
  function showHelp() {
    document.getElementById('install-help')?.remove();
    const box = document.createElement('div');
    box.id = 'install-help';
    box.className = 'install-help';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'install-help-title');
    box.innerHTML = `<div class="install-sheet">
      <div class="install-head"><img src="/icon-192.png" alt="" width="48" height="48"><div><b id="install-help-title">Установить «Жеткіз 750»</b><span>Значок на экране «Домой», открывается как приложение</span></div></div>
      <ol>${steps().map((s) => `<li>${s}</li>`).join('')}</ol>
      <button type="button" class="btn block" data-install-close>Понятно</button></div>`;
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-install-close]')) box.remove(); });
    document.body.append(box);
    box.querySelector('[data-install-close]').focus();
  }
  async function open() {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch {}
      deferred = null;
      return;
    }
    showHelp();
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-install]');
    if (!el) return;
    e.preventDefault();
    open();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('install-help')?.remove(); });

  // Плашка для страницы входа (не показывается, если приложение уже установлено)
  const banner = () => (standalone() ? '' : `<div class="install-banner"><img src="/icon-192.png" alt="" width="40" height="40">
    <div><b>Приложение «Жеткіз 750»</b><span>Установите на экран «Домой» — входить станет быстрее</span></div>
    <button type="button" class="btn sun sm" data-install>Установить</button></div>`);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  return { open, banner, standalone };
})();
