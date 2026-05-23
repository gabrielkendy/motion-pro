/* api.js — Motion IA · ζ
 *
 * Fetch wrapper unificado pro backend MotionVault.
 * Espelhado de plugin-legendas/js/auth.js (função `api` interna), refatorado
 * em módulo standalone reutilizável por heartbeat/license-gate/status-bar.
 *
 * Responsabilidades:
 *   - Auto-injeta `Authorization: Bearer <mv_session>` se não houver header
 *   - Auto-injeta `Content-Type: application/json` em POST/PUT/PATCH com body
 *   - Resolve em { ok, status, json, text } — nunca rejeita por HTTP
 *   - Dispara `mv:auth-expired` em 401 (auth.js mostra banner reconectar)
 *
 * NÃO usa async/await pra preservar compat com Chromium antigo do CEP.
 */
(function (global) {
    "use strict";

    var API_BASE = (global.MV_CONFIG && global.MV_CONFIG.apiBaseUrl)
                || "https://motionpro.vercel.app";

    function getToken() {
        try { return global.localStorage && global.localStorage.getItem("mv_session"); }
        catch (_) { return null; }
    }

    function hasHeader(headers, name) {
        if (!headers) return false;
        var ln = name.toLowerCase();
        for (var k in headers) {
            if (headers.hasOwnProperty(k) && String(k).toLowerCase() === ln) return true;
        }
        return false;
    }

    function buildHeaders(opts) {
        var hdrs = {};
        if (opts && opts.headers) {
            for (var k in opts.headers) {
                if (opts.headers.hasOwnProperty(k)) hdrs[k] = opts.headers[k];
            }
        }
        if (!hasHeader(hdrs, "Authorization")) {
            var tok = getToken();
            if (tok) hdrs["Authorization"] = "Bearer " + tok;
        }
        var method = ((opts && opts.method) || "GET").toUpperCase();
        if ((method === "POST" || method === "PUT" || method === "PATCH") && opts && opts.body) {
            if (!hasHeader(hdrs, "Content-Type")) hdrs["Content-Type"] = "application/json";
        }
        return hdrs;
    }

    function normalizeBody(opts) {
        if (!opts || opts.body == null) return undefined;
        if (typeof opts.body === "string") return opts.body;
        try { return JSON.stringify(opts.body); } catch (_) { return String(opts.body); }
    }

    function api(path, opts) {
        opts = opts || {};
        var url = /^https?:/i.test(path) ? path : (API_BASE + path);
        var init = {
            method:  (opts.method || (opts.body ? "POST" : "GET")).toUpperCase(),
            headers: buildHeaders(opts),
            body:    normalizeBody(opts)
        };
        var ctrl = null, timeoutId = null;
        if (typeof AbortController !== "undefined" && opts.timeoutMs) {
            ctrl = new AbortController();
            init.signal = ctrl.signal;
            timeoutId = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, opts.timeoutMs);
        }

        return fetch(url, init).then(function (res) {
            if (timeoutId) clearTimeout(timeoutId);
            return res.text().then(function (text) {
                var json = null;
                if (text) { try { json = JSON.parse(text); } catch (_) { json = null; } }
                if (res.status === 401) {
                    try {
                        document.dispatchEvent(new CustomEvent("mv:auth-expired", {
                            detail: { path: path, status: 401, json: json }
                        }));
                    } catch (_) {}
                }
                return { ok: res.ok, status: res.status, json: json, text: text };
            });
        }).catch(function (err) {
            if (timeoutId) clearTimeout(timeoutId);
            return { ok: false, status: 0, json: null, text: "", error: (err && err.message) || String(err) };
        });
    }

    global.MvApi = {
        api:      api,
        baseUrl:  API_BASE,
        getToken: getToken
    };
})(typeof window !== "undefined" ? window : globalThis);
