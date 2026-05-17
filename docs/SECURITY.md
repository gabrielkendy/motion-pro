# MotionVault — Modelo de ameaça e proteções

## Atacantes e cenários

| Atacante                     | Objetivo                              | Mitigação chave |
|------------------------------|---------------------------------------|-----------------|
| Usuário casual               | Compartilhar login                    | Device limit (2) + heartbeat |
| Pirata 1                     | Patchar JS para sempre retornar `true` | JWT verificado localmente — sem JWT válido, catálogo nem carrega |
| Pirata 2                     | Forjar JWT no servidor falso          | Chave pública embarcada — assinatura quebra |
| Pirata 3                     | Roubar `.mogrt` direto do disco       | Modo CDN: arquivos não estão no disco; URLs expiram em 60min e amarradas ao fp |
| Pirata 4                     | Engenharia reversa do bundle JS       | `obfuscate.js` (string array RC4 + control flow flattening + self-defending) |
| Pirata 5                     | Replicar o fingerprint                | Heartbeat detecta uso simultâneo do mesmo fp em IPs muito diferentes |
| Pessoa que pediu refund      | Continuar usando após reembolso       | Webhook `customer.subscription.deleted` revoga; heartbeat em até 6h trava |
| Funcionário desonesto        | Vazar `LICENSE_SECRET`                | Em produção use RS256 + KMS; em dev use secret rotation a cada 30d |

## O que NÃO é proteção (não confunda)

- O `.reg` antigo (`PlayerDebugMode=1`) **não protege nada**, só permite
  carregar a extensão sem assinatura — mantido só pra dev.
- Esconder o `catalog.json` "in‑extension" não impede ninguém de copiá-lo —
  mas como o catálogo só lista o que existe (e o JWT é quem abre as portas),
  tudo bem.
- DRM perfeito não existe. O objetivo é tornar a pirataria **mais cara que
  $19/mês** — e o stack atual cumpre isso bem.

## Boas práticas para você operar

1. **Nunca commitar `.env`** — `.gitignore` deve incluir `backend/.env`.
2. **Rotacionar `LICENSE_SECRET`** a cada 6 meses (invalida licenças
   antigas — comunique antes; users só precisam logar novamente).
3. **Logs de auditoria** — `license_audit` cresce rápido; particione por mês
   ou jogue para um bucket S3 frio depois de 90 dias.
4. **Monitorar fingerprints com >10 IPs distintos por semana** — gatilho de
   investigação manual ou bloqueio automático.
5. **Backup do Postgres** diário (Postgres → S3 com `pg_dump`); recuperar
   licenças é o que mais dói num desastre.

## Conformidade

- **LGPD/GDPR** — só guardamos: email (consentido), password hash (bcrypt),
  fingerprint (hash, irreversível), device fingerprint+timestamps,
  stripe_customer_id, log de licenças (90 dias). Sem dados sensíveis.
- **PCI** — todo cartão passa pelo Stripe; nunca tocamos nos dados.
- **Termos de uso** — exija aceite no signup (campo a adicionar antes do
  launch).
