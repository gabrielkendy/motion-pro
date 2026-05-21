# build-zip.ps1 — empacota plugin-ia + instaladores num único .zip
#
# Uso: powershell -ExecutionPolicy Bypass -File build-zip.ps1
#
# Produz: dist\MotionPro-IA-installer-windows.zip contendo
#   MotionPro-IA\        (cópia de plugin-ia\)
#   INSTALAR.bat
#   DESINSTALAR.bat
#   LEIA-ME.html

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $here "..\..")
$pluginSrc = Join-Path $repoRoot "plugin-ia"
$dist = Join-Path $here "dist"
$staging = Join-Path $dist "staging"

if (-not (Test-Path $pluginSrc)) {
    throw "plugin-ia not found at $pluginSrc"
}

Write-Host "→ Limpando staging..."
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

Write-Host "→ Copiando plugin-ia → MotionPro-IA..."
Copy-Item -Recurse -Force $pluginSrc (Join-Path $staging "MotionPro-IA")

Write-Host "→ Copiando instaladores..."
Copy-Item -Force (Join-Path $here "INSTALAR.bat")    $staging
Copy-Item -Force (Join-Path $here "DESINSTALAR.bat") $staging
if (Test-Path (Join-Path $here "LEIA-ME.html")) {
    Copy-Item -Force (Join-Path $here "LEIA-ME.html") $staging
}

$zipPath = Join-Path $dist "MotionPro-IA-installer-windows.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

Write-Host "→ Zipping → $zipPath"
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -CompressionLevel Optimal

$size = "{0:N2} MB" -f ((Get-Item $zipPath).Length / 1MB)
Write-Host ""
Write-Host "✓ Build done: $zipPath ($size)" -ForegroundColor Green
