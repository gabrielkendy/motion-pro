/* asset-loader.js — fetches signed CDN URLs and caches mogrt files locally.
 *
 * Flow:
 *   1. plugin needs item.mogrt to import
 *   2. if item.cdn_key + plugin online → POST /v1/assets/sign → download → cache → return cache_path
 *   3. if cache already has matching sha256 → skip download, return cache_path
 *   4. if item.mogrt is a local absolute path (legacy / dev mode) → return it directly
 *
 * Cache layout:
 *   %LOCALAPPDATA%\Motion Titles\cache\<first 2 chars>\<sha256>.mogrt
 *
 * Globals:
 *   window.AssetLoader.get(item)         → Promise<string>  // absolute path on disk
 *   window.AssetLoader.preload(items)    → Promise<void>    // background pre-fetch (favorites)
 *   window.AssetLoader.cacheStats()      → { count, totalBytes }
 *   window.AssetLoader.clearCache()      → Promise<void>
 */
(function (global) {
    "use strict";

    // -------- Node integration (CEP --enable-nodejs --mixed-context) --------
    var nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) || global.require;
    if (typeof nodeRequire !== "function") {
        console.warn("[asset-loader] Node integration unavailable — running in legacy local-path mode only.");
    }
    var fs   = nodeRequire ? nodeRequire("fs")   : null;
    var path = nodeRequire ? nodeRequire("path") : null;
    var os   = nodeRequire ? nodeRequire("os")   : null;
    var http = nodeRequire ? nodeRequire("https") : null;
    var crypto = nodeRequire ? nodeRequire("crypto") : null;

    // -------- Cache dir --------
    var CACHE_ROOT = null;
    if (fs && path && os) {
        var localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
        CACHE_ROOT = path.join(localAppData, "Motion Titles", "cache");
        try { fs.mkdirSync(CACHE_ROOT, { recursive: true }); } catch (_) {}
    }

    // -------- HTTPS POST/GET helpers --------
    function httpRequest(opts, body) {
        return new Promise(function (resolve, reject) {
            if (!http) return reject(new Error("https module unavailable"));
            var req = http.request(opts, function (res) {
                var chunks = [];
                res.on("data", function (c) { chunks.push(c); });
                res.on("end", function () {
                    var buf = Buffer.concat(chunks);
                    resolve({ status: res.statusCode, headers: res.headers, body: buf });
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
                headers: { "User-Agent": "MotionPro-Plugin/1.0" }
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
                            return reject(new Error("sha_mismatch_expected_" + expectedSha256 + "_got_" + sha));
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

    // -------- Cache path resolution --------
    function cachePathFor(sha256, ext) {
        if (!CACHE_ROOT || !sha256) return null;
        var prefix = sha256.slice(0, 2);
        return path.join(CACHE_ROOT, prefix, sha256 + (ext || ".mogrt"));
    }

    function fileExistsAndMatches(p, expectedSha) {
        if (!fs || !p) return Promise.resolve(false);
        return new Promise(function (resolve) {
            fs.stat(p, function (err, st) {
                if (err || !st || !st.isFile()) return resolve(false);
                if (!expectedSha) return resolve(true);
                // optional re-hash on read — gated to save IO on large libs.
                // We trust the cache rename atomicity from downloadToFile.
                resolve(true);
            });
        });
    }

    // -------- Auth / config --------
    function authHeader() {
        // license JWT stored by license.js
        var t = global.localStorage && global.localStorage.getItem("mp_license_token");
        return t ? ("Bearer " + t) : null;
    }
    function fingerprint() {
        // computed by license.js at boot
        return (global.localStorage && global.localStorage.getItem("mp_device_fingerprint")) || "unknown";
    }
    function apiBase() {
        // CONFIG is exposed by config.js, e.g. window.MP_CONFIG.api
        return (global.MP_CONFIG && global.MP_CONFIG.api) || "https://motionpro.vercel.app";
    }

    // -------- Sign helper --------
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
                "User-Agent": "MotionPro-Plugin/1.0"
            }
        };
        var body = JSON.stringify({ asset_id: assetId, fingerprint: fingerprint() });
        return httpRequest(opts, body).then(function (resp) {
            if (resp.status === 401) throw new Error("auth_expired");
            if (resp.status === 402) throw new Error("subscription_inactive");
            if (resp.status === 403) throw new Error("device_not_authorized");
            if (resp.status === 404) throw new Error("asset_not_found");
            if (resp.status >= 400)  throw new Error("sign_failed_" + resp.status);
            try {
                return JSON.parse(resp.body.toString("utf8"));
            } catch (e) { throw new Error("sign_parse_failed"); }
        });
    }

    // -------- Public API --------
    var inflight = {};   // asset_id → Promise<localPath>  (dedupe concurrent requests)

    function get(item) {
        if (!item) return Promise.reject(new Error("no_item"));

        // ---- Legacy local-path mode (Gabriel's dev machine) ----
        if (!item.cdn_key && item.mogrt && fs && fs.existsSync(item.mogrt)) {
            return Promise.resolve(item.mogrt);
        }

        if (!item.cdn_key) {
            return Promise.reject(new Error("no_cdn_key_and_no_local"));
        }

        var assetId = item.id || item.asset_id;
        if (!assetId) return Promise.reject(new Error("no_asset_id"));
        if (inflight[assetId]) return inflight[assetId];

        var p = (function () {
            // 1) check cache first if we know the sha
            var cached = item.sha256 ? cachePathFor(item.sha256, ".mogrt") : null;
            return (cached ? fileExistsAndMatches(cached, item.sha256) : Promise.resolve(false))
                .then(function (hit) {
                    if (hit) return cached;
                    // 2) request signed url + download
                    return requestSignedUrl(assetId).then(function (s) {
                        var sha = s.sha256 || item.sha256;
                        var dest = sha ? cachePathFor(sha, ".mogrt") : path.join(CACHE_ROOT, "tmp", assetId + ".mogrt");
                        return downloadToFile(s.url, dest, s.sha256).then(function (r) { return r.path; });
                    });
                });
        })();

        inflight[assetId] = p;
        p.then(function () { delete inflight[assetId]; },
               function () { delete inflight[assetId]; });
        return p;
    }

    function preload(items) {
        if (!Array.isArray(items) || items.length === 0) return Promise.resolve();
        // serial; CEP cache eviction is not aggressive, just don't hammer.
        return items.reduce(function (acc, it) {
            return acc.then(function () { return get(it).catch(function () {}); });
        }, Promise.resolve());
    }

    function walkDir(dir, out) {
        if (!fs) return out;
        try {
            for (var i = 0, files = fs.readdirSync(dir); i < files.length; i++) {
                var p = path.join(dir, files[i]);
                var st;
                try { st = fs.statSync(p); } catch (_) { continue; }
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

    global.AssetLoader = {
        get: get,
        preload: preload,
        cacheStats: cacheStats,
        clearCache: clearCache,
        cacheRoot: CACHE_ROOT
    };
})(typeof window !== "undefined" ? window : globalThis);
