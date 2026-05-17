$ErrorActionPreference = "Stop"

$Version    = "1.0.0"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = Resolve-Path (Join-Path $ScriptDir "..\..")
$PluginSrc  = Join-Path $RepoRoot "plugin-legendas"
$BuildDir   = Join-Path $ScriptDir "build"
$StageDir   = Join-Path $BuildDir "MotionPro-Legendas-$Version"
$OutZip     = Join-Path $ScriptDir "output\MotionPro-Legendas-$Version.zip"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Building MotionPro-Legendas-$Version.zip" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if (Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
if (-not (Test-Path (Split-Path $OutZip))) { New-Item -ItemType Directory -Path (Split-Path $OutZip) | Out-Null }
if (Test-Path $OutZip) { Remove-Item -Force $OutZip }

New-Item -ItemType Directory -Path $StageDir | Out-Null
$PluginDest = Join-Path $StageDir "MotionPro"
New-Item -ItemType Directory -Path $PluginDest | Out-Null

Write-Host "[1/4] Copiando arquivos do plugin..." -ForegroundColor Yellow
Copy-Item -Path "$PluginSrc\*" -Destination $PluginDest -Recurse -Force
$pluginSize = (Get-ChildItem -Recurse $PluginDest | Measure-Object -Sum Length).Sum
Write-Host "      $('{0:N1}' -f ($pluginSize/1MB)) MB"

Write-Host "[2/4] Copiando scripts e leia-me..." -ForegroundColor Yellow
Copy-Item -Path "$ScriptDir\INSTALAR.bat"    -Destination $StageDir -Force
Copy-Item -Path "$ScriptDir\DESINSTALAR.bat" -Destination $StageDir -Force
Copy-Item -Path "$ScriptDir\LEIA-ME.html"    -Destination $StageDir -Force
Write-Host "      OK"

Write-Host "[3/4] Compactando ZIP (pode demorar 1-2 min com 855MB)..." -ForegroundColor Yellow
Compress-Archive -Path "$StageDir\*" -DestinationPath $OutZip -CompressionLevel Optimal -Force
$zipSize = (Get-Item $OutZip).Length
Write-Host "      ZIP: $('{0:N1}' -f ($zipSize/1MB)) MB"

Write-Host "[4/4] Hashes..." -ForegroundColor Yellow
$sha256 = (Get-FileHash -Path $OutZip -Algorithm SHA256).Hash.ToLower()

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  PRONTO" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  $OutZip"
Write-Host "  $('{0:N1}' -f ($zipSize/1MB)) MB · SHA256: $($sha256.Substring(0,32))..."
Write-Host ""

Remove-Item -Recurse -Force $BuildDir
