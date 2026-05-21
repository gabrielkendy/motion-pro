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
            try {
                child = cp.spawn(bp, args || [], {
                    cwd: opts.cwd || binDir(),
                    env: Object.assign({}, process.env, opts.env || {}),
                    windowsHide: true
                });
            } catch (e) { return reject(e); }
            child.stdout && child.stdout.on("data", function (d) { stdout += d.toString(); if (opts.onStdout) opts.onStdout(d.toString()); });
            child.stderr && child.stderr.on("data", function (d) { stderr += d.toString(); if (opts.onStderr) opts.onStderr(d.toString()); });
            child.on("error", reject);
            child.on("close", function (code) {
                if (code === 0 || opts.allowNonZero) resolve({ stdout: stdout, stderr: stderr, code: code });
                else reject(new Error(name + " exit " + code + ": " + stderr.slice(0, 500)));
            });
            // timeout opcional
            if (opts.timeoutMs) {
                setTimeout(function () { try { child.kill(); } catch (_) {} }, opts.timeoutMs);
            }
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

    // ── DOWNLOAD MODEL (Whisper.cpp da Hugging Face) ────────────────
    var MODEL_URLS = {
        "ggml-tiny.bin":           "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        "ggml-base.bin":           "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        "ggml-small.bin":          "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        "ggml-medium.bin":         "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
        "ggml-large-v3-turbo.bin": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
    };

    function modelExists(name) {
        try { return fs.existsSync(modelPath(name)); } catch (e) { return false; }
    }

    function downloadModel(name, onProgress) {
        return new Promise(function (resolve, reject) {
            var url = MODEL_URLS[name];
            if (!url) return reject(new Error("model_unknown: " + name));
            var dst = modelPath(name);
            try { fs.mkdirSync(modelsDir(), { recursive: true }); } catch (_) {}
            if (fs.existsSync(dst)) { resolve({ path: dst, alreadyExists: true }); return; }

            // Follow redirects (HF redireciona)
            function doRequest(reqUrl) {
                var req = https.get(reqUrl, function (res) {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        res.resume();
                        return doRequest(res.headers.location);
                    }
                    if (res.statusCode !== 200) {
                        return reject(new Error("download_failed_" + res.statusCode));
                    }
                    var total = parseInt(res.headers["content-length"] || "0", 10);
                    var downloaded = 0;
                    var tmpDst = dst + ".part";
                    var out = fs.createWriteStream(tmpDst);
                    res.pipe(out);
                    res.on("data", function (chunk) {
                        downloaded += chunk.length;
                        if (onProgress && total) onProgress(downloaded / total, downloaded, total);
                    });
                    out.on("error", reject);
                    out.on("finish", function () {
                        out.close(function () {
                            try { fs.renameSync(tmpDst, dst); } catch (e) { return reject(e); }
                            resolve({ path: dst, downloaded: downloaded });
                        });
                    });
                });
                req.on("error", reject);
            }
            doRequest(url);
        });
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
