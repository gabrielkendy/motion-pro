# Deploy MotionVault no Vercel (passo a passo)

Tempo total: **~45 minutos**. Sem terminal. Só cliques no navegador.

---

## 📋 Você vai precisar criar 3 contas (todas grátis)

1. **GitHub** — pra hospedar o código (https://github.com)
2. **Vercel** — pra hospedar landing + backend (https://vercel.com) — entra com conta GitHub
3. **Neon** — banco Postgres free (https://neon.tech) — entra com conta GitHub

---

## PASSO 1 — Subir o código no GitHub (10 min)

1. Vai em https://github.com/new
2. Repository name: `motionvault`
3. Marca **Private** (não queremos código público — tem chaves dentro)
4. Cria o repo

Depois, na pasta `c:\Users\Gabriel\Documents\Motion Bro\MotionVault\`:

**Opção A (mais fácil — GitHub Desktop):**
1. Baixa https://desktop.github.com/
2. Login com sua conta
3. File > Add Local Repository → escolhe `MotionVault\`
4. Publish repository → escolhe o repo `motionvault`

**Opção B (linha de comando, se tiver git):**
```bash
cd "c:\Users\Gabriel\Documents\Motion Bro\MotionVault"
git init
git add .
git commit -m "Initial MotionVault commit"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/motionvault.git
git push -u origin main
```

⚠️ **IMPORTANTE:** o arquivo `.gitignore` já está configurado pra **NÃO** subir o `.env`
(que tem sua chave Stripe). Confirme antes de fazer push.

---

## PASSO 2 — Criar banco Postgres no Neon (5 min)

1. Entra em https://neon.tech → "Sign up with GitHub"
2. Cria projeto: nome **motionvault**, região **AWS / São Paulo (sa-east-1)**
3. Vai aparecer a tela com a **connection string** — copia, vai parecer assim:
   ```
   postgresql://motionvault_owner:abc123XYZ@ep-cool-leaf-12345.sa-east-1.aws.neon.tech/motionvault?sslmode=require
   ```
4. **Cola aqui no chat** que eu te digo o próximo passo

---

## PASSO 3 — Deploy do backend no Vercel (10 min)

1. Entra em https://vercel.com → "Continue with GitHub"
2. Authorize Vercel pra ver seu repo
3. Click **"Add New" → Project**
4. Importa o repo `motionvault`
5. Vai aparecer a tela de configuração:
   - **Root Directory:** clica em "Edit" e escolhe `backend`
   - **Framework Preset:** Other (deixa default)
   - **Build Command:** deixa vazio
   - **Output Directory:** deixa vazio
6. **Environment Variables** — clica pra expandir e adiciona TODAS estas
   (copia do seu `backend/.env` local; eu já configurei tudo):

   ```
   NODE_ENV=production
   DATABASE_URL=<sua URL do Neon do passo 2>
   JWT_SECRET=<copia do seu .env>
   LICENSE_SECRET=<copia do seu .env>
   LICENSE_TTL_HOURS=24
   TRIAL_DAYS=7
   STRIPE_SECRET=rk_live_51S7vqj...
   STRIPE_PRICE_YEARLY=price_1TY6BHBBwmTfpkhYOkVzI0vE
   STRIPE_PRICE_LIFETIME=price_1TY6BJBBwmTfpkhYNYYWFXUb
   PUBLIC_URL=https://motionvault.vercel.app
   ```

   *(STRIPE_WEBHOOK_SECRET vamos adicionar depois)*

7. Click **Deploy**. Espera ~1 minuto.
8. Vai te dar uma URL tipo `https://motionvault-backend-xxxxx.vercel.app`
9. **Cola essa URL aqui no chat**

---

## PASSO 4 — Configurar webhook do Stripe (5 min)

1. Volta no Stripe Dashboard: https://dashboard.stripe.com/webhooks
2. Click **"+ Adicionar endpoint"**
3. **URL do endpoint:** `https://SEU-BACKEND-URL.vercel.app/v1/billing/webhook`
   (usa a URL que o Vercel te deu no passo 3)
4. **Eventos pra ouvir:** selecione estes:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Clica em **"Adicionar endpoint"**
6. Na tela do endpoint criado, clica em **"Revelar"** ao lado do "Signing secret"
7. **Cola aqui o `whsec_...`** — eu adiciono nas variáveis do Vercel

---

## PASSO 5 — Rodar migration no Neon (1 min, eu rodo)

Depois que você me passar a connection string do Neon, eu rodo
daqui mesmo o `node src/db.js --migrate` que cria as tabelas no banco.

---

## PASSO 6 — Deploy da landing page (5 min)

1. Vercel → **Add New → Project**
2. Mesmo repo `motionvault`
3. **Root Directory:** escolhe `landing`
4. Framework: **Other**
5. Deploy
6. Vai te dar URL tipo `https://motionvault.vercel.app`
7. **Cola aqui** que eu aponto a landing pro backend

---

## PASSO 7 — Apontar plugin pro backend live (eu faço, 2 min)

Eu edito `plugin/js/config.js`:
```js
apiBaseUrl: "https://seu-backend.vercel.app"
```

Reinstalo o plugin local. Você abre Premiere, cria conta com email,
recebe trial de 7 dias, e tudo funciona com seu backend de verdade.

---

## PASSO 8 — Domínio próprio (opcional, depois)

Quando quiser comprar `motionvault.com.br` ou similar:
1. Compra no Registro.br (~R$40/ano)
2. No Vercel, vai no projeto → Settings → Domains → Add
3. Adiciona `motionvault.com.br` (landing) e `api.motionvault.com.br` (backend)
4. Cola os registros DNS no Registro.br
5. Em ~5 minutos tá no ar

---

## Custos finais

| Serviço | Plano | Custo/mês |
|---|---|---|
| GitHub Private repo | Free | R$ 0 |
| Vercel (landing + backend) | Hobby | R$ 0 |
| Neon Postgres (0.5 GB) | Free | R$ 0 |
| Stripe | Pay as you go | 3.99% + R$0,39 por venda |
| **Total fixo** | | **R$ 0/mês** |

Você só paga Stripe quando alguém compra. Sem custo até a primeira venda.

---

**Vai fazendo passo a passo.** Cada vez que terminar um, me cola aqui:
- ✅ URL do backend Vercel
- ✅ Connection string Neon
- ✅ Webhook secret Stripe (`whsec_...`)
- ✅ URL da landing Vercel

Que eu vou conectando tudo.
