@echo off
chcp 65001 >nul 2>&1
title MotionPro - Desinstalador
color 0C
mode con: cols=78 lines=20

set "EXT_ID=com.motionvault.panel"
set "DEST=%APPDATA%\Adobe\CEP\extensions\%EXT_ID%"
set "CEP_CACHE=%LOCALAPPDATA%\Temp\cep_cache"

echo.
echo  ============================================================
echo                M O T I O N   P R O   ·   D E S I N S T A L A R
echo  ============================================================
echo.
echo  Este script vai remover o plugin MotionPro do Adobe CEP.
echo  Sua conta MotionPro e dados online NAO serao afetados.
echo.
choice /C SN /N /M "Confirma desinstalacao? (S/N): "
if errorlevel 2 exit /b 0

echo.
echo  [1/3] Fechando Adobe Premiere Pro (se aberto)...
taskkill /F /IM "Adobe Premiere Pro.exe" >nul 2>&1
taskkill /F /IM "AfterFX.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
echo       OK
echo.

echo  [2/3] Removendo plugin de %DEST%...
if exist "%DEST%" (
    rmdir /s /q "%DEST%"
    echo       OK
) else (
    echo       Plugin nao encontrado (ja desinstalado?)
)
echo.

echo  [3/3] Limpando cache CEP...
if exist "%CEP_CACHE%" rmdir /s /q "%CEP_CACHE%" >nul 2>&1
echo       OK
echo.

color 0A
echo  ============================================================
echo            ✓  M O T I O N   P R O   D E S I N S T A L A D O
echo  ============================================================
echo.
echo  Pra reinstalar, baixe novamente em motionpro-lp.vercel.app
echo.
pause
exit /b 0
