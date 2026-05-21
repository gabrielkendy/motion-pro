"use strict";
/**
 * Tabela canônica de produtos + aliases legacy do Motion Suite.
 *
 * Source-of-truth pro mapping product_id → { prefix, products[], name,
 * download }. Antes desse módulo, a mesma tabela vivia duplicada em:
 *   - backend/src/routes/billing.js   (resolveProduct + FALLBACK_PRICES)
 *   - backend/src/routes/license-keys.js  (ALIASES no /activate)
 *   - backend/src/routes/oauth.js     (aliases no normalizePlugin)
 *   - landing/oauth-bridge.html       (cópia client-side; mantida em sync)
 *
 * Qualquer mudança de produto/alias passa POR AQUI.
 */

// ─── IDs canônicos suportados ───────────────────────────────────
const CANONICAL_IDS = ["titles", "legendas", "ia", "suite"];

// ─── Aliases legacy → canônico ──────────────────────────────────
// Chaves sempre lowercased (caller deve normalizar antes de consultar).
const ALIASES = Object.freeze({
    // Motion Titles
    "motionpro":       "titles",
    "motion titles":   "titles",
    "motion_titles":   "titles",
    // Motion Legendas
    "motion_legendas": "legendas",
    // Motion IA
    "motionia":        "ia",
    "motion_ia":       "ia",
    // Bundle Motion Suite
    "bundle_all":      "suite",
    "motion_suite":    "suite"
});

// ─── Metadata por produto canônico ──────────────────────────────
// prefix     → prefixo de license key (MTI/MTL/MIA/MTS)
// products[] → lista de plugins cobertos (bundle MTS- cobre 3)
// name       → display name (welcome email, bridge OAuth, audit log)
// download   → path relativo na landing
const PRODUCT_META = Object.freeze({
    titles: {
        prefix: "MTI",
        products: ["titles"],
        name: "Motion Titles",
        download: "/download.html"
    },
    legendas: {
        prefix: "MTL",
        products: ["legendas"],
        name: "Motion Legendas",
        download: "/legendas/download.html"
    },
    ia: {
        prefix: "MIA",
        products: ["ia"],
        name: "Motion IA",
        download: "/ia/download.html"
    },
    suite: {
        prefix: "MTS",
        products: ["titles", "legendas", "ia"],
        name: "Motion Suite",
        download: "/download.html"
    }
});

/**
 * Resolve alias → id canônico. Retorna null se input não casa nada.
 * Aceita string ou null/undefined.
 */
function normalizeProductId(input) {
    if (!input) return null;
    const v = String(input).toLowerCase().trim();
    if (CANONICAL_IDS.includes(v)) return v;
    return ALIASES[v] || null;
}

/**
 * Mesmo que normalizeProductId, mas pro contexto de "plugin" (OAuth,
 * /me/products). Alias do anterior pra deixar o site call-site claro.
 */
function normalizePlugin(input) {
    return normalizeProductId(input);
}

/**
 * Resolve product_id (canônico ou alias) → metadata completa
 * { prefix, products[], name, download }. Retorna null se não casa.
 *
 * Usado pelo webhook Stripe pra decidir qual prefix gerar e qual
 * nome/download mandar no welcome email.
 */
function resolveProduct(productId) {
    const canonical = normalizeProductId(productId);
    if (!canonical) return null;
    const meta = PRODUCT_META[canonical];
    if (!meta) return null;
    // Retorna cópia rasa pra caller não mexer no congelado
    return {
        id: canonical,
        prefix: meta.prefix,
        products: meta.products.slice(),
        name: meta.name,
        download: meta.download
    };
}

/**
 * Expande um array de products[] de uma license_key, resolvendo
 * aliases e "suite" → ["titles","legendas","ia"]. Garante que o
 * caller (ex: /v1/me/products, validação no activate) sempre
 * compara contra ids canônicos.
 */
function expandProducts(productsArr) {
    if (!Array.isArray(productsArr)) return [];
    const out = new Set();
    for (const raw of productsArr) {
        const canonical = normalizeProductId(raw);
        if (!canonical) continue;
        if (canonical === "suite") {
            for (const p of PRODUCT_META.suite.products) out.add(p);
        } else {
            out.add(canonical);
        }
    }
    return Array.from(out);
}

module.exports = {
    CANONICAL_IDS,
    ALIASES,
    PRODUCT_META,
    normalizeProductId,
    normalizePlugin,
    resolveProduct,
    expandProducts
};
