# 💰 Como gerenciar MotionVault em produção

Guia rápido de onde ver/gerenciar tudo do dia-a-dia.

---

## 📊 Dashboards principais

| O que você quer ver | Onde ir |
|---|---|
| 💵 **Vendas em tempo real** | https://dashboard.stripe.com/payments |
| 👥 **Lista de clientes** | https://dashboard.stripe.com/customers |
| 🔁 **Assinaturas ativas / canceladas** | https://dashboard.stripe.com/subscriptions |
| 🧾 **Faturas** | https://dashboard.stripe.com/invoices |
| 📈 **Métricas de receita (MRR, churn)** | https://dashboard.stripe.com/billing/overview |
| 🔔 **Logs do webhook** | https://dashboard.stripe.com/webhooks → click no MotionVault Production |
| 🚀 **Logs do backend (erros)** | https://vercel.com/gabrielkendys-projects/motionpro/logs |
| 🗄️ **Dados do banco (users, licenses)** | https://console.neon.tech → SQL Editor |

---

## 🛠️ Ações comuns

### Reembolsar um cliente
1. https://dashboard.stripe.com/payments
2. Acha o pagamento (busca por email)
3. Click **"..."** → **"Refund payment"**
4. Escolhe valor total ou parcial → confirma
5. Cliente recebe estorno em 5-10 dias úteis
6. Se for assinatura, **cancela também** (próximo item)

### Cancelar assinatura de um cliente
1. https://dashboard.stripe.com/subscriptions
2. Acha a assinatura
3. Click **"Cancel subscription"**
4. Escolhe:
   - **Immediately** (corta acesso na hora)
   - **At end of period** (deixa usar até fim do mês/ano pago)
5. Stripe manda webhook `customer.subscription.deleted` → seu backend marca como `canceled` no banco automaticamente

### Bloquear/revogar acesso de um usuário (sem cancelar Stripe)
Útil pra casos de fraude ou pirataria:

```sql
-- Conecta no Neon (console.neon.tech → SQL Editor)
UPDATE subscriptions
   SET status = 'revoked'
 WHERE user_id = (SELECT id FROM users WHERE email = 'fraudador@example.com');

-- Revoga todos os dispositivos dele
UPDATE devices SET revoked = true
 WHERE user_id = (SELECT id FROM users WHERE email = 'fraudador@example.com');
```

### Dar acesso grátis (cortesia / influencer)
```sql
-- Cria conta primeiro (ou pede pro user fazer signup pela landing)
-- Depois insere assinatura manual:
INSERT INTO subscriptions (user_id, plan, status, stripe_sub_id, current_period_end)
VALUES (
  (SELECT id FROM users WHERE email = 'influencer@gmail.com'),
  'lifetime',
  'active',
  'manual_cortesia_001',
  NULL
);
```

### Ver licenças ativas de um usuário
```sql
SELECT u.email, s.plan, s.status, s.current_period_end, COUNT(d.id) AS dispositivos
  FROM users u
  LEFT JOIN subscriptions s ON s.user_id = u.id
  LEFT JOIN devices d ON d.user_id = u.id AND NOT d.revoked
 WHERE u.email = 'cliente@gmail.com'
 GROUP BY u.email, s.plan, s.status, s.current_period_end;
```

### Trocar preço de um plano
1. https://dashboard.stripe.com/products
2. Click no produto (ex: "MotionVault Anual")
3. **Add another price** com novo valor
4. Pega o **Price ID** novo (`price_...`)
5. Atualiza env var na Vercel:
   ```
   https://vercel.com/gabrielkendys-projects/motionpro/settings/environment-variables
   → edita STRIPE_PRICE_YEARLY com o novo price ID
   ```
6. Redeploy: vai em Deployments → "..." no último → **Redeploy**
7. ⚠️ **Clientes existentes mantêm o preço antigo** (Stripe não migra automaticamente)

### Criar um cupom de desconto
1. https://dashboard.stripe.com/coupons → **+ New**
2. **Type:** Percentage off (ex: 20%) OU Amount off (ex: R$50)
3. **Duration:** Once / Repeating / Forever
4. **Redemption code:** ex `BLACK20`
5. Save
6. Cliente usa no checkout (a opção "allow_promotion_codes" já tá habilitada no seu código)

---

## 🚨 Monitoramento (o que checar toda semana)

| Frequência | Onde olhar | O que verificar |
|---|---|---|
| **Diário** | https://dashboard.stripe.com/payments | Pagamentos falhos, chargebacks |
| **Diário** | https://dashboard.stripe.com/webhooks | Webhook com erro? (todos devem ser 200) |
| **Semanal** | https://dashboard.stripe.com/billing/overview | MRR cresceu? Churn rate? |
| **Semanal** | https://vercel.com/gabrielkendys-projects/motionpro/logs | Erros 500 no backend? |
| **Mensal** | Neon dashboard | Storage chegou perto de 0.5GB? (free tier) |

---

## 🔑 Onde acho cada segredo/URL?

| Segredo / URL | Onde |
|---|---|
| Backend API URL | `https://motionpro.vercel.app` |
| Landing URL | `https://motionvault-landing.vercel.app` (após deploy) |
| GitHub repo | `https://github.com/gabrielkendy/motion-pro` |
| Stripe Dashboard | `https://dashboard.stripe.com` |
| Neon Postgres | `https://console.neon.tech` |
| Vercel Project | `https://vercel.com/gabrielkendys-projects/motionpro` |
| **DATABASE_URL** | Neon → connection string |
| **STRIPE_SECRET** | Vercel Env Vars |
| **JWT_SECRET / LICENSE_SECRET** | Vercel Env Vars (manter no `.env` local também) |
| **STRIPE_WEBHOOK_SECRET** | Stripe → Webhooks → MotionVault Prod → Signing secret |

---

## 🎯 Fluxo completo de uma venda

1. **Cliente clica "Assinar Anual"** na landing
2. **Landing chama** `POST motionpro.vercel.app/v1/auth/signup` → cria usuário no Neon
3. **Landing chama** `POST motionpro.vercel.app/v1/billing/checkout?plan=yearly`
4. **Backend cria Stripe Checkout Session** → redireciona pro Stripe
5. **Cliente paga** no Stripe (cartão / Pix futuramente)
6. **Stripe manda webhook** `checkout.session.completed` pro backend
7. **Backend grava** `subscriptions` no Neon com `status=active`
8. **Cliente abre plugin no Premiere** → faz login com email/senha
9. **Plugin chama** `POST /v1/license/issue` → recebe JWT de licença
10. **Plugin carrega catálogo** → cliente arrasta templates pra timeline ✅

---

## 💸 Custos atuais (mensais)

| Serviço | Custo | Quando subir |
|---|---|---|
| Vercel Hobby (backend + landing) | **R$ 0** | Após 100GB/mês bandwidth ou 100h compute |
| Neon Free (Postgres) | **R$ 0** | Após 0.5GB storage |
| Stripe | **R$ 0 base** + 3.99% + R$0,39 por venda | — |
| GitHub | **R$ 0** | Sempre grátis pra repos privados |
| **TOTAL FIXO** | **R$ 0/mês** até primeira venda | — |

Exemplo: 100 vendas/mês a R$199 anual = R$19.900 receita. Custo Stripe = R$833. Lucro bruto = R$19.067.

---

## 🆘 Algo deu errado?

| Sintoma | Onde investigar |
|---|---|
| Cliente diz que pagou mas plugin não libera | Stripe → cliente → ver se webhook chegou; Neon → ver se subscription foi criada |
| Webhook com erro 500 | Vercel logs → procurar pelo timestamp do erro no Stripe |
| Cliente não consegue fazer login no plugin | Neon → tabela users → ver se email existe; testar `/v1/auth/login` no Postman |
| Plugin não carrega templates | Verificar `/v1/catalog` retornando 200; ver se token JWT do cliente expirou |
| Backend caiu / lento | Vercel Function logs; Neon pode estar dormindo (cold start ~2s no free tier) |
