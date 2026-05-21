"use strict";
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

router.get("/", requireAuth, async (req, res, next) => {
    try {
        const u = await pool.query(
            `SELECT id, email, name, phone, created_at, stripe_customer,
                    email_verified, email_verified_at, phone_verified, phone_verified_at, marketing_optin
             FROM users WHERE id=$1`, [req.user.id]);
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

/**
 * GET /v1/me/products
 * Retorna os plugins ATIVOS do user (vindos de license key OU subscription).
 * Cada plugin chama esse endpoint na inicialização pra decidir o que mostrar.
 *
 * Response:
 * {
 *   products: [
 *     { id: "ia", name: "Motion IA", source: "license", tier: "lifetime",
 *       expires_at: null, key_prefix: "MIA-LIFE-…" },
 *     { id: "titles", name: "Motion Titles", source: "subscription",
 *       tier: "yearly", expires_at: "2027-05-21T…" }
 *   ],
 *   ids: ["ia", "titles"]   // shortcut pra checks rápidos no client
 * }
 *
 * Source-of-truth: view `user_active_products` (migration 012).
 * Apenas produtos ATIVOS são retornados — expirados/revogados ficam fora.
 */
router.get("/products", requireAuth, async (req, res, next) => {
    try {
        const r = await pool.query(
            `SELECT uap.product_id, uap.source, uap.tier, uap.expires_at,
                    uap.key_prefix, uap.granted_at,
                    p.name AS product_name
               FROM user_active_products uap
          LEFT JOIN products p ON p.id = uap.product_id
              WHERE uap.user_id = $1
              ORDER BY uap.product_id`,
            [req.user.id]
        );
        const products = r.rows.map(row => ({
            id: row.product_id,
            name: row.product_name || row.product_id,
            source: row.source,                      // 'license' | 'subscription'
            tier: row.tier,
            expires_at: row.expires_at,
            key_prefix: row.key_prefix,
            granted_at: row.granted_at
        }));
        res.json({
            products,
            ids: products.map(p => p.id)
        });
    } catch (e) {
        // Se a view ainda não existe (migration 012 não rodada), degrada
        // graceful retornando array vazio em vez de 500.
        if (e && /user_active_products/.test(e.message || "")) {
            console.warn("[me/products] view ausente — rodar migration 012:", e.message);
            return res.json({ products: [], ids: [], warning: "migration_012_not_applied" });
        }
        next(e);
    }
});

module.exports = { router };
