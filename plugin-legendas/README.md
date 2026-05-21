# Motion Legendas

Plugin CEP do Premiere Pro pra aplicar legendas animadas em massa a partir de SRT, captions nativas ou roteiro digitado. Parte da família **MotionVault** by PacotesFX.

```
build atual: 4.23.0
bundle:      3.1.0
extension:   com.motionpro.legendas
```

## O que faz

- Importa SRT ou Captions nativas do Premiere
- Distribui inteligentemente em grupos de 1-7 palavras casando com templates disponíveis
- Aplica em massa na timeline com timing correto
- 61 templates motion graphics (1-7 palavras) já incluídos
- Biblioteca de SFX (10 sintéticos + suporta seus MP3/WAV em `packs/sfx/`)
- Pre-render preview e nesting automático pra evitar crash no export com muitas legendas

## Fluxo típico

1. **Aba Importar** → carrega SRT ou Captions Premiere
2. (Opcional) ajusta config de corte: duração mínima, gap entre legendas, modo 1-palavra
3. **⚡ Distribuição Inteligente** → corta e atribui templates automaticamente
4. **Aba Editar** → revisa cada legenda, edita texto/template individualmente se quiser
5. **⚡ APLICAR NA TIMELINE** → cria todos os clips animados
6. Se ≥50 legendas: aparece banner sugerindo **🎬 Renderizar preview** antes de exportar

## Modos

### 🎯 1 palavra por legenda (default, recomendado)
Cada palavra vira 1 clip com template de 1p. Zero risco de bagunça de slot. Visual estilo viral/TikTok.

### Multi-palavra (toggle desligado)
Plugin escolhe templates de 2p/3p/4p+ com inject mode (gera mogrt customizado em disco com texto já injetado no `definition.json`). 100% determinístico.

## SFX

Aba dedicada com cards clicáveis. Funciona com:
- **10 sintéticos shipped** (click, pop, camera shutter, whoosh, impact, typing...)
- **Seus arquivos**: dropa `.mp3`/`.wav`/`.ogg`/`.m4a` em `packs/sfx/<categoria>/` e o plugin escaneia automaticamente

Aplicar:
- **⚡ No CTI**: 1 SFX no playhead
- **🎬 Em todas legendas**: 1 SFX em cada clip da última track de vídeo

## Instalação (cliente final)

Use o ZIP de distribuição em `installers/zip-manual-legendas/output/Motion Titles-Legendas-X.Y.Z.zip`:

1. Extrai o ZIP
2. Duplo clique em `INSTALAR.bat`
3. Abre Premiere → `Window > Extensions > Motion Legendas`

Pra fechar/atualizar: `DESINSTALAR.bat` na mesma pasta.

## Build / desenvolvimento

```powershell
# Sincronizar dev → install (overwrite)
robocopy "c:\Users\Gabriel\Documents\Motion Bro\MotionVault\plugin-legendas" "$env:APPDATA\Adobe\CEP\extensions\com.motionpro.legendas" /E /PURGE /XO /NFL /NDL /NJH /NJS /NP /MT:8

# Limpar cache CEP (Premiere precisa estar fechado)
Remove-Item "$env:LOCALAPPDATA\Temp\cep_cache" -Recurse -Force -ErrorAction SilentlyContinue

# Build do ZIP de distribuição
cd installers\zip-manual-legendas
.\build-zip.ps1
```

## Estrutura

```
plugin-legendas/
├── CSXS/manifest.xml          ← bundle/extension identity
├── index.html                 ← UI principal
├── js/
│   ├── main.js                ← lógica do plugin (CEP/Node side)
│   ├── auth.js                ← integração com backend MotionVault (JWT)
│   ├── config.js
│   └── lib/CSInterface.js
├── jsx/host.jsx               ← ExtendScript (chamadas Premiere)
├── css/ep.css
├── packs/
│   ├── catalog.json           ← 61 templates
│   ├── font-requirements.json ← pré-computado em build
│   ├── slot-info.json         ← índices type=6 de cada mogrt
│   ├── ep-texto/*.mogrt       ← arquivos MOGRT (After Effects)
│   │   └── _backup_*/         ← snapshots antes de edits batch
│   └── sfx/                   ← drop seus SFX aqui
│       ├── click/, camera/, whoosh/, impact/, typing/
│       └── _README.txt
├── fonts/                     ← TTFs/OTFs shipped
├── locales/
├── img/
└── CHANGELOG.md
```

## Backend & licenciamento

Plugin autentica via JWT no backend Motion Titles (`motionpro.vercel.app`). Funciona em modo **Trial 7 dias** + planos pagos via Stripe.

- Login: aba interna do plugin (gera modal se não estiver logado)
- Validação: ping no boot + a cada operação sensível
- Offline grace: 7 dias após última validação OK

Mais detalhes: `ACESSOS-MASTER.md` (raiz do MotionVault) — credenciais e fluxos.

## Troubleshooting rápido

| Problema | Solução |
|---|---|
| Plugin não atualiza após sync | Limpar `%LOCALAPPDATA%\Temp\cep_cache` com Premiere fechado |
| Templates não aparecem (catalog FAIL) | Reabrir o painel; conferir LOG |
| Fontes erradas no render | Clica no banner "🔤 Instalar agora" no topo do plugin; reinicia Premiere |
| Crash do Premiere no export | Use **🎬 Renderizar preview** antes de exportar (cache verde) |
| Templates multi-palavra duplicando | Usa modo INJECT (default na v4.19+); confirma BUILD ≥ 4.19 no LOG |
| Erro `system is undefined` | BUILD < 4.21 — sincroniza pasta dev → install (`robocopy`) |
