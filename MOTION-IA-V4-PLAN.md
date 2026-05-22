# Motion Suite v4 — Plano de Ação Executável

**Autor:** Claude (Gestor + Executor)
**Data:** 2026-05-21
**Branch:** `feat/motion-ia-v4`
**Objetivo:** Tirar Anthropic, migrar pra Gemini Flash (visão de vídeo nativa) + adicionar geração de vídeo via Seedance/fal.ai + fix bug crítico solo/duo no webhook.

---

## 🎯 ENTREGÁVEIS

1. **Motion IA roda 100% no Gemini Flash 2.0** (custo 100-200x menor que Claude)
2. **Nova feature "Gerar Vídeo IA"** com Seedance via fal.ai (substitui Biblioteca Stock)
3. **Fix webhook** pra reconhecer product_id `solo` e `duo` (sem isso, cliente paga e não recebe chave)

---

## 📋 FASES E COMMITS

### **FASE 1 · HOJE (executável agora, sem dep de terceiros)**

| # | Tarefa | Arquivos | Commit | Status |
|---|--------|----------|--------|--------|
| 1.1 | Fix bug crítico product-aliases solo/duo | `backend/src/utils/product-aliases.js` | `fix(backend): adiciona solo/duo aliases no resolveProduct` | ⏳ |
| 1.2 | Adapter Gemini function calling (claude-tools format → gemini parameters) | `plugin-ia/js/gemini-tools.js` (NOVO) | `feat(motion-ia): gemini-tools adapter` | ⏳ |
| 1.3 | Refactor agent.js: Anthropic API → Gemini API | `plugin-ia/js/agent.js` | `refactor(motion-ia): agent.js usa Gemini Flash 2.0` | ⏳ |
| 1.4 | Remove campos Anthropic de Settings UI, promove Gemini | `plugin-ia/js/settings-ui.js` + `plugin-ia/js/app.js` + `plugin-ia/index.html` | `refactor(motion-ia): Settings sem Anthropic, Gemini primary` | ⏳ |
| 1.5 | Backend ai-settings.js — remove rotas Anthropic | `backend/src/routes/ai-settings.js` | `refactor(backend): ai-settings sem Anthropic` | ⏳ |
| 1.6 | Skill `generateVideo` em skills.js (Seedance via fal.ai) | `plugin-ia/js/skills.js` + `plugin-ia/js/fal-client.js` (NOVO) | `feat(motion-ia): generateVideo via fal.ai/seedance` | ⏳ |
| 1.7 | UI feature "Gerar Vídeo IA" (substitui Biblioteca Stock) | `plugin-ia/js/features.js` + `plugin-ia/index.html` | `feat(motion-ia): Gerar Video IA UI` | ⏳ |
| 1.8 | Smoke validation local (sem rodar no Premiere) | — | — | ⏳ |
| 1.9 | Push branch + abre PR (user revisa) | git | `chore: push feat/motion-ia-v4` | ⏳ |

**Estimativa total Fase 1: 6-8h (em uma sessão).**

### **FASE 2 · AMANHÃ (depende de deploy + você)**

| # | Tarefa | Quem | Quando |
|---|--------|------|--------|
| 2.1 | Vercel reseta limite → redeploy backend | Você | ~10h |
| 2.2 | Criar 2 Stripe prices Solo separados (Titles Solo R$59,90 + Legendas Solo R$59,90) | Eu via script | pós-2.1 |
| 2.3 | Atualizar landing pra ter 2 botões "Comprar Titles" e "Comprar Legendas" | Eu | pós-2.2 |
| 2.4 | Reativar Motion IA + testar bateria fixes do dia anterior | Você + eu | pós-2.1 |
| 2.5 | Smoke E2E completo (compra Stripe test + ativa key + valida features) | Dashboard η + Backend β | pós-2.4 |
| 2.6 | Build ZIPs v4 SaaS-ready (Motion IA + Titles + Legendas) | Eu | final |

### **FASE 3 · SPRINT NOVA (deferred)**

- Inno Setup pra instalador .exe profissional
- Code signing certificate (R$1000/ano)
- Auto-update do plugin via metadata.json
- Cloudflare R2 hospedando Whisper models

---

## 🧪 GARANTIAS TÉCNICAS

### Anthropic → Gemini: o que muda

| Aspecto | Anthropic Claude | Gemini Flash 2.0 |
|---------|------------------|------------------|
| Endpoint | `api.anthropic.com/v1/messages` | `generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent` |
| Auth | header `x-api-key` | querystring `?key=` |
| Request | `{messages:[{role,content}]}` | `{contents:[{role:"user"\|"model", parts:[{text}]}]}` |
| Response | `response.content[0].text` | `response.candidates[0].content.parts[0].text` |
| Tool use | bloco `tool_use` no content | parts com `functionCall` |
| Tool result | bloco `tool_result` | parts com `functionResponse` |
| System prompt | campo `system:` top-level | `systemInstruction:` top-level |
| Custo input | $15/1M | $0.075/1M (200x menor) |
| Custo output | $75/1M | $0.30/1M (250x menor) |
| Visão vídeo | só frames manualmente | **MP4/MOV nativo** |

### fal.ai/Seedance: implementação

```javascript
// fal-client.js
async function generateVideoFromImage({ imagePath, prompt, duration, aspectRatio }) {
    // 1. Upload imagem via fal.ai storage endpoint (se imagem local)
    const imageUrl = await uploadToFal(imagePath);

    // 2. POST queue.fal.run/fal-ai/seedance/image-to-video
    const submission = await fetch("https://queue.fal.run/fal-ai/seedance/image-to-video", {
        method: "POST",
        headers: { "Authorization": "Key " + falKey, "Content-Type": "application/json" },
        body: JSON.stringify({
            input: { image_url: imageUrl, prompt, duration_seconds: duration, aspect_ratio: aspectRatio }
        })
    });
    const { request_id } = await submission.json();

    // 3. Poll status até COMPLETED (30-90s)
    let result;
    while (true) {
        const status = await fetch(`https://queue.fal.run/fal-ai/seedance/requests/${request_id}/status`, {
            headers: { "Authorization": "Key " + falKey }
        });
        const sJson = await status.json();
        if (sJson.status === "COMPLETED") { result = sJson; break; }
        if (sJson.status === "FAILED") throw new Error(sJson.error);
        await sleep(3000);
    }

    // 4. Download MP4
    const videoUrl = result.video.url;
    const localPath = path.join(os.homedir(), "Documents", "MotionIA-Generated", `seedance_${Date.now()}.mp4`);
    await downloadFile(videoUrl, localPath);

    // 5. Import in Premiere
    await hostCall("importFile", [localPath]);

    return { ok: true, path: localPath, video_url: videoUrl };
}
```

**Custo:** ~$0.10-0.50 por vídeo (BYOK fal.ai key, cliente paga próprio uso)
**Tempo:** 30-90s por geração
**Qualidade:** Seedance é state-of-the-art (ByteDance)

---

## ✅ COMO PROVAR QUE NÃO ESTOU FINGINDO

A cada commit eu:
1. Atualizo este `MOTION-IA-V4-PLAN.md` marcando ✅ na tarefa
2. Push pra `feat/motion-ia-v4` (você acompanha no GitHub)
3. Comento o que rodei + o que validei (lint? smoke local? grep?)

Se eu não conseguir uma tarefa, marco ❌ + explico **honestamente** por quê. Não vou maquiar.

---

## 🚦 ORDEM DE EXECUÇÃO ESTRITA

Vou começar **agora** pela tarefa 1.1 (fix bug crítico solo/duo — quick win 15 min) e seguir em ordem.

Se eu tiver que pausar, o estado fica visível no GitHub commits + neste arquivo.
