# Cloudflare Worker — Double-Check do CDN_SIGN_SECRET

> Status: PLAYBOOK (Gabriel executa). Agente κ NÃO tem auth Wrangler.

## 1. Goal

Confirmar que `CDN_SIGN_SECRET` no Worker Cloudflare (`motionpro-cdn`)
é **byte-por-byte idêntico** ao `CDN_SIGN_SECRET` no Vercel backend
após a sanitização descrita em `vercel-env-cleanup.md`.

Se houver mismatch (mesmo 1 byte), o Worker retorna `401 invalid_signature`
em todo download.

## 2. Algoritmo HMAC (referência)

Backend (`backend/src/routes/assets.js:9-15`):
```js
const data = `${key}\n${fingerprint}\n${expires}`;
const sig = crypto.createHmac("sha256", process.env.CDN_SIGN_SECRET)
                  .update(data)
                  .digest("base64url");
```

Worker (`cloudflare/worker/src/index.js:38-52, 127`):
```js
const data = `${key}\n${fp}\n${expNum}`;
const ok = await hmacVerify(env.CDN_SIGN_SECRET, data, sig);
// hmacVerify usa Web Crypto subtle.importKey + subtle.verify
// algoritmo: HMAC-SHA-256, formato sig: base64url
```

Ambos canonical → único ponto de falha é o **secret**.

## 3. Playbook

### 3.1 — Dump Worker secrets (não-commitável)

```sh
cd cloudflare/worker
wrangler secret list > /tmp/wrangler-secrets-raw.txt
# Output esperado:
# [
#   { "name": "CDN_SIGN_SECRET", "type": "secret_text" }
# ]
```

Wrangler NÃO expõe o valor (intentional — é write-only). Não há como
ler o secret atual. Por isso o teste de validação é **funcional**, não
inspecional (ver 3.3).

### 3.2 — Snapshot commitável

Script `sanitize-cloudflare-secrets.sh` (salvar local, não commitar):

```sh
#!/bin/sh
# Produz lista de secrets do Worker SEM expor valores.
OUT="${1:-docs/ops/cloudflare-secrets-snapshot.txt}"
{
  echo "# Cloudflare Worker Secrets Snapshot — $(date -u +%FT%TZ)"
  echo "# Worker: motionpro-cdn"
  echo "# Format: NAME | TYPE | NOTES"
  echo "# Wrangler nunca expõe valor — só metadados."
  echo ""
  cd cloudflare/worker
  wrangler secret list | jq -r '.[] | "\(.name) | \(.type) | provisioned"' \
    || echo "ERROR: wrangler secret list failed"
} > "$OUT"
chmod 644 "$OUT"
echo "Wrote: $OUT"
```

Resultado esperado em `docs/ops/cloudflare-secrets-snapshot.txt`:
```
CDN_SIGN_SECRET | secret_text | provisioned
```

### 3.3 — Teste funcional (assina local, compara contra Worker)

Script `cdn-signature-roundtrip.sh` (salvar local, não commitar — usa secret):

```sh
#!/bin/sh
# Reproduz EXATAMENTE o que signCdnUrl() faz e bate contra o Worker.
# Requer: openssl, curl, base64 (com -w0 ou bsd-style)

SECRET="$1"           # paste aqui o CDN_SIGN_SECRET atual (do Vercel após sanitização)
WORKER_BASE="${2:-https://cdn.kendyproducoes.com.br}"

if [ -z "$SECRET" ]; then
  echo "Usage: $0 <CDN_SIGN_SECRET> [worker_base]" >&2
  exit 2
fi

# Test matrix — 3 paths conhecidos
TESTS="
mogrts/test-short.mogrt|fp-test-123
mogrts/path com espaco.mogrt|fp-test-456
mogrts/caminho-acentuado-çãüé.mogrt|fp-test-789
"

EXPIRES=$(($(date +%s) + 300))
PASS=0
FAIL=0

echo "$TESTS" | grep -v '^$' | while IFS='|' read key fp; do
  data="${key}
${fp}
${EXPIRES}"
  # HMAC-SHA256 → base64 → base64url (replace + → -, / → _, strip =)
  sig=$(printf '%s' "$data" | openssl dgst -sha256 -hmac "$SECRET" -binary \
        | base64 | tr '+/' '-_' | tr -d '=')
  # URL-encode key (substitui espaços por %20 etc.)
  encoded_key=$(printf '%s' "$key" | jq -sRr @uri)
  encoded_fp=$(printf '%s' "$fp" | jq -sRr @uri)
  url="${WORKER_BASE}/${encoded_key}?fp=${encoded_fp}&e=${EXPIRES}&s=${sig}"
  status=$(curl -sI "$url" | awk 'NR==1 {print $2}')
  if [ "$status" = "200" ] || [ "$status" = "404" ]; then
    # 404 = HMAC ok, arquivo não existe no R2 (esperado se key fake) → secret OK
    echo "✅ PASS: key='${key}' fp='${fp}' status=${status}"
    PASS=$((PASS+1))
  else
    echo "❌ FAIL: key='${key}' fp='${fp}' status=${status} (esperado 200 ou 404)"
    FAIL=$((FAIL+1))
  fi
done

echo "---"
echo "Resultado: $PASS pass / $FAIL fail"
[ "$FAIL" = "0" ] && exit 0 || exit 1
```

**Interpretação dos status codes** (do Worker `index.js`):
- `200` → HMAC válido + arquivo existe no R2
- `404` → HMAC válido, arquivo não existe (test paths fake — esperado)
- `401 expired` → relógio dessincronizado (raro em Vercel/CF)
- `401 invalid_signature` → **SECRET MISMATCH** → próximo passo 3.4
- `401 missing_signature_params` → bug no script (sig vazio)

### 3.4 — Se Mismatch: Re-set Worker Secret

```sh
cd cloudflare/worker

# Backup mental: anota qual valor está no Vercel (após sanitização 3.3 do
# doc vercel-env-cleanup.md). Esse é o "source of truth".
SECRET_FROM_VERCEL="<cole o valor aqui — copy direto do output `vercel env pull` pós-sanitização>"

# Re-set sem newline (wrangler já lê stdin sem extra processing, mas
# usar printf garante):
printf '%s' "$SECRET_FROM_VERCEL" | wrangler secret put CDN_SIGN_SECRET

# Deploy (re-publica config + bindings):
wrangler deploy
```

**Atenção**: `wrangler secret put` SEM `printf '%s' | ` lê stdin
interativamente — se você colar com Enter no final, vira `\n` trailing.
Use sempre o pipe.

### 3.5 — Re-validação

Repete 3.3 — todos os 3 testes devem virar PASS (200 ou 404).

## 4. Test Matrix (resumo)

| Path                                         | Descrição                  | Esperado |
|----------------------------------------------|----------------------------|----------|
| `mogrts/test-short.mogrt`                    | ASCII curto                | 200/404 |
| `mogrts/path com espaco.mogrt`               | espaços (URL-encoded)      | 200/404 |
| `mogrts/caminho-acentuado-çãüé.mogrt`        | unicode UTF-8              | 200/404 |

Qualquer `401 invalid_signature` em qualquer das 3 = secret mismatch.

## 5. Acceptance Criteria

- [ ] `docs/ops/cloudflare-secrets-snapshot.txt` commitado com
      `CDN_SIGN_SECRET | secret_text | provisioned`
- [ ] Test matrix 3.3 retorna 3/3 PASS
- [ ] Curl real em URL gerada pelo `/v1/assets/sign` retorna 200
- [ ] Plugin Premiere baixa `.mogrt` sem `invalid_signature`

## 6. Notas operacionais

- `wrangler secret list` não funciona se o usuário não tem permissão de
  `secrets:read` no workspace. Verifique com `wrangler whoami`.
- Cloudflare faz cache do Worker em edge — após `wrangler deploy` espere
  ~30s antes de testar (propagação global).
- Em caso de dúvida, `wrangler tail` mostra logs em tempo real:
  ```sh
  wrangler tail --format=pretty
  ```
  Permite ver se o `invalid_signature` está vindo da validação HMAC ou
  de outro caminho do código.
