/* cross-sell.js — Motion Legendas
 *
 * Renderiza o card Motion Suite no tab Config:
 *   - Se user tem bundle MTS- (covers_via_bundle=true) → card
 *     "Pacote completo" com links pra baixar Titles + IA
 *   - Senão → banner discreto "Tenha Titles + IA também · Motion
 *     Suite a partir de R$ 59,90/mês"
 *
 * Chamado por config-tab.js dentro de renderLicenseCard().
 */
(function () {
    "use strict";

    var LANDING_URL = (window.MV_CONFIG && window.MV_CONFIG.landingUrl) || "https://motionpro-lp.vercel.app";

    function escapeHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function render(info) {
        var box = document.getElementById("suite-cross-sell");
        if (!box) return;

        var hasBundle = !!(info && info.covers_via_bundle);
        var hasMtlActive = info && info.status === "active" && !hasBundle;

        // Se user não está autenticado / sem licença, esconde
        var loggedIn = !!localStorage.getItem("mv_session");
        if (!loggedIn) {
            box.classList.add("hidden");
            return;
        }

        if (hasBundle) {
            box.classList.remove("hidden");
            box.innerHTML = renderBundleOwner(info);
        } else {
            box.classList.remove("hidden");
            box.innerHTML = renderUpsell(info);
        }

        bindCrossSellHandlers(hasBundle);
    }

    function renderBundleOwner(info) {
        return ''
            + '<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">'
            +   '<div style="font-size:30px">🎁</div>'
            +   '<div style="flex:1">'
            +     '<div style="font:800 14px Inter;color:var(--txt)">Você tem o pacote completo!</div>'
            +     '<div style="font:500 11px Inter;color:var(--mut);margin-top:2px">Sua chave MTS- libera Motion Titles + Legendas + IA</div>'
            +   '</div>'
            + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
            +   '<button class="btn btn--sm" type="button" data-cs-action="download-titles">⬇️ Baixar Motion Titles</button>'
            +   '<button class="btn btn--sm" type="button" data-cs-action="download-ia">⬇️ Baixar Motion IA</button>'
            + '</div>'
            + '<div style="margin-top:10px;font:500 10px Inter;color:var(--mut-2);text-align:center">'
            +   'Mesma chave ativa nos 3 plugins · sem custo adicional'
            + '</div>';
    }

    function renderUpsell(info) {
        return ''
            + '<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">'
            +   '<div style="font-size:26px">💎</div>'
            +   '<div style="flex:1">'
            +     '<div style="font:700 13px Inter;color:var(--txt)">Tenha Titles + IA também</div>'
            +     '<div style="font:500 11px Inter;color:var(--mut);margin-top:2px">Bundle Motion Suite a partir de <b style="color:var(--acc-2)">R$ 59,90/mês</b></div>'
            +   '</div>'
            +   '<button class="btn btn--primary btn--sm" type="button" data-cs-action="view-suite">Ver Suite →</button>'
            + '</div>'
            + '<div style="font:500 10px Inter;color:var(--mut-2);line-height:1.5">'
            +   '✓ Motion Titles (templates)  ·  ✓ Motion Legendas (você já tem)  ·  ✓ Motion IA (agente Claude/Gemini)'
            + '</div>';
    }

    function bindCrossSellHandlers(hasBundle) {
        var openExt = (window.Auth && window.Auth.openInBrowser) || function (u) { window.open(u, "_blank"); };
        document.querySelectorAll("#suite-cross-sell [data-cs-action]").forEach(function (btn) {
            btn.onclick = function () {
                var act = btn.getAttribute("data-cs-action");
                if (act === "view-suite") {
                    openExt(LANDING_URL + "/#suite");
                } else if (act === "download-titles") {
                    openExt(LANDING_URL + "/download.html?product=titles");
                } else if (act === "download-ia") {
                    openExt(LANDING_URL + "/ia/download.html");
                }
            };
        });
    }

    // Expose pra config-tab.js
    window.MPL_renderCrossSell = render;

    // Auto-render no boot se a tab Config estiver na DOM
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            try {
                var info = (window.LicenseCache && window.LicenseCache.info && window.LicenseCache.info()) || {};
                render(info);
            } catch (_) {}
        });
    } else {
        try {
            var info = (window.LicenseCache && window.LicenseCache.info && window.LicenseCache.info()) || {};
            render(info);
        } catch (_) {}
    }
})();
