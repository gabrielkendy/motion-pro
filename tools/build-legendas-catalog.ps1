# Importa packs do AtomX original e gera catalog.json pro plugin Legendas
$ErrorActionPreference = "Stop"

$Src = "C:\Users\Gabriel\Videos\AtomX Plugin v3.0.8 PT"
$Dst = "C:\Users\Gabriel\Documents\Motion Bro\MotionVault\plugin-legendas\packs"

# Limpa destino
if (Test-Path $Dst) { Remove-Item -Recurse -Force $Dst }
New-Item -ItemType Directory -Path $Dst -Force | Out-Null

# Packs a importar (do AtomX)
$Packs = @(
    @{
        id = "titles_lower_thirds"
        name = "Títulos e Lower Thirds"
        src  = "$Src\AtomX Titles and Lower Thirds for Premiere PT\Atom Premiere Pro"
    }
    # Pra começar só o pack principal de títulos. Outros podem ser adicionados depois.
)

$Catalog = @{
    version = "1.0.0"
    generated_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
    total_items = 0
    packs = @()
}

foreach ($pack in $Packs) {
    if (-not (Test-Path $pack.src)) {
        Write-Host "⚠ Pack source nao existe: $($pack.src)" -ForegroundColor Yellow
        continue
    }

    Write-Host "→ Importando pack: $($pack.name)" -ForegroundColor Cyan

    $packDst = Join-Path $Dst $pack.id
    New-Item -ItemType Directory -Path $packDst -Force | Out-Null

    $categories = @()
    $packTotal = 0

    # Cada subpasta é uma categoria
    $catDirs = Get-ChildItem -Path $pack.src -Directory | Sort-Object Name
    foreach ($catDir in $catDirs) {
        $catDstDir = Join-Path $packDst $catDir.Name
        New-Item -ItemType Directory -Path $catDstDir -Force | Out-Null

        $items = @()
        $mogrts = Get-ChildItem -Path $catDir.FullName -Filter "*.mogrt" -Recurse | Sort-Object Name
        foreach ($m in $mogrts) {
            # Copia o mogrt
            $relPath = "$($pack.id)/$($catDir.Name)/$($m.Name)"
            $dstFile = Join-Path $packDst "$($catDir.Name)\$($m.Name)"
            Copy-Item -Path $m.FullName -Destination $dstFile -Force

            $items += @{
                name = [System.IO.Path]::GetFileNameWithoutExtension($m.Name)
                mogrt = $relPath -replace '\\','/'
                preview = $null    # sem preview ainda; gera-se thumbs depois
            }
            $packTotal++
        }

        if ($items.Count -gt 0) {
            $categories += @{
                name = $catDir.Name
                items = $items
            }
            Write-Host "  $($catDir.Name): $($items.Count) mogrts" -ForegroundColor Gray
        }
    }

    # Ordem garantida com [ordered] pra ConvertTo-Json manter campos
    $Catalog.packs += [ordered]@{
        id = $pack.id
        name = $pack.name
        categories = $categories
    }
    $Catalog.total_items += $packTotal
    Write-Host "  Total no pack: $packTotal" -ForegroundColor Green
}

# Salva catalog.json (UTF-8 sem BOM)
$catalogPath = Join-Path $Dst "catalog.json"
$json = $Catalog | ConvertTo-Json -Depth 10 -Compress:$false
[System.IO.File]::WriteAllText($catalogPath, $json, [System.Text.UTF8Encoding]::new($false))
$size = (Get-ChildItem -Recurse $Dst | Measure-Object -Sum Length).Sum

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  CATALOG GERADO" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Total: $($Catalog.total_items) items em $($Catalog.packs.Count) pack(s)"
Write-Host "  Tamanho: $('{0:N1}' -f ($size/1MB)) MB"
Write-Host "  Catalog: $catalogPath"
