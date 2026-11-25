# Запуск «Жеткіз 750» на Windows:
#   сервер + сайт + Telegram-бот + адрес в интернете через Cloudflare Tunnel (бесплатно, без домена).
# Запускайте через start-windows.bat в корне проекта.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # без этого скачивание в PowerShell идёт очень медленно
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { $Host.UI.RawUI.WindowTitle = 'Жеткіз 750 — сервер (не закрывайте это окно)' } catch {}

$root    = Split-Path -Parent $PSScriptRoot
$server  = Join-Path $root 'server'
$tools   = Join-Path $PSScriptRoot 'tools'
# Данные и настройки — отдельно от кода, чтобы не потерять их при обновлении программы
$dataDir = Join-Path $env:LOCALAPPDATA 'Jetkiz750'
$envFile = Join-Path $dataDir '.env'
$dbFile  = Join-Path $dataDir 'data.sqlite'
$backups = Join-Path $dataDir 'backups'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Stop-WithError($text) {
  Say ''; Say $text 'Red'; Say ''
  Read-Host 'Нажмите Enter, чтобы закрыть окно'
  exit 1
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

Say ''
Say '=== Жеткіз 750 — доставка по Астане ===' 'Cyan'
Say ''

# ---------- 1. Node.js ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Say 'Node.js не найден — устанавливаю (нужно один раз, 1–3 минуты)...' 'Yellow'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Start-Process 'https://nodejs.org/'
    Stop-WithError 'Установите Node.js (кнопка «LTS») с открывшегося сайта nodejs.org и снова запустите start-windows.bat'
  }
}
$nodeVersion = (& node -v).Trim()
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) {
  Start-Process 'https://nodejs.org/'
  Stop-WithError "Нужен Node.js версии 22 или новее, у вас $nodeVersion. Установите версию «LTS» с nodejs.org."
}

# ---------- 2. Компоненты сервера ----------
if (-not (Test-Path (Join-Path $server 'node_modules\express'))) {
  Say 'Устанавливаю компоненты сервера (один раз)...' 'Yellow'
  Push-Location $server
  & npm.cmd install --omit=dev --no-audit --no-fund
  $npmExit = $LASTEXITCODE
  Pop-Location
  if ($npmExit -ne 0) { Stop-WithError 'Не удалось установить компоненты. Проверьте интернет и попробуйте снова.' }
}

# ---------- 3. Настройки ----------
New-Item -ItemType Directory -Force -Path $dataDir, $backups | Out-Null
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $server '.env.example') $envFile
  Say 'Первый запуск: сейчас откроется Блокнот с настройками.' 'Yellow'
  Say '  1) после  TELEGRAM_BOT_TOKEN=  вставьте токен бота от @BotFather' 'Yellow'
  Say '  2) после  ADMIN_PHONES=  впишите свой номер телефона' 'Yellow'
  Say '  3) сохраните файл (Ctrl+S) и закройте Блокнот' 'Yellow'
  Start-Process notepad.exe -ArgumentList "`"$envFile`"" -Wait
}
$settings = @{}
foreach ($line in (Get-Content $envFile -Encoding UTF8)) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim() }
}
$port = 3000
if ($settings['PORT']) { $port = [int]$settings['PORT'] }
if (-not $settings['TELEGRAM_BOT_TOKEN']) {
  Say 'Внимание: не указан токен Telegram-бота — вход через Telegram работать не будет.' 'Yellow'
  Say 'Чтобы указать его, запустите settings-windows.bat, затем перезапустите сервер.' 'Yellow'
}
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Stop-WithError "Порт $port уже занят — скорее всего, сервер уже запущен в другом окне."
}

# ---------- 4. Резервная копия базы ----------
if (Test-Path $dbFile) {
  $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
  foreach ($suffix in '', '-wal', '-shm') {
    if (Test-Path "$dbFile$suffix") { Copy-Item "$dbFile$suffix" (Join-Path $backups "data_$stamp.sqlite$suffix") }
  }
  # храним копии за последние 30 запусков
  Get-ChildItem $backups -Filter 'data_*.sqlite' | Sort-Object Name -Descending | Select-Object -Skip 30 | ForEach-Object {
    Remove-Item "$($_.FullName)*" -Force
  }
}

# ---------- 5. Адрес в интернете (Cloudflare Tunnel) ----------
$publicUrl = $null
$tunnel = $null
$cf = Join-Path $tools 'cloudflared.exe'
if ($settings['TUNNEL'] -ne '0') {
  # закрываем туннель, оставшийся от прошлого запуска
  Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $cf } | Stop-Process -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path $cf)) {
    Say 'Скачиваю Cloudflare Tunnel (один раз)...' 'Yellow'
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $arch = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }
      Invoke-WebRequest -UseBasicParsing "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arch.exe" -OutFile $cf
    } catch {
      Remove-Item $cf -ErrorAction SilentlyContinue
      Say 'Не удалось скачать Cloudflare Tunnel — сайт будет доступен только на этом компьютере.' 'Yellow'
    }
  }
  if (Test-Path $cf) {
    $log = Join-Path $tools 'tunnel.log'
    Remove-Item $log -ErrorAction SilentlyContinue
    $metrics = '127.0.0.1:43217'
    $tunnel = Start-Process -FilePath $cf -WindowStyle Hidden -PassThru -ArgumentList @(
      'tunnel', '--no-autoupdate', '--metrics', $metrics, '--logfile', "`"$log`"", '--url', "http://localhost:$port")
    Say 'Получаю адрес в интернете...'
    for ($i = 0; $i -lt 60 -and -not $publicUrl -and -not $tunnel.HasExited; $i++) {
      Start-Sleep -Seconds 1
      try {
        $hostName = (Invoke-RestMethod "http://$metrics/quicktunnel" -TimeoutSec 2).hostname
        if ($hostName) { $publicUrl = "https://$hostName" }
      } catch {}
      if (-not $publicUrl) {
        $text = Get-Content $log -Raw -ErrorAction SilentlyContinue
        if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $publicUrl = $Matches[0] }
      }
    }
    if (-not $publicUrl) { Say 'Адрес в интернете получить не удалось — сайт будет доступен только на этом компьютере.' 'Yellow' }
  }
}

# ---------- 6. Сервер ----------
$env:ENV_FILE = $envFile
$env:DB_FILE = $dbFile
if ($publicUrl) { $env:PUBLIC_URL = $publicUrl }
$local = "http://localhost:$port"
$nodeProc = Start-Process -FilePath (Get-Command node).Source -WorkingDirectory $server -NoNewWindow -PassThru `
  -ArgumentList @('--disable-warning=ExperimentalWarning', 'index.js')
try {
  $ok = $false
  for ($i = 0; $i -lt 40 -and -not $nodeProc.HasExited; $i++) {
    Start-Sleep -Milliseconds 500
    try { $cfgInfo = Invoke-RestMethod "$local/api/config" -TimeoutSec 2; $ok = $true; break } catch {}
  }
  if (-not $ok) { Stop-WithError 'Сервер не запустился. Посмотрите сообщения выше.' }
  if ($settings['TELEGRAM_BOT_TOKEN']) {
    # бот подключается к Telegram пару секунд после запуска сервера
    for ($i = 0; $i -lt 10 -and -not $cfgInfo.telegram_bot; $i++) {
      Start-Sleep -Seconds 1
      try { $cfgInfo = Invoke-RestMethod "$local/api/config" -TimeoutSec 2 } catch {}
    }
    if (-not $cfgInfo.telegram_bot) { Say 'Telegram-бот не запустился: проверьте токен (settings-windows.bat) и интернет.' 'Red' }
  }

  $site = if ($publicUrl) { $publicUrl } else { $local }
  Say ''
  Say '============================================================' 'Green'
  Say ' Сервер работает!' 'Green'
  Say ''
  Say " Сайт для продавцов и покупателей:  $site" 'White'
  Say " Личный кабинет:                    $site/app" 'White'
  if ($cfgInfo.telegram_bot) { Say " Telegram-бот:                      https://t.me/$($cfgInfo.telegram_bot)" 'White' }
  Say " На этом компьютере:                $local" 'White'
  Say ''
  Say ' Не закрывайте это окно и не выключайте компьютер — иначе сервис остановится.' 'Yellow'
  if ($publicUrl) { Say ' Адрес в интернете меняется при каждом перезапуске.' 'Yellow' }
  Say ' Остановить сервер: закройте это окно.' 'Gray'
  Say '============================================================' 'Green'
  Say ''
  Start-Process "$site/app"
  $nodeProc.WaitForExit()
  Stop-WithError 'Сервер остановился. Посмотрите сообщения выше и запустите start-windows.bat снова.'
} finally {
  if ($nodeProc -and -not $nodeProc.HasExited) { Stop-Process -Id $nodeProc.Id -Force -ErrorAction SilentlyContinue }
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
}
