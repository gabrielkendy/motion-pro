"use strict";
const router = require("express").Router();
const bcrypt = require("bcrypt");
const { pool } = require("../db");
const { signSession } = require("../utils/jwt");

router.post("/signup", async (req, res, next) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password || password.length < 8) {
            return res.status(400).json({ error: "email_and_password_required" });
        }
        const hash = await bcrypt.hash(password, 12);
        const r = await pool.query(
            "INSERT INTO users(email, password_hash) VALUES($1,$2) ON CONFLICT (email) DO NOTHING RETURNING id, email",
            [email.toLowerCase().trim(), hash]
        );
        if (r.rowCount === 0) return res.status(409).json({ error: "email_taken" });
        const u = r.rows[0];

        // Auto-grant 14-day trial with full access (no card required)
        const trialDays = Number(process.env.TRIAL_DAYS || 14);
        const expiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
        await pool.query(
            `INSERT INTO subscriptions(user_id, plan, status, current_period_end)
             VALUES($1, 'trial', 'trialing', $2)`,
            [u.id, expiresAt]
        );

        res.json({
            session_token: signSession(u.id, u.email),
            user: u,
            trial: { active: true, expires_at: expiresAt, days_remaining: trialDays }
        });
    } catch (e) { next(e); }
});

router.post("/login", async (req, res, next) => {
    try {
        const { email, password, fingerprint } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: "missing_credentials" });
        const r = await pool.query("SELECT id, email, password_hash FROM users WHERE email=$1", [email.toLowerCase().trim()]);
        if (r.rowCount === 0) return res.status(401).json({ error: "invalid_credentials" });
        const u = r.rows[0];
        const ok = await bcrypt.compare(password, u.password_hash);
        if (!ok) return res.status(401).json({ error: "invalid_credentials" });

        // register device fingerprint upfront (gated by MAX_DEVICES below in /license/issue)
        if (fingerprint) {
            await pool.query(
                `INSERT INTO devices(user_id, fingerprint) VALUES($1,$2)
                 ON CONFLICT (user_id, fingerprint) DO UPDATE SET last_seen=now(), revoked=false`,
                [u.id, fingerprint]
            );
        }
        res.json({ session_token: signSession(u.id, u.email), user: { id: u.id, email: u.email } });
    } catch (e) { next(e); }
});

module.exports = { router };
