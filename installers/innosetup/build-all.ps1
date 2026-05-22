# build-all.ps1 — compila os 3 installers .exe via Inno Setup
# Uso: powershell -ExecutionPolicy Bypass -File build-all.ps1 [-Plugin Titles|Legendas|IA|All]

param(
    [ValidateSet("Titles","Legendas","IA","All")]
    [string]$Plugin = "All"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Localiza ISCC.exe (Inno Setup compiler)
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
    Write-Host "ERRO: Inno Setup nao encontrado." -ForegroundColor Red
    Write-Host "Instale em https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
    exit 1
}

$OutputDir = Join-Path $ScriptDir "output"
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir | Out-Null }

$plugins = @{
    Titles   = "motion-titles.iss"
    Legendas = "motion-legendas.iss"
    IA       = "motion-ia.iss"
}

$toBuild = if ($Plugin -eq "All") { $plugins.Keys } else { @($Plugin) }

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host "  Inno Setup Build · plugins: $($toBuild -join ', ')" -ForegroundColor Cyan
Write-Host "=============================================================" -ForegroundColor Cyan

$results = @()
foreach ($name in $toBuild) {
    $iss = Join-Path $ScriptDir $plugins[$name]
    if (-not (Test-Path $iss)) {
        Write-Host "  X $name : $iss nao existe" -ForegroundColor Red
        continue
    }
    Write-Host ""
    Write-Host "==> Building $name ($($plugins[$name]))..." -ForegroundColor Yellow
    $t0 = Get-Date

    & $Iscc $iss /Qp
    $code = $LASTEXITCODE
    $elapsed = (Get-Date) - $t0

    if ($code -eq 0) {
        # Acha o .exe gerado
        $exe = Get-ChildItem $OutputDir -Filter "MotionPro-$($name)*-Setup.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($exe) {
            $szMB = [math]::Round($exe.Length / 1MB, 2)
            $sha = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLower()
            Write-Host "    OK $($exe.Name)" -ForegroundColor Green
            Write-Host "       $szMB MB · SHA256 $($sha.Substring(0,32))..." -ForegroundColor Gray
            Write-Host "       tempo: $([math]::Round($elapsed.TotalSeconds,1))s" -ForegroundColor Gray
            $results += [PSCustomObject]@{ Plugin=$name; File=$exe.Name; SizeMB=$szMB; SHA256=$sha; OK=$true }
        }
    } else {
        Write-Host "    FALHOU (exit $code)" -ForegroundColor Red
        $results += [PSCustomObject]@{ Plugin=$name; OK=$false }
    }
}

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host "  RESUMO" -ForegroundColor Cyan
Write-Host "=============================================================" -ForegroundColor Cyan
$results | Format-Table Plugin, OK, File, SizeMB -AutoSize
Write-Host ""
Write-Host "Output em: $OutputDir" -ForegroundColor Cyan
