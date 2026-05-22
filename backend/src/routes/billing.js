"use strict";
const router = require("express").Router();
const Stripe = require("stripe");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const {
    welcomeEmail,
    paymentFailedEmail,
    subscriptionSuspendedEmail
} = require("../utils/email");
// M4: reusa gerador de keys já existente em license-keys.js (DRY)
const { genKey: generateLicenseKey } = require("./license-keys");
// A7: tabela canônica de produtos + aliases — fonte única
const { resolveProduct, normalizeProductId } = require("../utils/product-aliases");

const stripe = Stripe(process.env.STRIPE_SECRET || "sk_test_xxx");

// Fallback caso DB product_prices esteja vazio/indisponível — usado quando
// o webhook ou /checkout não consegue resolver via banco. Em v4 (2026-05-22):
//   - Titles Solo  → STRIPE_PRICE_SOLO_TITLES   (R$59,90/mês)
//   - Legendas Solo→ STRIPE_PRICE_SOLO_LEGENDAS (R$59,90/mês)
//   - Duo Mensal   → STRIPE_PRICE_DUO_MONTHLY   (R$89,90/mês · titles+legendas)
//   - Duo Anual    → STRIPE_PRICE_DUO_YEARLY    (R$838,80/ano)
// Compat: variáveis antigas (STRIPE_PRICE_YEARLY, STRIPE_PRICE_LIFETIME,
// STRIPE_PRICE_SOLO_MONTHLY) continuam sendo lidas como fallback secundário.
const FALLBACK_PRICES = {
    titles: {
        monthly:  process.env.STRIPE_PRICE_SOLO_TITLES || process.env.STRIPE_PRICE_SOLO_MONTHLY || null,
        yearly:   process.env.STRIPE_PRICE_YEARLY    || null,
        lifetime: process.env.STRIPE_PRICE_LIFETIME  || null
    },
    legendas: {
        monthly:  process.env.STRIPE_PRICE_SOLO_LEGENDAS || process.env.STRIPE_PRICE_SOLO_MONTHLY || null
    },
    duo: {
        monthly:  process.env.STRIPE_PRICE_DUO_MONTHLY || null,
        yearly:   process.env.STRIPE_PRICE_DUO_YEARLY  || null
    }
};

const PUBLIC_URL = process.env.PUBLIC_URL || "https://motionpro-lp.vercel.app";

// Busca price_id do produto+plano no banco
async function getStripePriceId(productId, plan) {
    // Normaliza pra canônico antes de bater no DB (DB tem product_id canônico
    // pra registros recentes >= 2026-05-01; antigos têm alias). Tenta ambos.
    const canonical = normalizeProductId(productId);
    const candidates = canonical && canonical !== productId
        ? [canonical, productId]
        : [productId];
    try {
        const r = await pool.query(
            "SELECT stripe_price_id FROM product_prices WHERE product_id = ANY($1) AND plan=$2 AND is_active=true LIMIT 1",
            [candidates, plan]
        );
        if (r.rowCount) return r.rows[0].stripe_price_id;
    } catch (_) {}
    return FALLBACK_PRICES[canonical]?.[plan] || null;
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
    // Fallback: varre TODAS as combinações (titles/legendas/duo) × planos
    for (const [productId, plans] of Object.entries(FALLBACK_PRICES)) {
        for (const [plan, pid] of Object.entries(plans)) {
            if (pid && pid === priceId) return { product_id: productId, plan };
        }
    }
    // Default seguro
    return { product_id: "titles", plan: "yearly" };
}

// ============================================================
// CHECKOUT — PÚBLICO (não precisa estar logado)
// Stripe coleta o e-mail e dados de pagamento; após pagar,
// o webhook cria a conta e manda o welcome com credenciais.
// ============================================================
router.post("/checkout", async (req, res, next) => {
    try {
        const plan = (req.query.plan || req.body?.plan || "yearly").toLowerCase();
        const product_id = (req.query.product || req.body?.product || "titles").toLowerCase();
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

// Race-safe via INSERT ... ON CONFLICT (email) DO UPDATE RETURNING.
// xmax=0 ⇨ linha foi INSERIDA agora (não atualizada) — usamos isso pra
// saber se devemos retornar a senha temporária pro welcome email.
async function findOrCreateUser({ email, stripeCustomerId }) {
    if (!email) return null;
    const norm = email.toLowerCase().trim();
    const plain = genTempPassword();
    const hash = await bcrypt.hash(plain, 12);
    const r = await pool.query(
        `INSERT INTO users(email, password_hash, stripe_customer)
              VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE
              SET stripe_customer = COALESCE(users.stripe_customer, EXCLUDED.stripe_customer)
         RETURNING id, email, (xmax = 0) AS created`,
        [norm, hash, stripeCustomerId || null]
    );
    const row = r.rows[0];
    return {
        user: { id: row.id, email: row.email },
        created: row.created,
        plainPassword: row.created ? plain : null
    };
}

// ============================================================
// Lifecycle helpers — sync entre Stripe sub e license_keys
// ============================================================

// Renova a expires_at das license_keys ativas associadas ao customer_email,
// quando a subscription Stripe renova (current_period_end → futuro).
// Lifetime keys (expires_at IS NULL) NÃO são tocadas.
async function renewLicensesForUser({ email, periodEnd, stripeSubId, productId }) {
    if (!email || !periodEnd) return { updated: 0 };
    const canonical = (productId && require("../utils/product-aliases").normalizeProductId(productId)) || null;
    // Filtra por products[] do canonical OU produtos bundle que cobrem ele
    const r = await pool.query(
        `UPDATE license_keys
            SET expires_at = $1
          WHERE LOWER(customer_email) = LOWER($2)
            AND revoked_at IS NULL
            AND expires_at IS NOT NULL
            AND ($3::text IS NULL OR products && ARRAY[$3]::text[]
                 OR products && ARRAY['suite','duo']::text[])
            AND expires_at < $1
       RETURNING id, key_prefix, products, expires_at`,
        [periodEnd, email, canonical]
    );
    if (r.rowCount > 0) {
        const userR = await pool.query("SELECT id FROM users WHERE LOWER(email)=LOWER($1)", [email]);
        const uid = userR.rows[0]?.id || null;
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'license_renewed_from_stripe', $2)",
            [uid, {
                stripe_sub_id: stripeSubId,
                product_id: canonical,
                new_expires_at: periodEnd,
                renewed_keys: r.rows.map(x => x.key_prefix)
            }]
        );
        console.log("[webhook] renovou", r.rowCount, "license_keys de", email, "→", periodEnd);
    }
    return { updated: r.rowCount, rows: r.rows };
}

// Revoga license_keys + deactiva activations associadas ao customer_email.
// Usado em subscription.deleted e em payment_failed após dunning.
async function revokeLicensesForUser({ email, reason, stripeSubId, productId }) {
    if (!email) return { revoked: 0 };
    const canonical = (productId && require("../utils/product-aliases").normalizeProductId(productId)) || null;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const r = await client.query(
            `UPDATE license_keys
                SET revoked_at = now(), revoke_reason = $1
              WHERE LOWER(customer_email) = LOWER($2)
                AND revoked_at IS NULL
                AND ($3::text IS NULL OR products && ARRAY[$3]::text[]
                     OR products && ARRAY['suite','duo']::text[])
           RETURNING id, key_prefix, products`,
        [reason, email, canonical]
        );
        if (r.rowCount > 0) {
            const ids = r.rows.map(x => x.id);
            await client.query(
                `UPDATE license_key_activations
                    SET deactivated_at = now()
                  WHERE license_key_id = ANY($1::uuid[])
                    AND deactivated_at IS NULL`,
                [ids]
            );
            const userR = await client.query("SELECT id FROM users WHERE LOWER(email)=LOWER($1)", [email]);
            const uid = userR.rows[0]?.id || null;
            await client.query(
                "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'license_auto_revoked', $2)",
                [uid, {
                    reason, stripe_sub_id: stripeSubId,
                    product_id: canonical,
                    revoked_keys: r.rows.map(x => x.key_prefix)
                }]
            );
        }
        await client.query("COMMIT");
        return { revoked: r.rowCount, rows: r.rows };
    } catch (e) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw e;
    } finally {
        client.release();
    }
}

async function upsertSubscription({ userId, productId, plan, status, stripeSubId, periodEnd, cancelAt }) {
    const product = normalizeProductId(productId) || "titles";
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
                const product_id = cs.metadata?.product_id || "titles";

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

                // ─── Gera license key automaticamente conforme o produto ───
                //   ia       → MIA-…  (Motion IA)
                //   titles   → MTI-…  (Motion Titles)
                //   legendas → MTL-…  (Motion Legendas)
                //   suite    → MTS-…  (Bundle: cobre titles+legendas+ia)
                //
                // CRÍTICO (C2 + C3 + C4):
                //   - INSERT license_keys + license_audit em transação atômica.
                //   - SELECT prévio por notes='stripe-auto-<cs.id>' impede
                //     duplo-issuance se Stripe re-disparar a session.
                //   - Se a transação falhar, RELANÇAMOS a exception — o catch
                //     externo limpa stripe_events_seen pra que Stripe retente.
                //   - Unique index parcial idx_lk_stripe_auto_unique (migration
                //     012) é a defesa-em-profundidade caso o SELECT race.
                const resolved = resolveProduct(product_id);
                let licenseKeyPlaintext = null;
                if (resolved) {
                    const sessionNote = "stripe-auto-" + cs.id;
                    const existing = await pool.query(
                        "SELECT key_prefix FROM license_keys WHERE notes=$1 LIMIT 1",
                        [sessionNote]
                    );
                    if (existing.rowCount > 0) {
                        console.log("[webhook] license key já emitida pra session", cs.id, existing.rows[0].key_prefix);
                        // Pula geração — user já recebeu chave no checkout original.
                        // Welcome email vai sem `miaLicenseKey` (apropriado: era retry).
                    } else {
                        const client = await pool.connect();
                        try {
                            await client.query("BEGIN");
                            const tier = isLifetime ? "lifetime" : (plan === "lifetime" ? "lifetime" : "pro");
                            const candidate = generateLicenseKey(tier, resolved.prefix);
                            const prefix = candidate.slice(0, 14);
                            const hash = await bcrypt.hash(candidate, 10);
                            // Bundle ganha mais devices (5/3); plugin individual: 5 lifetime / 3 pro
                            const maxDevices = tier === "lifetime" ? 5 : 3;
                            const expiresAt = (tier === "lifetime") ? null
                                : (periodEnd || new Date(Date.now() + 365 * 24 * 3600 * 1000));
                            await client.query(
                                `INSERT INTO license_keys
                                 (key_hash, key_prefix, tier, products, max_devices, expires_at, notes, customer_email, issued_by)
                                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                                [hash, prefix, tier, resolved.products, maxDevices, expiresAt,
                                 sessionNote, user.email, null]
                            );
                            await client.query(
                                "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'license_key_auto_issued', $2)",
                                [user.id, {
                                    tier, key_prefix: prefix, prefix_type: resolved.prefix,
                                    products: resolved.products, stripe_session: cs.id
                                }]
                            );
                            await client.query("COMMIT");
                            licenseKeyPlaintext = candidate;
                            console.log("[webhook]", resolved.prefix, "license key generated for", user.email, prefix);
                        } catch (e) {
                            try { await client.query("ROLLBACK"); } catch (_) {}
                            console.error("[webhook] license key TX failed — relançando pra Stripe retentar:", e.message);
                            throw e;   // → catch externo → limpa stripe_events_seen → Stripe retenta
                        } finally {
                            client.release();
                        }
                    }
                }

                // Manda welcome (com senha temporária se foi criado agora)
                const productName = resolved ? resolved.name : "Motion Titles";
                const downloadUrl = PUBLIC_URL + (resolved ? resolved.download : "/download.html");
                const passwordToSend = plainPassword || "(use a senha que você já tem cadastrada)";
                try {
                    await welcomeEmail({
                        email: user.email,
                        password: passwordToSend,
                        plan,
                        productName,
                        downloadUrl,
                        // Chave canônica — qualquer prefix (MTI/MTL/MIA/MTS).
                        licenseKey: licenseKeyPlaintext
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
                const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
                await upsertSubscription({
                    userId: userR.rows[0].id,
                    productId: pp.product_id,
                    plan: pp.plan,
                    status: sub.status,
                    stripeSubId: sub.id,
                    periodEnd,
                    cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null
                });
                // Auto-renew license: estende expires_at se sub ativa + period futuro
                if (periodEnd && ["active", "trialing"].includes(sub.status)) {
                    try {
                        await renewLicensesForUser({
                            email: userR.rows[0].email,
                            periodEnd,
                            stripeSubId: sub.id,
                            productId: pp.product_id
                        });
                    } catch (e) {
                        console.error("[webhook] renewLicenses fail", e.message);
                        throw e;   // → catch externo limpa events_seen → Stripe retenta
                    }
                }
                break;
            }

            // -------- ASSINATURA CANCELADA (revoga license) --------
            case "customer.subscription.deleted": {
                const sub = event.data.object;
                const customerId = sub.customer;
                await pool.query(
                    "UPDATE subscriptions SET status='canceled', updated_at=now() WHERE stripe_sub_id=$1",
                    [sub.id]
                );
                const userR = await pool.query("SELECT id, email FROM users WHERE stripe_customer=$1", [customerId]);
                if (userR.rowCount) {
                    const priceId = sub.items?.data?.[0]?.price?.id;
                    const pp = await planAndProductFromPriceId(priceId);
                    try {
                        const result = await revokeLicensesForUser({
                            email: userR.rows[0].email,
                            reason: "subscription_cancelled",
                            stripeSubId: sub.id,
                            productId: pp.product_id
                        });
                        if (result.revoked > 0) {
                            // Manda email só se houve revoke real (não spamma se já estava revogado)
                            await subscriptionSuspendedEmail({
                                email: userR.rows[0].email,
                                productName: require("../utils/product-aliases")
                                    .resolveProduct(pp.product_id)?.name || "Motion Suite",
                                retryUrl: PUBLIC_URL + "/account.html"
                            }).catch(e => console.error("[webhook] suspended email fail", e.message));
                        }
                    } catch (e) {
                        console.error("[webhook] revokeLicenses fail", e.message);
                        throw e;
                    }
                }
                break;
            }

            // -------- PAGAMENTO FALHOU (dunning + revoga após N retries) --------
            case "invoice.payment_failed": {
                const inv = event.data.object;
                const customerId = inv.customer;
                const attempt = Number(inv.attempt_count || 0);
                const userR = await pool.query("SELECT id, email FROM users WHERE stripe_customer=$1", [customerId]);
                if (!userR.rowCount) break;
                await pool.query(
                    "UPDATE subscriptions SET status='past_due', updated_at=now() WHERE user_id=$1 AND status='active'",
                    [userR.rows[0].id]
                );
                // attempt_count >= 4 ⇨ Stripe esgotou os retries do dunning (~8 dias).
                // Revoga licenças associadas pra cortar acesso.
                if (attempt >= 4) {
                    try {
                        const subId = inv.subscription || null;
                        const productId = (await planAndProductFromPriceId(
                            inv.lines?.data?.[0]?.price?.id
                        ))?.product_id;
                        const result = await revokeLicensesForUser({
                            email: userR.rows[0].email,
                            reason: `payment_failed_after_${attempt}_attempts`,
                            stripeSubId: subId,
                            productId
                        });
                        if (result.revoked > 0) {
                            await subscriptionSuspendedEmail({
                                email: userR.rows[0].email,
                                productName: require("../utils/product-aliases")
                                    .resolveProduct(productId)?.name || "Motion Suite",
                                retryUrl: PUBLIC_URL + "/account.html"
                            }).catch(e => console.error("[webhook] suspended email fail", e.message));
                        }
                    } catch (e) {
                        console.error("[webhook] dunning revoke fail", e.message);
                        throw e;
                    }
                } else {
                    // Ainda em retry — só notifica
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
        // CRÍTICO: handler falhou DEPOIS do INSERT em stripe_events_seen.
        // Limpa o registro pra que Stripe retente esse mesmo event_id —
        // senão evento fica permanentemente perdido.
        console.error("[webhook handler error]", e);
        try {
            await pool.query("DELETE FROM stripe_events_seen WHERE event_id=$1", [event.id]);
            console.warn("[webhook] event", event.id, "removido de stripe_events_seen pra retry Stripe");
        } catch (cleanupErr) {
            console.error("[webhook] cleanup stripe_events_seen falhou:", cleanupErr.message);
        }
        res.status(500).send("err");
    }
}

module.exports = { router, webhook };
