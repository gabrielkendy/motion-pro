# MotionPro IA - Instalador PowerShell
# Funciona em qualquer Windows 10/11 sem dores de encoding (ASCII puro)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src = Join-Path $ScriptDir "MotionPro-IA"
$Dst = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.motionpro.ia"

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host "  MOTION PRO IA - Instalador" -ForegroundColor Cyan
Write-Host "  Agente de Edicao IA para Premiere Pro" -ForegroundColor Cyan
Write-Host "  by PacotesFX" -ForegroundColor Cyan
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $Src)) {
    Write-Host "ERRO: pasta 'MotionPro-IA' nao encontrada em $Src" -ForegroundColor Red
    Read-Host "Pressione Enter pra sair"
    exit 1
}

$pr = Get-Process -Name "Adobe Premiere Pro" -ErrorAction SilentlyContinue
if ($pr) {
    Write-Host "AVISO: Adobe Premiere Pro esta aberto." -ForegroundColor Yellow
    Write-Host "Feche o Premiere e pressione Enter pra continuar..." -ForegroundColor Yellow
    Read-Host
}

Write-Host "[1/5] Habilitando CEP PlayerDebugMode..." -ForegroundColor Yellow
foreach ($v in 9..12) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -Type String -Force
}
Write-Host "      OK" -ForegroundColor Green

Write-Host "[2/5] Limpando cache CEP..." -ForegroundColor Yellow
$cache = Join-Path $env:LOCALAPPDATA "Temp\cep_cache"
if (Test-Path $cache) { Remove-Item -Recurse -Force $cache -ErrorAction SilentlyContinue }
Write-Host "      OK" -ForegroundColor Green

Write-Host "[3/5] Removendo versao anterior (se existir)..." -ForegroundColor Yellow
if (Test-Path $Dst) { Remove-Item -Recurse -Force $Dst -ErrorAction SilentlyContinue }
Write-Host "      OK" -ForegroundColor Green

Write-Host "[4/5] Copiando plugin para $Dst ..." -ForegroundColor Yellow
$parent = Split-Path $Dst -Parent
if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
Copy-Item -Path $Src -Destination $Dst -Recurse -Force
Write-Host "      OK" -ForegroundColor Green

Write-Host "[5/5] Marcando arquivos como confiaveis..." -ForegroundColor Yellow
Get-ChildItem -Path $Dst -Recurse -Force | Unblock-File -ErrorAction SilentlyContinue
Write-Host "      OK" -ForegroundColor Green

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "  MOTION PRO IA INSTALADO COM SUCESSO" -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor White
Write-Host "  1. Abra o Adobe Premiere Pro"
Write-Host "  2. Menu Janela > Extensoes > MotionPro IA"
Write-Host "  3. Configure sua Google Gemini API key em Licenca & Config"
Write-Host "     (gratuita em aistudio.google.com/app/apikey)"
Write-Host "  4. Comece a usar via Agente IA ou pelas Features"
Write-Host ""
Write-Host "Suporte: suporte@pacotesfx.com"
Write-Host ""
Read-Host "Pressione Enter pra fechar"
