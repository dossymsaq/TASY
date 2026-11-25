@echo off
rem Создать администратора с паролем (если вход через Telegram ещё не настроен)
chcp 65001 >nul
set /p PHONE=Номер телефона администратора: 
set /p PASS=Пароль (не короче 6 символов): 
set "ENV_FILE=%LOCALAPPDATA%\Jetkiz750\.env"
set "DB_FILE=%LOCALAPPDATA%\Jetkiz750\data.sqlite"
if not exist "%LOCALAPPDATA%\Jetkiz750" mkdir "%LOCALAPPDATA%\Jetkiz750"
node --disable-warning=ExperimentalWarning "%~dp0server\create-admin.js" "%PHONE%" "%PASS%"
pause
