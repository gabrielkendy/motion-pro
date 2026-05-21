# ============================================================
# release.ps1 — automação completa de release dos plugins
# ============================================================
# Uso:
#   .\release.ps1                    # builda APENAS o que mudou (auto-detect via mtime)
#   .\release.ps1 -Plugin legendas   # força só legendas
#   .\release.ps1 -Plugin all        # força os 3
#   .\release.ps1 -SkipDeploy        # builda mas não deploya (pra dev)
#   .\release.ps1 -DryRun            # mostra o que faria, sem mexer
#
# O que faz:
#   1. Detecta qual plugin foi modificado desde o último ZIP
#   2. Bumpa o patch da versão automaticamente (1.2.1 → 1.2.2)
#   3. Builda o ZIP novo (com obfuscation balanced)
#   4. Remove o ZIP antigo de landing/installers/
#   5. Copia o novo
#   6. Atualiza download.html (versão + tamanho + link)
#   7. Deploy landing pro Vercel (a menos que -SkipDeploy)
#   8. Valida que ZIP responde 200 na URL pública
#   9. Imprime resumo + links prontos pra compartilhar
# ============================================================

param(
    [ValidateSet('auto','titles','legendas','ia','all')]
    [string]$Plugin = 'auto',
    [switch]$SkipDeploy,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }

# Tabela: id → metadados do plugin
$Plugins = @{
    'titles' = @{
        Id           = 'titles'
        Display      = 'Motion Titles'
        Source       = "$Root\plugin"
        BuildScript  = "$Root\installers\zip-manual\build-zip.ps1"
        BuildOut     = "$Root\installers\zip-manual\output"
        ZipPrefix    = 'MotionPro-Plugin'
        SizeUnit     = 'MB'
    }
    'legendas' = @{
        Id           = 'legendas'
        Display      = 'Motion Legendas'
        Source       = "$Root\plugin-legendas"
        BuildScript  = "$Root\installers\zip-manual-legendas\build-zip.ps1"
        BuildOut     = "$Root\installers\zip-manual-legendas\output"
        ZipPrefix    = 'MotionPro-Legendas'
        SizeUnit     = 'MB'
    }
    'ia' = @{
        Id           = 'ia'
        Display      = 'Motion IA'
        Source       = "$Root\plugin-ia"
        BuildScript  = "$Root\installers\zip-manual-ia\build-zip.ps1"
        BuildOut     = "$Root\installers\zip-manual-ia\dist"
        ZipPrefix    = 'MotionPro-IA'
        SizeUnit     = 'KB'
    }
}

$Landing       = "$Root\landing"
$LandingZips   = "$Landing\installers"
$DownloadHtml  = "$Landing\download.html"

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }

# ════════════ 1. Auto-detecta o que mudou ════════════
function Get-CurrentZipVersion($prefix) {
    $existing = Get-ChildItem -Path $LandingZips -Filter "$prefix-*.zip" -ErrorAction SilentlyContinue
    if (-not $existing) { return $null }
    $latest = $existing | Sort-Object Name -Descending | Select-Object -First 1
    if ($latest.Name -match "$prefix-(\d+)\.(\d+)\.(\d+)\.zip$") {
        return @{ Full = "$($Matches[1]).$($Matches[2]).$($Matches[3])"; Major = [int]$Matches[1]; Minor = [int]$Matches[2]; Patch = [int]$Matches[3]; FileName = $latest.Name; Path = $latest.FullName }
    }
    return $null
}

function Test-NeedsRebuild($p) {
    $cur = Get-CurrentZipVersion $p.ZipPrefix
    if (-not $cur) { return $true }  # nenhum ZIP atual → buildar
    if (-not (Test-Path $p.Source)) { return $false }
    $zipTime = (Get-Item $cur.Path).LastWriteTime
    $newer = Get-ChildItem -Path $p.Source -Recurse -File -ErrorAction SilentlyContinue |
             Where-Object { $_.LastWriteTime -gt $zipTime } |
             Select-Object -First 1
    return [bool]$newer
}

function Bump-Patch($ver) {
    if ($null -eq $ver) { return @{ Full='1.0.0'; Major=1; Minor=0; Patch=0 } }
    return @{ Full = "$($ver.Major).$($ver.Minor).$($ver.Patch + 1)"; Major = $ver.Major; Minor = $ver.Minor; Patch = ($ver.Patch + 1) }
}

# ════════════ 2. Atualiza a versão dentro do build-zip.ps1 ════════════
function Update-BuildVersion($scriptPath, $newVer) {
    if (-not (Test-Path $scriptPath)) { return $false }
    $content = Get-Content $scriptPath -Raw
    if ($content -match '\$Version\s*=\s*"[^"]+"') {
        $new = $content -replace '(\$Version\s*=\s*")[^"]+(")', "`${1}$newVer`${2}"
        if ($DryRun) { Write-Step "(dry-run) atualizaria \$Version em $scriptPath → $newVer" }
        else { Set-Content -Path $scriptPath -Value $new -NoNewline; Write-Ok "build-zip.ps1 \$Version → $newVer" }
        return $true
    }
    # Script do IA não tem $Version — vamos passar via env
    return $false
}

# ════════════ 3. Roda o build inline (sem ExecutionPolicy bypass) ════════════
function Invoke-Build($p, $version) {
    Write-Step "Building $($p.Display) v$version..."
    if ($DryRun) { Write-Step "(dry-run) pularia o build"; return $null }

    switch ($p.Id) {
        'titles' {
            & powershell -NoProfile -Command {
                param($src,$dest,$ver,$root)
                $ErrorActionPreference="Stop"
                $ScriptDir = "$root\installers\zip-manual"
                $StageDir  = "$ScriptDir\build\MotionPro-Plugin-$ver"
                $OutZip    = "$ScriptDir\output\MotionPro-Plugin-$ver.zip"
                if (Test-Path "$ScriptDir\build") { Remove-Item -Recurse -Force "$ScriptDir\build" }
                if (Test-Path $OutZip) { Remove-Item -Force $OutZip }
                if (-not (Test-Path "$ScriptDir\output")) { New-Item -ItemType Directory -Path "$ScriptDir\output" | Out-Null }
                New-Item -ItemType Directory -Path $StageDir | Out-Null
                $D = "$StageDir\MotionPro"; New-Item -ItemType Directory -Path $D | Out-Null
                Copy-Item -Path "$src\*" -Destination $D -Recurse -Force
                if (Test-Path "$root\tools\node_modules\javascript-obfuscator") {
                    node "$root\tools\obfuscate.js" --src "$D\js" --profile balanced 2>&1 | Out-Null
                }
                Copy-Item -Path "$ScriptDir\INSTALAR.bat","$ScriptDir\DESINSTALAR.bat","$ScriptDir\LEIA-ME.html" -Destination $StageDir -Force
                Compress-Archive -Path "$StageDir\*" -DestinationPath $OutZip -CompressionLevel Optimal -Force
                Remove-Item -Recurse -Force "$ScriptDir\build"
                return $OutZip
            } -ArgumentList $p.Source,$p.BuildOut,$version,$Root
        }
        'legendas' {
            & powershell -NoProfile -Command {
                param($src,$dest,$ver,$root)
                $ErrorActionPreference="Stop"
                $ScriptDir = "$root\installers\zip-manual-legendas"
                $StageDir  = "$ScriptDir\build\MotionPro-Legendas-$ver"
                $OutZip    = "$ScriptDir\output\MotionPro-Legendas-$ver.zip"
                if (Test-Path "$ScriptDir\build") { Remove-Item -Recurse -Force "$ScriptDir\build" }
                if (Test-Path $OutZip) { Remove-Item -Force $OutZip }
                if (-not (Test-Path "$ScriptDir\output")) { New-Item -ItemType Directory -Path "$ScriptDir\output" | Out-Null }
                New-Item -ItemType Directory -Path $StageDir | Out-Null
                $D = "$StageDir\MotionPro"; New-Item -ItemType Directory -Path $D | Out-Null
                foreach ($dir in @('CSXS','css','fonts','img','js','jsx','locales')) {
                    if (Test-Path "$src\$dir") { Copy-Item -Path "$src\$dir" -Destination $D -Recurse -Force }
                }
                foreach ($f in @('index.html','CHANGELOG.md','README.md')) {
                    if (Test-Path "$src\$f") { Copy-Item -Path "$src\$f" -Destination $D -Force }
                }
                New-Item -ItemType Directory -Path "$D\packs" | Out-Null
                Copy-Item -Path "$src\packs\ep-texto" -Destination "$D\packs" -Recurse -Force
                if (Test-Path "$src\packs\sfx") { Copy-Item -Path "$src\packs\sfx" -Destination "$D\packs" -Recurse -Force }
                Copy-Item -Path "$src\packs\catalog.json" -Destination "$D\packs" -Force
                foreach ($j in @('font-requirements.json','slot-info.json')) {
                    if (Test-Path "$src\packs\$j") { Copy-Item -Path "$src\packs\$j" -Destination "$D\packs" -Force }
                }
                foreach ($b in @('_backup_pre_font_fix','_backup_pre_all_helvetica_bold')) {
                    if (Test-Path "$D\packs\ep-texto\$b") { Remove-Item -Recurse -Force "$D\packs\ep-texto\$b" }
                }
                if (Test-Path "$root\tools\node_modules\javascript-obfuscator") {
                    node "$root\tools\obfuscate.js" --src "$D\js" --profile balanced 2>&1 | Out-Null
                }
                Copy-Item -Path "$ScriptDir\INSTALAR.bat","$ScriptDir\DESINSTALAR.bat","$ScriptDir\LEIA-ME.html" -Destination $StageDir -Force
                Compress-Archive -Path "$StageDir\*" -DestinationPath $OutZip -CompressionLevel Optimal -Force
                Remove-Item -Recurse -Force "$ScriptDir\build"
                return $OutZip
            } -ArgumentList $p.Source,$p.BuildOut,$version,$Root
        }
        'ia' {
            & powershell -NoProfile -Command {
                param($src,$dest,$ver,$root)
                $ErrorActionPreference="Stop"
                $ScriptDir = "$root\installers\zip-manual-ia"
                $Stage = "$ScriptDir\dist\staging"
                if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
                New-Item -ItemType Directory -Path $Stage -Force | Out-Null
                Copy-Item -Recurse -Force $src "$Stage\MotionPro-IA"
                Copy-Item -Force "$ScriptDir\INSTALAR.bat","$ScriptDir\DESINSTALAR.bat" $Stage
                if (Test-Path "$ScriptDir\LEIA-ME.html") { Copy-Item -Force "$ScriptDir\LEIA-ME.html" $Stage }
                $OutZip = "$ScriptDir\dist\MotionPro-IA-$ver.zip"
                if (Test-Path $OutZip) { Remove-Item -Force $OutZip }
                Compress-Archive -Path "$Stage\*" -DestinationPath $OutZip -CompressionLevel Optimal
                Remove-Item -Recurse -Force $Stage
                return $OutZip
            } -ArgumentList $p.Source,$p.BuildOut,$version,$Root
        }
    }
    $zipPath = "$($p.BuildOut)\$($p.ZipPrefix)-$version.zip"
    if (-not (Test-Path $zipPath)) { throw "Build não produziu ZIP esperado: $zipPath" }
    $size = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Write-Ok "$($p.Display) v$version → $size MB"
    return $zipPath
}

# ════════════ 4. Sync pra landing/installers/ ════════════
function Sync-ToLanding($p, $oldVer, $newZipPath) {
    if ($DryRun) { Write-Step "(dry-run) sync $newZipPath → landing/installers/"; return }
    if ($oldVer) {
        $oldPath = Join-Path $LandingZips $oldVer.FileName
        if (Test-Path $oldPath) { Remove-Item -Force $oldPath; Write-Ok "removido: $($oldVer.FileName)" }
    }
    Copy-Item -Path $newZipPath -Destination $LandingZips -Force
    Write-Ok "copiado: $(Split-Path $newZipPath -Leaf)"
}

# ════════════ 5. Atualiza download.html ════════════
function Update-DownloadHtml($p, $oldVer, $newVer, $newZipPath) {
    if ($DryRun) { Write-Step "(dry-run) atualizaria download.html → $newVer"; return }
    if (-not $oldVer) { Write-Warn "sem versão antiga em download.html — pulando"; return }
    $size = (Get-Item $newZipPath).Length
    $sizeStr = if ($size -gt 1MB) { "~$([math]::Round($size/1MB)) MB" } else { "~$([math]::Round($size/1KB)) KB" }
    $content = Get-Content $DownloadHtml -Raw
    $content = $content -replace [regex]::Escape("$($p.ZipPrefix)-$($oldVer.Full).zip"), "$($p.ZipPrefix)-$newVer.zip"
    # Atualiza linha de versão (procura próximo "v X.Y.Z · ~N (MB|KB)" depois do nome)
    $oldVerStr = "v$($oldVer.Full)"
    $newVerStr = "v$newVer"
    # Substitui APENAS a primeira ocorrência da versão antiga (cada plugin tem uma)
    $content = [regex]::Replace($content, [regex]::Escape($oldVerStr), $newVerStr, 1)
    Set-Content -Path $DownloadHtml -Value $content -NoNewline
    Write-Ok "download.html: $oldVerStr → $newVerStr, link → $($p.ZipPrefix)-$newVer.zip"
}

# ════════════ 6. Deploy ════════════
function Invoke-Deploy() {
    if ($SkipDeploy -or $DryRun) {
        if ($DryRun) { Write-Step "(dry-run) pularia deploy" } else { Write-Warn "deploy pulado (-SkipDeploy)" }
        return
    }
    Write-Step "Deploying landing → motionpro-lp.vercel.app ..."
    Push-Location $Root
    try {
        if (-not (Test-Path "$Root\.vercel\project.json") -or -not ((Get-Content "$Root\.vercel\project.json" -Raw) -match '"motionpro-lp"')) {
            if (Test-Path "$Root\.vercel") { Remove-Item -Recurse -Force "$Root\.vercel" }
            vercel link --yes --project motionpro-lp 2>&1 | Out-Null
        }
        $out = vercel --prod --yes 2>&1
        $url = ($out | Select-String -Pattern 'https://motionpro-lp[^\s]*' | Select-Object -First 1).Matches.Value
        Write-Ok "deploy: $url"
    } finally { Pop-Location }
}

# ════════════ 7. Valida URL pública ════════════
function Test-PublicZip($p, $newVer) {
    if ($SkipDeploy -or $DryRun) { return }
    $url = "https://motionpro-lp.vercel.app/installers/$($p.ZipPrefix)-$newVer.zip"
    try {
        $r = Invoke-WebRequest -Method Head -Uri $url -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) { Write-Ok "público OK: $url ($([math]::Round([int]$r.Headers.'Content-Length' / 1MB, 2)) MB)" }
        else { Write-Warn "público retornou $($r.StatusCode): $url" }
    } catch { Write-Warn "erro validando público: $($_.Exception.Message)" }
}

# ════════════════════════════════════════
# MAIN
# ════════════════════════════════════════
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  MotionVault Release · $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Magenta
if ($DryRun) { Write-Host "  (DRY-RUN — nada será modificado)" -ForegroundColor DarkYellow }
Write-Host ""

# Decide quem buildar
$ToBuild = @()
if ($Plugin -eq 'all') { $ToBuild = $Plugins.Keys }
elseif ($Plugin -eq 'auto') {
    foreach ($k in $Plugins.Keys) {
        if (Test-NeedsRebuild $Plugins[$k]) { $ToBuild += $k; Write-Host "  → $($Plugins[$k].Display) detectado mudança" -ForegroundColor Yellow }
    }
    if (-not $ToBuild) { Write-Host "  Nenhum plugin precisa ser rebuilt. Saindo." -ForegroundColor DarkGray; exit 0 }
} else { $ToBuild = @($Plugin) }

$Results = @()
foreach ($k in $ToBuild) {
    $p = $Plugins[$k]
    Write-Host ""
    Write-Host "─── $($p.Display) ───" -ForegroundColor White
    $cur = Get-CurrentZipVersion $p.ZipPrefix
    $new = Bump-Patch $cur
    Write-Step "Versão: $(if ($cur){"v$($cur.Full)"}else{'(nenhuma)'}) → v$($new.Full)"
    [void](Update-BuildVersion $p.BuildScript $new.Full)
    $zipPath = Invoke-Build $p $new.Full
    Sync-ToLanding $p $cur $zipPath
    Update-DownloadHtml $p $cur $new.Full $zipPath
    $Results += @{ Plugin=$p.Display; OldVer=$(if($cur){$cur.Full}else{'-'}); NewVer=$new.Full; Url="https://motionpro-lp.vercel.app/installers/$($p.ZipPrefix)-$($new.Full).zip" }
}

Invoke-Deploy

foreach ($r in $Results) {
    Write-Host ""
    $p = $Plugins[($Plugins.Keys | Where-Object { $Plugins[$_].Display -eq $r.Plugin })]
    Test-PublicZip $p $r.NewVer
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  RELEASE PRONTO" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
foreach ($r in $Results) {
    Write-Host ""
    Write-Host "  $($r.Plugin)  v$($r.OldVer) → v$($r.NewVer)" -ForegroundColor White
    Write-Host "  $($r.Url)" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  Página: https://motionpro-lp.vercel.app/download" -ForegroundColor Cyan
Write-Host ""
