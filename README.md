# Motion Suite — 3 plugins CEP pro Adobe Premiere Pro

Família de plugins SaaS por PacotesFX. Backend único, login unificado, billing Stripe, validação online, code obfuscado.

## Os 3 plugins

| Plugin | Pasta | Versão | O que faz |
|---|---|---|---|
| **Motion Titles** | `plugin/` | 2.0.0 | 7.906 templates `.mogrt` de motion graphics (títulos, lower thirds, transições). |
| **Motion Legendas** | `plugin-legendas/` | 3.1.0 | Legendas word-level a partir de SRT/roteiro · 549 estilos · Estilo Global · SFX. |
| **Motion IA** | `plugin-ia/` | 4.0.0 (em close) | Agente Claude/Gemini que edita timeline real (Whisper + FFmpeg + adb-mcp). |

## Backend SaaS

`backend/` — Node.js Express deploy Vercel. PostgreSQL Neon. Stripe webhooks. OAuth Google. CDN signed URLs.

Endpoints principais:

```
POST /v1/auth/login              — email/senha
POST /v1/oauth/google/start      — OAuth Google
POST /v1/oauth/magic/start       — magic link via email
POST /v1/license/issue           — emite license JWT pro plugin (gate por subscription)
POST /v1/license/heartbeat       — 15min sticky 30d grace
POST /v1/license-keys/activate   — ativa MTL-/MTI-/MIA-/MTS-
POST /v1/assets/sign             — assina URL do CDN (HMAC SHA-256)
GET  /v1/me/products             — produtos ativos do user
GET  /v1/admin/*                 — dashboard (requireAdmin)
GET  /v1/health                  — status check
```

## Dashboard admin

`dashboard/` — SPA simples (HTML+JS vanilla) que consome `/v1/admin/*`. Deploy Vercel separado. Login com mv_session de user `is_admin=true`.

## Landing pages

`landing/` — site institucional + docs + checkout flow. Inclui:
- `landing/index.html` — home
- `landing/titles/`, `landing/legendas/`, `landing/ia/` — LPs por plugin
- `landing/docs/` — manuais
- `landing/account.html`, `success.html`, `cancel.html`, etc

## Cloudflare Worker (CDN)

`cloudflare/worker/` — valida URLs HMAC-signed do backend, serve `.mogrt` do R2 bucket `motionpro-assets`. Custom domain: `cdn.kendyproducoes.com.br`.

## Instaladores

`installers/innosetup/` — Inno Setup 6 scripts pra gerar `.exe` profissionais com:
- Auto-close Premiere antes de instalar
- Registry PlayerDebugMode (CSXS 9/10/11/12)
- Cache CEP clear (`%LOCALAPPDATA%\Temp\cep_cache`)
- JS obfuscado dentro (JavaScript-Obfuscator)
- Uninstaller integrado

Build:
```powershell
# Gera staging obfuscado + .exe protegido pros 2 plugins
.\tools\build-protected-installers.ps1   # (TODO: criar wrapper)
# Por enquanto: ver scripts em installers/zip-manual/build-zip.ps1
```

Output: `installers/innosetup/output/MotionPro-*-2.0.0-Setup.exe`

## Tokens / chaves

| Item | Como obter | Onde guardar |
|---|---|---|
| `MV_JWT_SECRET` | `openssl rand -hex 32` | Vercel env |
| `CDN_SIGN_SECRET` | `openssl rand -hex 32` | Vercel env + Cloudflare Worker secret (**mesmo valor**) |
| `STRIPE_SECRET` / `STRIPE_WEBHOOK_SECRET` | Stripe dashboard | Vercel env |
| `OAUTH_GOOGLE_CLIENT_ID` / `_SECRET` | Google Cloud Console | Vercel env |
| `DATABASE_URL` | Neon dashboard | Vercel env |
| `CDN_BASE` | `https://cdn.kendyproducoes.com.br` | Vercel env |

⚠️ **Atenção**: ao colar env vars no Vercel dashboard, **não inclua `\n` no final**. Backend já tem `.trim()` defensivo, mas valor limpo é sempre melhor.

## Fluxo de release

1. PR pra `main` (ou merge direto pro repo solo)
2. Vercel auto-deploy backend + dashboard + landing
3. `wrangler deploy` no `cloudflare/worker/` se mudou Worker
4. Rebuild `.exe` protegidos local + upload em release GitHub
5. Atualizar `landing/download.html` apontando pros novos `.exe`

## Stack

- Node.js 20 + Express + pg
- PostgreSQL 16 (Neon)
- Stripe Checkout + Webhooks
- Cloudflare R2 + Workers
- CEP (Adobe Common Extensibility Platform) · ExtendScript ES3
- Inno Setup 6 (Windows installer)
- JavaScript-Obfuscator (proteção de código)

## Padrões

- **Token unificado**: `mv_session` no `localStorage` (compartilhado entre 3 plugins).
- **Sticky session**: 30d grace · token vencido = banner reconectar, NUNCA logout automático.
- **Heartbeat**: 15min cadence nos 3 plugins.
- **Audit**: tabela `license_audit` (action + detail JSON) pra forensics.
- **Bundle MTS-**: chave bundle Motion Suite cobre todos produtos via `expandProducts()`.

## Estado da release 2026-05

Ver [CHANGELOG.md](CHANGELOG.md) pra histórico completo.

Última smoke release: **v2.0** (CDN .trim fix · sidebar lateral Legendas · SFX guard · captions Premiere removido · fontes recheck · audit OAuth login).

## Suporte

`suporte@pacotesfx.com`
