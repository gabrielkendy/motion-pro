/* license-client.js — Motion Legendas
 *
 * Conecta o LicenseCache local com o backend motionpro.vercel.app.
 *
 * Aceita prefixos:
 *   - MTL-XXXX  (Motion Legendas standalone)
 *   - MTS-XXXX  (Bundle Motion Suite · covers_via_bundle=true,
 *                products = ["titles","legendas","ia"])
 *
 * API pública:
 *   LicenseClient.activate(key)        — ativa key + grava cache offline
 *   LicenseClient.validate()           — revalida com backend (chamada a cada 24h)
 *   LicenseClient.deactivate()         — desativa device local
 *   LicenseClient.requireActive()      — promise resolve se license active (offline ou online)
 *   LicenseClient.isReady()            — sync: tem cache válido offline?
 *
 * Fluxo:
 *   1. User cola key + clica Ativar → POST /v1/license-keys/activate
 *   2. Backend retorna tier/products/expires → cache local criptografado
 *   3. Plugin verifica isValidForOfflineUse() no boot → libera features
 *   4. A cada 24h tenta revalidate() online (silent) — se falhar offline, ainda válido
 */
(function (global) {
    "use strict";

    var API = (global.MV_CONFIG && global.MV_CONFIG.apiBaseUrl) || "https://motionpro.vercel.app";
    var ACCEPTED_PREFIXES = ["MTL-", "MTS-"];
    var PRODUCT_ID = (global.MV_CONFIG && global.MV_CONFIG.productId) || "legendas";

    function fp() {
        if (global.LicenseCache && global.LicenseCache.deviceFingerprint) {
            return global.LicenseCache.deviceFingerprint();
        }
        return (global.localStorage && global.localStorage.getItem("mtl_device_fp")) || "unknown";
    }

    function osInfo() {
        try {
            var nodeRequire = (global.cep_node && global.cep_node.require) || global.require;
            if (!nodeRequire) return "unknown";
            var os = nodeRequire("os");
            return os.platform() + "-" + os.arch();
        } catch (_) { return "unknown"; }
    }

    function hasAcceptedPrefix(key) {
        if (!key) return false;
        var k = String(key).trim().toUpperCase();
        for (var i = 0; i < ACCEPTED_PREFIXES.length; i++) {
            if (k.indexOf(ACCEPTED_PREFIXES[i]) === 0) return true;
        }
        return false;
    }

    async function postJSON(path, body) {
        var res = await fetch(API + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {})
        });
        var text = await res.text();
        var data; try { data = JSON.parse(text); } catch (_) { data = { error: text }; }
        if (!res.ok) {
            var err = new Error(data.error || "http_" + res.status);
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    // ── ACTIVATE ─────────────────────────────────────────────────────
    async function activate(key) {
        var trimmed = (key || "").trim();
        if (!hasAcceptedPrefix(trimmed)) {
            throw new Error("Formato inválido — chave deve começar com MTL- (Motion Legendas) ou MTS- (Bundle Motion Suite)");
        }
        var body = {
            key: trimmed,
            device_fingerprint: fp(),
            device_name: "CEP Plugin",
            device_os: osInfo(),
            plugin: PRODUCT_ID
        };
        var resp = await postJSON("/v1/license-keys/activate", body);
        // Salva no cache local
        if (resp.license && global.LicenseCache) {
            // Bundle MTS- detection: products inclui mais de 1 ou starts com MTS-
            var products = resp.license.products || [];
            var isBundle = (trimmed.toUpperCase().indexOf("MTS-") === 0)
                        || (Array.isArray(products) && products.length > 1)
                        || !!resp.license.covers_via_bundle;
            global.LicenseCache.save({
                license_key:       trimmed,
                status:            "active",
                tier:              resp.license.tier,
                products:          products,
                covers_via_bundle: isBundle,
                max_devices:       resp.license.max_devices,
                expires_at:        resp.license.expires_at,
                last_validation:   new Date().toISOString(),
                extras:            { active_devices: resp.license.active_devices }
            });
        }
        return resp;
    }

    // ── VALIDATE ─────────────────────────────────────────────────────
    async function validate(opts) {
        opts = opts || {};
        var cache = global.LicenseCache && global.LicenseCache.load();
        if (!cache || !cache.license_key) {
            if (opts.silent) return { active: false };
            throw new Error("Nenhuma licença ativa pra revalidar");
        }
        try {
            var resp = await postJSON("/v1/license-keys/validate", {
                key: cache.license_key,
                device_fingerprint: fp(),
                plugin: PRODUCT_ID
            });
            if (global.LicenseCache) {
                var products = resp.products || cache.products || [];
                var isBundle = (cache.license_key && cache.license_key.toUpperCase().indexOf("MTS-") === 0)
                            || (Array.isArray(products) && products.length > 1)
                            || !!resp.covers_via_bundle;
                global.LicenseCache.save({
                    license_key:       cache.license_key,
                    status:            resp.active ? "active" : (resp.error || "invalid"),
                    tier:              resp.tier || cache.tier,
                    products:          products,
                    covers_via_bundle: isBundle,
                    max_devices:       resp.max_devices,
                    expires_at:        resp.expires_at,
                    last_validation:   new Date().toISOString()
                });
            }
            return resp;
        } catch (e) {
            if (opts.silent) return { active: false, error: e.message, offline: true };
            throw e;
        }
    }

    // ── DEACTIVATE ───────────────────────────────────────────────────
    async function deactivate() {
        var cache = global.LicenseCache && global.LicenseCache.load();
        if (!cache || !cache.license_key) {
            if (global.LicenseCache) global.LicenseCache.clearCache();
            return { ok: true, local_only: true };
        }
        try {
            var resp = await postJSON("/v1/license-keys/deactivate", {
                key: cache.license_key,
                device_fingerprint: fp()
            });
            if (global.LicenseCache) global.LicenseCache.clearCache();
            return resp;
        } catch (e) {
            if (global.LicenseCache) global.LicenseCache.clearCache();
            return { ok: true, local_cleared: true, online_error: e.message };
        }
    }

    function isReady() {
        return global.LicenseCache ? global.LicenseCache.isValidForOfflineUse() : false;
    }

    async function requireActive() {
        if (isReady()) return { active: true, source: "cache" };
        if (!global.LicenseCache) throw new Error("LicenseCache não disponível");
        var cache = global.LicenseCache.load();
        if (!cache || !cache.license_key) {
            throw new Error("Sem licença — ative em ⚙ Config");
        }
        var resp = await validate({ silent: false });
        if (resp.active) return { active: true, source: "online_revalidate" };
        throw new Error("Licença inválida: " + (resp.error || "unknown"));
    }

    var autoValidateHandle = null;
    function startAutoValidate(intervalHours) {
        intervalHours = intervalHours || 24;
        if (isReady()) {
            validate({ silent: true }).catch(function () {});
        }
        if (autoValidateHandle) clearInterval(autoValidateHandle);
        autoValidateHandle = setInterval(function () {
            validate({ silent: true }).catch(function () {});
        }, intervalHours * 60 * 60 * 1000);
    }
    function stopAutoValidate() {
        if (autoValidateHandle) { clearInterval(autoValidateHandle); autoValidateHandle = null; }
    }

    global.LicenseClient = {
        activate:          activate,
        validate:          validate,
        deactivate:        deactivate,
        isReady:           isReady,
        requireActive:     requireActive,
        startAutoValidate: startAutoValidate,
        stopAutoValidate:  stopAutoValidate,
        hasAcceptedPrefix: hasAcceptedPrefix,
        ACCEPTED_PREFIXES: ACCEPTED_PREFIXES
    };
})(typeof window !== "undefined" ? window : globalThis);
