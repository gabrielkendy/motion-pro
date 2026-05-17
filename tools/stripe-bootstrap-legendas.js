#!/usr/bin/env node
/**
 * tools/stripe-bootstrap-legendas.js
 *
 * Cria produtos Stripe pro MotionPro Legendas + Bundle Completo.
 * Idempotente (busca por metadata.mv_id).
 *
 * Usage:
 *   STRIPE_SECRET=rk_live_... DATABASE_URL=postgres://... node stripe-bootstrap-legendas.js
 */
"use strict";
const Stripe = require("stripe");
const { Client } = require("pg");

if (!process.env.STRIPE_SECRET) { console.error("STRIPE_SECRET required"); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
const stripe = Stripe(process.env.STRIPE_SECRET);

const PRODUCTS = [
    // ─── MotionPro Legendas ───
    {
        mv_id: "legendas_yearly",
        product_id: "legendas",
        plan: "yearly",
        name: "MotionPro Legendas · Anual",
        description: "Plugin de títulos, lower thirds e legendas estilizadas pro Premiere. Atualizações inclusas.",
        unit_amount: 14900,                 // R$ 149/ano
        currency: "brl",
        recurring: { interval: "year" }
    },
    {
        mv_id: "legendas_lifetime",
        product_id: "legendas",
        plan: "lifetime",
        name: "MotionPro Legendas · Vitalício",
        description: "Pagamento único — acesso vitalício a todos os títulos e lower thirds.",
        unit_amount: 39900,                 // R$ 399 uma vez
        currency: "brl",
        recurring: null
    },
    // ─── Bundle Completo (MotionPro + Legendas) ───
    {
        mv_id: "bundle_yearly",
        product_id: "bundle_all",
        plan: "yearly",
        name: "Pacote Completo MotionPro · Anual",
        description: "MotionPro + Legendas Pro — 1 assinatura cobre tudo. Economize 14% vs comprar separado.",
        unit_amount: 29900,                 // R$ 299/ano (vs R$ 348 separados)
        currency: "brl",
        recurring: { interval: "year" }
    },
    {
        mv_id: "bundle_lifetime",
        product_id: "bundle_all",
        plan: "lifetime",
        name: "Pacote Completo MotionPro · Vitalício",
        description: "MotionPro + Legendas Pro — acesso vitalício a tudo. Economize 22% vs separado.",
        unit_amount: 69900,                 // R$ 699 (vs R$ 898 separados)
        currency: "brl",
        recurring: null
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
            metadata: { mv_id: prod.mv_id, product_id: prod.product_id, plan: prod.plan }
        });
        console.log("✓ produto criado:", p.name, p.id);
    } else {
        console.log("• produto já existe:", p.name, p.id);
    }
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
            metadata: { mv_id: prod.mv_id, product_id: prod.product_id, plan: prod.plan }
        });
        console.log("  ✓ price criado:", price.id);
    } else {
        console.log("  • price já existe:", price.id);
    }
    return { mv_id: prod.mv_id, product_id: prod.product_id, plan: prod.plan, priceId: price.id, amount: prod.unit_amount };
}

(async function main() {
    const out = [];
    for (const p of PRODUCTS) out.push(await ensure(p));

    // Insere no banco product_prices
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    for (const r of out) {
        await db.query(
            `INSERT INTO product_prices(product_id, plan, stripe_price_id, amount_cents)
             VALUES($1,$2,$3,$4)
             ON CONFLICT (stripe_price_id) DO NOTHING`,
            [r.product_id, r.plan, r.priceId, r.amount]
        );
    }
    const all = await db.query("SELECT product_id, plan, stripe_price_id, amount_cents FROM product_prices ORDER BY product_id, plan");
    console.log("\n=== product_prices no DB ===");
    all.rows.forEach(r => console.log(`  ${r.product_id.padEnd(12)} ${r.plan.padEnd(10)} R$ ${(r.amount_cents/100).toFixed(2).padStart(7)} → ${r.stripe_price_id}`));
    await db.end();
    console.log("\n✓ Pronto. Stripe products criados e seedados no banco.\n");
})();
