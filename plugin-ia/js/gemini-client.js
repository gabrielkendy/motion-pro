/* gemini-client.js — Motion IA v3
 *
 * Cliente Google Gemini 2.5 (Flash/Pro). Aceita vídeo MP4 inteiro (até ~2GB)
 * direto via Files API ou inline base64 (até 20MB).
 *
 * API:
 *   GeminiClient.setKey(key)
 *   GeminiClient.hasKey()  → bool
 *   GeminiClient.analyzeVideo({ videoPath, prompt, model, responseSchema })
 *     → Promise<{ text, json, usage }>
 *   GeminiClient.uploadFile(filePath) → Promise<{ uri, name }>
 *
 * Modo de envio:
 *   - file < 20MB → inline base64 (rápido, 1 request)
 *   - file >= 20MB → Files API upload (resumable, 3 requests)
 */
(function (global) {
    "use strict";

    var nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) || global.require;
    var fs = nodeRequire ? nodeRequire("fs") : null;
    var path = nodeRequire ? nodeRequire("path") : null;

    var KEY_STORAGE = "mia_gemini_key";
    var DEFAULT_MODEL = "gemini-2.5-flash";
    var BASE = "https://generativelanguage.googleapis.com";
    var INLINE_MAX = 20 * 1024 * 1024; // 20 MB

    function getKey() {
        try { return localStorage.getItem(KEY_STORAGE) || ""; } catch (e) { return ""; }
    }
    function setKey(k) {
        try { localStorage.setItem(KEY_STORAGE, k || ""); } catch (e) {}
    }
    function hasKey() { return !!getKey(); }
    function clearKey() { try { localStorage.removeItem(KEY_STORAGE); } catch (e) {} }

    // ── INLINE: <20MB ──────────────────────────────────────────────
    function readFileBase64(filePath) {
        if (!fs) return null;
        var buf = fs.readFileSync(filePath);
        return buf.toString("base64");
    }
    function getMimeType(filePath) {
        var ext = filePath.toLowerCase().split(".").pop();
        var map = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo" };
        return map[ext] || "video/mp4";
    }

    async function generateContentInline(opts) {
        var key = getKey();
        if (!key) throw new Error("gemini_key_missing — configure em Config");
        var model = opts.model || DEFAULT_MODEL;

        var parts = [];
        if (opts.videoPath) {
            var b64 = readFileBase64(opts.videoPath);
            if (!b64) throw new Error("read_video_failed");
            parts.push({
                inlineData: {
                    mimeType: getMimeType(opts.videoPath),
                    data: b64
                }
            });
        }
        if (opts.imagesBase64) {
            opts.imagesBase64.forEach(function (img) {
                parts.push({
                    inlineData: {
                        mimeType: img.mimeType || "image/png",
                        data: img.data
                    }
                });
            });
        }
        parts.push({ text: opts.prompt || "Analise este vídeo." });

        var body = {
            contents: [{ parts: parts }],
            generationConfig: {
                temperature: opts.temperature != null ? opts.temperature : 0.4,
                maxOutputTokens: opts.maxTokens || 4096
            }
        };
        if (opts.responseSchema) {
            body.generationConfig.responseMimeType = "application/json";
            body.generationConfig.responseSchema = opts.responseSchema;
        }

        var url = BASE + "/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key);
        var res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        var data = await res.json();
        if (!res.ok) {
            throw new Error("gemini_" + res.status + ": " + (data.error && data.error.message || JSON.stringify(data).slice(0, 300)));
        }
        return parseResponse(data, !!opts.responseSchema);
    }

    // ── FILES API: >=20MB (resumable upload) ───────────────────────
    async function uploadFile(filePath) {
        var key = getKey();
        if (!key) throw new Error("gemini_key_missing");
        if (!fs) throw new Error("node_fs_unavailable");
        var stat = fs.statSync(filePath);
        var filename = path.basename(filePath);
        var mimeType = getMimeType(filePath);

        // 1. Start resumable
        var startRes = await fetch(BASE + "/upload/v1beta/files?key=" + encodeURIComponent(key), {
            method: "POST",
            headers: {
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": String(stat.size),
                "X-Goog-Upload-Header-Content-Type": mimeType,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ file: { display_name: filename } })
        });
        var uploadUrl = startRes.headers.get("X-Goog-Upload-URL") || startRes.headers.get("x-goog-upload-url");
        if (!uploadUrl) {
            var txt = await startRes.text();
            throw new Error("upload_init_failed: " + txt.slice(0, 200));
        }

        // 2. Upload bytes
        var fileBuf = fs.readFileSync(filePath);
        var upRes = await fetch(uploadUrl, {
            method: "POST",
            headers: {
                "Content-Length": String(stat.size),
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize"
            },
            body: fileBuf
        });
        var fileInfo = await upRes.json();
        if (!fileInfo.file || !fileInfo.file.uri) {
            throw new Error("upload_failed: " + JSON.stringify(fileInfo).slice(0, 300));
        }

        // 3. Poll até ACTIVE
        var fileObj = fileInfo.file;
        var tries = 0;
        while (fileObj.state !== "ACTIVE" && tries < 30) {
            await new Promise(function (r) { setTimeout(r, 2000); });
            var pollRes = await fetch(BASE + "/v1beta/" + fileObj.name + "?key=" + encodeURIComponent(key));
            fileObj = await pollRes.json();
            tries++;
        }
        if (fileObj.state !== "ACTIVE") throw new Error("file_not_active_after_poll");
        return fileObj;
    }

    async function generateContentFile(opts) {
        var key = getKey();
        if (!key) throw new Error("gemini_key_missing");
        var model = opts.model || DEFAULT_MODEL;
        var fileObj = await uploadFile(opts.videoPath);

        var body = {
            contents: [{
                parts: [
                    { fileData: { mimeType: fileObj.mimeType, fileUri: fileObj.uri } },
                    { text: opts.prompt || "Analise este vídeo." }
                ]
            }],
            generationConfig: {
                temperature: opts.temperature != null ? opts.temperature : 0.4,
                maxOutputTokens: opts.maxTokens || 4096
            }
        };
        if (opts.responseSchema) {
            body.generationConfig.responseMimeType = "application/json";
            body.generationConfig.responseSchema = opts.responseSchema;
        }

        var url = BASE + "/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key);
        var res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        var data = await res.json();
        if (!res.ok) {
            throw new Error("gemini_" + res.status + ": " + (data.error && data.error.message || ""));
        }
        return parseResponse(data, !!opts.responseSchema);
    }

    // ── DISPATCHER: escolhe inline vs Files API automaticamente ────
    async function analyzeVideo(opts) {
        if (!opts || !opts.videoPath) throw new Error("video_path_required");
        if (!fs) throw new Error("node_fs_unavailable");
        var stat = fs.statSync(opts.videoPath);
        if (stat.size <= INLINE_MAX) {
            return await generateContentInline(opts);
        } else {
            return await generateContentFile(opts);
        }
    }

    function parseResponse(data, isJson) {
        var text = "";
        try {
            text = data.candidates[0].content.parts.map(function (p) { return p.text || ""; }).join("");
        } catch (e) { text = ""; }
        var json = null;
        if (isJson && text) {
            try { json = JSON.parse(text); } catch (e) { /* não era JSON válido */ }
        }
        return {
            text: text,
            json: json,
            usage: data.usageMetadata || null,
            model: data.modelVersion || null
        };
    }

    // ── VALIDATE KEY ────────────────────────────────────────────────
    async function validate(testKey) {
        var k = testKey || getKey();
        if (!k) return { ok: false, error: "no_key" };
        try {
            var res = await fetch(BASE + "/v1beta/models/" + DEFAULT_MODEL + ":generateContent?key=" + encodeURIComponent(k), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "ping" }] }],
                    generationConfig: { maxOutputTokens: 8 }
                })
            });
            if (res.ok) return { ok: true };
            var data = await res.json();
            return { ok: false, error: (data.error && data.error.message) || ("http_" + res.status) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    global.GeminiClient = {
        getKey:        getKey,
        setKey:        setKey,
        hasKey:        hasKey,
        clearKey:      clearKey,
        analyzeVideo:  analyzeVideo,
        uploadFile:    uploadFile,
        validate:      validate,
        MODELS: {
            FLASH: "gemini-2.5-flash",
            PRO:   "gemini-2.5-pro"
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
