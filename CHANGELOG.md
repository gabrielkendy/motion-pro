# Motion Pro · Suite Changelog

## v2.1 · Motion IA close — Sprint MEGA Onda 5 (2026-05-23)

### Motion IA (plugin-ia/) v4.0.0
- **ε**: Auth + UI paridade visual (purple accent #8b5cf6, reauthbar sticky sem logout automático, MvAuth shim, sidebar 52px, config drawer, 4 ícones CEP)
- **ζ**: License gate + 15min heartbeat + 4-dot status bar (espelhado de Legendas, 30d offline grace, paywall Stripe overlay)
- **η**: SSE bridge Next.js localhost:3333 + MIA_* ES3 funcs em host.jsx (getActiveSequence, insertClipAtCti, cutAtCti, addTextOverlay, exportPreview) + utils.jsx, port DevTools 8092
- **θ**: Inno Setup installer protegido (LZMA2 ultra, JS obfuscado profile=balanced, AppId GUID único MIA0000000001, auto-close Premiere, CEP PlayerDebugMode HKCU CSXS.9–12, task opcional runPremiere, UninstallDelete preserva cache Whisper)
  - Artefato: `installers/innosetup/output/MotionPro-IA-4.0.0-Setup.exe` (3.27 MB)
  - SHA256: `9b7620d5b73fa759e26b9e865de22bc06a4abab95f847be89b154dbb28ee37fe`
  - Build script: `tools/build-ia-installer.ps1` (stage → obfuscate → ISCC → verify)
  - Excludes: `node_modules/, .git/, *.log, models/*.bin, *.bak, tests/, docs/, test-results/`

### Backend
- κ: docs/ops/* env sanitization playbook (Vercel + Cloudflare Worker test matrix)

### Tests
- ι: tests/e2e/ Playwright harness (stub-ready + cred-ready), 4 specs, 10 testes

### Onda 1 preservations confirmadas
- Manifest plugin-ia/CSXS/manifest.xml SEM ScriptPath (causa error 27 PlugPlug)
- bundleId com.motionpro.ia + HostList [14.0,99.9]
- host.jsx ES3 fixes Onda 1 intactos
