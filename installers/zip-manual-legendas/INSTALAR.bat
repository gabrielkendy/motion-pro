@echo off
chcp 65001 >nul 2>&1
title MotionPro Legendas - Instalador
color 0B
mode con: cols=78 lines=28

setlocal EnableDelayedExpansion
set "EXT_ID=com.motionpro.legendas"
set "DEST=%APPDATA%\Adobe\CEP\extensions\%EXT_ID%"
set "SRC=%~dp0MotionPro"
set "CEP_CACHE=%LOCALAPPDATA%\Temp\cep_cache"

echo.
echo  ============================================================
echo.
echo            M O T I O N   P R O   ·   L E G E N D A S
echo.
echo                  Instalador para Premiere Pro
echo                       by PacotesFX
echo.
echo  ============================================================
echo.

if not exist "%SRC%" (
    color 0C
    echo  [ERRO] Pasta "MotionPro" nao encontrada em: %SRC%
    pause
    exit /b 1
)

tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" 2>nul | find /I "Adobe Premiere Pro.exe" >nul
if not errorlevel 1 (
    color 0E
    echo  [AVISO] Premiere Pro esta aberto - feche antes de continuar
    pause >nul
    color 0B
)

echo  [1/5] Habilitando CEP PlayerDebugMode...
for %%v in (9 10 11 12) do (
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo       OK

echo  [2/5] Limpando cache CEP...
if exist "%CEP_CACHE%" rmdir /s /q "%CEP_CACHE%" >nul 2>&1
echo       OK

echo  [3/5] Removendo versao anterior...
if exist "%DEST%" rmdir /s /q "%DEST%" >nul 2>&1
echo       OK

echo  [4/5] Copiando arquivos (pode demorar - 855MB)...
xcopy "%SRC%" "%DEST%\" /E /I /Y /Q >nul
if errorlevel 1 (
    color 0C
    echo  [ERRO] Falha ao copiar. Verifique permissoes.
    pause
    exit /b 1
)
echo       OK

echo  [5/5] Marcando arquivos como confiaveis...
powershell -NoProfile -Command "Get-ChildItem -Path '%DEST%' -Recurse -Force | Unblock-File" >nul 2>&1
echo       OK

color 0A
echo.
echo  ============================================================
echo     ✓  M O T I O N   P R O   L E G E N D A S   I N S T A L A D O
echo  ============================================================
echo.
echo    1. Abra o Adobe Premiere Pro
echo    2. Menu Janela ^> Extensoes ^> MotionPro Legendas
echo    3. Faca login (ou crie conta - 14 dias gratis)
echo    4. Pronto - 549 titulos liberados
echo.
echo  Suporte: suporte@pacotesfx.com
echo  ============================================================
echo.

choice /C SN /N /M "Abrir Premiere agora? (S/N): "
if errorlevel 1 if not errorlevel 2 (
    for %%y in (2026 2025 2024 2023) do (
        if exist "%ProgramFiles%\Adobe\Adobe Premiere Pro %%y\Adobe Premiere Pro.exe" (
            start "" "%ProgramFiles%\Adobe\Adobe Premiere Pro %%y\Adobe Premiere Pro.exe"
            goto :done
        )
    )
)
:done
endlocal
exit /b 0
