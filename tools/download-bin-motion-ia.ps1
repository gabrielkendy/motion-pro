# ============================================================
# download-bin-motion-ia.ps1
# Baixa ffmpeg + whisper-cli + yt-dlp + aria2c pro plugin Motion IA
# ASCII-safe (compativel com PowerShell 5.1)
# ============================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$binDir = Join-Path $root "plugin-ia\bin\win"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Motion IA - Download de binarios (Windows)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Destino: $binDir" -ForegroundColor Yellow
Write-Host ""

# ---------- 1. FFMPEG ----------
$ffmpegExe = Join-Path $binDir "ffmpeg.exe"
if (Test-Path $ffmpegExe) {
    Write-Host "[OK] ffmpeg.exe ja existe - pulando" -ForegroundColor Green
} else {
    Write-Host "[..] Baixando ffmpeg (gyan.dev essentials, ~80 MB)..." -ForegroundColor Cyan
    $ffmpegZip = Join-Path $env:TEMP "ffmpeg-essentials.zip"
    Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip -UseBasicParsing
    Write-Host "     Extraindo..." -ForegroundColor Gray
    $tmpDir = Join-Path $env:TEMP "ffmpeg-extract"
    if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
    Expand-Archive -Path $ffmpegZip -DestinationPath $tmpDir -Force
    $ffmpegBin = Get-ChildItem -Path $tmpDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
    if ($ffmpegBin) {
        Copy-Item $ffmpegBin.FullName $ffmpegExe -Force
        $ffprobeSrc = Join-Path $ffmpegBin.DirectoryName "ffprobe.exe"
        if (Test-Path $ffprobeSrc) {
            Copy-Item $ffprobeSrc (Join-Path $binDir "ffprobe.exe") -Force
        }
        Write-Host "[OK] ffmpeg.exe + ffprobe.exe instalados" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] ffmpeg.exe nao encontrado no zip" -ForegroundColor Red
    }
    Remove-Item -Recurse -Force $tmpDir
    Remove-Item -Force $ffmpegZip
}

# ---------- 2. WHISPER.CPP ----------
$whisperExe = Join-Path $binDir "whisper-cli.exe"
if (Test-Path $whisperExe) {
    Write-Host "[OK] whisper-cli.exe ja existe - pulando" -ForegroundColor Green
} else {
    Write-Host "[..] Baixando whisper.cpp Windows build (~30 MB)..." -ForegroundColor Cyan
    $whisperZip = Join-Path $env:TEMP "whisper-bin.zip"
    try {
        Invoke-WebRequest -Uri "https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip" -OutFile $whisperZip -UseBasicParsing
    } catch {
        # fallback URL antiga
        Invoke-WebRequest -Uri "https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-bin-x64.zip" -OutFile $whisperZip -UseBasicParsing
    }
    $tmpDir = Join-Path $env:TEMP "whisper-extract"
    if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
    Expand-Archive -Path $whisperZip -DestinationPath $tmpDir -Force
    $whisperBin = Get-ChildItem -Path $tmpDir -Recurse -Filter "whisper-cli.exe" | Select-Object -First 1
    if (-not $whisperBin) {
        $whisperBin = Get-ChildItem -Path $tmpDir -Recurse -Filter "main.exe" | Select-Object -First 1
    }
    if ($whisperBin) {
        Copy-Item $whisperBin.FullName $whisperExe -Force
        # DLLs adjacentes
        Get-ChildItem -Path $whisperBin.DirectoryName -Filter "*.dll" | ForEach-Object {
            Copy-Item $_.FullName (Join-Path $binDir $_.Name) -Force
        }
        Write-Host "[OK] whisper-cli.exe instalado" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] whisper-cli.exe nao encontrado no zip" -ForegroundColor Red
    }
    Remove-Item -Recurse -Force $tmpDir
    Remove-Item -Force $whisperZip
}

# ---------- 3. YT-DLP ----------
$ytdlpExe = Join-Path $binDir "yt-dlp.exe"
if (Test-Path $ytdlpExe) {
    Write-Host "[OK] yt-dlp.exe ja existe - pulando" -ForegroundColor Green
} else {
    Write-Host "[..] Baixando yt-dlp (~17 MB)..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $ytdlpExe -UseBasicParsing
    Write-Host "[OK] yt-dlp.exe instalado" -ForegroundColor Green
}

# ---------- 4. ARIA2C ----------
$aria2Exe = Join-Path $binDir "aria2c.exe"
if (Test-Path $aria2Exe) {
    Write-Host "[OK] aria2c.exe ja existe - pulando" -ForegroundColor Green
} else {
    Write-Host "[..] Baixando aria2c (~3 MB)..." -ForegroundColor Cyan
    $aria2Zip = Join-Path $env:TEMP "aria2.zip"
    Invoke-WebRequest -Uri "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip" -OutFile $aria2Zip -UseBasicParsing
    $tmpDir = Join-Path $env:TEMP "aria2-extract"
    if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
    Expand-Archive -Path $aria2Zip -DestinationPath $tmpDir -Force
    $aria2Bin = Get-ChildItem -Path $tmpDir -Recurse -Filter "aria2c.exe" | Select-Object -First 1
    if ($aria2Bin) {
        Copy-Item $aria2Bin.FullName $aria2Exe -Force
        Write-Host "[OK] aria2c.exe instalado" -ForegroundColor Green
    }
    Remove-Item -Recurse -Force $tmpDir
    Remove-Item -Force $aria2Zip
}

# ---------- 5. RESUMO ----------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  RESUMO" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Get-ChildItem $binDir | ForEach-Object {
    $size = [math]::Round($_.Length / 1MB, 1)
    Write-Host ("  {0,-25} {1,8} MB" -f $_.Name, $size) -ForegroundColor White
}
Write-Host ""
Write-Host "[OK] TUDO PRONTO. Sincronize o plugin pro install se necessario." -ForegroundColor Green
Write-Host ""
