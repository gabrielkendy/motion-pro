# 🎬 Roadmap: Editor SRT Premium (Legendas Pro v2.0)

> Análise do plugin "EDITOR PREMIUM · BIBLIOTECA" mostrado pelo Gabriel + plano de implementação na nossa stack.

---

## 📸 O que o plugin de referência faz

### Telas observadas
1. **Header:** "EDITOR PREMIUM · BIBLIOTECA" · status verde "Logado — gabriel.lkend@gmail.com"
2. **Importação SRT:** "Nenhum SRT carregado" → botão "Carregar agora"
3. **2 modos:** TEMPLATES · AUTOMAÇÃO SRT
4. **Sidebar:** Categorias > "PALAVRAS" (1 Palavra, 2 Palavras, 3 Palavras (20))
5. **Grid:** preview de templates já com palavras tipo "Preciso", "do agora", "O mundo é", "eu quero"
6. **Popup SFX:** sons categorizados (Camera Shuter 01-02, Camera Shuter Clique 01-03, Botton 01-02, Botton Lento, Typing) com botões "▶ Play" + "Usar"
7. **Modo aplicação:** "Após aplicar: Manter originais | Desativar originais"
8. **Audio track:** "Com SFX" toggle + "Nenhuma audio track" + "Selecionar SFX"

### O fluxo de trabalho real
```
1. Cliente importa um .srt (transcrição do vídeo)
2. Plugin divide em blocos de 1/2/3 palavras
3. Cliente escolhe template (com preview)
4. Cliente escolhe SFX (opcional)
5. Plugin AUTO-APLICA: pra cada palavra do SRT, insere um template+SFX na timeline com timing exato
6. Resultado: vídeo com 50-200 títulos animados + sons sincronizados, sem fazer manual
```

**Esse é o "MotionPro Legendas FODA" do futuro.** Atual nosso plugin é "biblioteca passiva" — esse é "automação ativa".

---

## 🏗️ Plano de implementação por fases

### ✅ FASE 1 (HOJE) — Biblioteca de SFX
**Tempo:** 1-2h
**Entrega:** Plugin Legendas com aba SFX

- Nova aba na sidebar: **🔊 SFX**
- Lista categorizada (Camera / Click / Typing / Whoosh / Impact)
- Play preview de cada som (via Web Audio API)
- Botão "Usar" copia o áudio pro projeto Premiere (via JSX scripting)

**Sem editor SRT ainda.** Cliente usa manualmente: arrasta template, arrasta SFX, sincroniza.

### 🟡 FASE 2 (1-2 semanas) — Editor SRT básico
**Tempo:** 30-50h dev
**Entrega:** Aba "Importar SRT" + preview de palavras

- Botão "Carregar SRT" → parser do formato (já tem libs npm tipo `subtitle`)
- Preview de palavras divididas em blocos (1/2/3)
- Cliente escolhe template + SFX por categoria
- Botão "Aplicar a tudo" — gera lista de operações
- Mostra preview de quanto vai inserir ("vai criar 87 títulos")

### 🔴 FASE 3 (3-4 semanas) — Automação na timeline
**Tempo:** 80-120h dev
**Entrega:** Auto-aplica tudo na timeline

- Script JSX que pra cada palavra:
  - Insere mogrt no CTI
  - Ajusta texto do template pra palavra atual
  - Sincroniza com timecode do SRT
  - Insere SFX em track de áudio paralela
- Modo "Manter originais" vs "Desativar tracks originais"
- Undo group: 1 Cmd+Z desfaz tudo

**É possível?** Sim, mas Premiere CEP API tem limitações. Texto de mogrt pode ser editado via QE DOM ou MGT API. Inserção de áudio é direto.

### 🟢 FASE 4 (opcional, 1-2 semanas) — Inteligência
- Auto-seleção de template baseado em palavra ("FODA" → Glitch · "Amor" → Wedding)
- Auto-cor baseado no vídeo
- Detector de cena (template muda quando cena muda)

---

## 💰 Posicionamento comercial

Se você quer construir esse **MotionPro Editor SRT**, é um produto separado do MotionPro Legendas atual:

| Produto | Plano | Preço sugerido | Pra quem |
|---|---|---|---|
| MotionPro Legendas (atual) | Anual / Vitalício | R$ 149 / R$ 399 | Editor básico que quer templates prontos |
| **MotionPro Editor SRT (futuro)** | Anual / Vitalício | **R$ 399 / R$ 999** | Editor profissional que processa muito vídeo (youtubers, agências) |
| Bundle Completo | Anual | R$ 599 | MotionPro + Legendas + Editor SRT |

Editor SRT é **3-5x mais valor percebido** porque economiza HORAS de trabalho manual. Cliente vai querer pagar mais.

---

## 🎯 Decisão necessária

**Você quer:**

### Opção A — Implementar SÓ a Fase 1 agora (rápido)
- Adiciono aba SFX no plugin Legendas atual
- Cliente tem biblioteca de sons + templates
- Lança em 1-2h

### Opção B — Tratar Editor SRT como produto novo (longo prazo)
- Cria `plugin-editor-srt/` separado
- Implementa fases 2 + 3 em sprints
- Lança em 4-8 semanas
- Vende como produto premium R$ 399/ano

### Opção C — Híbrido (recomendado)
- **Hoje:** Fase 1 (SFX no Legendas atual)
- **Próximas 2 semanas:** começar Fase 2 em pasta nova (`plugin-editor-srt`)
- **Anúncio:** "Estamos construindo editor SRT — lista de espera"
- **Lançamento:** versão beta em 4 semanas

---

## 🔊 Pra começar a Fase 1 AGORA

Você precisa me fornecer:
1. **Arquivos de áudio SFX** (10-30 sons de exemplo)
   - Formato: .mp3 ou .wav, 1-3 segundos cada
   - Categorias: Camera, Click, Typing, Whoosh, Impact, Pop
   - Pode pegar gratuitos em https://freesound.org ou https://pixabay.com/sound-effects/
2. **OU** posso usar a estrutura mostrando "Em breve" e plugar áudios depois

Sem os áudios eu monto a UI completa (que é o que dá trabalho) e você só dropa os MP3s na pasta quando tiver.

---

## 📋 Estrutura de catálogo SFX

Vou criar `plugin-legendas/packs/sfx/catalog.json`:

```json
{
  "version": "1.0.0",
  "categories": [
    {
      "id": "camera",
      "name": "Camera",
      "items": [
        { "name": "Camera Shutter 01", "file": "camera/shutter_01.mp3", "duration": 0.4 },
        { "name": "Camera Shutter 02", "file": "camera/shutter_02.mp3", "duration": 0.5 },
        { "name": "Camera Click 01",   "file": "camera/click_01.mp3",   "duration": 0.3 }
      ]
    },
    {
      "id": "click",
      "name": "Click",
      "items": [
        { "name": "Button 01",    "file": "click/button_01.mp3", "duration": 0.2 },
        { "name": "Button Slow",  "file": "click/slow.mp3",      "duration": 0.5 }
      ]
    },
    {
      "id": "typing",
      "name": "Typing",
      "items": [
        { "name": "Type Single",   "file": "typing/single.mp3",  "duration": 0.1 },
        { "name": "Type Burst",    "file": "typing/burst.mp3",   "duration": 0.8 }
      ]
    }
  ]
}
```

UI vai ser parecida com a do plugin de referência: aba SFX com lista categorizada, play, "Usar".

---

## ⏭️ Próximo passo seu

Me responde:

1. **Qual opção?** A (rápido) · B (produto novo) · C (híbrido recomendado)
2. **Tem SFXs pra eu usar?** ou faço com placeholders e você dropa os MP3s depois
3. **Editor SRT é prioridade?** ou prefere focar em outras melhorias do plugin atual (analytics, retention, etc)

Aí eu executo.
