@echo off
chcp 65001 >nul 2>&1
title MotionPro IA - Modo Dev
color 0B
mode con: cols=78 lines=32

set "EXT_ID=com.motionpro.ia"
set "DEST=%APPDATA%\Adobe\CEP\extensions\%EXT_ID%"
set "SRC=%~dp0"
set "CEP_CACHE=%LOCALAPPDATA%\Temp\cep_cache"
set "PR_CACHE=%LOCALAPPDATA%\Adobe\CEP"

echo.
echo  ============================================================
echo            MotionPro IA - Modo de Desenvolvimento
echo  ============================================================
echo.
echo   Cria junction entre o repo e a pasta CEP do Premiere.
echo   Edita codigo aqui = Premiere ve direto (zero copy).
echo.

REM ====== 1) FORCA FECHAR PREMIERE (evita layout cached com painel preto) ======
tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" 2>nul | find /I "Adobe Premiere Pro.exe" >nul
if not errorlevel 1 (
    color 0E
    echo  [AVISO] Adobe Premiere Pro esta ABERTO.
    echo          Pra evitar bug de painel preto, e ESSENCIAL fechar antes.
    echo.
    choice /C SN /N /M "Fechar Premiere automaticamente agora? (S/N): "
    if errorlevel 2 (
        echo  Tudo bem. Feche manual e rode esse script de novo.
        pause
        exit /b 0
    )
    taskkill /F /IM "Adobe Premiere Pro.exe" >nul 2>&1
    timeout /t 3 /nobreak >nul
    color 0B
    echo.
)

echo  [1/6] Habilitando PlayerDebugMode em todas as versoes CSXS...
for %%v in (9 10 11 12) do (
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo        OK

echo  [2/6] Limpando cache CEP (Temp)...
if exist "%CEP_CACHE%" rmdir /s /q "%CEP_CACHE%" >nul 2>&1
echo        OK

echo  [3/6] Limpando cache da extensao especifica...
if exist "%LOCALAPPDATA%\Adobe\CEP\extensions\%EXT_ID%" rmdir /s /q "%LOCALAPPDATA%\Adobe\CEP\extensions\%EXT_ID%" >nul 2>&1
echo        OK

echo  [4/6] Removendo junction/pasta anterior...
if exist "%DEST%" (
    rmdir /q "%DEST%" >nul 2>&1
    if exist "%DEST%" rmdir /s /q "%DEST%" >nul 2>&1
)
echo        OK

echo  [5/6] Limpando layout salvo do Premiere (workspaces)...
REM Premiere guarda layout do workspace em vez de re-inicializar painel — limpar
REM evita aquele "retangulo preto" persistente onde o painel estava antes.
for /d %%y in ("%APPDATA%\Adobe\Premiere Pro\*") do (
    if exist "%%y\Profile-CreativeCloud-\Roaming\Cep" rmdir /s /q "%%y\Profile-CreativeCloud-\Roaming\Cep" >nul 2>&1
)
echo        OK

echo  [6/6] Criando junction (sem precisar de admin)...
mklink /J "%DEST%" "%SRC%" >nul
if errorlevel 1 (
    color 0C
    echo        [ERRO] Falha ao criar junction. Verifique permissoes.
    pause
    exit /b 1
)
echo        OK

color 0A
echo.
echo  ============================================================
echo     ✓  AMBIENTE DEV PRONTO
echo  ============================================================
echo.
echo    1. Abra o Adobe Premiere Pro
echo    2. Menu Janela ^> Extensoes ^> MotionPro IA
echo       (NAO abre automatico — AutoVisible=false)
echo.
echo    Se aparecer aba PRETA preexistente:
echo      - Clique com botao direito na aba ^> Fechar painel
echo      - Reabra em Janela ^> Extensoes ^> MotionPro IA
echo      - Salve o workspace (Janela ^> Workspaces ^> Salvar)
echo.
echo    Pra inspecionar: clique direito no painel ^> Inspect Element
echo.
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
