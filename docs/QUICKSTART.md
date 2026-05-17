# MotionVault — Guia rápido

## A) Rodar o plugin em modo *bundled* (offline, sem backend)

Bom pra ver o painel funcionando hoje, com seus 7.906 mogrt reais.

1. Gere o catálogo (já foi feito uma vez):
   ```cmd
   cd MotionVault\tools
   node catalog-builder.js
   ```
   Saída: `plugin/catalog/catalog.json` (8 packs, 7906 itens).

2. Coloque a chave pública JWT no plugin para validar licenças locais.
   Para testar offline sem backend, edite `plugin/js/api.js` e troque
   temporariamente `publicKey` por uma string qualquer + comente as chamadas
   `License.authenticate` para liberar o app direto.

3. Instale:
   ```cmd
   cd MotionVault\installers\windows
   install.bat
   ```

4. Abra Premiere → **Window > Extensions > MotionVault**.

## B) Rodar com backend de assinatura

1. Backend:
   ```bash
   cd MotionVault/backend
   cp .env.example .env
   # edite .env: gere JWT_SECRET, LICENSE_SECRET e configure Stripe
   docker-compose up -d
   docker-compose exec api node src/db.js --migrate
   ```

2. Crie produtos no Stripe Dashboard (modo Test):
   - **MotionVault Monthly** ($19/mês recorrente)
   - **MotionVault Yearly** ($149/ano recorrente)
   - **MotionVault Lifetime** ($399 one-time)
   - Copie os 3 `price_id` para `.env` (STRIPE_PRICE_MONTHLY etc.)

3. Webhook local:
   ```bash
   npm run stripe:listen
   # copie o whsec_... para STRIPE_WEBHOOK_SECRET
   ```

4. Publique o catálogo no banco:
   ```bash
   curl -X POST http://localhost:8080/v1/catalog/publish \
     -H "Content-Type: application/json" \
     -d @../plugin/catalog/catalog.json
   ```

5. Configure o plugin para apontar ao backend:
   - Edite `plugin/js/api.js` → `baseUrl: "http://localhost:8080"`
   - Edite `publicKey` para o valor do `LICENSE_SECRET` (modo HS256
     compartilhado em dev). Para produção use RS256 com chave pública.

6. Reinstale (`install.bat`), abra o painel, crie sua conta na tela de gate,
   complete o checkout, volte e veja o badge mudar para PRO.

## C) Deploy em produção (mundo todo)

1. **Hospede o backend** (Fly.io, Railway, Render, AWS App Runner...):
   ```bash
   docker build -t motionvault-api .
   # ou: fly launch && fly deploy
   ```

2. **CDN dos assets** (S3 + CloudFront ou Cloudflare R2 + Workers):
   - Faça upload de cada `.mogrt` para `s3://motionvault-cdn/packs/<pack>/<id>.mogrt`
   - Popule a tabela `assets` com `id`, `pack_id`, `cdn_key`, `size_bytes`
   - Configure CloudFront com signed-URL OAI compatível com o HMAC do
     `assets.js`.

3. **Assine a extensão** com `ZXPSignCmd` (Adobe oficial):
   ```bash
   ZXPSignCmd -selfSignedCert BR SP PacotesFX MotionVault SuaSenhaForte cert.p12
   ZXPSignCmd -sign plugin/ MotionVault-1.0.0.zxp cert.p12 SuaSenhaForte -tsa http://timestamp.digicert.com
   ```
   Usuários instalam com **ExManCmd** ou via instalador `.exe`/`.dmg` que
   chama `ExManCmd` por baixo — sem precisar mexer no `PlayerDebugMode`.

4. **Submeta na Adobe Exchange** (`exchange.adobe.com`) para distribuição
   oficial e visibilidade global.

5. **Domínio + e-mail transacional**:
   - `motionvault.app` (Cloudflare DNS gratuito)
   - SendGrid / Resend para recovery de senha
