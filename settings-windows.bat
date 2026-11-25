@echo off
rem Открыть настройки (токен Telegram-бота, номер администратора и т.д.)
chcp 65001 >nul
if not exist "%LOCALAPPDATA%\Jetkiz750\.env" (
  echo Сначала запустите start-windows.bat - он создаст файл настроек.
  pause
  exit /b
)
notepad "%LOCALAPPDATA%\Jetkiz750\.env"
echo После изменения настроек перезапустите сервер: закройте его окно и снова запустите start-windows.bat
pause
