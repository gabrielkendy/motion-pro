"use strict";
const router = require("express").Router();
const bcrypt = require("bcrypt");
const { pool } = require("../db");
const { signSession, signResetToken, verifyResetToken } = require("../utils/jwt");

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

// === FORGOT PASSWORD ===
// Gera token de reset (válido por 1h). Sem serviço de e-mail configurado, devolve
// o link na resposta — em produção, integre Resend/SES e SOMENTE envie por e-mail.
router.post("/forgot-password", async (req, res, next) => {
    try {
        const { email } = req.body || {};
        if (!email) return res.status(400).json({ error: "email_required" });
        const r = await pool.query("SELECT id, email FROM users WHERE email=$1", [email.toLowerCase().trim()]);
        // Resposta neutra (não revela se email existe) — boa prática segurança
        const generic = { ok: true, message: "Se o e-mail existir, um link de recuperação foi gerado." };
        if (r.rowCount === 0) return res.json(generic);

        const u = r.rows[0];
        const token = signResetToken(u.id, u.email);
        const publicUrl = process.env.PUBLIC_URL || "https://motionpro-lp.vercel.app";
        const reset_link = `${publicUrl}/reset-password.html?token=${encodeURIComponent(token)}`;

        // TODO: enviar por e-mail via Resend/SES. Por enquanto retorna no payload
        // (apenas em dev/MVP — produção NÃO deve devolver o link na resposta).
        res.json({
            ...generic,
            reset_link,        // remover quando email estiver configurado
            expires_in: "1h"
        });
    } catch (e) { next(e); }
});

// === RESET PASSWORD ===
router.post("/reset-password", async (req, res, next) => {
    try {
        const { token, new_password } = req.body || {};
        if (!token || !new_password || new_password.length < 8) {
            return res.status(400).json({ error: "token_and_password_required" });
        }
        const payload = verifyResetToken(token);
        if (!payload) return res.status(401).json({ error: "invalid_or_expired_token" });

        const hash = await bcrypt.hash(new_password, 12);
        const r = await pool.query(
            "UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id, email",
            [hash, payload.sub]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: "user_not_found" });

        // log na auditoria
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'password_reset', $2)",
            [payload.sub, { method: "token" }]
        );

        res.json({
            ok: true,
            session_token: signSession(r.rows[0].id, r.rows[0].email),
            user: r.rows[0]
        });
    } catch (e) { next(e); }
});

// === CHANGE PASSWORD (autenticado) ===
router.post("/change-password", async (req, res, next) => {
    try {
        const h = (req.headers.authorization || "").match(/^Bearer (.+)$/);
        if (!h) return res.status(401).json({ error: "missing_token" });
        const { verifySession } = require("../utils/jwt");
        const session = verifySession(h[1]);
        if (!session) return res.status(401).json({ error: "invalid_token" });

        const { current_password, new_password } = req.body || {};
        if (!current_password || !new_password || new_password.length < 8) {
            return res.status(400).json({ error: "passwords_required" });
        }

        const r = await pool.query("SELECT id, password_hash FROM users WHERE id=$1", [session.sub]);
        if (!r.rowCount) return res.status(404).json({ error: "user_not_found" });

        const ok = await bcrypt.compare(current_password, r.rows[0].password_hash);
        if (!ok) return res.status(401).json({ error: "wrong_current_password" });

        const hash = await bcrypt.hash(new_password, 12);
        await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, session.sub]);
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'password_changed', $2)",
            [session.sub, { method: "self_service" }]
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
});

module.exports = { router };
