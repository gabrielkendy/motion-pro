# Deploy Motion Legendas v4.23 — Checklist

**Build:** `4.23.0-sfx-tab+layout-pills+renumber` · **Bundle:** `3.1.0` · **ZIP:** `1.1.0`
**Data:** 2026-05-18

---

## Status atual

| Item | Status |
|---|---|
| Plugin Legendas em dev (Documents/) | ✅ v4.23 |
| Plugin instalado (APPDATA) | ✅ v4.23 sincronizado |
| Manifest CEP | ✅ Bundle 3.1.0 |
| ZIP de distribuição | ✅ `installers/zip-manual-legendas/output/Motion Titles-Legendas-1.1.0.zip` (17.9 MB) |
| Cache CEP | ✅ Limpo |
| CHANGELOG | ✅ `plugin-legendas/CHANGELOG.md` |
| README | ✅ `plugin-legendas/README.md` |
| Memórias atualizadas | ✅ |
| **Home principal** com seção Família + nav Legendas | ✅ `landing/index.html` |
| **download.html** unificado (tabs Motion Titles/Legendas) | ✅ `landing/download.html` |
| **landing/legendas** atualizada (v1.1.0 + link cruzado) | ✅ `landing/legendas/{index,download}.html` |
| Dashboard multi-plugin | ✅ já tinha — `dashboard/app.js` mostra `productBadge` e analytics por produto |
| Backend multi-produto | ✅ migration 004 já tem produto `legendas` cadastrado |

---

## O que foi entregue na v4.23 (resumo)

### Funcionalidades novas
- **Modo 1-palavra por legenda** (default ON): cada palavra vira clip 1p — solução robusta pra evitar bugs de multi-slot
- **Multi-palavra com inject mode**: gera mogrt customizado em disco com texto já injetado (bypassa setValue do Premiere CEP) — funciona pra 2p/3p/4p+
- **Configuração de corte estilo Premiere**: duração mínima, gap entre legendas em quadros, modo linha única/dupla
- **Detecção de fontes faltantes** via `font-requirements.json` + banner laranja + badge ⚠ em cards
- **Aba SFX dedicada** com cards clicáveis, preview, 2 modos de aplicação
- **Scanner automático** de `packs/sfx/<categoria>/*.{mp3,wav,ogg,m4a}`
- **Painel pós-aplicação** com botões "Renderizar preview" e "Agrupar em Nest" (evita crash no export)

### Layout/UX
- Categorias viraram **pílulas horizontais** (não rouba espaço da grid)
- Preview grande removido — só aparece faixa fina inline quando seleciona template
- Templates **renumerados** sequencialmente por categoria (Estilo 01, 02, 03... — ID interno preservado)
- Aba SFX com cards estilo templates (waveform SVG, categoria, badge SYN/FILE)

### Correções críticas
- Templates EP têm bug de nome (slot último com `xxx | Rotacao` igual a modifier) — **solucionado** com slot-info por índice exato
- `system.callSystem` removido do JSX → **migrado pra Node.js** (`child_process`)
- 13 mogrts editados pra trocar HelveticaNeue por Helvetica (fonte proprietária)
- 42 mogrts adicionalmente padronizados pra usar SÓ Helvetica-Bold (61 templates uniformizados)

---

## Onde está cada coisa

```
MotionVault/
├── plugin-legendas/                    ← código fonte (dev)
│   ├── CHANGELOG.md                    ← histórico v4.11–v4.23
│   ├── README.md                       ← documentação técnica
│   └── packs/ep-texto/_backup_*/       ← snapshots antes de batch edits (NÃO vão pro ZIP)
│
├── installers/zip-manual-legendas/
│   ├── build-zip.ps1                   ← v1.1.0 · slim (só ep-texto/+sfx/+JSONs)
│   ├── INSTALAR.bat, DESINSTALAR.bat
│   ├── LEIA-ME.html
│   └── output/
│       └── Motion Titles-Legendas-1.1.0.zip ← 🚀 ZIP pra distribuir
│
├── landing/legendas/                   ← landing page do produto
├── DEPLOY-LEGENDAS-V4.23.md            ← este arquivo
└── ACESSOS-MASTER.md                   ← credenciais (já atualizado)
```

---

## Como distribuir pro cliente

### Opção A — Manual (atual)
1. Sobe o `Motion Titles-Legendas-1.1.0.zip` pro storage de downloads (S3? Google Drive? Vercel static?)
2. Atualiza link no `landing/legendas/index.html` (procurar por `Motion Titles-Legendas-1.0.0.zip` se existir)
3. Cliente baixa, extrai, roda `INSTALAR.bat`

### Opção B — Via dashboard Motion Titles (preferido)
Se já tem fluxo de download autenticado:
1. Coloca o ZIP em `landing/api/downloads/legendas-v1.1.0.zip` ou no S3
2. Endpoint `/api/download/legendas` valida JWT + retorna o ZIP
3. Cliente loga no dashboard, clica download

**Conferir antes**: dashboard tem fluxo de download? Olhar `MotionVault/dashboard/` ou `landing/api/`.

---

## Verificações pré-deploy

```powershell
# 1. Confirmar versão do plugin
$mainJs = "c:\Users\Gabriel\Documents\Motion Bro\MotionVault\plugin-legendas\js\main.js"
Select-String -Path $mainJs -Pattern '^var BUILD' | Select-Object -First 1
# → deve mostrar: var BUILD = "4.23.0-sfx-tab+layout-pills+renumber";

# 2. Confirmar manifest
$manifest = "c:\Users\Gabriel\Documents\Motion Bro\MotionVault\plugin-legendas\CSXS\manifest.xml"
Get-Content $manifest | Select-String "ExtensionBundleVersion"
# → ExtensionBundleVersion="3.1.0"

# 3. Confirmar ZIP existe e tem tamanho saudável
$zip = "c:\Users\Gabriel\Documents\Motion Bro\MotionVault\installers\zip-manual-legendas\output\Motion Titles-Legendas-1.1.0.zip"
Get-Item $zip | Select-Object Name, @{n='SizeMB';e={[Math]::Round($_.Length/1MB,1)}}, LastWriteTime
# → ~17.9 MB

# 4. Hash pra footer da landing (anti-tampering)
(Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
```

---

## Auditoria de acessos (referência rápida)

> Detalhes completos em `ACESSOS-MASTER.md` (já está atualizado em 2026-05-17)

| Serviço | URL/Conta | Status |
|---|---|---|
| Backend API | motionpro.vercel.app | 🟢 LIVE |
| Landing | motionpro-lp.vercel.app | 🟢 LIVE |
| Dashboard Admin | motion-pro-admin.vercel.app | 🟢 LIVE |
| Founder login | gabriel.kend@gmail.com | 🟢 Lifetime |
| Stripe | (ver ACESSOS-MASTER) | ✓ |
| Neon DB | (ver ACESSOS-MASTER) | ✓ |
| Vercel projects | kps-projects-b5c26735 | 3 projetos LIVE |

**Coisas a verificar manualmente (se quiser auditar agora):**
1. Stripe webhooks ativos e funcionando — testar checkout end-to-end
2. Neon DB backup recente — confirmar último snapshot
3. JWT secret rotacionado nos últimos 90 dias? (recomendação de segurança)
4. Domínios próprios apontando corretamente (DNS A/CNAME pra Vercel)
5. SSL certs válidos por +30 dias

---

## Mudanças na landing (2026-05-18)

### `landing/index.html` (home principal)
- ✅ Nav: adicionado item **"Família"** apontando pra `#familia`
- ✅ Nova seção `#familia` entre `#plataforma` e `#fluxo`: 3 cards (Motion Titles · Motion Legendas · Motion IA em breve)
- ✅ Footer: nova coluna "Plugins" com links pros 2 produtos

### `landing/download.html` (download principal)
- ✅ Tabs no topo (🎬 Motion Titles · 💬 Motion Legendas) com smooth scroll
- ✅ Seção Motion Legendas adicionada: card recomendado com ZIP v1.1.0 + card linking pra landing detalhada
- ✅ Bloco final "Bundle completo" com CTA pros planos

### `landing/legendas/index.html`
- ✅ Nav: adicionado "Download" + "Família Motion Titles" (linka pra `/#familia`)
- ✅ Trocou link de "Motion Titles completo" pra navegação cruzada estruturada

### `landing/legendas/download.html`
- ✅ Bumped pra v1.1.0 · 18 MB · build 4.23.0
- ✅ Adicionado "📦 Todos os plugins" no nav (linka pra `/download.html`)
- ✅ Texto antigo "~600MB com 549 títulos" corrigido pra "~18 MB com 61 templates + biblioteca SFX"

---

## Próximos passos sugeridos

1. **Testar o ZIP** instalando do zero numa máquina (ou pelo menos `DESINSTALAR.bat` → `INSTALAR.bat`)
2. **Subir o ZIP** pra GitHub Releases: tag `legendas-v1.1.0` no repo `gabrielkendy/motion-pro` (URL já tá nos cards)
3. **Deploy Vercel das landings** (`Motion Titles-lp`) — auto-trigger se está conectado ao Git, ou `vercel --prod`
4. **Comunicar a base** (email/WhatsApp) sobre a v4.23 — destacar: SFX library, multi-palavra funcionando, render safety
5. **Coletar SFX MP3/WAV** pra dropar em `packs/sfx/<categoria>/` e regerar ZIP v1.2.0
6. **Considerar bump pra v5.0** do bundle quando estabilizar e tiver mais features (atualmente em 3.1.0 internamente)

---

## Notas

- Os mogrts no `packs/ep-texto/_backup_*/` são **só pra dev** — backup antes de batch edits. Não vão pro ZIP de distribuição (já configurado no build-zip.ps1).
- O `font-requirements.json` e `slot-info.json` são **pré-computados** em build via PowerShell. Se editar mogrts no futuro, regerar esses 2 JSONs.
- Plugin tem **fallback automático** pro modo legacy (setValue) caso o inject mode falhe — usuário não vê erro, só vê warning no LOG.
