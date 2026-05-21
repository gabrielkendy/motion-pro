/* ia-client.js — cliente do motor VideoPro (Next.js localhost).
 *
 * REUSA O BACKEND EXISTENTE: `c:/Users/Gabriel/Downloads/VIDEO-PRO-IA/video-editor`
 * já tem TUDO funcionando — Anthropic, Groq Whisper, FFmpeg, Remotion, adb-mcp
 * bridge pra UXP do Premiere, 28 rotas API. Esse cliente só consome via SSE.
 *
 * Fluxo:
 *   1. POST http://localhost:3333/api/chat-premiere { message, history }
 *   2. Servidor responde com SSE (text/event-stream)
 *   3. Cada `data: {...}\n\n` é um evento:
 *        { type: "iter", value }
 *        { type: "text_delta", text }
 *        { type: "tool_start", tools: [name] }
 *        { type: "tool_done", tool, ok, summary }
 *        { type: "usage", usage: { input_tokens, output_tokens } }
 *        { type: "done", reply, actions }
 *        { type: "error", error }
 *
 * O backend já executa as tools — não precisa rodar nada no cliente.
 */
window.IAClient = (function () {

    var BASE = (window.MV_CONFIG && window.MV_CONFIG.videoEditorUrl) || "http://localhost:3333";
    var ADB_BASE = (window.MV_CONFIG && window.MV_CONFIG.adbProxyUrl) || "http://localhost:3001";
    var ENDPOINT = "/api/chat-premiere";

    // ───────────────── ping genérico com timeout ─────────────────
    async function pingUrl(url, timeoutMs) {
        timeoutMs = timeoutMs || 2500;
        var ctrl = new AbortController();
        var t = setTimeout(function () { ctrl.abort(); }, timeoutMs);
        try {
            var res = await fetch(url, { signal: ctrl.signal, mode: "cors" });
            clearTimeout(t);
            return { ok: res.ok || res.status < 500, status: res.status };
        } catch (e) {
            clearTimeout(t);
            return { ok: false, error: e.name === "AbortError" ? "timeout" : "offline" };
        }
    }

    // ───────────────── status do motor IA (Next.js localhost:3333) ─────────────────
    async function ping(timeoutMs) {
        timeoutMs = timeoutMs || 2500;
        var ctrl = new AbortController();
        var t = setTimeout(function () { ctrl.abort(); }, timeoutMs);
        try {
            var res = await fetch(BASE + "/api/status", { signal: ctrl.signal });
            clearTimeout(t);
            if (!res.ok) return { ok: false, error: "http_" + res.status };
            var d = await res.json().catch(function () { return {}; });
            return { ok: true, data: d };
        } catch (e) {
            clearTimeout(t);
            return { ok: false, error: e.name === "AbortError" ? "timeout" : (e.message || "connection_refused") };
        }
    }

    // ───────────────── status do adb-proxy (porta 3001) ─────────────────
    async function pingAdbProxy(timeoutMs) {
        return pingUrl(ADB_BASE + "/socket.io/?EIO=4&transport=polling", timeoutMs || 2000);
    }

    // ───────────────── status UXP plugin (via motor) ─────────────────
    // O motor expõe /api/diagnose-premiere que checa se UXP MCP Agent responde
    async function pingUxp(timeoutMs) {
        var ctrl = new AbortController();
        var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 3500);
        try {
            var res = await fetch(BASE + "/api/diagnose-premiere", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: "{}", signal: ctrl.signal
            });
            clearTimeout(t);
            if (!res.ok) return { ok: false, error: "http_" + res.status };
            var d = await res.json().catch(function () { return {}; });
            // diagnose-premiere retorna { ok: bool, ping: bool, project: ... }
            return { ok: !!(d && (d.ok || d.ping)), data: d };
        } catch (e) {
            clearTimeout(t);
            return { ok: false, error: e.name === "AbortError" ? "timeout" : "offline" };
        }
    }

    // ───────────────── checa os 3 ao mesmo tempo ─────────────────
    async function pingAll() {
        var motor = await ping(2500);
        // só checa os outros se motor estiver online (eles dependem dele)
        var adb = { ok: false, error: "motor_offline" };
        var uxp = { ok: false, error: "motor_offline" };
        if (motor.ok) {
            var results = await Promise.all([pingAdbProxy(2000), pingUxp(3500)]);
            adb = results[0]; uxp = results[1];
        }
        return { motor: motor, adbProxy: adb, uxp: uxp, allOnline: motor.ok && adb.ok && uxp.ok };
    }

    // ───────────────── parse SSE ─────────────────
    async function readSSE(response, onEvent) {
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buf = "";
        while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            buf += decoder.decode(chunk.value, { stream: true });
            // SSE: eventos separados por \n\n; linhas começando com "data: "
            var sepIdx;
            while ((sepIdx = buf.indexOf("\n\n")) >= 0) {
                var raw = buf.slice(0, sepIdx);
                buf = buf.slice(sepIdx + 2);
                var lines = raw.split("\n");
                var dataLines = [];
                for (var i = 0; i < lines.length; i++) {
                    if (lines[i].indexOf("data: ") === 0) dataLines.push(lines[i].slice(6));
                }
                if (dataLines.length) {
                    try { onEvent(JSON.parse(dataLines.join("\n"))); }
                    catch (e) { /* event malformado, ignora */ }
                }
            }
        }
    }

    /**
     * Envia uma mensagem ao motor IA e processa o stream.
     * onProgress(event) recebe cada evento SSE em tempo real.
     * Resolve com { reply, actions, usage } no done.
     */
    async function chat(userMessage, history, onProgress) {
        if (!userMessage || !userMessage.trim()) throw new Error("Mensagem vazia");

        var res;
        try {
            res = await fetch(BASE + ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
                body: JSON.stringify({ message: userMessage, history: history || [] })
            });
        } catch (e) {
            throw new Error("Motor IA offline (localhost:3333). Inicie pelo botão ⚙ na barra ou rode start-videopro.cmd.");
        }
        if (!res.ok) {
            var errBody = await res.text().catch(function () { return ""; });
            throw new Error("Motor retornou " + res.status + ": " + errBody.slice(0, 200));
        }
        if (!res.body || !res.body.getReader) {
            throw new Error("Stream SSE não suportado neste CEP");
        }

        var reply = "";
        var actions = [];
        var usage = null;
        var doneSeen = false;
        var errorSeen = null;

        await readSSE(res, function (ev) {
            if (onProgress) onProgress(ev);
            switch (ev.type) {
                case "text_delta": reply += ev.text || ""; break;
                case "usage":      usage = ev.usage; break;
                case "done":       doneSeen = true; reply = ev.reply || reply; actions = ev.actions || []; break;
                case "error":      errorSeen = ev.error || "stream_error"; break;
            }
        });

        if (errorSeen) throw new Error(errorSeen);
        if (!doneSeen) throw new Error("Stream encerrou sem evento 'done'");

        return { reply: reply, actions: actions, usage: usage };
    }

    return {
        ping: ping,
        pingAdbProxy: pingAdbProxy,
        pingUxp: pingUxp,
        pingAll: pingAll,
        chat: chat,
        BASE: BASE,
        ADB_BASE: ADB_BASE
    };
})();
