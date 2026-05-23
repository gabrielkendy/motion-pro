/* license-gate.js — Motion IA · ζ
 *
 * Gate de licença: checa via /v1/me/products + /v1/me, popula MvLicenseCache,
 * mostra paywall overlay quando inválido.
 *
 * Regras de aceite:
 *   - products[] contém "ia" OU "duo" OR "suite" OR "bundle_all"  → libera
 *   - is_admin === true                                            → libera
 *   - lifetime_until > now                                         → libera
 *   - Caso contrário ou erro → cache age > 30d → paywall
 *                                                  cache válido → libera (sticky)
 *
 * Eventos consumidos:
 *   - mv:license-revoked  → showPaywall
 *   - mv:tab-change       → re-check
 *
 * Anti-pattern: NÃO bypassa cache pra admin — sempre re-verifica via API,
 * mas confia no flag is_admin retornado pelo backend (não no localStorage).
 */
(function (global) {
    "use strict";

    var ACCEPTED_PRODUCTS = ["ia", "duo", "suite", "bundle_all"];
    var OVERLAY_ID = "mvia-license-paywall";
    var CHECKOUT_BASE = "https://motionpro.vercel.app/checkout";
    var CHECKOUT_SKU  = "motion_ia_monthly";

    function getApi() { return global.MvApi && global.MvApi.api; }
    function getCache() { return global.MvLicenseCache; }

    function productsIncludeIa(products) {
        if (!products || !products.length) return false;
        for (var i = 0; i < products.length; i++) {
            var p = String(products[i] || "").toLowerCase();
            for (var j = 0; j < ACCEPTED_PRODUCTS.length; j++) {
                if (p === ACCEPTED_PRODUCTS[j]) return true;
            }
        }
        return false;
    }

    function check() {
        var api = getApi();
        var cache = getCache();
        if (!api) {
            // Sem API loader → confia no cache se válido
            var hit = cache && cache.coversIa() && cache.isCacheValid();
            return Promise.resolve(!!hit);
        }
        // 1) GET /v1/me/products
        return api("/v1/me/products", { timeoutMs: 10000 }).then(function (rProducts) {
            // 2) GET /v1/me (em paralelo idealmente, mas mantemos sequencial pra simplicidade)
            return api("/v1/me", { timeoutMs: 10000 }).then(function (rMe) {
                var products = [];
                var lifetimeUntil = null;
                var isAdmin = false;

                if (rProducts && rProducts.ok && rProducts.json) {
                    products = rProducts.json.products
                            || (rProducts.json.product_id ? [rProducts.json.product_id] : [])
                            || [];
                }
                if (rMe && rMe.ok && rMe.json) {
                    var meBody = rMe.json.user || rMe.json;
                    isAdmin       = !!meBody.is_admin;
                    lifetimeUntil = meBody.lifetime_until || meBody.lifetime_expires_at || null;
                }

                var nowMs = Date.now();
                var lifetimeOk = lifetimeUntil && new Date(lifetimeUntil).getTime() > nowMs;
                var productsOk = productsIncludeIa(products);
                var allowed    = isAdmin || lifetimeOk || productsOk;

                // Persiste cache (mesmo se NÃO allowed — pra diagnostics rápido)
                if (cache) {
                    cache.setCache({
                        products:     products,
                        expires_at:   lifetimeUntil,
                        allowed_skus: ACCEPTED_PRODUCTS,
                        is_admin:     isAdmin,
                        lifetime:     !!lifetimeOk
                    });
                }

                if (allowed) {
                    hidePaywall();
                    return true;
                }
                // Não autorizado, mas cache ainda fresco? Sticky 30d
                if (cache && cache.isCacheValid() && cache.coversIa()) {
                    return true;
                }
                showPaywall();
                return false;
            });
        }).catch(function (err) {
            console.warn("[mvia-license-gate] check failed:", (err && err.message) || err);
            // Fallback sticky 30d
            if (cache && cache.isCacheValid() && cache.coversIa()) return true;
            showPaywall();
            return false;
        });
    }

    // ── Paywall overlay ─────────────────────────────────────────────────
    function ensureStyles() {
        if (document.getElementById("mvia-license-gate-styles")) return;
        var css = "" +
        "#" + OVERLAY_ID + "{position:fixed;inset:0;z-index:99999;background:rgba(8,10,14,.93);" +
        "  backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;" +
        "  font-family:'Inter','Segoe UI',sans-serif;color:#e5e7eb}" +
        "#" + OVERLAY_ID + ".hidden{display:none}" +
        "#" + OVERLAY_ID + " .mvia-pw__card{background:#12141a;border:1px solid #2a2f3a;border-radius:16px;" +
        "  padding:32px;max-width:420px;width:calc(100% - 40px);box-shadow:0 24px 64px rgba(0,0,0,.6);text-align:center}" +
        "#" + OVERLAY_ID + " .mvia-pw__title{font-size:20px;font-weight:700;margin:0 0 8px;color:#fff}" +
        "#" + OVERLAY_ID + " .mvia-pw__msg{font-size:13px;color:#9ca3af;margin:0 0 24px;line-height:1.5}" +
        "#" + OVERLAY_ID + " .mvia-pw__cta{display:inline-block;background:linear-gradient(135deg,#2563eb,#7c3aed);" +
        "  color:#fff;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px;border:0;cursor:pointer;" +
        "  text-decoration:none}" +
        "#" + OVERLAY_ID + " .mvia-pw__cta:hover{filter:brightness(1.1)}" +
        "#" + OVERLAY_ID + " .mvia-pw__link{display:block;margin-top:14px;font-size:12px;color:#6b7280;" +
        "  text-decoration:underline;cursor:pointer;background:none;border:0}";
        var st = document.createElement("style");
        st.id = "mvia-license-gate-styles";
        st.textContent = css;
        document.head.appendChild(st);
    }

    function openInBrowser(url) {
        try { new CSInterface().openURLInDefaultBrowser(url); return; } catch (_) {}
        try { window.cep.util.openURLInDefaultBrowser(url); return; } catch (_) {}
        try { window.open(url, "_blank"); return; } catch (_) {}
    }

    function showPaywall() {
        ensureStyles();
        var ov = document.getElementById(OVERLAY_ID);
        if (!ov) {
            ov = document.createElement("div");
            ov.id = OVERLAY_ID;
            ov.innerHTML =
                '<div class="mvia-pw__card">' +
                '  <h2 class="mvia-pw__title">Renove o Motion IA pra continuar</h2>' +
                '  <p class="mvia-pw__msg">Sua assinatura expirou ou não cobre o Motion IA. ' +
                '     Reative em segundos pra continuar usando os agentes, skills e gerador de motion.</p>' +
                '  <button type="button" class="mvia-pw__cta" data-action="checkout">Assinar Motion IA · R$ 49/mês</button>' +
                '  <button type="button" class="mvia-pw__link" data-action="reconnect">Já tem assinatura? Reconectar</button>' +
                '</div>';
            document.body.appendChild(ov);
            ov.addEventListener("click", function (e) {
                var btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
                if (!btn) return;
                var action = btn.getAttribute("data-action");
                if (action === "checkout") {
                    var url = CHECKOUT_BASE + "?sku=" + encodeURIComponent(CHECKOUT_SKU) + "&return=cep";
                    openInBrowser(url);
                } else if (action === "reconnect") {
                    // Re-roda check pra forçar re-validação após user reativar no browser
                    try { document.dispatchEvent(new CustomEvent("mv:license-recheck")); } catch (_) {}
                    check();
                }
            });
        }
        ov.classList.remove("hidden");
    }

    function hidePaywall() {
        var ov = document.getElementById(OVERLAY_ID);
        if (ov) ov.classList.add("hidden");
    }

    // Listeners
    document.addEventListener("mv:license-revoked", function () { showPaywall(); });
    document.addEventListener("mv:tab-change", function () { check(); });

    global.MvLicenseGate = {
        check:       check,
        showPaywall: showPaywall,
        hidePaywall: hidePaywall,
        ACCEPTED_PRODUCTS: ACCEPTED_PRODUCTS
    };
})(typeof window !== "undefined" ? window : globalThis);
