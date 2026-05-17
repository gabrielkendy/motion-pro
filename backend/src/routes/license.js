"use strict";
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { signLicense, verifyLicense } = require("../utils/jwt");

/* Per-plan device limits — easy to adjust later */
const DEVICE_LIMITS = {
    trial:    2,
    yearly:   2,
    lifetime: 3,
    pro_all:  5
};

/* Returns the user's current effective plan, status, and expiration.
 * Handles trial expiration automatically (returns "free" if trial expired
 * without conversion). */
async function getActiveSubscription(userId) {
    const r = await pool.query(
        `SELECT plan, status, current_period_end, cancel_at
         FROM subscriptions
         WHERE user_id=$1
         ORDER BY started_at DESC LIMIT 1`,
        [userId]
    );
    if (r.rowCount === 0) return { plan: "free", status: "none", expiresAt: null };

    const s = r.rows[0];
    // Lifetime never expires
    if (s.plan === "lifetime" && s.status === "active") {
        return { plan: "lifetime", status: "active", expiresAt: null };
    }
    // Trial expiration check
    if (s.status === "trialing" && s.current_period_end && new Date(s.current_period_end) < new Date()) {
        await pool.query(
            "UPDATE subscriptions SET status='expired', updated_at=now() WHERE user_id=$1 AND status='trialing'",
            [userId]
        );
        return { plan: "free", status: "expired", expiresAt: s.current_period_end };
    }
    return {
        plan: s.plan,
        status: s.status,
        expiresAt: s.current_period_end
    };
}

async function audit(userId, deviceId, action, detail) {
    await pool.query(
        "INSERT INTO license_audit(user_id, device_id, action, detail) VALUES($1,$2,$3,$4)",
        [userId, deviceId, action, detail || null]
    );
}

router.post("/issue", requireAuth, async (req, res, next) => {
    try {
        const { fingerprint } = req.body || {};
        if (!fingerprint) return res.status(400).json({ error: "fingerprint_required" });

        const sub = await getActiveSubscription(req.user.id);
        const limit = DEVICE_LIMITS[sub.plan] || 0;

        // Device cap check (existing fingerprint always allowed)
        const dr = await pool.query(
            "SELECT id, fingerprint, revoked FROM devices WHERE user_id=$1 AND revoked=false",
            [req.user.id]
        );
        const exists = dr.rows.find(d => d.fingerprint === fingerprint);
        if (!exists && dr.rowCount >= limit) {
            await audit(req.user.id, null, "device_limit", { plan: sub.plan, fingerprint });
            return res.status(403).json({ error: "device_limit_reached", limit, plan: sub.plan });
        }

        // Register/refresh device
        let deviceId = exists ? exists.id : null;
        if (!deviceId) {
            const ins = await pool.query(
                "INSERT INTO devices(user_id, fingerprint) VALUES($1,$2) RETURNING id",
                [req.user.id, fingerprint]
            );
            deviceId = ins.rows[0].id;
        }
        await pool.query("UPDATE devices SET last_seen=now() WHERE id=$1", [deviceId]);

        // Compose license
        const license = signLicense({
            userId: req.user.id,
            email: req.user.email,
            plan: sub.plan,
            fingerprint,
            packs: sub.plan === "free" ? [] : ["*"]
        });
        await audit(req.user.id, deviceId, "issue", { plan: sub.plan });

        res.json({
            license,
            plan: sub.plan,
            status: sub.status,
            expires_at: sub.expiresAt,
            max_devices: limit
        });
    } catch (e) { next(e); }
});

router.post("/heartbeat", requireAuth, async (req, res, next) => {
    try {
        const { fingerprint } = req.body || {};
        const d = await pool.query(
            "SELECT id, revoked FROM devices WHERE user_id=$1 AND fingerprint=$2",
            [req.user.id, fingerprint]
        );
        if (d.rowCount === 0) return res.status(404).json({ error: "device_unknown" });
        if (d.rows[0].revoked) return res.json({ revoked: true });

        await pool.query("UPDATE devices SET last_seen=now() WHERE id=$1", [d.rows[0].id]);
        const sub = await getActiveSubscription(req.user.id);
        const license = signLicense({
            userId: req.user.id,
            email: req.user.email,
            plan: sub.plan,
            fingerprint,
            packs: sub.plan === "free" ? [] : ["*"]
        });
        await audit(req.user.id, d.rows[0].id, "heartbeat", { plan: sub.plan });

        res.json({
            license,
            plan: sub.plan,
            status: sub.status,
            expires_at: sub.expiresAt
        });
    } catch (e) { next(e); }
});

// === VALIDATE LICENSE (public) ===
// Aceita um JWT de licença e devolve detalhes + status atual no banco.
// Útil pro plugin re-verificar localmente e pra ferramentas externas/integrações.
router.post("/validate", async (req, res, next) => {
    try {
        const { license, fingerprint } = req.body || {};
        if (!license) return res.status(400).json({ error: "license_required" });
        const payload = verifyLicense(license);
        if (!payload) return res.status(401).json({ valid: false, error: "invalid_or_expired_license" });

        // Cross-check com o banco: o usuário ainda existe? assinatura ainda ativa?
        const u = await pool.query(
            "SELECT id, email FROM users WHERE id=$1",
            [payload.uid]
        );
        if (!u.rowCount) return res.status(401).json({ valid: false, error: "user_not_found" });

        const sub = await getActiveSubscription(payload.uid);
        const sameFp = fingerprint ? payload.fp === fingerprint : true;
        const isActive = ["active", "trialing"].includes(sub.status) ||
                         (sub.plan === "lifetime" && sub.status === "active");

        // Se enviou fingerprint, checa se device foi revogado
        let deviceRevoked = false;
        if (fingerprint) {
            const d = await pool.query(
                "SELECT revoked FROM devices WHERE user_id=$1 AND fingerprint=$2",
                [payload.uid, fingerprint]
            );
            deviceRevoked = d.rowCount > 0 && d.rows[0].revoked;
        }

        const valid = isActive && sameFp && !deviceRevoked;

        res.json({
            valid,
            email: payload.sub,
            plan: payload.plan,
            current_plan: sub.plan,
            status: sub.status,
            expires_at: sub.expiresAt,
            fingerprint_match: sameFp,
            device_revoked: deviceRevoked,
            packs: payload.packs || [],
            exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
            iat: payload.iat ? new Date(payload.iat * 1000).toISOString() : null
        });
    } catch (e) { next(e); }
});

module.exports = { router };
