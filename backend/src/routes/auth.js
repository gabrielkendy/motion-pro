"use strict";
const router = require("express").Router();
const bcrypt = require("bcrypt");
const { pool } = require("../db");
const crypto = require("crypto");
const { signSession, signResetToken, verifyResetToken, signEmailVerifyToken, verifyEmailToken } = require("../utils/jwt");
const { resetPasswordEmail, verifyEmailMessage } = require("../utils/email");
const { clientIp, clientUa, geoLookup, parseUaToOs } = require("../utils/ipgeo");

// Cria registro em sessions (idempotente — usa hash do token como chave de revogação)
async function recordSession(req, userId, sessionToken) {
    try {
        const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
        const ip = clientIp(req);
        const ua = clientUa(req);
        const geo = await geoLookup(ip, req).catch(() => ({}));
        const expiresAt = new Date(Date.now() + 30 * 86400000); // 30d
        await pool.query(
            `INSERT INTO sessions(user_id, token_hash, expires_at, last_ip, last_ua, country)
             VALUES($1,$2,$3,$4,$5,$6)
             ON CONFLICT DO NOTHING`,
            [userId, tokenHash, expiresAt, ip, ua, geo.country || null]
        );
    } catch (e) { /* tabela pode não existir antes da migration; ignora */ }
}

const PUBLIC_URL = process.env.PUBLIC_URL || "https://motionpro-lp.vercel.app";

// Normaliza telefone pra E.164 simplificado (mantém só dígitos, + opcional)
function normalizePhone(p) {
    if (!p) return null;
    const s = String(p).trim();
    if (!s) return null;
    const digits = s.replace(/[^\d+]/g, "");
    return digits.length >= 8 ? digits : null;
}

router.post("/signup", async (req, res, next) => {
    try {
        const body = req.body || {};
        const { email, password, name, phone, marketing_optin } = body;
        // Produto de origem do signup — plugins enviam camelCase (productId)
        const product = (body.product_id || body.productId || "motionpro").toString().toLowerCase();
        if (!email || !password || password.length < 8) {
            return res.status(400).json({ error: "email_and_password_required" });
        }
        const hash = await bcrypt.hash(password, 12);
        const normEmail = email.toLowerCase().trim();
        const normName = name ? String(name).trim().slice(0, 120) : null;
        const normPhone = normalizePhone(phone);
        const optin = marketing_optin === false ? false : true;

        const r = await pool.query(
            `INSERT INTO users(email, password_hash, name, phone, marketing_optin)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT (email) DO NOTHING
             RETURNING id, email, name, phone, email_verified`,
            [normEmail, hash, normName, normPhone, optin]
        );
        if (r.rowCount === 0) return res.status(409).json({ error: "email_taken" });
        const u = r.rows[0];

        // Auto-grant 7-day trial DO PRODUTO QUE FEZ O SIGNUP
        const trialDays = Number(process.env.TRIAL_DAYS || 7);
        const expiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
        await pool.query(
            `INSERT INTO subscriptions(user_id, product_id, plan, status, current_period_end)
             VALUES($1, $2, 'trial', 'trialing', $3)`,
            [u.id, product, expiresAt]
        );

        // Manda email de verificação (não bloqueia signup se falhar)
        try {
            const token = signEmailVerifyToken(u.id, u.email);
            const verifyUrl = `${PUBLIC_URL}/verify-email.html?token=${encodeURIComponent(token)}`;
            await verifyEmailMessage({ email: u.email, name: u.name, verifyUrl });
        } catch (e) { console.error("[signup] verify email fail", e.message); }

        // Log no audit
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'signup', $2)",
            [u.id, { has_name: !!normName, has_phone: !!normPhone, trial_days: trialDays, product }]
        );

        const sessionToken = signSession(u.id, u.email);
        await recordSession(req, u.id, sessionToken);
        res.json({
            session_token: sessionToken,
            user: u,
            trial: { active: true, expires_at: expiresAt, days_remaining: trialDays },
            email_verification_sent: true
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

        // 🚫 Bloqueio admin: se user.blocked_at não é null, recusa login
        // (try/catch defensivo — coluna pode não existir antes da migration 007)
        try {
            const blocked = await pool.query("SELECT blocked_at, blocked_reason FROM users WHERE id=$1", [u.id]);
            if (blocked.rowCount && blocked.rows[0].blocked_at) {
                return res.status(403).json({
                    error: "account_blocked",
                    reason: blocked.rows[0].blocked_reason || "Conta bloqueada pelo administrador"
                });
            }
        } catch (e) {
            if (!String(e.message).includes("does not exist")) throw e;
        }

        // register device fingerprint upfront com IP/UA/geo
        if (fingerprint) {
            const ip = clientIp(req);
            const ua = clientUa(req);
            const geo = await geoLookup(ip, req).catch(() => ({}));
            const osName = parseUaToOs(ua);
            await pool.query(
                `INSERT INTO devices(user_id, fingerprint, last_ip, first_ip, last_ua, country, region, city, os_name)
                 VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (user_id, fingerprint) DO UPDATE SET
                   last_seen = now(),
                   revoked = false,
                   last_ip = EXCLUDED.last_ip,
                   last_ua = EXCLUDED.last_ua,
                   country = COALESCE(EXCLUDED.country, devices.country),
                   region  = COALESCE(EXCLUDED.region, devices.region),
                   city    = COALESCE(EXCLUDED.city, devices.city),
                   os_name = COALESCE(EXCLUDED.os_name, devices.os_name)`,
                [u.id, fingerprint, ip, ua, geo.country || null, geo.region || null, geo.city || null, osName]
            );
        }
        const sessionToken = signSession(u.id, u.email);
        await recordSession(req, u.id, sessionToken);
        res.json({ session_token: sessionToken, user: { id: u.id, email: u.email } });
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

        // Tenta mandar por e-mail (Resend). Se não tiver API key, fallback retorna link na resposta.
        let emailResult = null;
        try { emailResult = await resetPasswordEmail({ email: u.email, resetUrl: reset_link }); }
        catch (e) { console.error("[forgot] email fail", e.message); }

        const payload = { ...generic, expires_in: "1h", email_sent: !!emailResult?.ok };
        // Em dev/MVP sem email, ainda retorna o link pra UI mostrar
        if (!emailResult?.ok) payload.reset_link = reset_link;
        res.json(payload);
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

// === VERIFY EMAIL (público, recebe token via URL) ===
router.post("/verify-email", async (req, res, next) => {
    try {
        const { token } = req.body || {};
        if (!token) return res.status(400).json({ error: "token_required" });
        const payload = verifyEmailToken(token);
        if (!payload) return res.status(401).json({ error: "invalid_or_expired_token" });

        const r = await pool.query(
            `UPDATE users SET email_verified=true, email_verified_at=now()
             WHERE id=$1 AND email_verified=false
             RETURNING id, email, name, email_verified, email_verified_at`,
            [payload.sub]
        );
        // Se já era verificado, ainda retorna sucesso (idempotente)
        const u = r.rowCount
            ? r.rows[0]
            : (await pool.query("SELECT id, email, name, email_verified, email_verified_at FROM users WHERE id=$1", [payload.sub])).rows[0];
        if (!u) return res.status(404).json({ error: "user_not_found" });

        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'email_verified', $2)",
            [u.id, { method: "token" }]
        );

        res.json({ ok: true, user: u, already_verified: r.rowCount === 0 });
    } catch (e) { next(e); }
});

// === RESEND VERIFICATION (autenticado) ===
router.post("/resend-verification", async (req, res, next) => {
    try {
        const h = (req.headers.authorization || "").match(/^Bearer (.+)$/);
        if (!h) return res.status(401).json({ error: "missing_token" });
        const { verifySession } = require("../utils/jwt");
        const session = verifySession(h[1]);
        if (!session) return res.status(401).json({ error: "invalid_token" });

        const r = await pool.query("SELECT id, email, name, email_verified FROM users WHERE id=$1", [session.sub]);
        if (!r.rowCount) return res.status(404).json({ error: "user_not_found" });
        const u = r.rows[0];
        if (u.email_verified) return res.json({ ok: true, already_verified: true });

        const token = signEmailVerifyToken(u.id, u.email);
        const verifyUrl = `${PUBLIC_URL}/verify-email.html?token=${encodeURIComponent(token)}`;
        const result = await verifyEmailMessage({ email: u.email, name: u.name, verifyUrl });
        res.json({ ok: true, sent: result?.ok === true });
    } catch (e) { next(e); }
});

// === UPDATE PROFILE (autenticado) ===
router.post("/update-profile", async (req, res, next) => {
    try {
        const h = (req.headers.authorization || "").match(/^Bearer (.+)$/);
        if (!h) return res.status(401).json({ error: "missing_token" });
        const { verifySession } = require("../utils/jwt");
        const session = verifySession(h[1]);
        if (!session) return res.status(401).json({ error: "invalid_token" });

        const { name, phone, marketing_optin } = req.body || {};
        const normName = name !== undefined ? (name ? String(name).trim().slice(0, 120) : null) : undefined;
        const normPhone = phone !== undefined ? normalizePhone(phone) : undefined;

        const sets = [];
        const vals = [];
        let i = 1;
        if (normName !== undefined)    { sets.push(`name=$${i++}`);  vals.push(normName); }
        if (normPhone !== undefined)   { sets.push(`phone=$${i++}`); vals.push(normPhone); }
        if (marketing_optin !== undefined) { sets.push(`marketing_optin=$${i++}`); vals.push(!!marketing_optin); }
        // Se telefone mudou, invalida verificação (cliente precisa verificar de novo)
        if (normPhone !== undefined) { sets.push(`phone_verified=false, phone_verified_at=NULL`); }
        if (!sets.length) return res.status(400).json({ error: "no_fields_to_update" });

        vals.push(session.sub);
        const r = await pool.query(
            `UPDATE users SET ${sets.join(", ")} WHERE id=$${i} RETURNING id, email, name, phone, email_verified, phone_verified, marketing_optin`,
            vals
        );
        res.json({ ok: true, user: r.rows[0] });
    } catch (e) { next(e); }
});

module.exports = { router };
