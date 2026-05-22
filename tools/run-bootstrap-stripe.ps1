# run-bootstrap-stripe.ps1
# Wrapper que carrega tools/.env e roda bootstrap-stripe-suite-simple.js.
# Uso: powershell -ExecutionPolicy Bypass -File tools\run-bootstrap-stripe.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $ScriptDir ".env"
$bootstrap = Join-Path $ScriptDir "bootstrap-stripe-suite-simple.js"

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host "  Motion Suite Bootstrap Stripe" -ForegroundColor Cyan
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host ""

# Verifica .env
if (-not (Test-Path $envFile)) {
    Write-Host "ERRO: tools/.env nao existe." -ForegroundColor Red
    Write-Host ""
    Write-Host "Crie copiando do template:" -ForegroundColor Yellow
    Write-Host "  copy tools\.env.template tools\.env"
    Write-Host ""
    Write-Host "Depois edita tools/.env e preenche:"
    Write-Host "  STRIPE_SECRET=sk_live_... (tua key real do Stripe dashboard)"
    Write-Host "  DATABASE_URL=postgres://... (tua connection string Neon)"
    Write-Host ""
    Read-Host "Pressione Enter pra sair"
    exit 1
}

# Carrega .env
Write-Host "[1/3] Carregando credenciais de $envFile..." -ForegroundColor Yellow
$loaded = @{}
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $idx = $line.IndexOf("=")
        $name = $line.Substring(0, $idx).Trim()
        $value = $line.Substring($idx + 1).Trim()
        # Remove aspas se houver
        if ($value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Substring(1, $value.Length - 2) }
        if ($value.StartsWith("'") -and $value.EndsWith("'")) { $value = $value.Substring(1, $value.Length - 2) }
        Set-Item -Path "Env:$name" -Value $value
        $loaded[$name] = $value
    }
}

# Valida obrigatorios
$missing = @()
if (-not $env:STRIPE_SECRET -or $env:STRIPE_SECRET -match "COLE_TUA_KEY|sk_live_\.\.\.|sk_test_\.\.\.") {
    $missing += "STRIPE_SECRET (cole a key real, nao o placeholder)"
}
if (-not $env:DATABASE_URL -or $env:DATABASE_URL -match "USER:PASS|postgres://\.\.\.") {
    $missing += "DATABASE_URL (cole a connection string real do Neon)"
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "ERRO: variaveis nao preenchidas no .env:" -ForegroundColor Red
    foreach ($m in $missing) { Write-Host "  - $m" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Edita tools/.env e troca os placeholders pelas keys reais." -ForegroundColor Yellow
    Read-Host "Pressione Enter pra sair"
    exit 2
}

Write-Host "  OK $($loaded.Keys.Count) variaveis carregadas" -ForegroundColor Green
Write-Host "  Modo: $(if($env:STRIPE_SECRET.StartsWith('sk_live_')){'LIVE'}elseif($env:STRIPE_SECRET.StartsWith('sk_test_')){'TEST'}else{'?'})" -ForegroundColor Cyan

# Executa
Write-Host ""
Write-Host "[2/3] Executando bootstrap..." -ForegroundColor Yellow
Write-Host ""
node $bootstrap
$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "[3/3] OK · COPIE as STRIPE_PRICE_* acima e cole no Vercel" -ForegroundColor Green
    Write-Host "      depois faca redeploy do backend." -ForegroundColor Green
} else {
    Write-Host "[3/3] FALHOU (exit code $exitCode) — veja o erro acima" -ForegroundColor Red
}
Write-Host ""
Read-Host "Pressione Enter pra fechar"
exit $exitCode
