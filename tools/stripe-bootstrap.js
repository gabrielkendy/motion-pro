#!/usr/bin/env node
/* tools/stripe-bootstrap.js
 *
 * One-shot script that creates the 3 MotionVault products + prices in your
 * Stripe account and prints the env vars you need to put in backend/.env.
 *
 * Usage:
 *   STRIPE_SECRET=sk_live_or_sk_test_xxx node stripe-bootstrap.js
 *
 * Idempotent: it searches for products by metadata.mv_id before creating,
 * so re-running it does NOT duplicate products.
 */
"use strict";
const Stripe = require("stripe");

if (!process.env.STRIPE_SECRET) {
    console.error("Defina STRIPE_SECRET=sk_test_... (ou sk_live_)");
    process.exit(1);
}
const stripe = Stripe(process.env.STRIPE_SECRET);

const PRODUCTS = [
    {
        mv_id: "yearly",
        name: "MotionVault Anual",
        description: "Acesso completo aos 7.906 templates premium · cobrança anual · 2 dispositivos · atualizações inclusas · suporte prioritário",
        unit_amount: 19900,                 // R$199,00
        currency: "brl",
        recurring: { interval: "year" }
    },
    {
        mv_id: "lifetime",
        name: "MotionVault Vitalício",
        description: "Pagamento único · acesso para sempre · 3 dispositivos · todas atualizações futuras · suporte vitalício",
        unit_amount: 49900,                 // R$499,00
        currency: "brl",
        recurring: null                     // one-time
    }
];

async function findProduct(mvId) {
    const list = await stripe.products.search({ query: `metadata['mv_id']:'${mvId}'` });
    return list.data[0] || null;
}

async function ensure(prod) {
    let p = await findProduct(prod.mv_id);
    if (!p) {
        p = await stripe.products.create({
            name: prod.name,
            description: prod.description,
            metadata: { mv_id: prod.mv_id }
        });
        console.log("✓ produto criado: " + p.name + "  " + p.id);
    } else {
        console.log("• produto já existe: " + p.name + "  " + p.id);
    }

    // find price w/ same unit_amount + interval (recurring)
    const priceList = await stripe.prices.list({ product: p.id, active: true, limit: 50 });
    const match = priceList.data.find(pr => {
        if (pr.unit_amount !== prod.unit_amount) return false;
        if (prod.recurring) return pr.recurring && pr.recurring.interval === prod.recurring.interval;
        return !pr.recurring;
    });
    let price = match;
    if (!price) {
        price = await stripe.prices.create({
            product: p.id,
            unit_amount: prod.unit_amount,
            currency: prod.currency,
            recurring: prod.recurring || undefined,
            metadata: { mv_id: prod.mv_id }
        });
        console.log("  ✓ price criado: " + price.id);
    } else {
        console.log("  • price já existe: " + price.id);
    }
    return { mv_id: prod.mv_id, productId: p.id, priceId: price.id };
}

(async function main() {
    const out = [];
    for (const p of PRODUCTS) out.push(await ensure(p));

    console.log("\n=== Cole isto no backend/.env ===\n");
    for (const r of out) console.log(`STRIPE_PRICE_${r.mv_id.toUpperCase()}=${r.priceId}`);
    console.log("\nDica: configure também STRIPE_WEBHOOK_SECRET (criado quando você adicionar o endpoint /v1/billing/webhook no Dashboard > Developers > Webhooks).\n");
})();
