# ✅ Checklist de teste — Motion IA

Tudo em 5 passos. Marque ▢ cada item.

```
─────────────────────────────────────────────────
   BASE · KENDY
   Motion IA · End-to-end test
─────────────────────────────────────────────────
```

---

## Passo 1 — Ativar produto IA no banco (UMA VEZ)

▢ Abra https://console.neon.tech/ → projeto MotionVault → **SQL Editor**
▢ Cole o conteúdo de [`SETUP-PRODUTO-IA.sql`](SETUP-PRODUTO-IA.sql) e clique **Run**
▢ Confirme que o SELECT final lista 4 produtos: `Motion Titles`, `legendas`, `bundle_all`, **`ia`**

> **Sem esse passo**, o `/v1/license/issue?product_id=ia` retorna 403
> porque o produto não existe e não pode criar trial.

---

## Passo 2 — Instalar plugin CEP em modo dev

▢ Feche o Premiere se estiver aberto
▢ Duplo-clique em **[`plugin-ia\TESTAR-AGORA.bat`](TESTAR-AGORA.bat)**
▢ Toast verde: "AMBIENTE DE DESENVOLVIMENTO PRONTO"

> O .bat faz: enable PlayerDebugMode + limpa cache CEP + cria junction
> `%APPDATA%\Adobe\CEP\extensions\com.motionpro.ia` apontando pro repo.
> Editou o código → fechou e abriu o painel → mudança aparece. Zero copy.

> **Importante:** painel **NÃO abre sozinho** quando você abre o Premiere
> (AutoVisible=false pra evitar janela flutuante preta). Você precisa
> abrir em **Janela → Extensões → Motion IA** na primeira vez. Depois
> o Premiere lembra a posição docked.

---

## Passo 3 — Conexão automática (não precisa fazer nada)

Quando o painel abrir, ele já tenta automaticamente subir os 3 serviços:

1. **Motor IA** (Next.js localhost:3333) — sobe via `start-videopro.cmd`
2. **adb-proxy** (localhost:3001) — sobe via `start-adb-proxy.vbs` (invisible)
3. **UXP MCP Agent** (no Premiere) — você precisa ativar 1 vez:
   `Janela → Extensões → Premiere MCP Agent` (depois fica auto)

▢ Topbar mostra 4 dots de status: **PR · Motor · MCP · UXP**
▢ Em ~15s todos ficam verdes
▢ Banner roxo "Conectando…" some quando os 3 estiverem OK

**Se algum dot ficar vermelho:**
▢ Passa o mouse em cima → vê o motivo (tooltip)
▢ Clica em **"Conectar tudo"** no banner roxo → retenta auto-conexão
▢ Pra **UXP**: vá em **Janela → Extensões → Premiere MCP Agent** e ativa (1x só, depois fica salvo)

---

## Passo 4 — Login MotionVault (mesmo dos outros plugins)

▢ Painel abre com **gate de login** (mesmo do Motion Titles e Legendas)
▢ Cria conta nova OU usa email/senha existente (sessão é compartilhada — `mv_session`)
▢ Após login, gate fecha; faixa verde "Logado — seu@email.com" aparece
▢ Status bar embaixo mostra "Motion IA · build 1.1.0 · motor: http://localhost:3333"

Verificação no dashboard:
▢ Abra https://motionpro.vercel.app/dashboard (logado como admin)
▢ Procure seu email na tabela de usuários
▢ Clique → drawer abre → mostra `🤖 IA` badge na lista de assinaturas
▢ Status: `trialing` · expires_at: 7 dias adiante

---

## Passo 5 — Smoke test funcional

### 5.1 host.jsx (sem motor IA, só Premiere)
▢ Crie sequência com clip de vídeo + áudio
▢ Aba **AÇÕES → 📡 Testar Premiere (host.jsx)** → toast verde "QE OK"
▢ Aba **AÇÕES → 📋 Listar clips** → vai pra TIMELINE, mostra todos os clips
▢ Move CTI pro meio dum clip → **AÇÕES → ⫿ Cortar no cursor** → clip vira 2

### 5.2 Motor IA (Whisper + FFmpeg + Anthropic local)
▢ Aba **AÇÕES → ⚡ Testar motor IA local** → toast verde "Motor IA online"
▢ Aba **CHAT** → digita "lista as ferramentas que você tem"
▢ Stream de texto aparece em tempo real
▢ IA responde com lista das tools (premiere_get_project_info, set_clip_start_end_times, etc)

### 5.3 Ações IA reais (precisa clip com fala selecionado)
▢ Selecione um clip de fala no Premiere
▢ Aba **CHAT** → "corta os silêncios maiores que 0.5s do clip selecionado"
▢ Bubbles em ordem:
  - 🔧 `executando: get_project_info`
  - ✓ `get_project_info · projeto lido`
  - 🔧 `executando: detect_silences`
  - ✓ `detect_silences · N intervalos`
  - 🔧 `executando: set_clip_start_end_times` (várias)
  - texto streaming explicando o que fez

### 5.4 Color grade
▢ Aba **CHAT** → "aplica color teal-orange no clip selecionado"
▢ IA chama `apply_lut`, mostra preview, e (com sua confirmação) substitui o clip

---

## Diagnóstico se algo travar

| Sintoma | Causa provável | Solução |
|---|---|---|
| **Tela preta cobrindo o Premiere** ao abrir | Versão antiga em cache | Rerun `TESTAR-AGORA.bat` (limpa cache CEP) + abre painel manualmente em Janela → Extensões |
| Gate não fecha após login | Token não salvou | F12 console: `localStorage.getItem("mv_session")` deve retornar string |
| "subscription_required" | Produto IA não existe no banco | Passo 1 não foi feito |
| Banner roxo nunca some | start-videopro.cmd falhou | Roda manual, vê erro no terminal |
| "ExtendScript falhou" | host.jsx não carregou | `TESTAR-AGORA.bat` de novo (cache CEP sujo) |
| Chat trava "tool failed: addMediaToSequence" | UXP MCP Agent não conectado | Janela → Extensões → Premiere MCP Agent (deve dizer "Connected") |
| Painel não aparece em Extensões | PlayerDebugMode não foi aplicado | `TESTAR-AGORA.bat` rerun |

## Onde clicar pra ver tudo

| O que | URL/Path |
|---|---|
| **Plugin CEP em ação** | Premiere → Janela → Extensões → Motion IA |
| **Dashboard admin** (usuários, subs, conversão) | https://motionpro.vercel.app/dashboard |
| **Backend health** | https://motionpro.vercel.app/health |
| **Motor IA local health** | http://localhost:3333/api/status |
| **Console JS do painel** | Clica direito no painel → Inspect Element |
| **Banco direto** | https://console.neon.tech/ |

```
─────────────────────────────────────────────────
   Bora testar 🚀
─────────────────────────────────────────────────
```
