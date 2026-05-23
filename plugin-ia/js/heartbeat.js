/* heartbeat.js — Motion IA · ζ
 *
 * Heartbeat 15min contra /v1/license/heartbeat — espelhado do plugin-legendas
 * (mesma cadência pra sustentar Neon free tier: 4k req/h vs 12k em 5min).
 *
 * Side effects controlados:
 *   - 401 invalid_token/missing_token → dispatch `mv:auth-expired`
 *     (auth.js mostra banner reconectar; sticky session 30d preserva UX)
 *   - 403 revoked / subscription_inactive → dispatch `mv:license-revoked`
 *     (license-gate.js mostra paywall)
 *   - 5xx / network err → log warning, mantém cache 30d (sticky grace)
 *
 * Fingerprint estável por máquina:
 *   localStorage["mvia_fingerprint"] (crypto.randomUUID, gerado uma vez).
 *   Coexiste com `mia_device_fp` (legacy, usado pelo LicenseCache MIA-).
 */
(function (global) {
    "use strict";

    var HEARTBEAT_MS = 15 * 60 * 1000; // 15 min — match Legendas
    var PRODUCT_ID   = "ia";
    var FP_KEY       = "mvia_fingerprint";
    var handle       = null;
    var lastBeatAt   = null;
    var lastError    = null;

    function getApi() {
        return global.MvApi && global.MvApi.api;
    }

    function getFingerprint() {
        var ls;
        try { ls = global.localStorage; } catch (_) { ls = null; }
        if (!ls) return "fp_no_ls_" + Date.now();
        var fp = null;
        try { fp = ls.getItem(FP_KEY); } catch (_) {}
        if (fp) return fp;
        try {
            if (global.crypto && typeof global.crypto.randomUUID === "function") {
                fp = global.crypto.randomUUID();
            } else if (global.crypto && global.crypto.getRandomValues) {
                var arr = new Uint8Array(16);
                global.crypto.getRandomValues(arr);
                var hex = "";
                for (var i = 0; i < arr.length; i++) hex += (arr[i] < 16 ? "0" : "") + arr[i].toString(16);
                fp = hex;
            } else {
                fp = "fp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
            }
            try { ls.setItem(FP_KEY, fp); } catch (_) {}
        } catch (_) {
            fp = "fp_fallback_" + Date.now();
        }
        return fp;
    }

    function classifyError(res) {
        if (!res) return "unknown";
        if (res.status === 0) return "network";
        if (res.status >= 500) return "server";
        if (res.status === 401) {
            var ec = res.json && res.json.error;
            return (ec === "invalid_token" || ec === "missing_token") ? "auth_expired" : "auth_expired";
        }
        if (res.status === 403) {
            var ec3 = res.json && res.json.error;
            if (ec3 === "subscription_inactive") return "subscription_inactive";
            return "revoked";
        }
        if (res.status >= 400) return "bad_request";
        return "ok";
    }

    function beat() {
        var api = getApi();
        if (!api) {
            console.warn("[mvia-heartbeat] MvApi não carregado — skip beat");
            return Promise.resolve({ ok: false, error: "no_api" });
        }
        var fp = getFingerprint();
        var body = { fingerprint: fp, product_id: PRODUCT_ID, plugin: PRODUCT_ID };
        return api("/v1/license/heartbeat?plugin=" + encodeURIComponent(PRODUCT_ID), {
            method: "POST",
            body: body,
            timeoutMs: 15000
        }).then(function (res) {
            lastBeatAt = Date.now();
            var kind = classifyError(res);
            if (kind === "ok") {
                lastError = null;
                if (res.json && global.MvLicenseCache && global.MvLicenseCache.setCache) {
                    var d = res.json;
                    global.MvLicenseCache.setCache({
                        products:     d.products     || (d.product_id ? [d.product_id] : []),
                        expires_at:   d.expires_at   || null,
                        allowed_skus: d.allowed_skus || [],
                        is_admin:     !!d.is_admin,
                        lifetime:     !!d.lifetime
                    });
                }
                return { ok: true, json: res.json };
            }
            lastError = { kind: kind, status: res.status, at: lastBeatAt };
            if (kind === "auth_expired") {
                try { document.dispatchEvent(new CustomEvent("mv:auth-expired", { detail: lastError })); } catch (_) {}
            } else if (kind === "revoked" || kind === "subscription_inactive") {
                try { document.dispatchEvent(new CustomEvent("mv:license-revoked", { detail: lastError })); } catch (_) {}
            } else if (kind === "server" || kind === "network") {
                console.warn("[mvia-heartbeat] " + kind + " · cache 30d ainda válido:",
                             global.MvLicenseCache && global.MvLicenseCache.isCacheValid && global.MvLicenseCache.isCacheValid());
            }
            return { ok: false, error: kind, status: res.status };
        }).catch(function (e) {
            lastError = { kind: "exception", message: (e && e.message) || String(e), at: Date.now() };
            console.warn("[mvia-heartbeat] exception:", lastError.message);
            return { ok: false, error: "exception" };
        });
    }

    function start() {
        if (handle) return;
        beat();
        handle = setInterval(beat, HEARTBEAT_MS);
        try { console.log("[mvia-heartbeat] started · interval=" + (HEARTBEAT_MS / 60000) + "min"); } catch (_) {}
    }

    function stop() {
        if (handle) {
            clearInterval(handle);
            handle = null;
            try { console.log("[mvia-heartbeat] stopped"); } catch (_) {}
        }
    }

    function status() {
        return {
            running:     !!handle,
            lastBeatAt:  lastBeatAt,
            lastError:   lastError,
            intervalMs:  HEARTBEAT_MS,
            fingerprint: getFingerprint()
        };
    }

    global.MvHeartbeat = {
        start:          start,
        stop:           stop,
        beat:           beat,
        status:         status,
        getFingerprint: getFingerprint,
        INTERVAL_MS:    HEARTBEAT_MS
    };
})(typeof window !== "undefined" ? window : globalThis);
