/* status-bar.js — Motion Legendas · T5 (2026-05-22)
 *
 * Status bar inferior com 4 dots: Backend · Host · Network · License.
 * Cada dot tem estado: ok (verde) / warn (amarelo) / err (vermelho) / off (cinza).
 * Polling a cada 30s (padronizado com Motion Titles).
 *
 * Mapeamento dos dots:
 *   - Backend → resposta de GET /v1/me com mv_session (sessão + servidor up)
 *   - Host    → host.jsx (MotionVault.ping retornou JSON válido)
 *   - Network → CDN R2 health (cdn.kendyproducoes.com.br/health)
 *   - License → LicenseCache.info() (active / offline_valid / err)
 */
window.StatusBar = (function () {

    function $(id) { return document.getElementById(id); }

    var CDN_HEALTH = (window.MV_CONFIG && window.MV_CONFIG.cdnHealthUrl)
        || "https://cdn.kendyproducoes.com.br/health";

    function setDot(id, state, title) {
        var el = $(id);
        if (!el) return;
        el.className = "dot " + (state || "off");
        if (title) el.title = title;
    }

    // ── INDIVIDUAL CHECKS ─────────────────────────────────────────────
    function checkHost() {
        // host.jsx — Motion Legendas usa EP_* namespace (não MotionVault)
        // window._hostOk seria setado por main.js após ping bem-sucedido.
        if (typeof window._hostOk === "undefined") {
            setDot("dot-host", "warn", "host.jsx ainda não testado");
            return;
        }
        setDot("dot-host",
            window._hostOk ? "ok" : "err",
            window._hostOk ? "host.jsx OK" : "host.jsx não carregou");
    }

    var _backendLast = 0;
    async function checkBackend(force) {
        if (!force && Date.now() - _backendLast < 30 * 1000) return;
        _backendLast = Date.now();
        var tok = localStorage.getItem("mv_session");
        if (!tok) {
            setDot("dot-backend", "off", "Sem sessão — faça login");
            return;
        }
        try {
            var apiBase = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl)
                || "https://motionpro.vercel.app";
            var ctrl = new AbortController();
            var to = setTimeout(function () { ctrl.abort(); }, 4000);
            var r = await fetch(apiBase + "/v1/me", {
                method: "GET",
                headers: { "Authorization": "Bearer " + tok },
                signal: ctrl.signal,
                cache: "no-store"
            });
            clearTimeout(to);
            if (r.ok) {
                var email = localStorage.getItem("mv_email") || "—";
                setDot("dot-backend", "ok", "Backend OK · " + email);
            } else if (r.status === 401 || r.status === 403) {
                setDot("dot-backend", "warn", "Sessão expirou — reconecte");
            } else {
                setDot("dot-backend", "warn", "Backend HTTP " + r.status);
            }
        } catch (e) {
            setDot("dot-backend", "err", "Backend inacessível: " + (e.message || e));
        }
    }

    function checkLicense() {
        var info = window.LicenseCache && window.LicenseCache.info
                    ? window.LicenseCache.info()
                    : { status: "not_activated" };
        if (info.status === "active" && info.offline_valid) {
            setDot("dot-license", "ok", "Licença ativa · " + (info.tier || "—").toUpperCase());
        } else if (info.status === "active" && !info.offline_valid) {
            setDot("dot-license", "warn", "Licença válida mas precisa revalidar (>24h)");
        } else if (info.status === "not_activated") {
            var plan = localStorage.getItem("mtl_plan") || "";
            if (plan === "trial" || plan === "yearly" || plan === "lifetime") {
                setDot("dot-license", "warn", "Plano legacy: " + plan);
            } else {
                setDot("dot-license", "off", "Sem licença ativada");
            }
        } else {
            setDot("dot-license", "err", "Licença " + info.status);
        }
    }

    var _networkLast = 0;
    async function checkNetwork(force) {
        if (!force && Date.now() - _networkLast < 30 * 1000) return;
        _networkLast = Date.now();
        try {
            var ctrl = new AbortController();
            var to = setTimeout(function () { ctrl.abort(); }, 4000);
            var r = await fetch(CDN_HEALTH, { method: "GET", signal: ctrl.signal, mode: "cors", cache: "no-store" });
            clearTimeout(to);
            setDot("dot-network",
                r.ok ? "ok" : "warn",
                r.ok ? "Network · CDN R2 OK" : "Network · CDN HTTP " + r.status);
        } catch (e) {
            setDot("dot-network", "err", "Network inacessível: " + (e.message || e));
        }
    }

    function updateAll(opts) {
        opts = opts || {};
        checkHost();
        checkBackend(!!opts.force);
        checkLicense();
        checkNetwork(!!opts.force);
    }

    function bind() {
        document.addEventListener("license:updated", function () { updateAll(); });
        document.addEventListener("auth:ready",      function () { updateAll({ force: true }); });
        window.addEventListener("online",  function () { updateAll({ force: true }); });
        window.addEventListener("offline", function () {
            setDot("dot-network", "err", "Offline");
            setDot("dot-backend", "err", "Offline");
        });
    }

    function init() {
        bind();
        updateAll({ force: true });
        // Polling 30s (alinhado com Motion Titles)
        setInterval(function () { updateAll(); }, 30 * 1000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else { init(); }

    return {
        init:      init,
        updateAll: updateAll
    };
})();
