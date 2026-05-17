"use strict";
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { signLicense, verifyLicense } = require("../utils/jwt");

/* Per-plan device limits */
const DEVICE_LIMITS = {
    trial:    2,
    yearly:   2,
    lifetime: 3,
    pro_all:  5
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const DEFAULT_PRODUCT = "motionpro";

/* Retorna sub ativa do usuário PRO PRODUTO especificado.
 * Bundle 'bundle_all' cobre todos os produtos automaticamente. */
async function getActiveSubscription(userId, productId = DEFAULT_PRODUCT) {
    // 1. Bundle ativo cobre TUDO
    const bundle = await pool.query(
        `SELECT plan, status, current_period_end FROM subscriptions
         WHERE user_id=$1 AND product_id='bundle_all' AND status IN ('active','trialing')
         ORDER BY started_at DESC LIMIT 1`,
        [userId]
    );
    if (bundle.rowCount) {
        const s = bundle.rows[0];
        return { plan: s.plan, status: s.status, expiresAt: s.current_period_end, product: "bundle_all" };
    }

    // 2. Subs do produto específico
    const r = await pool.query(
        `SELECT plan, status, current_period_end, cancel_at, started_at
         FROM subscriptions
         WHERE user_id=$1 AND product_id=$2
         ORDER BY started_at DESC`,
        [userId, productId]
    );
    if (r.rowCount === 0) return { plan: "free", status: "none", expiresAt: null, product: productId };

    // 3. Lifetime active vence
    const lifetime = r.rows.find(s => s.plan === "lifetime" && s.status === "active");
    if (lifetime) return { plan: "lifetime", status: "active", expiresAt: null, product: productId };

    // 4. Primeira ativa/trial válida
    const now = new Date();
    for (const s of r.rows) {
        if (s.status === "trialing" && s.current_period_end && new Date(s.current_period_end) < now) {
            await pool.query(
                "UPDATE subscriptions SET status='expired', updated_at=now() WHERE user_id=$1 AND product_id=$2 AND status='trialing' AND current_period_end<now()",
                [userId, productId]
            );
            continue;
        }
        if (ACTIVE_STATUSES.has(s.status)) {
            const notExpired = !s.current_period_end || new Date(s.current_period_end) >= now;
            if (notExpired) {
                return { plan: s.plan, status: s.status, expiresAt: s.current_period_end, product: productId };
            }
        }
    }

    const latest = r.rows[0];
    return {
        plan: "free",
        status: latest.status || "none",
        expiresAt: latest.current_period_end,
        product: productId
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
        const { fingerprint, product_id } = req.body || {};
        if (!fingerprint) return res.status(400).json({ error: "fingerprint_required" });
        const product = product_id || DEFAULT_PRODUCT;

        let sub = await getActiveSubscription(req.user.id, product);

        // 🎁 PRIMEIRA VEZ NESSE PRODUTO? Cria trial automático (14 dias).
        // Aplica só se: status=none (nunca teve sub desse produto) e produto válido (não bundle).
        if (sub.status === "none" && product !== "bundle_all") {
            const prodExists = await pool.query("SELECT 1 FROM products WHERE id=$1 AND is_active=true", [product]);
            if (prodExists.rowCount) {
                const trialDays = Number(process.env.TRIAL_DAYS || 14);
                const expiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
                await pool.query(
                    `INSERT INTO subscriptions(user_id, product_id, plan, status, current_period_end)
                     VALUES($1, $2, 'trial', 'trialing', $3)
                     ON CONFLICT DO NOTHING`,
                    [req.user.id, product, expiresAt]
                );
                await audit(req.user.id, null, "trial_auto_started", { product, days: trialDays });
                // Re-busca pra pegar a nova sub
                sub = await getActiveSubscription(req.user.id, product);
            }
        }

        // 🔒 GATE: só emite license se status for "active" ou "trialing"
        if (!ACTIVE_STATUSES.has(sub.status)) {
            await audit(req.user.id, null, "issue_denied", { reason: sub.status, plan: sub.plan, fingerprint });
            return res.status(403).json({
                error: "subscription_inactive",
                plan: sub.plan,
                status: sub.status,
                message: sub.status === "revoked" ? "Acesso revogado pelo administrador" :
                         sub.status === "canceled" ? "Assinatura cancelada" :
                         sub.status === "expired" ? "Trial ou assinatura expirou" :
                         sub.status === "past_due" ? "Pagamento pendente — atualize cartão" :
                         "Sem assinatura ativa"
            });
        }

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

        // Compose license (license JWT inclui product)
        const license = signLicense({
            userId: req.user.id,
            email: req.user.email,
            plan: sub.plan,
            product,                            // ← product no JWT
            fingerprint,
            packs: ["*"]
        });
        await audit(req.user.id, deviceId, "issue", { plan: sub.plan, product });

        res.json({
            license,
            plan: sub.plan,
            status: sub.status,
            product,
            covers_via_bundle: sub.product === "bundle_all",
            expires_at: sub.expiresAt,
            max_devices: limit
        });
    } catch (e) { next(e); }
});

router.post("/heartbeat", requireAuth, async (req, res, next) => {
    try {
        const { fingerprint, product_id } = req.body || {};
        const product = product_id || DEFAULT_PRODUCT;
        const d = await pool.query(
            "SELECT id, revoked FROM devices WHERE user_id=$1 AND fingerprint=$2",
            [req.user.id, fingerprint]
        );
        if (d.rowCount === 0) return res.status(404).json({ error: "device_unknown" });
        if (d.rows[0].revoked) return res.json({ revoked: true });

        await pool.query("UPDATE devices SET last_seen=now() WHERE id=$1", [d.rows[0].id]);
        const sub = await getActiveSubscription(req.user.id, product);

        // 🔒 GATE: se sub inativa, sinaliza pro plugin (não emite nova license)
        if (!ACTIVE_STATUSES.has(sub.status)) {
            await audit(req.user.id, d.rows[0].id, "heartbeat_inactive", { reason: sub.status, plan: sub.plan });
            return res.json({
                revoked: true,                       // plugin trata como revoked
                subscription_inactive: true,
                plan: sub.plan,
                status: sub.status,
                expires_at: sub.expiresAt
            });
        }

        const license = signLicense({
            userId: req.user.id,
            email: req.user.email,
            plan: sub.plan,
            product,
            fingerprint,
            packs: ["*"]
        });
        await audit(req.user.id, d.rows[0].id, "heartbeat", { plan: sub.plan, product });

        res.json({
            license,
            plan: sub.plan,
            status: sub.status,
            product,
            covers_via_bundle: sub.product === "bundle_all",
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
