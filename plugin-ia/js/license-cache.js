/* license-cache.js — Motion IA
 *
 * Cache OFFLINE-FIRST da licença (inspirado em Phantom Editor).
 *
 * Arquivo: %APPDATA%\Motion IA\Local Data\CacheData.json
 *
 * Estrutura:
 *   {
 *     "license":             "<encrypted_blob>",   // AES-GCM com chave derivada
 *     "license_key":         "MIA-PRO-...",        // plaintext (necessário pra revalidar)
 *     "status":              "active"|"inactive"|"expired"|"suspended"|"cancelled"|"revoked",
 *     "tier":                "free"|"basic"|"pro"|"lifetime",
 *     "products":            ["motionpro","ia","legendas"],
 *     "device_fingerprint":  "abc123",
 *     "last_validation":     "2026-05-20T16:42:00Z",
 *     "cached_at":           "2026-05-20T16:42:00Z"
 *   }
 *
 * Criptografia: AES-256-GCM
 *   - Key derivada de SHA-256(license_key + device_fingerprint + 'motion-ia-v3')
 *   - Mesma máquina + mesma key = decifrável. Mover arquivo pra outro PC = inválido.
 *
 * Validação offline: isValidForOfflineUse()
 *   - status === "active" E (now - last_validation) < 24h
 *   - Acima de 24h sem validar online → bloqueia até reconectar
 */
(function (global) {
    "use strict";

    var nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) || global.require;
    if (!nodeRequire) { console.warn("[license-cache] Node integration unavailable"); return; }

    var fs     = nodeRequire("fs");
    var path   = nodeRequire("path");
    var os     = nodeRequire("os");
    var crypto = nodeRequire("crypto");

    // ── PATHS ─────────────────────────────────────────────────────────
    var APPDATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    var CACHE_DIR  = path.join(APPDATA, "Motion IA", "Local Data");
    var CACHE_FILE = path.join(CACHE_DIR, "CacheData.json");
    var OFFLINE_MAX_HOURS = 24;

    function ensureDir() {
        try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
    }

    // ── DEVICE FINGERPRINT ────────────────────────────────────────────
    function deviceFingerprint() {
        // Cache no localStorage também (consistente entre sessions)
        var saved = global.localStorage && global.localStorage.getItem("mia_device_fp");
        if (saved) return saved;
        // Combina: hostname + MAC primário + username + cpus
        try {
            var nis = os.networkInterfaces();
            var macs = [];
            Object.keys(nis).forEach(function (k) {
                (nis[k] || []).forEach(function (n) {
                    if (n.mac && n.mac !== "00:00:00:00:00:00") macs.push(n.mac);
                });
            });
            var raw = [os.hostname(), os.userInfo().username, (macs[0] || ""), os.platform()].join("|");
            var fp = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
            if (global.localStorage) global.localStorage.setItem("mia_device_fp", fp);
            return fp;
        } catch (e) {
            // Fallback: random uuid persistente
            var rnd = crypto.randomBytes(16).toString("hex");
            if (global.localStorage) global.localStorage.setItem("mia_device_fp", rnd);
            return rnd;
        }
    }

    // ── CRIPTOGRAFIA (AES-256-GCM com key derivada) ──────────────────
    function deriveKey(licenseKey, fingerprint) {
        return crypto.createHash("sha256")
            .update((licenseKey || "") + "|" + (fingerprint || "") + "|motion-ia-v3")
            .digest();
    }
    function encryptData(plain, licenseKey, fingerprint) {
        if (!plain) return null;
        var key = deriveKey(licenseKey, fingerprint);
        var iv  = crypto.randomBytes(12);
        var cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        var enc = Buffer.concat([cipher.update(JSON.stringify(plain), "utf8"), cipher.final()]);
        var tag = cipher.getAuthTag();
        return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
    }
    function decryptData(blob, licenseKey, fingerprint) {
        if (!blob) return null;
        try {
            var parts = blob.split(":");
            if (parts.length !== 3) return null;
            var key = deriveKey(licenseKey, fingerprint);
            var iv  = Buffer.from(parts[0], "hex");
            var tag = Buffer.from(parts[1], "hex");
            var enc = Buffer.from(parts[2], "hex");
            var decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
            decipher.setAuthTag(tag);
            var dec = Buffer.concat([decipher.update(enc), decipher.final()]);
            return JSON.parse(dec.toString("utf8"));
        } catch (e) { return null; }
    }

    // ── IO ────────────────────────────────────────────────────────────
    function readCache() {
        try {
            if (!fs.existsSync(CACHE_FILE)) return null;
            return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        } catch (e) { return null; }
    }
    function writeCache(obj) {
        ensureDir();
        try { fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf8"); return true; }
        catch (e) { console.error("[license-cache] write fail:", e.message); return false; }
    }
    function clearCache() {
        try { if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE); } catch (_) {}
    }

    // ── API PÚBLICA ───────────────────────────────────────────────────
    var VALID_STATUSES = ["active", "inactive", "expired", "invalid", "suspended", "cancelled", "revoked"];

    function save(payload) {
        // payload: { license_key, status, tier, products, last_validation, ...extras }
        var fp = deviceFingerprint();
        var fullData = {
            license_key:        payload.license_key,
            status:             payload.status,
            tier:               payload.tier,
            products:           payload.products || [],
            max_devices:        payload.max_devices || 3,
            expires_at:         payload.expires_at || null,
            device_fingerprint: fp,
            last_validation:    payload.last_validation || new Date().toISOString(),
            cached_at:          new Date().toISOString(),
            extras:             payload.extras || {}
        };
        // O campo "license" guarda a versão criptografada (tamper-evident)
        var blob = encryptData(fullData, payload.license_key, fp);
        return writeCache({
            license:            blob,
            license_key:        fullData.license_key,
            status:             fullData.status,
            tier:               fullData.tier,
            products:           fullData.products,
            device_fingerprint: fp,
            last_validation:    fullData.last_validation,
            cached_at:          fullData.cached_at
        });
    }

    function load() {
        var raw = readCache();
        if (!raw || !raw.license) return null;
        var fp = deviceFingerprint();
        // Sanity: fingerprint deve bater (proteção contra copiar arquivo entre PCs)
        if (raw.device_fingerprint && raw.device_fingerprint !== fp) {
            console.warn("[license-cache] fingerprint mismatch — cache de outra máquina");
            return null;
        }
        // Tenta decifrar o blob — se falhar, cache foi adulterado
        var decoded = decryptData(raw.license, raw.license_key, fp);
        if (!decoded) {
            console.warn("[license-cache] decrypt failed — cache adulterado ou key errada");
            return null;
        }
        // Retorna mesclado (raw tem campos plain pra UI rápida)
        return Object.assign({}, raw, { _verified: true, _decoded: decoded });
    }

    // Validação offline — só active + última validação < 24h
    function isValidForOfflineUse() {
        var c = load();
        if (!c) return false;
        if (c.status !== "active") return false;
        if (!c.last_validation) return false;
        var lvMs = new Date(c.last_validation).getTime();
        if (isNaN(lvMs)) return false;
        var hoursOld = (Date.now() - lvMs) / (1000 * 60 * 60);
        return hoursOld < OFFLINE_MAX_HOURS;
    }

    // Retorna info da licença pra UI (mascarada)
    function info() {
        var c = load();
        if (!c) return { status: "not_activated" };
        return {
            status:           c.status,
            tier:             c.tier,
            products:         c.products,
            max_devices:      c._decoded && c._decoded.max_devices,
            expires_at:       c._decoded && c._decoded.expires_at,
            last_validation:  c.last_validation,
            cached_at:        c.cached_at,
            offline_valid:    isValidForOfflineUse(),
            masked_key:       maskKey(c.license_key),
            device_fingerprint: c.device_fingerprint
        };
    }

    function maskKey(k) {
        if (!k || k.length < 14) return "—";
        return k.slice(0, 8) + "…" + k.slice(-4);
    }

    global.LicenseCache = {
        save:                save,
        load:                load,
        info:                info,
        clearCache:          clearCache,
        isValidForOfflineUse: isValidForOfflineUse,
        deviceFingerprint:   deviceFingerprint,
        VALID_STATUSES:      VALID_STATUSES,
        CACHE_FILE:          CACHE_FILE
    };
})(typeof window !== "undefined" ? window : globalThis);
