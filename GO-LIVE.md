# MotionVault — checklist completo para ir ao ar

> Tempo estimado total: **3–4 horas concentradas**, dividido em blocos de
> 15 a 40 min. Marque cada item ao concluir.

## Bloco 1 — Testar AGORA no Premiere (10 min) ✅

- [ ] Clique duplo em **`TESTAR-AGORA.bat`**
- [ ] Espere terminar (instala o plugin + ativa CSXS debug)
- [ ] Feche o Premiere (incluindo do Gerenciador de Tarefas)
- [ ] Abra o Premiere → `Window > Extensions > MotionVault`
- [ ] Cria uma sequência nova
- [ ] Clica duplo em qualquer template → ele entra na timeline

Está em **modo DEV**, sem login, plano "lifetime" simulado. Bom pra validar
que o painel + a importação `.mogrt` funcionam na sua máquina.

---

## Bloco 2 — Domínio + Stripe + e-mail (30 min)

- [ ] Compre um domínio (sugestão: `motionvault.app` ou `.io` ou `.com`)
      Cloudflare Registrar ou Registro.br
- [ ] No **Stripe Dashboard** (você já tem conta):
    - [ ] Anote `STRIPE_SECRET` (chave secreta live ou test)
    - [ ] Vamos criar os produtos automaticamente no Bloco 4
- [ ] Crie conta gratuita no **Resend** (https://resend.com) ou SendGrid
      pra e-mail transacional (anote a API key)
- [ ] Crie conta gratuita no **Fly.io** (https://fly.io) — backend
- [ ] Crie conta gratuita no **Cloudflare Pages** ou **Vercel** — landing

---

## Bloco 3 — Deploy do backend (40 min)

```bash
# 1. Instale Fly CLI (uma vez)
# Windows PowerShell:
iwr https://fly.io/install.ps1 -useb | iex

# 2. Login
fly auth login

# 3. Na pasta backend
cd "c:\Users\Gabriel\Documents\Motion Bro\MotionVault\backend"

# 4. Crie o app (escolha um nome ÚNICO; ex: motionvault-api-XX)
fly launch --no-deploy --copy-config

# 5. Crie o Postgres (free tier dá pra começar)
fly postgres create --name motionvault-db --region gru --vm-size shared-cpu-1x --initial-cluster-size 1
fly postgres attach motionvault-db -a <SEU-NOME-DO-APP>

# 6. Gere segredos seguros e suba
$JWT=(openssl rand -hex 64)
$LIC=(openssl rand -hex 64)
$CDN=(openssl rand -hex 32)

fly secrets set `
  JWT_SECRET=$JWT `
  LICENSE_SECRET=$LIC `
  CDN_SIGN_SECRET=$CDN `
  STRIPE_SECRET=sk_live_xxx `
  PUBLIC_URL=https://motionvault.app `
  CDN_BASE=https://cdn.motionvault.app

# 7. Deploy
fly deploy

# 8. Aplica migrations
fly ssh console -C "node src/db.js --migrate"

# 9. Pegue a URL final (algo como https://motionvault-api-xx.fly.dev)
fly status
```

- [ ] Backend respondendo em `https://<seu-app>.fly.dev/health`
- [ ] Aponte seu domínio: `api.motionvault.app` → CNAME `<seu-app>.fly.dev`
      No Fly: `fly certs add api.motionvault.app`

---

## Bloco 4 — Stripe products + webhook (15 min)

```bash
# Cria os 3 produtos automaticamente
cd "c:\Users\Gabriel\Documents\Motion Bro\MotionVault\tools"
npm i stripe
$env:STRIPE_SECRET = "sk_live_xxx"
node stripe-bootstrap.js

# Copia as 3 linhas STRIPE_PRICE_* que ele imprime
```

- [ ] No **Stripe Dashboard > Developers > Webhooks**:
    - [ ] Add endpoint: `https://api.motionvault.app/v1/billing/webhook`
    - [ ] Eventos: `checkout.session.completed`, `customer.subscription.*`
    - [ ] Copia o `whsec_...`

```powershell
fly secrets set `
  STRIPE_PRICE_MONTHLY=price_xxx `
  STRIPE_PRICE_YEARLY=price_xxx `
  STRIPE_PRICE_LIFETIME=price_xxx `
  STRIPE_WEBHOOK_SECRET=whsec_xxx
```

- [ ] Teste: `https://motionvault.app` → botão Assinar → checkout completa

---

## Bloco 5 — Publicar landing page (15 min)

Opção mais simples = Cloudflare Pages:

- [ ] No Cloudflare Pages: **Create > Direct upload**
- [ ] Arrasta a pasta `landing/` inteira
- [ ] Aponte `motionvault.app` no dashboard de DNS
- [ ] Edita `landing/index.html` e `account.html`:
      muda `window.MV_API = "https://api.motionvault.app"`

---

## Bloco 6 — Plugin de produção (20 min)

```bash
cd "c:\Users\Gabriel\Documents\Motion Bro\MotionVault\plugin\js"
# 1. Edita config.js
#    devMode: false
#    apiBaseUrl: "https://api.motionvault.app"
#    licensePublicKey: "<o mesmo LICENSE_SECRET de Fly secrets>"
```

- [ ] Ofusca o JS:
    ```bash
    cd ../../tools
    npm i -g javascript-obfuscator
    node obfuscate.js
    ```
- [ ] Empacota o plugin como `.zxp` (instalável oficial Adobe):
    ```bash
    # baixe ZXPSignCmd da Adobe: https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD
    ZXPSignCmd -selfSignedCert BR SP PacotesFX MotionVault SuaSenhaForte cert.p12
    ZXPSignCmd -sign ../plugin MotionVault-1.0.0.zxp cert.p12 SuaSenhaForte -tsa http://timestamp.digicert.com
    ```
- [ ] Sobe `MotionVault-windows-1.0.0.zip` e `.dmg` em
      `landing/downloads/` (Cloudflare Pages serve estático grátis)

---

## Bloco 7 — Testar fluxo completo (15 min)

- [ ] Site → criar conta → escolher plano Yearly em modo Test
- [ ] Stripe webhook converte sub
- [ ] Baixa plugin → instala → faz login
- [ ] Plano aparece como "yearly" no badge
- [ ] Importa template no Premiere → funciona
- [ ] Cancela no portal → após heartbeat (6h) ou logout/login, plano vira `free`

---

## Bloco 8 — Lançamento (mesmo dia)

- [ ] Trocar Stripe de Test para Live (`sk_live_...`)
- [ ] Gravar vídeo de 60 segundos pro Instagram/YouTube
- [ ] Postar nos seus canais PacotesFX
- [ ] Mandar e-mail pra base atual: "Atualizei o plugin, agora tudo num só lugar"
- [ ] Submeter à **Adobe Exchange** (opcional, dá visibilidade global mas
      a aprovação leva semanas; pode lançar fora dela primeiro)

---

## Custos mensais reais

| Serviço          | Custo                       |
|------------------|-----------------------------|
| Fly.io API       | $0 (free tier até 3 VMs) ou ~$5/mês |
| Fly Postgres     | $0 free tier (até saturar)  |
| Cloudflare DNS+Pages | $0                      |
| Domínio          | ~$12/ano                    |
| Resend e-mail    | $0 (3000 e-mails/mês free)  |
| Stripe           | 2.9% + $0.30 por transação  |
| **Total fixo**   | **~$1–6/mês**                |

Você só começa a pagar mais quando começa a vender. 100 clientes pagantes
ainda mantém o custo em <$50/mês.

---

## Se travar em algo

Diga em qual bloco / qual comando deu erro. Eu ajusto na hora.
