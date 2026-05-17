# 📧 Como ativar os e-mails automáticos (5 min)

O backend já está pronto pra mandar:
- ✉️ **Welcome** após compra (com senha temporária + link de download)
- 🔐 **Recuperação de senha** (link mágico)
- ⚠️ **Pagamento falhou** (alerta pro cliente atualizar cartão)

Só falta plugar uma API key do **Resend** (grátis até 3000 e-mails/mês).

---

## Passo 1 · Criar conta Resend (1 min)

1. Abre https://resend.com/signup
2. Sign up com GitHub (use mesma conta `gabrielkendy`)
3. Confirma o e-mail

---

## Passo 2 · Pegar API Key (30s)

1. Vai em https://resend.com/api-keys
2. Click **"+ Create API Key"**
3. Name: `motionvault-production`
4. Permission: **Full Access**
5. Copia a chave (`re_...`)

---

## Passo 3 · Adicionar no Vercel (1 min)

1. Abre https://vercel.com/kps-projects-b5c26735/motionpro/settings/environment-variables
2. Click **"+ Add"**
3. Preenche:
   ```
   Key:   RESEND_API_KEY
   Value: re_xxxxxxxxxx  (sua chave)
   ```
4. Click **Save**

---

## Passo 4 · Redeploy (30s)

No terminal:
```powershell
cd "C:\Users\Gabriel\Documents\Motion Bro\MotionVault\backend"
npx vercel redeploy motionpro.vercel.app
```

Ou simplesmente faça um commit qualquer pra disparar auto-deploy.

---

## Passo 5 · Testar (1 min)

Manda uma recuperação de senha:
```powershell
curl -X POST https://motionpro.vercel.app/v1/auth/forgot-password `
  -H "Content-Type: application/json" `
  -d '{"email":"gabriel.kend@gmail.com"}'
```

Deve retornar `"email_sent": true`. Cheque sua caixa de entrada — o e-mail chegou em ~5 segundos.

---

## ⚠️ Importante: domínio remetente

Por padrão, o Resend manda de `onboarding@resend.dev`. Funciona, mas vai cair em spam pra muita gente.

**Pra mandar de `noreply@motionvault.app` ou `suporte@pacotesfx.com`:**

1. Vai em https://resend.com/domains
2. Click **+ Add Domain**
3. Digita seu domínio (ex: `pacotesfx.com`)
4. Resend te dá 3 registros DNS pra adicionar:
   - SPF (TXT)
   - DKIM (CNAME ou TXT)
   - DMARC (TXT)
5. Adiciona esses no painel do seu registrador de domínio (GoDaddy, Cloudflare, etc)
6. Aguarda ~15 min pra propagar
7. Resend valida automaticamente → click "Verify"

Depois adiciona no Vercel:
```
EMAIL_FROM=MotionVault <noreply@pacotesfx.com>
```

E redeploya. Pronto, agora os e-mails saem do SEU domínio (taxa de entrega muito melhor).

---

## 💰 Custos

| Volume | Custo |
|---|---|
| Até 3.000 e-mails/mês | **Grátis** |
| Até 50.000 e-mails/mês | $20/mês (~R$ 100) |

Pra MotionVault (vendendo motion graphics), 3000/mês cobre tranquilamente 100+ vendas/mês com todos os welcome + reset + alertas.

---

## 🆘 Não chegou e-mail?

**Checa nessa ordem:**

1. **Caixa de spam** — primeiros e-mails de domínio novo sempre vão pra spam
2. **Resend logs** — https://resend.com/emails → deve aparecer status (delivered, bounced, etc)
3. **Vercel logs** — https://vercel.com/kps-projects-b5c26735/motionpro/logs → busca por "Resend" pra ver se houve erro
4. **API key correta?** — confirma no Vercel env vars
5. **Backend redeployado?** — após mudar env var, precisa redeploy senão fica usando o valor antigo
