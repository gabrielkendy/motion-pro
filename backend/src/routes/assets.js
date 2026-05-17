"use strict";
const router = require("express").Router();
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const TTL_MIN = Number(process.env.CDN_URL_TTL_MIN || 60);

function signCdnUrl(key, fingerprint) {
    const expires = Math.floor(Date.now() / 1000) + TTL_MIN * 60;
    const data = `${key}\n${fingerprint}\n${expires}`;
    const sig = crypto.createHmac("sha256", process.env.CDN_SIGN_SECRET).update(data).digest("base64url");
    const base = process.env.CDN_BASE.replace(/\/$/, "");
    return `${base}/${key}?fp=${encodeURIComponent(fingerprint)}&e=${expires}&s=${sig}`;
}

router.post("/sign", requireAuth, async (req, res, next) => {
    try {
        const { asset_id, fingerprint } = req.body || {};
        if (!asset_id || !fingerprint) return res.status(400).json({ error: "missing_params" });

        // must own a valid device + subscription
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

        const a = await pool.query("SELECT cdn_key FROM assets WHERE id=$1", [asset_id]);
        if (a.rowCount === 0) return res.status(404).json({ error: "asset_not_found" });

        res.json({
            url: signCdnUrl(a.rows[0].cdn_key, fingerprint),
            expires_in: TTL_MIN * 60
        });
    } catch (e) { next(e); }
});

module.exports = { router };
