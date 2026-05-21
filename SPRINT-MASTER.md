# Sprint Master · Motion Suite Ultra Pro
**Data:** 2026-05-21 · **Objetivo:** Elevar os 3 plugins ao nível SaaS comercial · **Estimativa:** 10-14 dias

> Orquestração multi-agente Devswarm. Cada agente trabalha numa branch
> isolada por DOMÍNIO. Merge controlado via PR após validação do Gabriel.

---

## 🚧 ATENÇÃO · território cruzado (atualizado 2026-05-21)

**`landing/oauth-bridge.html`** é mantido pelo **AGENTE β** até o sprint
backend fechar. É página utility ligada ao contrato OAuth (aceita
`#plugin=titles|legendas|ia|suite` no fragment e adapta UX) — NÃO é
design de landing. **AGENTE θ: não mexer nesse arquivo** até β fechar PR.
Se precisar de alteração visual urgente, abra issue cruzada com β.

---

## 🎯 Meta final do sprint

Sair de "3 plugins funcionais" → "**Motion Suite SaaS profissional**" com:

1. ✅ License key system unificado nos **3 plugins** (MTI/MTL/MIA)
2. ✅ **Google OAuth** + email/senha em todos os 3 (login compartilhado)
3. ✅ **Área de login idêntica** (mesmo CSS, mesma UX, mesmo gate)
4. ✅ **CDN R2 dedicado** com signed URLs por device em todos
5. ✅ **Installer Windows .exe assinado** (Inno Setup + EV cert) — zero SmartScreen warning
6. ✅ **Installer macOS .pkg assinado** (Apple Developer ID) — zero Gatekeeper warning
7. ✅ **Dashboard admin completo** (gestão clientes, subs, licenses, audit, refunds)
8. ✅ **Stripe** com pricing pages comparativas + checkout customizado + retention
9. ✅ **Landing sites refinados** (vídeos demo reais, depoimentos, comparativos)
10. ✅ **Motion IA com host.jsx funcionando** + todas as 13 features validadas em runtime

---

## 👥 ORQUESTRAÇÃO MULTI-AGENTE — 8 agentes em ondas

### Princípios
- **1 agente = 1 domínio = 1 branch** (evita conflito de merge)
- **Agente 1 SOZINHO primeiro** (desbloquear host.jsx) — depois fan-out
- **Agente 2 segundo SOZINHO** (define API contracts compartilhados) — depois 3-8 em paralelo
- **Comunicação entre agentes:** via PRs no GitHub + comentários no `SPRINT-MASTER.md`
- **Gabriel valida cada PR** antes de merge

### Onda 1 — Desbloqueio (Dia 1)
```
Agente α (Motion IA host.jsx) — SOZINHO
  Branch: fix/motion-ia-host-jsx
  Bloqueia: tudo no Motion IA
```

### Onda 2 — Backend foundation (Dia 2)
```
Agente β (Backend unificado) — SOZINHO após α
  Branch: feat/backend-unified-license-oauth
  Define: API contracts pra licença + OAuth dos 3 plugins
  Bloqueia: agentes γ, δ, ε
```

### Onda 3 — Plugins em paralelo (Dia 3-5)
```
Agente γ (Plugin Titles)        Branch: feat/titles-license-oauth
Agente δ (Plugin Legendas)      Branch: feat/legendas-license-oauth
Agente ε (Plugin IA polish)     Branch: feat/ia-polish-finalization
```

### Onda 4 — Infra & Marketing em paralelo (Dia 4-8)
```
Agente ζ (Installers signed)    Branch: feat/installers-signed-exe-pkg
Agente η (Dashboard admin)      Branch: feat/dashboard-saas-pro
Agente θ (Landing refinement)   Branch: feat/landing-refinement
Agente ι (CDN avançado)         Branch: feat/cdn-per-device-signed
```

### Onda 5 — Integração & Release (Dia 9-14)
```
Agente α (volta) — Merge orchestration + smoke E2E + release notes
```

---

## 📋 BRIEFINGS POR AGENTE

### 🔴 AGENTE α · Motion IA host.jsx (ONDA 1 · SOZINHO)

**Branch:** `fix/motion-ia-host-jsx`
**Bloqueador:** Sim · todos dependem disso resolvido
**Esforço:** 4-8h

**Missão:**
1. Aplicar fix do host.jsx baseado no `Test 4` do diagnóstico técnico do plugin
2. UPDATE `users SET is_admin=true WHERE email='gabriel.kend@gmail.com'` no Neon
3. Validar todas as 13 features no Premiere real (Gabriel testa)

**Leituras:**
- `HANDOFF.md` (visão geral)
- `BRIEFING-MOTION-IA.md` (war room — bug detalhado + 6 hipóteses H1-H6)

**Critério de done:**
- [ ] Plugin abre, login funciona
- [ ] `🩺 Diagnóstico técnico` mostra `HostBridge isReady: true` + `ping()` retornando JSON
- [ ] Todas as 13 features rodam sem "ExtendScript falhou"
- [ ] PR merged em `main`

---

### 🟠 AGENTE β · Backend Unificado (ONDA 2 · SOZINHO)

**Branch:** `feat/backend-unified-license-oauth`
**Depende de:** α (precisa Motion IA funcionando como referência)
**Esforço:** 1-2 dias

**Missão:**
Unificar o sistema de license key e OAuth pra que os **3 plugins** usem o MESMO backend e a MESMA UI de login.

**Tarefas:**
1. **Migration nova: prefixos de license key por produto**
   ```sql
   -- license_keys já tem `products` text[]. Adicionar prefix mapping:
   -- MTI-XXXX → Motion Titles
   -- MTL-XXXX → Motion Legendas
   -- MIA-XXXX → Motion IA
   -- MTS-XXXX → Bundle Motion Suite (todos os 3)
   ALTER TABLE license_keys ADD COLUMN key_prefix_type TEXT GENERATED ALWAYS AS (substring(key_prefix from 1 for 3)) STORED;
   CREATE INDEX idx_license_keys_prefix_type ON license_keys(key_prefix_type);
   ```

2. **Endpoint genérico de activate:**
   - Hoje: `/v1/license-keys/activate` aceita qualquer prefix MIA-/MTI-/MTL-/MTS-
   - Garantir que `products` retornado bate com a feature do plugin que ativou

3. **OAuth pros 3 plugins:**
   - Endpoint genérico `/v1/oauth/google/start?return_to=...&plugin=titles|legendas|ia`
   - oauth-bridge.html já existe na landing — generalizar com `?plugin=` param
   - Cada plugin abre o browser apontando pro seu próprio `return_to`

4. **Bundle Motion Suite (cross-sell):**
   - Migration: novo product_id="suite" em `product_prices` (yearly + lifetime)
   - Webhook Stripe: se `product_id="suite"` → gera 3 license keys (MTI, MTL, MIA) OU 1 chave MTS- válida pros 3
   - Recomendação: 1 chave MTS- com `products: ["titles","legendas","ia"]`

5. **Stripe products no DB:**
   - `products` table (id, name, slug, price_yearly_cents, price_lifetime_cents)
   - Substitui hardcode espalhado

**Critério de done:**
- [ ] Migration aplicada
- [ ] `/v1/license-keys/activate` funciona pros 4 prefixos (MTI/MTL/MIA/MTS)
- [ ] OAuth genérico aceita `plugin=` param
- [ ] Webhook Stripe gera license correta por product_id
- [ ] PR merged

---

### 🟡 AGENTE γ · Plugin Titles (Onda 3 · paralelo com δ ε)

**Branch:** `feat/titles-license-oauth`
**Depende de:** β
**Esforço:** 1-2 dias

**Missão:**
Adicionar ao Motion Titles:
1. License key system (chaves MTI- ou MTS-)
2. Google OAuth (mesma UI do Motion IA)
3. Gate de login PADRONIZADO (extraído pra componente reutilizável)
4. CDN signed URLs por device fingerprint (já tem, mas validar)

**Tarefas:**
1. Copiar `plugin-ia/js/license-cache.js` + `license-client.js` → `plugin/js/`
2. Copiar `plugin-ia/js/auth.js` (gate UI) → adaptar pra `MotionTitles` brand
3. Atualizar `plugin/index.html` com gate idêntico ao Motion IA (mesmo CSS)
4. Validar fluxo activate → cache offline → revalidação 24h
5. Smoke test: `tools/smoke-test-titles.js` (criar se não houver)

**Critério de done:**
- [ ] User pode ativar Motion Titles com chave MTI- ou MTS-
- [ ] Login Google funciona
- [ ] UI do gate é IDÊNTICA visualmente ao Motion IA
- [ ] PR merged

---

### 🟡 AGENTE δ · Plugin Legendas (Onda 3 · paralelo com γ ε)

**Branch:** `feat/legendas-license-oauth`
**Depende de:** β
**Esforço:** 1-2 dias

**Missão:** Igual ao γ mas pro Motion Legendas. Chaves MTL- ou MTS-.

**Atenção especial:**
- Plugin Legendas tem fluxo de fontes premium (4.6MB OTF/TTF não vão pro git — `plugin-legendas/fonts/` está em .gitignore)
- Validar que o sistema novo não quebra `font-requirements.json`
- Memory diz "v4.25.1 BUILD" tem template fixo + fonte global funcionando — não regressar

**Critério de done:**
- [ ] User pode ativar Motion Legendas com chave MTL- ou MTS-
- [ ] Login Google funciona
- [ ] UI gate IDÊNTICA aos outros 2
- [ ] Estilo Global (BUILD 4.25.1) continua funcionando
- [ ] PR merged

---

### 🟡 AGENTE ε · Motion IA Polish Final (Onda 3 · paralelo com γ δ)

**Branch:** `feat/ia-polish-finalization`
**Depende de:** α
**Esforço:** 1-2 dias

**Missão:** Finalizar bugs altos/médios do `BRIEFING-MOTION-IA.md`:

1. **Bug #4** (key cache em logout) — chamar `Agent.clearKeyCache()` em `Auth.logout()`
2. **Bug #5** (Whisper mutex) — `bin-runner.js` lockfile pra `downloadModel`
3. **Bug #6** (retry Pexels/Pixabay/Giphy) — adicionar retry exponential backoff
4. **Bug #20** (Whisper formato `--max-len 1` detection) — normalizar segments vs words
5. **Visual:** trocar Casper icon (👻) por ícone PacotesFX se tiver
6. **Switch Gemini-default**: settings.js — default model = `gemini-2.5-pro` ao invés de `claude-sonnet-4-6`
   - User pediu: "quero usar apenas gemini aqui na estrutura. Igual o phantom!!"
   - Plugin já tem GeminiClient pronto
   - Anthropic continua como opção em ⚙ Config (BYOK)
7. **Dashboard de créditos no plugin** — UI em ⚙ Config mostrando saldo + histórico via `/v1/usage/balance`

**Critério de done:**
- [ ] 7 itens acima implementados
- [ ] Smoke test 44/44 passa
- [ ] PR merged

---

### 🔵 AGENTE ζ · Installers Signed Win + Mac (Onda 4 · paralelo)

**Branch:** `feat/installers-signed-exe-pkg`
**Depende de:** β
**Esforço:** 2-3 dias (pode demorar por causa do certificado)

**Missão:**
Acabar com "Windows SmartScreen protected your PC" e Gatekeeper warning no Mac.

**Tarefas Windows:**
1. **Inno Setup script** (`installers/windows-pro/setup.iss`):
   - Aceita Motion Titles + Legendas + IA num único installer (com opções)
   - Instala em `%APPDATA%\Adobe\CEP\extensions\`
   - Habilita CEP PlayerDebugMode automaticamente
   - Cria atalho no menu Iniciar
2. **EV Code Signing Certificate** (Gabriel já tem ou precisa comprar):
   - Recomendação: Sectigo EV ($400/ano) — único que evita SmartScreen 100%
   - Standard Code Sign ($80/ano) ainda dá warning até 1000+ downloads
   - Doc detalhado em `COMPRAR-CERTIFICADO.md` (já existe — atualizar)
3. **Sign Tool**: `signtool sign /tr http://timestamp.sectigo.com /td sha256 /fd sha256 /a Setup.exe`
4. **CI/CD Integration**: GitHub Actions roda Inno Setup + assina automaticamente

**Tarefas macOS:**
1. **pkg installer** (`installers/macos-pro/build.sh`):
   - Usa `pkgbuild` + `productbuild`
   - Pre-install script: copia pra `~/Library/Application Support/Adobe/CEP/extensions/`
   - Post-install script: chmod +x bin/mac/* + remove quarantine
2. **Apple Developer ID** (Gabriel precisa criar Apple Developer account · $99/ano)
3. **codesign + notarization**:
   ```bash
   codesign --deep --force --sign "Developer ID Application: PacotesFX" MotionPro.pkg
   xcrun altool --notarize-app --primary-bundle-id "com.pacotesfx.motionpro" \
     --username "$APPLE_ID" --password "$APP_PWD" --file MotionPro.pkg
   ```

**Critério de done:**
- [ ] `Setup-MotionPro-3.1.0.exe` instala sem aviso SmartScreen
- [ ] `MotionPro-3.1.0.pkg` instala sem aviso Gatekeeper
- [ ] Ambos instalam os 3 plugins de uma vez (opções marcáveis)
- [ ] PR merged

**Bloqueio externo:** certificados (Gabriel decide se vai comprar EV agora ou começa Standard)

---

### 🔵 AGENTE η · Dashboard Admin SaaS Pro (Onda 4 · paralelo)

**Branch:** `feat/dashboard-saas-pro`
**Depende de:** β
**Esforço:** 3-4 dias

**Missão:**
Refinar `dashboard/` (gestão admin) pra nível SaaS profissional. Estado atual: básico.

**Features novas:**
1. **Customers** — lista de clientes (filter, search, sort, export CSV)
2. **Subscriptions** — status, MRR, churn rate, refund button
3. **Licenses** — todas as keys MTI/MTL/MIA/MTS · revoke · re-issue · transfer device
4. **Audit log** — `license_audit` table visualization timeline
5. **Stripe transactions** — invoices, refunds, disputes
6. **Email log** — verificar entrega (Resend webhook)
7. **Analytics** — MRR chart, signups por dia, ativações, conversões trial→paid
8. **Suporte** — botão "enviar email" pro cliente direto do dashboard
9. **Feature flags** — toggles globais (manutenção, force-update, beta features)
10. **Roles** — admin / support / readonly

**Tech stack recomendado:**
- Frontend: Next.js 14 + shadcn/ui + Tailwind (substitui dashboard atual em vanilla)
- Backend: já tem endpoints, expandir
- Auth: JWT admin (`requireAdmin` middleware já existe)

**Critério de done:**
- [ ] 10 features acima funcionais
- [ ] Deploy em `admin.motionpro.com.br` ou `motionpro-lp.vercel.app/admin/`
- [ ] Mobile responsive
- [ ] PR merged

---

### 🔵 AGENTE θ · Landing Refinement (Onda 4 · paralelo)

**Branch:** `feat/landing-refinement`
**Depende de:** nada (paralelo total)
**Esforço:** 2-3 dias

**Missão:**
Profissionalizar `landing/` pra estilo SaaS conversão alta.

**Por LP:**

**Home (`/`):**
- Hero com tagline forte
- 3 cards (Titles / Legendas / IA) com mockups visuais
- Bundle Motion Suite em destaque
- Depoimentos/cases (precisa coletar com clientes reais)
- FAQ com schema markup
- CTA pra trial gratuito

**Motion IA (`/ia/`):**
- Substituir o motionia-demo.mp4 gerado por ffmpeg (fake) por gravação REAL do plugin em ação
- Adicionar comparação Motion IA vs Phantom Editor (tabela features)
- Adicionar pricing comparativo: Free / Pro / Lifetime
- Calculator: "Quanto tempo você economiza por vídeo?"

**Motion Titles (`/`):**
- Já tem catálogo de templates — adicionar preview animado dos mais populares
- Showreel video
- Garantia 7 dias money-back

**Motion Legendas (`/legendas/`):**
- Demo de 5 estilos diferentes lado-a-lado
- Antes/depois de vídeo com/sem legenda
- Compatibilidade list (Premiere versions)

**Componentes compartilhados:**
- Footer único
- Cookie banner (LGPD/GDPR)
- WhatsApp button flutuante
- Live chat (Crisp ou Intercom)

**Critério de done:**
- [ ] 3 LPs polidas com vídeos demo reais
- [ ] Bundle Suite vendido em todas
- [ ] CTA acima da dobra em todas
- [ ] PageSpeed 90+ em mobile
- [ ] PR merged

---

### 🔵 AGENTE ι · CDN Avançado (Onda 4 · paralelo)

**Branch:** `feat/cdn-per-device-signed`
**Depende de:** β
**Esforço:** 1-2 dias

**Missão:**
Endurecer o CDN R2 com signed URLs por device fingerprint nos 3 plugins.

**Tarefas:**
1. **Worker** (`cloudflare/worker/src/index.js`):
   - Já tem HMAC validation — adicionar device fingerprint check
   - URL: `/<key>?fp=<fingerprint>&e=<expires>&s=<sig>&plugin=<titles|legendas|ia>`
   - Worker valida que `fp` bate com a licença ativa daquele user
2. **Backend** (`backend/src/routes/assets.js`):
   - `GET /v1/assets/sign?key=...&plugin=...` retorna signed URL válida por 1h
   - Verifica que user tem licença ativa pro `plugin`
3. **Plugins**:
   - Trocar URLs hardcoded por chamadas a `/v1/assets/sign`
   - Cachear URL signed até expirar
4. **Throttling**:
   - Worker conta downloads por fingerprint
   - Bloqueia > 100 downloads/hora (anti-scrape)
5. **Geo-blocking opcional**:
   - Worker pode bloquear IPs fora do BR/LATAM se Gabriel quiser

**Critério de done:**
- [ ] Asset só baixa com URL signed válida + fingerprint correto
- [ ] Tentativa de copiar URL pra outra máquina → 401 invalid_signature
- [ ] Rate limit funciona
- [ ] PR merged

---

## 📊 DEPENDÊNCIAS ENTRE AGENTES

```
α (host.jsx fix)
  ↓
β (backend unified)
  ↓
  ├── γ (Titles)        ↘
  ├── δ (Legendas)        ↘
  ├── ε (IA polish)         ↘
  ├── ζ (installers)         → α (merge orchestration + smoke E2E)
  ├── η (dashboard)         ↗
  ├── θ (landing) ───────↗
  └── ι (CDN signed) ─────↗
```

**Onda 4 não precisa esperar 3 terminar** — só β. Onda 3 e 4 podem rodar 100% paralelas após β fechar PR.

---

## 🔐 SECRETS QUE GABRIEL PRECISA PASSAR (UMA VEZ)

```
# Backend (Vercel)
DATABASE_URL              ← Neon dashboard
MV_JWT_SECRET             ← já existe no Vercel
LICENSE_SECRET            ← já existe
CDN_SIGN_SECRET           ← já existe (sync com worker)
STRIPE_SECRET             ← sk_live_... (Stripe Dashboard)
STRIPE_WEBHOOK_SECRET     ← whsec_... (Stripe Dashboard)
RESEND_API_KEY            ← Resend dashboard

# OAuth (NÃO existe ainda — Gabriel cria no GCP)
OAUTH_GOOGLE_CLIENT_ID
OAUTH_GOOGLE_CLIENT_SECRET

# Stripe IA prices (NÃO existe ainda — Gabriel cria via bootstrap script)
STRIPE_PRICE_IA_YEARLY
STRIPE_PRICE_IA_LIFETIME
STRIPE_PRICE_SUITE_YEARLY      ← novo (bundle)
STRIPE_PRICE_SUITE_LIFETIME    ← novo (bundle)

# Cloudflare
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_R2_TOKEN

# Code signing
WINDOWS_EV_CERT_PFX (base64)   ← compra Sectigo
WINDOWS_EV_CERT_PASSWORD
APPLE_DEVELOPER_ID
APPLE_TEAM_ID
APPLE_NOTARIZE_USER
APPLE_NOTARIZE_PWD
```

---

## 📅 TIMELINE REALISTA

| Dia | Atividade | Agente(s) |
|---|---|---|
| 1 | Fix host.jsx + UPDATE is_admin + validação Premiere | α |
| 2 | Backend unified (license/oauth/bundle) + migration | β |
| 3-5 | Plugins (Titles + Legendas + IA polish) em paralelo | γ δ ε |
| 4-7 | Dashboard SaaS (Next.js + features admin) | η |
| 4-6 | Landing refinement (3 LPs + vídeos) | θ |
| 4-5 | CDN signed URLs avançado | ι |
| 6-9 | Installers signed (Win + Mac) — depende cert | ζ |
| 10-12 | Smoke E2E + integration testing | α |
| 13-14 | Release notes + deploy production + comunicado clientes | α + Gabriel |

**Caminho crítico:** α → β → (γ ou δ ou ε) → α merge
**Caminho longo:** ζ (installers) pode atrasar se cert demorar

---

## 🎬 RELEASE PLAN

### v3.2.0 — Motion Suite Pro (target: 2026-06-04)
- License unificado nos 3 plugins
- Google OAuth em todos
- Gate de login idêntico
- Bundle Motion Suite (cross-sell)
- Motion IA com host.jsx funcionando + Gemini default

### v3.3.0 — Installers Signed (target: 2026-06-11)
- Setup.exe assinado (sem SmartScreen)
- MotionPro.pkg assinado + notarized (sem Gatekeeper)
- Updater automático

### v3.4.0 — SaaS Dashboard (target: 2026-06-18)
- Dashboard admin completo
- Analytics MRR
- Suporte integrado
- Roles admin/support/readonly

### v3.5.0 — Landing Pro (target: 2026-06-25)
- 3 LPs refinadas
- Vídeos demo reais
- Pricing comparativo
- LGPD compliance

---

## ✅ CHECKLIST DO GABRIEL (não-código)

```
[ ] Criar Google OAuth Client em console.cloud.google.com
[ ] Passar secrets do .env pra cada agente conforme pedir
[ ] Comprar certificado EV (Sectigo ~$400/ano) OU Standard (~$80) — agente ζ depende
[ ] Criar Apple Developer account ($99/ano) — agente ζ depende
[ ] Gravar vídeos demo dos 3 plugins (5-10min cada) — agente θ usa
[ ] Coletar depoimentos de 3-5 clientes reais — agente θ usa
[ ] Decidir se quer Crisp ou Intercom (live chat) — agente θ implementa
[ ] Decidir domínio admin: admin.kendyproducoes.com.br ou subpath — agente η
[ ] Aprovar PRs no GitHub conforme cada agente abre
[ ] Testar runtime no Premiere quando agente pede (sem isso não fecha PR α/γ/δ/ε)
```

---

## 🚨 RISCOS

| Risco | Probabilidade | Mitigação |
|---|---|---|
| host.jsx tem causa exótica (H5/H6) | Média | Agente α tem 6 hipóteses pra testar |
| Apple notarization demora dias | Alta | Submeter cedo, agente ζ não bloqueia v3.2 |
| Certificado EV não chega a tempo | Média | Standard cert pode ser usado interinamente |
| Conflitos de merge entre γ/δ/ε | Baixa | Branches isoladas + α coordena merge |
| Stripe webhook quebra em prod com bundle | Média | Test mode primeiro, prod só após smoke |
| User existing migra mal pro novo license | Alta | Script migration mantém retrocompat |

---

## 📞 COMUNICAÇÃO

**Entre agentes:**
- Comentários neste arquivo (PR comments)
- Tags em PRs: `[depends-on:β]`, `[blocks:γ]`

**Entre agentes e Gabriel:**
- Cada PR criada pinga Gabriel
- Bloqueio externo (cert, OAuth) → agente para e avisa
- Decisões arquiteturais → agente propõe 2-3 opções, Gabriel escolhe

**Status updates:**
- Cada agente atualiza checklist no seu briefing (acima)
- Daily standup no SPRINT-MASTER.md (1 linha por agente)

---

**FIM DO SPRINT MASTER.**
Quando começar, atualize o status de cada agente no topo do seu próprio briefing.
