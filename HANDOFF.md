# MotionVault · Handoff Devswarm
**Data:** 2026-05-21 · **Owner:** Gabriel (gabriel.kend@gmail.com) · **Marca:** PacotesFX

> Leia esse documento ANTES de tocar em qualquer código. Consolida 3 plugins,
> arquitetura, estado atual, bugs abertos, próximos passos e segredos
> necessários. Atualizado após a sessão de fix do Motion IA v3.1.0.

---

## 🎯 Visão geral — 3 plugins CEP da família

| Plugin | Repo | Status | URL produção |
|---|---|---|---|
| **Motion Titles** (templates) | `plugin/` | ✅ LIVE · CDN R2 ativo (15774 assets/9.77GB) | motionpro.vercel.app |
| **Motion Legendas** (legendas animadas) | `plugin-legendas/` | ✅ LIVE · v4.25.1 BUILD | motionpro-lp.vercel.app/legendas |
| **Motion IA** (agente Claude/Gemini) | `plugin-ia/` | 🟡 v3.1.0 · **host.jsx não carrega** | motionpro-lp.vercel.app/ia |

**Backend único:** `backend/` Vercel + Neon Postgres — atende os 3 plugins.
**CDN único:** `cloudflare/worker/` R2 + Worker — cdn.kendyproducoes.com.br.
**Landing única:** `landing/` Vercel — motionpro-lp.vercel.app.

---

## 🔥 PRIORIDADE 1 — Bug bloqueante atual

**Motion IA · host.jsx não carrega no Premiere Pro**

### Sintomas
- License key ativada OK (lifetime, 5 devices)
- Tier mostra LIFETIME no rodapé
- TODAS as 14 funções ExtendScript falham: get_context, list_clips, list_project_items, etc
- Erro mostrado no chat: "Não consigo conectar ao Premiere Pro"
- Tela Diagnóstico (⚙ Config → 🩺) mostra:
  ```
  HostBridge isReady: false
  ping() ERR: host.jsx não carregou
  ```

### Causas já investigadas e descartadas
- ✅ Binários ffmpeg/ffprobe/whisper-cli/yt-dlp/aria2c detectados corretamente em `bin/win/`
- ✅ CSInterface stub corrigido pra converter `file:///C:/...` → `C:\...`
- ✅ `cs.getSystemPath("extension")` retorna path local correto
- ✅ `bin-runner.exists()` funciona
- ✅ host.jsx tem sintaxe ES3 válida (sem const/let/arrow/class)

### Possíveis causas restantes (NÃO confirmadas)
1. **Premiere sem projeto aberto** — `app.project` é null sem projeto, alguns scripts ExtendScript travam silencioso
2. **`$.evalFile()` falha com path Windows** — testar com `File('C:/...')` vs string direta
3. **MotionProIA registra em `$.global` mas teste checa escopo errado** — já mitigamos no `host-bridge.bootstrapHost()` checando ambos `$.global.MotionProIA` E `MotionProIA`
4. **Conflito com ScriptPath do manifest.xml** — manifest tem `<ScriptPath>./jsx/host.jsx</ScriptPath>` que pode estar carregando em momento errado

### Próximo passo de debug
Abrir o painel em `localhost:8089` (já tem `.debug` configurado), ver erro real do JS console. Botão **🩺 Diagnóstico técnico** em ⚙ Licença & Config mostra Test 1-5 detalhados — usar pra capturar estado quando o user testar com projeto Premiere ativo.

**Localização do código relevante:**
- `plugin-ia/js/host-bridge.js` (linhas 14-50: bootstrapHost)
- `plugin-ia/jsx/host.jsx` (linha 20: `$.global.MotionProIA = (function () {...})()`)
- `plugin-ia/js/app.js` (linhas 456-466: chamada de bootstrap no boot)

---

## 📋 PRIORIDADE 2 — Setup manual pendente (do usuário, não código)

### A. Google OAuth — backend pronto, falta env no Vercel
Código UI/backend 100% feito. Bloqueado por env vars.

**O que fazer:**
1. https://console.cloud.google.com/apis/credentials → criar OAuth Client (Web app)
2. Redirect URI: `https://motionpro.vercel.app/v1/oauth/google/callback`
3. Setar no Vercel (project `motionpro` → Settings → Env Variables):
   ```
   OAUTH_GOOGLE_CLIENT_ID=...
   OAUTH_GOOGLE_CLIENT_SECRET=...
   OAUTH_REDIRECT_BASE=https://motionpro.vercel.app
   OAUTH_SUCCESS_URL=https://motionpro-lp.vercel.app/oauth-bridge.html
   ```
4. Redeploy backend: `vercel --prod --cwd backend`
5. Validar: `node tools/setup-google-oauth.js --check`

### B. Stripe Motion IA — products + prices
Webhook já gera license key MIA-XXXX automaticamente em `checkout.session.completed` para `product_id="ia"`. Mas precisa dos prices criados no Stripe.

**O que fazer:**
```bash
STRIPE_SECRET=sk_live_... DATABASE_URL=postgres://... \
  node tools/bootstrap-stripe-ia.js
```
Cria Product "Motion IA" + 2 prices (yearly R$ 299 + lifetime R$ 699) + insere em `product_prices` do Neon.

Em seguida no Vercel:
```
STRIPE_PRICE_IA_YEARLY=price_xxxx
STRIPE_PRICE_IA_LIFETIME=price_xxxx
```

### C. Atualizar `mia_pixabay_key` e `mia_giphy_key` em ⚙ Config (opcional)
Só pra Biblioteca Stock funcionar com Pixabay/Giphy além de Pexels.

---

## 🏗️ Arquitetura — onde tudo vive

### `plugin-ia/` — Motion IA v3.1.0
```
plugin-ia/
├── CSXS/manifest.xml         # ExtensionBundleVersion=3.1.0 · Width 900 MinWidth 720
├── index.html                # Single-page · gate → app layout
├── css/app.css              # Tema preto+azul (#2563eb) · animations
├── jsx/host.jsx             # 35 funções ExtendScript (ES3) · v1+v2+v3
├── js/
│   ├── lib/CSInterface.js   # Stub minimal (46 linhas + fix file:/// → path)
│   ├── host-bridge.js       # Bootstrap automático + retry · expõe HostBridge
│   ├── bin-runner.js        # child_process.spawn wrapper · detect ffmpeg/whisper/yt-dlp
│   ├── license-cache.js     # AES-256-GCM offline cache · device fingerprint
│   ├── license-client.js    # /v1/license-keys/* + auto-revalidate 24h
│   ├── auth.js              # email/password + heartbeat + sticky session + refreshUserMeta
│   ├── gemini-client.js     # Gemini 2.5 API (inline + Files API >20MB)
│   ├── agent.js             # Claude agentic loop · multimodal · tool_use
│   ├── claude-tools.js      # 23 tools definitions (Anthropic tool schema)
│   ├── skills.js            # 13 skills handlers (cortar-pausas, casper, etc) + TRANSITIONS_CATALOG
│   ├── features.js          # Catálogo features + tier-gating + render UI
│   ├── face-tracker.js      # Canvas YCbCr skin detection (NÃO ML lib)
│   ├── onboarding-tour.js   # Tour 6 steps com role=dialog
│   ├── settings-ui.js       # Config UI · API keys · validate
│   └── app.js               # Orchestrator · routing · diagnose · BUILD=3.0.0
├── bin/
│   ├── win/                 # ffmpeg/ffprobe/whisper-cli/yt-dlp/aria2c (~218MB · NO GIT)
│   └── mac/                 # Vazia · auto-download via INSTALAR.command
└── models/                  # Whisper ggml-base.bin etc (NO GIT · baixa on-demand)
```

### `backend/` — Node Express Vercel
```
backend/
├── src/
│   ├── server.js                   # Express bootstrap + routes mount
│   ├── db.js                       # pg Pool (Neon)
│   ├── middleware/
│   │   ├── auth.js                 # requireAuth (JWT validate)
│   │   ├── admin.js                # requireAdmin (is_admin check)
│   │   └── subscription.js         # requireActiveSubscription
│   ├── routes/
│   │   ├── auth.js                 # login/signup/me/forgot/reset
│   │   ├── me.js                   # GET /v1/me (+ is_admin, email_verified)
│   │   ├── oauth.js                # /v1/oauth/:provider/start|callback + magic link
│   │   ├── billing.js              # Stripe checkout + webhook (auto-issue MIA-XXXX)
│   │   ├── license.js              # Sistema legado (Motion Titles)
│   │   ├── license-keys.js         # Motion IA · activate/validate/deactivate + admin generate
│   │   ├── ai-settings.js          # BYOK Anthropic key (criptografado)
│   │   ├── usage.js                # Credits deduct/balance/log
│   │   ├── assets.js               # Catálogo + signed URLs CDN
│   │   ├── catalog.js              # Public catalog endpoints
│   │   ├── admin.js                # Dashboard endpoints (users, subs, audit)
│   │   └── cron.js                 # Heartbeat cleanup, etc
│   └── utils/
│       ├── email.js                # Welcome/reset/payment-failed (Resend)
│       ├── ipgeo.js                # clientIp + clientUa helpers
│       └── jwt.js                  # JWT helpers
└── migrations/
    ├── 001-005                     # Motion Titles core
    ├── 006_cdn_assets.sql          # CDN R2 assets table
    ├── 006_sessions_devices_v2.sql # session_devices + oauth_accounts
    ├── 007_user_blocking_lifetime.sql
    ├── 008_user_ai_settings.sql    # ai_settings (encrypted anthropic_key)
    ├── 009_license_keys.sql        # license_keys + license_key_activations
    ├── 010_usage_oauth.sql         # user_credits + usage_log + oauth_tokens
    └── 011_ia_product_prices.sql   # Stripe price_ids do Motion IA
```

### `cloudflare/worker/` — CDN
```
worker name: motionpro-cdn
custom domain: cdn.kendyproducoes.com.br
bucket: motionpro-assets
routes:
  /public/<key>       → unsigned (ZIPs, vídeos demo, posters)
  /<key>?fp&e&s       → HMAC signed (MOGRTs, paid assets)
  /health             → 200 OK
secret needed: CDN_SIGN_SECRET (matches backend env)
```

### `landing/` — Marketing site
```
landing/
├── index.html              # Home Motion Suite
├── ia/index.html           # LP Motion IA
├── ia/download.html        # Download Win + Mac (v3.1.0)
├── legendas/...            # LP Motion Legendas
├── oauth-bridge.html       # NOVO · device-flow OAuth bridge (paste JWT)
├── img/motionia-demo.mp4   # Demo gerado via ffmpeg (157KB · 21s)
├── img/motionia-poster.jpg
└── installers/             # ZIPs servidos via CDN R2 (espelhados aqui)
```

---

## 🔑 Env vars necessários

### Backend (Vercel project `motionpro`)
```bash
# Database
DATABASE_URL=postgres://...neon.tech/motionpro

# JWT + secrets
MV_JWT_SECRET=<32+ chars random>
LICENSE_SECRET=<32+ chars random>
CDN_SIGN_SECRET=<32+ chars hex random>  # mesmo do worker

# Stripe
STRIPE_SECRET=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_YEARLY=price_...           # Motion Titles
STRIPE_PRICE_LIFETIME=price_...
STRIPE_PRICE_IA_YEARLY=price_...        # ⚠ falta criar (rodar bootstrap-stripe-ia.js)
STRIPE_PRICE_IA_LIFETIME=price_...      # ⚠ falta criar

# OAuth (Google + GitHub)
OAUTH_GOOGLE_CLIENT_ID=...              # ⚠ falta configurar
OAUTH_GOOGLE_CLIENT_SECRET=...          # ⚠ falta configurar
OAUTH_GITHUB_CLIENT_ID=...              # opcional
OAUTH_GITHUB_CLIENT_SECRET=...          # opcional
OAUTH_REDIRECT_BASE=https://motionpro.vercel.app
OAUTH_SUCCESS_URL=https://motionpro-lp.vercel.app/oauth-bridge.html

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=Motion IA <suporte@pacotesfx.com>

# URLs
PUBLIC_URL=https://motionpro-lp.vercel.app
CDN_BASE=https://cdn.kendyproducoes.com.br
```

### Cloudflare Worker
```
wrangler secret put CDN_SIGN_SECRET  # mesmo do backend
```

### Tools (.env local)
```bash
DATABASE_URL=...        # pra rodar migrations + bootstrap-stripe-ia
STRIPE_SECRET=...       # pra criar prices
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_R2_TOKEN=... # wrangler auth
```

---

## 🚀 Setup local (clone fresh)

```bash
git clone https://github.com/gabrielkendy/motion-pro.git
cd motion-pro

# 1. Dependências
(cd backend && npm install)
(cd cloudflare/worker && npm install)
(cd tools && npm install)

# 2. Binários Motion IA (~218MB · NÃO estão no git)
powershell tools/download-bin-motion-ia.ps1   # Windows
# OU
bash tools/download-bin-motion-ia-mac.sh      # Mac

# 3. Env locais
cp backend/.env.example backend/.env
cp tools/.env.example tools/.env
# Preencher os arquivos com secrets (Neon, Stripe, Resend, Cloudflare)

# 4. Migrations no Neon
psql $DATABASE_URL -f backend/migrations/001_init.sql
# ... rodar todas em ordem ou usar tools/migrate.js (criar se não houver)

# 5. Plugin Motion IA local (dev)
# Plugin é CEP — instala em %APPDATA%/Adobe/CEP/extensions/com.motionpro.ia
# Symlink ou robocopy do plugin-ia/ pra lá. Manifest define o ID.

# 6. Backend dev
cd backend && npm run dev  # localhost:3000

# 7. Smoke test
node tools/smoke-test-motion-ia.js
```

---

## 🎬 Build/Release pipeline

```bash
# Plugin Motion IA — Win + Mac
node tools/build-zip-ia.js --version 3.1.0 --platform all

# Upload pro CDN R2
cd cloudflare/worker
./node_modules/.bin/wrangler r2 object put motionpro-assets/installers/MotionPro-IA-3.1.0.zip \
  --file=../../landing/installers/MotionPro-IA-3.1.0.zip --content-type=application/zip --remote

# Demo video (regenerar se mudou)
node tools/generate-motionia-demo.js

# Deploy landing
vercel --prod --cwd landing

# Deploy backend
vercel --prod --cwd backend

# Deploy worker
cd cloudflare/worker && ./node_modules/.bin/wrangler deploy
```

---

## 🐞 Bugs conhecidos / dívida técnica

### Críticos (bloqueiam features)
1. **host.jsx não carrega** — vide PRIORIDADE 1 acima
2. **is_admin_verified retorna false** mesmo pro user gabriel.kend@gmail.com — provavelmente `users.is_admin` no Neon está false. SQL pra fix: `UPDATE users SET is_admin=true WHERE email='gabriel.kend@gmail.com';`

### Altos (já documentados nos audits da sessão)
3. **agent.js** ainda tem maxIter sem fallback decente — corrigido parcialmente (remove last assistant turn se tem tool_use órfão), pode melhorar com prompt "pode continuar?"
4. **Key cache em logout** — `Agent.clearKeyCache()` não é chamado no logout
5. **Whisper sem mutex** — duas skills paralelas podem corromper o download do modelo
6. **Pexels/Pixabay/Giphy não tem retry/rate limit handling**
7. **JS obfuscation pode estar quebrando em produção** — testar com `--no-obfuscate` se algum bug só aparecer em build

### Médios
8. Tour bugou com cards duplicados em sessão anterior (corrigido com guard `isRunning` + cleanup defensive)
9. UI mismatch de classes (corrigido: `trans-item.is-selected`, `onboard-card__dot`)
10. Sidebar items sem `role=button` (corrigido)

---

## 🎯 Roadmap pra paridade com Phantom Editor (próximos passos)

**Estado atual:** 8/10 vs Phantom (era 6.5)

| # | Item | Status | Esforço |
|---|---|---|---|
| 1 | Google OAuth UI/backend | ✅ CÓDIGO PRONTO · falta env Vercel | 10 min user |
| 2 | Stripe → license auto-issue MIA-XXXX | ✅ CÓDIGO PRONTO · falta prices Stripe | 15 min user |
| 3 | CDN R2 dedicado pro Motion IA | ✅ ATIVO | — |
| 4 | macOS build + installer | ✅ Stub installer com auto-download | testar em Mac real |
| 5 | Vídeo demo na landing | ✅ Gerado via ffmpeg | trocar por gravação real do plugin |
| 6 | host.jsx funcional | 🟡 BUG | ver PRIORIDADE 1 |
| 7 | Dashboard de créditos pro user | ❌ Backend tem `/v1/usage/balance` mas sem UI | 2-3h |
| 8 | Tutorial vídeo por feature (não tour textual) | ❌ | 1-2 dias de gravação |
| 9 | Status page público (uptime, modelos) | ❌ | 4h |
| 10 | Pricing page comparativa | ❌ Tier-gating no código já existe | 3h |

---

## 🧠 Decisões arquiteturais importantes (NÃO MUDAR sem entender)

1. **License keys MIA-XXXX armazenam só hash bcrypt no banco** — `key_prefix` (14 chars) indexa, bcrypt.compare valida candidatos. Plaintext só é enviado por email no momento da geração.

2. **License cache cliente é AES-256-GCM + device fingerprint bound** — não dá pra copiar/colar entre máquinas. `is_admin_verified` é fonte separada (vem de `/v1/me`).

3. **Tier-gating tem 2 fontes:**
   - `LicenseCache.load().tier === "active"` (offline, prioritário)
   - `mia_user_meta.is_admin_verified` (admin = lifetime)
   - **Removido** o bypass `mia_user_meta.lifetime` que era editável via DevTools

4. **host.jsx usa `$.global.MotionProIA` namespace** — registra em ambos `$.global` e escopo local. Bootstrap checa os dois.

5. **CSInterface stub minimal (46 linhas)** — versão oficial da Adobe tem 1000+ linhas. Stub cobre apenas: evalScript, getSystemPath (com fix `file:///` → path), addEventListener. Se precisar de mais, expandir.

6. **Bootstrap robusto do host.jsx** — tenta `$.evalFile(File('...'))` E verifica `$.global.MotionProIA.ping` E `MotionProIA.ping`. Retry uma vez se falhar.

7. **Casper é pipeline declarativo** — não é hardcoded. Regras `{skill, opts, enabled, label}` persistidas em `localStorage.mia_casper_rules`.

8. **Webhook Stripe é idempotente** — tabela `stripe_events_seen(event_id)` previne processing duplo.

9. **OAuth state store é in-memory** — `Map<state, {provider, ts, return_to}>` com TTL 10min e GC manual. Se backend escalar pra múltiplas instâncias, precisa Redis.

10. **CEP plugin requer PlayerDebugMode=1** — não é assinado. Script `tools/enable-debug-mode.bat` ou setup manual.

---

## 📞 Contatos / contas

- **GitHub:** gabrielkendy/motion-pro (privado)
- **Vercel:** kp's-projects-b5c26735 (backend + landing)
- **Cloudflare:** account com `motionpro-assets` bucket + `motionpro-cdn` worker
- **Neon:** Postgres com schemas users, license_keys, sessions, etc
- **Stripe:** account em modo live (Motion Titles ativo, Motion IA pendente)
- **Resend:** API key pra emails transacionais
- **Domain:** kendyproducoes.com.br (Cloudflare DNS)
- **User principal:** gabriel.kend@gmail.com / Kendy.123 (deveria ser admin)

---

## 📝 Notas pro próximo agente AI

- **Workspace path:** `c:\Users\Gabriel\Documents\Motion Bro` (Windows)
- **Plugin local:** `MotionVault/plugin-ia/` é symlink/cópia direta de `%APPDATA%/Adobe/CEP/extensions/com.motionpro.ia/`
- **PowerShell preferido** sobre Bash (mas ambos funcionam via shell tool)
- **Premiere version testado:** 26.2.2 (CEP 12.0.1, Chrome 99 user-agent)
- **gh CLI NÃO está autenticado** localmente — usar git push direto com Windows Credential Manager
- Sessão anterior tem audits completos com 30 bugs identificados (15 críticos/altos corrigidos)
- **NÃO criar arquivos .md de status/relatório** sem o user pedir explicitamente — ele odeia churn de docs

---

**FIM HANDOFF.** Boa sorte e foco no PRIORIDADE 1 (host.jsx) primeiro.
