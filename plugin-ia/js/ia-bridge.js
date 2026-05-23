/* ia-bridge.js — SSE bridge entre painel CEP e Motion IA local agent.
 *
 * Agente η · Onda 5 · 2026-05-23
 *
 * Responsabilidades:
 *   1. Discovery do agente em localhost: tenta PORTS em ordem, primeiro /health
 *      que responder 200 dentro de HEALTH_TIMEOUT_MS vira o port ativo.
 *   2. Abre EventSource em /sse e re-emite os eventos como CustomEvent no
 *      document (prefixo "mvia:"). UI escuta com document.addEventListener.
 *   3. POST /command devolve Promise. Cada request tem request_id (uuid v4).
 *   4. Health-check periódico (30s) — se cair, dispara mvia:service-down +
 *      reconnect com backoff exponencial (1,2,4,8,16,30s).
 *   5. tryLaunchService() — fallback Windows: tenta abrir MotionIA.exe via
 *      cep.process.createProcess; se path não existe, dispara
 *      mvia:service-install-needed pra UI mostrar modal de download.
 *
 * NÃO depende de host.jsx — pura comunicação HTTP/SSE com agente local.
 * Exposto como window.IaBridge.
 */
(function () {
    "use strict";

    var PORTS = [3333, 3334, 3335];
    var HEALTH_TIMEOUT_MS = 3000;
    var RECONNECT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];
    var HEALTH_INTERVAL_MS = 30000;
    var SSE_EVENT_TYPES = ["transcript-chunk", "ffmpeg-progress", "agent-message", "tool-call"];
    var SERVICE_INSTALLER_URL = "https://download.pacotesfx.com/motion-ia-service.exe";
    var WINDOWS_DEFAULT_PATH = "C:\\Program Files\\MotionIA\\MotionIA.exe";

    // ── state ───────────────────────────────────────────────────────────────
    var es = null;                 // EventSource ativo
    var currentPort = null;
    var connecting = false;
    var reconnectAttempt = 0;
    var reconnectTimer = null;
    var healthTimer = null;

    // ── utils ───────────────────────────────────────────────────────────────
    function uuidv4() {
        // RFC4122 v4 — usa crypto.getRandomValues se disponível, senão Math.random
        function rand16() {
            if (typeof crypto !== "undefined" && crypto.getRandomValues) {
                var arr = new Uint8Array(16);
                crypto.getRandomValues(arr);
                return arr;
            }
            var fallback = [];
            for (var i = 0; i < 16; i++) fallback.push(Math.floor(Math.random() * 256));
            return fallback;
        }
        var b = rand16();
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        function hex(n) { var s = n.toString(16); return s.length === 1 ? "0" + s : s; }
        return hex(b[0]) + hex(b[1]) + hex(b[2]) + hex(b[3]) + "-" +
               hex(b[4]) + hex(b[5]) + "-" +
               hex(b[6]) + hex(b[7]) + "-" +
               hex(b[8]) + hex(b[9]) + "-" +
               hex(b[10]) + hex(b[11]) + hex(b[12]) + hex(b[13]) + hex(b[14]) + hex(b[15]);
    }

    function emit(eventName, detail) {
        try {
            var ev = new CustomEvent("mvia:" + eventName, { detail: detail });
            document.dispatchEvent(ev);
        } catch (e) {
            console.warn("[ia-bridge] dispatch fail", eventName, e && e.message);
        }
    }

    function logI(msg) { console.log("[ia-bridge] " + msg); }
    function logW(msg) { console.warn("[ia-bridge] " + msg); }
    function logE(msg) { console.error("[ia-bridge] " + msg); }

    // ── HTTP helpers ────────────────────────────────────────────────────────
    function fetchWithTimeout(url, opts, timeoutMs) {
        opts = opts || {};
        // AbortController disponível em CEF 7+ (verificar) — fallback Promise.race
        if (typeof AbortController !== "undefined") {
            var ctrl = new AbortController();
            var to = setTimeout(function () { ctrl.abort(); }, timeoutMs);
            opts.signal = ctrl.signal;
            return fetch(url, opts).then(function (r) {
                clearTimeout(to);
                return r;
            }, function (e) {
                clearTimeout(to);
                throw e;
            });
        }
        // Fallback sem AbortController
        return new Promise(function (resolve, reject) {
            var done = false;
            var to = setTimeout(function () {
                if (done) return;
                done = true;
                reject(new Error("timeout"));
            }, timeoutMs);
            fetch(url, opts).then(function (r) {
                if (done) return;
                done = true;
                clearTimeout(to);
                resolve(r);
            }, function (e) {
                if (done) return;
                done = true;
                clearTimeout(to);
                reject(e);
            });
        });
    }

    function healthCheck(port) {
        var url = "http://localhost:" + port + "/health";
        return fetchWithTimeout(url, { method: "GET" }, HEALTH_TIMEOUT_MS)
            .then(function (r) { return r && r.ok ? port : null; })
            .catch(function () { return null; });
    }

    // Tenta os ports em série; primeiro 200 vence.
    function discoverPort() {
        var chain = Promise.resolve(null);
        PORTS.forEach(function (p) {
            chain = chain.then(function (winner) {
                if (winner) return winner;
                return healthCheck(p);
            });
        });
        return chain;
    }

    // ── SSE ─────────────────────────────────────────────────────────────────
    function openSse(port) {
        try {
            es = new EventSource("http://localhost:" + port + "/sse");
        } catch (e) {
            logE("EventSource construct fail: " + (e && e.message));
            scheduleReconnect();
            return;
        }

        es.onopen = function () {
            reconnectAttempt = 0;
            logI("SSE open on port " + port);
            emit("connected", { port: port });
        };

        es.onerror = function (e) {
            logW("SSE error on port " + port + " (readyState=" + (es && es.readyState) + ")");
            // EventSource auto-reconecta no readyState=0; só intervimos se CLOSED (2)
            if (es && es.readyState === 2) {
                emit("service-down", { port: port, reason: "sse_closed" });
                disconnect();
                scheduleReconnect();
            }
        };

        // Default "message" (eventos sem `event:` no payload)
        es.onmessage = function (ev) {
            var parsed;
            try { parsed = JSON.parse(ev.data); } catch (_) { parsed = { raw: ev.data }; }
            emit("message", parsed);
        };

        // Eventos tipados
        for (var i = 0; i < SSE_EVENT_TYPES.length; i++) {
            (function (evtName) {
                es.addEventListener(evtName, function (ev) {
                    var parsed;
                    try { parsed = JSON.parse(ev.data); } catch (_) { parsed = { raw: ev.data }; }
                    emit(evtName, parsed);
                });
            })(SSE_EVENT_TYPES[i]);
        }
    }

    // ── connect / disconnect ────────────────────────────────────────────────
    function connect() {
        if (connecting || es) return Promise.resolve(es ? currentPort : null);
        connecting = true;

        return discoverPort().then(function (port) {
            connecting = false;
            if (!port) {
                logW("nenhum port respondeu /health — agendando retry");
                emit("service-down", { reason: "no_port_responded" });
                scheduleReconnect();
                tryLaunchService(); // best-effort
                return null;
            }
            currentPort = port;
            logI("port discovered: " + port);
            openSse(port);
            startHealthMonitor();
            return port;
        }, function (e) {
            connecting = false;
            logE("discoverPort threw: " + (e && e.message));
            scheduleReconnect();
            return null;
        });
    }

    function disconnect() {
        if (es) {
            try { es.close(); } catch (_) {}
            es = null;
        }
        stopHealthMonitor();
        // currentPort fica setado pra retry tentar o mesmo primeiro
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        var delay = RECONNECT_BACKOFF[Math.min(reconnectAttempt, RECONNECT_BACKOFF.length - 1)];
        reconnectAttempt++;
        logI("reconnect in " + delay + "ms (attempt " + reconnectAttempt + ")");
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connect();
        }, delay);
    }

    // ── Health monitor periódico ────────────────────────────────────────────
    function startHealthMonitor() {
        stopHealthMonitor();
        healthTimer = setInterval(function () {
            if (!currentPort) return;
            healthCheck(currentPort).then(function (ok) {
                if (!ok) {
                    logW("health ping failed on port " + currentPort);
                    emit("service-down", { port: currentPort, reason: "health_failed" });
                    disconnect();
                    scheduleReconnect();
                }
            });
        }, HEALTH_INTERVAL_MS);
    }

    function stopHealthMonitor() {
        if (healthTimer) {
            clearInterval(healthTimer);
            healthTimer = null;
        }
    }

    // ── sendCommand ─────────────────────────────────────────────────────────
    function sendCommand(type, payload) {
        if (!currentPort) {
            return Promise.reject(new Error("not_connected"));
        }
        var body = {
            type: type,
            payload: payload || {},
            request_id: uuidv4()
        };
        var url = "http://localhost:" + currentPort + "/command";
        return fetchWithTimeout(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }, 30000).then(function (r) {
            if (!r.ok) throw new Error("command_http_" + r.status);
            return r.json();
        });
    }

    // ── tryLaunchService (Windows fallback) ─────────────────────────────────
    function tryLaunchService() {
        if (typeof window === "undefined" || typeof window.cep === "undefined") {
            logW("cep API indisponível — não posso lançar serviço");
            emit("service-install-needed", { url: SERVICE_INSTALLER_URL, reason: "no_cep_api" });
            return;
        }
        var cep = window.cep;
        if (!cep.process || typeof cep.process.createProcess !== "function") {
            logW("cep.process.createProcess indisponível");
            emit("service-install-needed", { url: SERVICE_INSTALLER_URL, reason: "no_create_process" });
            return;
        }

        // Verifica se exe existe (cep.fs.stat)
        var exists = false;
        try {
            if (cep.fs && typeof cep.fs.stat === "function") {
                var st = cep.fs.stat(WINDOWS_DEFAULT_PATH);
                exists = !!(st && st.err === 0);
            } else {
                // Sem fs.stat — tenta criar processo e vê se exitCode != 0
                exists = true;
            }
        } catch (_) { exists = false; }

        if (!exists) {
            logW("MotionIA.exe não encontrado em " + WINDOWS_DEFAULT_PATH);
            emit("service-install-needed", { url: SERVICE_INSTALLER_URL, reason: "exe_not_found" });
            return;
        }

        try {
            var proc = cep.process.createProcess(WINDOWS_DEFAULT_PATH);
            // createProcess retorna pid em sucesso; err em falha. Convenção varia por CEP version.
            if (!proc || (typeof proc.err !== "undefined" && proc.err !== 0)) {
                logW("createProcess falhou");
                emit("service-install-needed", { url: SERVICE_INSTALLER_URL, reason: "spawn_failed" });
                return;
            }
            logI("MotionIA.exe lançado — aguardando /health");
            // Não conecta direto — deixa o backoff de reconnect tentar.
        } catch (e) {
            logE("createProcess throw: " + (e && e.message));
            emit("service-install-needed", { url: SERVICE_INSTALLER_URL, reason: "spawn_exception" });
        }
    }

    // ── Public API ──────────────────────────────────────────────────────────
    window.IaBridge = {
        connect: connect,
        disconnect: disconnect,
        sendCommand: sendCommand,
        isConnected: function () { return !!(es && es.readyState === 1); },
        currentPort: function () { return currentPort; },
        tryLaunchService: tryLaunchService
    };

    // Auto-start
    if (document.readyState !== "loading") {
        connect();
    } else {
        document.addEventListener("DOMContentLoaded", function () { connect(); });
    }
})();
