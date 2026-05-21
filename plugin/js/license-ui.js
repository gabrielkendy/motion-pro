/* license-ui.js — Motion Titles
 *
 * Slide-over drawer "Licença & Config" acionado pelo botão ⚙ no headbar.
 * Preserva o layout horizontal de templates por baixo (não vira sidebar).
 *
 * Renderiza:
 *   - License Card (status/chave mascarada/validação/produto/devices/plano)
 *   - Input chave + Ativar / Revalidar / Desativar
 *   - Hint "Comprou pelo site? A chave foi enviada no e-mail."
 *   - Botão Logout (saída explícita)
 *
 * Diagnóstico técnico será adicionado no Chunk 7.
 */
window.LicenseUI = (function () {

    function $(id) { return document.getElementById(id); }

    function ts(iso) {
        if (!iso) return "—";
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return "—";
            return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
        } catch (e) { return iso; }
    }

    function setStatusBadge(el, status) {
        if (!el) return;
        el.className = "license-card__status " + (status || "inactive");
        var label = "Não ativada";
        if (status === "active")    label = "ATIVA";
        if (status === "expired")   label = "Expirada";
        if (status === "revoked")   label = "Revogada";
        if (status === "suspended") label = "Suspensa";
        if (status === "cancelled") label = "Cancelada";
        if (status === "invalid")   label = "Inválida";
        if (status === "wrong_product") label = "Não cobre Titles";
        el.textContent = label;
    }

    // ── CROSS-SELL (Chunk 8) ──────────────────────────────────────────
    var SUITE_PLUGINS = {
        titles:   { name: "Motion Titles",   icon: "🎬", url: "/titles/",                 download: "/titles/#download" },
        legendas: { name: "Motion Legendas", icon: "📝", url: "/legendas/",               download: "/legendas/#download" },
        ia:       { name: "Motion IA",       icon: "🤖", url: "/ia/",                     download: "/ia/download.html" }
    };

    function landing() {
        return (window.Auth && window.Auth.LANDING_URL)
            || (window.MV_CONFIG && window.MV_CONFIG.landingUrl)
            || "https://motionpro-lp.vercel.app";
    }

    function openSuitePlugin(p, mode) {
        var meta = SUITE_PLUGINS[p];
        if (!meta) return;
        var url = landing() + (mode === "download" ? meta.download : meta.url);
        if (window.Auth && window.Auth.openInBrowser) window.Auth.openInBrowser(url);
        else window.open(url, "_blank");
    }

    function renderCrossSell(info, serverProducts) {
        var el = $("cfg-cross-sell");
        if (!el) return;
        // Produtos cobertos pela licença local + pelo /v1/me/products do backend
        var local = (info && info.products) || [];
        var all = local.concat(serverProducts || []);
        var others = all.filter(function (p, i, a) {
            return p && p !== "titles" && SUITE_PLUGINS[p] && a.indexOf(p) === i;
        });

        if (others.length === 0) {
            // Default: cross-sell padrão (não tem outras chaves)
            el.innerHTML =
                '<div class="cross-sell__default">' +
                  'Motion Titles é o <b>Plugin 01</b> da Motion Suite. Conheça também:' +
                  '<div class="cross-sell__row">' +
                    '<a href="#" data-suite-plugin="legendas" class="cross-sell__link">📝 Motion Legendas</a>' +
                    '<a href="#" data-suite-plugin="ia"       class="cross-sell__link">🤖 Motion IA</a>' +
                  '</div>' +
                  '<div class="hint" style="margin-top:10px">' +
                    'Compre o <b>Bundle Motion Suite (MTS-)</b> e libere os 3 plugins com uma chave só.' +
                  '</div>' +
                '</div>';
        } else {
            // User já tem cobertura cross-product — mostra "baixar aqui"
            var rows = others.map(function (p) {
                var m = SUITE_PLUGINS[p];
                return '' +
                  '<div class="cross-sell__owned">' +
                    '<div class="cross-sell__owned-icon">' + m.icon + '</div>' +
                    '<div class="cross-sell__owned-body">' +
                      '<div class="cross-sell__owned-name">' + m.name + '</div>' +
                      '<div class="cross-sell__owned-sub">Você tem direito · ative em outra máquina ou baixe aqui</div>' +
                    '</div>' +
                    '<button class="btn btn--sm" data-suite-plugin="' + p + '" data-suite-mode="download">Baixar</button>' +
                  '</div>';
            }).join("");
            el.innerHTML =
                '<div class="cross-sell__owned-list">' +
                  '<div class="cross-sell__owned-hd">✨ Sua chave cobre outros plugins da Suite:</div>' +
                  rows +
                '</div>';
        }

        // Bind cliques
        [].forEach.call(el.querySelectorAll("[data-suite-plugin]"), function (n) {
            n.onclick = function (e) {
                e.preventDefault();
                openSuitePlugin(n.getAttribute("data-suite-plugin"), n.getAttribute("data-suite-mode") || "info");
            };
        });
    }

    var _userProductsCache = null;
    async function fetchUserProducts() {
        if (_userProductsCache) return _userProductsCache;
        var tok = localStorage.getItem("mv_session");
        if (!tok) return [];
        var apiBase = (window.Auth && window.Auth.API_BASE)
            || (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl)
            || "https://motionpro.vercel.app";
        try {
            var r = await fetch(apiBase + "/v1/me/products", {
                headers: { "Authorization": "Bearer " + tok }
            });
            if (!r.ok) return [];
            var data = await r.json();
            var arr = Array.isArray(data) ? data : (data.products || []);
            _userProductsCache = arr.map(function (x) { return typeof x === "string" ? x : (x && x.product_id) || ""; })
                                    .filter(Boolean);
            return _userProductsCache;
        } catch (_) { return []; }
    }

    function refresh() {
        var card = $("lic-card");
        var info = window.LicenseCache && window.LicenseCache.info
                    ? window.LicenseCache.info()
                    : { status: "not_activated" };

        if (card) {
            card.className = "license-card " +
                (info.status === "active" ? "active" : info.status || "inactive");
        }
        setStatusBadge($("lic-status"), info.status);
        $("lic-key")        && ($("lic-key").textContent       = info.masked_key || "—");
        $("lic-validated")  && ($("lic-validated").textContent = ts(info.last_validation));
        $("lic-tier")       && ($("lic-tier").textContent      = (info.tier || "—").toUpperCase());
        $("lic-product")    && ($("lic-product").textContent   =
            info.products && info.products.length
                ? info.products.join(", ") + (info.via_bundle ? " (bundle MTS-)" : "")
                : "—");
        var devUsed = (info.extras && info.extras.active_devices) || "—";
        var devMax  = info.max_devices || 3;
        $("lic-devices") && ($("lic-devices").textContent = devUsed + " / " + devMax);
        $("lic-expires") && ($("lic-expires").textContent = info.expires_at ? ts(info.expires_at) : "—");

        // Atualiza email no footer drawer
        $("cfg-email") && ($("cfg-email").textContent = localStorage.getItem("mv_email") || "—");

        // Chunk 8: cross-sell baseado em local products + /v1/me/products
        renderCrossSell(info, null); // 1ª passada com info local
        fetchUserProducts().then(function (serverProducts) {
            renderCrossSell(info, serverProducts);
        });

        // Hooks pra outros componentes (status bar do Chunk 7, tier badge do Chunk 5)
        document.dispatchEvent(new CustomEvent("license:updated", { detail: info }));
    }

    function showMsg(text, kind) {
        var el = $("lic-msg"); if (!el) return;
        el.textContent = text;
        el.className = "gate__msg " + (kind || "");
        if (kind === "ok" || kind === "err") {
            setTimeout(function () {
                if (el.textContent === text) { el.textContent = ""; el.className = "gate__msg"; }
            }, 4500);
        }
    }

    function setBusy(btn, busy, busyText) {
        if (!btn) return;
        if (busy) {
            btn.dataset._label = btn.textContent;
            btn.textContent = busyText || "…";
            btn.disabled = true;
        } else {
            if (btn.dataset._label) btn.textContent = btn.dataset._label;
            btn.disabled = false;
        }
    }

    async function onActivate() {
        var inp = $("lic-input");
        var key = (inp && inp.value || "").trim();
        if (!key) { showMsg("Cole sua chave de licença.", "err"); return; }
        if (!window.LicenseClient) { showMsg("Cliente de licença não carregou.", "err"); return; }
        var btn = $("lic-activate");
        setBusy(btn, true, "Ativando…");
        try {
            var resp = await window.LicenseClient.activate(key);
            var products = (resp.license && resp.license.products) || resp.products || [];
            showMsg("✓ Licença ativada — " + products.join(", "), "ok");
            if (inp) inp.value = "";
            refresh();
        } catch (e) {
            showMsg("Erro: " + (e.message || e), "err");
        } finally {
            setBusy(btn, false);
        }
    }

    async function onValidate() {
        if (!window.LicenseClient) { showMsg("Cliente de licença não carregou.", "err"); return; }
        var btn = $("lic-validate");
        setBusy(btn, true, "Revalidando…");
        try {
            var resp = await window.LicenseClient.validate({ silent: false });
            if (resp.active) showMsg("✓ Validada com o servidor", "ok");
            else showMsg("Servidor retornou: " + (resp.error || "inactive"), "err");
            refresh();
        } catch (e) {
            showMsg("Erro: " + (e.message || e), "err");
        } finally {
            setBusy(btn, false);
        }
    }

    async function onDeactivate() {
        if (!window.LicenseClient) { showMsg("Cliente de licença não carregou.", "err"); return; }
        if (!confirm("Desativar a licença neste device? Você poderá ativar em outra máquina.")) return;
        var btn = $("lic-deactivate");
        setBusy(btn, true, "Desativando…");
        try {
            await window.LicenseClient.deactivate();
            showMsg("✓ Licença desativada neste device.", "ok");
            refresh();
        } catch (e) {
            showMsg("Erro: " + (e.message || e), "err");
        } finally {
            setBusy(btn, false);
        }
    }

    function onLogout() {
        if (!confirm("Sair desta conta? Sua chave de licença continua ativa nesta máquina (não será desativada).")) return;
        if (window.Auth && window.Auth.logout) window.Auth.logout();
        // Recarrega pra reaplicar gate
        window.location.reload();
    }

    function open() {
        $("config-drawer") && $("config-drawer").classList.add("open");
        $("cfg-backdrop")  && $("cfg-backdrop").classList.add("open");
        refresh();
    }
    function close() {
        $("config-drawer") && $("config-drawer").classList.remove("open");
        $("cfg-backdrop")  && $("cfg-backdrop").classList.remove("open");
    }
    function toggle() {
        var d = $("config-drawer");
        if (d && d.classList.contains("open")) close(); else open();
    }

    function bind() {
        var open$ = $("btn-config");
        if (open$) open$.onclick = open;
        var close$ = $("cfg-close");
        if (close$) close$.onclick = close;
        var back$ = $("cfg-backdrop");
        if (back$) back$.onclick = close;
        var act = $("lic-activate");      if (act) act.onclick = onActivate;
        var val = $("lic-validate");      if (val) val.onclick = onValidate;
        var deact = $("lic-deactivate");  if (deact) deact.onclick = onDeactivate;
        var logout = $("cfg-logout");     if (logout) logout.onclick = onLogout;
        // Chunk 8: pílula "✨ Suite" no statusbar abre o drawer e rola até cross-sell
        var pill = $("suite-pill");
        if (pill) pill.onclick = function () {
            open();
            setTimeout(function () {
                var cs = $("cfg-cross-sell");
                if (cs && cs.scrollIntoView) cs.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 250);
        };

        // ESC fecha drawer
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && $("config-drawer") && $("config-drawer").classList.contains("open")) {
                close();
            }
        });
        // Pós-login refresca card (license trial pode ter chegado)
        document.addEventListener("auth:ready", function () { refresh(); });
    }

    function init() {
        bind();
        refresh();
    }

    return {
        init: init, open: open, close: close, toggle: toggle, refresh: refresh
    };
})();
