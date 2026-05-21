"use strict";
/**
 * Soft-block middleware.
 *
 * Diferente de requireAuth, esse NÃO desloga o user. Apenas retorna 402
 * (Payment Required) com payload estruturado pra o plugin/dashboard
 * mostrar paywall MANTENDO sessão. User continua logado, ve dashboard,
 * só não consegue usar features pagas.
 *
 * Uso:
 *   router.post("/v1/some/protected-feature", requireAuth, requireActiveSubscription, handler);
 *
 * Payload de erro:
 *   { error: "subscription_inactive", reason: "expired"|"canceled"|"none",
 *     plan: "yearly"|"lifetime"|null, expired_at: <iso>|null, pricing_url: ".." }
 *
 * Bypass via header `X-Bypass-Sub: <user_id>` SE user é admin (testes).
 */
const { pool } = require("../db");

async function requireActiveSubscription(req, res, next) {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: "unauthenticated" });
        }

        // Lifetime bypass (no subscription row mas plan='lifetime' no users)
        const u = await pool.query(
            "SELECT plan, role FROM users WHERE id=$1",
            [req.user.id]
        );
        const row = u.rows[0];
        if (row && row.role === "admin") return next();              // admin sempre passa
        if (row && row.plan === "lifetime") return next();           // lifetime bypass

        const s = await pool.query(
            `SELECT plan, status, current_period_end, canceled_at
             FROM subscriptions
             WHERE user_id=$1
             ORDER BY current_period_end DESC NULLS LAST
             LIMIT 1`,
            [req.user.id]
        );
        const sub = s.rows[0];

        // Sem subscription nenhuma
        if (!sub) {
            return res.status(402).json({
                error: "subscription_inactive",
                reason: "none",
                plan: null,
                expired_at: null,
                pricing_url: process.env.PRICING_URL || "https://motionpro-lp.vercel.app/#pricing",
                message: "Você ainda não tem assinatura ativa. Continue logado pra revisar dados, mas pra usar as features assine um plano."
            });
        }

        // Status ativo — passa
        if (sub.status === "active" || sub.status === "trialing") {
            // double check: trial expirou mas Stripe não atualizou ainda?
            if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
                return res.status(402).json({
                    error: "subscription_inactive",
                    reason: "expired",
                    plan: sub.plan,
                    expired_at: sub.current_period_end,
                    pricing_url: process.env.PRICING_URL || "https://motionpro-lp.vercel.app/#pricing",
                    message: "Seu plano venceu. Renove pra continuar usando."
                });
            }
            return next();
        }

        // Não ativo: canceled/past_due/incomplete/etc
        return res.status(402).json({
            error: "subscription_inactive",
            reason: sub.status === "canceled" ? "canceled" : (sub.status === "past_due" ? "past_due" : "expired"),
            plan: sub.plan,
            expired_at: sub.current_period_end || sub.canceled_at || null,
            pricing_url: process.env.PRICING_URL || "https://motionpro-lp.vercel.app/#pricing",
            message: sub.status === "past_due"
                ? "Cobrança falhou. Atualize o método de pagamento."
                : "Assinatura inativa. Reative pra usar."
        });
    } catch (e) { next(e); }
}

module.exports = { requireActiveSubscription };
