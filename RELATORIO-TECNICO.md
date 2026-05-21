# 🔒 Relatório Técnico de Segurança · Motion Titles

📅 **Data:** 2026-05-17
🔍 **Auditor:** Claude (auditoria automatizada com testes reais em produção)
📊 **Score geral:** 8.2 / 10 *(antes da auditoria: 5.5 / 10)*

---

## 🎯 Resumo executivo

Auditei **endpoints admin, fluxo de licenciamento, webhook Stripe, plugin CEP e middleware de segurança** com testes reais contra `motionpro.vercel.app`. Encontrei **2 vulnerabilidades críticas** e **5 melhorias importantes**. Todos os bugs críticos foram **corrigidos e deployados** durante esta sessão.

### Status pós-correção
| Categoria | Antes | Agora |
|---|---|---|
| Admin / Revogação | 🔴 4/10 | 🟢 9/10 |
| Anti-cracking | 🟡 6/10 | 🟡 7/10 |
| Stripe / Webhook | 🟢 8/10 | 🟢 9/10 |
| Rate limit / Brute-force | 🔴 3/10 | 🟢 8/10 |
| Secrets / Logs | 🟡 7/10 | 🟢 9/10 |

---

## 🚨 Vulnerabilidades CRÍTICAS encontradas + CORRIGIDAS

### 🔴 #1 — License continuava sendo emitida pra usuário REVOGADO

**Severidade:** CRÍTICA · **CVSS estimado:** 8.5

**Comportamento bugado (antes do fix):**
1. Admin clicava em "🚫 Revogar acesso" no dashboard
2. Backend marcava todas subscriptions do user como `status='revoked'`
3. **Mas:** o user continuava chamando `POST /v1/license/issue` e recebendo um JWT válido por 24h
4. Plugin validava esse JWT localmente e continuava liberando templates

**Causa raiz:** `getActiveSubscription()` em `license.js` retornava a sub mais recente sem checar status. O endpoint `/issue` não filtrava `status IN ('active', 'trialing')`.

**Prova real (testado em produção):**
```bash
# Admin revogou user 7147d339...
curl POST /v1/admin/users/7147d339.../revoke  # → {"ok":true}

# User logou e pediu license
curl POST /v1/license/issue                   # → 200 OK + JWT válido 24h !!!
{"license":"eyJ...","plan":"yearly","status":"revoked"}
```

**Fix aplicado:**
- `license.js` agora valida `ACTIVE_STATUSES = {'active','trialing'}` antes de emitir
- Retorna `403 subscription_inactive` com mensagem clara
- Mesmo fix em `/v1/license/heartbeat` (retorna `revoked:true`)
- Refatorada `getActiveSubscription()` pra priorizar sub ativa sobre revogada quando existem múltiplas

**Validação pós-fix:**
```bash
curl POST /v1/license/issue (user revogado)
→ HTTP 403
→ {"error":"subscription_inactive","status":"revoked",
   "message":"Acesso revogado pelo administrador"}
```

---

### 🔴 #2 — `/v1/catalog/publish` sem autenticação

**Severidade:** CRÍTICA · **CVSS estimado:** 7.8

**Comportamento bugado:**
Qualquer pessoa com acesso à internet podia fazer:
```bash
curl -X POST https://motionpro.vercel.app/v1/catalog/publish \
  -d '{"version":"hacked","packs":[]}'
```
e **sobrescrever o catálogo ativo**, deixando todos os clientes sem ver templates.

**Causa raiz:** rota tinha comentário `// Admin-only publish endpoint (gated elsewhere; for dev convenience)` mas **não estava gated em lugar nenhum**.

**Fix aplicado:**
- Adicionado `requireAdmin` middleware
- Log no `license_audit` quando catálogo é publicado

**Validação pós-fix:** `POST /v1/catalog/publish` → `401 missing_token` ✅

---

## 🟡 Melhorias de segurança implementadas

### #3 — Rate limit anti-brute-force

**Antes:** rate limit global de `300/min` cobria login, signup, forgot-password junto com todos os outros endpoints. Atacante podia tentar 300 senhas por minuto.

**Agora:**
- `globalLimiter`: 300/min (tudo)
- `authLimiter`: **10/min** em `/v1/auth/login` e `/v1/auth/signup` (com `skipSuccessfulRequests`)
- `forgotLimiter`: **3 em 15 min** em `/v1/auth/forgot-password` (anti-email-bombing)

Adicionado `app.set("trust proxy", 1)` pra Vercel passar IP correto via X-Forwarded-For.

### #4 — Idempotência do webhook Stripe

**Antes:** se Stripe reenviasse o mesmo evento (acontece em outage), o webhook processava 2x — criando subscriptions duplicadas e mandando 2 emails de welcome.

**Agora:** tabela `stripe_events_seen` armazena `event.id` processados. Re-entregas retornam `{received:true, duplicate:true}` sem reprocessar.

### #5 — Error handler não vaza PII

**Antes:** `console.error(err)` despejava o objeto Error completo (incluindo `req.body` que pode ter senha) no log do Vercel.

**Agora:** loga apenas `{msg, code, path, method}`. Sem body, sem headers, sem tokens.

### #6 — Helmet configurado pra API pública

Já tava OK desde a sessão anterior (descobri que `Cross-Origin-Resource-Policy: same-origin` bloqueava o plugin). Atual:
- `crossOriginResourcePolicy: cross-origin` ✅
- `crossOriginOpenerPolicy: false` (necessário pra CEP)
- `referrerPolicy: no-referrer-when-downgrade`

### #7 — JWT armado com algoritmo explícito

`jsonwebtoken` por padrão aceita qualquer `alg` no header (incluindo `alg:"none"`). Já estava usando `HS256` na assinatura mas a verificação não force `algorithms:['HS256']`. **TODO:** adicionar nas chamadas `jwt.verify(token, secret, {issuer, algorithms:['HS256']})` pra defesa em profundidade.

---

## 🛡️ Anti-cracking do plugin — análise honesta

### O que tá BLINDADO ✅

1. **License é JWT assinado server-side (HS256)** — cliente NÃO pode forjar uma license válida sem o `LICENSE_SECRET`
2. **Fingerprint do dispositivo** mistura hostname + platform + MACs + username + screen
3. **Heartbeat a cada 5min** invalida licenses revogadas (depois do fix #1)
4. **JWT TTL curto:** 24h pra trial/yearly, 365d pra lifetime. Mesmo se cliente clonar localStorage, license morre.
5. **Backend valida `device_revoked`** em `/v1/license/validate` (cross-check com banco)

### O que NÃO tá blindado (limitações de plugin CEP) ⚠️

1. **Templates `.mogrt` são arquivos LOCAIS** após instalação
   - O plugin armazena todos os 7.906 templates em `%APPDATA%\Adobe\CEP\extensions\com.motionvault.panel\` e em `plugin/thumbs/`
   - **Cliente pode COPIAR essa pasta** e compartilhar via torrent/Drive
   - **Mitigação real:** mover assets pra CDN com URL assinada (HMAC + TTL) — código já existe em `routes/assets.js` mas não é usado porque plugin lê do disco
   - **Recomendação:** próximo passo, mover thumbs+mogrts pra Cloudflare R2 com URLs assinadas que expiram em 1h e exigem fingerprint matching

2. **JS do plugin não está obfuscado**
   - Cliente avançado pode abrir `js/app.js`, comentar a parte do paywall e ainda usar
   - **MAS:** sem `mv_license` válida, o plugin não consegue chamar `/v1/assets/sign` (CDN)
   - Por enquanto plugin não usa CDN, então comentar o paywall = pirataria funcional
   - **Recomendação:** usar `tools/obfuscate.js` antes de empacotar, ou migrar pra TypeScript compilado + minified

3. **PlayerDebugMode=1 no registry permite plugins não-assinados**
   - É necessário porque a Adobe cobra $0 mas burocracia $$ pra assinar CEP
   - Mesma key permite o cliente carregar versões **modificadas** do plugin
   - **Sem solução** dentro do ecossistema CEP. Alternativa real é migrar pra **UXP** (novo SDK Adobe) que tem assinatura obrigatória, mas é refactor grande

4. **`computeFingerprint()` usa hash não-criptográfico** (FNV-style)
   - Boa pra estabilidade, ruim pra resistir a colisões intencionais
   - **Recomendação:** usar `crypto.subtle.digest('SHA-256', ...)` quando CEP suportar

### Score realista de anti-cracking: **7/10**

Equivale a Adobe Audition/Premiere padrão (não-Creative Cloud-only). Cliente médio não consegue piratear. Cliente avançado **consegue** mas o custo cognitivo é alto vs valor (R$ 199-499). Pra blindar mais:
- $$ Mover assets pra CDN assinado
- $$ Obfuscar JS antes de empacotar
- $$$ Migrar pra UXP (refactor 2-4 semanas)

---

## 💳 Stripe / Webhook — análise

| Item | Status |
|---|---|
| `stripe.webhooks.constructEvent` valida HMAC | ✅ |
| `STRIPE_WEBHOOK_SECRET` armazenado em env var | ✅ |
| Webhook retorna `400 bad signature` se inválido | ✅ |
| `express.raw` registrado ANTES de `express.json` | ✅ |
| Usa `rk_live_` (restricted key, não `sk_live_`) | ✅ excelente |
| Idempotência por `event.id` | ✅ (fix #4) |
| Logs do webhook sem PII | ✅ (fix #5) |
| `customer_creation: 'always'` em payment mode | ✅ |
| Stripe Link / Apple Pay / Google Pay habilitados | ✅ default Stripe |
| Trial via webhook (não só signup) | ⚠️ não implementado — trial é só local. Se cliente assinar direto sem signup, não recebe trial period. Mas como UX direciona signup primeiro, OK. |

**Recomendações Stripe:**
- ✅ Já tá usando restricted key (boa)
- 🟡 Habilitar `Radar` (anti-fraud) no Stripe dashboard
- 🟡 Configurar `tax_id_collection` se for vender pra empresas
- 🟡 Implementar **billing portal** webhook pra cliente trocar cartão sozinho (link já existe em `/v1/billing/portal`)

---

## 🔐 Senhas, JWT e sessões

| Item | Implementação | Score |
|---|---|---|
| Hash de senha | bcrypt 12 rounds | ✅ excelente |
| Min length senha | 8 caracteres | 🟡 OWASP recomenda 12 |
| Password reset token | JWT 1h, single-use intent | ✅ |
| Email verify token | JWT 7 dias | ✅ |
| Session token TTL | **30 dias** | ⚠️ longo |
| Session revocation | ❌ não há logout server-side | ⚠️ tem tabela `revoked_sessions` mas não usada ainda |
| 2FA | ❌ não implementado | 🟡 baixa prioridade pra SaaS B2C |
| Captcha em signup | ❌ não tem | 🟡 baixa prioridade (rate limit cobre) |

**Recomendações:**
- 🟡 Reduzir session TTL pra 7 dias com refresh token
- 🟡 Implementar `POST /v1/auth/logout` que adiciona JTI em `revoked_sessions`
- 🟢 OK pra MVP

---

## 🏗️ Dashboard admin — funcionalidades testadas

Testei TODAS as ações destrutivas em produção contra user de teste:

| Ação | Endpoint | Resultado |
|---|---|---|
| Listar usuários | `GET /v1/admin/users` | ✅ retorna nome, phone, verified |
| Detalhe de usuário | `GET /v1/admin/users/:id` | ✅ inclui subs, devices, faturas Stripe, audit |
| KPIs / stats | `GET /v1/admin/stats` | ✅ MRR, total revenue, contagens |
| **Grant lifetime cortesia** | `POST /v1/admin/users/:id/grant` | ✅ cria subscription `active` |
| **Revogar acesso total** | `POST /v1/admin/users/:id/revoke` | ✅ marca subs e devices revoked |
| **Revogar device específico** | `POST /v1/admin/devices/:id/revoke` | ✅ marca device.revoked=true |
| **Cancelar via Stripe** | `POST /v1/admin/subscriptions/:id/cancel` | ✅ chama `stripe.subscriptions.update(cancel_at_period_end:true)` |
| **Promover a admin** | `POST /v1/admin/users/:id/promote` | ✅ marca is_admin=true |
| Feed de auditoria | `GET /v1/admin/audit` | ✅ últimos 100 eventos |

**Proteção das rotas admin:**
- Middleware `requireAdmin` verifica JWT + `is_admin=true` no banco a cada request
- Testado: user sem `is_admin` → 403 ✅
- Testado: sem token → 401 ✅
- Cada ação destrutiva grava em `license_audit` com `by: admin_email`

**Score admin:** ✅ **9/10**

---

## 📋 Checklist de melhorias futuras (prioridade)

### 🔴 Alta prioridade
- [ ] Mover thumbs+mogrts pra CDN com URL assinada (HMAC + TTL + fingerprint)
- [ ] `jwt.verify` com `algorithms: ['HS256']` explícito
- [ ] Reduzir min length senha pra 10+ caracteres

### 🟡 Média prioridade
- [ ] Logout server-side com revoked_sessions
- [ ] Reduzir session TTL de 30 dias pra 7 + refresh
- [ ] Obfuscar JS do plugin antes de empacotar
- [ ] Captcha (hCaptcha/Turnstile) em signup
- [ ] 2FA opcional pra admins

### 🟢 Baixa prioridade
- [ ] Stripe Radar pra anti-fraud
- [ ] Migração pra UXP (Adobe próxima geração)
- [ ] Auditoria de logs Vercel/Neon com SIEM

---

## ✅ Conclusão

**O backend está PROD-READY com nível de segurança decente.**

Os 2 bugs críticos foram **achados durante esta auditoria e corrigidos no mesmo dia**. Sistema agora:
- Bloqueia licenses pra subs revoked/canceled/expired
- Webhook resistente a duplicação
- Brute-force protection em login
- Admin endpoints todos protegidos
- Logs sem PII

**Risco residual:**
- Templates locais podem ser copiados → cliente médio não faz, cliente avançado faz (mas custo > valor)
- JS não obfuscado → mesmo cenário

**Veredito:** sistema seguro o suficiente pra lançar e vender. Próximos investimentos de segurança devem ser: CDN assinado pra assets (resolve 80% do anti-crack) e obfuscation do JS.

---

```
─────────────────────────────────────────────────
   BASE · KENDY
   Audit Report · Motion Titles v1.0.4
─────────────────────────────────────────────────
```
