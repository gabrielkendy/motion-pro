"use strict";
const router = require("express").Router();
const { pool } = require("../db");
const { trialReminderEmail, trialExpiredEmail } = require("../utils/email");

const PUBLIC_URL = process.env.PUBLIC_URL || "https://motionpro-lp.vercel.app";

// Auth via header CRON_SECRET (não usa JWT — chamado por Vercel Cron ou cURL manual do admin)
function requireCronSecret(req, res, next) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(500).json({ error: "cron_secret_not_set" });
    const provided = req.headers["x-cron-secret"] || req.query.secret;
    // Vercel Cron usa Authorization: Bearer <CRON_SECRET>
    const bearer = (req.headers.authorization || "").match(/^Bearer (.+)$/);
    if (bearer && bearer[1] === secret) return next();
    if (provided === secret) return next();
    return res.status(401).json({ error: "invalid_cron_secret" });
}

function productInfo(productId) {
    const map = {
        motionpro:  { name: "Motion Titles",          pricingUrl: PUBLIC_URL + "/#pricing" },
        legendas:   { name: "Motion Legendas", pricingUrl: PUBLIC_URL + "/legendas/#pricing" },
        bundle_all: { name: "Pacote Completo",    pricingUrl: PUBLIC_URL + "/#pricing" }
    };
    return map[productId] || map.motionpro;
}

/**
 * GET /v1/cron/trial-reminders
 * Roda 1x por dia. Envia 3 tipos de email:
 *   - D-3: trial vence em ~3 dias → reminder normal
 *   - D-1: trial vence em ~1 dia  → urgência
 *   - Expired: trial venceu nas últimas 24h → "volte quando quiser"
 *
 * Usa email_log com (user_id, kind, context_key=subscription_id) pra evitar duplicação.
 */
router.get("/trial-reminders", requireCronSecret, async (_req, res, next) => {
    try {
        const result = { sent: { d3: 0, d1: 0, expired: 0 }, skipped: 0, errors: 0 };

        // === Busca usuários com trial ativo expirando ===
        const trials = await pool.query(`
            SELECT s.id AS sub_id, s.user_id, s.product_id, s.current_period_end,
                   u.email, u.name, u.email_verified,
                   EXTRACT(EPOCH FROM (s.current_period_end - now())) / 86400 AS days_left
              FROM subscriptions s
              JOIN users u ON u.id = s.user_id
             WHERE s.status = 'trialing'
               AND s.current_period_end IS NOT NULL
               AND s.current_period_end > now() - interval '1 day'
               AND s.current_period_end < now() + interval '4 days'
        `);

        for (const row of trials.rows) {
            const daysLeft = Math.ceil(row.days_left);
            let kind = null;
            if (daysLeft <= 0) kind = "trial_expired";
            else if (daysLeft <= 1) kind = "trial_d1";
            else if (daysLeft <= 3) kind = "trial_d3";
            if (!kind) { result.skipped++; continue; }

            // Já mandamos esse kind pra essa subscription?
            const dup = await pool.query(
                "SELECT 1 FROM email_log WHERE user_id=$1 AND kind=$2 AND context_key=$3 LIMIT 1",
                [row.user_id, kind, row.sub_id]
            );
            if (dup.rowCount) { result.skipped++; continue; }

            const p = productInfo(row.product_id);
            try {
                let sendResult;
                if (kind === "trial_expired") {
                    sendResult = await trialExpiredEmail({
                        email: row.email, name: row.name,
                        productName: p.name, pricingUrl: p.pricingUrl
                    });
                } else {
                    sendResult = await trialReminderEmail({
                        email: row.email, name: row.name,
                        productName: p.name, daysLeft: Math.max(1, daysLeft),
                        pricingUrl: p.pricingUrl
                    });
                }

                // Loga (mesmo se Resend falhou — evita retry infinito em conta inválida)
                await pool.query(
                    "INSERT INTO email_log(user_id, email, kind, context_key, resend_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
                    [row.user_id, row.email, kind, row.sub_id, sendResult?.id || null]
                );

                if (kind === "trial_d3") result.sent.d3++;
                else if (kind === "trial_d1") result.sent.d1++;
                else result.sent.expired++;
            } catch (e) {
                console.error("[cron] trial reminder fail", e.message);
                result.errors++;
            }
        }

        // === Bonus: marca subs como 'expired' se passou current_period_end ===
        const expiredUpd = await pool.query(`
            UPDATE subscriptions SET status='expired', updated_at=now()
             WHERE status='trialing' AND current_period_end < now()
             RETURNING id
        `);
        result.subscriptions_expired = expiredUpd.rowCount;

        res.json({ ok: true, ran_at: new Date().toISOString(), ...result });
    } catch (e) { next(e); }
});

/**
 * GET /v1/cron/health — endpoint público pra Vercel saber que cron tá vivo
 */
router.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

module.exports = { router };
