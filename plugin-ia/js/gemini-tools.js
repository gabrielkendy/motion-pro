/* gemini-tools.js — Motion IA v4
 *
 * Adapter sobre `claude-tools.js`. Reutiliza os handlers (executores) mas
 * converte as definitions do formato Anthropic tool-use pro formato Gemini
 * function calling.
 *
 * Diferença entre os formatos:
 *   Anthropic:  { name, description, input_schema: { type, properties, required } }
 *   Gemini:     { name, description, parameters:   { type, properties, required } }
 *
 * Como o JSON Schema é compatível em 99% dos casos, a conversão é trivial.
 * O que muda mais é o WRAPPER do array de tools:
 *
 *   Anthropic body:  { ..., tools: [ tool_definition, ... ] }
 *   Gemini body:     { ..., tools: [ { function_declarations: [ ... ] } ] }
 *
 * Esse módulo expõe:
 *   - GeminiTools.declarations()  → array no formato function_declarations
 *   - GeminiTools.executeCall(fnName, fnArgs) → roda o handler do claude-tools
 *     e retorna o resultado pronto pra mandar como functionResponse pro Gemini
 *   - GeminiTools.systemInstruction() → system prompt unificado
 *
 * Premissa: claude-tools.js já é carregado antes (mesma ordem no index.html).
 */
(function (global) {
    "use strict";

    if (!global.ClaudeTools) {
        console.error("[gemini-tools] ClaudeTools nao carregado. Inclua claude-tools.js antes de gemini-tools.js");
        return;
    }

    var CT = global.ClaudeTools;

    // ── CONVERSÃO definition Anthropic → Gemini ─────────────────────
    // Gemini é estrito com tipos: precisa ser maiusculo ("STRING", "OBJECT")
    // em algumas SDKs antigas; o REST API v1beta aceita ambos. Pra robustez,
    // mantemos lowercase (compatível com REST API generativelanguage v1beta).
    function convertSchema(schema) {
        if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
        var out = {
            type: schema.type || "object",
            properties: schema.properties || {}
        };
        if (schema.required) out.required = schema.required;
        if (schema.description) out.description = schema.description;
        // Gemini não aceita "additionalProperties" — remove se vier.
        return out;
    }

    function convertDefinition(def) {
        return {
            name: def.name,
            description: def.description || "",
            parameters: convertSchema(def.input_schema)
        };
    }

    // ── DECLARATIONS — array pronto pro Gemini ──────────────────────
    // ClaudeTools.getDefinitions() retorna [{ name, description, input_schema }, …]
    // (formato Anthropic). Convertemos cada um pro formato Gemini.
    function declarations() {
        var arr = (typeof CT.getDefinitions === "function") ? CT.getDefinitions() : [];
        return arr.map(convertDefinition);
    }

    // ── EXECUTE — wrapper que chama o ClaudeTools.execute ───────────
    // Reusa o executor existente; só padroniza o retorno (sem throw).
    async function executeCall(fnName, fnArgs) {
        if (typeof CT.execute !== "function") {
            return { error: "executor_missing" };
        }
        try {
            var result = await CT.execute(fnName, fnArgs || {});
            return result == null ? { ok: true } : result;
        } catch (e) {
            return { error: String(e && e.message || e) };
        }
    }

    // ── SYSTEM INSTRUCTION pro Gemini ───────────────────────────────
    // Prompt unificado pro agente Motion IA.
    function systemInstruction() {
        return (
            "Você é Motion IA — agente especialista em edição de vídeo no Adobe Premiere Pro. " +
            "Você tem acesso direto ao projeto do usuário via ferramentas (tools/function calling). " +
            "Sempre que precisar de informação do projeto, chame as tools em vez de inventar. " +
            "Quando o usuário pedir uma ação destrutiva (cortar, deletar, mutar), descreva o que vai " +
            "fazer ANTES de chamar a tool. " +
            "Quando aplicável, use duplicate_sequence pra criar backup antes de operações arriscadas. " +
            "Responda sempre em português brasileiro. Seja conciso, direto e útil. " +
            "Para edição em lote, prefira chamar várias tools em paralelo quando possível."
        );
    }

    // ── RESULT FORMATTING — Gemini espera Part.functionResponse ────
    // Constrói o part que vai no próximo turn do contents[]:
    //   { functionResponse: { name: fnName, response: { ... } } }
    function buildResponsePart(fnName, result) {
        // Gemini exige um objeto em "response". Wrap se for primitivo.
        var responseObj = (result && typeof result === "object" && !Array.isArray(result))
            ? result
            : { value: result };
        return {
            functionResponse: {
                name: fnName,
                response: responseObj
            }
        };
    }

    // ── PUBLIC API ──────────────────────────────────────────────────
    global.GeminiTools = {
        declarations:        declarations,
        executeCall:         executeCall,
        systemInstruction:   systemInstruction,
        buildResponsePart:   buildResponsePart,
        // exposto pra debugging / introspection
        convertDefinition:   convertDefinition,
        convertSchema:       convertSchema
    };

})(typeof window !== "undefined" ? window : globalThis);
