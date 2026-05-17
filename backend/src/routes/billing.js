"use strict";
const router = require("express").Router();
const Stripe = require("stripe");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { welcomeEmail, paymentFailedEmail } = require("../utils/email");

const stripe = Stripe(process.env.STRIPE_SECRET || "sk_test_xxx");

// Fallback caso DB esteja indisponível — só pro motionpro
const FALLBACK_PRICES = {
    motionpro: {
        yearly:   process.env.STRIPE_PRICE_YEARLY,
        lifetime: process.env.STRIPE_PRICE_LIFETIME
    }
};

const PUBLIC_URL = process.env.PUBLIC_URL || "https://motionpro-lp.vercel.app";

// Busca price_id do produto+plano no banco
async function getStripePriceId(productId, plan) {
    try {
        const r = await pool.query(
            "SELECT stripe_price_id FROM product_prices WHERE product_id=$1 AND plan=$2 AND is_active=true",
            [productId, plan]
        );
        if (r.rowCount) return r.rows[0].stripe_price_id;
    } catch (_) {}
    return FALLBACK_PRICES[productId]?.[plan] || null;
}

// Resolve plan a partir do priceId (pro webhook)
async function planAndProductFromPriceId(priceId) {
    try {
        const r = await pool.query(
            "SELECT product_id, plan FROM product_prices WHERE stripe_price_id=$1",
            [priceId]
        );
        if (r.rowCount) return r.rows[0];
    } catch (_) {}
    // Fallback: motionpro
    for (const [plan, pid] of Object.entries(FALLBACK_PRICES.motionpro)) {
        if (pid === priceId) return { product_id: "motionpro", plan };
    }
    return { product_id: "motionpro", plan: "yearly" };
}

// ============================================================
// CHECKOUT — PÚBLICO (não precisa estar logado)
// Stripe coleta o e-mail e dados de pagamento; após pagar,
// o webhook cria a conta e manda o welcome com credenciais.
// ============================================================
router.post("/checkout", async (req, res, next) => {
    try {
        const plan = (req.query.plan || req.body?.plan || "yearly").toLowerCase();
        const product_id = (req.query.product || req.body?.product || "motionpro").toLowerCase();
        const price = await getStripePriceId(product_id, plan);
        if (!price) return res.status(400).json({
            error: "unknown_product_or_plan",
            product: product_id, plan
        });

        // Se o user JÁ estiver logado, anexa ao customer dele
        let customerId = null;
        let emailHint = req.body?.email || null;
        const authHdr = req.headers.authorization || "";
        const m = authHdr.match(/^Bearer (.+)$/);
        if (m) {
            try {
                const { verifySession } = require("../utils/jwt");
                const session = verifySession(m[1]);
                if (session) {
                    const u = await pool.query("SELECT id, email, stripe_customer FROM users WHERE id=$1", [session.sub]);
                    if (u.rowCount) {
                        emailHint = u.rows[0].email;
                        if (u.rows[0].stripe_customer) customerId = u.rows[0].stripe_customer;
                        else {
                            const c = await stripe.customers.create({ email: emailHint, metadata: { user_id: u.rows[0].id } });
                            customerId = c.id;
                            await pool.query("UPDATE users SET stripe_customer=$1 WHERE id=$2", [c.id, u.rows[0].id]);
                        }
                    }
                }
            } catch (_) { /* ignore */ }
        }

        const sessionParams = {
            mode: plan === "lifetime" ? "payment" : "subscription",
            line_items: [{ price, quantity: 1 }],
            success_url: PUBLIC_URL + "/success.html?cs={CHECKOUT_SESSION_ID}",
            cancel_url:  PUBLIC_URL + "/cancel.html",
            allow_promotion_codes: true,
            billing_address_collection: "auto",
            metadata: { plan, product_id }
        };
        if (customerId) {
            sessionParams.customer = customerId;
        } else {
            // Sem customer ainda — Stripe vai criar um e coletar e-mail
            sessionParams.customer_creation = (plan === "lifetime") ? "always" : undefined;  // sub mode já cria sempre
            if (emailHint) sessionParams.customer_email = emailHint;
        }

        const session = await stripe.checkout.sessions.create(sessionParams);
        res.json({ url: session.url, id: session.id });
    } catch (e) { next(e); }
});

// ============================================================
// CUSTOMER PORTAL — requer auth
// ============================================================
router.post("/portal", requireAuth, async (req, res, next) => {
    try {
        const u = await pool.query("SELECT stripe_customer FROM users WHERE id=$1", [req.user.id]);
        let cust = u.rows[0]?.stripe_customer;
        if (!cust) {
            const c = await stripe.customers.create({ email: req.user.email, metadata: { user_id: req.user.id } });
            cust = c.id;
            await pool.query("UPDATE users SET stripe_customer=$1 WHERE id=$2", [c.id, req.user.id]);
        }
        const p = await stripe.billingPortal.sessions.create({
            customer: cust,
            return_url: PUBLIC_URL + "/account.html"
        });
        res.json({ url: p.url });
    } catch (e) { next(e); }
});

// ============================================================
// Helpers para webhook
// ============================================================
function genTempPassword() {
    // Senha legível: 3 grupos de 4 chars alfanuméricos. Ex: K7M9-X2P4-Q8R5
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem chars confusos
    const grp = () => Array.from(crypto.randomBytes(4)).map(b => chars[b % chars.length]).join("");
    return `${grp()}-${grp()}-${grp()}`;
}

async function findOrCreateUser({ email, stripeCustomerId }) {
    if (!email) return null;
    const norm = email.toLowerCase().trim();
    let r = await pool.query("SELECT id, email FROM users WHERE email=$1", [norm]);
    if (r.rowCount) {
        // Garante que stripe_customer está linkado
        if (stripeCustomerId) {
            await pool.query("UPDATE users SET stripe_customer=$1 WHERE id=$2 AND (stripe_customer IS NULL OR stripe_customer<>$1)",
                [stripeCustomerId, r.rows[0].id]);
        }
        return { user: r.rows[0], created: false, plainPassword: null };
    }
    // CRIA conta a partir do pagamento
    const plain = genTempPassword();
    const hash = await bcrypt.hash(plain, 12);
    const ins = await pool.query(
        "INSERT INTO users(email, password_hash, stripe_customer) VALUES($1,$2,$3) RETURNING id, email",
        [norm, hash, stripeCustomerId || null]
    );
    return { user: ins.rows[0], created: true, plainPassword: plain };
}

async function upsertSubscription({ userId, productId, plan, status, stripeSubId, periodEnd, cancelAt }) {
    const product = productId || "motionpro";
    if (stripeSubId) {
        const upd = await pool.query(
            `UPDATE subscriptions
                SET status=$1, plan=$2, product_id=$3, current_period_end=$4, cancel_at=$5, updated_at=now()
              WHERE stripe_sub_id=$6 RETURNING id`,
            [status, plan, product, periodEnd, cancelAt, stripeSubId]
        );
        if (upd.rowCount) return upd.rows[0].id;
    }
    const ins = await pool.query(
        `INSERT INTO subscriptions(user_id, product_id, plan, status, stripe_sub_id, current_period_end, cancel_at)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [userId, product, plan, status, stripeSubId, periodEnd, cancelAt]
    );
    return ins.rows[0].id;
}

// ============================================================
// WEBHOOK — eventos da Stripe
// ============================================================
async function webhook(req, res) {
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.headers["stripe-signature"],
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error("Stripe sig verify failed:", err.message);
        return res.status(400).send("bad signature");
    }

    // 🔒 IDEMPOTÊNCIA: previne processar o mesmo evento 2x se Stripe reenviar.
    try {
        const dup = await pool.query(
            "INSERT INTO stripe_events_seen(event_id, type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",
            [event.id, event.type]
        );
        if (dup.rowCount === 0) {
            console.log("[webhook] evento duplicado ignorado:", event.id);
            return res.json({ received: true, duplicate: true });
        }
    } catch (e) {
        // Se a tabela não existe ainda, continua (não bloqueia webhook)
        if (!String(e.message).includes("does not exist")) {
            console.error("[webhook] idempotency check fail", e.message);
        }
    }

    try {
        switch (event.type) {
            // -------- CHECKOUT FINALIZADO --------
            case "checkout.session.completed": {
                const cs = event.data.object;
                const customerId = cs.customer;
                const email = cs.customer_details?.email || cs.customer_email;
                const plan = cs.metadata?.plan || "yearly";
                const product_id = cs.metadata?.product_id || "motionpro";

                if (!email) { console.warn("[webhook] checkout sem email", cs.id); break; }

                const { user, created, plainPassword } = await findOrCreateUser({
                    email, stripeCustomerId: customerId
                });
                if (!user) break;

                // Determina status/period
                const isLifetime = cs.mode === "payment";
                const status = (cs.payment_status === "paid") ? "active" : "incomplete";
                let periodEnd = null, stripeSubId = null;
                if (!isLifetime && cs.subscription) {
                    stripeSubId = cs.subscription;
                    try {
                        const sub = await stripe.subscriptions.retrieve(cs.subscription);
                        periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
                    } catch (e) { /* ignore */ }
                }

                await upsertSubscription({
                    userId: user.id, productId: product_id, plan, status, stripeSubId, periodEnd, cancelAt: null
                });

                await pool.query(
                    "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'checkout_completed', $2)",
                    [user.id, { plan, product_id, mode: cs.mode, amount: cs.amount_total, stripe_session: cs.id }]
                );

                // Manda welcome (com senha temporária se foi criado agora)
                const productName = product_id === "legendas" ? "MotionPro Legendas"
                                  : product_id === "bundle_all" ? "Pacote Completo MotionPro"
                                  : "MotionPro";
                const downloadUrl = product_id === "legendas"
                    ? PUBLIC_URL + "/legendas/download.html"
                    : PUBLIC_URL + "/download.html";
                const passwordToSend = plainPassword || "(use a senha que você já tem cadastrada)";
                try {
                    await welcomeEmail({
                        email: user.email,
                        password: passwordToSend,
                        plan,
                        productName,
                        downloadUrl
                    });
                } catch (e) { console.error("[webhook] welcome email fail", e.message); }
                break;
            }

            // -------- ASSINATURA ATUALIZADA --------
            case "customer.subscription.created":
            case "customer.subscription.updated": {
                const sub = event.data.object;
                const customerId = sub.customer;
                const userR = await pool.query("SELECT id, email FROM users WHERE stripe_customer=$1", [customerId]);
                if (!userR.rowCount) break;
                const priceId = sub.items?.data?.[0]?.price?.id;
                const pp = await planAndProductFromPriceId(priceId);
                await upsertSubscription({
                    userId: userR.rows[0].id,
                    productId: pp.product_id,
                    plan: pp.plan,
                    status: sub.status,
                    stripeSubId: sub.id,
                    periodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
                    cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null
                });
                break;
            }

            // -------- ASSINATURA CANCELADA --------
            case "customer.subscription.deleted": {
                const sub = event.data.object;
                await pool.query(
                    "UPDATE subscriptions SET status='canceled', updated_at=now() WHERE stripe_sub_id=$1",
                    [sub.id]
                );
                break;
            }

            // -------- PAGAMENTO FALHOU --------
            case "invoice.payment_failed": {
                const inv = event.data.object;
                const customerId = inv.customer;
                const userR = await pool.query("SELECT id, email FROM users WHERE stripe_customer=$1", [customerId]);
                if (userR.rowCount) {
                    await pool.query(
                        "UPDATE subscriptions SET status='past_due', updated_at=now() WHERE user_id=$1 AND status='active'",
                        [userR.rows[0].id]
                    );
                    try {
                        await paymentFailedEmail({
                            email: userR.rows[0].email,
                            retryUrl: PUBLIC_URL + "/account.html"
                        });
                    } catch (e) { console.error("[webhook] pf email fail", e.message); }
                }
                break;
            }
        }
        res.json({ received: true });
    } catch (e) {
        console.error("[webhook handler error]", e);
        res.status(500).send("err");
    }
}

module.exports = { router, webhook };
