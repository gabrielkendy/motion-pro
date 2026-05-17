@echo off
chcp 65001 >nul 2>&1
title MotionPro Legendas - Desinstalador
color 0C

set "EXT_ID=com.motionpro.legendas"
set "DEST=%APPDATA%\Adobe\CEP\extensions\%EXT_ID%"
set "CEP_CACHE=%LOCALAPPDATA%\Temp\cep_cache"

echo.
echo  ============================================================
echo            DESINSTALAR MotionPro Legendas
echo  ============================================================
echo.
choice /C SN /N /M "Confirma desinstalacao? (S/N): "
if errorlevel 2 exit /b 0

taskkill /F /IM "Adobe Premiere Pro.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

if exist "%DEST%" rmdir /s /q "%DEST%"
if exist "%CEP_CACHE%" rmdir /s /q "%CEP_CACHE%" >nul 2>&1

color 0A
echo.
echo  ✓ MotionPro Legendas desinstalado
echo.
pause
exit /b 0
