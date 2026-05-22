/* fal-client.js — Motion IA v4
 *
 * Cliente HTTP pra API do fal.ai (https://docs.fal.ai/).
 * Usado pra gerar vídeos via Seedance (ByteDance) ou outros modelos image-to-video.
 *
 * Fluxo típico:
 *   1. uploadFile(filePath) → URL pública temporária
 *   2. submitJob(endpoint, input) → { request_id }
 *   3. waitForResult(endpoint, request_id, onProgress) → { video: { url } }
 *   4. downloadFile(url, localPath)
 *
 * Key vem de localStorage["mia_fal_key"] (configurada em Settings).
 * BYOK: cliente paga próprio uso (~$0.10-0.50 por vídeo).
 */
(function (global) {
    "use strict";

    var FAL_BASE        = "https://fal.run";              // synchronous endpoint
    var FAL_QUEUE_BASE  = "https://queue.fal.run";        // async queue endpoint
    var FAL_STORAGE_URL = "https://storage.fal.ai/files/upload";

    function getKey() {
        return localStorage.getItem("mia_fal_key") || "";
    }
    function hasKey() {
        return !!getKey();
    }

    // ── Node integration ────────────────────────────────────────────
    var nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) || global.require;
    var nfs    = nodeRequire ? nodeRequire("fs") : null;
    var npath  = nodeRequire ? nodeRequire("path") : null;
    var nos    = nodeRequire ? nodeRequire("os") : null;
    var nhttps = nodeRequire ? nodeRequire("https") : null;

    function ensureKey() {
        var k = getKey();
        if (!k) throw new Error("fal_key_missing: configure FAL_KEY em Licença & Config");
        return k;
    }

    // ── UPLOAD imagem de referência ────────────────────────────────
    // fal.ai aceita upload via storage endpoint OU pode receber dataURI base64
    // direto no input. Pra arquivos > 5MB, upload é melhor. Pra <5MB, dataURI
    // funciona e é mais simples.
    async function fileToBase64DataURI(filePath) {
        if (!nfs) throw new Error("node_fs_unavailable");
        if (!nfs.existsSync(filePath)) throw new Error("file_not_found: " + filePath);
        var buf = nfs.readFileSync(filePath);
        var ext = (npath.extname(filePath) || ".png").slice(1).toLowerCase();
        var mime = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" })[ext] || "image/png";
        return "data:" + mime + ";base64," + buf.toString("base64");
    }

    async function uploadFile(filePath) {
        var key = ensureKey();
        if (!nfs) throw new Error("node_fs_unavailable");
        if (!nfs.existsSync(filePath)) throw new Error("file_not_found: " + filePath);
        var size = nfs.statSync(filePath).size;
        // Se < 4MB, usa dataURI inline (mais simples, sem upload)
        if (size < 4 * 1024 * 1024) {
            return await fileToBase64DataURI(filePath);
        }
        // Arquivo grande: faz upload pro storage
        var buf = nfs.readFileSync(filePath);
        var ext = (npath.extname(filePath) || ".png").slice(1).toLowerCase();
        var contentType = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" })[ext] || "image/png";
        // fal.ai upload é multipart/form-data — usamos FormData (disponível em CEP)
        var fd = new FormData();
        var blob = new Blob([buf], { type: contentType });
        fd.append("file", blob, npath.basename(filePath));
        var r = await fetch(FAL_STORAGE_URL, {
            method: "POST",
            headers: { "Authorization": "Key " + key },
            body: fd
        });
        if (!r.ok) throw new Error("fal_upload_" + r.status + ": " + (await r.text()).slice(0, 200));
        var j = await r.json();
        return j.url; // pública por 24h
    }

    // ── SUBMIT JOB (async via queue) ───────────────────────────────
    // endpoint: ex "fal-ai/seedance/image-to-video" ou "fal-ai/kling-video/v2/image-to-video"
    async function submitJob(endpoint, input) {
        var key = ensureKey();
        var url = FAL_QUEUE_BASE + "/" + endpoint;
        var r = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": "Key " + key,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ input: input })
        });
        if (!r.ok) {
            var txt = await r.text();
            throw new Error("fal_submit_" + r.status + ": " + txt.slice(0, 300));
        }
        var j = await r.json();
        if (!j.request_id) throw new Error("fal_no_request_id: " + JSON.stringify(j).slice(0, 200));
        return j;
    }

    // ── POLL STATUS até COMPLETED ──────────────────────────────────
    async function pollStatus(endpoint, requestId) {
        var key = ensureKey();
        var url = FAL_QUEUE_BASE + "/" + endpoint + "/requests/" + requestId + "/status";
        var r = await fetch(url, { headers: { "Authorization": "Key " + key } });
        if (!r.ok) throw new Error("fal_status_" + r.status);
        return await r.json();
    }

    async function getResult(endpoint, requestId) {
        var key = ensureKey();
        var url = FAL_QUEUE_BASE + "/" + endpoint + "/requests/" + requestId;
        var r = await fetch(url, { headers: { "Authorization": "Key " + key } });
        if (!r.ok) throw new Error("fal_result_" + r.status);
        return await r.json();
    }

    /**
     * Aguarda job completar com timeout + polling exponencial.
     * onProgress({ status, logs, position }) é chamado a cada poll.
     * Default timeout: 5 minutos.
     */
    async function waitForResult(endpoint, requestId, opts) {
        opts = opts || {};
        var onProgress = opts.onProgress || function () {};
        var timeoutMs  = opts.timeoutMs || 5 * 60 * 1000;
        var pollMs     = opts.pollMs    || 3000;
        var t0 = Date.now();
        while (true) {
            if (Date.now() - t0 > timeoutMs) {
                throw new Error("fal_timeout: job ainda nao terminou apos " + Math.round(timeoutMs/1000) + "s");
            }
            var s;
            try { s = await pollStatus(endpoint, requestId); }
            catch (e) { onProgress({ status: "ERR", error: e.message }); throw e; }
            onProgress({
                status:   s.status,
                logs:     s.logs || [],
                position: s.queue_position
            });
            if (s.status === "COMPLETED") {
                return await getResult(endpoint, requestId);
            }
            if (s.status === "FAILED" || s.status === "ERROR") {
                throw new Error("fal_failed: " + JSON.stringify(s).slice(0, 300));
            }
            // IN_QUEUE | IN_PROGRESS → continua
            await new Promise(function (res) { setTimeout(res, pollMs); });
        }
    }

    // ── DOWNLOAD MP4 resultado ─────────────────────────────────────
    function downloadFile(remoteUrl, localPath) {
        return new Promise(function (resolve, reject) {
            if (!nhttps) return reject(new Error("node_https_unavailable"));
            var dir = npath.dirname(localPath);
            try { nfs.mkdirSync(dir, { recursive: true }); } catch (_) {}
            function doRequest(u, redirects) {
                redirects = redirects || 0;
                if (redirects > 5) return reject(new Error("too_many_redirects"));
                var req = nhttps.get(u, { timeout: 60000 }, function (res) {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        res.resume();
                        return doRequest(res.headers.location, redirects + 1);
                    }
                    if (res.statusCode !== 200) {
                        return reject(new Error("download_" + res.statusCode));
                    }
                    var out = nfs.createWriteStream(localPath);
                    res.pipe(out);
                    out.on("error", reject);
                    out.on("finish", function () { out.close(function () { resolve(localPath); }); });
                });
                req.on("timeout", function () { try { req.destroy(); } catch (_) {} reject(new Error("download_timeout")); });
                req.on("error", reject);
            }
            doRequest(remoteUrl);
        });
    }

    // ── HIGH LEVEL: image → video via Seedance ─────────────────────
    // Endpoint canônico: fal-ai/seedance/image-to-video
    // Input shape (Seedance 2.0):
    //   { image_url, prompt, duration_seconds: 5|10, aspect_ratio: "9:16"|"16:9"|"1:1" }
    async function generateVideoFromImage(opts) {
        opts = opts || {};
        var imagePath   = opts.imagePath;
        var prompt      = opts.prompt || "";
        var duration    = opts.duration || 5;        // 5 ou 10 segundos
        var aspectRatio = opts.aspectRatio || "16:9";// 9:16 / 16:9 / 1:1
        var model       = opts.model || "seedance";  // "seedance" | "kling-v2"
        var onProgress  = opts.onProgress || function () {};

        if (!imagePath) throw new Error("imagePath_required");
        if (!prompt) throw new Error("prompt_required");

        onProgress({ stage: "upload", msg: "Enviando imagem de referência..." });
        var imageUrl = await uploadFile(imagePath);

        var endpoint;
        if (model === "kling-v2") endpoint = "fal-ai/kling-video/v2/image-to-video";
        else                       endpoint = "fal-ai/seedance/image-to-video";

        onProgress({ stage: "submit", msg: "Enfileirando geração (Seedance)..." });
        var input = {
            image_url: imageUrl,
            prompt: prompt,
            duration_seconds: duration,
            aspect_ratio: aspectRatio
        };
        var sub = await submitJob(endpoint, input);

        onProgress({ stage: "queued", msg: "Job " + sub.request_id + " na fila..." });
        var result = await waitForResult(endpoint, sub.request_id, {
            onProgress: function (s) {
                if (s.status === "IN_QUEUE") {
                    onProgress({ stage: "queue", msg: "Posição na fila: " + (s.position || "?") });
                } else if (s.status === "IN_PROGRESS") {
                    onProgress({ stage: "render", msg: "Gerando vídeo... (~30-90s)" });
                }
            },
            timeoutMs: 5 * 60 * 1000
        });

        var videoUrl = (result && result.video && result.video.url) || null;
        if (!videoUrl) throw new Error("fal_no_video_url: " + JSON.stringify(result).slice(0, 200));

        onProgress({ stage: "download", msg: "Baixando MP4 gerado..." });
        var outDir = npath.join(nos.homedir(), "Documents", "MotionIA-Generated");
        var outName = "seedance_" + Date.now() + ".mp4";
        var outPath = npath.join(outDir, outName);
        await downloadFile(videoUrl, outPath);

        onProgress({ stage: "done", msg: "Vídeo gerado: " + outName });

        return {
            ok: true,
            out_path: outPath,
            video_url: videoUrl,
            request_id: sub.request_id,
            duration: duration,
            aspect_ratio: aspectRatio,
            model: model
        };
    }

    // ── PUBLIC API ─────────────────────────────────────────────────
    global.FalClient = {
        hasKey:                  hasKey,
        uploadFile:              uploadFile,
        submitJob:               submitJob,
        pollStatus:              pollStatus,
        getResult:               getResult,
        waitForResult:           waitForResult,
        downloadFile:            downloadFile,
        generateVideoFromImage:  generateVideoFromImage
    };
})(typeof window !== "undefined" ? window : globalThis);
