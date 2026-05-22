@echo off
title MotionPro IA - Desinstalador
echo.
echo ============================================================
echo   MotionPro IA - Desinstalador
echo ============================================================
echo.

set "DEST=%APPDATA%\Adobe\CEP\extensions\com.motionpro.ia"
set "CACHE=%LOCALAPPDATA%\Temp\cep_cache"

if not exist "%DEST%" (
    echo Plugin nao instalado.
    pause
    exit /b 0
)

choice /C SN /N /M "Confirma desinstalacao? (S/N): "
if errorlevel 2 exit /b 0

taskkill /F /IM "Adobe Premiere Pro.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo Removendo: %DEST%
rmdir /s /q "%DEST%"
if exist "%CACHE%" rmdir /s /q "%CACHE%" >nul 2>&1

echo.
echo OK MotionPro IA desinstalado.
echo Sua conta e licenca continuam intactas - pode reinstalar a qualquer momento.
echo.
pause
exit /b 0
