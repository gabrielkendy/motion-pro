# Motion Suite — Changelog

Toda mudança notável dos 3 plugins (Motion Titles, Motion Legendas, Motion IA) e do backend SaaS.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/). Versionamento por plugin (Titles 2.0.0, Legendas 3.1.0, IA 4.0.0).

---

## [2026-05-22] — Smoke Release v2.0

### Backend (Vercel)
- **fix(cdn)** — `.trim()` defensivo em `CDN_SIGN_SECRET` + `CDN_BASE` pra eliminar `\n` trailing que vinha do paste no Vercel dashboard. Bug causava `401 invalid_signature` no Worker Cloudflare em todas as downloads de template.
- **feat(health)** — `/v1/health` agora existe (estava só `/health`). Plugin status bar 4 dots consulta esse endpoint.
- **feat(oauth)** — login OAuth Google grava entry em `license_audit` (action=`oauth_login`).
- **fix(rate-limit)** — `/v1/oauth/magic/start` agora tem rate limit (5/15min) pra anti-spam de email.
- **feat(assets)** — `ensureDeviceRegistered()` auto-cria device em `/v1/assets/sign` se não existir. Desbloqueia users liberados via SQL sem passar pelo fluxo `/v1/license/issue`.
- **feat(assets)** — `isEntitledForProduct()` cobre bundles canônicos (`duo`, `suite`, `bundle_all`, `MTS-*`) via `expandProducts()`.

### Motion Legendas (3.1.0 → 3.2.0 unreleased)
- **feat(ux)** — **Sidebar lateral** (tabs foram de cima pro lado esquerdo, 52px). Libera ~120px horizontais pro grid de templates. Em telas <400px sidebar encolhe pra 40px (só ícones).
- **feat(ux)** — Layout compactado: header 50→34px, banners menores, ~70px liberados verticalmente pro grid.
- **fix(ux)** — Removido botão "Captions Premiere" da Importar (feature não confiável, gerava expectativa frustrada).
- **feat(ux)** — SFX "Em todas legendas" agora tem warning + bloqueio: >80 clips = confirm() · >200 clips = bloqueia + sugere trecho menor. Resolve trava de Premiere em vídeos longos.
- **feat(ux)** — Fontes: re-check 3s pós-instalação + mensagem "Reinicie o Premiere" se ainda faltar (antes escondia banner cegamente).
- **fix(asset-loader)** — Token unificado `mv_session` (era `mpl_session_token` legacy). Auto-gera fingerprint persistente em `mtl_device_fp` se ausente.
- **feat(asset-loader)** — Log verbose em DevTools console (URL assinada + body de erro do Worker) pra diagnose.
- **feat(error-ux)** — Mensagens user-friendly em pt-BR mapeadas pra `not_logged_in` / `auth_expired` / `subscription_inactive` / `device_not_authorized` / etc.
- **feat(reconnect)** — Banner "Reconectar" aparece automaticamente em sessão expirada (não desloga).
- **feat(scroll)** — Scrollbar custom (WebKit + Firefox) no Config + grid + tab-panels.

### Motion Titles (1.0.4 → 2.0.0)
- **fix(asset-loader)** — Mesmo fix de token unificado `mv_session` (era `mp_license_token` legacy). Resolveu o mesmo `not_logged_in` em templates via CDN.
- **fix(manifest)** — `ExtensionBundleVersion` bumpado 1.0.4 → 2.0.0. Menu/BundleName "MotionVault" → "Motion Titles".
- **feat(ux)** — Botão Config destacado (`.btn-config-pill` gradiente azul + label "Licença") em vez de iconbtn anônimo.
- **feat(ux)** — Scrollbar custom no drawer Config + grid.
- **feat(error-ux)** — Mapping de `not_logged_in` + trigger `showReauthBar()`.
- **fix(heartbeat)** — Comentário desatualizado removido (Titles e Legendas ambos usam 15min sticky 30d grace).

### Instaladores
- **feat** — `.exe` Inno Setup 6 com JS obfuscado (proteção de código). Auto-close Premiere, registry PlayerDebugMode, cache CEP clear.
- `MotionPro-Titles-2.0.0-Setup.exe` (35.94 MB)
- `MotionPro-Legendas-2.0.0-Setup.exe` (19.88 MB)

---

## Histórico anterior

Antes desta versão consolidada, mudanças foram trackeadas via git commits:
```
git log --oneline --since="2026-05-15"
```

Próximos releases vão adotar Semantic Release no CI.
