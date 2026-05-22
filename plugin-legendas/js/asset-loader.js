/* asset-loader.js — Motion Legendas
 *
 * Port do asset-loader do Motion Titles. Diferenças:
 *   - cache em %LOCALAPPDATA%\Motion Legendas\cache
 *   - User-Agent: MotionLegendas-Plugin/1.0
 *   - product_id default: "legendas"
 *
 * API global:
 *   window.MPL_AssetLoader.get(item)         → Promise<string>   // path local cacheado
 *   window.MPL_AssetLoader.preload(items)    → Promise<void>
 *   window.MPL_AssetLoader.cacheStats()      → { count, totalBytes }
 *   window.MPL_AssetLoader.clearCache()      → Promise<void>
 *
 * Cada `item` esperado: { id, cdn_key, sha256, size_bytes, mogrt? (legacy local path) }
 */
(function (global) {
    "use strict";

    var nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) || global.require;
    if (typeof nodeRequire !== "function") {
        console.warn("[MPL/asset-loader] Node integration unavailable — só modo local-path.");
    }
    var fs   = nodeRequire ? nodeRequire("fs")    : null;
    var path = nodeRequire ? nodeRequire("path")  : null;
    var os   = nodeRequire ? nodeRequire("os")    : null;
    var http = nodeRequire ? nodeRequire("https") : null;
    var crypto = nodeRequire ? nodeRequire("crypto") : null;

    var CACHE_ROOT = null;
    if (fs && path && os) {
        var localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
        CACHE_ROOT = path.join(localAppData, "Motion Legendas", "cache");
        try { fs.mkdirSync(CACHE_ROOT, { recursive: true }); } catch (_) {}
    }

    function httpRequest(opts, body) {
        return new Promise(function (resolve, reject) {
            if (!http) return reject(new Error("https module unavailable"));
            var req = http.request(opts, function (res) {
                var chunks = [];
                res.on("data", function (c) { chunks.push(c); });
                res.on("end", function () {
                    resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
                });
            });
            req.on("error", reject);
            if (body) req.write(body);
            req.end();
        });
    }

    function downloadToFile(url, destPath, expectedSha256) {
        return new Promise(function (resolve, reject) {
            if (!http || !fs || !crypto) return reject(new Error("node modules unavailable"));
            var u = new URL(url);
            var opts = {
                method: "GET",
                hostname: u.hostname,
                path: u.pathname + (u.search || ""),
                port: u.port || 443,
                headers: { "User-Agent": "MotionLegendas-Plugin/1.0" }
            };
            var req = http.request(opts, function (res) {
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error("download_failed_" + res.statusCode));
                }
                var tmpPath = destPath + ".part";
                try { fs.mkdirSync(path.dirname(destPath), { recursive: true }); } catch (_) {}
                var out = fs.createWriteStream(tmpPath);
                var hasher = crypto.createHash("sha256");
                res.on("data", function (chunk) { hasher.update(chunk); });
                res.pipe(out);
                out.on("error", function (e) { reject(e); });
                out.on("finish", function () {
                    out.close(function () {
                        var sha = hasher.digest("hex");
                        if (expectedSha256 && sha !== expectedSha256) {
                            try { fs.unlinkSync(tmpPath); } catch (_) {}
                            return reject(new Error("sha_mismatch"));
                        }
                        try {
                            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                            fs.renameSync(tmpPath, destPath);
                        } catch (e) { return reject(e); }
                        resolve({ path: destPath, sha256: sha });
                    });
                });
            });
            req.on("error", reject);
            req.end();
        });
    }

    function cachePathFor(sha256) {
        if (!CACHE_ROOT || !sha256) return null;
        return path.join(CACHE_ROOT, sha256.slice(0, 2), sha256 + ".mogrt");
    }

    function fileExists(p) {
        if (!fs || !p) return false;
        try { return fs.statSync(p).isFile(); } catch (_) { return false; }
    }

    function authHeader() {
        // v2 SaaS: token unificado entre 3 plugins é "mv_session".
        // Fallback pra "mpl_session_token" (legacy) e "mpl_session" (migração intermediária).
        var ls = global.localStorage;
        if (!ls) return null;
        var t = ls.getItem("mv_session") ||
                ls.getItem("mpl_session_token") ||
                ls.getItem("mpl_session");
        return t ? ("Bearer " + t) : null;
    }
    function fingerprint() {
        var ls = global.localStorage;
        if (!ls) return "unknown";
        return ls.getItem("mv_device_fingerprint") ||
               ls.getItem("mpl_device_fingerprint") ||
               "unknown";
    }
    function apiBase() {
        return (global.MPL_CFG && global.MPL_CFG.apiBase) || "https://motionpro.vercel.app";
    }

    function requestSignedUrl(assetId) {
        var auth = authHeader();
        if (!auth) return Promise.reject(new Error("not_logged_in"));
        var base = new URL(apiBase());
        var opts = {
            method: "POST",
            hostname: base.hostname,
            path: "/v1/assets/sign",
            port: base.port || 443,
            headers: {
                "Authorization": auth,
                "Content-Type": "application/json",
                "User-Agent": "MotionLegendas-Plugin/1.0"
            }
        };
        var body = JSON.stringify({ asset_id: assetId, fingerprint: fingerprint() });
        return httpRequest(opts, body).then(function (resp) {
            if (resp.status === 401) throw new Error("auth_expired");
            if (resp.status === 402) throw new Error("subscription_inactive");
            if (resp.status === 403) throw new Error("device_not_authorized");
            if (resp.status === 404) throw new Error("asset_not_found");
            if (resp.status >= 400)  throw new Error("sign_failed_" + resp.status);
            try { return JSON.parse(resp.body.toString("utf8")); }
            catch (e) { throw new Error("sign_parse_failed"); }
        });
    }

    var inflight = {};

    function get(item) {
        if (!item) return Promise.reject(new Error("no_item"));

        // Legacy: já tem path local válido (dev machine / ZIP antigo)
        if (!item.cdn_key && item.mogrt && fs) {
            // resolve relativo ao EXT_PATH se for relativo
            var p = item.mogrt;
            if (!path.isAbsolute(p) && global.MPL_EXT_PATH) {
                p = path.join(global.MPL_EXT_PATH, "packs", p);
            }
            if (fs.existsSync(p)) return Promise.resolve(p);
        }
        if (!item.cdn_key) return Promise.reject(new Error("no_cdn_key_and_no_local"));

        var assetId = item.id || item.asset_id;
        if (!assetId) return Promise.reject(new Error("no_asset_id"));
        if (inflight[assetId]) return inflight[assetId];

        var p = (function () {
            var cached = item.sha256 ? cachePathFor(item.sha256) : null;
            if (cached && fileExists(cached)) return Promise.resolve(cached);
            return requestSignedUrl(assetId).then(function (s) {
                var sha = s.sha256 || item.sha256;
                var dest = sha ? cachePathFor(sha) : path.join(CACHE_ROOT, "tmp", assetId + ".mogrt");
                return downloadToFile(s.url, dest, s.sha256).then(function (r) { return r.path; });
            });
        })();

        inflight[assetId] = p;
        p.then(function () { delete inflight[assetId]; },
               function () { delete inflight[assetId]; });
        return p;
    }

    function preload(items) {
        if (!Array.isArray(items) || items.length === 0) return Promise.resolve();
        return items.reduce(function (acc, it) {
            return acc.then(function () { return get(it).catch(function () {}); });
        }, Promise.resolve());
    }

    function walkDir(dir, out) {
        if (!fs) return out;
        try {
            for (var i = 0, files = fs.readdirSync(dir); i < files.length; i++) {
                var p = path.join(dir, files[i]);
                var st; try { st = fs.statSync(p); } catch (_) { continue; }
                if (st.isDirectory()) walkDir(p, out);
                else out.push({ path: p, size: st.size });
            }
        } catch (_) {}
        return out;
    }
    function cacheStats() {
        if (!CACHE_ROOT) return { count: 0, totalBytes: 0 };
        var files = walkDir(CACHE_ROOT, []);
        var bytes = files.reduce(function (s, f) { return s + (f.size || 0); }, 0);
        return { count: files.length, totalBytes: bytes };
    }
    function clearCache() {
        return new Promise(function (resolve) {
            if (!fs || !CACHE_ROOT) return resolve();
            try {
                fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
                fs.mkdirSync(CACHE_ROOT, { recursive: true });
            } catch (_) {}
            resolve();
        });
    }

    global.MPL_AssetLoader = {
        get: get,
        preload: preload,
        cacheStats: cacheStats,
        clearCache: clearCache,
        cacheRoot: CACHE_ROOT
    };
})(typeof window !== "undefined" ? window : globalThis);
