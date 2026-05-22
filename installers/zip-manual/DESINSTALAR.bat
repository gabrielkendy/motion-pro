@echo off
title MotionPro Titles - Desinstalador
echo.
echo ============================================================
echo   MOTION PRO TITLES - Desinstalador
echo ============================================================
echo.
echo  Este script vai remover o plugin MotionPro Titles do Adobe CEP.
echo  Sua conta e dados online NAO serao afetados.
echo.

choice /C SN /N /M "Confirma desinstalacao? (S/N): "
if errorlevel 2 exit /b 0

set "DEST=%APPDATA%\Adobe\CEP\extensions\com.motionvault.panel"
set "CACHE=%LOCALAPPDATA%\Temp\cep_cache"

echo.
echo [1/3] Fechando Adobe Premiere Pro (se aberto)...
taskkill /F /IM "Adobe Premiere Pro.exe" >nul 2>&1
taskkill /F /IM "AfterFX.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
echo       OK

echo [2/3] Removendo plugin de %DEST%...
if exist "%DEST%" (
    rmdir /s /q "%DEST%"
    echo       OK
) else (
    echo       Plugin nao encontrado (ja desinstalado?)
)

echo [3/3] Limpando cache CEP...
if exist "%CACHE%" rmdir /s /q "%CACHE%" >nul 2>&1
echo       OK

echo.
echo ============================================================
echo   OK MOTION PRO TITLES DESINSTALADO
echo ============================================================
echo.
echo Pra reinstalar, baixe novamente em motionpro-lp.vercel.app
echo.
pause
exit /b 0
