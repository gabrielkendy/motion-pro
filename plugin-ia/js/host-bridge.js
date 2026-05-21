/* host-bridge.js — wrapper Promise-based em volta do CSInterface.evalScript.
 *
 * Cada função aqui chama uma função MotionProIA.* em jsx/host.jsx e devolve
 * sempre uma Promise que resolve com o JSON parseado. Erros do ExtendScript
 * viram exception JavaScript (com .message).
 *
 * AUTO-BOOTSTRAP: se MotionProIA não estiver definido, força evalFile do
 * host.jsx e retry uma vez. Isso resolve casos em que CEP não carregou
 * o ScriptPath do manifest antes da primeira chamada.
 */
window.HostBridge = (function () {
    var cs = new CSInterface();
    var bootstrapped = false;
    var bootstrapPromise = null;

    // Força carregar host.jsx via $.evalFile. Idempotente.
    function bootstrapHost() {
        if (bootstrapPromise) return bootstrapPromise;
        bootstrapPromise = new Promise(function (resolve) {
            try {
                var extPath = cs.getSystemPath("extension");
                // ExtendScript aceita forward slashes mesmo em Windows
                var jsxPath = (extPath + "/jsx/host.jsx").replace(/\\/g, "/");
                // Escapa apóstrofos no path (raro mas possível)
                var safePath = jsxPath.replace(/'/g, "\\'");
                // 1) carrega o arquivo + 2) verifica que $.global.MotionProIA tem .ping (atomic)
                var script =
                    "(function(){" +
                    "  try {" +
                    "    $.evalFile(File('" + safePath + "'));" +
                    "    if ($.global.MotionProIA && typeof $.global.MotionProIA.ping === 'function') return 'ok';" +
                    "    if (typeof MotionProIA !== 'undefined' && typeof MotionProIA.ping === 'function') return 'ok';" +
                    "    return 'no_registration';" +
                    "  } catch(e) { return 'error:' + (e.message || e); }" +
                    "})()";
                cs.evalScript(script, function (raw) {
                    bootstrapped = (raw === "ok");
                    if (!bootstrapped) {
                        console.error("[host-bridge] bootstrap failed. result:", raw, "path:", jsxPath, "extPath:", extPath);
                    } else {
                        console.log("[host-bridge] host.jsx OK ·", jsxPath);
                    }
                    resolve(bootstrapped);
                });
            } catch (e) {
                console.error("[host-bridge] bootstrap exception:", e.message);
                resolve(false);
            }
        });
        return bootstrapPromise;
    }

    // Tenta executar o script. Se retornar "EvalScript error" ou "undefined",
    // tenta re-bootstrap e re-executar UMA vez.
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
        // Garante que host.jsx foi carregado pelo menos uma vez
        if (!bootstrapped) await bootstrapHost();
        try {
            return await evalJsxOnce(script);
        } catch (e) {
            // Retry: re-bootstrap e tenta de novo (cobre cases de CEP reload)
            if (e.message === "evalscript_error" || e.message === "function_undefined") {
                bootstrapPromise = null;
                bootstrapped = false;
                var ok = await bootstrapHost();
                if (!ok) throw new Error("host.jsx não carregou — abra um projeto no Premiere e tente de novo");
                return await evalJsxOnce(script);
            }
            throw e;
        }
    }

    function jsxCall(fnName, args) {
        var serialized = (args || []).map(function (a) { return JSON.stringify(a); }).join(",");
        return evalJsx("MotionProIA." + fnName + "(" + serialized + ");");
    }

    // Dispara bootstrap em background no carregamento do módulo
    bootstrapHost();

    return {
        bootstrap:             bootstrapHost,
        isReady:               function () { return bootstrapped; },
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
