"use strict";
const router = require("express").Router();
const Stripe = require("stripe");
const { pool } = require("../db");
const { requireAdmin } = require("../middleware/auth");

const stripe = Stripe(process.env.STRIPE_SECRET || "sk_test_xxx");

// === STATS / KPIs ===
router.get("/stats", requireAdmin, async (_req, res, next) => {
    try {
        const r = await pool.query(`
            SELECT
              (SELECT COUNT(*) FROM users) AS total_users,
              (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '30 days') AS new_users_30d,
              (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '7 days') AS new_users_7d,
              (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status IN ('active','trialing')) AS active_subs,
              (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status = 'trialing') AS trialing_subs,
              (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status = 'active' AND plan = 'yearly') AS yearly_subs,
              (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status = 'active' AND plan = 'lifetime') AS lifetime_subs,
              (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status = 'canceled') AS canceled_subs,
              (SELECT COUNT(*) FROM devices WHERE NOT revoked) AS active_devices
        `);
        const stats = r.rows[0];

        // MRR estimate (yearly / 12 * 199 + lifetime nao conta em MRR)
        const mrr = Number(stats.yearly_subs) * (199 / 12);
        const totalRevenue = Number(stats.yearly_subs) * 199 + Number(stats.lifetime_subs) * 499;

        res.json({
            ...stats,
            mrr_brl: Math.round(mrr * 100) / 100,
            total_revenue_brl: totalRevenue,
            generated_at: new Date().toISOString()
        });
    } catch (e) { next(e); }
});

// === LIST USERS (with subscriptions + devices count) ===
router.get("/users", requireAdmin, async (req, res, next) => {
    try {
        const search = (req.query.q || "").trim().toLowerCase();
        const status = req.query.status || ""; // active, trialing, canceled, all
        const limit = Math.min(Number(req.query.limit) || 100, 500);

        const params = [];
        const where = [];
        if (search) { params.push("%" + search + "%"); where.push(`LOWER(u.email) LIKE $${params.length}`); }
        if (status && status !== "all") {
            params.push(status);
            where.push(`EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.user_id=u.id AND s2.status=$${params.length})`);
        }
        params.push(limit);

        const sql = `
            SELECT
              u.id,
              u.email,
              u.name,
              u.phone,
              u.email_verified,
              u.phone_verified,
              u.marketing_optin,
              u.created_at,
              u.is_admin,
              u.stripe_customer,
              (SELECT json_agg(json_build_object(
                  'id', s.id,
                  'plan', s.plan,
                  'status', s.status,
                  'stripe_sub_id', s.stripe_sub_id,
                  'started_at', s.started_at,
                  'current_period_end', s.current_period_end,
                  'cancel_at', s.cancel_at,
                  'updated_at', s.updated_at
              ) ORDER BY s.created_at DESC)
                 FROM subscriptions s WHERE s.user_id = u.id) AS subscriptions,
              (SELECT COUNT(*) FROM devices d WHERE d.user_id=u.id AND NOT d.revoked) AS active_devices,
              (SELECT COUNT(*) FROM devices d WHERE d.user_id=u.id) AS total_devices
            FROM users u
            ${where.length ? "WHERE " + where.join(" AND ") : ""}
            ORDER BY u.created_at DESC
            LIMIT $${params.length}
        `;
        const r = await pool.query(sql, params);
        res.json({ users: r.rows, count: r.rowCount });
    } catch (e) { next(e); }
});

// === USER DETAIL ===
router.get("/users/:id", requireAdmin, async (req, res, next) => {
    try {
        const u = await pool.query(
            `SELECT id, email, name, phone, email_verified, email_verified_at,
                    phone_verified, phone_verified_at, marketing_optin,
                    created_at, is_admin, stripe_customer
             FROM users WHERE id=$1`, [req.params.id]);
        if (!u.rowCount) return res.status(404).json({ error: "not_found" });
        const subs = await pool.query("SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC", [req.params.id]);
        const devices = await pool.query("SELECT * FROM devices WHERE user_id=$1 ORDER BY last_seen DESC", [req.params.id]);
        const audit = await pool.query("SELECT * FROM license_audit WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [req.params.id]);

        let stripeInvoices = [];
        let stripeCustomer = null;
        if (u.rows[0].stripe_customer) {
            try {
                stripeCustomer = await stripe.customers.retrieve(u.rows[0].stripe_customer);
                const invoices = await stripe.invoices.list({ customer: u.rows[0].stripe_customer, limit: 20 });
                stripeInvoices = invoices.data.map(i => ({
                    id: i.id, number: i.number, amount_paid: i.amount_paid / 100,
                    currency: i.currency, status: i.status, created: i.created,
                    period_start: i.period_start, period_end: i.period_end,
                    hosted_invoice_url: i.hosted_invoice_url, invoice_pdf: i.invoice_pdf
                }));
            } catch (e) { console.error("stripe fetch fail", e.message); }
        }

        res.json({ user: u.rows[0], subscriptions: subs.rows, devices: devices.rows, audit: audit.rows, stripe_invoices: stripeInvoices, stripe_customer: stripeCustomer });
    } catch (e) { next(e); }
});

// === GRANT FREE ACCESS ===
router.post("/users/:id/grant", requireAdmin, async (req, res, next) => {
    try {
        const { plan = "lifetime", reason = "courtesy" } = req.body || {};
        if (!["yearly", "lifetime", "trial"].includes(plan)) return res.status(400).json({ error: "invalid_plan" });
        const expiresAt = plan === "lifetime" ? null
            : plan === "yearly" ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const r = await pool.query(
            `INSERT INTO subscriptions(user_id, plan, status, stripe_sub_id, current_period_end)
             VALUES($1, $2, 'active', $3, $4) RETURNING *`,
            [req.params.id, plan, "manual_" + reason + "_" + Date.now(), expiresAt]
        );
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_grant', $2)",
            [req.params.id, { plan, reason, by: req.user.email }]
        );
        res.json({ subscription: r.rows[0] });
    } catch (e) { next(e); }
});

// === REVOKE SUBSCRIPTION ===
router.post("/users/:id/revoke", requireAdmin, async (req, res, next) => {
    try {
        await pool.query("UPDATE subscriptions SET status='revoked', updated_at=now() WHERE user_id=$1 AND status IN ('active','trialing')", [req.params.id]);
        await pool.query("UPDATE devices SET revoked=true WHERE user_id=$1", [req.params.id]);
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_revoke', $2)",
            [req.params.id, { by: req.user.email, reason: req.body?.reason || "admin_action" }]
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
});

// === REVOKE A DEVICE ===
router.post("/devices/:id/revoke", requireAdmin, async (req, res, next) => {
    try {
        const r = await pool.query("UPDATE devices SET revoked=true WHERE id=$1 RETURNING user_id", [req.params.id]);
        if (!r.rowCount) return res.status(404).json({ error: "not_found" });
        await pool.query(
            "INSERT INTO license_audit(user_id, device_id, action, detail) VALUES($1, $2, 'admin_revoke_device', $3)",
            [r.rows[0].user_id, req.params.id, { by: req.user.email }]
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
});

// === PROMOTE TO ADMIN ===
router.post("/users/:id/promote", requireAdmin, async (req, res, next) => {
    try {
        await pool.query("UPDATE users SET is_admin=true WHERE id=$1", [req.params.id]);
        res.json({ ok: true });
    } catch (e) { next(e); }
});

// === CANCEL STRIPE SUBSCRIPTION ===
router.post("/subscriptions/:stripeSubId/cancel", requireAdmin, async (req, res, next) => {
    try {
        const immediate = req.body?.immediate === true;
        const sub = immediate
            ? await stripe.subscriptions.cancel(req.params.stripeSubId)
            : await stripe.subscriptions.update(req.params.stripeSubId, { cancel_at_period_end: true });
        res.json({ stripe_subscription: sub });
    } catch (e) { next(e); }
});

// === RECENT EVENTS / AUDIT FEED ===
router.get("/audit", requireAdmin, async (req, res, next) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const r = await pool.query(`
            SELECT a.*, u.email
              FROM license_audit a
              LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.created_at DESC
             LIMIT $1
        `, [limit]);
        res.json({ events: r.rows });
    } catch (e) { next(e); }
});

module.exports = { router };
