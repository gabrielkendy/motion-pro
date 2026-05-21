/* agent.js — Motion IA v2.0 agentic loop
 *
 * Recebe uma mensagem do user e roda um loop:
 *   1. Envia pro Claude com tool_definitions
 *   2. Se Claude pede tool_use → executa via ClaudeTools.execute → manda resultado de volta
 *   3. Repete até Claude dar resposta final (sem tool_use) OU max_iterations atingido
 *
 * UI hooks:
 *   onIter(n)                   — iteração N começou
 *   onText(textDelta)           — Claude tá escrevendo texto
 *   onToolStart(name, input)    — Claude pediu pra executar tool X
 *   onToolResult(name, ok, out) — resultado da tool
 *   onUsage(usage)              — tokens consumidos
 *   onDone(finalText, history)  — fim
 *   onError(err)                — erro
 *
 * Dependências:
 *   - ApiClient (faz GET/PUT no backend pra pegar config)
 *   - ClaudeTools (tools de execução)
 *   - localStorage com session_token
 */
(function (global) {
    "use strict";

    var API_BASE = (global.MV_CONFIG && global.MV_CONFIG.apiBaseUrl) || "https://motionpro.vercel.app";
    var KEY_CACHE = null;
    var KEY_CACHE_AT = 0;

    function sessionToken() {
        // Auth.js (Motion IA) usa "mv_session"
        return localStorage.getItem("mv_session") || localStorage.getItem("mia_session_token") || "";
    }

    async function fetchApiKey() {
        // cache curto (5min)
        if (KEY_CACHE && (Date.now() - KEY_CACHE_AT) < 5 * 60 * 1000) return KEY_CACHE;
        var token = sessionToken();
        if (!token) throw new Error("not_logged_in");
        var r = await fetch(API_BASE + "/v1/me/ai-settings/key", {
            headers: { "Authorization": "Bearer " + token }
        });
        if (r.status === 404) throw new Error("no_anthropic_key_configured");
        if (!r.ok) throw new Error("fetch_key_" + r.status);
        var j = await r.json();
        KEY_CACHE = j.key;
        KEY_CACHE_AT = Date.now();
        return KEY_CACHE;
    }
    function clearKeyCache() { KEY_CACHE = null; KEY_CACHE_AT = 0; }

    async function fetchSettings() {
        var token = sessionToken();
        if (!token) throw new Error("not_logged_in");
        var r = await fetch(API_BASE + "/v1/me/ai-settings", {
            headers: { "Authorization": "Bearer " + token }
        });
        if (!r.ok) throw new Error("settings_" + r.status);
        return await r.json();
    }

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

    /**
     * Roda agente até o fim.
     * opts: { message, history, callbacks, maxIterations }
     */
    async function run(opts) {
        var cb = opts.callbacks || {};
        var settings = await fetchSettings();
        if (!settings.anthropic_key_set) {
            throw new Error("Configure sua Anthropic API key em Configurações primeiro.");
        }
        var key = await fetchApiKey();
        var model = settings.model || "claude-sonnet-4-6";
        var maxTokens = settings.max_tokens || 4096;
        var maxIter = opts.maxIterations || 10;
        var systemPrompt = SYSTEM_PROMPT_BASE + (settings.custom_system ? ("\n\n" + settings.custom_system) : "");

        var tools = global.ClaudeTools ? global.ClaudeTools.getDefinitions() : [];

        // Conversation history (Claude format)
        var messages = (opts.history || []).slice();
        messages.push({ role: "user", content: opts.message });

        var finalText = "";
        var iter = 0;
        var totalUsage = { input_tokens: 0, output_tokens: 0 };

        while (iter < maxIter) {
            iter++;
            if (cb.onIter) cb.onIter(iter);

            // Chama Claude (header dangerous-direct-browser-access é OBRIGATÓRIO pra CEP/browser)
            var res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                    "anthropic-dangerous-direct-browser-access": "true",
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    model: model,
                    max_tokens: maxTokens,
                    system: systemPrompt,
                    tools: tools,
                    messages: messages
                })
            });

            if (res.status === 401) { clearKeyCache(); throw new Error("api_key_inválida"); }
            if (!res.ok) {
                var errText = await res.text();
                throw new Error("claude_http_" + res.status + ": " + errText.slice(0, 300));
            }
            var data = await res.json();
            if (data.usage) {
                totalUsage.input_tokens += data.usage.input_tokens || 0;
                totalUsage.output_tokens += data.usage.output_tokens || 0;
                if (cb.onUsage) cb.onUsage(totalUsage);
            }

            // Append assistant turn
            messages.push({ role: "assistant", content: data.content });

            // Coleta text + tool_use
            var textParts = [];
            var toolUses = [];
            (data.content || []).forEach(function (block) {
                if (block.type === "text") textParts.push(block.text);
                else if (block.type === "tool_use") toolUses.push(block);
            });
            var textChunk = textParts.join("\n");
            if (textChunk) {
                finalText += (finalText ? "\n\n" : "") + textChunk;
                if (cb.onText) cb.onText(textChunk);
            }

            // Sem tools = fim. stop_reason "end_turn" sempre vem sem tool_use; "tool_use"
            // vem com tools. Confiamos no array, não na string (evita silently descartar tools).
            if (toolUses.length === 0) {
                if (cb.onDone) cb.onDone(finalText, messages);
                return { reply: finalText, messages: messages, usage: totalUsage, iterations: iter };
            }

            // Executa tools em paralelo
            var toolResultBlocks = await Promise.all(toolUses.map(async function (tu) {
                if (cb.onToolStart) cb.onToolStart(tu.name, tu.input);
                try {
                    var out = await global.ClaudeTools.execute(tu.name, tu.input);
                    if (cb.onToolResult) cb.onToolResult(tu.name, true, out);

                    // MULTIMODAL: se tool retorna { images: [{base64, media_type}], ...resto }
                    // expande pra array de content blocks (text + image blocks).
                    if (out && typeof out === "object" && Array.isArray(out.images) && out.images.length > 0) {
                        var contentBlocks = [];
                        // Texto: JSON sem o array images (que vira blocks separados)
                        var meta = {};
                        for (var k in out) if (k !== "images") meta[k] = out[k];
                        contentBlocks.push({ type: "text", text: JSON.stringify(meta) });
                        // Imagens
                        out.images.forEach(function (img) {
                            if (img && img.base64) {
                                contentBlocks.push({
                                    type: "image",
                                    source: {
                                        type: "base64",
                                        media_type: img.media_type || "image/png",
                                        data: img.base64
                                    }
                                });
                            }
                        });
                        return {
                            type: "tool_result",
                            tool_use_id: tu.id,
                            content: contentBlocks
                        };
                    }

                    // Padrão: text
                    return {
                        type: "tool_result",
                        tool_use_id: tu.id,
                        content: typeof out === "string" ? out : JSON.stringify(out)
                    };
                } catch (e) {
                    if (cb.onToolResult) cb.onToolResult(tu.name, false, e.message);
                    return {
                        type: "tool_result",
                        tool_use_id: tu.id,
                        is_error: true,
                        content: "ERROR: " + e.message
                    };
                }
            }));

            // User turn com tool_results
            messages.push({ role: "user", content: toolResultBlocks });
        }

        // Atingiu maxIter. Se a última assistant turn tem tool_use, REMOVE
        // ela do histórico pra não deixar tool_use sem tool_result (Anthropic
        // rejeitaria a próxima chamada com 400).
        var last = messages[messages.length - 1];
        if (last && last.role === "assistant" && Array.isArray(last.content)) {
            var hasToolUse = last.content.some(function (b) { return b.type === "tool_use"; });
            if (hasToolUse) messages.pop();
        }
        if (cb.onDone) cb.onDone(finalText + "\n\n[parou em " + maxIter + " iterações — pode pedir 'continua' pra avançar]", messages);
        return { reply: finalText, messages: messages, usage: totalUsage, iterations: iter, stopped_at_max: true };
    }

    global.Agent = {
        run: run,
        fetchSettings: fetchSettings,
        fetchApiKey: fetchApiKey,
        clearKeyCache: clearKeyCache,
        SYSTEM_PROMPT_BASE: SYSTEM_PROMPT_BASE
    };
})(typeof window !== "undefined" ? window : globalThis);
