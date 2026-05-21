# Como testar o Motion IA

## Arquitetura (final)

```
┌──────────────────────────┐         ┌──────────────────────────┐
│ Premiere Pro (CEP)       │         │ VIDEO-PRO-IA (existente) │
│  ┌────────────────────┐  │  fetch  │  Next.js localhost:3333  │
│  │ plugin-ia/         │──┼────────►│  /api/chat-premiere      │
│  │ index.html + JS    │  │   SSE   │  Anthropic · Whisper ·   │
│  └─────────┬──────────┘  │         │  FFmpeg · Remotion · 30+ │
│            │ evalScript  │         │  tools                   │
│  ┌─────────▼──────────┐  │         └──────────┬───────────────┘
│  │ jsx/host.jsx       │  │                    │ adb-mcp socket
│  │ MotionProIA.*      │  │         ┌──────────▼───────────────┐
│  │ (timeline reads +  │  │         │ UXP Premiere MCP Agent   │
│  │  fallback edits)   │  │         │ (Mike Chambers plugin)   │
│  └────────────────────┘  │         │ Executa comandos no PR   │
└──────────────────────────┘         └──────────────────────────┘
                                                │
                                     ┌──────────▼───────────────┐
                                     │ MotionVault Vercel       │
                                     │ /v1/auth + /v1/license   │
                                     │ (só gate de quem paga,   │
                                     │  IA não passa por aqui)  │
                                     └──────────────────────────┘
```

**Quem paga Anthropic:** o usuário, com sua própria key em
`VIDEO-PRO-IA/video-editor/.env.local`. O plugin CEP só valida licença e
delega tudo pro motor local. Zero custo de IA pro PacotesFX.

## Pré-requisitos (já existem na sua máquina)

- ✅ `VIDEO-PRO-IA/video-editor` com `.env.local` (ANTHROPIC_API_KEY + GROQ_API_KEY)
- ✅ `VIDEO-PRO-IA/premiere-plugin` (UXP MCP Agent) instalado e ativo no Premiere
- ✅ `VIDEO-PRO-IA/start-videopro.cmd` funciona (sobe Next.js + adb-proxy)
- ✅ FFmpeg no PATH

## 1. Setup dev (uma vez)

```bat
1. Feche o Premiere
2. Dê duplo-clique em plugin-ia\TESTAR-AGORA.bat
   (cria junction %APPDATA%\Adobe\CEP\extensions\com.motionpro.ia → repo)
3. Abra o Premiere
```

Se quiser pular o login do MotionVault localmente: edite `js/config.js` →
`devMode: true`. (Padrão é `false` pra simular prod.)

## 2. Subir o motor IA local

```bat
plugin-ia\TESTAR-AGORA.bat   ← já abre o Premiere
```

Em outro terminal:
```bat
C:\Users\Gabriel\Downloads\VIDEO-PRO-IA\start-videopro.cmd
```

**OU** deixa o motor offline e o plugin oferece um botão "Iniciar agora" no
banner roxo (chama `start-videopro.cmd` via `child_process.spawn`).

## 3. Abrir o painel

```
Premiere → Janela → Extensões → Motion IA
```

O painel mostra:
- **Topbar**: bolinha verde = host.jsx OK
- **Motor bar (roxa, se aparecer)**: localhost:3333 offline → botão pra subir
- **Seq bar**: nome da sequência ativa + duração
- **3 abas**: 💬 CHAT · ⚡ AÇÕES · 📼 TIMELINE

## 4. Checklist de smoke test

### 4.1 Conexão básica (sem motor IA)

- [ ] Bolinha verde pulsa na topbar
- [ ] **AÇÕES → 📡 Testar Premiere (host.jsx)** → toast "✓ Adobe Premiere Pro X · QE OK"
- [ ] **AÇÕES → 📋 Listar clips da timeline** → aba TIMELINE renderiza tudo
- [ ] **AÇÕES → ⫿ Cortar no cursor** → razor no CTI atual em todas as tracks

### 4.2 Motor IA online

- [ ] **AÇÕES → ⚡ Testar motor IA local** → toast verde "Motor IA online em http://localhost:3333"
- [ ] Banner roxo "Motor IA offline" desapareceu (se estava)

### 4.3 Chat IA (precisa motor + Premiere com sequência)

Selecione um clip com fala no Premiere e:

- [ ] Digita "lista as ferramentas que você tem" → IA responde com lista das tools do video-editor
- [ ] Digita "corta os silêncios > 0.5s do clip selecionado" → eventos:
  - bubble 🔧 `executando: detect_silences`
  - bubble ✓ `detect_silences · detectados N silêncios`
  - bubble 🔧 `executando: set_clip_start_end_times` (várias vezes)
  - texto streaming da IA confirmando
- [ ] Digita "aplica color teal-orange" → IA chama `apply_lut`, swap clip
- [ ] Digita "gera legendas TikTok karaoke amarelas em V2" → Remotion renderiza alpha, importa, insere

## 5. Problemas e diagnóstico

### Banner roxo "Motor IA offline"
- Clica **"Iniciar agora"** OU roda `start-videopro.cmd` manual
- Espera até ~20s na 1ª vez (build do Next.js)
- Clica em **↻** pra reverificar

### Chat dá "Motor IA offline (localhost:3333)"
- Verifica `netstat -ano | findstr :3333` — alguém escutando?
- `curl http://localhost:3333/api/status` — responde?
- Se não: bug no start-videopro.cmd ou porta 3333 ocupada

### Chat dá "tool failed: addMediaToSequence ..."
- UXP plugin "Premiere MCP Agent" não está ativo
- Janela → Extensões → Premiere MCP Agent (deve mostrar "Connected")
- Se não conecta: roda `wscript premiere-plugin\client\start-adb-proxy.vbs`

### "subscription_required" no gate
- Em dev: `devMode: true` em `config.js`
- Em prod: precisa rodar isso no banco UMA VEZ:
  ```sql
  INSERT INTO products(id, name, description) VALUES
      ('ia', 'Motion IA', 'Agente IA dentro do Premiere com Whisper/FFmpeg/Remotion')
      ON CONFLICT (id) DO NOTHING;
  ```
  (Aí o `/v1/license/issue?product_id=ia` vai criar trial 7d automático)

### Painel não aparece em Janela → Extensões
- Rodar `TESTAR-AGORA.bat` de novo (regenera junction + PlayerDebugMode + limpa cache)
- Cache: `%LOCALAPPDATA%\Temp\cep_cache` apagado dentro do script

### Console JS / debug
1. Clica direito no painel → **Inspect Element** (precisa PlayerDebugMode ON)
2. Console:
   ```js
   // Testar host.jsx direto:
   new CSInterface().evalScript('MotionProIA.ping()', console.log);

   // Testar motor:
   IAClient.ping().then(console.log);

   // Forçar refresh:
   location.reload();
   ```

## 6. Arquitetura — quem faz o quê

| Tarefa | Onde executa |
|---|---|
| Ler timeline (lista clips, CTI, fps) | `jsx/host.jsx` direto (ExtendScript) |
| Razor manual (sem IA) | `jsx/host.jsx` (QE DOM) |
| Detectar silêncios | localhost:3333 `/api/detect-silences` (Whisper) |
| Aplicar LUT | localhost:3333 `/api/apply-lut` (FFmpeg) |
| Gerar legendas alpha | localhost:3333 `/api/render-alpha` (Remotion) |
| Inserir clip no Premiere via IA | localhost:3333 → adb-mcp → UXP plugin → Premiere |
| Auth / paywall | motionpro.vercel.app `/v1/auth` + `/v1/license` |
| IA conversacional | localhost:3333 `/api/chat-premiere` (Anthropic do user) |

O plugin CEP é uma **interface unificada** sobre tudo isso — substitui o
Claude Desktop como front-end.
