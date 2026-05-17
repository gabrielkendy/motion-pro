"use strict";
const router = require("express").Router();
const Stripe = require("stripe");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const stripe = Stripe(process.env.STRIPE_SECRET || "sk_test_xxx");

const PRICE_MAP = {
    yearly:   process.env.STRIPE_PRICE_YEARLY,
    lifetime: process.env.STRIPE_PRICE_LIFETIME
};
const PLAN_FROM_PRICE = Object.fromEntries(
    Object.entries(PRICE_MAP).map(([k, v]) => [v, k])
);

async function ensureCustomer(userId, email) {
    const r = await pool.query("SELECT stripe_customer FROM users WHERE id=$1", [userId]);
    let cust = r.rows[0] && r.rows[0].stripe_customer;
    if (cust) return cust;
    const c = await stripe.customers.create({ email, metadata: { user_id: userId } });
    await pool.query("UPDATE users SET stripe_customer=$1 WHERE id=$2", [c.id, userId]);
    return c.id;
}

router.post("/checkout", requireAuth, async (req, res, next) => {
    try {
        const plan = req.query.plan || "monthly";
        const price = PRICE_MAP[plan];
        if (!price) return res.status(400).json({ error: "unknown_plan" });
        const customer = await ensureCustomer(req.user.id, req.user.email);
        const session = await stripe.checkout.sessions.create({
            mode: plan === "lifetime" ? "payment" : "subscription",
            customer,
            line_items: [{ price, quantity: 1 }],
            success_url: (process.env.PUBLIC_URL || "") + "/billing/success?cs={CHECKOUT_SESSION_ID}",
            cancel_url:  (process.env.PUBLIC_URL || "") + "/billing/canceled",
            allow_promotion_codes: true
        });
        res.json({ url: session.url, id: session.id });
    } catch (e) { next(e); }
});

router.post("/portal", requireAuth, async (req, res, next) => {
    try {
        const customer = await ensureCustomer(req.user.id, req.user.email);
        const p = await stripe.billingPortal.sessions.create({
            customer,
            return_url: (process.env.PUBLIC_URL || "") + "/account"
        });
        res.json({ url: p.url });
    } catch (e) { next(e); }
});

// Stripe webhook — server.js mounts express.raw before this handler.
async function webhook(req, res) {
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.headers["stripe-signature"],
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error("Stripe sig verify failed", err.message);
        return res.status(400).send("bad signature");
    }

    try {
        switch (event.type) {
            case "checkout.session.completed":
            case "customer.subscription.created":
            case "customer.subscription.updated": {
                const obj = event.data.object;
                const customerId = obj.customer;
                const userR = await pool.query("SELECT id FROM users WHERE stripe_customer=$1", [customerId]);
                if (!userR.rowCount) break;
                const userId = userR.rows[0].id;

                let priceId, status, periodEnd, cancelAt, subId, mode;
                if (event.type === "checkout.session.completed") {
                    mode = obj.mode;
                    subId = obj.subscription || null;
                    priceId = obj.line_items
                        ? obj.line_items.data?.[0]?.price?.id
                        : null;
                    status = mode === "payment" ? "active" : (obj.payment_status === "paid" ? "active" : "incomplete");
                    if (mode === "payment") periodEnd = null;
                } else {
                    subId = obj.id;
                    priceId = obj.items.data[0].price.id;
                    status = obj.status;
                    periodEnd = obj.current_period_end ? new Date(obj.current_period_end * 1000) : null;
                    cancelAt = obj.cancel_at ? new Date(obj.cancel_at * 1000) : null;
                }
                const plan = PLAN_FROM_PRICE[priceId] || "monthly";

                await pool.query(
                    `INSERT INTO subscriptions(user_id, plan, status, stripe_sub_id, current_period_end, cancel_at)
                     VALUES($1,$2,$3,$4,$5,$6)
                     ON CONFLICT DO NOTHING`,
                    [userId, plan, status, subId, periodEnd, cancelAt]
                );
                await pool.query(
                    `UPDATE subscriptions
                       SET status=$1, current_period_end=$2, cancel_at=$3, updated_at=now()
                     WHERE user_id=$4 AND ($5::text IS NULL OR stripe_sub_id=$5)`,
                    [status, periodEnd, cancelAt, userId, subId]
                );
                break;
            }
            case "customer.subscription.deleted": {
                const obj = event.data.object;
                await pool.query(
                    "UPDATE subscriptions SET status='canceled', updated_at=now() WHERE stripe_sub_id=$1",
                    [obj.id]
                );
                break;
            }
        }
        res.json({ received: true });
    } catch (e) {
        console.error("webhook handler error", e);
        res.status(500).send("err");
    }
}

module.exports = { router, webhook };
