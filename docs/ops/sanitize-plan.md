# Motion Suite — Env Sanitization Plan (Index)

> Coordenado por: Agente κ · DevSwarm Sprint MEGA · Motion Suite Close v2.0
> Branch: `kappa/docs-ops-cleanup-plan`
> Branch gated: `kappa/remove-defensive-trim` (NÃO mergear até checklist completo)
> Data: 2026-05-23

## Contexto

Issue histórica do commit `d42795f`:
- Env vars no Vercel (`CDN_SIGN_SECRET`, `CDN_BASE`) coladas via
  dashboard receberam `\n` trailing
- Backend computava HMAC com `\n`, Worker tinha secret sem `\n`
- Worker retornava `401 invalid_signature` em 100% dos downloads
- Workaround temporário: `.trim()` defensivo no backend (commit `d42795f`)
- Cleanup parcial: endpoint diag removido (commit `cfcb487`)

**Estado atual auditado** (κ, 2026-05-23):
- `backend/src/routes/assets.js:12` — lê `process.env.CDN_SIGN_SECRET` **direto**, sem `.trim()`
- `backend/src/routes/admin.js` — não contém rota `cdn-self-test` ou `_diag/cdn`
- O `.trim()` defensivo já foi removido em algum merge anterior (não há
  commit específico identificado, mas o diff vs `d42795f` confirma)

→ Significa que **se** o env tiver `\n` trailing AGORA, o sistema está
quebrado. Pré-requisito de operação: garantir env limpos.

## Documentos

| Arquivo                                              | Responsável | Status |
|------------------------------------------------------|-------------|--------|
| [`vercel-env-cleanup.md`](./vercel-env-cleanup.md)   | Gabriel     | Playbook pronto |
| [`cloudflare-worker-double-check.md`](./cloudflare-worker-double-check.md) | Gabriel | Playbook pronto |
| `vercel-envs-snapshot.txt`                           | Gabriel     | **Pendente** (gerar via 3.2 do doc Vercel) |
| `cloudflare-secrets-snapshot.txt`                    | Gabriel     | **Pendente** (gerar via 3.2 do doc Cloudflare) |

## Ordem de execução

1. **Vercel cleanup** (`vercel-env-cleanup.md`)
   - Dump bruto (3.1)
   - Sanitização → snapshot commitável (3.2)
   - Re-add envs suspeitos sem newline (3.3)
   - Force redeploy (3.4)
   - Validação funcional (3.5)
2. **Cloudflare double-check** (`cloudflare-worker-double-check.md`)
   - Dump snapshot (3.2)
   - Test matrix 3-paths (3.3)
   - Re-set se mismatch (3.4) + re-validar
3. **Commit snapshots** sanitizados em `docs/ops/`
4. **Merge gated** da branch `kappa/remove-defensive-trim`
   (no-op confirmação de que estado limpo é o desejado)

## Acceptance Criteria (Gabriel valida + assina)

### Vercel
- [ ] `docs/ops/vercel-envs-snapshot.txt` commitado
- [ ] Nenhuma linha mostra `TRAILING_NEWLINE_DETECTED`
- [ ] Nenhuma linha mostra `ODD_LENGTH` em secret hex
- [ ] `CDN_SIGN_SECRET` LEN = 64 (assumindo `openssl rand -hex 32`)
- [ ] `JWT_SECRET`, `LICENSE_SECRET`, `MV_JWT_SECRET` com LEN par
- [ ] `STRIPE_WEBHOOK_SECRET` começa com `whsec_` (não `\nwhsec_`)
- [ ] Redeploy aplicado em produção

### Cloudflare
- [ ] `docs/ops/cloudflare-secrets-snapshot.txt` commitado
- [ ] Test matrix 3.3 do doc Cloudflare = 3/3 PASS
- [ ] `wrangler deploy` aplicado (se houve re-set do secret)

### End-to-end
- [ ] Login no Premiere plugin → catálogo carrega
- [ ] Download de `.mogrt` real funciona (200 do Worker)
- [ ] Heartbeat license retorna 200
- [ ] Webhook Stripe processa charge.succeeded sem erro de assinatura

### Code cleanup
- [ ] Branch `kappa/remove-defensive-trim` mergeada em `main`
- [ ] CI/build verde pós-merge
- [ ] Plugin re-empacotado e instalado funciona ponta-a-ponta

## Sign-off

**Gabriel**: [ ] Verifiquei todos os itens acima. Sistema operacional. Data: __________

## Histórico de commits relacionados

| SHA       | Data       | Descrição                                          |
|-----------|------------|----------------------------------------------------|
| `032076c` | 2026-05-22 | feat(admin): /v1/admin/cdn-self-test (diagnose)    |
| `fd5e7a0` | 2026-05-22 | diag: endpoint /v1/admin/_diag/cdn público temp    |
| `d42795f` | 2026-05-22 | fix(cdn): `.trim()` em CDN_SIGN_SECRET + CDN_BASE  |
| `cfcb487` | 2026-05-22 | cleanup: remove endpoint /_diag/cdn público        |
| (merge?)  | ?          | `.trim()` defensivo desapareceu da main (não identificado em git log) |
| `κ`       | 2026-05-23 | docs/ops/* (esta branch)                           |
| `κ`       | 2026-05-23 | remove-defensive-trim (no-op confirmation)         |

## Anti-patterns documentados

- **NÃO** colar secrets via dashboard Vercel (use `vercel env add` via CLI com `printf '%s' |`)
- **NÃO** adicionar `.trim()` em código pra "consertar" — esconde bug de provisionamento
- **NÃO** commitar `vercel-envs-snapshot.txt` antes de sanitizar (poderia vazar metadados sensíveis)
- **NÃO** commitar valores reais — só `LEN`, `MASKED_PREFIX (4 chars + ****)` e `NOTES`
- **NÃO** rotacionar `LICENSE_SECRET` sem aviso prévio aos usuários (invalida JWTs ativos)
