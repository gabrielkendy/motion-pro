@echo off
REM Bootstrap Stripe · 1-click launcher
REM Roda tools\run-bootstrap-stripe.ps1 que carrega tools\.env
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-bootstrap-stripe.ps1"
