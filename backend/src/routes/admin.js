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

// === TIMELINE (signups + revenue por dia, últimos N dias) ===
router.get("/stats/timeline", requireAdmin, async (req, res, next) => {
    try {
        const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365);

        // Signups por dia
        const signups = await pool.query(`
            SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS count
              FROM users
             WHERE created_at > now() - ($1 || ' days')::interval
             GROUP BY day ORDER BY day
        `, [days]);

        // Subscriptions ativas por produto (cumulative)
        const subsActive = await pool.query(`
            SELECT product_id, plan, status, COUNT(*)::int AS count
              FROM subscriptions
             GROUP BY product_id, plan, status
        `);

        // Eventos de checkout (revenue) — derivado do license_audit
        const checkouts = await pool.query(`
            SELECT date_trunc('day', created_at)::date AS day,
                   (detail->>'product_id')::text AS product_id,
                   (detail->>'plan')::text AS plan,
                   SUM(((detail->>'amount')::int / 100.0))::float AS revenue,
                   COUNT(*)::int AS count
              FROM license_audit
             WHERE action = 'checkout_completed'
               AND created_at > now() - ($1 || ' days')::interval
             GROUP BY day, product_id, plan
             ORDER BY day
        `, [days]);

        // Conversão: trials que viraram paid
        const conversion = await pool.query(`
            WITH user_trials AS (
                SELECT user_id, product_id, MIN(created_at) AS trial_start
                  FROM subscriptions WHERE plan='trial' GROUP BY user_id, product_id
            ),
            user_paid AS (
                SELECT user_id, product_id, MIN(created_at) AS paid_start
                  FROM subscriptions WHERE plan IN ('yearly','lifetime') AND status='active'
                  GROUP BY user_id, product_id
            )
            SELECT t.product_id,
                   COUNT(t.user_id)::int AS trials,
                   COUNT(p.user_id)::int AS converted,
                   CASE WHEN COUNT(t.user_id) = 0 THEN 0
                        ELSE ROUND(100.0 * COUNT(p.user_id) / COUNT(t.user_id), 1)
                   END AS conversion_rate
              FROM user_trials t
              LEFT JOIN user_paid p ON p.user_id=t.user_id AND p.product_id=t.product_id
             GROUP BY t.product_id
        `);

        res.json({
            days,
            generated_at: new Date().toISOString(),
            signups: signups.rows,
            subs_active: subsActive.rows,
            checkouts: checkouts.rows,
            conversion: conversion.rows
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
                  'product_id', s.product_id,
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
        const sessions = await pool.query(
            "SELECT id, device_id, issued_at, expires_at, last_seen_at, last_ip, country, revoked FROM sessions WHERE user_id=$1 ORDER BY last_seen_at DESC LIMIT 30",
            [req.params.id]
        ).catch(() => ({ rows: [] }));
        const downloads = await pool.query(
            "SELECT created_at, ip FROM asset_download_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
            [req.params.id]
        ).catch(() => ({ rows: [] }));

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

        res.json({
            user: u.rows[0], subscriptions: subs.rows, devices: devices.rows,
            audit: audit.rows, stripe_invoices: stripeInvoices, stripe_customer: stripeCustomer,
            sessions: sessions.rows, downloads: downloads.rows,
        });
    } catch (e) { next(e); }
});

// === GRANT FREE ACCESS (product-aware) ===
router.post("/users/:id/grant", requireAdmin, async (req, res, next) => {
    try {
        const { plan = "lifetime", reason = "courtesy", product_id = "motionpro" } = req.body || {};
        if (!["yearly", "lifetime", "trial"].includes(plan)) return res.status(400).json({ error: "invalid_plan" });
        const p = await pool.query("SELECT 1 FROM products WHERE id=$1 AND is_active=true", [product_id]);
        if (!p.rowCount) return res.status(400).json({ error: "invalid_product" });
        const expiresAt = plan === "lifetime" ? null
            : plan === "yearly" ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const r = await pool.query(
            `INSERT INTO subscriptions(user_id, product_id, plan, status, stripe_sub_id, current_period_end)
             VALUES($1, $2, $3, 'active', $4, $5) RETURNING *`,
            [req.params.id, product_id, plan, "manual_" + reason + "_" + Date.now(), expiresAt]
        );
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_grant', $2)",
            [req.params.id, { plan, product_id, reason, by: req.user.email }]
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

// === RECENT EVENTS / AUDIT FEED (com search + filters) ===
router.get("/audit", requireAdmin, async (req, res, next) => {
    try {
        const limit  = Math.min(Number(req.query.limit) || 100, 500);
        const search = (req.query.search || "").trim();
        const action = (req.query.action || "").trim();
        const userId = (req.query.user_id || "").trim();
        const where  = [];
        const params = [];
        if (search) {
            params.push(`%${search}%`);
            where.push(`(u.email ILIKE $${params.length} OR a.action ILIKE $${params.length} OR a.detail::text ILIKE $${params.length})`);
        }
        if (action) { params.push(action); where.push(`a.action = $${params.length}`); }
        if (userId) { params.push(userId); where.push(`a.user_id = $${params.length}`); }
        params.push(limit);
        const sql = `
            SELECT a.*, u.email
              FROM license_audit a
              LEFT JOIN users u ON u.id = a.user_id
             ${where.length ? "WHERE " + where.join(" AND ") : ""}
             ORDER BY a.created_at DESC
             LIMIT $${params.length}
        `;
        const r = await pool.query(sql, params);
        res.json({ events: r.rows });
    } catch (e) { next(e); }
});

// === SESSIONS: list active per user ===
router.get("/users/:id/sessions", requireAdmin, async (req, res, next) => {
    try {
        const r = await pool.query(`
            SELECT s.id, s.device_id, s.issued_at, s.expires_at, s.last_seen_at,
                   s.last_ip, s.last_ua, s.country, s.revoked, s.revoked_at, s.revoke_reason,
                   d.label as device_label, d.os_name, d.hostname
              FROM sessions s
              LEFT JOIN devices d ON d.id = s.device_id
             WHERE s.user_id = $1
             ORDER BY s.last_seen_at DESC
             LIMIT 200
        `, [req.params.id]);
        res.json({ sessions: r.rows });
    } catch (e) { next(e); }
});

// === SESSIONS: revoke individual ===
router.post("/sessions/:id/revoke", requireAdmin, async (req, res, next) => {
    try {
        const reason = (req.body?.reason || "admin_action").slice(0, 200);
        await pool.query(`
            UPDATE sessions
               SET revoked=true, revoked_at=now(), revoked_by=$2, revoke_reason=$3
             WHERE id=$1 AND revoked=false
        `, [req.params.id, req.user.id, reason]);
        res.json({ ok: true });
    } catch (e) { next(e); }
});

// === SESSIONS: kill ALL of a user (logout em todos os devices) ===
router.post("/users/:id/sessions/revoke-all", requireAdmin, async (req, res, next) => {
    try {
        const reason = (req.body?.reason || "admin_killall").slice(0, 200);
        const r = await pool.query(`
            UPDATE sessions
               SET revoked=true, revoked_at=now(), revoked_by=$2, revoke_reason=$3
             WHERE user_id=$1 AND revoked=false
            RETURNING id
        `, [req.params.id, req.user.id, reason]);
        // Audit log
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'sessions_revoke_all', $2)",
            [req.params.id, JSON.stringify({ by: req.user.id, count: r.rowCount, reason })]
        ).catch(() => {});
        res.json({ ok: true, revoked: r.rowCount });
    } catch (e) { next(e); }
});

// === DEVICES: list per user com IP/geo ===
router.get("/users/:id/devices", requireAdmin, async (req, res, next) => {
    try {
        const r = await pool.query(`
            SELECT id, fingerprint, label, hostname, os_name,
                   first_seen, last_seen, first_ip, last_ip, country, region, city,
                   revoked, revoked_at, revoke_reason
              FROM devices
             WHERE user_id=$1
             ORDER BY last_seen DESC
             LIMIT 200
        `, [req.params.id]);
        res.json({ devices: r.rows });
    } catch (e) { next(e); }
});

// === DEVICES: lista global com filtro (pra dashboard view) ===
router.get("/devices", requireAdmin, async (req, res, next) => {
    try {
        const limit   = Math.min(Number(req.query.limit) || 100, 500);
        const search  = (req.query.search || "").trim();
        const country = (req.query.country || "").trim();
        const revoked = req.query.revoked;
        const params = [];
        const where  = [];
        if (search)  { params.push(`%${search}%`); where.push(`(u.email ILIKE $${params.length} OR d.last_ip ILIKE $${params.length} OR d.city ILIKE $${params.length})`); }
        if (country) { params.push(country); where.push(`d.country = $${params.length}`); }
        if (revoked === "true")  where.push("d.revoked = true");
        if (revoked === "false") where.push("d.revoked = false");
        params.push(limit);
        const r = await pool.query(`
            SELECT d.id, d.user_id, u.email,
                   d.label, d.os_name, d.hostname,
                   d.first_seen, d.last_seen, d.last_ip, d.country, d.region, d.city,
                   d.revoked, d.revoked_at
              FROM devices d
              JOIN users u ON u.id = d.user_id
             ${where.length ? "WHERE " + where.join(" AND ") : ""}
             ORDER BY d.last_seen DESC
             LIMIT $${params.length}
        `, params);
        res.json({ devices: r.rows });
    } catch (e) { next(e); }
});

// === METRICS: MRR + MAU + churn + device count ===
router.get("/metrics", requireAdmin, async (_req, res, next) => {
    try {
        // MRR (active + trialing, monthly equivalent)
        const mrr = await pool.query(`
            SELECT
              COALESCE(SUM(CASE WHEN plan='monthly'  THEN price_brl END), 0)        AS monthly_sum,
              COALESCE(SUM(CASE WHEN plan='yearly'   THEN price_brl END), 0) / 12.0 AS yearly_norm,
              COUNT(*) FILTER (WHERE plan='lifetime' AND status='active')           AS lifetime_count
              FROM subscriptions
             WHERE status IN ('active', 'trialing')
        `).catch(() => ({ rows: [{ monthly_sum: 0, yearly_norm: 0, lifetime_count: 0 }] }));

        const mau = await pool.query(`
            SELECT COUNT(DISTINCT user_id) AS mau
              FROM sessions
             WHERE last_seen_at > now() - interval '30 days'
               AND revoked=false
        `).catch(() => ({ rows: [{ mau: 0 }] }));

        const devices = await pool.query(`
            SELECT
              COUNT(*) FILTER (WHERE revoked=false AND last_seen > now() - interval '30 days') AS active_30d,
              COUNT(*) FILTER (WHERE revoked=false) AS total_active,
              COUNT(*) FILTER (WHERE revoked=true)  AS revoked
              FROM devices
        `).catch(() => ({ rows: [{ active_30d: 0, total_active: 0, revoked: 0 }] }));

        const churn = await pool.query(`
            SELECT
              COUNT(*) FILTER (WHERE canceled_at > now() - interval '30 days') AS canceled_30d,
              COUNT(*) FILTER (WHERE status='active' OR status='trialing')     AS still_active
              FROM subscriptions
        `).catch(() => ({ rows: [{ canceled_30d: 0, still_active: 1 }] }));

        const m = mrr.rows[0];
        const mrrTotal = Number(m.monthly_sum || 0) + Number(m.yearly_norm || 0);
        const c = churn.rows[0];
        const churnRate = c.still_active > 0 ? (Number(c.canceled_30d) / (Number(c.still_active) + Number(c.canceled_30d))) : 0;

        res.json({
            mrr_brl: Number(mrrTotal.toFixed(2)),
            lifetime_count: Number(m.lifetime_count || 0),
            mau: Number(mau.rows[0].mau || 0),
            devices_active_30d: Number(devices.rows[0].active_30d || 0),
            devices_active_total: Number(devices.rows[0].total_active || 0),
            devices_revoked: Number(devices.rows[0].revoked || 0),
            churn_30d: Number((churnRate * 100).toFixed(2)),
        });
    } catch (e) { next(e); }
});

// === EXTEND TRIAL / GRANT comp ===
router.post("/users/:id/extend-trial", requireAdmin, async (req, res, next) => {
    try {
        const days = Math.max(1, Math.min(365, Number(req.body?.days || 7)));
        await pool.query(`
            UPDATE subscriptions
               SET current_period_end = COALESCE(current_period_end, now()) + ($2 || ' days')::interval,
                   status = CASE WHEN status='canceled' THEN 'trialing' ELSE status END
             WHERE user_id=$1
        `, [req.params.id, String(days)]);
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'trial_extended', $2)",
            [req.params.id, JSON.stringify({ by: req.user.id, days })]
        ).catch(() => {});
        res.json({ ok: true, days });
    } catch (e) { next(e); }
});

// ═════════════════════════════════════════════════════════════════════
// NOVOS ENDPOINTS · 2026-05-19 — gestão completa de usuários
// ═════════════════════════════════════════════════════════════════════

// === BLOQUEAR usuário (cancel all subs + revoke devices + kill sessions) ===
// Cliente continua logando mas tudo bloqueado. Reversível via /unblock.
router.post("/users/:id/block", requireAdmin, async (req, res, next) => {
    try {
        const reason = (req.body?.reason || "admin_block").slice(0, 200);
        const r = await pool.query("BEGIN");
        await pool.query("UPDATE subscriptions SET status='revoked' WHERE user_id=$1 AND status IN ('active','trialing','past_due')", [req.params.id]);
        await pool.query("UPDATE devices SET revoked=true, revoked_at=now(), revoked_by=$2, revoke_reason=$3 WHERE user_id=$1 AND revoked=false",
            [req.params.id, req.user.id, reason]).catch(() => {});
        await pool.query("UPDATE sessions SET revoked=true, revoked_at=now(), revoked_by=$2, revoke_reason=$3 WHERE user_id=$1 AND revoked=false",
            [req.params.id, req.user.id, reason]).catch(() => {});
        await pool.query("COMMIT");
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'user_blocked', $2)",
            [req.params.id, JSON.stringify({ by: req.user.id, reason })]
        ).catch(() => {});
        res.json({ ok: true, blocked: true });
    } catch (e) {
        await pool.query("ROLLBACK").catch(() => {});
        next(e);
    }
});

// === DESBLOQUEAR usuário (volta subs revoked → active, libera devices) ===
router.post("/users/:id/unblock", requireAdmin, async (req, res, next) => {
    try {
        await pool.query("UPDATE subscriptions SET status='active' WHERE user_id=$1 AND status='revoked'", [req.params.id]);
        await pool.query("UPDATE devices SET revoked=false, revoked_at=NULL, revoked_by=NULL, revoke_reason=NULL WHERE user_id=$1 AND revoke_reason LIKE 'admin_%'",
            [req.params.id]).catch(() => {});
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'user_unblocked', $2)",
            [req.params.id, JSON.stringify({ by: req.user.id })]
        ).catch(() => {});
        res.json({ ok: true, unblocked: true });
    } catch (e) { next(e); }
});

// === DELETE usuário (GDPR-style hard delete) ===
router.delete("/users/:id", requireAdmin, async (req, res, next) => {
    try {
        const uid = req.params.id;
        if (uid === req.user.id) return res.status(400).json({ error: "cannot_delete_self" });
        // Captura email pra audit antes do CASCADE
        const u = await pool.query("SELECT email FROM users WHERE id=$1", [uid]);
        const email = u.rows[0]?.email || "(unknown)";
        // Cancela Stripe se tiver
        const sub = await pool.query("SELECT stripe_sub_id FROM subscriptions WHERE user_id=$1 AND stripe_sub_id IS NOT NULL LIMIT 1", [uid]);
        if (sub.rowCount > 0 && sub.rows[0].stripe_sub_id) {
            try { await stripe.subscriptions.cancel(sub.rows[0].stripe_sub_id); } catch (e) { /* ignora */ }
        }
        // Audit ANTES de deletar (FK CASCADE vai apagar a row do user_id no license_audit)
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES(NULL, 'user_deleted', $1)",
            [JSON.stringify({ deleted_email: email, deleted_id: uid, by: req.user.id })]
        ).catch(() => {});
        // CASCADE deleta devices, subscriptions, sessions, oauth_accounts, etc.
        await pool.query("DELETE FROM users WHERE id=$1", [uid]);
        res.json({ ok: true, deleted: email });
    } catch (e) { next(e); }
});

// === LISTA DE PAGAMENTOS de um user (do Stripe + cache local) ===
router.get("/users/:id/payments", requireAdmin, async (req, res, next) => {
    try {
        const u = await pool.query("SELECT stripe_customer FROM users WHERE id=$1", [req.params.id]);
        const cust = u.rows[0]?.stripe_customer;
        if (!cust) return res.json({ payments: [] });
        try {
            const invoices = await stripe.invoices.list({ customer: cust, limit: 20 });
            const list = invoices.data.map(inv => ({
                id: inv.id,
                amount: inv.amount_paid / 100,
                currency: inv.currency,
                status: inv.status,
                created: new Date(inv.created * 1000).toISOString(),
                invoice_pdf: inv.invoice_pdf,
                hosted_invoice_url: inv.hosted_invoice_url,
                description: inv.lines.data[0]?.description || "—",
            }));
            res.json({ payments: list });
        } catch (e) {
            res.json({ payments: [], stripe_error: e.message });
        }
    } catch (e) { next(e); }
});

// === LISTA DOWNLOADS do user (último N dias) ===
router.get("/users/:id/downloads", requireAdmin, async (req, res, next) => {
    try {
        const r = await pool.query(`
            SELECT l.created_at, l.ip, l.ua, a.kind, a.cdn_key, a.size_bytes
              FROM asset_download_log l
              LEFT JOIN assets a ON a.id = l.asset_id
             WHERE l.user_id = $1
             ORDER BY l.created_at DESC
             LIMIT 100
        `, [req.params.id]).catch(() => ({ rows: [] }));
        res.json({ downloads: r.rows });
    } catch (e) { next(e); }
});

// === ENVIAR EMAIL custom pro user (template livre) ===
router.post("/users/:id/send-email", requireAdmin, async (req, res, next) => {
    try {
        const { subject, html, text } = req.body || {};
        if (!subject || (!html && !text)) return res.status(400).json({ error: "subject_and_body_required" });
        const u = await pool.query("SELECT email, name FROM users WHERE id=$1", [req.params.id]);
        if (u.rowCount === 0) return res.status(404).json({ error: "user_not_found" });
        const { sendEmail } = require("../utils/email");
        await sendEmail({ to: u.rows[0].email, subject, html: html || `<p>${text}</p>`, text: text || subject });
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_email_sent', $2)",
            [req.params.id, JSON.stringify({ subject, by: req.user.id })]
        ).catch(() => {});
        res.json({ ok: true, sent_to: u.rows[0].email });
    } catch (e) { next(e); }
});

// === DASHBOARD SUMMARY — KPIs ricos pra overview ===
router.get("/dashboard-summary", requireAdmin, async (_req, res, next) => {
    try {
        const summary = await pool.query(`
            SELECT
              (SELECT COUNT(*) FROM users) AS total_users,
              (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '24 hours') AS new_users_24h,
              (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '7 days') AS new_users_7d,
              (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '30 days') AS new_users_30d,
              (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status='active') AS paying_users,
              (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status='trialing') AS trial_users,
              (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status='revoked') AS blocked_users,
              (SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status='canceled' AND canceled_at > now() - interval '30 days') AS churned_30d
        `).catch(() => ({ rows: [{}] }));

        // Receita estimada (last 30d via Stripe)
        let revenue30d = 0;
        try {
            const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
            const charges = await stripe.charges.list({ created: { gte: since }, limit: 100 });
            revenue30d = charges.data.filter(c => c.paid && !c.refunded).reduce((sum, c) => sum + c.amount / 100, 0);
        } catch (e) { /* ignora */ }

        // Activity recente
        const recent = await pool.query(`
            SELECT a.action, a.detail, a.created_at, u.email
              FROM license_audit a
              LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.created_at DESC
             LIMIT 15
        `).catch(() => ({ rows: [] }));

        res.json({
            ...summary.rows[0],
            revenue_30d_brl: Number(revenue30d.toFixed(2)),
            recent_activity: recent.rows,
        });
    } catch (e) { next(e); }
});

// === DETALHE COMPLETO DO USER (1 chamada pega tudo pro modal drill-down) ===
router.get("/users/:id/full", requireAdmin, async (req, res, next) => {
    try {
        const uid = req.params.id;
        const [user, subs, devs, sessions, audit, downloads] = await Promise.all([
            pool.query("SELECT id, email, name, phone, created_at, email_verified, is_admin, stripe_customer FROM users WHERE id=$1", [uid]),
            pool.query("SELECT id, product_id, plan, status, current_period_end, started_at, stripe_sub_id FROM subscriptions WHERE user_id=$1 ORDER BY started_at DESC", [uid]),
            pool.query("SELECT id, fingerprint, label, hostname, os_name, first_seen, last_seen, last_ip, country, region, city, revoked FROM devices WHERE user_id=$1 ORDER BY last_seen DESC", [uid]).catch(() => ({ rows: [] })),
            pool.query("SELECT id, device_id, issued_at, expires_at, last_seen_at, last_ip, country, revoked FROM sessions WHERE user_id=$1 ORDER BY last_seen_at DESC LIMIT 50", [uid]).catch(() => ({ rows: [] })),
            pool.query("SELECT action, detail, created_at FROM license_audit WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [uid]),
            pool.query("SELECT created_at, ip FROM asset_download_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [uid]).catch(() => ({ rows: [] })),
        ]);
        if (user.rowCount === 0) return res.status(404).json({ error: "user_not_found" });
        res.json({
            user:          user.rows[0],
            subscriptions: subs.rows,
            devices:       devs.rows,
            sessions:      sessions.rows,
            audit:         audit.rows,
            downloads:     downloads.rows,
        });
    } catch (e) { next(e); }
});

module.exports = { router };
