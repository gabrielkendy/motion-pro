@echo off
REM Simple launcher for INSTALAR.ps1 - ASCII only, no special chars
title MotionPro IA - Instalador
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR.ps1"
pause
exit /b
