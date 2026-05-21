# Motion IA · Briefing Operacional
**Data:** 2026-05-21 · **Versão atual:** v3.1.0 · **Status:** 🟡 host.jsx travado

> Documento focado em **Motion IA** (3º plugin da família). Para visão geral
> dos 3 plugins, leia `HANDOFF.md`. Este aqui é o "war room" do Motion IA:
> tudo que aconteceu na sessão, todos os erros e fixes, o que falta.

---

## 📊 ESTADO ATUAL — diagnóstico técnico real (capturado no plugin rodando)

```
═══ MOTION IA · DIAGNÓSTICO ═══
BUILD: 3.0.0 (versão exibida — código real é 3.1.0)
Premiere: 26.2.2 · Chrome/99.0.4844.84 · AdobeCEP/12.0.1

── CSInterface ──
✓ getSystemPath('extension'): C:/Users/Gabriel/AppData/Roaming/Adobe/CEP/extensions/com.motionpro.ia

── BinRunner ──
✓ extPath: C:/Users/.../com.motionpro.ia
✓ bin_dir: C:\Users\...\bin\win
✓ platform: win32
✓ ffmpeg detectado
✓ ffprobe detectado
✓ whisper-cli detectado
✓ yt-dlp detectado
✓ aria2c detectado

── HostBridge (host.jsx) ──
✗ isReady: false                  ← BLOQUEADOR
✗ ping() ERR: host.jsx não carregou

── License ──
✓ Status: active
✓ Tier: lifetime
✓ Products: ["ia"]
✓ Chave: MIA-LIFE...2A01 (gerada via /v1/admin/license-keys/generate)
✓ Devices: 1/5

── User Meta ──
✗ is_admin_verified: false        ← BUG (deveria ser true)
```

**Tradução:** UI, license, paths, binários — tudo funciona. **Só ExtendScript trava.** Sem ExtendScript não roda NADA que precisa mexer no Premiere.

---

## 🔴 BLOQUEADOR ATIVO #1 — host.jsx não carrega

### Sintoma exato
- Clica em qualquer feature → "❌ ExtendScript falhou (verifique se host.jsx carregou)"
- Chat IA → Claude tenta `get_context`, `list_clips`, etc → tudo falha
- Status bar do plugin: 🟠 Premiere (laranja, não verde)

### O que já foi tentado e DESCARTADO
1. ✅ Sintaxe ES3 do host.jsx — validada (sem const/let/arrow/class)
2. ✅ Path da extension via `cs.getSystemPath` — confirmado correto após fix CSInterface
3. ✅ Bootstrap auto + retry no `host-bridge.js` — implementado
4. ✅ Manifest tem `<ScriptPath>./jsx/host.jsx</ScriptPath>` — presente
5. ✅ Permissões executable do .exe — chmod +x já está
6. ✅ Plugin não está em quarentena (Windows Unblock) — INSTALAR.bat faz isso
7. ✅ License key ativada (qualquer tier desbloqueado) — confirmado lifetime

### Hipóteses NÃO testadas
| # | Hipótese | Como confirmar |
|---|---|---|
| **H1** | **Premiere sem projeto aberto** — `app.project` é null, scripts podem travar silenciosos | Botão 🩺 Diagnóstico → ver "Test 3 (app.project)" — se retornar `no_project`, é isso |
| **H2** | `$.evalFile(File('C:/...'))` falha com forward slashes em Windows | Trocar pra `File("C:\\Users\\...")` (backslash escapado) |
| **H3** | `MotionProIA` registra mas sem `ping` (host.jsx tem erro de runtime na inicialização) | Test 4 retorna `evalfile=undefined\|global=false\|local=false` |
| **H4** | ScriptPath do manifest carrega antes do CEP estar pronto — race com bootstrap manual | Remover ScriptPath do manifest e depender só do bootstrap manual |
| **H5** | `$.evalFile` precisa do path com encoding específico (UTF-8 BOM?) | Salvar host.jsx com BOM ou ANSI |
| **H6** | host.jsx tem caractere invisível ou linha em branco que ExtendScript não engole | Comparar host.jsx do plugin (que tá no APPDATA) com a versão do git via diff |

### Próximo passo de debug (FAZER PRIMEIRO)
```
1. Abrir Premiere
2. File → New → Project (criar projeto vazio QUALQUER)
3. Importar 1 vídeo qualquer pra timeline
4. Janela → Extensões → Motion IA
5. Login (se não estiver)
6. ⚙ Licença & Config → 🩺 Diagnóstico técnico
7. Tirar SCREENSHOT do output completo (Test 1 a Test 5)
8. Mandar pro próximo agente
```

**O Test 4 vai revelar exatamente o que tá quebrado:**
- `file_not_found:...` → path está errado no JS
- `exception:Object expected` → host.jsx tem erro de runtime
- `evalfile=undefined|global=false` → host.jsx carrega mas não registra MotionProIA
- `evalfile=undefined|global=true` → ✅ tudo OK!

### Arquivos envolvidos
- `plugin-ia/js/host-bridge.js` (bootstrap logic — linhas 16-50)
- `plugin-ia/jsx/host.jsx` (1186 linhas · namespace `$.global.MotionProIA`)
- `plugin-ia/CSXS/manifest.xml` (ScriptPath line)
- `plugin-ia/js/lib/CSInterface.js` (URI → path conversion — linhas 21-37)

### Tentativas adicionais sugeridas
```js
// 1) Forçar evalFile sem File wrapper
cs.evalScript("$.evalFile('" + jsxPath + "')", cb);

// 2) Carregar host.jsx via fs.readFileSync + evalScript do código bruto
const fs = require("fs");
const src = fs.readFileSync(jsxPath, "utf8");
cs.evalScript(src, cb);

// 3) Verificar $.fileName após evalFile (mostra último arquivo carregado)
cs.evalScript("$.evalFile('" + jsxPath + "'); $.fileName", cb);
```

---

## 🟡 BLOQUEADOR #2 — is_admin_verified=false

### Sintoma
Após login com `gabriel.kend@gmail.com`, o diagnóstico mostra:
```
── User Meta ──
{ "is_admin_verified": false }
```

Significa que `/v1/me` retornou `is_admin: false` pra essa conta. Mas o gabriel é o owner, deveria ser admin.

### Causa
A coluna `users.is_admin` no Neon não está marcada como true pra essa conta.

### Fix
```sql
-- Conectar no Neon (DATABASE_URL no Vercel) e rodar:
UPDATE users
SET is_admin = true
WHERE email = 'gabriel.kend@gmail.com';
```

**Como rodar sem precisar de psql instalado:**
```bash
# Via Neon Console: dashboard.neon.tech → projeto → SQL Editor → cola e run
# OU via tools com env DATABASE_URL setado:
node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
c.connect().then(() => c.query(\"UPDATE users SET is_admin=true WHERE email='gabriel.kend@gmail.com' RETURNING email,is_admin\"))
  .then(r => { console.log(r.rows); c.end(); });
"
```

### Após o fix
1. Plugin → ⚙ Licença & Config → 🩺 Diagnóstico → deve mostrar `is_admin_verified: true`
2. Sidebar com 🔒 desbloqueia em todas as 13 features
3. Tier no rodapé continua LIFETIME (já estava OK via license key)

---

## ✅ FIXES JÁ APLICADOS NESSA SESSÃO

Lista honesta do que CORRIGIMOS (não está mais quebrado):

| # | Bug | Causa | Solução | Validado |
|---|---|---|---|---|
| 1 | Tela preta no boot do plugin | Tour disparava antes do login, backdrop 85% opaco cobria tudo | `auth:ready` event listener `{once:true}` + backdrop pra 55% + `pointer-events:none` | ✅ user confirmou |
| 2 | Botão "Entrar" não respondia | `$("g-phone").value` em elemento null → TypeError silencioso | Fallbacks `($("g-phone") && $("g-phone").value \|\| "")` | ✅ user logou |
| 3 | Tour "Concluir" não fechava | `cleanup()` setava `card = null` mas não removia do DOM | `card.remove()` + querySelector cleanup defensivo | ✅ corrigido |
| 4 | Cards do tour empilhando (3 visíveis) | Múltiplos `start()` rodando paralelos | Guard `isRunning` + `{ once: true }` no auth:ready | ✅ corrigido |
| 5 | "ffmpeg.exe não instalado" mesmo presente | CSInterface stub retornava `file:///C:/...` URI inválida pro Node fs | Stub converte URI → path local OS-aware | ✅ Diagnóstico confirma ✓ ffmpeg detectado |
| 6 | F12 não abre DevTools no painel | CEP precisa de `.debug` + porta externa | Criado `.debug` na porta 8089 — acessar via `localhost:8089` no Chrome | ✅ disponível |
| 7 | License flow E2E | n/a | n/a | ✅ chave MIA-LIFE-XXXX ativada, status ACTIVE |
| 8 | Tier bypass via localStorage | Qualquer user editava `mia_user_meta` no DevTools pra virar lifetime | Removido fallback inseguro; `is_admin_verified` agora vem do JWT/backend | ✅ seguro |
| 9 | Classes BEM divergentes (CSS×JS) | `.trans-item.selected` vs `.is-selected`, `.onboard-card__foot` vs `.onboard-card__actions`, etc | Sincronizado JS↔CSS + alias adicionado | ✅ corrigido |
| 10 | Sidebar sem keyboard nav (a11y) | Items eram `<div>` sem role/tabindex | `role="button"` + `tabindex="0"` + handler Enter/Space + `aria-disabled` em locked | ✅ corrigido |
| 11 | Inputs sem `<label for>` | Acessibilidade | Todos os inputs do gate têm `for=` agora | ✅ corrigido |
| 12 | Setinterval auto-validate acumulando | `startAutoValidate` empilhava intervals em reload | `clearInterval` antes de criar novo + `stopAutoValidate()` exportado | ✅ corrigido |
| 13 | `agent.js` loop com `stop_reason === "end_turn"` descartava tool_use | Condição OR incorreta | Confia só em `toolUses.length === 0` | ✅ corrigido |
| 14 | `agent.js` maxIter deixava tool_use órfão | Última assistant turn ficava com `tool_use` sem `tool_result` correspondente | Remove última assistant turn se órfã antes de retornar | ✅ corrigido |
| 15 | `claude-tools.js` parse JSON com primeiro char | Ignorava whitespace/BOM | `.trim()` antes de checar `charAt(0)` | ✅ corrigido |

**Total:** 15 bugs (críticos/altos) corrigidos nesta sessão.

---

## 📋 O QUE FALTA PRA FINALIZAR (sequência de ataque)

### FASE 1 — Desbloquear o plugin (CRÍTICO)
```
[ ] T1. Capturar diagnóstico técnico com Premiere COM projeto aberto
[ ] T2. Identificar qual hipótese H1-H6 é a causa real do host.jsx
[ ] T3. Aplicar fix correspondente
[ ] T4. UPDATE users SET is_admin=true WHERE email='gabriel.kend@gmail.com'
[ ] T5. Validar que TODAS as 13 features rodam (smoke manual no Premiere)
```

### FASE 2 — Setup externos do usuário (não-código)
```
[ ] T6. Criar Google OAuth client em console.cloud.google.com
[ ] T7. Setar 4 env vars no Vercel (OAUTH_GOOGLE_*)
[ ] T8. Redeploy backend → validar com `node tools/setup-google-oauth.js --check`
[ ] T9. Rodar `node tools/bootstrap-stripe-ia.js` → cria products+prices
[ ] T10. Setar STRIPE_PRICE_IA_YEARLY + STRIPE_PRICE_IA_LIFETIME no Vercel
[ ] T11. Testar checkout end-to-end (compra fake → recebe email com MIA-XXXX)
```

### FASE 3 — Polish que falta pra paridade Phantom
```
[ ] T12. Mac build real (rodar download-bin-motion-ia-mac.sh em mac de verdade,
        validar que INSTALAR.command funciona, gerar ZIP-mac com binários)
[ ] T13. Gravar vídeo demo REAL do plugin (substituir o motionia-demo.mp4
        atual que é gerado via ffmpeg lavfi — fake, sem features reais)
[ ] T14. Dashboard de créditos pro user — backend tem /v1/usage/balance,
        falta UI em ⚙ Licença & Config mostrando consumo + histórico
[ ] T15. Tutorial vídeo por feature (não só tour textual) — 13 vídeos curtos
[ ] T16. Status page público (uptime, modelos Claude/Gemini ativos)
[ ] T17. Pricing page comparativa (Free / Basic / Pro / Lifetime com features
        lado-a-lado) — tier-gating no código já existe
```

### FASE 4 — Hardening (após release)
```
[ ] T18. Migrar OAuth state store de in-memory pra Redis (escalabilidade)
[ ] T19. Implementar mutex no download de Whisper model (paralelo corrompe)
[ ] T20. Retry/rate-limit nos clients Pexels/Pixabay/Giphy
[ ] T21. Migration runner real (tools/migrate.js que aplica em ordem)
[ ] T22. Crash reporter (Sentry-like) pra debug remoto de plugin no cliente
[ ] T23. Auto-updater dentro do plugin (avisa quando sai v3.2)
[ ] T24. Templates de Casper pré-prontos (Vlog 5min / Talking Head Reels / Tutorial)
```

---

## 🛠️ COMANDOS DE DEBUG ÚTEIS

### Verificar estado do plugin sem abrir Premiere
```powershell
# Path do plugin
$DEST = "$env:APPDATA\Adobe\CEP\extensions\com.motionpro.ia"

# Manifest version
Select-String -Path "$DEST\CSXS\manifest.xml" -Pattern 'ExtensionBundleVersion="(.+)"'

# Binários presentes
Get-ChildItem "$DEST\bin\win\" | Format-Table Name, @{Label='Size MB';Expression={[math]::Round($_.Length/1MB,1)}}

# JS files (timestamp = última modificação)
Get-ChildItem "$DEST\js\*.js" | Format-Table Name, LastWriteTime

# host.jsx íntegro?
$jsx = Get-Content "$DEST\jsx\host.jsx" -Raw
"linhas: $((($jsx -split "`n").Length))"
"primeira linha: $(($jsx -split "`n")[0])"
"última linha: $(($jsx -split "`n")[-1])"
```

### Forçar reload do CEP (limpa cache)
```powershell
# Fechar Premiere primeiro!
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Temp\cep_cache\PPRO_*com.motionpro.ia*"
```

### Habilitar DevTools do painel
```powershell
# Já criado em plugin-ia/.debug — só precisa estar copiado pro APPDATA
# Reabre Premiere → painel → abrir Chrome em localhost:8089
```

### Gerar license MIA-XXXX manualmente (admin)
```powershell
$body = @{ email='gabriel.kend@gmail.com'; password='Kendy.123'; fingerprint='dev' } | ConvertTo-Json
$login = Invoke-RestMethod -Method POST -Uri 'https://motionpro.vercel.app/v1/auth/login' -Body $body -ContentType 'application/json'
$tok = $login.session_token
$gen = Invoke-RestMethod -Method POST -Uri 'https://motionpro.vercel.app/v1/admin/license-keys/generate' -Headers @{Authorization="Bearer $tok"} -Body (@{tier='lifetime';products=@('ia');max_devices=5;notes='dev-test'} | ConvertTo-Json) -ContentType 'application/json'
Write-Host "Chave: $($gen.key)" -ForegroundColor Cyan
```

### Re-instalar plugin do zero (último recurso)
```powershell
# 1. Fecha Premiere
# 2. Apaga install
Remove-Item -Recurse -Force "$env:APPDATA\Adobe\CEP\extensions\com.motionpro.ia"
# 3. Apaga cache CEP
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Temp\cep_cache\PPRO_*com.motionpro.ia*"
# 4. Re-instala via ZIP
cd <repo>/installers/zip-manual-ia
.\INSTALAR.bat
# 5. Abre Premiere
```

---

## 🧬 MAPA MENTAL DO CÓDIGO (onde olhar pra cada bug)

```
Sintoma                              → Arquivo culpado provável
──────────────────────────────────────────────────────────────────
Tela escura / UI quebrada            → plugin-ia/css/app.css
Login não funciona                   → plugin-ia/js/auth.js + backend/src/routes/auth.js
Botão clicado nada acontece          → plugin-ia/js/app.js (bindNav) + features.js
Feature retorna "ExtendScript falhou" → plugin-ia/js/host-bridge.js + jsx/host.jsx
Feature retorna "ffmpeg não instalado" → plugin-ia/js/bin-runner.js (extPath)
License não ativa                    → plugin-ia/js/license-client.js + backend/license-keys.js
Tier mostra FREE quando deveria PRO  → plugin-ia/js/features.js (userTier)
Tour bugado                          → plugin-ia/js/onboarding-tour.js
Chat IA não responde                 → plugin-ia/js/agent.js (Claude) ou gemini-client.js
Tool falha em específico             → plugin-ia/js/claude-tools.js (definitions) ou skills.js
Download yt-dlp trava                → plugin-ia/js/bin-runner.js (runStreaming)
Whisper falha                        → plugin-ia/js/skills.js (cortarPausas) + models/
Stock vazio                          → plugin-ia/js/skills.js (fetchPexels/Pixabay/Giphy)
Crop não centraliza                  → plugin-ia/js/face-tracker.js
Casper pula regras                   → plugin-ia/js/skills.js (casper function)
Capítulos não adiciona markers       → plugin-ia/jsx/host.jsx (addMarkersBatch)
Transição não aplica                 → plugin-ia/jsx/host.jsx (applyTransitionsAllCuts)
```

---

## 🎯 CHECKLIST PRÁTICO PRA SEMANA QUE VEM

**Dia 1 — Desbloquear**
- [ ] Capturar diagnóstico com projeto aberto no Premiere
- [ ] Identificar hipótese H1-H6 do host.jsx
- [ ] UPDATE is_admin no Neon
- [ ] Validar 13 features no Premiere real

**Dia 2 — Setup externos**
- [ ] Google OAuth (console.cloud + Vercel env + redeploy)
- [ ] Stripe IA prices (bootstrap-stripe-ia.js + Vercel env)
- [ ] Teste checkout fake → email com MIA-XXXX → ativar no plugin

**Dia 3 — Mac**
- [ ] Acessar Mac (ou VM/CI), clonar repo
- [ ] Rodar download-bin-motion-ia-mac.sh
- [ ] Build ZIP-mac com binários incluídos
- [ ] Validar INSTALAR.command + abrir no Premiere mac

**Dia 4-5 — Polish**
- [ ] Gravar 13 vídeos curtos (1 por feature, 30-60s cada)
- [ ] Dashboard de créditos UI
- [ ] Pricing page comparativa
- [ ] Smoke test E2E completo (compra → ativação → uso real)

---

## ❓ FAQ PRO PRÓXIMO AGENTE

**P: Por onde começar?**
R: Leia `HANDOFF.md` primeiro (visão geral 3 plugins) → depois esse `BRIEFING-MOTION-IA.md` (focado IA) → ataque PRIORIDADE 1 (host.jsx).

**P: O user pode rodar comandos pra você?**
R: Sim. Ele tem PowerShell admin. CEP plugins precisam ser testados num Premiere real (que ele tem). Backend + scripts você roda local no Devswarm.

**P: Devo commitar antes de validar com user?**
R: NÃO. Sempre mostra o diff. User pede pra ver antes de commitar — é regra rígida dele.

**P: Posso criar arquivos .md de status?**
R: NÃO. User não gosta de churn de docs. Esses 2 (HANDOFF + BRIEFING-MOTION-IA) já cobrem tudo.

**P: User quer mais Gemini, menos Claude?**
R: Sim, ele mencionou. Mas isso é POLISH (FASE 3). Antes precisa de host.jsx funcionando.

**P: Que tipo de teste é aceitável sem Premiere?**
R: Sintaxe (node -c file.js), smoke test backend (curl), build do ZIP, deploy de landing/backend, scripts isolados. Tudo que NÃO depende de `cs.evalScript` pode ser testado.

**P: Como passo secrets pro user?**
R: User passa pra você quando você pedir. Não tem secret no repo. `.env.example` é template apenas.

**P: Que branch usar?**
R: `main` por enquanto. Quando começar fixes longos, pode criar `fix/host-jsx` ou `feat/gemini-default`. User merge depois de validar.

**P: Premiere version testada?**
R: 26.2.2 (CEP 12.0.1, Chrome 99 user-agent). Manifest aceita `[14.0,99.9]` então funciona 2020+.

---

## 📞 Contato com o user

- Email: gabriel.kend@gmail.com
- Tem Premiere instalado, PowerShell admin, gh CLI não-auth
- Workspace: `c:\Users\Gabriel\Documents\Motion Bro` (Windows)
- Comunica em PT-BR
- Não gosta de perguntas (`feedback_no_questions`) — manda fazer
- Quando quebra acordo, fica bravo — entrega tudo ou não entrega
- Quando algo dá certo, valida explicitamente — esses sinais são raros, capture

---

**FIM.** Sucesso. Foco no host.jsx primeiro.
