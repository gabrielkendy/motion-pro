@echo off
set "DST=%APPDATA%\Adobe\CEP\extensions\MotionVault"
if exist "%DST%" (
    rmdir /s /q "%DST%"
    echo MotionVault removido.
) else (
    echo MotionVault nao encontrado.
)
pause
