@echo off
rem Запуск сервиса «Жеткіз 750». Дважды щёлкните по этому файлу.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\start.ps1"
