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
