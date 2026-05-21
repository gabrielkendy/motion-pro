/* bin-runner.js — Motion IA v3
 *
 * Executor de binários locais (ffmpeg / whisper-cli / yt-dlp) bundlados em bin/win/.
 * Mata a dependência do motor remoto VIDEO-PRO-IA pra features básicas.
 *
 * API:
 *   BinRunner.run(name, args, opts)         → Promise<{stdout, stderr, code}>
 *   BinRunner.runStreaming(name, args, on)  → Promise — chama on.stdout/stderr per chunk
 *   BinRunner.path(name)                    → caminho absoluto do binário
 *   BinRunner.exists(name)                  → true/false
 *   BinRunner.models.path(name)             → path do modelo Whisper (ex: ggml-base.bin)
 *   BinRunner.models.download(name, onProg) → baixa modelo do HuggingFace
 */
(function (global) {
    "use strict";

    var nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) || global.require;
    if (!nodeRequire) { console.warn("[bin-runner] Node integration unavailable"); return; }

    var fs    = nodeRequire("fs");
    var path  = nodeRequire("path");
    var os    = nodeRequire("os");
    var cp    = nodeRequire("child_process");
    var https = nodeRequire("https");

    // ── PATHS ────────────────────────────────────────────────────────
    // Cache do extension path. CEP só descobre depois do CSInterface estar
    // pronto, então não cacheamos null — tentamos todas as estratégias até dar.
    var _extPathCache = null;
    function extPath() {
        if (_extPathCache) return _extPathCache;

        // Estratégia 1: CSInterface (padrão CEP)
        try {
            if (typeof CSInterface !== "undefined") {
                var cs = new CSInterface();
                var p = cs.getSystemPath("extension");
                if (p && fs.existsSync(p)) { _extPathCache = p; return p; }
            }
        } catch (e) {}

        // Estratégia 2: location.href do iframe CEP → file:///path/to/extension/index.html
        try {
            if (typeof window !== "undefined" && window.location && window.location.href) {
                var href = decodeURI(window.location.href);
                var m = href.match(/^file:\/{2,3}(.+)\/[^/]+$/);
                if (m) {
                    var dir = m[1].replace(/\//g, path.sep);
                    if (fs.existsSync(dir)) { _extPathCache = dir; return dir; }
                }
            }
        } catch (e) {}

        // Estratégia 3: Caminho padrão do CEP no Windows
        try {
            var fallback = path.join(process.env.APPDATA || "", "Adobe", "CEP", "extensions", "com.motionpro.ia");
            if (fs.existsSync(fallback)) { _extPathCache = fallback; return fallback; }
        } catch (e) {}

        // Último recurso (geralmente errado em CEP — vai apontar pro Premiere.exe dir)
        var cwd = process.cwd();
        console.warn("[bin-runner] extPath fallback to process.cwd():", cwd);
        return cwd;
    }

    function binDir() {
        var platform = os.platform();
        var sub = platform === "win32" ? "win" : (platform === "darwin" ? "mac" : "linux");
        return path.join(extPath(), "bin", sub);
    }

    function binPath(name) {
        var ext = os.platform() === "win32" ? ".exe" : "";
        return path.join(binDir(), name + ext);
    }

    function exists(name) {
        try {
            var p = binPath(name);
            var ok = fs.existsSync(p);
            if (!ok) console.warn("[bin-runner] exists(" + name + ") = false · path tested:", p, "· extPath:", extPath());
            return ok;
        } catch (e) { console.error("[bin-runner] exists(" + name + ") error:", e.message); return false; }
    }

    function modelsDir() {
        return path.join(extPath(), "models");
    }
    function modelPath(name) {
        return path.join(modelsDir(), name);
    }

    // ── RUN (collect stdout/stderr) ──────────────────────────────────
    function run(name, args, opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
            var bp = binPath(name);
            if (!fs.existsSync(bp)) {
                return reject(new Error("binary_missing: " + name + " em " + bp + ". Rode tools/download-binaries.ps1 ou baixe manualmente."));
            }
            var stdout = ""; var stderr = "";
            var child;
            var timedOut = false;
            var killedByCaller = false;
            var done = false;
            var timeoutHandle = null;

            function safeReject(err) {
                if (done) return; done = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);
                reject(err);
            }
            function safeResolve(val) {
                if (done) return; done = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);
                resolve(val);
            }

            try {
                child = cp.spawn(bp, args || [], {
                    cwd: opts.cwd || binDir(),
                    env: Object.assign({}, process.env, opts.env || {}),
                    windowsHide: true
                });
            } catch (e) { return safeReject(e); }

            child.stdout && child.stdout.on("data", function (d) { stdout += d.toString(); if (opts.onStdout) opts.onStdout(d.toString()); });
            child.stderr && child.stderr.on("data", function (d) { stderr += d.toString(); if (opts.onStderr) opts.onStderr(d.toString()); });
            child.on("error", safeReject);
            child.on("close", function (code) {
                if (timedOut) {
                    return safeReject(new Error(name + " timeout após " + (opts.timeoutMs || 0) + "ms (matou processo)"));
                }
                // 3221225477 = 0xC0000005 ACCESS_VIOLATION (crash do binário, não erro de uso)
                if (code === 3221225477 || code === -1073741819) {
                    return safeReject(new Error(name + " CRASH (access violation 0xC0000005) — provavelmente input inválido ou flag incompatível. stderr: " + stderr.slice(0, 300)));
                }
                if (code === 0 || opts.allowNonZero) safeResolve({ stdout: stdout, stderr: stderr, code: code });
                else safeReject(new Error(name + " exit " + code + ": " + stderr.slice(0, 500)));
            });

            // timeout obrigatório por padrão (evita travar PC se binário pendurar)
            // default: 5 min. Caller pode setar timeoutMs explicitamente.
            var tMs = (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) ? opts.timeoutMs : 5 * 60 * 1000;
            timeoutHandle = setTimeout(function () {
                timedOut = true;
                try { child.kill("SIGKILL"); } catch (_) {}
                // resolve via close handler que vai detectar timedOut
            }, tMs);
        });
    }

    // ── STREAMING ────────────────────────────────────────────────────
    function runStreaming(name, args, callbacks) {
        callbacks = callbacks || {};
        return run(name, args, {
            onStdout: callbacks.onStdout || function () {},
            onStderr: callbacks.onStderr || function () {},
            cwd: callbacks.cwd,
            env: callbacks.env,
            timeoutMs: callbacks.timeoutMs,
            allowNonZero: callbacks.allowNonZero
        });
    }

    // ── DOWNLOAD MODEL (Whisper.cpp · multi-mirror com fallback) ────
    // Cada modelo tem N mirrors. Tenta um por vez até funcionar.
    var MODEL_URLS = {
        "ggml-tiny.bin": [
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
            "https://cdn.kendyproducoes.com.br/models/ggml-tiny.bin"
        ],
        "ggml-base.bin": [
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
            "https://cdn.kendyproducoes.com.br/models/ggml-base.bin"
        ],
        "ggml-small.bin": [
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
            "https://cdn.kendyproducoes.com.br/models/ggml-small.bin"
        ],
        "ggml-medium.bin": [
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
            "https://cdn.kendyproducoes.com.br/models/ggml-medium.bin"
        ],
        "ggml-large-v3-turbo.bin": [
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
            "https://cdn.kendyproducoes.com.br/models/ggml-large-v3-turbo.bin"
        ]
    };

    function modelExists(name) {
        try {
            if (!fs.existsSync(modelPath(name))) return false;
            // Sanity check: arquivo precisa ter > 1MB (modelo .bin nunca é pequeno)
            var st = fs.statSync(modelPath(name));
            return st.size > 1024 * 1024;
        } catch (e) { return false; }
    }

    function downloadFromUrl(url, tmpDst, dst, onProgress) {
        return new Promise(function (resolve, reject) {
            // limpa .part antigo (evita ENOENT no rename + lixo de tentativas anteriores)
            try { if (fs.existsSync(tmpDst)) fs.unlinkSync(tmpDst); } catch (_) {}

            var settled = false;
            function safeReject(err) {
                if (settled) return; settled = true;
                try { if (fs.existsSync(tmpDst)) fs.unlinkSync(tmpDst); } catch (_) {}
                reject(err);
            }
            function safeResolve(val) {
                if (settled) return; settled = true;
                resolve(val);
            }

            function doRequest(reqUrl, redirectCount) {
                redirectCount = redirectCount || 0;
                if (redirectCount > 5) return safeReject(new Error("too_many_redirects"));

                var req;
                try {
                    req = https.get(reqUrl, { timeout: 20000 }, function (res) {
                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            res.resume();
                            return doRequest(res.headers.location, redirectCount + 1);
                        }
                        if (res.statusCode !== 200) {
                            return safeReject(new Error("download_failed_" + res.statusCode + " from " + reqUrl));
                        }
                        var total = parseInt(res.headers["content-length"] || "0", 10);
                        var downloaded = 0;
                        var out = fs.createWriteStream(tmpDst);
                        var stallTimer = null;
                        function resetStallTimer() {
                            if (stallTimer) clearTimeout(stallTimer);
                            // se não vier dado por 30s, aborta
                            stallTimer = setTimeout(function () {
                                try { req.destroy(); } catch (_) {}
                                try { out.destroy(); } catch (_) {}
                                safeReject(new Error("download_stalled (no data 30s)"));
                            }, 30000);
                        }
                        resetStallTimer();
                        res.pipe(out);
                        res.on("data", function (chunk) {
                            downloaded += chunk.length;
                            resetStallTimer();
                            if (onProgress && total) onProgress(downloaded / total, downloaded, total);
                        });
                        out.on("error", function (e) {
                            if (stallTimer) clearTimeout(stallTimer);
                            safeReject(e);
                        });
                        res.on("error", function (e) {
                            if (stallTimer) clearTimeout(stallTimer);
                            safeReject(e);
                        });
                        out.on("finish", function () {
                            if (stallTimer) clearTimeout(stallTimer);
                            out.close(function () {
                                try {
                                    if (!fs.existsSync(tmpDst)) {
                                        return safeReject(new Error("part_disappeared"));
                                    }
                                    var sz = fs.statSync(tmpDst).size;
                                    if (sz < 1024 * 1024) {
                                        try { fs.unlinkSync(tmpDst); } catch (_) {}
                                        return safeReject(new Error("downloaded_too_small_" + sz));
                                    }
                                    fs.renameSync(tmpDst, dst);
                                    safeResolve({ path: dst, downloaded: downloaded });
                                } catch (e) { safeReject(e); }
                            });
                        });
                    });
                    req.on("timeout", function () {
                        try { req.destroy(); } catch (_) {}
                        safeReject(new Error("connect_timeout_20s"));
                    });
                    req.on("error", function (e) { safeReject(new Error("net_" + (e.code || "err") + ": " + e.message)); });
                } catch (e) { safeReject(e); }
            }
            doRequest(url);
        });
    }

    function downloadModel(name, onProgress) {
        var urls = MODEL_URLS[name];
        if (!urls) return Promise.reject(new Error("model_unknown: " + name));
        if (!Array.isArray(urls)) urls = [urls];

        var dst = modelPath(name);
        var tmpDst = dst + ".part";
        try { fs.mkdirSync(modelsDir(), { recursive: true }); } catch (_) {}
        if (modelExists(name)) return Promise.resolve({ path: dst, alreadyExists: true });

        // tenta cada mirror em sequência
        function tryNext(idx, errors) {
            if (idx >= urls.length) {
                return Promise.reject(new Error("all_mirrors_failed: " + errors.join(" | ")));
            }
            if (onProgress) onProgress(0, 0, 0, { mirror: idx + 1, total_mirrors: urls.length, url: urls[idx] });
            return downloadFromUrl(urls[idx], tmpDst, dst, onProgress).catch(function (e) {
                errors.push("[" + urls[idx] + "] " + e.message);
                return tryNext(idx + 1, errors);
            });
        }
        return tryNext(0, []);
    }

    global.BinRunner = {
        run:           run,
        runStreaming:  runStreaming,
        path:          binPath,
        exists:        exists,
        binDir:        binDir,
        extPath:       extPath,
        diagnose:      function () {
            var bd = binDir();
            var report = { ext: extPath(), bin_dir: bd, platform: os.platform(), bins: {} };
            ["ffmpeg", "ffprobe", "whisper-cli", "yt-dlp", "aria2c"].forEach(function (n) {
                var p = binPath(n);
                report.bins[n] = { path: p, exists: false };
                try { report.bins[n].exists = fs.existsSync(p); } catch (_) {}
            });
            console.log("[BinRunner.diagnose]", JSON.stringify(report, null, 2));
            return report;
        },
        models: {
            path:       modelPath,
            exists:     modelExists,
            download:   downloadModel,
            urls:       MODEL_URLS
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
