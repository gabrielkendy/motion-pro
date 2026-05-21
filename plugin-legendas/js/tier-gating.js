/* tier-gating.js — Motion Legendas
 *
 * Bloqueia features baseado no tier da licença ativa.
 *
 * Tiers:
 *   - free     → pode VER templates · NÃO pode aplicar nada
 *   - basic    → 1-palavra + 2-palavras (templates wc<=2)
 *   - pro      → TUDO (61 templates, Estilo Global, fontes premium,
 *                SFX, multi-line, distribuição inteligente, Criar)
 *   - lifetime → idêntico a pro
 *
 * Estratégia: event capturing em <body> intercepta cliques nos botões
 * críticos ANTES do onclick handler de main.js executar. Se tier
 * insuficiente, preventDefault + stopImmediatePropagation + mostra
 * paywall. Caso contrário deixa main.js rodar normal.
 *
 * Isolado em arquivo próprio — NÃO toca main.js (preserva Estilo
 * Global v4.25.1 e modo 1-palavra estável).
 */
(function () {
    "use strict";

    function $(id) { return document.getElementById(id); }

    // ── Tier resolution ─────────────────────────────────────────────
    function getTier() {
        // 1. Admin verificado pelo backend → lifetime (sem precisar key)
        try {
            var meta = JSON.parse(localStorage.getItem("mtl_user_meta") || "{}");
            if (meta.is_admin_verified) return "lifetime";
        } catch (_) {}

        // 2. LicenseCache offline-valid → tier dele
        if (window.LicenseCache && window.LicenseCache.isValidForOfflineUse && window.LicenseCache.isValidForOfflineUse()) {
            var info = window.LicenseCache.info();
            if (info && info.tier) return info.tier;
        }

        // 3. Trial/subscription do backend
        var plan = localStorage.getItem("mtl_plan") || "";
        var status = localStorage.getItem("mtl_status") || "";
        if (plan === "lifetime") return "lifetime";
        if (plan === "yearly" || plan === "pro") return "pro";
        if (plan === "basic") return "basic";
        if ((plan === "trial" || status === "trialing")) return "pro"; // trial = acesso Pro durante 7d

        return "free";
    }

    var TIER_RANK = { free: 0, basic: 1, pro: 2, lifetime: 3 };
    function tierAtLeast(min) {
        return (TIER_RANK[getTier()] || 0) >= (TIER_RANK[min] || 0);
    }

    // ── Contexto da feature ao clicar ───────────────────────────────
    // Retorna { feature, requiredTier, reason }
    function analyzeClick(target) {
        var btn = target.closest('button');
        if (!btn) return null;

        var id = btn.id || "";
        // 1) APLICAR template único do grid (Templates tab)
        if (id === "btn-hybrid-apply-all") {
            var oneword = $("cut-oneword");
            // Single template apply: usuário escolheu UM template
            // wc do template selecionado decide tier mínimo
            var selWc = readSelectedTemplateWc();
            if (selWc != null && selWc <= 2) {
                return { feature: "Aplicar template " + selWc + "p", requiredTier: "basic" };
            }
            return { feature: "Aplicar template (multi-palavras)", requiredTier: "pro" };
        }

        // 2) APLICAR SRT em batch
        if (id === "btn-auto-srt-apply") {
            var ow = $("cut-oneword");
            if (ow && ow.checked) {
                return { feature: "Aplicar SRT (modo 1-palavra)", requiredTier: "basic" };
            }
            return { feature: "Aplicar SRT (multi-palavras)", requiredTier: "pro" };
        }

        // 3) Distribuição inteligente (Pro — usa multi-templates)
        if (id === "btn-srt-smart-dist") {
            return { feature: "Distribuição Inteligente", requiredTier: "pro" };
        }

        // 4) Criar legendas a partir do roteiro
        if (id === "btn-create-srt" || id === "btn-create-apply") {
            return { feature: "Criar legendas (gerar SRT)", requiredTier: "pro" };
        }

        // 5) SFX
        if (id === "btn-sfx-apply-cti" || id === "btn-sfx-apply-all") {
            return { feature: "Aplicar SFX", requiredTier: "pro" };
        }

        return null;
    }

    function readSelectedTemplateWc() {
        // 4.25.1 BUILD: .tpl-card.selected tem child .tpl-card__wc com texto "Np"
        var sel = document.querySelector(".tpl-card.selected");
        if (!sel) return null;
        var wcBadge = sel.querySelector(".tpl-card__wc");
        if (!wcBadge) return null;
        var m = (wcBadge.textContent || "").match(/(\d+)/);
        if (!m) return null;
        var n = parseInt(m[1], 10);
        return isNaN(n) ? null : n;
    }

    // ── Paywall trigger ─────────────────────────────────────────────
    function blockWithPaywall(featureName, requiredTier) {
        var tierNow = getTier();
        var msg = "🔒 " + (featureName || "Esta ação") + " requer " + tierLabel(requiredTier).toUpperCase() +
                  ".\n\nVocê está no plano: " + tierLabel(tierNow).toUpperCase() + ".";
        // Tenta usar toast do main.js se existir
        if (typeof window.toast === "function") {
            try { window.toast(msg, "warn", 5500); } catch (_) {}
        } else {
            console.warn("[tier-gating] blocked:", msg);
        }
        // Mostra paywall fullscreen (refinado no Chunk 7)
        var pw = $("paywall");
        if (pw) {
            var t = pw.querySelector(".paywall__title");
            if (t) t.textContent = featureName + " · " + tierLabel(requiredTier).toUpperCase() + " necessário";
            pw.classList.remove("hidden");
        }
    }

    function tierLabel(t) {
        switch ((t || "").toLowerCase()) {
            case "free":     return "Free";
            case "basic":    return "Basic";
            case "pro":      return "Pro";
            case "lifetime": return "Lifetime";
            default: return t || "—";
        }
    }

    // ── Interceptor (capturing phase) ───────────────────────────────
    function interceptor(e) {
        var ctx = analyzeClick(e.target);
        if (!ctx) return; // não é botão gated, deixa passar

        if (tierAtLeast(ctx.requiredTier)) return; // tier OK, deixa main.js rodar

        // Bloqueia
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        blockWithPaywall(ctx.feature, ctx.requiredTier);
    }

    // ── Tier badge (footer status-bar) ──────────────────────────────
    function renderTierBadge() {
        var bar = document.getElementById("status-bar");
        if (!bar) return;
        var badge = bar.querySelector(".tier-badge");
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "tier-badge";
            badge.style.marginLeft = "10px";
            bar.appendChild(badge);
        }
        var tier = getTier();
        badge.className = "tier-badge " + tier;
        badge.textContent = tierLabel(tier);
    }

    // ── Lock visual nos botões (best-effort, não bloqueante) ────────
    function applyVisualLocks() {
        var btns = [
            "btn-hybrid-apply-all",
            "btn-auto-srt-apply",
            "btn-srt-smart-dist",
            "btn-create-srt",
            "btn-create-apply",
            "btn-sfx-apply-cti",
            "btn-sfx-apply-all"
        ];
        btns.forEach(function (id) {
            var btn = $(id); if (!btn) return;
            // Re-analisa com botão como event.target mocado
            var ctx = analyzeClick(btn);
            if (!ctx) return;
            if (tierAtLeast(ctx.requiredTier)) {
                btn.removeAttribute("data-tier-locked");
                // Remove 🔒 prefix se existir
                if (btn.dataset.tierLockOriginal) {
                    btn.textContent = btn.dataset.tierLockOriginal;
                    delete btn.dataset.tierLockOriginal;
                }
            } else {
                btn.setAttribute("data-tier-locked", ctx.requiredTier);
                // Adiciona 🔒 ao texto se não tiver
                if (!btn.dataset.tierLockOriginal) {
                    btn.dataset.tierLockOriginal = btn.textContent;
                }
                if (btn.textContent.indexOf("🔒") === -1) {
                    btn.textContent = "🔒 " + btn.dataset.tierLockOriginal;
                }
            }
        });
    }

    // ── Refresh API (chamado por config-tab.js + auth.js) ───────────
    function refresh() {
        renderTierBadge();
        applyVisualLocks();
    }

    // ── Init ────────────────────────────────────────────────────────
    function init() {
        document.body.addEventListener("click", interceptor, true); // capturing=true
        refresh();
        // Re-render periódico (caso main.js mude estado de seleção de template)
        setInterval(refresh, 3000);
        document.addEventListener("auth:ready", refresh);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else { init(); }

    // Expose
    window.MPL_Features = {
        getTier:       getTier,
        tierAtLeast:   tierAtLeast,
        canApply:      function (featureCtx) {
            if (!featureCtx || !featureCtx.requiredTier) return true;
            return tierAtLeast(featureCtx.requiredTier);
        },
        refresh:       refresh,
        renderTierBadge: renderTierBadge,
        tierLabel:     tierLabel
    };
})();
