"use strict";
const router = require("express").Router();
const Stripe = require("stripe");
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAdmin } = require("../middleware/auth");

const stripe = Stripe(process.env.STRIPE_SECRET || "sk_test_xxx");

// === CDN SELF-TEST (PUBLIC TEMP) ===
// TEMPORARIO sem auth pra diagnosticar 401 invalid_signature em prod.
// REMOVER APOS DIAGNOSE. Nao expoe secret completo, so prefix mascarado.
router.get("/_diag/cdn", async (_req, res, next) => {
    try {
        const SECRET   = (process.env.CDN_SIGN_SECRET || "").trim();
        const CDN_BASE = (process.env.CDN_BASE || "").trim().replace(/\/$/, "");
        if (!SECRET)   return res.status(500).json({ error: "missing_CDN_SIGN_SECRET" });
        if (!CDN_BASE) return res.status(500).json({ error: "missing_CDN_BASE" });

        const a = await pool.query("SELECT cdn_key FROM assets WHERE published=true LIMIT 1");
        if (a.rowCount === 0) return res.status(404).json({ error: "no_published_asset" });
        const key = a.rows[0].cdn_key;

        const fp      = "cdn-self-test";
        const expires = Math.floor(Date.now() / 1000) + 300;
        const data    = `${key}\n${fp}\n${expires}`;
        const sig     = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
        const url     = `${CDN_BASE}/${key}?fp=${encodeURIComponent(fp)}&e=${expires}&s=${sig}`;

        let workerStatus = null, workerBody = null;
        try {
            const r = await fetch(url, { method: "GET" });
            workerStatus = r.status;
            if (r.status !== 200) workerBody = (await r.text()).slice(0, 200);
        } catch (e) {
            return res.status(500).json({ error: "fetch_failed", message: e.message });
        }

        return res.json({
            cdn_base:       CDN_BASE,
            asset_key:      key,
            secret_length:  SECRET.length,
            secret_prefix:  SECRET.slice(0, 4) + "***" + SECRET.slice(-2),
            worker_status:  workerStatus,
            worker_body:    workerBody,
            verdict: workerStatus === 200 ? "OK"
                : (workerBody && workerBody.includes("invalid_signature"))
                    ? "SECRET_DIVERGENT_ROTATE_BOTH"
                    : (workerBody && workerBody.includes("expired"))
                        ? "CLOCK_SKEW"
                        : "OTHER_SEE_BODY"
        });
    } catch (e) { next(e); }
});

router.get("/cdn-self-test", requireAdmin, async (_req, res, next) => {
    try {
        const SECRET   = (process.env.CDN_SIGN_SECRET || "").trim();
        const CDN_BASE = (process.env.CDN_BASE || "").trim().replace(/\/$/, "");
        if (!SECRET)   return res.status(500).json({ error: "missing_CDN_SIGN_SECRET" });
        if (!CDN_BASE) return res.status(500).json({ error: "missing_CDN_BASE" });

        // Pega 1 asset published qualquer
        const a = await pool.query("SELECT cdn_key FROM assets WHERE published=true LIMIT 1");
        if (a.rowCount === 0) return res.status(404).json({ error: "no_published_asset" });
        const key = a.rows[0].cdn_key;

        // Assina URL com secret do backend
        const fp      = "cdn-self-test";
        const expires = Math.floor(Date.now() / 1000) + 300;
        const data    = `${key}\n${fp}\n${expires}`;
        const sig     = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
        const url     = `${CDN_BASE}/${key}?fp=${encodeURIComponent(fp)}&e=${expires}&s=${sig}`;

        // Tenta HEAD via Worker
        let workerStatus = null, workerBody = null;
        try {
            const r = await fetch(url, { method: "GET" });
            workerStatus = r.status;
            if (r.status !== 200) {
                workerBody = (await r.text()).slice(0, 200);
            }
        } catch (e) {
            return res.status(500).json({ error: "fetch_failed", message: e.message });
        }

        return res.json({
            cdn_base:        CDN_BASE,
            asset_key:       key,
            url_short:       url.slice(0, 90) + "...",
            secret_present:  true,
            secret_length:   SECRET.length,
            secret_prefix:   SECRET.slice(0, 4) + "***" + SECRET.slice(-2),
            worker_status:   workerStatus,
            worker_body:     workerBody,
            verdict: workerStatus === 200
                ? "OK · backend e worker compartilham o mesmo CDN_SIGN_SECRET"
                : (workerBody && workerBody.includes("invalid_signature"))
                    ? "FAIL · secret divergente entre Vercel e Cloudflare Worker · rotacionar"
                    : (workerBody && workerBody.includes("expired"))
                        ? "FAIL · clock skew · sincronizar relogio do backend"
                        : "FAIL · ver worker_status + worker_body acima"
        });
    } catch (e) { next(e); }
});

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
              u.blocked_at,
              u.blocked_reason,
              u.lifetime_until,
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
              (SELECT COUNT(*) FROM devices d WHERE d.user_id=u.id) AS total_devices,
              (SELECT MAX(d.last_seen) FROM devices d WHERE d.user_id=u.id) AS last_seen,
              (SELECT json_build_object('ip', d.last_ip, 'country', d.country, 'city', d.city, 'os', d.os_name, 'last_seen', d.last_seen)
                 FROM devices d WHERE d.user_id=u.id ORDER BY d.last_seen DESC NULLS LAST LIMIT 1) AS last_device,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND NOT s.revoked AND s.expires_at > now()) AS active_sessions
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
        await pool.query("BEGIN");
        await pool.query("UPDATE users SET blocked_at=now(), blocked_reason=$2 WHERE id=$1",
            [req.params.id, reason]).catch(() => {});
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
        await pool.query("UPDATE users SET blocked_at=NULL, blocked_reason=NULL WHERE id=$1", [req.params.id]).catch(() => {});
        // Restaura status real: plan=trial → trialing, demais → active
        await pool.query(`
            UPDATE subscriptions
               SET status = CASE WHEN plan='trial' THEN 'trialing' ELSE 'active' END
             WHERE user_id=$1 AND status='revoked'
        `, [req.params.id]);
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
        // Executa cada KPI em query separada — se uma falhar, retorna 0 e continua
        const oneNum = (sql, params) => pool.query(sql, params || []).then(r => Number(r.rows[0]?.n || 0)).catch(() => 0);
        const [
            total_users, new_users_24h, new_users_7d, new_users_30d, blocked_users,
            paying_users, trial_users, churned_30d,
            online_now, active_24h, total_devices, active_sessions
        ] = await Promise.all([
            oneNum("SELECT COUNT(*)::int AS n FROM users"),
            oneNum("SELECT COUNT(*)::int AS n FROM users WHERE created_at > now() - interval '24 hours'"),
            oneNum("SELECT COUNT(*)::int AS n FROM users WHERE created_at > now() - interval '7 days'"),
            oneNum("SELECT COUNT(*)::int AS n FROM users WHERE created_at > now() - interval '30 days'"),
            oneNum("SELECT COUNT(*)::int AS n FROM users WHERE blocked_at IS NOT NULL"),
            oneNum("SELECT COUNT(DISTINCT user_id)::int AS n FROM subscriptions WHERE status='active'"),
            oneNum("SELECT COUNT(DISTINCT user_id)::int AS n FROM subscriptions WHERE status='trialing'"),
            oneNum("SELECT COUNT(DISTINCT user_id)::int AS n FROM subscriptions WHERE status='canceled' AND canceled_at > now() - interval '30 days'"),
            oneNum("SELECT COUNT(*)::int AS n FROM devices WHERE last_seen > now() - interval '10 minutes' AND NOT revoked"),
            oneNum("SELECT COUNT(*)::int AS n FROM devices WHERE last_seen > now() - interval '24 hours' AND NOT revoked"),
            oneNum("SELECT COUNT(*)::int AS n FROM devices WHERE NOT revoked"),
            oneNum("SELECT COUNT(*)::int AS n FROM sessions WHERE NOT revoked AND expires_at > now()"),
        ]);
        const summary = { rows: [{ total_users, new_users_24h, new_users_7d, new_users_30d, blocked_users, paying_users, trial_users, churned_30d, online_now, active_24h, total_devices, active_sessions }] };

        // Breakdown por produto
        const byProduct = await pool.query(`
            SELECT product_id, status, COUNT(*)::int AS n
              FROM subscriptions
             WHERE product_id IS NOT NULL
             GROUP BY product_id, status
             ORDER BY product_id, status
        `).catch(() => ({ rows: [] }));

        // Top 5 países (devices)
        const topCountries = await pool.query(`
            SELECT country, COUNT(*)::int AS n
              FROM devices
             WHERE country IS NOT NULL AND country <> 'LOCAL' AND NOT revoked
             GROUP BY country ORDER BY n DESC LIMIT 5
        `).catch(() => ({ rows: [] }));

        // Receita estimada (last 30d via Stripe)
        let revenue30d = 0;
        let revenueAllTime = 0;
        try {
            const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
            const charges = await stripe.charges.list({ created: { gte: since }, limit: 100 });
            revenue30d = charges.data.filter(c => c.paid && !c.refunded).reduce((sum, c) => sum + c.amount / 100, 0);
            const allCharges = await stripe.charges.list({ limit: 100 });
            revenueAllTime = allCharges.data.filter(c => c.paid && !c.refunded).reduce((sum, c) => sum + c.amount / 100, 0);
        } catch (e) { /* ignora */ }

        // MRR estimado de subs ativas
        const mrr = await pool.query(`
            SELECT
              (SELECT COUNT(*) FROM subscriptions WHERE status='active' AND plan='yearly') AS yearly,
              (SELECT COUNT(*) FROM subscriptions WHERE status='active' AND plan='lifetime') AS lifetime
        `).catch(() => ({ rows: [{ yearly: 0, lifetime: 0 }] }));
        const mrrBrl = Number(mrr.rows[0].yearly) * (199 / 12);

        // Activity recente
        const recent = await pool.query(`
            SELECT a.action, a.detail, a.created_at, u.email
              FROM license_audit a
              LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.created_at DESC
             LIMIT 20
        `).catch(() => ({ rows: [] }));

        res.json({
            ...summary.rows[0],
            mrr_brl: Math.round(mrrBrl * 100) / 100,
            revenue_30d_brl: Number(revenue30d.toFixed(2)),
            revenue_all_time_brl: Number(revenueAllTime.toFixed(2)),
            by_product: byProduct.rows,
            top_countries: topCountries.rows,
            recent_activity: recent.rows,
            generated_at: new Date().toISOString(),
        });
    } catch (e) { next(e); }
});

// === DETALHE COMPLETO DO USER (1 chamada pega tudo pro modal drill-down) ===
router.get("/users/:id/full", requireAdmin, async (req, res, next) => {
    try {
        const uid = req.params.id;
        const [user, subs, devs, sessions, audit, downloads, payments] = await Promise.all([
            pool.query(`SELECT id, email, name, phone, created_at, email_verified, email_verified_at,
                               phone_verified, marketing_optin, is_admin, stripe_customer,
                               blocked_at, blocked_reason, lifetime_until
                          FROM users WHERE id=$1`, [uid]),
            pool.query(`SELECT id, product_id, plan, status, current_period_end, started_at, stripe_sub_id, cancel_at, NULL::timestamptz AS canceled_at
                          FROM subscriptions WHERE user_id=$1 ORDER BY started_at DESC`, [uid]),
            pool.query(`SELECT id, fingerprint, label, hostname, os_name, first_seen, last_seen,
                               last_ip, first_ip, last_ua, country, region, city, revoked, revoked_at, revoke_reason
                          FROM devices WHERE user_id=$1 ORDER BY last_seen DESC NULLS LAST`, [uid]).catch(() => ({ rows: [] })),
            pool.query(`SELECT s.id, s.device_id, s.issued_at, s.expires_at, s.last_seen_at,
                               s.last_ip, s.last_ua, s.country, s.revoked, s.revoked_at,
                               d.fingerprint AS device_fingerprint, d.os_name AS device_os
                          FROM sessions s
                          LEFT JOIN devices d ON d.id = s.device_id
                         WHERE s.user_id=$1 ORDER BY s.last_seen_at DESC LIMIT 100`, [uid]).catch(() => ({ rows: [] })),
            pool.query(`SELECT a.action, a.detail, a.created_at, a.device_id
                          FROM license_audit a WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 100`, [uid]),
            pool.query(`SELECT created_at, ip FROM asset_download_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [uid]).catch(() => ({ rows: [] })),
            // Pagamentos vêm de license_audit action='checkout_completed' (criados pelo webhook Stripe)
            pool.query(`SELECT detail, created_at FROM license_audit
                         WHERE user_id=$1 AND action IN ('checkout_completed','invoice_paid','invoice_payment_failed','refund')
                         ORDER BY created_at DESC LIMIT 50`, [uid]).catch(() => ({ rows: [] })),
        ]);
        if (user.rowCount === 0) return res.status(404).json({ error: "user_not_found" });

        // Total gasto = soma de payments
        const totalSpent = payments.rows.reduce((s, p) => {
            const amt = Number(p.detail?.amount) || 0;
            return s + (amt / 100); // Stripe envia em centavos
        }, 0);

        res.json({
            user:          user.rows[0],
            subscriptions: subs.rows,
            devices:       devs.rows,
            sessions:      sessions.rows,
            audit:         audit.rows,
            downloads:     downloads.rows,
            payments:      payments.rows,
            stats: {
                total_spent_brl: Number(totalSpent.toFixed(2)),
                active_devices:  devs.rows.filter(d => !d.revoked).length,
                online_now:      devs.rows.filter(d => !d.revoked && d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) < 600000).length,
                active_sessions: sessions.rows.filter(s => !s.revoked && new Date(s.expires_at) > new Date()).length,
                countries_seen:  [...new Set(devs.rows.map(d => d.country).filter(c => c && c !== 'LOCAL'))],
            }
        });
    } catch (e) { next(e); }
});

// ============================================================
// MAINTENANCE — rodar migration 006 (idempotente) via dashboard
// ============================================================
router.post("/maintenance/run-migration-006", requireAdmin, async (_req, res, next) => {
    try {
        const fs = require("fs");
        const path = require("path");
        const sqlPath = path.join(__dirname, "..", "..", "migrations", "006_sessions_devices_v2.sql");
        const sql = fs.readFileSync(sqlPath, "utf8");
        await pool.query(sql);
        res.json({ ok: true, migration: "006_sessions_devices_v2", executed_at: new Date().toISOString() });
    } catch (e) {
        console.error("[migration-006]", e.message);
        res.status(500).json({ error: "migration_failed", message: e.message });
    }
});

router.post("/maintenance/run-migration-008", requireAdmin, async (_req, res, next) => {
    try {
        const fs = require("fs"); const path = require("path");
        const sqlPath = path.join(__dirname, "..", "..", "migrations", "008_user_ai_settings.sql");
        await pool.query(fs.readFileSync(sqlPath, "utf8"));
        res.json({ ok: true, migration: "008_user_ai_settings", executed_at: new Date().toISOString() });
    } catch (e) {
        console.error("[migration-008]", e.message);
        res.status(500).json({ error: "migration_failed", message: e.message });
    }
});

router.post("/maintenance/run-migration-007", requireAdmin, async (_req, res, next) => {
    try {
        const fs = require("fs");
        const path = require("path");
        const sqlPath = path.join(__dirname, "..", "..", "migrations", "007_user_blocking_lifetime.sql");
        const sql = fs.readFileSync(sqlPath, "utf8");
        await pool.query(sql);
        res.json({ ok: true, migration: "007_user_blocking_lifetime", executed_at: new Date().toISOString() });
    } catch (e) {
        console.error("[migration-007]", e.message);
        res.status(500).json({ error: "migration_failed", message: e.message });
    }
});

// Bootstrap master account: garante gabriel.kend@gmail.com é admin + lifetime tudo
router.post("/maintenance/ensure-master", requireAdmin, async (_req, res, next) => {
    try {
        const email = "gabriel.kend@gmail.com";
        const u = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
        if (u.rowCount === 0) return res.status(404).json({ error: "master_not_found" });
        const uid = u.rows[0].id;
        const farFuture = new Date(Date.now() + 100 * 365 * 86400000); // +100 anos
        await pool.query(
            "UPDATE users SET is_admin=true, lifetime_until=$1 WHERE id=$2",
            [farFuture, uid]
        );
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_master_bootstrap', $2)",
            [uid, { by: _req.user.id }]
        );
        res.json({ ok: true, user_id: uid, is_admin: true, lifetime_until: farFuture });
    } catch (e) {
        console.error("[ensure-master]", e.message);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// GRANT TRIAL — cria sub trial pra um produto específico
// Body: { product: "legendas" | "ia" | "motionpro" | "bundle_all", days?: 7 }
// ============================================================
router.post("/users/:id/grant-trial", requireAdmin, async (req, res, next) => {
    try {
        const uid = req.params.id;
        const product = (req.body?.product || "motionpro").toLowerCase();
        const days = Number(req.body?.days || 7);
        if (!["motionpro", "legendas", "ia", "bundle_all"].includes(product)) {
            return res.status(400).json({ error: "invalid_product" });
        }
        const expiresAt = new Date(Date.now() + days * 86400000);
        const ins = await pool.query(
            `INSERT INTO subscriptions(user_id, product_id, plan, status, current_period_end)
             VALUES($1, $2, 'trial', 'trialing', $3)
             ON CONFLICT DO NOTHING
             RETURNING id, product_id, current_period_end`,
            [uid, product, expiresAt]
        );
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_grant_trial', $2)",
            [uid, { product, days, by: req.user.id }]
        );
        res.json({ ok: true, granted: ins.rows[0] || null, expires_at: expiresAt });
    } catch (e) { next(e); }
});

// ============================================================
// MERGE USERS — move tudo do source pro target, deleta source
// Body: { source_id: "uuid" } — keeps :id como master
// ============================================================
router.post("/users/:id/merge", requireAdmin, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const target = req.params.id;
        const source = req.body?.source_id;
        if (!source || source === target) return res.status(400).json({ error: "invalid_source" });

        await client.query("BEGIN");
        const moved = {};
        for (const table of ["subscriptions", "devices", "license_audit", "asset_download_log"]) {
            const r = await client.query(
                `UPDATE ${table} SET user_id=$1 WHERE user_id=$2`,
                [target, source]
            ).catch(() => ({ rowCount: 0 }));
            moved[table] = r.rowCount;
        }
        // Sessions/oauth/magic_links se existirem
        for (const table of ["sessions", "oauth_accounts"]) {
            await client.query(
                `UPDATE ${table} SET user_id=$1 WHERE user_id=$2`,
                [target, source]
            ).catch(() => {});
        }
        await client.query("DELETE FROM users WHERE id=$1", [source]);
        await client.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_user_merged', $2)",
            [target, { merged_from: source, moved, by: req.user.id }]
        );
        await client.query("COMMIT");
        res.json({ ok: true, merged_from: source, moved });
    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        next(e);
    } finally {
        client.release();
    }
});

// ════════════════════════════════════════════════════════════════════
// LICENSE KEYS (MIA-/MTI-/MTL-/MTS-) — por user + ações
// Adicionado 2026-05-21 · AGENTE η · Dashboard SaaS Pro
// ════════════════════════════════════════════════════════════════════

// Helper: gera key plaintext no formato MIA-{TIER}-XXXX-XXXX-XXXX-XXXX
function _genKey(tier) {
    const crypto = require("crypto");
    const t = (tier || "PRO").toUpperCase().slice(0, 4);
    const rand = () => crypto.randomBytes(2).toString("hex").toUpperCase();
    return `MIA-${t}-${rand()}-${rand()}-${rand()}-${rand()}`;
}

// === LISTA license_keys do user (via customer_email match) ===
router.get("/users/:id/licenses", requireAdmin, async (req, res, next) => {
    try {
        const u = await pool.query("SELECT email FROM users WHERE id=$1", [req.params.id]);
        if (!u.rowCount) return res.status(404).json({ error: "user_not_found" });
        const email = u.rows[0].email;
        const r = await pool.query(
            `SELECT id, key_prefix, tier, products, max_devices,
                    expires_at, revoked_at, revoke_reason, notes,
                    customer_email, issued_by, created_at,
                    active_devices, total_activations
               FROM license_keys_with_usage
              WHERE LOWER(customer_email) = LOWER($1)
              ORDER BY created_at DESC`,
            [email]
        ).catch(() => ({ rows: [] }));
        // Junta activations por key (devices ativos)
        const keyIds = r.rows.map(k => k.id);
        let activations = [];
        if (keyIds.length > 0) {
            const a = await pool.query(
                `SELECT id, license_key_id, device_fingerprint, device_name, device_os,
                        ip_address, activated_at, deactivated_at, last_validation_at
                   FROM license_key_activations
                  WHERE license_key_id = ANY($1::uuid[])
                  ORDER BY activated_at DESC`,
                [keyIds]
            ).catch(() => ({ rows: [] }));
            activations = a.rows;
        }
        const byKey = {};
        activations.forEach(act => {
            (byKey[act.license_key_id] = byKey[act.license_key_id] || []).push(act);
        });
        res.json({
            user_email: email,
            licenses: r.rows.map(k => ({ ...k, activations: byKey[k.id] || [] })),
            count: r.rowCount || 0,
        });
    } catch (e) { next(e); }
});

// === REVOGAR TODAS as license_keys do user (botão "kill switch") ===
// Review fix #2: usa client dedicado pra garantir transação atômica
router.post("/users/:id/licenses/revoke-all", requireAdmin, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const reason = (req.body?.reason || "admin_revoke_all").slice(0, 200);
        const u = await client.query("SELECT email FROM users WHERE id=$1", [req.params.id]);
        if (!u.rowCount) {
            client.release();
            return res.status(404).json({ error: "user_not_found" });
        }
        const email = u.rows[0].email;

        await client.query("BEGIN");
        const keys = await client.query(
            `SELECT id, key_prefix FROM license_keys
              WHERE LOWER(customer_email)=LOWER($1) AND revoked_at IS NULL`,
            [email]
        );
        await client.query(
            `UPDATE license_keys SET revoked_at=now(), revoke_reason=$2
              WHERE LOWER(customer_email)=LOWER($1) AND revoked_at IS NULL`,
            [email, reason]
        );
        if (keys.rowCount > 0) {
            const ids = keys.rows.map(k => k.id);
            await client.query(
                `UPDATE license_key_activations SET deactivated_at=now()
                  WHERE license_key_id = ANY($1::uuid[]) AND deactivated_at IS NULL`,
                [ids]
            );
        }
        // Audit dentro da mesma transação
        await client.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_license_keys_revoke_all', $2)",
            [req.params.id, JSON.stringify({ by: req.user.id, count: keys.rowCount, reason, prefixes: keys.rows.map(k => k.key_prefix) })]
        );
        await client.query("COMMIT");

        res.json({ ok: true, revoked: keys.rowCount, email });
    } catch (e) {
        await client.query("ROLLBACK").catch(err => console.error("[revoke-all rollback]", err.message));
        next(e);
    } finally {
        client.release();
    }
});

// === REISSUE license_key (revoga antiga + gera nova) ===
// Review fix #1: path corrigido (era /admin/license-keys → ficava /v1/admin/admin/...)
// Review fix #2: client dedicado pra transação real
router.post("/license-keys/:id/reissue", requireAdmin, async (req, res, next) => {
    const bcrypt = require("bcrypt");
    const client = await pool.connect();
    try {
        const old = await client.query("SELECT * FROM license_keys WHERE id=$1", [req.params.id]);
        if (!old.rowCount) {
            client.release();
            return res.status(404).json({ error: "key_not_found" });
        }
        const o = old.rows[0];
        const reason = (req.body?.reason || "admin_reissue").slice(0, 200);

        // Resolve uid antes da transação (read-only)
        let uid = null;
        if (o.customer_email) {
            const u = await client.query("SELECT id FROM users WHERE LOWER(email)=LOWER($1)", [o.customer_email]);
            if (u.rowCount) uid = u.rows[0].id;
        }

        await client.query("BEGIN");
        await client.query(
            "UPDATE license_keys SET revoked_at=now(), revoke_reason=$2 WHERE id=$1 AND revoked_at IS NULL",
            [o.id, reason]
        );
        await client.query(
            "UPDATE license_key_activations SET deactivated_at=now() WHERE license_key_id=$1 AND deactivated_at IS NULL",
            [o.id]
        );

        const plaintext = _genKey(o.tier);
        const hash = await bcrypt.hash(plaintext, 10);
        const prefix = plaintext.slice(0, 14);
        const ins = await client.query(
            `INSERT INTO license_keys
             (key_hash, key_prefix, tier, products, max_devices, expires_at,
              notes, customer_email, issued_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING id, key_prefix, tier, products, max_devices, expires_at, created_at`,
            [hash, prefix, o.tier, o.products, o.max_devices, o.expires_at,
             `Reissue de ${o.key_prefix} · motivo: ${reason}`, o.customer_email, req.user.id]
        );
        await client.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_license_key_reissue', $2)",
            [uid, JSON.stringify({ old_prefix: o.key_prefix, new_prefix: prefix, by: req.user.id, reason })]
        );
        await client.query("COMMIT");

        res.json({
            ok: true,
            new_key: plaintext,
            details: ins.rows[0],
            old_key_prefix: o.key_prefix,
            warning: "Esta é a ÚNICA vez que a key aparece em plaintext."
        });
    } catch (e) {
        await client.query("ROLLBACK").catch(err => console.error("[reissue rollback]", err.message));
        next(e);
    } finally {
        client.release();
    }
});

// === TRANSFER device de uma license_key (deactivate from + activate to) ===
// Review fix #1: path corrigido
// Review fix #2: client dedicado pra transação real
router.post("/license-keys/:id/transfer-device", requireAdmin, async (req, res, next) => {
    const { from_fingerprint, to_fingerprint, to_name, to_os } = req.body || {};
    if (!from_fingerprint || !to_fingerprint) {
        return res.status(400).json({ error: "from_and_to_fingerprint_required" });
    }
    if (from_fingerprint === to_fingerprint) {
        return res.status(400).json({ error: "same_fingerprint" });
    }
    const client = await pool.connect();
    try {
        const k = await client.query(
            "SELECT id, customer_email FROM license_keys WHERE id=$1 AND revoked_at IS NULL",
            [req.params.id]
        );
        if (!k.rowCount) {
            client.release();
            return res.status(404).json({ error: "key_not_found_or_revoked" });
        }

        // Resolve uid antes da transação
        let uid = null;
        if (k.rows[0].customer_email) {
            const u = await client.query("SELECT id FROM users WHERE LOWER(email)=LOWER($1)", [k.rows[0].customer_email]);
            if (u.rowCount) uid = u.rows[0].id;
        }

        await client.query("BEGIN");
        const deact = await client.query(
            `UPDATE license_key_activations
                SET deactivated_at=now()
              WHERE license_key_id=$1 AND device_fingerprint=$2 AND deactivated_at IS NULL
             RETURNING id`,
            [req.params.id, from_fingerprint]
        );
        const exists = await client.query(
            "SELECT id FROM license_key_activations WHERE license_key_id=$1 AND device_fingerprint=$2",
            [req.params.id, to_fingerprint]
        );
        let toId;
        if (exists.rowCount > 0) {
            toId = exists.rows[0].id;
            await client.query(
                "UPDATE license_key_activations SET deactivated_at=NULL, last_validation_at=now(), device_name=COALESCE($2, device_name), device_os=COALESCE($3, device_os) WHERE id=$1",
                [toId, to_name || null, to_os || null]
            );
        } else {
            const ins = await client.query(
                `INSERT INTO license_key_activations(license_key_id, device_fingerprint, device_name, device_os)
                 VALUES($1,$2,$3,$4) RETURNING id`,
                [req.params.id, to_fingerprint, to_name || null, to_os || null]
            );
            toId = ins.rows[0].id;
        }
        await client.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_license_key_transfer', $2)",
            [uid, JSON.stringify({ license_key_id: req.params.id, from: from_fingerprint, to: to_fingerprint, by: req.user.id })]
        );
        await client.query("COMMIT");

        res.json({ ok: true, deactivated_id: deact.rows[0]?.id || null, activated_id: toId });
    } catch (e) {
        await client.query("ROLLBACK").catch(err => console.error("[transfer-device rollback]", err.message));
        next(e);
    } finally {
        client.release();
    }
});

// ════════════════════════════════════════════════════════════════════
// STRIPE TRANSACTIONS (globais) + REFUND
// ════════════════════════════════════════════════════════════════════

// === GET /v1/admin/transactions — lista charges com filtro ===
// Review fix #4: paginação completa via starting_after até has_more=false.
// KPIs (gross/refunded/net) refletem TODA a janela, não só 100 charges.
// Hard cap em 1000 charges pra evitar travada se houver volume absurdo.
router.get("/transactions", requireAdmin, async (req, res, next) => {
    try {
        const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 365);
        const statusFilter = (req.query.status || "").trim();
        const since = Math.floor((Date.now() - days * 86400000) / 1000);
        const HARD_CAP = 1000;
        const PAGE_SIZE = 100;

        const all = [];
        let startingAfter = null;
        let truncated = false;
        try {
            for (let i = 0; i < Math.ceil(HARD_CAP / PAGE_SIZE); i++) {
                const params = { created: { gte: since }, limit: PAGE_SIZE };
                if (startingAfter) params.starting_after = startingAfter;
                const page = await stripe.charges.list(params);
                all.push(...page.data);
                if (!page.has_more || page.data.length === 0) { startingAfter = null; break; }
                startingAfter = page.data[page.data.length - 1].id;
                if (all.length >= HARD_CAP) { truncated = true; break; }
            }
        } catch (e) {
            return res.status(503).json({ error: "stripe_unavailable", message: e.message });
        }

        // Lookup batch de user_id por stripe_customer
        const customerIds = [...new Set(all.map(c => c.customer).filter(Boolean))];
        let usersByCustomer = {};
        if (customerIds.length > 0) {
            const r = await pool.query(
                "SELECT id, email, stripe_customer FROM users WHERE stripe_customer = ANY($1::text[])",
                [customerIds]
            ).catch(e => { console.error("[transactions user lookup]", e.message); return { rows: [] }; });
            r.rows.forEach(u => { usersByCustomer[u.stripe_customer] = u; });
        }

        let list = all.map(c => {
            const u = usersByCustomer[c.customer] || null;
            return {
                id: c.id,
                amount: c.amount / 100,
                amount_refunded: c.amount_refunded / 100,
                currency: c.currency,
                status: c.status,
                paid: c.paid,
                refunded: c.refunded,
                disputed: c.disputed,
                created: new Date(c.created * 1000).toISOString(),
                description: c.description || c.metadata?.description || null,
                receipt_url: c.receipt_url,
                customer_id: c.customer,
                user_id: u?.id || null,
                user_email: u?.email || c.billing_details?.email || c.receipt_email || null,
                metadata: c.metadata,
            };
        });

        if (statusFilter === "refunded") list = list.filter(c => c.refunded || c.amount_refunded > 0);
        else if (statusFilter === "failed") list = list.filter(c => !c.paid && c.status !== "succeeded");
        else if (statusFilter === "succeeded") list = list.filter(c => c.paid && !c.refunded);
        else if (statusFilter === "disputed") list = list.filter(c => c.disputed);

        const totals = {
            count: list.length,
            gross_brl: list.reduce((s, c) => s + (c.paid && !c.refunded ? c.amount : 0), 0),
            refunded_brl: list.reduce((s, c) => s + c.amount_refunded, 0),
            net_brl: list.reduce((s, c) => s + (c.paid ? c.amount - c.amount_refunded : 0), 0),
        };

        res.json({
            transactions: list,
            totals: {
                count: totals.count,
                gross_brl: Number(totals.gross_brl.toFixed(2)),
                refunded_brl: Number(totals.refunded_brl.toFixed(2)),
                net_brl: Number(totals.net_brl.toFixed(2)),
            },
            filter: { days, status: statusFilter || "all", scanned: all.length, truncated },
            generated_at: new Date().toISOString(),
        });
    } catch (e) { next(e); }
});

// === POST /v1/admin/transactions/:charge_id/refund — refund parcial ou total ===
// Review fix #3: idempotencyKey previne double-refund em duplo-clique/retry.
// Key inclui amount pra permitir refund parcial seguido de outro parcial (chaves diferentes).
router.post("/transactions/:charge_id/refund", requireAdmin, async (req, res, next) => {
    try {
        const { amount_brl, reason } = req.body || {};
        const params = { charge: req.params.charge_id };
        if (amount_brl && Number(amount_brl) > 0) {
            params.amount = Math.round(Number(amount_brl) * 100);
        }
        if (reason && ["duplicate", "fraudulent", "requested_by_customer"].includes(reason)) {
            params.reason = reason;
        }
        params.metadata = { admin_refund_by: req.user.email || req.user.id };

        // Idempotency: mesmo charge+reason+amount → mesma key → Stripe retorna o mesmo refund.
        const idempotencyKey = `refund:${req.params.charge_id}:${reason || "req"}:${params.amount || "full"}`;

        let refund;
        try {
            refund = await stripe.refunds.create(params, { idempotencyKey });
        } catch (e) {
            return res.status(400).json({ error: "stripe_refund_failed", message: e.message });
        }

        // Audit (tenta achar user via charge.customer)
        let uid = null;
        try {
            const ch = await stripe.charges.retrieve(req.params.charge_id);
            if (ch.customer) {
                const u = await pool.query("SELECT id FROM users WHERE stripe_customer=$1", [ch.customer]);
                if (u.rowCount) uid = u.rows[0].id;
            }
        } catch (e) {
            console.error("[refund audit lookup]", e.message);
        }
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'admin_refund', $2)",
            [uid, JSON.stringify({
                charge_id: req.params.charge_id,
                refund_id: refund.id,
                amount: refund.amount / 100,
                reason: reason || null,
                idempotency_key: idempotencyKey,
                by: req.user.id,
            })]
        ).catch(e => console.error("[refund audit insert]", e.message));

        res.json({
            ok: true,
            refund: {
                id: refund.id,
                amount: refund.amount / 100,
                currency: refund.currency,
                status: refund.status,
                reason: refund.reason,
                created: new Date(refund.created * 1000).toISOString(),
            }
        });
    } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════════════
// CUSTOMERS — EXPORT CSV
// ════════════════════════════════════════════════════════════════════
router.get("/users.csv", requireAdmin, async (req, res, next) => {
    try {
        const search = (req.query.q || "").trim().toLowerCase();
        const status = (req.query.status || "").trim();
        const params = [];
        const where = [];
        if (search) { params.push("%" + search + "%"); where.push(`LOWER(u.email) LIKE $${params.length}`); }
        if (status && status !== "all") {
            params.push(status);
            where.push(`EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.user_id=u.id AND s2.status=$${params.length})`);
        }
        const sql = `
            SELECT u.id, u.email, u.name, u.phone, u.created_at, u.is_admin,
                   u.email_verified, u.marketing_optin, u.blocked_at, u.lifetime_until,
                   u.stripe_customer,
                   (SELECT COUNT(*) FROM devices d WHERE d.user_id=u.id AND NOT d.revoked) AS active_devices,
                   (SELECT MAX(d.last_seen) FROM devices d WHERE d.user_id=u.id) AS last_seen,
                   (SELECT string_agg(DISTINCT s.product_id || ':' || s.status, '; ')
                      FROM subscriptions s WHERE s.user_id=u.id) AS subscriptions
              FROM users u
             ${where.length ? "WHERE " + where.join(" AND ") : ""}
             ORDER BY u.created_at DESC
             LIMIT 5000
        `;
        const r = await pool.query(sql, params);
        const cols = [
            "id", "email", "name", "phone", "created_at", "is_admin",
            "email_verified", "marketing_optin", "blocked_at", "lifetime_until",
            "stripe_customer", "active_devices", "last_seen", "subscriptions"
        ];
        // Review bônus: CSV injection — prefixa apóstrofo se o campo começa
        // com =/+/-/@/tab (senão o Excel/Sheets executa como fórmula).
        const escape = (v) => {
            if (v === null || v === undefined) return "";
            let s = String(v);
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            s = s.replace(/"/g, '""');
            return /[",\n\r;]/.test(s) ? `"${s}"` : s;
        };
        const lines = [cols.join(",")];
        for (const row of r.rows) lines.push(cols.map(c => escape(row[c])).join(","));
        const csv = "﻿" + lines.join("\r\n"); // BOM pra Excel pt-BR
        const filename = `motionpro-customers-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════════════
// LICENSE_AUDIT — timeline filtrável + export
// ════════════════════════════════════════════════════════════════════
router.get("/audit.csv", requireAdmin, async (req, res, next) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 1000, 5000);
        const action = (req.query.action || "").trim();
        const params = [limit];
        let where = "";
        if (action) { params.push(action); where = "WHERE a.action = $2"; }
        const r = await pool.query(
            `SELECT a.created_at, a.action, a.user_id, u.email, a.device_id, a.detail
               FROM license_audit a
               LEFT JOIN users u ON u.id=a.user_id
              ${where}
              ORDER BY a.created_at DESC
              LIMIT $1`,
            params
        );
        const cols = ["created_at", "action", "user_id", "email", "device_id", "detail"];
        // Review bônus: CSV injection — prefixa apóstrofo se começa com =/+/-/@/tab
        const escape = (v) => {
            if (v === null || v === undefined) return "";
            let s = typeof v === "object" ? JSON.stringify(v) : String(v);
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            s = s.replace(/"/g, '""');
            return /[",\n\r;]/.test(s) ? `"${s}"` : s;
        };
        const lines = [cols.join(",")];
        for (const row of r.rows) lines.push(cols.map(c => escape(row[c])).join(","));
        const csv = "﻿" + lines.join("\r\n");
        const filename = `motionpro-audit-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (e) { next(e); }
});

// ============================================================
// DUPLICATES — detecta emails com mesmo prefixo (jmr.andrade vs jmr.andrade11)
// ============================================================
router.get("/duplicates", requireAdmin, async (_req, res, next) => {
    try {
        // Agrupa por prefixo (parte antes de @ removendo dígitos finais e separadores)
        const r = await pool.query(`
            WITH normalized AS (
              SELECT id, email, created_at,
                     LOWER(regexp_replace(split_part(email, '@', 1), '[._+0-9-]', '', 'g')) AS prefix,
                     split_part(email, '@', 2) AS domain
                FROM users
            )
            SELECT prefix, domain, json_agg(json_build_object('id', id, 'email', email, 'created_at', created_at) ORDER BY created_at) AS users, COUNT(*)::int AS n
              FROM normalized
             WHERE prefix <> ''
             GROUP BY prefix, domain
            HAVING COUNT(*) > 1
             ORDER BY n DESC, prefix
        `);
        res.json({ groups: r.rows });
    } catch (e) { next(e); }
});

module.exports = { router };
