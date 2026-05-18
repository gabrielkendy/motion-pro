# ============================================================
# Build do MotionPro-Plugin-VERSION.zip
# Cria um ZIP autocontido com instalador automático (.bat),
# desinstalador, LEIA-ME.html e a pasta do plugin pronta.
# ============================================================

param(
    [string]$ObfuscateProfile = "balanced",  # "balanced" | "aggressive" | "off"
    [switch]$SkipObfuscate
)

$ErrorActionPreference = "Stop"

$Version    = "1.0.4"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = Resolve-Path (Join-Path $ScriptDir "..\..")
$PluginSrc  = Join-Path $RepoRoot "plugin"
$ToolsDir   = Join-Path $RepoRoot "tools"
$BuildDir   = Join-Path $ScriptDir "build"
$StageDir   = Join-Path $BuildDir "MotionPro-Plugin-$Version"
$OutZip     = Join-Path $ScriptDir "output\MotionPro-Plugin-$Version.zip"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Building MotionPro-Plugin-$Version.zip" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Limpa builds antigos
if (Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
if (-not (Test-Path (Split-Path $OutZip))) { New-Item -ItemType Directory -Path (Split-Path $OutZip) | Out-Null }
if (Test-Path $OutZip) { Remove-Item -Force $OutZip }

# Estrutura de stage
New-Item -ItemType Directory -Path $StageDir | Out-Null
$PluginDest = Join-Path $StageDir "MotionPro"
New-Item -ItemType Directory -Path $PluginDest | Out-Null

Write-Host "[1/5] Copiando arquivos do plugin..." -ForegroundColor Yellow
Copy-Item -Path "$PluginSrc\*" -Destination $PluginDest -Recurse -Force
$pluginSize = (Get-ChildItem -Recurse $PluginDest | Measure-Object -Sum Length).Sum
Write-Host "      $('{0:N0}' -f $pluginSize) bytes copiados" -ForegroundColor Gray

Write-Host "[2/5] Obfuscando JS (profile=$ObfuscateProfile)..." -ForegroundColor Yellow
if ($SkipObfuscate -or $ObfuscateProfile -eq "off") {
    Write-Host "      PULADO (DEV build sem obfuscação)" -ForegroundColor DarkYellow
} else {
    $JsStage = Join-Path $PluginDest "js"
    if (-not (Test-Path (Join-Path $ToolsDir "node_modules\javascript-obfuscator"))) {
        Write-Host "      Instalando deps em tools/ ..." -ForegroundColor DarkGray
        Push-Location $ToolsDir
        npm install --no-audit --no-fund --silent 2>&1 | Out-Null
        Pop-Location
    }
    node "$ToolsDir\obfuscate.js" --src "$JsStage" --profile "$ObfuscateProfile"
    if ($LASTEXITCODE -ne 0) { throw "Obfuscation failed (exit $LASTEXITCODE)" }
}

Write-Host "[3/5] Copiando scripts e leia-me..." -ForegroundColor Yellow
Copy-Item -Path "$ScriptDir\INSTALAR.bat"    -Destination $StageDir -Force
Copy-Item -Path "$ScriptDir\DESINSTALAR.bat" -Destination $StageDir -Force
Copy-Item -Path "$ScriptDir\LEIA-ME.html"    -Destination $StageDir -Force
Write-Host "      OK"

Write-Host "[4/5] Compactando em ZIP (pode demorar ~30s)..." -ForegroundColor Yellow
Compress-Archive -Path "$StageDir\*" -DestinationPath $OutZip -CompressionLevel Optimal -Force
$zipSize = (Get-Item $OutZip).Length
Write-Host "      ZIP gerado: $('{0:N2}' -f ($zipSize/1MB)) MB" -ForegroundColor Gray

Write-Host "[5/5] Calculando hashes..." -ForegroundColor Yellow
$sha256 = (Get-FileHash -Path $OutZip -Algorithm SHA256).Hash.ToLower()
$sha1   = (Get-FileHash -Path $OutZip -Algorithm SHA1).Hash.ToLower()
$md5    = (Get-FileHash -Path $OutZip -Algorithm MD5).Hash.ToLower()

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  PRONTO" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Arquivo: $OutZip"
Write-Host "  Tamanho: $('{0:N2}' -f ($zipSize/1MB)) MB"
Write-Host ""
Write-Host "  SHA-256: $sha256"
Write-Host "  SHA-1:   $sha1"
Write-Host "  MD5:     $md5"
Write-Host ""
Write-Host "  Proximo passo: subir esse .zip no GitHub Release v$Version" -ForegroundColor Cyan
Write-Host "  Comando rapido: explorer `"$(Split-Path $OutZip)`""
Write-Host ""

# Limpa stage (mantém só o zip)
Remove-Item -Recurse -Force $BuildDir

# Salva manifest dos hashes pra ser usado pela landing
$manifest = @{
    version = $Version
    file    = "MotionPro-Plugin-$Version.zip"
    size    = $zipSize
    sha256  = $sha256
    sha1    = $sha1
    md5     = $md5
    builtAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
} | ConvertTo-Json
Set-Content -Path (Join-Path (Split-Path $OutZip) "manifest-$Version.json") -Value $manifest -Encoding UTF8

exit 0
