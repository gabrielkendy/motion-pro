/* license-products-cache.js — Motion IA · ζ (NOVO, espelhado de Legendas)
 *
 * Cache OFFLINE-FIRST da lista de produtos liberados pelo session-token.
 * COEXISTE com o legacy `window.LicenseCache` (license-cache.js) que cuida
 * de MIA- keys criptografadas com grace 24h pra modelos diferentes:
 *
 *   LicenseCache (legacy)   → MIA- key fluxo, AES-GCM, %APPDATA%, grace 24h
 *   MvLicenseCache (este)   → mv_session fluxo, plaintext localStorage, grace 30d
 *
 * Mantemos os dois pra não quebrar license-client.js (out of scope ε/ζ).
 *
 * Storage: localStorage["mvia_license_cache"]
 * Shape:
 *   {
 *     "timestamp":     1748000000000,         // Date.now() do último check OK
 *     "products":      ["ia","duo","suite"],  // skus liberados pro user
 *     "expires_at":    "2026-12-31T23:59Z",   // do plano/sub principal
 *     "allowed_skus":  ["ia","duo","suite","bundle_all"],
 *     "is_admin":      false,                 // refletido pra UI rápida
 *     "lifetime":      false                  // ditto
 *   }
 *
 * TTL: 30 dias. Se API cair e cache < 30d → trata como válido (sticky).
 * Se > 30d → retorna inválido (force re-check ou paywall).
 *
 * Filename `license-products-cache.js` (e não `license-cache.js`) pra evitar
 * collision com o arquivo já existente. ε deve incluir AMBOS no index.html.
 */
(function (global) {
    "use strict";

    var STORAGE_KEY = "mvia_license_cache";
    var TTL_MS      = 30 * 24 * 60 * 60 * 1000; // 30 dias

    function safeStorage() {
        try { return global.localStorage; } catch (_) { return null; }
    }

    function getCache() {
        var ls = safeStorage();
        if (!ls) return null;
        try {
            var raw = ls.getItem(STORAGE_KEY);
            if (!raw) return null;
            var d = JSON.parse(raw);
            if (!d || typeof d !== "object") return null;
            return d;
        } catch (_) { return null; }
    }

    function setCache(payload) {
        var ls = safeStorage();
        if (!ls) return false;
        try {
            var entry = {
                timestamp:    Date.now(),
                products:     (payload && payload.products)     || [],
                expires_at:   (payload && payload.expires_at)   || null,
                allowed_skus: (payload && payload.allowed_skus) || [],
                is_admin:     !!(payload && payload.is_admin),
                lifetime:     !!(payload && payload.lifetime)
            };
            ls.setItem(STORAGE_KEY, JSON.stringify(entry));
            return true;
        } catch (e) {
            try { console.warn("[mvia-license-cache] setCache fail:", e.message); } catch (_) {}
            return false;
        }
    }

    function isCacheValid() {
        var c = getCache();
        if (!c || !c.timestamp) return false;
        var age = Date.now() - Number(c.timestamp || 0);
        if (!isFinite(age) || age < 0) return false;
        return age < TTL_MS;
    }

    // Helper: produto "ia" coberto? Aceita ia, duo, suite, bundle_all.
    function coversIa() {
        var c = getCache();
        if (!c) return false;
        if (c.is_admin) return true;
        if (c.lifetime) return true;
        var p = c.products || [];
        if (!p.length) return false;
        var ACCEPT = { ia: 1, duo: 1, suite: 1, bundle_all: 1 };
        for (var i = 0; i < p.length; i++) {
            if (ACCEPT[String(p[i]).toLowerCase()]) return true;
        }
        return false;
    }

    function clearCache() {
        var ls = safeStorage();
        if (!ls) return;
        try { ls.removeItem(STORAGE_KEY); } catch (_) {}
    }

    function ageHours() {
        var c = getCache();
        if (!c || !c.timestamp) return null;
        return (Date.now() - Number(c.timestamp)) / (1000 * 60 * 60);
    }

    global.MvLicenseCache = {
        STORAGE_KEY:  STORAGE_KEY,
        TTL_MS:       TTL_MS,
        getCache:     getCache,
        setCache:     setCache,
        isCacheValid: isCacheValid,
        coversIa:     coversIa,
        clearCache:   clearCache,
        ageHours:     ageHours
    };
})(typeof window !== "undefined" ? window : globalThis);
