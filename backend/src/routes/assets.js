"use strict";
const router = require("express").Router();
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
// v4 (2026-05-22): expandProducts cobre bundles canonicos (duo, suite)
const { expandProducts, normalizeProductId } = require("../utils/product-aliases");

const TTL_MIN = Number(process.env.CDN_URL_TTL_MIN || 5);   // short TTL to limit sharing

function signCdnUrl(key, fingerprint) {
    const expires = Math.floor(Date.now() / 1000) + TTL_MIN * 60;
    const data = `${key}\n${fingerprint}\n${expires}`;
    const sig = crypto.createHmac("sha256", process.env.CDN_SIGN_SECRET).update(data).digest("base64url");
    const base = (process.env.CDN_BASE || "").replace(/\/$/, "");
    return `${base}/${key}?fp=${encodeURIComponent(fingerprint)}&e=${expires}&s=${sig}`;
}

function clientIp(req) {
    return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || null;
}

// Auto-registra device on first sign request se ele nao existe.
// Antes era bloqueio rigido (403); agora cria o device + segue o fluxo.
// Isso desbloqueia users que foram liberados via subscription direta (sem
// passar pelo fluxo /v1/license/issue que registra device).
// Limite implicito: cliente pode ter ate N devices ativos (cf. license_keys.max_devices
// no caso license-key flow, ou subscriptions.max_devices no caso futuro).
async function ensureDeviceRegistered(userId, fingerprint, req) {
    if (!fingerprint) return false;
    try {
        const d = await pool.query(
            "SELECT 1 FROM devices WHERE user_id=$1 AND fingerprint=$2 AND revoked=false",
            [userId, fingerprint]
        );
        if (d.rowCount > 0) return true;
        // Auto-cria — primeira vez deste device
        await pool.query(
            `INSERT INTO devices(user_id, fingerprint, label, first_seen, last_seen, revoked)
             VALUES($1, $2, $3, now(), now(), false)
             ON CONFLICT (user_id, fingerprint) DO UPDATE SET last_seen=now()`,
            [userId, fingerprint, (req.headers["user-agent"] || "").slice(0, 100)]
        );
        try {
            await pool.query(
                "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'device_auto_registered', $2)",
                [userId, { fingerprint, ip: clientIp(req) }]
            );
        } catch (_) { /* audit table pode nao ter user_id se schema antigo */ }
        return true;
    } catch (e) {
        console.error("[assets.ensureDeviceRegistered]", e.message);
        return false;
    }
}

// Verifica se user esta entitled pra um produto:
// - Master account (is_admin OR lifetime_until > now)
// - License_key ativa com products[] cobrindo o asset (MTS- bundles)
// - Subscription ativa/trialing com product_id que expandir cobre o asset
async function isEntitledForProduct(userId, assetProduct) {
    // 1) Master?
    try {
        const u = await pool.query("SELECT is_admin, lifetime_until FROM users WHERE id=$1", [userId]);
        if (u.rowCount && (u.rows[0].is_admin === true ||
            (u.rows[0].lifetime_until && new Date(u.rows[0].lifetime_until) > new Date()))) {
            return true;
        }
    } catch (e) {
        if (!String(e.message).includes("does not exist")) throw e;
    }
    // 2) License_key ativa cobre product?
    try {
        const lk = await pool.query(
            `SELECT products FROM license_keys
              WHERE customer_email = (SELECT email FROM users WHERE id=$1)
                AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > now())`,
            [userId]
        );
        for (const row of lk.rows) {
            const prods = expandProducts(row.products || []);
            if (prods.includes(assetProduct) || prods.includes("*")) return true;
        }
    } catch (_) { /* tabela pode estar offline · cai pra subscriptions */ }
    // 3) Subscription ativa/trial com product expandido cobre?
    try {
        const sub = await pool.query(
            `SELECT product_id FROM subscriptions
              WHERE user_id=$1 AND status IN ('active','trialing')`,
            [userId]
        );
        for (const row of sub.rows) {
            const canonical = normalizeProductId(row.product_id) || row.product_id;
            const prods = expandProducts([canonical]);
            if (prods.includes(assetProduct) || prods.includes("*") ||
                canonical === assetProduct ||
                canonical === "bundle_all" ||                  // legacy alias
                row.product_id === "bundle_all") return true;
        }
    } catch (_) {}
    return false;
}

router.post("/sign", requireAuth, async (req, res, next) => {
    try {
        if (!process.env.CDN_SIGN_SECRET || !process.env.CDN_BASE) {
            return res.status(503).json({ error: "cdn_not_configured" });
        }

        const { asset_id, fingerprint } = req.body || {};
        if (!asset_id || !fingerprint) return res.status(400).json({ error: "missing_params" });

        // Auto-registra device se for a primeira vez (substitui o 403 rigido antigo).
        // User liberado via SQL/subscription direta ainda nao tem entry em `devices`,
        // entao a gente cria sozinho — entitlement de verdade vem do isEntitledForProduct.
        const deviceOk = await ensureDeviceRegistered(req.user.id, fingerprint, req);
        if (!deviceOk) return res.status(403).json({ error: "device_not_authorized" });

        const a = await pool.query(
            "SELECT cdn_key, kind, sha256, size_bytes, product_id, published FROM assets WHERE id=$1",
            [asset_id]
        );
        if (a.rowCount === 0)         return res.status(404).json({ error: "asset_not_found" });
        if (!a.rows[0].published)     return res.status(404).json({ error: "asset_not_published" });

        // Entitlement unificado: master account, license_key (MTS- bundles), ou
        // subscription ativa/trial com product expandido via aliases (duo, suite, etc).
        const assetProduct = a.rows[0].product_id || "motionpro";
        const entitled = await isEntitledForProduct(req.user.id, assetProduct);
        if (!entitled) {
            return res.status(402).json({ error: "product_not_entitled", product: assetProduct });
        }

        // Log download intent
        try {
            await pool.query(
                "INSERT INTO asset_download_log(user_id, asset_id, fingerprint, ip, ua) VALUES($1,$2,$3,$4,$5)",
                [req.user.id, asset_id, fingerprint, clientIp(req), (req.headers["user-agent"] || "").slice(0, 200)]
            );
        } catch (_) { /* non-fatal */ }

        res.json({
            url: signCdnUrl(a.rows[0].cdn_key, fingerprint),
            expires_in: TTL_MIN * 60,
            sha256: a.rows[0].sha256 || null,
            size_bytes: a.rows[0].size_bytes || null,
            kind: a.rows[0].kind || "mogrt",
        });
    } catch (e) { next(e); }
});

// Batch sign — plugin can request up to 50 URLs in one round-trip (eg. preload favorites)
router.post("/sign-batch", requireAuth, async (req, res, next) => {
    try {
        if (!process.env.CDN_SIGN_SECRET || !process.env.CDN_BASE) {
            return res.status(503).json({ error: "cdn_not_configured" });
        }

        const { asset_ids, fingerprint } = req.body || {};
        if (!Array.isArray(asset_ids) || asset_ids.length === 0 || !fingerprint) {
            return res.status(400).json({ error: "missing_params" });
        }
        if (asset_ids.length > 50) return res.status(400).json({ error: "too_many_assets" });

        const deviceOk = await ensureDeviceRegistered(req.user.id, fingerprint, req);
        if (!deviceOk) return res.status(403).json({ error: "device_not_authorized" });

        const rows = (await pool.query(
            "SELECT id, cdn_key, sha256, size_bytes, kind, product_id FROM assets WHERE id = ANY($1) AND published=true",
            [asset_ids]
        )).rows;

        // Resolve entitlement por produto unico (evita query repetida quando lote tem
        // varios assets do mesmo product_id — caso comum em preload de favoritos).
        const uniqueProducts = Array.from(new Set(rows.map(r => r.product_id || "motionpro")));
        const entitlementMap = {};
        for (const p of uniqueProducts) {
            entitlementMap[p] = await isEntitledForProduct(req.user.id, p);
        }

        const result = rows.map(r => {
            const product = r.product_id || "motionpro";
            if (!entitlementMap[product]) {
                return { asset_id: r.id, error: "product_not_entitled", product };
            }
            return {
                asset_id:   r.id,
                url:        signCdnUrl(r.cdn_key, fingerprint),
                expires_in: TTL_MIN * 60,
                sha256:     r.sha256 || null,
                size_bytes: r.size_bytes || null,
                kind:       r.kind || "mogrt",
            };
        });

        res.json({ items: result });
    } catch (e) { next(e); }
});

module.exports = { router };
