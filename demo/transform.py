# Превращает сайт из web/ в набор страниц демо-версии для claude.ai
import re, sys, shutil, os
src, out = sys.argv[1], sys.argv[2]
read = lambda f: open(os.path.join(src, f), encoding='utf-8').read()
def write(f, s): open(os.path.join(out, f), 'w', encoding='utf-8').write(s)
def must(s, old, new, count=1):
    assert old in s, f'не найдено: {old[:60]}'
    return s.replace(old, new) if count == 0 else s.replace(old, new, count)

def common(s):
    for a, b in [('href="/app#', 'href="app.html#'), ('href="/app"', 'href="app.html"'), ('"/install.js"', '"install.js"'),
                 ('href="/offer"', 'href="offer.html"'), ('href="/privacy"', 'href="privacy.html"'), ('href="/"', 'href="index.html"'),
                 ('"/styles.css"', '"styles.css"'), ('"/common.js"', '"common.js"'), ('"/app.js"', '"app.js"'), ('"/icon.svg"', '"icon.svg"')]:
        s = s.replace(a, b)
    s = re.sub(r'\s*<link rel="manifest"[^>]*>', '', s)
    s = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*>', '', s)
    s = re.sub(r'\s*<meta name="theme-color"[^>]*>', '', s)
    s = re.sub(r"<script>if \('serviceWorker'[^<]*</script>\s*", '', s)
    s = s.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
    return s

# --- стили: тёмная тема с учётом переключателя claude.ai, отступы безопасной зоны, плашка демо
css = read('styles.css')
m = re.search(r'@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}\s*\}', css)
dark = m.group(1).strip() + ' color-scheme: dark;'
css = css.replace(m.group(0), '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) { ' + dark + ' }\n}\n:root[data-theme="dark"] { ' + dark + ' }')
css += '''
/* Демо-версия */
.wrap { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.demo-bar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: center; padding-block: 8px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  background: var(--sun); color: #14212b; font-size: 14px; text-align: center; }
.demo-bar button { font: inherit; font-weight: 600; background: transparent; color: inherit; border: 1px solid currentColor; border-radius: 8px; padding: 2px 10px; cursor: pointer; }
.demo-bar button:focus-visible { outline: 2px solid #14212b; outline-offset: 2px; }
'''
write('styles.css', css)
shutil.copy(os.path.join(src, 'icon.svg'), out)
shutil.copy(os.path.join(src, 'icon-192.png'), out)
write('install.js', read('install.js').replace('"/icon-192.png"', '"icon-192.png"').replace('src="/icon-192.png"', 'src="icon-192.png"'))
write('common.js', read('common.js'))

# --- кабинеты
js = read('app.js')
js = must(js, "${location.origin}/t/${o.code}", "${jdemoUrl('/t/' + o.code, true)}", 0)
js = must(js, "history.replaceState(null, '', '/app')", "history.replaceState(null, '', 'app.html')", 0)
js = must(js, 'location.href = pay_url', 'location.href = jdemoUrl(pay_url)', 0)
js = must(js, 'href="/t/${esc(o.code)}"', 'href="${jdemoUrl(\'/t/\' + o.code)}"', 0)
js = must(js, "if (!confirm(", "if (!jdemoConfirm(", 0)
js = must(js, "const reason = prompt(", "const reason = jdemoPrompt(", 0)
write('app.js', js)

backend = '<script src="backend.js"></script>\n'
h = common(read('app.html'))
h = must(h, '<title>Кабинет — Жеткіз 750</title>', '<title>Кабинет Жеткіз 750</title>')
h = must(h, '<script src="common.js"></script>', backend + '<script src="common.js"></script>')
write('app.html', h)

t = common(read('track.html'))
t = must(t, '<title>Ваша посылка — Жеткіз 750</title>', '<title>Посылка Жеткіз 750</title>')
t = must(t, "decodeURIComponent(location.pathname.split('/').pop() || '')", "(new URLSearchParams(location.search).get('c') || '')")
t = must(t, "history.replaceState(null, '', location.pathname)", "history.replaceState(null, '', 'track.html?c=' + code)")
t = must(t, 'location.href = pay_url', 'location.href = jdemoUrl(pay_url)')
t = must(t, '<script src="common.js"></script>', backend + '<script src="common.js"></script>')
write('track.html', t)

for f, title in [('offer.html', 'Публичная оферта'), ('privacy.html', 'Политика конфиденциальности')]:
    s = common(read(f))
    s = re.sub(r'<title>[^<]*</title>', f'<title>{title} Жеткіз 750</title>', s)
    write(f, s)

# --- главная: без обёртки документа (её добавит claude.ai), с подсказкой для демо
i = common(read('index.html'))
i = must(i, "location.href='/t/'+encodeURIComponent(c.toUpperCase())", "location.href='track.html?c='+encodeURIComponent(c.toUpperCase())")
head = re.search(r'<head>(.*?)</head>', i, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', i, re.S).group(1)
head = re.sub(r'\s*<meta charset[^>]*>|\s*<meta name="viewport"[^>]*>', '', head)
head = re.sub(r'<title>[^<]*</title>', '<title>Жеткіз 750</title>\n<meta name="claude:viewport-fit-sides" content="cover">', head)
demo_note = '''<div class="demo-bar"><span><b>Демо-версия сайта.</b> Войдите как продавец, покупатель, курьер или админ — пароли на странице входа (кнопка «Войти по паролю»). Оплата и SMS тестовые.</span></div>
'''
write('index.html', head.strip() + '\n' + demo_note + body.strip() + '\n')

# --- тестовая страница оплаты (вместо банка)
write('pay.html', '''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Оплата Жеткіз 750</title>
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main class="wrap" style="max-width:440px;padding-top:40px;padding-bottom:40px">
  <div class="card stack" id="box"><p class="muted">Загрузка…</p></div>
</main>
<script src="backend.js"></script>
<script src="common.js"></script>
<script>
const inv = new URLSearchParams(location.search).get('i') || '';
const box = document.getElementById('box');
(async () => {
  const p = await jdemo.payInfo(inv);
  if (!p) { box.innerHTML = '<h2>Счёт не найден</h2><a class="btn" href="index.html">На главную</a>'; return; }
  const back = jdemoUrl(p.payer === 'seller' ? '/app?paid=' + p.code : '/t/' + p.code + '?paid=1');
  box.innerHTML = `<p class="small muted" style="margin:0">ТЕСТОВАЯ СТРАНИЦА БАНКА — деньги не списываются</p>
    <h2 style="margin:0">Оплата ${J.money(p.amount)}</h2><p class="muted" style="margin:0">Доставка ${J.esc(p.code)}, Жеткіз 750</p>
    ${p.status === 'pending' ? '<button class="btn sun block" data-r="ok">Оплатить</button><button class="btn ghost block" data-r="fail">Отказаться</button>'
      : `<p>Счёт уже обработан.</p><a class="btn block" href="${back}">Вернуться</a>`}`;
  box.querySelectorAll('[data-r]').forEach((b) => b.onclick = async () => {
    box.querySelectorAll('[data-r]').forEach((x) => (x.disabled = true));
    await fetch('/api/payments/callback/mock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice: inv, result: b.dataset.r }) });
    location.href = back;
  });
})();
</script>
</body>
</html>
''')
print('ok')
