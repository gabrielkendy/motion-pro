/* license-client.js — Motion IA
 *
 * Conecta o LicenseCache local com o backend motionpro.vercel.app.
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

    function fp() {
        if (global.LicenseCache && global.LicenseCache.deviceFingerprint) {
            return global.LicenseCache.deviceFingerprint();
        }
        return localStorage.getItem("mia_device_fp") || "unknown";
    }

    function osInfo() {
        try {
            var nodeRequire = (global.cep_node && global.cep_node.require) || global.require;
            if (!nodeRequire) return "unknown";
            var os = nodeRequire("os");
            return os.platform() + "-" + os.arch();
        } catch (_) { return "unknown"; }
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
        if (!key || !key.startsWith("MIA-")) {
            throw new Error("Formato inválido — chave deve começar com MIA-");
        }
        var body = {
            key: key.trim(),
            device_fingerprint: fp(),
            device_name: "CEP Plugin",
            device_os: osInfo()
        };
        var resp = await postJSON("/v1/license-keys/activate", body);
        // Salva no cache local
        if (resp.license && global.LicenseCache) {
            global.LicenseCache.save({
                license_key:     key.trim(),
                status:          "active",
                tier:            resp.license.tier,
                products:        resp.license.products,
                max_devices:     resp.license.max_devices,
                expires_at:      resp.license.expires_at,
                last_validation: new Date().toISOString(),
                extras:          { active_devices: resp.license.active_devices }
            });
        }
        return resp;
    }

    // ── VALIDATE (revalida com backend) ──────────────────────────────
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
                device_fingerprint: fp()
            });
            // Atualiza cache com status fresco
            if (global.LicenseCache) {
                global.LicenseCache.save({
                    license_key:     cache.license_key,
                    status:          resp.active ? "active" : (resp.error || "invalid"),
                    tier:            resp.tier || cache.tier,
                    products:        resp.products || cache.products,
                    max_devices:     resp.max_devices,
                    expires_at:      resp.expires_at,
                    last_validation: new Date().toISOString()
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
            // Mesmo se falhar online, limpa local
            if (global.LicenseCache) global.LicenseCache.clearCache();
            return { ok: true, local_cleared: true, online_error: e.message };
        }
    }

    // ── isReady (sync, sem rede) ─────────────────────────────────────
    function isReady() {
        return global.LicenseCache ? global.LicenseCache.isValidForOfflineUse() : false;
    }

    // ── requireActive: garante licença ativa (offline ou re-valida) ──
    async function requireActive() {
        // 1. Tenta cache offline
        if (isReady()) return { active: true, source: "cache" };
        // 2. Tenta revalidar online
        if (!global.LicenseCache) throw new Error("LicenseCache não disponível");
        var cache = global.LicenseCache.load();
        if (!cache || !cache.license_key) {
            throw new Error("Sem licença — ative em ⚙ Config");
        }
        var resp = await validate({ silent: false });
        if (resp.active) return { active: true, source: "online_revalidate" };
        throw new Error("Licença inválida: " + (resp.error || "unknown"));
    }

    // ── AUTO-VALIDATE on boot + a cada 24h ──────────────────────────
    var autoValidateHandle = null;
    function startAutoValidate(intervalHours) {
        intervalHours = intervalHours || 24;
        // No boot, se cache existe E offline_valid → silent revalidate em background
        if (isReady()) {
            validate({ silent: true }).catch(function () {});
        }
        // Clear any pre-existing interval (evita acumular em reload de CEP)
        if (autoValidateHandle) clearInterval(autoValidateHandle);
        autoValidateHandle = setInterval(function () {
            validate({ silent: true }).catch(function () {});
        }, intervalHours * 60 * 60 * 1000);
    }
    function stopAutoValidate() {
        if (autoValidateHandle) { clearInterval(autoValidateHandle); autoValidateHandle = null; }
    }

    global.LicenseClient = {
        activate:           activate,
        validate:           validate,
        deactivate:         deactivate,
        isReady:            isReady,
        requireActive:      requireActive,
        startAutoValidate:  startAutoValidate,
        stopAutoValidate:   stopAutoValidate
    };
})(typeof window !== "undefined" ? window : globalThis);
