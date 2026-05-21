/* license-client.js — Motion Titles
 *
 * Conecta o LicenseCache local com o backend motionpro.vercel.app.
 *
 * API pública:
 *   LicenseClient.activate(key)        — ativa key + grava cache offline
 *   LicenseClient.validate({silent})   — revalida com backend (auto 24h)
 *   LicenseClient.deactivate()         — desativa device local
 *   LicenseClient.requireActive()      — promise: true se offline ou online ok
 *   LicenseClient.isReady()            — sync: cache válido offline?
 *
 * Prefixos aceitos (Backend β unified contract):
 *   MTI-  → Motion Titles (chave dedicada — products: ["titles"])
 *   MTS-  → Motion Suite bundle (products: ["titles", "legendas", "ia"])
 *   MIA-/MTL- → outros produtos (recusados aqui — não cobrem titles, salvo
 *               se products[] do backend incluir "titles" explicitamente)
 *
 * Fluxo:
 *   1. User cola key + Ativar → POST /v1/license-keys/activate {key, fingerprint, plugin:"titles"}
 *   2. Backend retorna tier/products/expires → cache local criptografado
 *   3. Plugin verifica isValidForOfflineUse() no boot → libera features
 *   4. A cada 24h tenta validate() online (silent) — offline ainda valida pelo cache
 */
(function (global) {
    "use strict";

    var API = (global.MV_CONFIG && global.MV_CONFIG.apiBaseUrl) || "https://motionpro.vercel.app";
    var PRODUCT_ID = (global.MV_CONFIG && global.MV_CONFIG.productId) || "titles";
    var KEY_PREFIX_RE = /^M(TI|TS|IA|TL)-/i;

    function fp() {
        if (global.LicenseCache && global.LicenseCache.deviceFingerprint) {
            return global.LicenseCache.deviceFingerprint();
        }
        return (global.localStorage && (
            global.localStorage.getItem("mv_device_fp")
            || global.localStorage.getItem("mvt_device_fp")
        )) || "unknown";
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

    function normalizeKey(k) {
        return (k || "").trim().toUpperCase();
    }

    function coversTitles(products) {
        return Array.isArray(products) && products.indexOf(PRODUCT_ID) >= 0;
    }

    // ── ACTIVATE ─────────────────────────────────────────────────────
    async function activate(rawKey) {
        var key = normalizeKey(rawKey);
        if (!key) throw new Error("Cole a chave de licença.");
        if (!KEY_PREFIX_RE.test(key)) {
            throw new Error("Formato inválido — chave deve começar com MTI- ou MTS-");
        }
        var prefix = key.slice(0, 3);
        // Bloqueio cedo: MIA-/MTL- só passam se o backend confirmar products inclui "titles"
        // (caso o user tenha uma única chave bundle marcada com outro prefixo).
        var body = {
            key: key,
            fingerprint: fp(),
            device_fingerprint: fp(), // alias pra robustez no backend
            device_name: "CEP Plugin · Motion Titles",
            device_os: osInfo(),
            plugin: PRODUCT_ID
        };
        var resp = await postJSON("/v1/license-keys/activate", body);
        var licInfo = resp.license || resp;            // backend pode aninhar
        var products = licInfo.products || resp.products || [];
        if (!coversTitles(products)) {
            throw new Error(
                "Esta chave (" + prefix + "-) não cobre Motion Titles. " +
                "Use uma chave MTI- ou MTS- (Motion Suite)."
            );
        }
        if (global.LicenseCache) {
            global.LicenseCache.save({
                license_key:     key,
                status:          "active",
                tier:            licInfo.tier || resp.tier,
                products:        products,
                max_devices:     licInfo.max_devices || resp.max_devices,
                expires_at:      licInfo.expires_at  || resp.expires_at,
                last_validation: new Date().toISOString(),
                extras:          {
                    active_devices: licInfo.active_devices || resp.active_devices,
                    via_bundle:     products.length > 1
                }
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
                fingerprint: fp(),
                device_fingerprint: fp(),
                plugin: PRODUCT_ID
            });
            var products = resp.products || cache.products || [];
            if (global.LicenseCache) {
                global.LicenseCache.save({
                    license_key:     cache.license_key,
                    status:          resp.active && coversTitles(products)
                                        ? "active"
                                        : (resp.error || (resp.active ? "wrong_product" : "invalid")),
                    tier:            resp.tier || cache.tier,
                    products:        products,
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
                fingerprint: fp(),
                device_fingerprint: fp(),
                plugin: PRODUCT_ID
            });
            if (global.LicenseCache) global.LicenseCache.clearCache();
            return resp;
        } catch (e) {
            // Mesmo se falhar online, limpa local (admin pode revogar pelo dashboard)
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
        if (isReady()) return { active: true, source: "cache" };
        if (!global.LicenseCache) throw new Error("LicenseCache não disponível");
        var cache = global.LicenseCache.load();
        if (!cache || !cache.license_key) {
            throw new Error("Sem licença — ative em ⚙ Licença & Config");
        }
        var resp = await validate({ silent: false });
        if (resp.active && coversTitles(resp.products || cache.products)) {
            return { active: true, source: "online_revalidate" };
        }
        throw new Error("Licença inválida: " + (resp.error || "unknown"));
    }

    // ── AUTO-VALIDATE on boot + a cada 24h ──────────────────────────
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
        activate:           activate,
        validate:           validate,
        deactivate:         deactivate,
        isReady:            isReady,
        requireActive:      requireActive,
        startAutoValidate:  startAutoValidate,
        stopAutoValidate:   stopAutoValidate,
        coversTitles:       coversTitles,
        PRODUCT_ID:         PRODUCT_ID,
        KEY_PREFIX_RE:      KEY_PREFIX_RE
    };
})(typeof window !== "undefined" ? window : globalThis);
