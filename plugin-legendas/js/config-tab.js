/* config-tab.js — Motion Legendas
 *
 * Tab "⚙ Config" do plugin:
 *   - Renderiza License Card com info do LicenseCache
 *   - Bind Ativar / Revalidar / Desativar / Comprar / Logout
 *   - Atualiza sessão (email) ao logar
 *   - Cross-sell card (Chunk 8 ativa quando user tem MTS-)
 *
 * Isolado em arquivo próprio pra não poluir main.js — Estilo Global
 * e modo 1-palavra ficam intocados.
 */
(function () {
    "use strict";

    function $(id) { return document.getElementById(id); }

    var BUY_URL = (window.MV_CONFIG && window.MV_CONFIG.pricingUrl)
               || "https://motionpro-lp.vercel.app/legendas/#pricing";

    // ── Helpers UI ───────────────────────────────────────────────────
    function setText(id, t) { var el = $(id); if (el) el.textContent = (t == null || t === "") ? "—" : t; }
    function setMsg(text, kind) {
        var el = $("lic-msg"); if (!el) return;
        el.textContent = text || "";
        el.className = "gate__msg" + (kind ? " " + kind : "");
        el.style.textAlign = "left";
        el.style.fontFamily = "'JetBrains Mono',Consolas,monospace";
        el.style.fontSize = "11px";
    }
    function fmtDate(iso) {
        if (!iso) return "—";
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return iso;
            return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
        } catch (_) { return iso; }
    }
    function tierLabel(tier) {
        switch ((tier || "").toLowerCase()) {
            case "free":     return "Free";
            case "basic":    return "Basic";
            case "pro":      return "Pro";
            case "lifetime": return "Lifetime";
            default: return tier || "—";
        }
    }
    function productsLabel(products, isBundle) {
        if (!products || !products.length) return "—";
        var names = {
            "titles":   "Motion Titles",
            "legendas": "Motion Legendas",
            "ia":       "Motion IA",
            "suite":    "Motion Suite"
        };
        var mapped = products.map(function (p) { return names[p] || p; });
        if (isBundle) return mapped.join(" + ") + "  (Bundle)";
        return mapped.join(" + ");
    }

    // ── Render do License Card ───────────────────────────────────────
    function renderLicenseCard() {
        var card = $("lic-card");
        var info = (window.LicenseCache && window.LicenseCache.info) ? window.LicenseCache.info() : { status: "not_activated" };

        var statusEl = $("lic-status");
        if (statusEl) {
            statusEl.className = "license-card__status";
            var label = "Não ativada";
            var cls = "inactive";
            if (info.status === "active") {
                if (info.offline_valid) { label = "Ativa"; cls = "active"; }
                else { label = "Revalidar"; cls = "expired"; }
            } else if (info.status === "expired") { label = "Expirada"; cls = "expired"; }
            else if (info.status === "revoked") { label = "Revogada"; cls = "revoked"; }
            else if (info.status === "suspended") { label = "Suspensa"; cls = "suspended"; }
            else if (info.status === "not_activated") { label = "Não ativada"; cls = "inactive"; }
            statusEl.textContent = label;
            statusEl.classList.add(cls);
            if (card) {
                card.className = "license-card " + cls;
            }
        }

        setText("lic-key", info.masked_key || "—");
        setText("lic-tier", tierLabel(info.tier));
        setText("lic-product", productsLabel(info.products, info.covers_via_bundle));
        if (info.max_devices) {
            setText("lic-devices", "1 / " + info.max_devices);
        } else {
            setText("lic-devices", "—");
        }
        setText("lic-validated", fmtDate(info.last_validation));

        // Cross-sell hook (Chunk 8 monta o conteúdo dependendo do estado)
        if (typeof window.MPL_renderCrossSell === "function") {
            try { window.MPL_renderCrossSell(info); } catch (_) {}
        }
    }

    // ── Sessão (email + logout) ──────────────────────────────────────
    function renderSession() {
        var email = (window.localStorage && localStorage.getItem("mv_email")) || "—";
        setText("sess-email", email);
    }

    // ── Handlers ─────────────────────────────────────────────────────
    function onActivate() {
        var input = $("lic-input");
        var key = (input && input.value || "").trim().toUpperCase();
        if (!key) { setMsg("Cole a chave que recebeu por e-mail.", "err"); return; }
        if (!window.LicenseClient) { setMsg("LicenseClient não carregado", "err"); return; }

        var btn = $("lic-activate");
        if (btn) { btn.classList.add("loading"); btn.disabled = true; }
        setMsg("Ativando…");
        window.LicenseClient.activate(key)
            .then(function (resp) {
                setMsg("✓ Licença ativada com sucesso.", "ok");
                if (input) input.value = "";
                renderLicenseCard();
                // Notifica tier-gating (Chunk 6) pra re-renderizar botões
                if (window.MPL_Features && typeof window.MPL_Features.refresh === "function") {
                    try { window.MPL_Features.refresh(); } catch (_) {}
                }
                // Esconde paywall se estiver visível
                var pw = $("paywall"); if (pw) pw.classList.add("hidden");
                // Inicia auto-validate 24h
                if (window.LicenseClient.startAutoValidate) {
                    window.LicenseClient.startAutoValidate(24);
                }
            })
            .catch(function (e) {
                var msg = (e && e.message) || String(e);
                if (e && e.data && e.data.error) msg = e.data.error;
                setMsg("✗ Falha: " + msg, "err");
                renderLicenseCard();
            })
            .then(function () {
                if (btn) { btn.classList.remove("loading"); btn.disabled = false; }
            });
    }

    function onValidate() {
        if (!window.LicenseClient) { setMsg("LicenseClient não carregado", "err"); return; }
        var btn = $("lic-validate");
        if (btn) { btn.classList.add("loading"); btn.disabled = true; }
        setMsg("Revalidando online…");
        window.LicenseClient.validate({ silent: false })
            .then(function (resp) {
                if (resp.active) setMsg("✓ Licença confirmada.", "ok");
                else setMsg("✗ Licença inválida: " + (resp.error || "unknown"), "err");
                renderLicenseCard();
                if (window.MPL_Features && typeof window.MPL_Features.refresh === "function") {
                    try { window.MPL_Features.refresh(); } catch (_) {}
                }
            })
            .catch(function (e) {
                setMsg("✗ Erro de revalidação: " + (e.message || e), "err");
            })
            .then(function () {
                if (btn) { btn.classList.remove("loading"); btn.disabled = false; }
            });
    }

    function onDeactivate() {
        if (!window.LicenseClient) { setMsg("LicenseClient não carregado", "err"); return; }
        if (!confirm("Tem certeza que quer desativar a licença deste device?\nUm slot ficará livre na sua conta.")) return;
        var btn = $("lic-deactivate");
        if (btn) { btn.classList.add("loading"); btn.disabled = true; }
        setMsg("Desativando…");
        window.LicenseClient.deactivate()
            .then(function (resp) {
                setMsg("✓ Device desativado.", "ok");
                renderLicenseCard();
                if (window.MPL_Features && typeof window.MPL_Features.refresh === "function") {
                    try { window.MPL_Features.refresh(); } catch (_) {}
                }
            })
            .catch(function (e) {
                setMsg("✗ Erro: " + (e.message || e), "err");
            })
            .then(function () {
                if (btn) { btn.classList.remove("loading"); btn.disabled = false; }
            });
    }

    function onBuy() {
        var open = (window.Auth && window.Auth.openInBrowser) || function (u) { window.open(u, "_blank"); };
        open(BUY_URL);
    }

    function onLogout() {
        if (!confirm("Sair da conta? A licença local NÃO será desativada — pra isso use \"Desativar\".")) return;
        if (window.Auth && typeof window.Auth.logout === "function") {
            window.Auth.logout();
        } else {
            // Fallback
            ["mv_session", "mv_email", "mv_name", "mpl_session", "mpl_email", "mpl_name"]
                .forEach(function (k) { localStorage.removeItem(k); });
            location.reload();
        }
    }

    // ── Bind tudo (DOM ready ou já carregado) ────────────────────────
    function bind() {
        if ($("lic-activate"))   $("lic-activate").onclick   = onActivate;
        if ($("lic-validate"))   $("lic-validate").onclick   = onValidate;
        if ($("lic-deactivate")) $("lic-deactivate").onclick = onDeactivate;
        if ($("lic-buy"))        $("lic-buy").onclick        = onBuy;
        if ($("sess-logout"))    $("sess-logout").onclick    = onLogout;

        // Enter no input ativa
        if ($("lic-input")) {
            $("lic-input").addEventListener("keydown", function (e) {
                if (e.key === "Enter") onActivate();
            });
        }

        renderLicenseCard();
        renderSession();

        // Re-render quando a tab for ativada (caso user mudou de tab e voltou)
        document.querySelectorAll('.tab-btn[data-tab="tab-config"]').forEach(function (b) {
            b.addEventListener("click", function () {
                setTimeout(function () { renderLicenseCard(); renderSession(); }, 50);
            });
        });

        // Re-render quando autenticar
        document.addEventListener("auth:ready", function () {
            renderLicenseCard();
            renderSession();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bind);
    } else { bind(); }

    // Expose pra outros módulos (Chunks 6/7/8)
    window.MPL_Config = {
        renderLicenseCard: renderLicenseCard,
        renderSession:     renderSession,
        BUY_URL:           BUY_URL
    };
})();
