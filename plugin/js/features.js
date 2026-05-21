/* features.js — Motion Titles · tier-gating
 *
 * Fontes de verdade (em ordem de prioridade):
 *   1. mia_user_meta.is_admin_verified === true  → tier "lifetime" (admin)
 *      (Chave compartilhada entre os 3 plugins da Motion Suite.
 *       Admin no Motion IA = admin no Motion Titles.)
 *   2. LicenseCache.info() — tier vindo do backend via /v1/license-keys/*
 *      Cobre os 4 tiers: free / basic / pro / lifetime
 *      Validade requer cache offline OK + products[] incluir "titles"
 *   3. Legacy localStorage.mv_plan (trial/yearly/lifetime) — fallback até
 *      Chunk 6 unificar o heartbeat com o sistema de license-keys novo
 *   4. Default: "free"
 *
 * Regra "basic":
 *   Templates com nome de 1-palavra (heurística split(/\s+/).length === 1).
 *   Cobre ~95% do uso (catálogo majoritário tem nomes multi-palavra).
 *   Pode ser refinado adicionando flag `tier_required` por item no
 *   catalog.json sem mudanças aqui — ver `minTierFor()`.
 */
window.Features = (function () {

    var TIER_RANK = { free: 0, basic: 1, pro: 2, lifetime: 3 };

    function readUserMeta() {
        try { return JSON.parse(localStorage.getItem("mia_user_meta") || "{}"); }
        catch (_) { return {}; }
    }

    // Retorna "free" | "basic" | "pro" | "lifetime"
    function userTier() {
        // (1) admin verificado (qualquer plugin da Suite)
        var meta = readUserMeta();
        if (meta && meta.is_admin_verified) return "lifetime";

        // (2) LicenseCache (sistema novo MTI-/MTS-)
        if (window.LicenseCache && window.LicenseCache.info) {
            var info = window.LicenseCache.info();
            if (info && info.status === "active" && info.offline_valid) {
                var t = (info.tier || "").toLowerCase();
                if (TIER_RANK[t] != null) return t;
            }
        }

        // (3) Legacy mv_plan (trial-bar + paywall do app.js antigo)
        var legacy = (localStorage.getItem("mv_plan") || "").toLowerCase();
        if (legacy === "lifetime" || legacy === "pro_all") return "lifetime";
        if (legacy === "yearly" || legacy === "pro") return "pro";
        if (legacy === "trial" || legacy === "trialing") return "pro"; // trial libera tudo
        if (legacy === "basic") return "basic";

        return "free";
    }

    // Heurística "1-palavra" pra tier basic. Pode evoluir lendo
    // item.tier_required do catalog.json no futuro.
    function minTierFor(item) {
        if (!item) return "free";
        if (item.tier_required) return item.tier_required;
        var name = (item.name || "").trim();
        if (!name) return "pro";
        var words = name.split(/\s+/).filter(function (w) { return w.length > 0; });
        return words.length === 1 ? "basic" : "pro";
    }

    function canImportTemplate(item) {
        var u = userTier();
        if (u === "free") return false;
        var m = minTierFor(item);
        return TIER_RANK[u] >= TIER_RANK[m];
    }

    function tierLabel(t) {
        var n = (t || "free").toUpperCase();
        return n;
    }

    // Atualiza badge de tier no statusbar (substituiu sidebar foot que
    // Motion IA tem — Titles usa layout horizontal).
    function updateUI() {
        var u = userTier();
        var statusBar = document.querySelector(".statusbar");
        if (!statusBar) return;
        var badge = document.getElementById("tier-badge");
        if (!badge) {
            badge = document.createElement("span");
            badge.id = "tier-badge";
            badge.className = "tier-badge";
            statusBar.appendChild(badge);
        }
        badge.className = "tier-badge tier-" + u;
        badge.textContent = "Plano: " + tierLabel(u);
        badge.title = u === "free"
            ? "Sem assinatura ativa — ative uma licença pra importar templates"
            : "Ativo: " + tierLabel(u) + " · clique pra abrir Licença & Config";
        badge.style.cursor = "pointer";
        badge.onclick = function () {
            if (window.LicenseUI && window.LicenseUI.open) window.LicenseUI.open();
        };

        // Aplica/remove .is-locked nos cards visíveis (gate visual + click bloqueado)
        var cards = document.querySelectorAll(".card");
        [].forEach.call(cards, function (c) {
            if (!c._item) return;
            var locked = !canImportTemplate(c._item);
            c.classList.toggle("is-locked", locked);
        });
    }

    function init() {
        updateUI();
        document.addEventListener("license:updated", updateUI);
        document.addEventListener("auth:ready", updateUI);
        // Atualiza quando grid re-renderiza (cards novos)
        document.addEventListener("grid:rendered", updateUI);
    }

    return {
        init:               init,
        userTier:           userTier,
        minTierFor:         minTierFor,
        canImportTemplate:  canImportTemplate,
        updateUI:           updateUI,
        tierLabel:          tierLabel,
        TIER_RANK:          TIER_RANK
    };
})();
