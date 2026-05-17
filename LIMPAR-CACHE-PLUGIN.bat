@echo off
REM ============================================
REM   MotionVault Plugin · Reset Cache CEP
REM   Use sempre que atualizar o plugin
REM ============================================

echo.
echo ============================================
echo   MotionVault · Limpando cache CEP do Adobe
echo ============================================
echo.

REM 1. Fecha Premiere se estiver aberto
echo [1/4] Fechando Adobe Premiere Pro...
taskkill /F /IM "Adobe Premiere Pro.exe" 2>nul
taskkill /F /IM "AfterFX.exe" 2>nul
timeout /t 2 /nobreak >nul

REM 2. Limpa cache CEP
echo [2/4] Limpando cache CEP...
if exist "%LOCALAPPDATA%\Temp\cep_cache" (
    rmdir /s /q "%LOCALAPPDATA%\Temp\cep_cache" 2>nul
    echo       OK
) else (
    echo       Cache ja estava limpo.
)

REM 3. Limpa cache de extensoes Adobe
echo [3/4] Limpando cache de extensoes...
if exist "%APPDATA%\Adobe\CEP\extensions\cache" (
    rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\cache" 2>nul
    echo       OK
)

REM 4. Mostra versao instalada
echo [4/4] Versao do plugin instalada:
if exist "%APPDATA%\Adobe\CEP\extensions\com.motionvault.panel\CSXS\manifest.xml" (
    findstr "ExtensionBundleVersion" "%APPDATA%\Adobe\CEP\extensions\com.motionvault.panel\CSXS\manifest.xml"
) else (
    echo       Plugin nao esta instalado em %%APPDATA%%\Adobe\CEP\extensions\
    echo       Caminho esperado: %APPDATA%\Adobe\CEP\extensions\com.motionvault.panel\
)

echo.
echo ============================================
echo   PRONTO! Pode abrir o Premiere agora.
echo   Janela ^> Extensoes ^> MotionVault
echo ============================================
echo.
pause
