#!/usr/bin/env node
/**
 * bootstrap-stripe-ia.js
 *
 * Cria os products + prices do Motion IA no Stripe e insere em product_prices
 * (banco Neon). Roda 1x quando configurar produção.
 *
 * Requer ENV:
 *   STRIPE_SECRET           — sk_live_... (ou sk_test_... pra dry-run)
 *   DATABASE_URL            — postgres://… (mesmo do backend)
 *
 * Uso:
 *   STRIPE_SECRET=sk_live_… DATABASE_URL=postgres://… node tools/bootstrap-stripe-ia.js
 *   STRIPE_SECRET=sk_test_… node tools/bootstrap-stripe-ia.js --dry-run  (só cria no Stripe, não toca DB)
 */
"use strict";
const Stripe = require("stripe");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");

if (!process.env.STRIPE_SECRET) {
    console.error("[ERR] STRIPE_SECRET env obrigatório (sk_live_ ou sk_test_)");
    process.exit(1);
}
if (!DRY && !process.env.DATABASE_URL) {
    console.error("[ERR] DATABASE_URL env obrigatório (ou rode com --dry-run)");
    process.exit(1);
}

const stripe = Stripe(process.env.STRIPE_SECRET);
const IS_TEST = process.env.STRIPE_SECRET.startsWith("sk_test_");

console.log("════════════════════════════════════════════════════════");
console.log("  Motion IA · Bootstrap Stripe (" + (IS_TEST ? "TEST mode" : "LIVE mode") + ")");
console.log("════════════════════════════════════════════════════════");
console.log("");

// Definições dos prices
const SPEC = {
    yearly: {
        name: "Motion IA — Anual",
        description: "Acesso completo 1 ano · 13 features · 3 devices · suporte",
        amount_brl: 299,   // R$ 299
        recurring: { interval: "year" }
    },
    lifetime: {
        name: "Motion IA — Lifetime",
        description: "Acesso vitalício · 13 features · 5 devices · upgrades inclusos",
        amount_brl: 699,   // R$ 699
        recurring: null    // one-time
    }
};

async function findOrCreateProduct(name) {
    // Busca product existente pelo nome
    const products = await stripe.products.search({ query: `name:"${name}" AND active:"true"` });
    if (products.data.length > 0) {
        console.log(`  [OK] product já existe: ${name} (${products.data[0].id})`);
        return products.data[0];
    }
    const p = await stripe.products.create({
        name: name,
        metadata: { plugin: "motion-ia", bootstrap_at: new Date().toISOString() }
    });
    console.log(`  [NEW] product criado: ${name} (${p.id})`);
    return p;
}

async function findOrCreatePrice(product, plan, spec) {
    const cents = spec.amount_brl * 100;
    // Lista prices existentes do product
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
    const match = prices.data.find(pr =>
        pr.unit_amount === cents &&
        pr.currency === "brl" &&
        ((spec.recurring && pr.recurring && pr.recurring.interval === spec.recurring.interval) ||
         (!spec.recurring && !pr.recurring))
    );
    if (match) {
        console.log(`    [OK] price já existe: ${plan} R$${spec.amount_brl} (${match.id})`);
        return match;
    }
    const payload = {
        product: product.id,
        unit_amount: cents,
        currency: "brl",
        metadata: { plan: plan, plugin: "motion-ia" }
    };
    if (spec.recurring) payload.recurring = spec.recurring;
    const p = await stripe.prices.create(payload);
    console.log(`    [NEW] price criado: ${plan} R$${spec.amount_brl} (${p.id})`);
    return p;
}

async function main() {
    const results = {};

    // 1) Cria product principal "Motion IA"
    const product = await findOrCreateProduct("Motion IA");

    // 2) Cria os 2 prices (yearly + lifetime)
    for (const [plan, spec] of Object.entries(SPEC)) {
        const price = await findOrCreatePrice(product, plan, spec);
        results[plan] = price.id;
    }

    console.log("");
    console.log("════════════════════════════════════════════════════════");
    console.log("  ENV vars pra setar no Vercel (project: motionpro):");
    console.log("════════════════════════════════════════════════════════");
    console.log(`  STRIPE_PRICE_IA_YEARLY=${results.yearly}`);
    console.log(`  STRIPE_PRICE_IA_LIFETIME=${results.lifetime}`);
    console.log("");

    if (DRY) {
        console.log("  [DRY-RUN] não tocou no banco. Rode sem --dry-run pra inserir em product_prices.");
        return;
    }

    // 3) Insere em product_prices via DATABASE_URL
    const { Client } = require("pg");
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    try {
        for (const [plan, priceId] of Object.entries(results)) {
            const spec = SPEC[plan];
            await db.query(
                `INSERT INTO product_prices(product_id, plan, stripe_price_id, amount_cents, currency, is_active)
                 VALUES($1,$2,$3,$4,'brl',true)
                 ON CONFLICT (stripe_price_id) DO UPDATE
                   SET product_id=EXCLUDED.product_id, plan=EXCLUDED.plan, amount_cents=EXCLUDED.amount_cents, is_active=true`,
                ["ia", plan, priceId, spec.amount_brl * 100]
            );
            console.log(`  [DB] inserido: ia/${plan} → ${priceId}`);
        }
        console.log("");
        console.log("  ✓ TUDO PRONTO. Próximos passos:");
        console.log("    1. Vercel → project motionpro → Settings → Environment Variables");
        console.log("       adicione STRIPE_PRICE_IA_YEARLY e STRIPE_PRICE_IA_LIFETIME (valores acima)");
        console.log("    2. Redeploy do backend (vercel --prod)");
        console.log("    3. Teste: criar checkout via POST /v1/checkout { product_id:'ia', plan:'yearly' }");
    } finally {
        await db.end();
    }
}

main().catch(e => {
    console.error("[FATAL]", e.message);
    process.exit(1);
});
