# Motion IA · Changelog

## v3.1.0 — 2026-05-20 · Polish & Parity

### NEW — Casper · Auto-edit (👻)
- Pipeline declarativo: encadeia múltiplas skills num único click
- Editor visual de regras (add/remove/reorder/toggle) com persistência localStorage
- 4 regras-padrão: cortar pausas + bins + cross-dissolve + capítulos
- `Skills.run("casper")` orquestra todas as skills sequencialmente com progress nesteado

### NEW — Catálogo de transições com preview
- 12 transições nativas mapeadas: Cross Dissolve, Dip to Black/White, Additive, Film Dissolve, Push, Slide, Wipe, Iris Cross, Split, Zoom Trails, Morph Cut
- UI picker visual (grid) com demo animado por categoria
- Seleção persistente + duração customizável por execução

### NEW — Face Tracking real no Auto Crop
- `js/face-tracker.js` — análise Canvas YCbCr frame-by-frame
- Extrai N frames via ffmpeg, calcula centro de massa do rosto
- Auto Crop 9:16/1:1/4:5 centrado no rosto detectado
- Fallback cropdetect motion se sem rosto

### NEW — Legendas word-by-word animadas
- `buildASS()` reescrito com karaoke timing (\\k tags)
- 5 estilos: Viral (Impact + highlight amarelo), TikTok (Arial Black + verde), Reels (Montserrat + magenta), Clássico (Arial laranja), Minimal (Helvetica)
- Bounce + fade per-word com `\\t()` transforms

### NEW — Biblioteca Stock multi-fonte
- Adicionado Pixabay (vídeos HD) e Giphy (GIFs animados)
- Source picker no UI (Pexels / Pixabay / Giphy / All)
- Settings com 3 campos de API key + teste de conexão por fonte

### NEW — Onboarding Tour
- `js/onboarding-tour.js` — tour interativo 1ª execução
- 6 steps com spotlight + dots + skip/back/next
- Re-disparável via Config → Ajuda → Refazer tour
- Persistência em `mia_tour_done`

### NEW — UI Polish CSS
- Animações: fadeInUp, slideUp, pulse, progressShimmer, skeleton, spin
- Componentes: .spinner, .progress c/ shimmer, .skel skeleton, .btn.loading
- Modais e backdrop pro tour
- Grid de transições com 6 demos visuais distintos

### CHANGES
- Manifest v3.0.0 → v3.1.0
- index.html: carrega face-tracker.js + onboarding-tour.js, item Casper no sidebar
- Settings: campos Pixabay Key + Giphy Key + bindings test
- Landing /ia/download.html: redesign 13 features grid + diferencial + steps polidos

## v3.0.0 — 2026-05-20 · Phantom-style edition

### NEW — 12 features completas em PT-BR
- 🎯 **Cortar Pausas** — Whisper local detecta silêncios + ripple delete
- 🎬 **Cortar Erros** — Gemini identifica takes ruins/duplicados + remove
- ⚡ **Caça-Trechos** — Gemini acha highlights + cria sequências verticais (Shorts)
- 📖 **Capítulos IA** — Gemini detecta capítulos + adiciona markers no Premiere
- 💬 **Legendas IA** — Whisper word-level + renderiza ASS overlay direto + reimporta
- ✂️ **Copiar Sequência** — Duplicate OU export FCP XML pra cross-project
- 🎞️ **Transições IA** — Aplica Cross Dissolve via QE DOM em todos os cortes
- 📁 **Organizar Bins** — Cria 4 bins (Vídeos/Áudios/Imagens/Sequências) + move items
- 📹 **MultiCam IA** — `createMulticamSequence` com sync por waveform de áudio
- ⬇️ **Baixar Vídeo** — yt-dlp local YouTube/Insta/TikTok com progress
- 📐 **Auto Crop** — ffmpeg + cropdetect tracking (9:16 / 1:1 / 4:5)
- 📚 **Biblioteca Stock** — Pexels API + auto-download HD + import

### NEW — Infra
- **License Keys system** (Phantom-style):
  - Generate keys avulsas via admin
  - Activate por device fingerprint (cap multi-device)
  - Cache offline criptografado AES-256-GCM
  - Validação automática a cada 24h
  - Funciona offline entre validações
- **Binários bundlados** em `bin/win/`: ffmpeg + ffprobe + whisper-cli + 3 DLLs + yt-dlp + aria2c + SDL2 (≈218 MB)
- **bin-runner.js**: wrapper Node `child_process.spawn` pros binários
- **gemini-client.js**: Gemini 2.5 Flash/Pro com inline (até 20MB) ou Files API (>20MB)
- **Sistema de créditos**: `/v1/usage/deduct` + `/v1/usage/balance` + log

### NEW — Backend
- Migration 009: `license_keys` + `license_key_activations` + view com usage
- Migration 010: `user_credits` + `usage_log` + `oauth_tokens`
- 14 endpoints novos: 7 license-keys + 3 usage + 4 ai-settings

### NEW — UI/UX
- Sidebar PT-BR estilo Phantom com 12 features
- Cores: preto `#0a0c12` + azul `#2563eb`
- Tela License Status (Active/Inactive/Expired)
- Tier dinâmico no sidebar foot
- Lock 🔒 automático em features acima do tier
- Settings com Anthropic + Gemini + Pexels keys + modelo + max-tokens
- Botão "Testar conexões" valida tudo de uma vez

### CHANGES
- ExtendScript: 35 funções (10 base + 12 vision + 13 v3)
- Agent.run com multimodal image content blocks
- System prompt v2 (modo editorial 4 fases)

## v2.1.0 — 2026-05-20 · Modo editorial
- Skill `understand_video` com frames base64 + transcript
- Vision multimodal Claude
- 23 tools agentic

## v2.0.0 — 2026-05-19 · BYOK agentic
- Aba CONFIG dedicada
- BYOK Anthropic com sync backend
- Agent.run com tool use

## v1.0.0 — 2026-05-18
- Chat básico com Claude
