# tools/build-ia-installer.ps1
# Build Motion Pro IA Inno Setup installer (protected, obfuscated).
#
# Pipeline:
#   1. Stage plugin-ia/ -> _build_ia_protected/  (excludes excluded patterns)
#   2. Obfuscate _build_ia_protected/js/ via tools/obfuscate.js (profile=balanced)
#   3. Compile installers/innosetup/motion-ia.iss with ISCC.exe
#   4. Verify output MotionPro-IA-4.0.0-Setup.exe exists + size > 1MB
#   5. Print SHA256 + size, clean staging
#
# Usage:
#   pwsh -File tools/build-ia-installer.ps1
#   pwsh -File tools/build-ia-installer.ps1 -SkipObfuscation
#   pwsh -File tools/build-ia-installer.ps1 -KeepStage

[CmdletBinding()]
param(
    [switch]$SkipObfuscation,
    [switch]$KeepStage,
    [string]$Profile = "balanced"
)

$ErrorActionPreference = "Stop"
$RepoRoot   = Resolve-Path (Join-Path $PSScriptRoot "..")
$PluginSrc  = Join-Path $RepoRoot "plugin-ia"
$StageDir   = Join-Path $RepoRoot "_build_ia_protected"
$IssFile    = Join-Path $RepoRoot "installers\innosetup\motion-ia.iss"
$OutputDir  = Join-Path $RepoRoot "installers\innosetup\output"
$ExpectedExe = Join-Path $OutputDir "MotionPro-IA-4.0.0-Setup.exe"
$Obfuscator  = Join-Path $RepoRoot "tools\obfuscate.js"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Motion Pro IA · Installer Build (theta/ia-installer)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RepoRoot   : $RepoRoot"
Write-Host "  PluginSrc  : $PluginSrc"
Write-Host "  Stage      : $StageDir"
Write-Host "  Output     : $ExpectedExe"
Write-Host ""

# ---------- 1. Locate ISCC.exe ----------
$IsccPaths = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 5\ISCC.exe"
)
$Iscc = $null
foreach ($p in $IsccPaths) {
    if (Test-Path $p) { $Iscc = $p; break }
}
if (-not $Iscc) {
    # Try PATH
    $cmd = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
    if ($cmd) { $Iscc = $cmd.Source }
}
if (-not $Iscc) {
    Write-Host "[ERRO] Inno Setup ISCC.exe nao encontrado." -ForegroundColor Red
    Write-Host "       Paths verificados:" -ForegroundColor Yellow
    foreach ($p in $IsccPaths) { Write-Host "         - $p" -ForegroundColor Yellow }
    Write-Host "       Instale em: https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
    exit 2
}
Write-Host "[OK] ISCC.exe: $Iscc" -ForegroundColor Green

# ---------- 2. Validate plugin-ia ----------
if (-not (Test-Path $PluginSrc)) {
    Write-Host "[ERRO] plugin-ia/ nao existe em $PluginSrc" -ForegroundColor Red
    exit 3
}
$manifest = Join-Path $PluginSrc "CSXS\manifest.xml"
if (-not (Test-Path $manifest)) {
    Write-Host "[ERRO] plugin-ia/CSXS/manifest.xml ausente" -ForegroundColor Red
    exit 3
}
Write-Host "[OK] plugin-ia/ presente" -ForegroundColor Green

# ---------- 3. Stage plugin-ia -> _build_ia_protected ----------
if (Test-Path $StageDir) {
    Write-Host "[..] limpando staging anterior" -ForegroundColor Gray
    Remove-Item $StageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $StageDir | Out-Null

$excludePatterns = @(
    "node_modules", ".git", "*.log", "*.bak",
    "models\*.bin", "models\*.bin.part",
    "test-results", "playwright-report", "tests", "docs",
    "_uninstall", ".DS_Store", "Thumbs.db"
)

Write-Host "[..] copiando plugin-ia/ -> staging" -ForegroundColor Gray
# robocopy: mais robusto que Copy-Item recursivo no Windows
$robocopyArgs = @(
    $PluginSrc, $StageDir, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP",
    "/XD", "node_modules", ".git", "test-results", "playwright-report", "tests", "docs", "_uninstall",
    "/XF", "*.log", "*.bak", ".DS_Store", "Thumbs.db", "*.bin", "*.bin.part"
)
& robocopy @robocopyArgs | Out-Null
# robocopy exit codes: 0-7 success, >=8 failure
if ($LASTEXITCODE -ge 8) {
    Write-Host "[ERRO] robocopy falhou (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 4
}

$stageSize = (Get-ChildItem $StageDir -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("[OK] staging: {0:N2} MB" -f ($stageSize / 1MB)) -ForegroundColor Green

# ---------- 4. Obfuscate JS ----------
if ($SkipObfuscation) {
    Write-Host "[--] obfuscation SKIPPED (-SkipObfuscation)" -ForegroundColor Yellow
} elseif (-not (Test-Path $Obfuscator)) {
    Write-Host "[WARN] tools/obfuscate.js nao encontrado — skip obfuscation" -ForegroundColor Yellow
} else {
    $stageJs = Join-Path $StageDir "js"
    if (-not (Test-Path $stageJs)) {
        Write-Host "[WARN] _build_ia_protected/js nao existe — skip obfuscation" -ForegroundColor Yellow
    } else {
        $node = Get-Command "node" -ErrorAction SilentlyContinue
        if (-not $node) {
            Write-Host "[WARN] node.exe nao encontrado no PATH — skip obfuscation" -ForegroundColor Yellow
        } else {
            Write-Host "[..] obfuscando JS (profile=$Profile)" -ForegroundColor Gray
            Push-Location $RepoRoot
            try {
                & node $Obfuscator --src $stageJs --profile $Profile
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "[ERRO] obfuscate.js falhou (exit $LASTEXITCODE)" -ForegroundColor Red
                    exit 5
                }
                Write-Host "[OK] JS obfuscado" -ForegroundColor Green
            } finally {
                Pop-Location
            }
        }
    }
}

# ---------- 5. Compile ISS ----------
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}
if (Test-Path $ExpectedExe) {
    Write-Host "[..] removendo .exe anterior" -ForegroundColor Gray
    Remove-Item $ExpectedExe -Force
}

Write-Host "[..] compilando $IssFile" -ForegroundColor Gray
$t0 = Get-Date
& $Iscc $IssFile /Qp
$isccExit = $LASTEXITCODE
$elapsed = (Get-Date) - $t0
if ($isccExit -ne 0) {
    Write-Host "[ERRO] ISCC falhou (exit $isccExit)" -ForegroundColor Red
    exit 6
}
Write-Host ("[OK] ISCC done em {0:N1}s" -f $elapsed.TotalSeconds) -ForegroundColor Green

# ---------- 6. Validate output ----------
if (-not (Test-Path $ExpectedExe)) {
    Write-Host "[ERRO] .exe esperado nao foi gerado: $ExpectedExe" -ForegroundColor Red
    exit 7
}
$exeInfo = Get-Item $ExpectedExe
$sizeMB  = [math]::Round($exeInfo.Length / 1MB, 2)
if ($exeInfo.Length -lt 1MB) {
    Write-Host "[ERRO] .exe gerado tem tamanho suspeito ($sizeMB MB)" -ForegroundColor Red
    exit 8
}
$sha = (Get-FileHash $ExpectedExe -Algorithm SHA256).Hash.ToLower()

# ---------- 7. Cleanup ----------
if (-not $KeepStage) {
    Remove-Item $StageDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] staging removido" -ForegroundColor Gray
} else {
    Write-Host "[--] staging preservado em $StageDir" -ForegroundColor Yellow
}

# ---------- 8. Summary ----------
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  BUILD OK" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  File   : $ExpectedExe"
Write-Host "  Size   : $sizeMB MB"
Write-Host "  SHA256 : $sha"
Write-Host ""

exit 0
