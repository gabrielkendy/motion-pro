# build-zip.ps1 — empacota plugin-ia + instaladores em ZIP versionado
#
# Uso: powershell -ExecutionPolicy Bypass -File build-zip.ps1
#
# Produz: output\MotionPro-IA-{Version}.zip contendo
#   MotionPro-IA\        (cópia de plugin-ia\)
#   INSTALAR.bat         (launcher ASCII puro do PS1)
#   INSTALAR.ps1         (instalador PowerShell robusto)
#   DESINSTALAR.bat
#   LEIA-ME.html         (se existir)

param(
    [string]$Version = "4.0.3"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $here "..\..")
$pluginSrc = Join-Path $repoRoot "plugin-ia"
$dist = Join-Path $here "output"
$staging = Join-Path $dist "staging-$Version"

if (-not (Test-Path $pluginSrc)) {
    throw "plugin-ia not found at $pluginSrc"
}

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host "  Building MotionPro-IA-$Version.zip" -ForegroundColor Cyan
Write-Host "=============================================================" -ForegroundColor Cyan

if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist -Force | Out-Null }

Write-Host "[1/4] Copiando plugin-ia -> MotionPro-IA..." -ForegroundColor Yellow
$pluginDest = Join-Path $staging "MotionPro-IA"
# Inclui tudo EXCETO node_modules, .git, models/*.bin (140MB+ baixa em runtime)
Copy-Item -Recurse -Force -Path $pluginSrc -Destination $pluginDest
# Limpa modelos Whisper (baixados em runtime, evita ZIP gigante)
$modelsDir = Join-Path $pluginDest "models"
if (Test-Path $modelsDir) {
    Get-ChildItem $modelsDir -Filter "*.bin" -ErrorAction SilentlyContinue | Remove-Item -Force
    Get-ChildItem $modelsDir -Filter "*.bin.part" -ErrorAction SilentlyContinue | Remove-Item -Force
}
$sz = (Get-ChildItem $pluginDest -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host "      $([math]::Round($sz/1024/1024,1)) MB" -ForegroundColor Gray

Write-Host "[2/4] Copiando instaladores ASCII puros..." -ForegroundColor Yellow
Copy-Item -Force (Join-Path $here "INSTALAR.bat")    $staging
Copy-Item -Force (Join-Path $here "INSTALAR.ps1")    $staging
Copy-Item -Force (Join-Path $here "DESINSTALAR.bat") $staging
if (Test-Path (Join-Path $here "LEIA-ME.html")) {
    Copy-Item -Force (Join-Path $here "LEIA-ME.html") $staging
}
Write-Host "      OK" -ForegroundColor Gray

Write-Host "[3/4] Compactando..." -ForegroundColor Yellow
$zipPath = Join-Path $dist "MotionPro-IA-$Version.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -CompressionLevel Optimal
$zipSize = (Get-Item $zipPath).Length

Write-Host "[4/4] Hashes..." -ForegroundColor Yellow
$sha256 = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()

Remove-Item -Recurse -Force $staging

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "  PRONTO" -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "  $zipPath"
Write-Host "  $([math]::Round($zipSize/1024/1024,2)) MB"
Write-Host "  SHA256: $($sha256.Substring(0,32))..."
Write-Host ""
