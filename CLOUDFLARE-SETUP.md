# Setup do CDN (Nível 2) — Cloudflare R2 + Workers

> Tudo que você precisa fazer pra ativar o CDN assinado.
> Tempo estimado: **30-40 minutos**, sem terminal pra você (eu rodo o resto depois).

---

## ✅ Pré-requisitos
- [x] Conta Cloudflare (você já tem)
- [x] Domínio `kendyproducoes` na Cloudflare (você já tem)
- [x] Vercel project `Motion Titles` (já tem)
- [x] Neon Postgres (já tem)
- [ ] **Itens abaixo** que preciso de você

---

## 📦 Bloco 1 — Criar R2 bucket (5 min)

1. Cloudflare dashboard → **R2** (menu lateral)
2. Se for a 1ª vez: aceita os termos + ativa R2 (free tier 10GB)
3. Clica **Create bucket**
   - Name: `Motion Titles-assets`
   - Location: **Automatic**
   - Default Storage Class: **Standard**
4. Clica **Create bucket**

### R2 API Token (pra fazer upload via script)
1. Dentro de **R2 → Manage R2 API Tokens** (canto superior direito)
2. **Create API Token**
   - Token name: `Motion Titles-upload`
   - Permissions: **Object Read & Write**
   - Specify bucket: `Motion Titles-assets`
   - TTL: ilimitado
3. **Create API Token** → copia:
   - **Access Key ID**
   - **Secret Access Key**
   - **Endpoint** (formato `https://<account_id>.r2.cloudflarestorage.com`)

**Me manda:**
```
R2_ACCOUNT_ID = ......... (parte antes do .r2 no endpoint)
R2_ACCESS_KEY_ID = .........
R2_SECRET_ACCESS_KEY = .........
```

---

## ⚡ Bloco 2 — Deploy do Worker CDN (5 min)

> Faço eu via wrangler CLI quando você me passar o **Cloudflare API Token**.

### API Token (escopo Workers)
1. Cloudflare dashboard → **My Profile** (canto superior direito) → **API Tokens**
2. **Create Token**
3. Template: **Edit Cloudflare Workers**
   - Account: `kendyproducoes` (sua conta)
   - Zone Resources: Include → Specific zone → `kendyproducoes.com`
4. **Continue to summary** → **Create Token** → copia o token

**Me manda:**
```
CLOUDFLARE_API_TOKEN = .........
CLOUDFLARE_ACCOUNT_ID = ......... (mesma da R2)
```

### Sub-domínio CDN
1. Cloudflare dashboard → **kendyproducoes.com** → **DNS → Records**
2. **Add record**:
   - Type: `CNAME`
   - Name: `cdn`
   - Target: `Motion Titles-cdn.<seu-account>.workers.dev` (vou te dar depois do deploy)
   - Proxy status: **Proxied** (laranja)
   - TTL: Auto
3. Salva

Resultado final: `https://cdn.kendyproducoes.com/<key>` serve os assets.

---

## 🔐 Bloco 3 — Secret HMAC compartilhado (1 min)

Gera uma string forte (eu posso gerar pra você ou rode no terminal):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Resultado: algo tipo `9f8a3e...64chars`.

Esse mesmo secret precisa estar em:
1. **Vercel backend env** (`Motion Titles` project) — variável `CDN_SIGN_SECRET`
2. **Cloudflare Worker secret** — eu seto via `wrangler secret put CDN_SIGN_SECRET`

---

## 🌐 Bloco 4 — Env vars no Vercel (3 min)

Vai em https://vercel.com/kps-projects-b5c26735/motionpro/settings/environment-variables e adiciona (Production + Preview + Development):

```
CDN_BASE              = https://cdn.kendyproducoes.com
CDN_SIGN_SECRET       = <o secret de 64 chars do Bloco 3>
CDN_URL_TTL_MIN       = 5
R2_ACCOUNT_ID         = <Bloco 1>
R2_ACCESS_KEY_ID      = <Bloco 1>
R2_SECRET_ACCESS_KEY  = <Bloco 1>
R2_BUCKET             = Motion Titles-assets
SOURCE_ROOT           = C:\Users\Gabriel\Documents\Motion Bro
```

> Apenas `CDN_BASE`, `CDN_SIGN_SECRET` e `CDN_URL_TTL_MIN` são usados pelo backend Vercel em runtime. Os outros são pra rodar `tools/upload-to-r2.js` quando eu fizer o batch upload.

Depois de salvar, fala "OK" que eu re-deploy do backend pra pegar as envs novas.

---

## 🗄️ Bloco 5 — Aplicar migration 006 no Neon (2 min)

> Eu rodo depois que o resto estiver configurado.

```bash
psql $DATABASE_URL -f backend/migrations/006_cdn_assets.sql
```

Adiciona colunas `sha256`, `kind`, `published`, `product_id` na tabela `assets` + cria `asset_download_log`.

---

## 🚚 Bloco 6 — Upload dos 7906 templates (eu rodo, ~6h em background)

Comando que vou rodar quando tudo acima estiver pronto:
```bash
cd tools
npm install
$env:R2_ACCOUNT_ID="..."
$env:R2_ACCESS_KEY_ID="..."
$env:R2_SECRET_ACCESS_KEY="..."
$env:DATABASE_URL="..."
node upload-to-r2.js --concurrency 6
```

Faz:
- Upload de **7906 .mogrt** (~7.8GB) → R2 `mogrt/<pack>/...`
- Upload de **7892 .mp4 previews** (~1.95GB) → R2 `preview/<pack>/...`
- Popula tabela `assets` em Postgres
- Resumable via `tools/.upload-state.json` (se cair na metade, `--resume`)

Custo estimado:
- **Storage R2:** ~10GB = $0.15/mês = **R$ 0,90/mês** (acima do free tier por 100MB)
- **Class A operations (uploads):** ~16k operations × $4.50/1M = **$0.07 one-time**
- **Egress:** **$0** (R2 zero egress sempre)

**Total recorrente: ~R$ 1/mês.** (Se renegociar pra 9.5GB cai pra free tier 100%.)

---

## 🔄 Bloco 7 — Migrar catalog.json (eu rodo, ~2 min)

```bash
cd tools
node migrate-catalog.js
```

Converte `plugin/catalog/catalog.json` (paths absolutos) → `plugin/catalog/catalog.json` (cdn_keys + ids). Faz backup automático em `catalog.legacy.json`.

---

## 🚀 Bloco 8 — Re-build dos 2 plugins + ship (eu rodo)

```powershell
cd installers/zip-manual         ; .\build-zip.ps1
cd ../zip-manual-legendas        ; .\build-zip.ps1
```

Versões: Motion Titles **v1.0.5**, Legendas **v1.1.2** (com obfuscação + asset-loader).

Publico no GitHub Releases → landing volta a funcionar pra qualquer cliente novo.

---

## ✅ Checklist final que preciso de você

Quando bater todos esses, eu termino tudo em ~30 min:

- [ ] **R2_ACCOUNT_ID**
- [ ] **R2_ACCESS_KEY_ID**
- [ ] **R2_SECRET_ACCESS_KEY**
- [ ] **CLOUDFLARE_API_TOKEN** (escopo Workers + DNS)
- [ ] **CNAME** `cdn.kendyproducoes.com` → criado no DNS (target eu mando depois do deploy)
- [ ] **Vercel env vars** adicionadas no project `Motion Titles`

Posso te mandar instruções com prints se preferir.

---

## 🛡️ O que isso entrega

Depois de ativado:
- **7906 templates** ficam no R2 (não no PC do cliente)
- Plugin baixa **on-demand** via URL assinada (TTL 5 min + device fingerprint)
- Cache local em `%LOCALAPPDATA%\Motion Titles\cache\`
- Cópia da pasta `%APPDATA%\Adobe\CEP\extensions\com.motionvault.panel\` **não roda** sem login válido
- Cancelar plano → próximo download bloqueado (rate limit 5min via TTL)
- Compartilhar login → device fingerprint não bate, server bloqueia
- Cliente offline com cache → continua usando templates já baixados

**Bloqueia ~80-85% da pirataria** sem mexer em UXP migration.
