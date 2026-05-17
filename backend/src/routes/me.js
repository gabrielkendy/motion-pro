"use strict";
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

router.get("/", requireAuth, async (req, res, next) => {
    try {
        const u = await pool.query("SELECT id, email, created_at, stripe_customer FROM users WHERE id=$1", [req.user.id]);
        const s = await pool.query(
            `SELECT plan, status, current_period_end, cancel_at FROM subscriptions
             WHERE user_id=$1 ORDER BY started_at DESC LIMIT 1`, [req.user.id]
        );
        res.json({ user: u.rows[0], subscription: s.rows[0] || null });
    } catch (e) { next(e); }
});

router.get("/machines", requireAuth, async (req, res, next) => {
    try {
        const r = await pool.query(
            "SELECT id, fingerprint, label, first_seen, last_seen, revoked FROM devices WHERE user_id=$1 ORDER BY last_seen DESC",
            [req.user.id]
        );
        res.json({
            devices: r.rows,
            limit: Number(process.env.MAX_DEVICES_PER_LICENSE || 2)
        });
    } catch (e) { next(e); }
});

router.delete("/machines/:id", requireAuth, async (req, res, next) => {
    try {
        await pool.query(
            "UPDATE devices SET revoked=true WHERE id=$1 AND user_id=$2",
            [req.params.id, req.user.id]
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
});

module.exports = { router };
