# Vercel Env Cleanup — Eliminar `\n` Trailing em Secrets de Assinatura

> Status: PLAYBOOK (Gabriel executa). Agente κ NÃO tem auth Vercel CLI.

## 1. Problem Statement

Quando um env var é colado via dashboard Vercel (campo HTML `<textarea>`),
o browser frequentemente anexa um `\n` (LF) ou `\r\n` (CRLF) trailing
ao valor. Como resultado, `process.env.X` no runtime do Lambda contém
caractere extra invisível.

**Impacto comprovado** (referência: commit `d42795f` — `fix(cdn): .trim()
em CDN_SIGN_SECRET + CDN_BASE pra eliminar \n trailing`):

- Backend computa HMAC-SHA256 sobre `${key}\n${fp}\n${expires}` usando
  secret `"abc...xyz\n"` (com LF trailing)
- Worker Cloudflare tem `CDN_SIGN_SECRET = "abc...xyz"` (sem LF)
- HMACs divergem → Worker retorna `401 invalid_signature`
- Sintoma observado: download de `.mogrt` quebra 100% mesmo com user
  autenticado, sub ativa, device registrado

Histórico:
- `d42795f` — adicionou `.trim()` defensivo em `signCdnUrl()` e `cdn-self-test`
- `cfcb487` — removeu endpoint diag temporário (`/_diag/cdn`) após
  confirmar `worker_status=200`
- **Estado atual da main (κ verificou 2026-05-23)**: NÃO há mais `.trim()`
  defensivo em `signCdnUrl` (linha `assets.js:12` lê
  `process.env.CDN_SIGN_SECRET` direto). A rota `cdn-self-test` também
  foi removida.

A solução correta NÃO é manter `.trim()` no código (esconde bug de
provisionamento) — é **sanitizar a fonte** (Vercel env store) e usar
`printf '%s'` no re-add pra garantir bytes exatos.

## 2. Envs Suspeitos (signing-critical)

Levantados via `grep "process\.env\." backend/src/` e classificados:

### Críticos para HMAC/JWT (qualquer `\n` trailing → assinatura quebra)

| Env Var                       | Uso                                                | Arquivo                                |
|-------------------------------|----------------------------------------------------|----------------------------------------|
| `CDN_SIGN_SECRET`             | HMAC-SHA256 das URLs do CDN                        | `backend/src/routes/assets.js:12`      |
| `CDN_BASE`                    | Prefixo da URL assinada (concat → URL final)       | `backend/src/routes/assets.js:13`      |
| `JWT_SECRET`                  | HS256 do session JWT (`/v1/auth/login`)            | `backend/src/utils/jwt.js:4`           |
| `LICENSE_SECRET`              | HS256 do license JWT (assinado pelo backend)       | `backend/src/utils/jwt.js:5`           |
| `MV_JWT_SECRET`               | HS256 do OAuth callback JWT                        | `backend/src/routes/oauth.js:61`       |
| `STRIPE_WEBHOOK_SECRET`       | Verificação HMAC do webhook Stripe                 | `backend/src/routes/billing.js:217`    |
| `STRIPE_SECRET`               | Bearer pra Stripe API (qualquer `\n` → 401)        | `backend/src/routes/admin.js:7`, `billing.js:12` |
| `PG_AI_KEY_SECRET`            | Chave AES p/ encrypt das API keys de usuário       | `backend/src/routes/ai-settings.js:19` |
| `RESEND_API_KEY`              | Bearer Resend (email)                              | `backend/src/utils/email.js:8`         |
| `CRON_SECRET`                 | Compare exato em `requireCronSecret`               | `backend/src/routes/cron.js:10`        |
| `OAUTH_GOOGLE_CLIENT_SECRET`  | OAuth token exchange (Google)                      | `backend/src/routes/oauth.js:74`       |
| `OAUTH_GITHUB_CLIENT_SECRET`  | OAuth token exchange (GitHub)                      | `backend/src/routes/oauth.js:89`       |
| `OAUTH_GOOGLE_CLIENT_ID`      | OAuth — geralmente safe, mas valida assim mesmo    | `backend/src/routes/oauth.js:73`       |
| `OAUTH_GITHUB_CLIENT_ID`      | idem                                               | `backend/src/routes/oauth.js:88`       |
| `OAUTH_REDIRECT_BASE`         | Concat em redirect_uri — `\n` quebra OAuth         | `backend/src/routes/oauth.js:119,149,236` |
| `DATABASE_URL`                | Connection string Postgres                          | `backend/src/db.js:8`                  |

### Informacionais / com defaults seguros (lower priority)

| Env Var                   | Uso                                       |
|---------------------------|-------------------------------------------|
| `EMAIL_FROM`              | From header (default existe)              |
| `PUBLIC_URL`              | URLs em emails (default existe)           |
| `PRICING_URL`             | redirect (default existe)                 |
| `DASHBOARD_URL`           | string em email (default existe)          |
| `TUTORIAL_VIDEO_URL`      | opcional                                  |
| `OAUTH_SUCCESS_URL`       | redirect com default `/`                  |
| `STRIPE_PRICE_YEARLY`     | price id (geralmente sem trailing)        |
| `STRIPE_PRICE_LIFETIME`   | idem                                      |
| `CDN_URL_TTL_MIN`         | numérico (`Number()` ignora `\n`)         |
| `PG_POOL_MAX`             | numérico                                  |
| `TRIAL_DAYS`              | numérico                                  |
| `LICENSE_TTL_HOURS`       | numérico                                  |
| `MAX_DEVICES_PER_LICENSE` | numérico                                  |
| `VERCEL`                  | flag                                      |
| `PORT`                    | numérico                                  |

## 3. Playbook (Gabriel executa em terminal POSIX)

> Requer: `VERCEL_TOKEN` exportado, `vercel` CLI instalado, login no projeto motionpro.

### 3.1 — Dump bruto (não-commitável: contém valores)

```sh
mkdir -p /tmp/vercel-audit
vercel env pull --environment=production --token="$VERCEL_TOKEN" -y /tmp/vercel-audit/raw.env
chmod 600 /tmp/vercel-audit/raw.env
```

### 3.2 — Sanitização → snapshot commitável

Script `sanitize-vercel-env.sh` (salvar local em `~/scripts/`, NÃO commitar):

```sh
#!/bin/sh
# Lê /tmp/vercel-audit/raw.env (saída de `vercel env pull`) e produz
# snapshot apenas com: NAME, LENGTH em bytes, PREFIX mascarado (4 chars + ****).
# NUNCA escreve valor completo.

IN="${1:-/tmp/vercel-audit/raw.env}"
OUT="${2:-docs/ops/vercel-envs-snapshot.txt}"

{
  echo "# Vercel Envs Snapshot (production) — $(date -u +%FT%TZ)"
  echo "# Format: NAME | LEN_BYTES | MASKED_PREFIX | NOTES"
  echo "# Generated by sanitize-vercel-env.sh (Gabriel local). NEVER contains full secret."
  echo ""
  # Parse .env format: NAME="value" ou NAME=value
  grep -E '^[A-Z_][A-Z0-9_]*=' "$IN" | while IFS='=' read -r name rest; do
    # Remove aspas externas se existirem
    val=$(printf '%s' "$rest" | sed 's/^"\(.*\)"$/\1/')
    len=$(printf '%s' "$val" | wc -c | tr -d ' ')
    prefix=$(printf '%s' "$val" | head -c 4)
    last_byte=$(printf '%s' "$val" | tail -c 1 | od -An -c | tr -d ' ')
    note="ok"
    case "$last_byte" in
      *\\n*|*\\r*) note="TRAILING_NEWLINE_DETECTED" ;;
    esac
    if [ "$((len % 2))" = "1" ]; then
      case "$name" in
        *SECRET*|*KEY*) note="${note}|ODD_LENGTH" ;;
      esac
    fi
    printf '%-32s | %4s | %s**** | %s\n' "$name" "$len" "$prefix" "$note"
  done
} > "$OUT"
chmod 644 "$OUT"
echo "Wrote: $OUT"
```

Resultado esperado em `docs/ops/vercel-envs-snapshot.txt`:
```
CDN_SIGN_SECRET                  |   64 | e0a9**** | ok
CDN_BASE                         |   32 | http**** | ok
JWT_SECRET                       |   64 | 7c1d**** | ok
...
```

**Suspeita** (qualquer linha com):
- `TRAILING_NEWLINE_DETECTED` → re-add obrigatório
- `ODD_LENGTH` em secret hex (esperado par, ex.: `openssl rand -hex 32` = 64 chars) → re-add obrigatório
- `LEN=65` onde esperado `LEN=64` → 99% probabilidade de `\n` trailing

### 3.3 — Re-add com `printf '%s'` (sem newline)

Para CADA env classificado como suspeito:

```sh
# Backup do valor atual (caso precise rollback):
cp /tmp/vercel-audit/raw.env /tmp/vercel-audit/backup-$(date +%s).env
chmod 600 /tmp/vercel-audit/backup-*.env

# Remove + re-add SEM newline:
NAME="CDN_SIGN_SECRET"
VALUE_CLEAN=$(grep "^${NAME}=" /tmp/vercel-audit/raw.env \
              | sed 's/^[^=]*=//' \
              | sed 's/^"\(.*\)"$/\1/' \
              | tr -d '\n\r')

vercel env rm "$NAME" production --yes --token="$VERCEL_TOKEN"
printf '%s' "$VALUE_CLEAN" | vercel env add "$NAME" production --token="$VERCEL_TOKEN"

# IMPORTANTE: `printf '%s'` NÃO adiciona newline (vs echo sem -n).
# `vercel env add` lê de stdin sem extra processing — bytes vão exatos.
```

### 3.4 — Force redeploy (env só aplica em next deploy)

```sh
vercel --prod --token="$VERCEL_TOKEN" --yes
```

### 3.5 — Verificação

Endpoints diagnóstico (`/_diag/cdn`, `/cdn-self-test`) NÃO existem mais no
backend atual (removidos em `cfcb487` ou merge posterior). Para validar,
use o fluxo real:

```sh
# 1. Login → pega JWT
TOKEN=$(curl -s -X POST https://motionpro.vercel.app/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gabriel.kend@gmail.com","password":"<senha>"}' \
  | jq -r .token)

# 2. Sign um asset conhecido
SIGN=$(curl -s -X POST https://motionpro.vercel.app/v1/assets/sign \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"asset_id":"<ASSET_UUID>","fingerprint":"<FP_REGISTRADO>"}')

URL=$(echo "$SIGN" | jq -r .url)
echo "Generated URL: $URL"

# 3. Curl direto no Worker — esperado HTTP 200 OK
curl -sI "$URL" | head -1
# → HTTP/2 200  ✅ env limpo
# → HTTP/2 401  ❌ ainda há mismatch (re-checar Worker secret também — ver doc cloudflare-worker-double-check.md)
```

### 3.6 — Acceptance Criteria

- [ ] `docs/ops/vercel-envs-snapshot.txt` commitado, todas linhas com `notes=ok`
- [ ] Nenhuma linha mostra `TRAILING_NEWLINE_DETECTED`
- [ ] `CDN_SIGN_SECRET` LEN = 64 (assumindo `openssl rand -hex 32`)
- [ ] Curl em URL assinada retorna 200 do Worker
- [ ] Plugin Premiere consegue baixar `.mogrt` sem erro `invalid_signature`

## 4. Rollback Procedure

Se algo quebrar pós-sanitização:

```sh
# Restaura do backup capturado em 3.3
BACKUP=/tmp/vercel-audit/backup-<TIMESTAMP>.env
NAME="CDN_SIGN_SECRET"
OLD_VALUE=$(grep "^${NAME}=" "$BACKUP" | sed 's/^[^=]*=//' | sed 's/^"\(.*\)"$/\1/')

vercel env rm "$NAME" production --yes --token="$VERCEL_TOKEN"
printf '%s' "$OLD_VALUE" | vercel env add "$NAME" production --token="$VERCEL_TOKEN"
vercel --prod --token="$VERCEL_TOKEN" --yes
```

Nota: o backup `.env` preserva o valor *com* `\n` se este estava presente
quando feito o `vercel env pull` (formato `.env` faz quoting padrão).
Re-adicionar com `printf '%s'` strip-a o `\n` final se passou por shell
substitution.

## 5. Por que NÃO manter `.trim()` defensivo no código

1. **Esconde bug de provisionamento** — bug volta na próxima rotação se o
   .trim() for removido por refactor sem ninguém perceber
2. **Performance** — chamada extra a cada `signCdnUrl()` (~6M/dia em prod)
3. **Inconsistência** — `.trim()` em algumas leituras, outras não
   (já tivemos isso em `admin.js` vs `assets.js`)
4. **Workers Cloudflare** não sofrem do mesmo bug (`wrangler secret put`
   via CLI nunca anexa `\n`) — então manter `.trim()` só no backend
   mascara que o problema é no provisionamento Vercel

## 6. Gated Branch — Remoção/Confirmação Final

Branch local `kappa/remove-defensive-trim` (commit `κ:` único) é o
guard-rail. Estado real auditado por κ em 2026-05-23: **o `.trim()` em
`signCdnUrl` JÁ NÃO EXISTE no `main`** (linha `assets.js:12` lê
`process.env.CDN_SIGN_SECRET` direto). A branch documenta o estado
limpo desejado.

Merge gated em:

- [ ] Item 3.6 (acceptance criteria) 100% verde
- [ ] Snapshot commitado em `docs/ops/vercel-envs-snapshot.txt`
- [ ] Re-deploy aplicado em prod há >24h sem regressão
