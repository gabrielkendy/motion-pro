@echo off
chcp 65001 >nul 2>&1
title MotionPro - Instalador
color 0B
mode con: cols=78 lines=28

REM ============================================================
REM   MotionPro Plugin · Instalador automatico (sem .exe)
REM   Funciona sem aviso do Windows SmartScreen
REM ============================================================

setlocal EnableDelayedExpansion
set "EXT_ID=com.motionvault.panel"
set "DEST=%APPDATA%\Adobe\CEP\extensions\%EXT_ID%"
set "SRC=%~dp0MotionPro"
set "CEP_CACHE=%LOCALAPPDATA%\Temp\cep_cache"

echo.
echo  ============================================================
echo.
echo                      M O T I O N   P R O
echo.
echo                  Instalador para Premiere Pro
echo                       by PacotesFX
echo.
echo  ============================================================
echo.

REM === Verifica se a pasta MotionPro existe ===
if not exist "%SRC%" (
    color 0C
    echo  [ERRO] Pasta "MotionPro" nao encontrada em:
    echo         %SRC%
    echo.
    echo  Voce extraiu o ZIP completo? Verifique se a pasta MotionPro
    echo  esta na mesma pasta deste INSTALAR.bat.
    echo.
    pause
    exit /b 1
)

REM === Verifica se Premiere/AE estao abertos ===
tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" 2>nul | find /I "Adobe Premiere Pro.exe" >nul
if not errorlevel 1 (
    color 0E
    echo  [AVISO] Adobe Premiere Pro esta aberto!
    echo.
    echo  Por favor, feche o Premiere antes de continuar.
    echo  Pressione qualquer tecla quando tiver fechado...
    pause >nul
    color 0B
)

tasklist /FI "IMAGENAME eq AfterFX.exe" 2>nul | find /I "AfterFX.exe" >nul
if not errorlevel 1 (
    color 0E
    echo  [AVISO] Adobe After Effects esta aberto - fechando recomendado.
    timeout /t 3 /nobreak >nul
    color 0B
)

echo  [1/5] Habilitando CEP PlayerDebugMode no Windows...
reg add "HKCU\Software\Adobe\CSXS.9"  /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo       OK
echo.

echo  [2/5] Limpando cache antigo do Adobe CEP...
if exist "%CEP_CACHE%" rmdir /s /q "%CEP_CACHE%" >nul 2>&1
echo       OK
echo.

echo  [3/5] Removendo versao anterior do MotionPro (se existir)...
if exist "%DEST%" rmdir /s /q "%DEST%" >nul 2>&1
echo       OK
echo.

echo  [4/5] Copiando arquivos do plugin...
echo       Origem:  %SRC%
echo       Destino: %DEST%
xcopy "%SRC%" "%DEST%\" /E /I /Y /Q >nul
if errorlevel 1 (
    color 0C
    echo  [ERRO] Falha ao copiar arquivos. Verifique permissoes.
    pause
    exit /b 1
)
echo       OK
echo.

echo  [5/5] Marcando arquivos como confiaveis (Unblock-File)...
powershell -NoProfile -Command "Get-ChildItem -Path '%DEST%' -Recurse -Force | Unblock-File" >nul 2>&1
echo       OK
echo.

color 0A
echo  ============================================================
echo.
echo            ✓  M O T I O N   P R O   I N S T A L A D O
echo.
echo  ============================================================
echo.
echo  PROXIMOS PASSOS:
echo.
echo    1. Abra o Adobe Premiere Pro
echo    2. Menu Janela ^> Extensoes ^> MotionPro
echo    3. Faca login (ou crie conta - 14 dias gratis)
echo    4. Pronto - 7.906 templates liberados
echo.
echo  Suporte: suporte@pacotesfx.com
echo  Site:    https://motionpro-lp.vercel.app
echo.
echo  ============================================================
echo.

choice /C SN /N /M "Quer abrir o Premiere Pro agora? (S/N): "
if errorlevel 2 goto :end
if errorlevel 1 (
    REM Tenta abrir Premiere - procura em locais padrao
    if exist "%ProgramFiles%\Adobe\Adobe Premiere Pro 2026\Adobe Premiere Pro.exe" (
        start "" "%ProgramFiles%\Adobe\Adobe Premiere Pro 2026\Adobe Premiere Pro.exe"
    ) else if exist "%ProgramFiles%\Adobe\Adobe Premiere Pro 2025\Adobe Premiere Pro.exe" (
        start "" "%ProgramFiles%\Adobe\Adobe Premiere Pro 2025\Adobe Premiere Pro.exe"
    ) else if exist "%ProgramFiles%\Adobe\Adobe Premiere Pro 2024\Adobe Premiere Pro.exe" (
        start "" "%ProgramFiles%\Adobe\Adobe Premiere Pro 2024\Adobe Premiere Pro.exe"
    ) else if exist "%ProgramFiles%\Adobe\Adobe Premiere Pro 2023\Adobe Premiere Pro.exe" (
        start "" "%ProgramFiles%\Adobe\Adobe Premiere Pro 2023\Adobe Premiere Pro.exe"
    ) else (
        echo.
        echo  Nao encontrei o Premiere automaticamente.
        echo  Abra manualmente pelo menu Iniciar.
        timeout /t 3 /nobreak >nul
    )
)

:end
echo.
endlocal
exit /b 0
