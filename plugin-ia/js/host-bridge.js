/* host-bridge.js — wrapper Promise-based em volta do CSInterface.evalScript.
 *
 * Cada função aqui chama uma função MotionProIA.* em jsx/host.jsx e devolve
 * sempre uma Promise que resolve com o JSON parseado. Erros do ExtendScript
 * viram exception JavaScript (com .message).
 *
 * BOOTSTRAP ROBUSTO (Agente α · fix host.jsx):
 *   1. Pré-flight: testa `1+1` antes de qualquer evalFile — se ExtendScript
 *      engine está morto, evita poluir log com tentativas inúteis.
 *   2. Retry com backoff exponencial: 1s, 2s, 4s, 8s (≈15s no total).
 *   3. Hard timeout de 30s pro bootstrap inteiro.
 *   4. Fallback fs.readFileSync + evalScript(src) se evalFile falhar
 *      (cobre bugs de path/encoding/ScriptPath race).
 *   5. Log forense estruturado por attempt — pega tudo que o botão
 *      🩺 Diagnóstico técnico precisa pra debug.
 *   6. getLastError() público pro Diagnóstico exibir estado real.
 */
window.HostBridge = (function () {
    var cs = new CSInterface();
    var bootstrapped = false;
    var bootstrapPromise = null;
    var lastError = null;       // { stage, attempt, raw, elapsed_ms, ts }
    var bootstrapAttempts = []; // histórico pro Diagnóstico

    var BOOTSTRAP_MAX_ATTEMPTS = 4;          // 1s + 2s + 4s + 8s = 15s
    var BOOTSTRAP_HARD_TIMEOUT_MS = 30000;   // teto absoluto
    var PRE_FLIGHT_SCRIPT = "1+1";           // se Engine não responder "2", está morto

    function nowMs() { return (new Date()).getTime(); }

    function sleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    // Promise wrapper "raw" do evalScript — não interpreta resultado.
    function evalRaw(script) {
        return new Promise(function (resolve) {
            try {
                cs.evalScript(script, function (raw) { resolve(raw); });
            } catch (e) {
                resolve("__throw__:" + (e && e.message ? e.message : String(e)));
            }
        });
    }

    // Pré-flight: garante que ExtendScript engine responde "2" pra "1+1".
    // Se não responder, o motor inteiro está caído — qualquer evalFile vai falhar.
    function preFlight() {
        return evalRaw(PRE_FLIGHT_SCRIPT).then(function (raw) {
            var ok = (raw === "2");
            return { ok: ok, raw: raw };
        });
    }

    // Tenta carregar host.jsx via $.evalFile. Retorna { ok, stage, raw }.
    function tryEvalFile(extPath) {
        var jsxPath = (extPath + "/jsx/host.jsx").replace(/\\/g, "/");
        var safePath = jsxPath.replace(/'/g, "\\'");
        var script =
            "(function(){" +
            "  try {" +
            "    var f = File('" + safePath + "');" +
            "    if (!f.exists) return 'file_not_found:' + f.fsName;" +
            "    $.evalFile(f);" +
            "    if ($.global.MotionProIA && typeof $.global.MotionProIA.ping === 'function') return 'ok';" +
            "    if (typeof MotionProIA !== 'undefined' && typeof MotionProIA.ping === 'function') return 'ok_local';" +
            "    return 'no_registration:fileName=' + $.fileName;" +
            "  } catch(e) { return 'exception:' + (e.message || e); }" +
            "})()";
        return evalRaw(script).then(function (raw) {
            return { ok: (raw === "ok" || raw === "ok_local"), stage: "evalFile", raw: raw, path: jsxPath };
        });
    }

    // Fallback: lê arquivo via Node fs e avalia o source como string.
    // Cobre H5 (encoding/BOM) e qualquer issue com File()/$.evalFile().
    function tryReadAndEval(extPath) {
        var jsxPath = (extPath + "/jsx/host.jsx").replace(/\\/g, "/");
        var src;
        try {
            if (typeof require !== "function") {
                return Promise.resolve({ ok: false, stage: "readEval", raw: "no_node_require", path: jsxPath });
            }
            var fs = require("fs");
            src = fs.readFileSync(jsxPath, "utf8");
            // Strip BOM se presente (defensivo)
            if (src.charCodeAt(0) === 0xFEFF) src = src.substring(1);
        } catch (e) {
            return Promise.resolve({ ok: false, stage: "readEval", raw: "read_error:" + (e && e.message), path: jsxPath });
        }
        // Encapsula em IIFE de verificação no mesmo evalScript pra checar registro atomicamente
        var verify = ";(function(){ if ($.global.MotionProIA && typeof $.global.MotionProIA.ping === 'function') return 'ok'; if (typeof MotionProIA !== 'undefined' && typeof MotionProIA.ping === 'function') return 'ok_local'; return 'no_registration_after_eval'; })()";
        return evalRaw(src + verify).then(function (raw) {
            return { ok: (raw === "ok" || raw === "ok_local"), stage: "readEval", raw: raw, path: jsxPath };
        });
    }

    function recordAttempt(rec) {
        bootstrapAttempts.push(rec);
        if (rec.ok) {
            console.log("[host-bridge] ✓ attempt #" + rec.attempt + " (" + rec.stage + ") ok in " + rec.elapsed_ms + "ms");
        } else {
            console.warn("[host-bridge] ✗ attempt #" + rec.attempt + " (" + rec.stage + ") failed in " + rec.elapsed_ms + "ms · raw=" + rec.raw);
            lastError = rec;
        }
    }

    // Bootstrap principal — retry com backoff exponencial + hard timeout.
    function bootstrapHost() {
        if (bootstrapPromise) return bootstrapPromise;

        bootstrapPromise = (async function () {
            var started = nowMs();
            var extPath;
            try { extPath = cs.getSystemPath("extension"); }
            catch (e) {
                lastError = { stage: "getSystemPath", raw: "exception:" + e.message, ts: nowMs() };
                console.error("[host-bridge] FATAL getSystemPath:", e.message);
                return false;
            }

            // Pré-flight: ExtendScript engine respondendo?
            var pre = await preFlight();
            var preElapsed = nowMs() - started;
            if (!pre.ok) {
                recordAttempt({
                    attempt: 0, stage: "preFlight", ok: false,
                    elapsed_ms: preElapsed, raw: pre.raw, ts: nowMs()
                });
                console.error(
                    "[host-bridge] ExtendScript engine não responde (eval '1+1' → '" + pre.raw + "'). " +
                    "Causas comuns: (1) erro de parse silencioso em host.jsx via ScriptPath do manifest, " +
                    "(2) Premiere sem projeto aberto + race no engine init, " +
                    "(3) PlayerDebugMode não setado (CSXS 9-13 no registry HKCU)."
                );
                // Mesmo com pre-flight falhando, tentamos evalFile — talvez funcione em retry
                // (engine pode estar acordando).
            } else {
                console.log("[host-bridge] ✓ preFlight ok (1+1=2) em " + preElapsed + "ms");
            }

            // Retry loop com backoff exponencial
            var delay = 1000;
            for (var attempt = 1; attempt <= BOOTSTRAP_MAX_ATTEMPTS; attempt++) {
                if (nowMs() - started > BOOTSTRAP_HARD_TIMEOUT_MS) {
                    console.error("[host-bridge] hard timeout " + BOOTSTRAP_HARD_TIMEOUT_MS + "ms atingido — desistindo");
                    return false;
                }

                var t0 = nowMs();
                var r1 = await tryEvalFile(extPath);
                recordAttempt({
                    attempt: attempt, stage: "evalFile", ok: r1.ok,
                    elapsed_ms: nowMs() - t0, raw: r1.raw, path: r1.path, ts: nowMs()
                });
                if (r1.ok) { bootstrapped = true; return true; }

                // Se evalFile retornou "no_registration:*", tenta fallback fs.readFileSync
                if (typeof r1.raw === "string" && r1.raw.indexOf("no_registration") === 0) {
                    var t1 = nowMs();
                    var r2 = await tryReadAndEval(extPath);
                    recordAttempt({
                        attempt: attempt, stage: "readEval", ok: r2.ok,
                        elapsed_ms: nowMs() - t1, raw: r2.raw, path: r2.path, ts: nowMs()
                    });
                    if (r2.ok) { bootstrapped = true; return true; }
                }

                if (attempt < BOOTSTRAP_MAX_ATTEMPTS) {
                    console.log("[host-bridge] aguardando " + delay + "ms antes do próximo retry…");
                    await sleep(delay);
                    delay *= 2;
                }
            }

            console.error("[host-bridge] bootstrap esgotou " + BOOTSTRAP_MAX_ATTEMPTS + " tentativas. Veja HostBridge.getDiagnostics() pro histórico completo.");
            return false;
        })();

        return bootstrapPromise;
    }

    // Executa o script — se falhar com erro recuperável, re-bootstrap + retry 1x.
    function evalJsxOnce(script) {
        return new Promise(function (resolve, reject) {
            cs.evalScript(script, function (raw) {
                if (raw === "EvalScript error." || raw == null) {
                    return reject(new Error("evalscript_error"));
                }
                if (raw === "undefined") {
                    return reject(new Error("function_undefined"));
                }
                try {
                    var data = JSON.parse(raw);
                    if (data && data.error) return reject(new Error(data.error));
                    resolve(data);
                } catch (e) {
                    resolve({ raw: raw });
                }
            });
        });
    }

    async function evalJsx(script) {
        if (!bootstrapped) await bootstrapHost();
        try {
            return await evalJsxOnce(script);
        } catch (e) {
            if (e.message === "evalscript_error" || e.message === "function_undefined") {
                bootstrapPromise = null;
                bootstrapped = false;
                var ok = await bootstrapHost();
                if (!ok) {
                    var hint = lastError ? (" [last: " + lastError.stage + "=" + lastError.raw + "]") : "";
                    throw new Error("host.jsx não carregou — abra um projeto no Premiere e tente de novo" + hint);
                }
                return await evalJsxOnce(script);
            }
            throw e;
        }
    }

    // Tenta chamar usando $.global.MotionProIA primeiro (caso o IIFE tenha
    // registrado lá mas não no escopo "puro"); fallback pra MotionProIA puro.
    function jsxCall(fnName, args) {
        var serialized = (args || []).map(function (a) { return JSON.stringify(a); }).join(",");
        var script =
            "(function(){" +
            "  var M = ($.global && $.global.MotionProIA) ? $.global.MotionProIA : " +
            "          (typeof MotionProIA !== 'undefined' ? MotionProIA : null);" +
            "  if (!M) return JSON.stringify({error:'MotionProIA não registrado'});" +
            "  if (typeof M." + fnName + " !== 'function') return JSON.stringify({error:'MotionProIA." + fnName + " não é função'});" +
            "  return M." + fnName + "(" + serialized + ");" +
            "})()";
        return evalJsx(script);
    }

    // CAUSA RAIZ do "EvalScript error." em TUDO (Agente α · 2026-05-21):
    // Chamar cs.evalScript() no top-level (module load) ANTES do CEP terminar de
    // inicializar — em --mixed-context — corrompe o engine ExtendScript pra todo
    // o ciclo de vida do painel. Sintoma: até 'cs.evalScript("1+1")' retorna
    // "EvalScript error." Validado por comparação: Motion Titles (mesmo CEP, mesmo
    // mixed-context) NÃO chama evalScript no boot e funciona; Motion IA chamava e
    // quebrava 100% das vezes.
    //
    // Fix: bootstrap dispara APENAS quando (a) chega o evento AppOnline do CEP,
    // (b) app.js chama HostBridge.bootstrap() explicitamente (já roda em
    // DOMContentLoaded, tarde o suficiente), ou (c) timer de fallback de 3s
    // (caso AppOnline não dispare em algum ambiente).
    try {
        cs.addEventListener("com.adobe.csxs.events.AppOnline", function () {
            console.log("[host-bridge] AppOnline recebido — disparando bootstrap");
            bootstrapHost();
        });
    } catch (e) {
        console.warn("[host-bridge] addEventListener falhou:", e && e.message);
    }
    setTimeout(function () {
        if (!bootstrapped && !bootstrapPromise) {
            console.log("[host-bridge] AppOnline não chegou em 3s — fallback bootstrap");
            bootstrapHost();
        }
    }, 3000);

    return {
        bootstrap:             bootstrapHost,
        isReady:               function () { return bootstrapped; },
        getLastError:          function () { return lastError; },
        getDiagnostics:        function () { return { attempts: bootstrapAttempts.slice(), lastError: lastError, bootstrapped: bootstrapped }; },
        ping:                  function () { return jsxCall("ping", []); },
        getActiveSequenceInfo: function () { return jsxCall("getActiveSequenceInfo", []); },
        listTimelineClips:     function () { return jsxCall("listTimelineClips", []); },
        getSelectedMediaPath:  function () { return jsxCall("getSelectedMediaPath", []); },
        importAndInsert:       function (path, opts) { return jsxCall("importAndInsert", [path, opts || {}]); },
        addCutsAtSeconds:      function (seconds)    { return jsxCall("addCutsAtSeconds", [seconds]); },
        deleteRanges:          function (ranges)     { return jsxCall("deleteRanges", [ranges]); },
        muteAudioRanges:       function (ranges)     { return jsxCall("muteAudioRanges", [ranges]); },
        setCti:                function (seconds)    { return jsxCall("setCti", [seconds]); },
        selectClipsByName:     function (needle)     { return jsxCall("selectClipsByName", [needle]); },
        evalJsx: evalJsx
    };
})();
