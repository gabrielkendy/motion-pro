@echo off
REM ============================================================
REM  MotionVault — Windows installer
REM  - copies the plugin to %APPDATA%\Adobe\CEP\extensions\MotionVault
REM  - enables PlayerDebugMode on every CSXS version (unsigned ext loading)
REM  - registers the Premiere panel menu
REM ============================================================
setlocal enableextensions enabledelayedexpansion

set "EXT_NAME=MotionVault"
set "SRC=%~dp0..\..\plugin"
set "DST=%APPDATA%\Adobe\CEP\extensions\%EXT_NAME%"

echo.
echo === MotionVault installer (Windows) ===
echo Origem : %SRC%
echo Destino: %DST%
echo.

if not exist "%SRC%\CSXS\manifest.xml" (
    echo [ERRO] manifest.xml nao encontrado em %SRC%\CSXS
    pause & exit /b 1
)

if exist "%DST%" (
    echo Removendo instalacao anterior...
    rmdir /s /q "%DST%"
)

echo Copiando arquivos...
xcopy /e /i /q /y "%SRC%" "%DST%" > nul
if errorlevel 1 ( echo [ERRO] falha ao copiar & pause & exit /b 1 )

echo Habilitando PlayerDebugMode (CSXS 6..20)...
for /l %%v in (6,1,20) do (
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f > nul 2>&1
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v LogLevel /t REG_SZ /d 1 /f > nul 2>&1
)

echo.
echo OK! Reabra o Adobe Premiere Pro e procure por:
echo   Window ^> Extensions ^> MotionVault
echo.
pause
