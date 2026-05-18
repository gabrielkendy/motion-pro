$ErrorActionPreference = "Stop"

$Version    = "1.1.0"
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

# Pastas e arquivos que entram no ZIP. NÃO copia toda a pasta packs/ porque tem
# packs gigantes (titles_lower_thirds, legendas-noticias, etc) que NÃO são usados
# pelo catálogo do plugin Legendas — só ep-texto/ é referenciado.
$IncludeDirs = @('CSXS','css','fonts','img','js','jsx','locales')
$IncludeFiles = @('index.html','CHANGELOG.md','README.md')

foreach ($d in $IncludeDirs) {
    $srcD = Join-Path $PluginSrc $d
    if (Test-Path $srcD) {
        Copy-Item -Path $srcD -Destination $PluginDest -Recurse -Force
    }
}
foreach ($f in $IncludeFiles) {
    $srcF = Join-Path $PluginSrc $f
    if (Test-Path $srcF) {
        Copy-Item -Path $srcF -Destination $PluginDest -Force
    }
}

# Pasta packs — copia SÓ ep-texto e sfx + JSONs de metadata
$packsDest = Join-Path $PluginDest "packs"
New-Item -ItemType Directory -Path $packsDest | Out-Null
Copy-Item -Path (Join-Path $PluginSrc "packs\ep-texto") -Destination $packsDest -Recurse -Force
Copy-Item -Path (Join-Path $PluginSrc "packs\sfx")      -Destination $packsDest -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $PluginSrc "packs\catalog.json")           -Destination $packsDest -Force
Copy-Item -Path (Join-Path $PluginSrc "packs\font-requirements.json") -Destination $packsDest -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $PluginSrc "packs\slot-info.json")         -Destination $packsDest -Force -ErrorAction SilentlyContinue

# Remove backups internos do pack ep-texto (snapshots de edição de fontes)
$bkpDirs = @('_backup_pre_font_fix','_backup_pre_all_helvetica_bold')
foreach ($b in $bkpDirs) {
    $bp = Join-Path $packsDest "ep-texto\$b"
    if (Test-Path $bp) {
        Remove-Item -Recurse -Force $bp
        Write-Host "      removido: ep-texto/$b"
    }
}

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
