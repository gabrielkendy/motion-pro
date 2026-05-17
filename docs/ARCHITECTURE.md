# MotionVault — Arquitetura técnica

## 1. Visão geral

MotionVault é uma extensão CEP (Adobe Common Extension Platform) para Premiere
Pro que substitui simultaneamente o **Motion Bro** (uso do acervo de `.mogrt`
PacotesFX) e o **AtomX** (browser próprio com seleção visual), unificando o
fluxo em um único painel com autenticação online e modelo de assinatura.

```
+----------------------+         +---------------------+
| Premiere Pro          |         |  MotionVault API    |
|  +-----------------+  | HTTPS   |  Node + Postgres    |
|  | CEP Panel       +--+-------->|  + Stripe + JWT     |
|  | HTML/JS/CSS     |  |         +---------+-----------+
|  +--------+--------+  |                   |
|           | evalScript|                   |
|  +--------v--------+  |                   v
|  | host.jsx        |  |          +--------+--------+
|  | importMGT       |  |          |  CDN (S3 + CF)  |
|  +-----------------+  |          |  .mogrt + .mp4  |
+----------------------+          +-----------------+
```

## 2. Camadas do plugin

| Camada | Arquivo | Responsabilidade |
|--------|---------|------------------|
| Bootstrap CEP | `CSXS/manifest.xml` | Versões de host (PPRO/AEFT), tamanho, ícones, debug ports |
| UI | `index.html`, `css/*.css` | Painel responsivo (gate + browser) |
| App shell | `js/app.js` | Renderização de abas/sidebar/grid, eventos UI |
| API client | `js/api.js` | Cliente HTTP, gestão de sessão local (`localStorage`) |
| License core | `js/license.js` | Fingerprint, autenticação, verificação JWT local, heartbeat, grace offline |
| Catálogo | `js/catalog.js` | Carrega `catalog.json` (local ou remoto), índice e busca |
| Importer | `js/importer.js` | Wrapper sobre `evalScript` |
| Host ExtendScript | `jsx/host.jsx` | Insere `.mogrt` na sequência ativa via `seq.importMGT(...)` |
| Crypto helpers | `js/lib/crypto-mini.js` | SHA-256, HMAC, verify JWT, AES-GCM |
| Bridge oficial | `js/lib/CSInterface.js` | API Adobe oficial (subset) |

## 3. Anti-pirataria

A proteção é em camadas — nenhuma sozinha é absoluta, mas juntas tornam a
cópia/cracking economicamente inviável.

1. **Hardware fingerprint** — derivado de `os.hostname`, `os.userInfo`,
   `os.totalmem`, MAC addresses e ID da extensão. SHA-256 evita reverter.
2. **JWT assinado (HS256)** — emitido pelo backend, contém `{ uid, plan, fp,
   packs, exp }`. O plugin **verifica a assinatura localmente** com a chave
   pública embarcada; se alguém devolver um payload forjado, o `verifyJWT`
   falha e o catálogo nem é renderizado.
3. **Fingerprint binding** — se o `fp` no JWT não bate com o atual, recusa.
4. **TTL curto + heartbeat** — JWT vale 24h; heartbeat a cada 6h
   renova/revoga. Cancelamento via Stripe propaga em até 6h.
5. **Grace offline limitada** — usa último JWT válido por até 7 dias sem rede;
   se relógio é puxado pra trás (clock rewind), recusa.
6. **Device limit (default 2)** — emitir 3ª licença bloqueia até revogar
   uma máquina pelo portal.
7. **Asset signing** — para o modelo CDN, cada `.mogrt` é baixado via URL
   assinada (HMAC + expira em 60 min + amarrada ao fingerprint).
8. **Code hardening** — `tools/obfuscate.js` aplica
   `javascript-obfuscator` (string array RC4 + control flow flattening +
   self-defending) antes do release. Lib `CSInterface.js` fica clara para
   compatibilidade.
9. **Auditoria server-side** — tabela `license_audit` grava `issue`,
   `heartbeat`, `device_limit`, `tamper`, `revoke`. Suspeitas geram alerta.

> **Importante:** o `.reg` que vinha com a AtomX (PlayerDebugMode=1) **NÃO é
> proteção** — é só pra Premiere aceitar extensão não assinada. Mantemos isso
> em desenvolvimento. Em produção, assine a extensão com
> `ZXPSignCmd` da Adobe (eliminando a necessidade do registro), o que dá
> sensação de produto profissional.

## 4. Modelos de licenciamento

| Plano       | Stripe price var          | Acesso                                      |
|-------------|---------------------------|---------------------------------------------|
| `free`      | —                         | Browse limitado, sem importar               |
| `monthly`   | `STRIPE_PRICE_MONTHLY`    | Tudo, mensal recorrente, 2 dispositivos     |
| `yearly`    | `STRIPE_PRICE_YEARLY`     | Tudo, anual (~30% desconto), 2 dispositivos |
| `lifetime`  | `STRIPE_PRICE_LIFETIME`   | Pagamento único, validade 50 anos, 3 disp.  |
| `pro_all`   | (manual override)         | Para parceiros/afiliados, lifetime + tudo   |

Política de pack por plano fica em `packs: ["*"]` ou
`packs: ["create-pack", "monster-fx"]` dentro do JWT — permite criar bundles
parciais sem alterar código do cliente.

## 5. Distribuição dos assets

Duas estratégias coexistem:

- **Bundled** (entrega imediata, mais simples) — os `.mogrt` já estão na
  máquina do cliente (eles instalam o pacote completo). O plugin só
  *autoriza*: se a licença for válida, importa; se não, recusa. Vantagem:
  funciona offline e simples para você entregar agora. Desvantagem: o pacote
  inicial é grande (~vários GB).

- **CDN sob demanda** (escalável) — só o catálogo + previews `.mp4` (mais
  leves) ficam pré-instalados; cada `.mogrt` é baixado quando o usuário tenta
  importar, via URL assinada (`/v1/assets/sign`). Vantagem: instalação leve,
  controle total. Desvantagem: depende de hospedagem.

A migração entre os dois modos é só uma flag — o `Importer` recebe o caminho
absoluto seja ele um arquivo local ou um download recém-feito do CDN.

## 6. Backend

- **Express** com `helmet` + `cors` + `express-rate-limit`
- **Postgres 16** (Docker compose dev, RDS/Aurora em produção)
- **Stripe** Checkout + Billing Portal + Webhook
- **JWT** HS256 (em produção, troque para RS256 e publique a chave pública em
  `https://api.motionvault.app/.well-known/jwks.json`)

### Rotas

```
POST /v1/auth/signup           { email, password }              -> { session_token, user }
POST /v1/auth/login            { email, password, fingerprint } -> { session_token, user }

GET  /v1/me                                                     -> { user, subscription }
GET  /v1/me/machines                                            -> { devices, limit }
DELETE /v1/me/machines/:id                                      -> { ok }

POST /v1/license/issue         { fingerprint }                  -> { license (JWT), plan, max_devices }
POST /v1/license/heartbeat     { fingerprint }                  -> { license, plan } | { revoked }

POST /v1/billing/checkout?plan=monthly|yearly|lifetime          -> { url }
POST /v1/billing/portal                                         -> { url }
POST /v1/billing/webhook       (Stripe signature)               -> { received }

GET  /v1/catalog?v=latest                                       -> {catalog json}
POST /v1/catalog/publish       (admin)                          -> {ok}

POST /v1/assets/sign           { asset_id, fingerprint }        -> { url, expires_in }
```

## 7. Roadmap técnico após MVP

- [ ] Assinar extensão com ZXPSignCmd e distribuir `.zxp` via instalador único
- [ ] Trocar HS256 por RS256 com JWKS
- [ ] Drag-and-drop direto na timeline (CEP suporta via HTML5 + ExtendScript)
- [ ] Cache local LRU dos `.mogrt` baixados (cap em GB configurável)
- [ ] Telemetria opt-in (assets mais usados → roadmap de novos packs)
- [ ] Versão After Effects (já listada no manifest — `.aep`/`.ffx` em vez de `.mogrt`)
- [ ] Admin dashboard (Next.js) — gestão de usuários, refunds, pack-level entitlements
