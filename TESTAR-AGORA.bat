@echo off
REM ============================================================
REM  MotionVault — clique duplo aqui para instalar e testar JÁ
REM  Faz: install do plugin + ativa CSXS debug mode + abre Premiere
REM  Modo: DEV (sem backend; libera tudo, plano "lifetime" simulado)
REM ============================================================
setlocal enableextensions enabledelayedexpansion
set "ROOT=%~dp0"
set "DST=%APPDATA%\Adobe\CEP\extensions\MotionVault"
title MotionVault — Teste local

echo.
echo ===============================================
echo  MotionVault — Instalacao (modo DEV)
echo ===============================================
echo.

REM Verifica catalogo
if not exist "%ROOT%plugin\catalog\catalog.json" (
    echo [INFO] Gerando catalogo dos 7.906 templates...
    where node >nul 2>&1
    if errorlevel 1 (
        echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org/ e tente de novo.
        pause & exit /b 1
    )
    pushd "%ROOT%tools"
    node catalog-builder.js
    popd
)

REM Garante que devMode esta ON
findstr /c:"devMode: true" "%ROOT%plugin\js\config.js" >nul
if errorlevel 1 (
    echo [INFO] Forcando devMode=true no config.js
    powershell -NoProfile -Command "(Get-Content -Raw '%ROOT%plugin\js\config.js') -replace 'devMode:\s*false','devMode: true' | Set-Content -NoNewline '%ROOT%plugin\js\config.js'"
)

echo.
echo Copiando para: %DST%
if exist "%DST%" rmdir /s /q "%DST%"
xcopy /e /i /q /y "%ROOT%plugin" "%DST%" >nul
if errorlevel 1 ( echo [ERRO] Falha ao copiar. & pause & exit /b 1 )

echo Habilitando PlayerDebugMode (CSXS 6..20)...
for /l %%v in (6,1,20) do (
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v LogLevel /t REG_SZ /d 1 /f >nul 2>&1
)

echo.
echo ===============================================
echo  OK! Pronto pra usar.
echo ===============================================
echo.
echo  Proximos passos:
echo    1. Feche o Premiere se estiver aberto (verifique o Gerenciador de Tarefas)
echo    2. Abra o Premiere
echo    3. Vai em: Window ^> Extensions ^> MotionVault
echo    4. O painel abre direto no browser dos 7.906 templates
echo       (sem login, devMode ativo, plano "lifetime" simulado)
echo.
echo  Pra entregar pra clientes reais com pagamento, abra GO-LIVE.md
echo.
pause
