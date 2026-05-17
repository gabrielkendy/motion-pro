# 🔌 Guia técnico — Integrar novos plugins na infra MotionPro

> Como reusar o backend, auth, licenciamento, Stripe e dashboard pra criar novos produtos (ex: **Legendas**) que vão pra mesma gestão centralizada.

---

## 🎯 Arquitetura recomendada: 1 backend, N plugins

```
                ┌──────────────────────────────────┐
                │   motionpro.vercel.app (backend) │
                │   ─ /v1/auth   (login/signup)    │
                │   ─ /v1/license (issue/heartbeat)│
                │   ─ /v1/billing (Stripe)         │
                │   ─ /v1/admin   (gestão)         │
                └─────────┬──────────────┬─────────┘
                          │              │
              ┌───────────┴──┐      ┌────┴────────────┐
              │              │      │                 │
              ▼              ▼      ▼                 ▼
       MotionPro Plugin   Legendas Plugin   Plugin 3 (futuro)
       (Premiere CEP)     (Premiere CEP)    (qualquer SDK)
       product=motionpro  product=legendas  product=...
```

**Por que 1 backend só?**
- ✅ Cliente faz **1 conta** que serve pra todos os plugins (UX top)
- ✅ Vê **tudo no mesmo dashboard** (você gerencia 1 painel só)
- ✅ Compartilha Stripe customer (compra Anual+Legendas com mesmo cartão)
- ✅ Pode oferecer **bundles** ("Compre MotionPro + Legendas e ganhe 30%")
- ✅ Custo de infra continua R$ 0/mês (mesmo Vercel/Neon/Resend)

---

## 📋 O que VOCÊ não precisa refazer (reusa direto)

O backend já tem TODOS esses endpoints prontos pra qualquer plugin chamar:

| Endpoint | Pra quê serve | Já está pronto? |
|---|---|---|
| `POST /v1/auth/signup` | Criar conta + trial | ✅ |
| `POST /v1/auth/login` | Login | ✅ |
| `POST /v1/auth/forgot-password` | Recuperar senha (email Resend) | ✅ |
| `POST /v1/auth/reset-password` | Trocar senha via token | ✅ |
| `POST /v1/auth/verify-email` | Confirmar e-mail | ✅ |
| `POST /v1/auth/resend-verification` | Reenviar e-mail de confirmação | ✅ |
| `POST /v1/auth/update-profile` | Atualizar nome/telefone | ✅ |
| `POST /v1/license/issue` | Emitir JWT de licença | ⚠️ precisa **adicionar product_id** |
| `POST /v1/license/heartbeat` | Renovar license (cada 5min) | ⚠️ precisa **product_id** |
| `POST /v1/license/validate` | Verificar JWT de licença | ✅ |
| `POST /v1/billing/checkout` | Checkout Stripe | ⚠️ precisa receber `product` no body |
| `POST /v1/billing/portal` | Customer portal Stripe | ✅ |
| `GET /v1/me` | Dados do usuário | ✅ |
| `GET /v1/admin/*` | Gestão admin | ✅ |

> O essencial (auth + emails + admin) tá 100% pronto. **Só precisa ajustar 3 endpoints** pra serem product-aware: `license/issue`, `license/heartbeat`, `billing/checkout`.

---

## 🏗️ Mudanças necessárias no backend (1-2 horas)

### 1. Migration: adicionar `product_id` em subscriptions

```sql
-- backend/migrations/004_multi_product.sql

CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,             -- 'motionpro' | 'legendas' | 'bundle_all'
    name        TEXT NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO products(id, name, description) VALUES
    ('motionpro', 'MotionPro', '7.906 templates de motion graphics'),
    ('legendas',  'Legendas Pro', 'Plugin de geração e estilização de legendas'),
    ('bundle_all','Bundle Completo', 'Acesso a todos os plugins MotionPro')
ON CONFLICT (id) DO NOTHING;

-- Subscription agora pertence a um produto específico
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS product_id TEXT REFERENCES products(id) DEFAULT 'motionpro';

CREATE INDEX IF NOT EXISTS idx_subs_user_product ON subscriptions(user_id, product_id, status);

-- Backfill: todas as subs existentes pertencem ao MotionPro
UPDATE subscriptions SET product_id='motionpro' WHERE product_id IS NULL;

-- Stripe Price IDs por produto (substitui as env vars STRIPE_PRICE_*)
CREATE TABLE IF NOT EXISTS product_prices (
    id              SERIAL PRIMARY KEY,
    product_id      TEXT NOT NULL REFERENCES products(id),
    plan            TEXT NOT NULL,            -- 'yearly' | 'lifetime' | 'monthly'
    stripe_price_id TEXT NOT NULL UNIQUE,
    amount_cents    INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'brl',
    is_active       BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO product_prices(product_id, plan, stripe_price_id, amount_cents) VALUES
    ('motionpro', 'yearly',   'price_1TY6BHBBwmTfpkhYOkVzI0vE', 19900),
    ('motionpro', 'lifetime', 'price_1TY6BJBBwmTfpkhYNYYWFXUb', 49900)
ON CONFLICT (stripe_price_id) DO NOTHING;
```

### 2. License/issue precisa de `product_id`

```js
// backend/src/routes/license.js
router.post("/issue", requireAuth, async (req, res, next) => {
    const { fingerprint, product_id } = req.body || {};
    if (!product_id) return res.status(400).json({ error: "product_id_required" });

    // getActiveSubscription agora filtra por product_id (ou bundle_all que cobre tudo)
    const sub = await getActiveSubscriptionForProduct(req.user.id, product_id);

    // ... resto igual
    // license JWT inclui product_id no payload
    const license = signLicense({
        userId, email, plan: sub.plan,
        product: product_id,      // ← novo
        fingerprint,
        packs: ["*"]
    });
});
```

### 3. Helper que respeita bundles

```js
async function getActiveSubscriptionForProduct(userId, productId) {
    // 1. Tem bundle_all ativo? cobre tudo
    const bundle = await pool.query(
        `SELECT plan, status, current_period_end FROM subscriptions
         WHERE user_id=$1 AND product_id='bundle_all' AND status IN ('active','trialing')
         ORDER BY started_at DESC LIMIT 1`,
        [userId]
    );
    if (bundle.rowCount) return { plan: bundle.rows[0].plan, status: 'active', expiresAt: bundle.rows[0].current_period_end, product: 'bundle_all' };

    // 2. Sub específica desse produto
    const r = await pool.query(
        `SELECT plan, status, current_period_end FROM subscriptions
         WHERE user_id=$1 AND product_id=$2 AND status IN ('active','trialing')
         ORDER BY started_at DESC LIMIT 1`,
        [userId, productId]
    );
    if (r.rowCount) return { ... };

    return { plan: 'free', status: 'none', expiresAt: null, product: productId };
}
```

### 4. Checkout aceita `product`

```js
router.post("/checkout", async (req, res, next) => {
    const product_id = req.query.product || req.body?.product || "motionpro";
    const plan       = (req.query.plan   || req.body?.plan   || "yearly").toLowerCase();

    // Busca price ID no banco (em vez de env var)
    const p = await pool.query(
        "SELECT stripe_price_id FROM product_prices WHERE product_id=$1 AND plan=$2 AND is_active=true",
        [product_id, plan]
    );
    if (!p.rowCount) return res.status(400).json({ error: "unknown_product_or_plan" });

    // metadata pro webhook saber qual produto foi comprado
    sessionParams.metadata = { plan, product_id };
});
```

E no **webhook**, quando processa `checkout.session.completed`:
```js
const product_id = cs.metadata?.product_id || "motionpro";
await upsertSubscription({ userId, product_id, plan, status, ... });
```

---

## 🔌 Como o NOVO plugin (Legendas) deve se conectar

### A. `js/config.js` (igual o MotionPro)

```js
window.MV_CONFIG = {
    apiBaseUrl: "https://motionpro.vercel.app",   // mesmo backend!
    productId: "legendas",                         // ← único pra esse plugin
    productName: "Legendas Pro",
    devMode: false
};
```

### B. `js/api.js` — chamadas igual o MotionPro

```js
const API = (function () {
    const CONFIG = {
        baseUrl: window.MV_CONFIG.apiBaseUrl,
        product: window.MV_CONFIG.productId,
    };

    async function request(path, opts = {}) {
        const token = localStorage.getItem("mv_session");
        const r = await fetch(CONFIG.baseUrl + path, {
            method: opts.method || (opts.body ? "POST" : "GET"),
            headers: Object.assign(
                { "Content-Type": "application/json" },
                token ? { Authorization: "Bearer " + token } : {}
            ),
            body: opts.body ? JSON.stringify(opts.body) : undefined
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ("http_" + r.status));
        return data;
    }

    return {
        signup:  (data) => request("/v1/auth/signup",  { body: data }),
        login:   (data) => request("/v1/auth/login",   { body: data }),
        forgot:  (email)=> request("/v1/auth/forgot-password", { body: { email } }),
        issueLicense: (fp) => request("/v1/license/issue", {
            body: { fingerprint: fp, product_id: CONFIG.product }   // ← envia product
        }),
        heartbeat: (fp) => request("/v1/license/heartbeat", {
            body: { fingerprint: fp, product_id: CONFIG.product }
        }),
        me: () => request("/v1/me"),
        checkout: (plan) => request("/v1/billing/checkout", {
            body: { plan, product: CONFIG.product, email: localStorage.getItem("mv_email") }
        })
    };
})();
```

### C. Trial bar + paywall idêntico ao MotionPro

Copie de `plugin/index.html` + `plugin/css/app.css` + `plugin/js/app.js` os blocos:
- `<div id="gate">` (login/signup)
- `<div id="trial-bar">`
- `<div id="verify-bar">`
- `<div id="paywall">`
- Funções `bindGate()`, `updateTrialUI()`, `showPaywall()`, `checkEmailVerified()`

Mude só:
- O brand text de "MotionPro" pra "Legendas Pro"
- O paywall mostra preços do produto Legendas
- A URL do botão "Assinar" vai pra `motionpro-lp.vercel.app/legendas/#pricing` (página específica)

### D. Extension ID único no `CSXS/manifest.xml`

```xml
<ExtensionManifest
    ExtensionBundleId="com.legendaspro.panel"
    ExtensionBundleVersion="1.0.0"
    ExtensionBundleName="Legendas Pro">
    ...
</ExtensionManifest>
```

> Importante: ID **diferente** do MotionPro pra ambos coexistirem no mesmo Premiere.

### E. Fingerprint compartilhado (IMPORTANTE)

Use **a mesma função `computeFingerprint()`** do MotionPro. Razão: se cliente tem MotionPro + Legendas no mesmo PC, queremos que o backend conte como **1 dispositivo** pros limites (não 2).

```js
// js/app.js — copia direto do MotionPro
function computeFingerprint() {
    var os = (typeof require === "function") ? require("os") : null;
    // ... mesma implementação
}
```

---

## 🎨 Dashboard admin — como vai ficar com 2 produtos

O dashboard já está preparado pra mostrar múltiplas subs por usuário. Vai aparecer assim:

```
Cliente: Gabriel Kendy
├── 📦 MotionPro      · Vitalício · ativo · 3 dispositivos
├── 📦 Legendas Pro   · Anual     · trial · expira em 14 dias
└── 📦 Bundle         · ❌ não tem
```

Pra adicionar a **coluna "Produto"** na lista:

```js
// dashboard/app.js — renderUsers()
const productsBadges = (u.subscriptions || []).map(s =>
    `<span class="badge badge--${planColor(s.plan)}" title="${s.product_id}">
        ${productEmoji(s.product_id)} ${s.plan}
     </span>`
).join(' ');
```

Filtro novo:
```html
<select id="users-product">
    <option value="all">Todos produtos</option>
    <option value="motionpro">MotionPro</option>
    <option value="legendas">Legendas Pro</option>
</select>
```

E no endpoint admin/users adiciona filtro:
```js
if (req.query.product) {
    params.push(req.query.product);
    where.push(`EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=u.id AND s.product_id=$${params.length})`);
}
```

---

## 💳 Stripe — criar produtos do Legendas

Roda o script `tools/stripe-bootstrap.js` adaptado:

```js
const PRODUCTS = [
    // ... os 2 do MotionPro já existem
    {
        mv_id: "legendas_yearly",
        name: "Legendas Pro · Anual",
        description: "Plugin de legendas inteligentes",
        unit_amount: 14900,   // R$ 149/ano
        recurring: { interval: "year" }
    },
    {
        mv_id: "legendas_lifetime",
        name: "Legendas Pro · Vitalício",
        unit_amount: 39900,   // R$ 399 uma vez
        recurring: null
    },
    {
        mv_id: "bundle_yearly",
        name: "Bundle Completo · Anual",
        description: "MotionPro + Legendas Pro",
        unit_amount: 29900,   // R$ 299/ano (vs R$ 348 separados)
        recurring: { interval: "year" }
    }
];
```

Depois insere os price IDs gerados na tabela `product_prices`.

---

## 📧 Email de welcome — multi-produto

Atualize `backend/src/utils/email.js → welcomeEmail({...})` pra receber `productName`:

```js
function welcomeEmail({ email, password, plan, productName, downloadUrl }) {
    const html = `...
    <h1>Bem-vindo ao ${productName || 'MotionPro'}</h1>
    ...
    <a href="${downloadUrl}">Baixar ${productName}</a>
    `;
}
```

E no webhook do checkout passa o nome certo:
```js
const productName = product_id === "legendas" ? "Legendas Pro"
                  : product_id === "bundle_all" ? "Bundle Completo"
                  : "MotionPro";
await welcomeEmail({ email, password, plan, productName, downloadUrl });
```

---

## 🚀 Plano de execução sugerido

### Fase 1 — Backend multi-produto (1 dia)
1. ✅ Rodar migration 004 (products + product_prices)
2. ✅ Atualizar `license/issue` e `heartbeat` pra aceitar product_id
3. ✅ Atualizar `billing/checkout` pra aceitar product no body
4. ✅ Atualizar webhook pra ler metadata.product_id
5. ✅ Atualizar `welcomeEmail` pra mostrar nome do produto

### Fase 2 — Plugin Legendas (paralelo, 1-3 semanas)
1. Cria pasta `legendas-plugin/` na mesma estrutura do MotionPro
2. Copia `js/config.js`, `js/api.js`, `js/app.js` do MotionPro
3. Muda `productId: "legendas"` no config
4. Implementa a UI específica do plugin (lista de estilos de legenda, presets, etc)
5. Reusa `gate`, `trial-bar`, `verify-bar`, `paywall` da MotionPro (copy/paste)
6. Bumpa CSXS ID pra `com.legendaspro.panel`

### Fase 3 — Dashboard multi-produto (1-2 dias)
1. Adiciona coluna "Produtos" na lista de users
2. Filtro por produto
3. KPIs separados (MRR MotionPro vs MRR Legendas vs MRR Bundle)
4. Grant admin escolhe produto

### Fase 4 — Landing Legendas (paralelo, designer)
1. Cria `landing/legendas/index.html` (ou subdomínio próprio)
2. Reusa header/footer/modal do MotionPro
3. Botões "Assinar" enviam `product=legendas` ao checkout

### Fase 5 — Bundle (opcional, depois)
1. Cria `bundle_all` no Stripe
2. Landing dedicado "Pacote Completo R$ 299/ano (R$ 348 separados, economize R$ 49)"
3. Backend já cobre via `bundle_all` no `getActiveSubscriptionForProduct`

---

## 📋 Checklist por plugin novo (template)

Quando for adicionar QUALQUER plugin futuro, segue esse roteiro:

- [ ] Criar entry em `products` table (`INSERT INTO products(id, name, ...)`)
- [ ] Criar produtos+prices no Stripe → salvar IDs em `product_prices`
- [ ] No plugin: `productId` único no `config.js`
- [ ] No plugin: ID CEP único em `CSXS/manifest.xml`
- [ ] Reusa: gate, trial-bar, verify-bar, paywall, computeFingerprint
- [ ] Endpoints do backend NÃO precisam mexer (já são genéricos)
- [ ] Landing: adicionar produto ao /pricing ou criar landing específico
- [ ] Email welcome: o `productName` aparece automático
- [ ] Dashboard: já mostra automaticamente na lista de subs do user

---

## 🔐 Decisões de design importantes (já tomadas)

1. **1 conta MotionPro = acesso a múltiplos produtos**
   - User cria conta uma vez
   - Compra cada plugin separado OU bundle
   - Login no plugin Legendas usa as mesmas credenciais do MotionPro

2. **License JWT carrega `product` no payload**
   - Plugin valida que `payload.product === window.MV_CONFIG.productId`
   - Evita usar license do MotionPro pra rodar Legendas

3. **Fingerprint compartilhado**
   - 1 dispositivo conta como 1, mesmo rodando 2 plugins
   - Tabela `devices` já é por user, não por plugin

4. **Trial isolado por produto**
   - Cliente pode ter trial do MotionPro expirado MAS trial do Legendas ativo
   - Cada produto tem sua própria entrada em `subscriptions`

5. **Stripe Customer compartilhado**
   - Mesma `stripe_customer` em `users` table
   - Cliente vê todas compras no mesmo Customer Portal
   - Stripe Link funciona pra todos os checkouts

---

## ❓ Decisões que ainda dependem da sua estratégia

| Pergunta | Opção A | Opção B |
|---|---|---|
| Bundle agressivo? | R$ 299 cobre os 2 (-14% vs separado) | R$ 349 cobre os 2 (-5% vs separado) |
| Trial separado ou compartilhado? | 14 dias por produto | 14 dias cobrindo tudo |
| Cliente MotionPro ganha desconto no Legendas? | -30% pra existente | sem desconto |
| Plugin Legendas tem catálogo próprio? | Sim, /v1/catalog?product=legendas | Compartilha estilos com MotionPro |

Quando você decidir essas 4, ajusto o backend pra refletir.

---

## 🆘 O que NÃO mexer (já tá perfeito)

- ❌ Não criar backend separado
- ❌ Não criar tabela users separada (mesmo email = mesma conta)
- ❌ Não duplicar lógica de auth (gate, paywall, trial bar — copia direto)
- ❌ Não criar dashboard admin separado (1 painel pra tudo)
- ❌ Não criar conta Stripe diferente

---

## 📚 Arquivos do MotionPro pra usar como REFERÊNCIA

| O que você precisa | Arquivo MotionPro |
|---|---|
| Tela de login/signup | `plugin/index.html` (linhas 11-44) |
| CSS do gate + paywall | `plugin/css/app.css` (busque `.gate__`, `.paywall`, `.trialbar`, `.verifybar`) |
| Lógica de auth + fingerprint | `plugin/js/app.js` (linhas 554-700) |
| Trial UI + paywall | `plugin/js/app.js` (linhas 700-900) |
| Endpoints disponíveis | `backend/src/routes/*.js` |
| Schema do banco | `backend/migrations/*.sql` |
| Tela admin completa | `dashboard/` |

---

## 💬 Quando estiver pronto pra começar:

Me passa essas infos que eu já preparo a Fase 1 (backend multi-produto):

1. **Nome oficial do plugin** ("Legendas Pro"? "MotionCaptions"? outro?)
2. **Preços decididos** (anual R$ X, vitalício R$ Y)
3. **Quer bundle?** (qual preço)
4. **ID interno** (sugiro `legendas` — curto e claro)
5. **Trial 14 dias separado ou compartilhado** com MotionPro

Aí em ~2h o backend tá multi-produto e você foca 100% em fazer o plugin novo. 🚀

---

```
─────────────────────────────────────────────────
   BASE · KENDY
   Multi-product integration guide
─────────────────────────────────────────────────
```
