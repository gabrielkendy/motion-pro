/* agent.js — Motion IA v4 (Gemini Flash 2.0)
 *
 * Refatorado em 2026-05-21: tirou Anthropic Claude, agora roda 100% no Gemini
 * Flash 2.0 da Google. Razões:
 *   - Custo 200x menor (Claude Opus $15/$75 vs Gemini Flash $0.075/$0.30 por 1M)
 *   - 1500 requests/dia GRÁTIS no free tier
 *   - Contexto 1M tokens (vs 200K Claude)
 *   - Visão de vídeo NATIVA (analisa MP4/MOV direto, não só frames)
 *   - Function calling robusto (compatível com nossas 24 tools via gemini-tools adapter)
 *
 * Recebe uma mensagem do user e roda um loop:
 *   1. Envia pro Gemini com function_declarations
 *   2. Se Gemini pede functionCall → executa via GeminiTools.executeCall → manda functionResponse de volta
 *   3. Repete até Gemini dar resposta final (sem functionCall) OU max_iterations atingido
 *
 * UI hooks (mesma API do v2 — outros arquivos não precisam mudar):
 *   onIter(n)                   — iteração N começou
 *   onText(textDelta)           — Gemini tá escrevendo texto
 *   onToolStart(name, input)    — Gemini pediu pra executar tool X
 *   onToolResult(name, ok, out) — resultado da tool
 *   onUsage(usage)              — tokens consumidos
 *   onDone(finalText, history)  — fim
 *   onError(err)                — erro
 *
 * Dependências:
 *   - GeminiClient (gemini-client.js · armazena key localStorage)
 *   - GeminiTools  (gemini-tools.js · adapter sobre ClaudeTools)
 *   - ClaudeTools  (claude-tools.js · handlers das 24 tools — nome preservado pra retrocompat)
 */
(function (global) {
    "use strict";

    var GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
    var DEFAULT_MODEL = "gemini-2.0-flash";

    // ── KEY MANAGEMENT ───────────────────────────────────────────────
    // Em v4 não usamos mais backend pra armazenar chave Gemini — GeminiClient
    // lê direto do localStorage (mia_gemini_key). User configura no Settings.
    function getGeminiKey() {
        if (global.GeminiClient && typeof global.GeminiClient.hasKey === "function" && global.GeminiClient.hasKey()) {
            // GeminiClient expõe a key via getKey OU via _key — tentamos ambos
            if (typeof global.GeminiClient.getKey === "function") return global.GeminiClient.getKey();
            return localStorage.getItem("mia_gemini_key") || "";
        }
        return localStorage.getItem("mia_gemini_key") || "";
    }
    function clearKeyCache() { /* no-op: chave fica em localStorage, não cacheamos em RAM */ }

    // ── SETTINGS (model + max_tokens + custom_system) ───────────────
    // Em v4 settings ainda podem vir do backend (modelo escolhido, max_tokens
    // customizado) mas a key Gemini é client-side. Se backend offline, usa defaults.
    var API_BASE = (global.MV_CONFIG && global.MV_CONFIG.apiBaseUrl) || "https://motionpro.vercel.app";

    function sessionToken() {
        return localStorage.getItem("mv_session") || localStorage.getItem("mia_session_token") || "";
    }

    async function fetchSettings() {
        var token = sessionToken();
        if (!token) {
            // Sem token, retorna defaults — não é fatal pq a key tá no localStorage
            return { model: DEFAULT_MODEL, max_tokens: 4096, gemini_key_set: true };
        }
        try {
            var r = await fetch(API_BASE + "/v1/me/ai-settings", {
                headers: { "Authorization": "Bearer " + token }
            });
            if (!r.ok) return { model: DEFAULT_MODEL, max_tokens: 4096, gemini_key_set: true };
            return await r.json();
        } catch (e) {
            return { model: DEFAULT_MODEL, max_tokens: 4096, gemini_key_set: true };
        }
    }

    // ── SYSTEM PROMPT ────────────────────────────────────────────────
    var SYSTEM_PROMPT_BASE = [
        "Você é Motion IA — um EDITOR DE VÍDEO experiente operando dentro do Adobe Premiere Pro.",
        "Você não é um executor cego — você é um EDITOR que ENTENDE o vídeo antes de cortar.",
        "",
        "═══════════════ WORKFLOW EDITORIAL OBRIGATÓRIO ═══════════════",
        "Quando o user pede pra editar (cortar, melhorar, criar shorts, etc), você SEMPRE segue 4 fases:",
        "",
        "1. UNDERSTAND — chame `skill_understand_video` PRIMEIRO.",
        "   Isso te dá: transcript do áudio + 6 frames do vídeo (você VAI VER as imagens — vision multimodal).",
        "   Com isso você sabe o que tá sendo FALADO e o que tá SENDO MOSTRADO.",
        "",
        "2. ANALYZE — leia o transcript e olhe os frames. Identifique:",
        "   • Tipo de conteúdo (entrevista? vlog? tutorial? podcast? tutorial de tela?)",
        "   • Pontos fortes (insights, frases marcantes, momentos visuais bons)",
        "   • Problemas (silêncios longos, fillers tipo 'éé/ahn', repetições, áudio fraco, baixa luz)",
        "   • Visual: cores dominantes, iluminação, composição, possível necessidade de color grade",
        "",
        "3. PROPOSE — apresente 2-3 OPÇÕES concretas de edição. Cada uma com:",
        "   • Nome curto (ex: 'Cortar gorduras', 'Versão TikTok 60s', 'Highlight reel')",
        "   • O que faria (em 2-3 linhas)",
        "   • Tempo estimado de execução",
        "   • Timestamps específicos quando relevante",
        "   PARE aqui e PERGUNTE qual opção o user quer.",
        "",
        "4. EXECUTE — só APÓS aprovação. Antes de operação destrutiva (>3 cortes, deletar range >5s):",
        "   chame `duplicate_sequence` pra backup. Depois execute via tools (add_cuts_at, delete_ranges, etc).",
        "",
        "═══════════════ REGRAS TÉCNICAS ═══════════════",
        "• Para perguntas factuais simples ('quantos clips?', 'qual a duração?') → use `get_context` e responda. Não precisa workflow editorial completo.",
        "• Para PEDIDOS DE EDIÇÃO → workflow editorial OBRIGATÓRIO (4 fases).",
        "• Para skills 1-click que o user clicou (skill_cut_silences) → execute direto, é intenção explícita.",
        "• Se `motor_offline` em transcribe/silences → continue só com visão dos frames. Explique limitação.",
        "• Se `skill_understand_video` retornar frames_count=0 → exportFrame quebrou. Reporte e siga só com transcript.",
        "• NUNCA invente caminhos de arquivo — sempre pegue do contexto.",
        "",
        "═══════════════ ESTILO ═══════════════",
        "PT-BR, direto, prático. Use vocabulário de editor: 'jump cut', 'B-roll', 'beat', 'pacing', 'ritmo', 'gordura', 'highlight'.",
        "Quando descrever frames, seja específico: 'No frame em 0:12 vejo a pessoa olhando pra direita, luz lateral, fundo escuro'.",
        "Mostre NÚMEROS concretos no execute: 'X cortes, Y segundos removidos, duração: A→B'."
    ].join("\n");

    // ── HISTORY FORMAT ───────────────────────────────────────────────
    // Histórico interno usa formato Gemini (contents[]). A UI pode passar
    // history no formato { role: "user"|"model", parts: [...] } ou no formato
    // antigo Anthropic { role: "user"|"assistant", content: ... } — normalizamos.
    function normalizeMessage(msg) {
        if (!msg || typeof msg !== "object") return null;
        var role = msg.role;
        // Anthropic legacy → Gemini
        if (role === "assistant") role = "model";

        // Se já tem parts[], confiamos
        if (Array.isArray(msg.parts)) {
            return { role: role || "user", parts: msg.parts };
        }
        // Anthropic content (array de blocks ou string)
        if (msg.content !== undefined) {
            var parts = [];
            if (typeof msg.content === "string") {
                parts.push({ text: msg.content });
            } else if (Array.isArray(msg.content)) {
                msg.content.forEach(function (block) {
                    if (typeof block === "string") {
                        parts.push({ text: block });
                    } else if (block && block.type === "text") {
                        parts.push({ text: block.text || "" });
                    }
                    // tool_use / tool_result legacy ficam descartados na normalização —
                    // só é relevante se vier de Anthropic e a gente tá migrando.
                });
            }
            return { role: role || "user", parts: parts };
        }
        return null;
    }

    /**
     * Roda agente até o fim.
     * opts: { message, history, callbacks, maxIterations }
     */
    async function run(opts) {
        var cb = opts.callbacks || {};
        var settings = await fetchSettings();

        var key = getGeminiKey();
        if (!key) {
            throw new Error("Configure sua Google Gemini API key em Configurações primeiro. Gratuita em aistudio.google.com/app/apikey");
        }

        var model = settings.model || DEFAULT_MODEL;
        // Garante que é um modelo Gemini (legado pode ter "claude-sonnet-4-6" salvo)
        if (!/^gemini/i.test(model)) {
            model = DEFAULT_MODEL;
        }
        var maxOutputTokens = settings.max_tokens || 4096;
        var maxIter = opts.maxIterations || 10;
        var systemText = SYSTEM_PROMPT_BASE + (settings.custom_system ? ("\n\n" + settings.custom_system) : "");

        var declarations = global.GeminiTools ? global.GeminiTools.declarations() : [];

        // Conversation history — Gemini format { role: "user"|"model", parts: [...] }
        var contents = (opts.history || [])
            .map(normalizeMessage)
            .filter(Boolean);
        contents.push({ role: "user", parts: [{ text: opts.message }] });

        var finalText = "";
        var iter = 0;
        var totalUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

        while (iter < maxIter) {
            iter++;
            if (cb.onIter) cb.onIter(iter);

            // ── CHAMA GEMINI ─────────────────────────────────────────
            var url = GEMINI_BASE + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
            var body = {
                contents: contents,
                systemInstruction: { parts: [{ text: systemText }] },
                generationConfig: {
                    maxOutputTokens: maxOutputTokens,
                    temperature: 0.7
                }
            };
            if (declarations.length > 0) {
                body.tools = [{ functionDeclarations: declarations }];
                body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
            }

            var res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });

            if (res.status === 401 || res.status === 403) {
                clearKeyCache();
                throw new Error("api_key_invalida_ou_sem_permissao (Gemini)");
            }
            if (!res.ok) {
                var errText = await res.text();
                throw new Error("gemini_http_" + res.status + ": " + errText.slice(0, 400));
            }
            var data = await res.json();

            // Bloqueios de safety vêm como promptFeedback.blockReason
            if (data.promptFeedback && data.promptFeedback.blockReason) {
                throw new Error("gemini_blocked: " + data.promptFeedback.blockReason);
            }

            if (data.usageMetadata) {
                totalUsage.input_tokens  += data.usageMetadata.promptTokenCount || 0;
                totalUsage.output_tokens += data.usageMetadata.candidatesTokenCount || 0;
                totalUsage.total_tokens  += data.usageMetadata.totalTokenCount || 0;
                if (cb.onUsage) cb.onUsage(totalUsage);
            }

            // Pega o primeiro candidato (Gemini pode retornar múltiplos com candidateCount > 1)
            var candidate = (data.candidates && data.candidates[0]) || null;
            if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
                // Sem conteúdo — pode ser finishReason: "RECITATION" ou "SAFETY"
                var finishReason = candidate ? candidate.finishReason : "NO_CANDIDATE";
                if (cb.onText) cb.onText("(Gemini não retornou conteúdo · " + finishReason + ")");
                break;
            }

            // Append assistant turn (Gemini: role=model)
            contents.push({ role: "model", parts: candidate.content.parts });

            // Coleta text + functionCall
            var textParts = [];
            var functionCalls = [];
            candidate.content.parts.forEach(function (part) {
                if (part.text) textParts.push(part.text);
                else if (part.functionCall) functionCalls.push(part.functionCall);
            });
            var textChunk = textParts.join("\n");
            if (textChunk) {
                finalText += (finalText ? "\n\n" : "") + textChunk;
                if (cb.onText) cb.onText(textChunk);
            }

            // Sem tool calls = fim
            if (functionCalls.length === 0) {
                if (cb.onDone) cb.onDone(finalText, contents);
                return { reply: finalText, messages: contents, usage: totalUsage, iterations: iter };
            }

            // ── EXECUTA TOOL CALLS EM PARALELO ──────────────────────
            var responseParts = await Promise.all(functionCalls.map(async function (fc) {
                var fname = fc.name;
                var fargs = fc.args || {};
                if (cb.onToolStart) cb.onToolStart(fname, fargs);
                try {
                    var out = await global.GeminiTools.executeCall(fname, fargs);
                    if (cb.onToolResult) cb.onToolResult(fname, !(out && out.error), out);

                    // MULTIMODAL: se tool retorna { images: [{base64, media_type}], ...resto }
                    // expande pra MÚLTIPLOS parts (functionResponse + inline_data images).
                    // Diferente do Anthropic, no Gemini imagens não vão dentro do tool_result —
                    // a gente joga elas como user parts auxiliares antes do próximo turn.
                    if (out && typeof out === "object" && Array.isArray(out.images) && out.images.length > 0) {
                        var meta = {};
                        for (var k in out) if (k !== "images") meta[k] = out[k];

                        // Primeiro: functionResponse com metadata
                        var parts = [
                            global.GeminiTools.buildResponsePart(fname, meta)
                        ];
                        // Depois: as imagens como inline_data
                        out.images.forEach(function (img) {
                            if (img && img.base64) {
                                parts.push({
                                    inline_data: {
                                        mime_type: img.media_type || "image/png",
                                        data: img.base64
                                    }
                                });
                            }
                        });
                        return parts;
                    }

                    // Padrão: 1 functionResponse part
                    return [ global.GeminiTools.buildResponsePart(fname, out) ];
                } catch (e) {
                    if (cb.onToolResult) cb.onToolResult(fname, false, e.message);
                    return [ global.GeminiTools.buildResponsePart(fname, { error: e.message }) ];
                }
            }));

            // Achata array de arrays e adiciona como user turn com functionResponse
            var flatParts = [].concat.apply([], responseParts);
            contents.push({ role: "user", parts: flatParts });
        }

        // Atingiu maxIter. Se a última model turn tem functionCall sem response,
        // remove ela pra não confundir o próximo turn.
        var last = contents[contents.length - 1];
        if (last && last.role === "model" && Array.isArray(last.parts)) {
            var hasFunctionCall = last.parts.some(function (p) { return !!p.functionCall; });
            if (hasFunctionCall) contents.pop();
        }
        if (cb.onDone) cb.onDone(finalText + "\n\n[parou em " + maxIter + " iterações — pode pedir 'continua' pra avançar]", contents);
        return { reply: finalText, messages: contents, usage: totalUsage, iterations: iter, stopped_at_max: true };
    }

    global.Agent = {
        run: run,
        fetchSettings: fetchSettings,
        clearKeyCache: clearKeyCache,
        SYSTEM_PROMPT_BASE: SYSTEM_PROMPT_BASE,
        // backward-compat: alguns lugares chamam fetchApiKey
        fetchApiKey: function () { return Promise.resolve(getGeminiKey()); }
    };
})(typeof window !== "undefined" ? window : globalThis);
