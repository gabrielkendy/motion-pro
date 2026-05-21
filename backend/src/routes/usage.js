"use strict";
/**
 * Usage — créditos por uso de features pagas (Gemini / Whisper-pro)
 *
 * Endpoints:
 *   POST /v1/usage/deduct        — deduz N créditos do user atual antes de feature pesada
 *   GET  /v1/usage/balance       — saldo atual + plano
 *   GET  /v1/usage/log?limit=N   — histórico
 *
 * Lógica:
 *   - Master account (admin/lifetime) sempre passa (créditos ∞)
 *   - License key 'pro' / 'lifetime' tem créditos ilimitados
 *   - License key 'basic' tem cota mensal (50)
 *   - License key 'free' tem cota baixa (5)
 *   - Sem license: nega
 */
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const TIER_LIMITS = {
    free:     5,
    basic:   50,
    pro:    -1,
    lifetime: -1
};

async function isMaster(userId) {
    try {
        const u = await pool.query("SELECT is_admin, lifetime_until FROM users WHERE id=$1", [userId]);
        if (!u.rowCount) return false;
        return u.rows[0].is_admin === true ||
               (u.rows[0].lifetime_until && new Date(u.rows[0].lifetime_until) > new Date());
    } catch (e) { return false; }
}

router.get("/usage/balance", requireAuth, async (req, res, next) => {
    try {
        if (await isMaster(req.user.id)) {
            return res.json({ tier: "master", credits: -1, unlimited: true });
        }
        const r = await pool.query(
            "SELECT credits, reset_at FROM user_credits WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
            [req.user.id]
        );
        if (r.rowCount === 0) {
            return res.json({ tier: "free", credits: TIER_LIMITS.free, unlimited: false, source: "default" });
        }
        const row = r.rows[0];
        return res.json({
            tier: "tracked",
            credits: row.credits,
            unlimited: row.credits === -1,
            reset_at: row.reset_at
        });
    } catch (e) { next(e); }
});

router.post("/usage/deduct", requireAuth, async (req, res, next) => {
    try {
        const { feature, credits } = req.body || {};
        if (!feature) return res.status(400).json({ error: "feature_required" });
        const n = Number(credits) || 1;

        if (await isMaster(req.user.id)) {
            await pool.query(
                "INSERT INTO usage_log(user_id, feature, credits_used, success) VALUES($1,$2,$3,true)",
                [req.user.id, feature, n]
            );
            return res.json({ ok: true, remaining: -1, master: true });
        }

        let creditsRow = await pool.query("SELECT id, credits FROM user_credits WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [req.user.id]);
        if (creditsRow.rowCount === 0) {
            await pool.query("INSERT INTO user_credits(user_id, credits) VALUES($1,$2)", [req.user.id, TIER_LIMITS.free]);
            creditsRow = await pool.query("SELECT id, credits FROM user_credits WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [req.user.id]);
        }
        const row = creditsRow.rows[0];
        if (row.credits !== -1 && row.credits < n) {
            await pool.query(
                "INSERT INTO usage_log(user_id, feature, credits_used, success, metadata) VALUES($1,$2,$3,false,$4)",
                [req.user.id, feature, n, { reason: "insufficient_credits" }]
            );
            return res.status(402).json({ error: "insufficient_credits", balance: row.credits, required: n });
        }
        if (row.credits !== -1) {
            await pool.query(
                "UPDATE user_credits SET credits = credits - $1, last_deduct_at = now() WHERE id=$2",
                [n, row.id]
            );
        }
        await pool.query(
            "INSERT INTO usage_log(user_id, feature, credits_used, success) VALUES($1,$2,$3,true)",
            [req.user.id, feature, n]
        );
        res.json({ ok: true, remaining: row.credits === -1 ? -1 : (row.credits - n) });
    } catch (e) { next(e); }
});

router.get("/usage/log", requireAuth, async (req, res, next) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 30, 200);
        const r = await pool.query(
            "SELECT feature, credits_used, success, metadata, created_at FROM usage_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
            [req.user.id, limit]
        );
        res.json({ log: r.rows, count: r.rowCount });
    } catch (e) { next(e); }
});

router.post("/admin/users/:id/grant-credits", requireAdmin, async (req, res, next) => {
    try {
        const { credits } = req.body || {};
        const n = Number(credits) || 0;
        if (n <= 0) return res.status(400).json({ error: "invalid_credits" });
        await pool.query(
            "INSERT INTO user_credits(user_id, credits) VALUES($1,$2)",
            [req.params.id, n]
        );
        res.json({ ok: true, user_id: req.params.id, credits_added: n });
    } catch (e) { next(e); }
});

router.post("/admin/maintenance/run-migration-010", requireAdmin, async (req, res, next) => {
    try {
        const fs = require("fs"); const path = require("path");
        const sqlPath = path.join(__dirname, "..", "..", "migrations", "010_usage_oauth.sql");
        await pool.query(fs.readFileSync(sqlPath, "utf8"));
        res.json({ ok: true, migration: "010_usage_oauth" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = { router };
