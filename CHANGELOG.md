# Motion Suite — Changelog

Toda mudança notável dos 3 plugins (Motion Titles, Motion Legendas, Motion IA) e do backend SaaS.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/). Versionamento por plugin (Titles 2.0.0, Legendas 3.1.0, IA 4.0.0).

---

## v2.1 · Motion IA Close — Sprint MEGA Onda 5 (2026-05-23)

### Motion IA (plugin-ia/) v4.0.0
- **ε** Auth + UI paridade visual (purple accent `#8b5cf6`, reauthbar sticky sem logout automático, MvAuth shim, sidebar 52px, config drawer, 4 ícones CEP)
- **ζ** License gate + 15min heartbeat + 4-dot status bar (espelhado de Legendas, 30d offline grace, paywall Stripe overlay)
- **η** SSE bridge Next.js localhost:3333 + funções `MIA_*` ES3 no `host.jsx` (`getActiveSequence`, `insertClipAtCti`, `cutAtCti`, `addTextOverlay`, `exportPreview`) + `utils.jsx`, port DevTools 8092
- **θ** Inno Setup installer protegido (LZMA2 ultra, JS obfuscado profile=balanced, AppId GUID único `MIA0000000001`, auto-close Premiere, CEP PlayerDebugMode HKCU CSXS.9–12, task opcional runPremiere, UninstallDelete preserva cache Whisper)
  - Artefato: `installers/innosetup/output/MotionPro-IA-4.0.0-Setup.exe` (3.27 MB)
  - SHA256: `9b7620d5b73fa759e26b9e865de22bc06a4abab95f847be89b154dbb28ee37fe`
  - Build script: `tools/build-ia-installer.ps1` (stage → obfuscate → ISCC → verify)
  - Excludes: `node_modules/`, `.git/`, `*.log`, `models/*.bin`, `*.bak`, `tests/`, `docs/`, `test-results/`

### Backend
- **κ** `docs/ops/*` env sanitization playbook (Vercel + Cloudflare Worker test matrix)

### Tests
- **ι** `tests/e2e/` Playwright harness (stub-ready + cred-ready), 4 specs, 10 testes

### Onda 1 preservations confirmadas
- Manifest `plugin-ia/CSXS/manifest.xml` **SEM ScriptPath** (causa error 27 PlugPlug)
- bundleId `com.motionpro.ia` + HostList `[14.0,99.9]`
- `host.jsx` ES3 fixes Onda 1 intactos

---

## v2.0 · Smoke Release (2026-05-22)

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
