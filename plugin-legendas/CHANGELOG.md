# MotionPro Legendas — Changelog

## 4.23.0 — 2026-05-18 — Aba SFX + layout aprimorado

### Adicionado
- **Aba SFX dedicada**: biblioteca de efeitos sonoros como cards clicáveis (mesma UX dos templates), com play preview e seleção
- **Scanner automático** de `packs/sfx/<categoria>/*.{mp3,wav,ogg,m4a}` — basta dropar arquivos
- **2 modos de aplicação SFX**: "no CTI" (1 SFX no playhead) e "em todas legendas" (1 em cada clip da track)
- **Renumeração visual** dos templates: cada categoria mostra "Estilo 01", "Estilo 02"... (ID interno preservado)

### Mudado
- **Layout dos Templates** reorganizado: categorias viraram pills horizontais compactas no topo
- **Preview grande** removido; quando seleciona um template aparece faixa inline fina (escondida por padrão)
- **Grid de templates** agora ocupa quase 100% da altura — muito mais cards visíveis

## 4.22.0 — 2026-05-18 — Font detection arrays fix

### Corrigido
- `font-requirements.json` regenerado com arrays preservados (PowerShell `ConvertTo-Json` estava desempacotando arrays de 1 elemento, causando `fonts.filter is not a function` e quebrando o catalog)
- Hardened `getMissingFontsForTemplate` e `markTemplatesWithMissingFonts` pra aceitar string OU array (defensivo)
- Captura stdout/stderr do PowerShell e loga em caso de erro do prepare batch

## 4.21.0 — 2026-05-18 — Font checks via Node.js

### Mudado
- `checkFonts` e `installFonts` agora rodam do lado **Node.js** (`child_process`) em vez do ExtendScript — porque o Premiere CC moderno removeu `system.callSystem` do JSX
- Detecção de fontes via registry Windows com fuzzy match por PostScript name

## 4.20.0 — 2026-05-18 — Inject mode no Node + modo 1-palavra preservado

### Adicionado
- **Inject mode** completo no lado Node.js: PowerShell roda via `child_process.execFileSync`, gera mogrts customizados em batch, depois Premiere importa cada um sem precisar setar texto via API
- Fallback automático pro modo legacy (setValue) se PowerShell falhar

### Corrigido
- `enforceCutOpts` NÃO mescla mais grupos no modo 1-palavra (antes mesclava palavras curtas pra atingir minDur 0.4s, quebrando o propósito do modo)

## 4.19.0 — 2026-05-18 — Inject custom mogrt

### Adicionado
- **Estratégia inject**: gera MOGRT customizado em disco com texto já injetado no `definition.json` (em vez de tentar setar via setValue depois do import)
- Resolve definitivamente o bug de multi-palavra onde template tem N slots mas só 1 era preenchido
- Limpeza automática dos custom mogrts em `%TEMP%/_mpl_inject/`

## 4.18.0 — 2026-05-18 — Slot info por índice exato

### Adicionado
- `packs/slot-info.json` pré-computado em build-time: mapeia cada template aos índices exatos dos slots TEXT_FONT (type 6 do AE mogrt) dentro do clientControls
- `setMogrtText` usa esses índices direto via `mc.properties[idx]` quando disponível, bypassando toda heurística de nome/valor

## 4.17.0 — 2026-05-18 — Padronização Helvetica-Bold

### Mudado
- TODOS os 61 templates agora usam exclusivamente **Helvetica-Bold** como fonte
- 306 referências de fonte trocadas via script PowerShell editando cada `definition.json`
- Backups em `packs/ep-texto/_backup_pre_all_helvetica_bold/`

## 4.16.0 — 2026-05-18 — Detecção de slots por valor + EP pipe

### Mudado
- `classifyTextProp` reescrito: prioriza VALOR da prop (`textEditValue`/`mTextDocument`/`mString`) sobre NOME
- Nova heurística pra templates EP: nome `[EP] xxx` SEM separador `" | "` indica text slot
- Botão 🔍 na aba Templates pra diagnose individual de template

## 4.15.0 — 2026-05-18 — Font-aware UI

### Adicionado
- Sistema completo de detecção de fontes faltantes via `packs/font-requirements.json`
- Cards de template com badge ⚠ laranja quando fonte está faltando
- Banner inteligente mostrando fontes específicas que faltam e quantos templates afetam

### Corrigido
- 13 templates editados pra trocar `HelveticaNeue-*` (proprietária, não shipada) por `Helvetica-*` equivalente

## 4.14.0 — 2026-05-18 — Multi-slot text detection

### Mudado
- `setMogrtText` distribui 1 palavra por slot quando template tem múltiplos text slots
- Detecção por VALOR + nome — pega slots EP nomeados com placeholder ("descontos", "sentido")

## 4.13.0 — 2026-05-18 — Render safety helpers

### Adicionado
- Painel pós-aplicação quando volume ≥ 50 legendas: avisa sobre crash no export
- Botão **🎬 Renderizar preview** → dispara `Sequence > Render Effects In to Out` (cria cache verde)
- Botão **📦 Agrupar em Nest** → faz `Clip > Nest` em todas legendas da track

## 4.12.0 — 2026-05-18 — Modo 1-palavra

### Adicionado
- Toggle "🎯 1 palavra por legenda" (padrão ON) — cada palavra vira clip próprio com template de 1p
- Solução pragmática enquanto o multi-slot estava bugado (já resolvido em 4.19+)

## 4.11.0 — 2026-05-17 — Cut config estilo Premiere

### Adicionado
- Bloco "⚙️ Configuração de corte" na aba Importar — layout (linha única/dupla), máx caracteres, duração mínima, gap entre legendas (em quadros)
- Detecção automática de fps da sequência ativa
- Persistência em localStorage

## Notas operacionais

### Pasta de instalação
Plugin é instalado em `%APPDATA%\Adobe\CEP\extensions\com.motionpro.legendas\` — **NÃO** roda da pasta dev. Sempre sincronizar (`robocopy`) antes de testar.

### Cache do CEP
Após updates, limpar `%LOCALAPPDATA%\Temp\cep_cache` com Premiere fechado.

### Modos de aplicação
- **1 palavra por legenda** (default): cada palavra vira clip 1p · sem risco de slot duplicado
- **Multi-palavra** (desliga o toggle): usa templates 2p/3p/4p+ via inject mode (gera mogrt customizado)

### Fontes
Todos templates agora usam `Helvetica-Bold` (PostScript name). Arquivo shipped: `fonts/HELVETICA-BOLD.TTF`. Outras fontes da pasta (`fonts/CHAMBERIDISPLAY-*`, etc) ficam por compatibilidade mas não são referenciadas pelos mogrts atuais.

### SFX
- Sintéticos: 10 sons via Web Audio API (sempre disponíveis)
- Reais: dropar `.mp3`/`.wav`/`.ogg`/`.m4a` em `packs/sfx/<categoria>/`
