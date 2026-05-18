"use strict";
const router = require("express").Router();
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

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

router.post("/sign", requireAuth, async (req, res, next) => {
    try {
        if (!process.env.CDN_SIGN_SECRET || !process.env.CDN_BASE) {
            return res.status(503).json({ error: "cdn_not_configured" });
        }

        const { asset_id, fingerprint } = req.body || {};
        if (!asset_id || !fingerprint) return res.status(400).json({ error: "missing_params" });

        // must own a registered device + active subscription
        const d = await pool.query(
            "SELECT 1 FROM devices WHERE user_id=$1 AND fingerprint=$2 AND revoked=false",
            [req.user.id, fingerprint]
        );
        if (d.rowCount === 0) return res.status(403).json({ error: "device_not_authorized" });

        const s = await pool.query(
            `SELECT 1 FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') LIMIT 1`,
            [req.user.id]
        );
        if (s.rowCount === 0) return res.status(402).json({ error: "no_active_subscription" });

        const a = await pool.query(
            "SELECT cdn_key, kind, sha256, size_bytes, product_id, published FROM assets WHERE id=$1",
            [asset_id]
        );
        if (a.rowCount === 0)         return res.status(404).json({ error: "asset_not_found" });
        if (!a.rows[0].published)     return res.status(404).json({ error: "asset_not_published" });

        // Optional: enforce product entitlement
        // (uncomment + adjust once subscription.product_id is wired up)
        // const ok = await pool.query(
        //   "SELECT 1 FROM subscriptions WHERE user_id=$1 AND product_id=$2 AND status IN ('active','trialing')",
        //   [req.user.id, a.rows[0].product_id]
        // );
        // if (ok.rowCount === 0) return res.status(403).json({ error: "product_not_entitled" });

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

        const d = await pool.query(
            "SELECT 1 FROM devices WHERE user_id=$1 AND fingerprint=$2 AND revoked=false",
            [req.user.id, fingerprint]
        );
        if (d.rowCount === 0) return res.status(403).json({ error: "device_not_authorized" });

        const s = await pool.query(
            `SELECT 1 FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') LIMIT 1`,
            [req.user.id]
        );
        if (s.rowCount === 0) return res.status(402).json({ error: "no_active_subscription" });

        const rows = (await pool.query(
            "SELECT id, cdn_key, sha256, size_bytes, kind FROM assets WHERE id = ANY($1) AND published=true",
            [asset_ids]
        )).rows;

        const result = rows.map(r => ({
            asset_id:   r.id,
            url:        signCdnUrl(r.cdn_key, fingerprint),
            expires_in: TTL_MIN * 60,
            sha256:     r.sha256 || null,
            size_bytes: r.size_bytes || null,
            kind:       r.kind || "mogrt",
        }));

        res.json({ items: result });
    } catch (e) { next(e); }
});

module.exports = { router };
