#!/usr/bin/env node
/**
 * bootstrap-stripe-suite-simple.js
 *
 * Estratégia de pricing simplificada (decisão Gabriel · 2026-05-21):
 *   - Solo (1 plugin: Titles OU Legendas)       R$ 59,90/mês
 *   - Duo  (Titles + Legendas)                  R$ 89,90/mês
 *   - Duo Anual (Titles + Legendas, 12 meses)   R$ 838,80 (12x R$ 69,90)
 *
 * NÃO inclui:
 *   - Motion IA (ainda não pronto)
 *   - Vitalício
 *   - Anual de 1 plugin
 *
 * Cria os 3 prices no Stripe + insere em product_prices do Neon.
 *
 * Uso:
 *   STRIPE_SECRET=sk_live_... DATABASE_URL=postgres://... node tools/bootstrap-stripe-suite-simple.js
 *   STRIPE_SECRET=sk_test_... node tools/bootstrap-stripe-suite-simple.js --dry-run
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
console.log("  Motion Suite · Bootstrap Stripe (" + (IS_TEST ? "TEST mode" : "LIVE mode") + ")");
console.log("  Estratégia v2 (2026-05-22):");
console.log("    Solo Titles   R$59,90/mês");
console.log("    Solo Legendas R$59,90/mês");
console.log("    Duo Mensal    R$89,90/mês (Titles+Legendas)");
console.log("    Duo Anual     R$838,80/ano (12x R$69,90)");
console.log("════════════════════════════════════════════════════════");
console.log("");

const SPEC = {
    solo_titles_monthly: {
        productName: "Motion Titles · Solo",
        productDescription: "Acesso completo ao Motion Titles · 7906 templates · 7 dias grátis · cancela quando quiser",
        amount_brl: 59.90,
        recurring: { interval: "month" },
        productId: "titles",       // canônico — bate com product-aliases.js
        plan: "monthly"
    },
    solo_legendas_monthly: {
        productName: "Motion Legendas · Solo",
        productDescription: "Acesso completo ao Motion Legendas · 549 templates word-level · 7 dias grátis · cancela quando quiser",
        amount_brl: 59.90,
        recurring: { interval: "month" },
        productId: "legendas",     // canônico — bate com product-aliases.js
        plan: "monthly"
    },
    duo_monthly: {
        productName: "Motion Suite · Duo",
        productDescription: "Motion Titles + Motion Legendas · economize R$ 30/mês vs comprar separado · 7 dias grátis",
        amount_brl: 89.90,
        recurring: { interval: "month" },
        productId: "duo",          // canônico — bate com product-aliases.js
        plan: "monthly"
    },
    duo_yearly: {
        productName: "Motion Suite · Duo Anual",
        productDescription: "Motion Titles + Motion Legendas · 12x R$ 69,90 (economia de R$ 240/ano vs mensal)",
        amount_brl: 838.80, // 12 × 69.90
        recurring: { interval: "year" },
        productId: "duo",
        plan: "yearly"
    }
};

async function findOrCreateProduct(name, description) {
    const products = await stripe.products.search({ query: `name:"${name}" AND active:"true"` });
    if (products.data.length > 0) {
        console.log(`  [OK] product existe: ${name} (${products.data[0].id})`);
        return products.data[0];
    }
    const p = await stripe.products.create({
        name,
        description,
        metadata: { suite: "motion-suite", bootstrap_at: new Date().toISOString() }
    });
    console.log(`  [NEW] product criado: ${name} (${p.id})`);
    return p;
}

async function findOrCreatePrice(product, spec) {
    const cents = Math.round(spec.amount_brl * 100);
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
    const match = prices.data.find(pr =>
        pr.unit_amount === cents &&
        pr.currency === "brl" &&
        ((spec.recurring && pr.recurring && pr.recurring.interval === spec.recurring.interval) ||
         (!spec.recurring && !pr.recurring))
    );
    if (match) {
        console.log(`    [OK] price existe: ${spec.plan} R$${spec.amount_brl} (${match.id})`);
        return match;
    }
    const payload = {
        product: product.id,
        unit_amount: cents,
        currency: "brl",
        nickname: spec.productName + " · " + spec.plan,
        metadata: { product_id: spec.productId, plan: spec.plan }
    };
    if (spec.recurring) payload.recurring = spec.recurring;
    const p = await stripe.prices.create(payload);
    console.log(`    [NEW] price criado: ${spec.plan} R$${spec.amount_brl} (${p.id})`);
    return p;
}

async function main() {
    const results = {};

    for (const [key, spec] of Object.entries(SPEC)) {
        const product = await findOrCreateProduct(spec.productName, spec.productDescription);
        const price = await findOrCreatePrice(product, spec);
        results[key] = { price_id: price.id, product_id: spec.productId, plan: spec.plan, amount_cents: Math.round(spec.amount_brl * 100) };
    }

    console.log("");
    console.log("════════════════════════════════════════════════════════");
    console.log("  ENV vars pra setar no Vercel (project: motionpro):");
    console.log("════════════════════════════════════════════════════════");
    console.log(`  STRIPE_PRICE_SOLO_TITLES=${results.solo_titles_monthly.price_id}`);
    console.log(`  STRIPE_PRICE_SOLO_LEGENDAS=${results.solo_legendas_monthly.price_id}`);
    console.log(`  STRIPE_PRICE_DUO_MONTHLY=${results.duo_monthly.price_id}`);
    console.log(`  STRIPE_PRICE_DUO_YEARLY=${results.duo_yearly.price_id}`);
    console.log("");
    console.log("  IMPORTANTE: vars antigas que podem virar lixo:");
    console.log("    STRIPE_PRICE_SOLO_MONTHLY  (use SOLO_TITLES ou SOLO_LEGENDAS agora)");
    console.log("");

    if (DRY) {
        console.log("  [DRY-RUN] não tocou no banco. Rode sem --dry-run pra inserir em product_prices.");
        return;
    }

    const { Client } = require("pg");
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    try {
        for (const [key, r] of Object.entries(results)) {
            await db.query(
                `INSERT INTO product_prices(product_id, plan, stripe_price_id, amount_cents, currency, is_active)
                 VALUES($1,$2,$3,$4,'brl',true)
                 ON CONFLICT (stripe_price_id) DO UPDATE
                   SET product_id=EXCLUDED.product_id, plan=EXCLUDED.plan,
                       amount_cents=EXCLUDED.amount_cents, is_active=true`,
                [r.product_id, r.plan, r.price_id, r.amount_cents]
            );
            console.log(`  [DB] inserido: ${r.product_id}/${r.plan} → ${r.price_id}`);
        }
        console.log("");
        console.log("  ✓ TUDO PRONTO. Próximos passos:");
        console.log("    1. Vercel → project motionpro → Settings → Environment Variables");
        console.log("       adicione as 3 STRIPE_PRICE_* acima");
        console.log("    2. Redeploy do backend (vercel --prod ou push em main)");
        console.log("    3. Teste: criar checkout via POST /v1/checkout { product:'duo', plan:'monthly' }");
    } finally {
        await db.end();
    }
}

main().catch(e => {
    console.error("[FATAL]", e.message);
    process.exit(1);
});
