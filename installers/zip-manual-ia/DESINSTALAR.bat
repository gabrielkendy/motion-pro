@echo off
chcp 65001 >nul 2>&1
title MotionPro IA - Desinstalador
color 0C

set "EXT_ID=com.motionpro.ia"
set "DEST=%APPDATA%\Adobe\CEP\extensions\%EXT_ID%"

echo.
echo  ============================================================
echo            MotionPro IA — Desinstalador
echo  ============================================================
echo.

if not exist "%DEST%" (
    echo  Plugin nao instalado.
    pause
    exit /b 0
)

echo  Removendo: %DEST%
rmdir /s /q "%DEST%"
if exist "%LOCALAPPDATA%\Temp\cep_cache" rmdir /s /q "%LOCALAPPDATA%\Temp\cep_cache" >nul 2>&1

color 0A
echo.
echo  ✓ MotionPro IA desinstalado.
echo  Sua conta e licenca continuam intactas — pode reinstalar a qualquer momento.
echo.
pause
exit /b 0
