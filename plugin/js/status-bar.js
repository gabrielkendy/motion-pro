/* status-bar.js — Motion Titles · Chunk 7
 *
 * Status bar inferior com 4 dots: Premiere · Auth · Licença · CDN.
 * Cada dot tem estado: ok (verde) / warn (laranja) / err (vermelho) / off (cinza).
 *
 * Também provê o Diagnóstico técnico (botão no drawer ⚙ Config) que roda
 * 5 testes e mostra output texto pra debug remoto (igual Motion IA).
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
    function checkPremiere() {
        // hostPing usa MotionVault.ping(); status fica em window._hostOk
        if (typeof window._hostOk === "undefined") {
            setDot("dot-premiere", "warn", "host.jsx ainda não testado");
            return;
        }
        setDot("dot-premiere",
            window._hostOk ? "ok" : "err",
            window._hostOk ? "host.jsx OK" : "host.jsx não carregou");
    }

    function checkAuth() {
        var logged = window.Auth && window.Auth.isLoggedIn && window.Auth.isLoggedIn();
        setDot("dot-auth",
            logged ? "ok" : "off",
            logged ? "Logado: " + (localStorage.getItem("mv_email") || "—") : "Não logado");
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
            // Pode ter plano trial legacy ainda
            var plan = localStorage.getItem("mv_plan") || "";
            if (plan === "trial" || plan === "yearly" || plan === "lifetime") {
                setDot("dot-license", "warn", "Plano legacy: " + plan);
            } else {
                setDot("dot-license", "off", "Sem licença ativada");
            }
        } else {
            setDot("dot-license", "err", "Licença " + info.status);
        }
    }

    var _cdnLast = 0;
    async function checkCDN(force) {
        // Cooldown 60s pra não martelar o CDN
        if (!force && Date.now() - _cdnLast < 60 * 1000) return;
        _cdnLast = Date.now();
        try {
            var ctrl = new AbortController();
            var to = setTimeout(function () { ctrl.abort(); }, 4000);
            var r = await fetch(CDN_HEALTH, { method: "GET", signal: ctrl.signal, mode: "cors", cache: "no-store" });
            clearTimeout(to);
            setDot("dot-cdn",
                r.ok ? "ok" : "warn",
                r.ok ? "CDN R2 OK" : "CDN HTTP " + r.status);
        } catch (e) {
            setDot("dot-cdn", "err", "CDN inacessível: " + (e.message || e));
        }
    }

    function updateAll(opts) {
        opts = opts || {};
        checkPremiere();
        checkAuth();
        checkLicense();
        checkCDN(!!opts.force);
    }

    // ── DIAGNÓSTICO TÉCNICO ───────────────────────────────────────────
    async function runDiagnostic() {
        var out = $("diag-output");
        if (out) { out.classList.remove("hidden"); out.textContent = "Rodando diagnóstico…\n"; }
        var lines = [];
        function p(s) { lines.push(s); if (out) out.textContent = lines.join("\n"); }
        function safe(fn) { try { return fn(); } catch (e) { return "ERR: " + (e.message || e); } }

        p("═══ MOTION TITLES · DIAGNÓSTICO ═══");
        p("BUILD: " + (window.BUILD || "?"));
        p("UA:    " + navigator.userAgent);
        p("");

        // T1: CSInterface + paths
        p("── T1. CSInterface + extension path ──");
        try {
            var cs = new CSInterface();
            var extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION);
            p("✓ extPath: " + extPath);
        } catch (e) {
            p("✗ getSystemPath ERR: " + (e.message || e));
        }
        p("");

        // T2: LicenseCache
        p("── T2. License cache ──");
        var info = safe(function () {
            return window.LicenseCache && window.LicenseCache.info ? window.LicenseCache.info() : { status: "module_missing" };
        });
        p(JSON.stringify(info, null, 2));
        p("");

        // T3: Backend /v1/me
        p("── T3. Backend /v1/me ──");
        var tok = localStorage.getItem("mv_session");
        if (!tok) p("⚠ sem mv_session — pule esse teste e relogue");
        else {
            try {
                var apiBase = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl) || "https://motionpro.vercel.app";
                var r = await fetch(apiBase + "/v1/me", { headers: { "Authorization": "Bearer " + tok } });
                p("HTTP " + r.status);
                var txt = await r.text();
                p(txt.slice(0, 500));
            } catch (e) {
                p("✗ fetch /v1/me ERR: " + (e.message || e));
            }
        }
        p("");

        // T4: host.jsx ping
        p("── T4. host.jsx (MotionVault.ping) ──");
        await new Promise(function (resolve) {
            try {
                var cs2 = new CSInterface();
                cs2.evalScript(
                    "(typeof $.global.MotionVault === 'object') ? MotionVault.ping() : 'undefined'",
                    function (res) { p("← " + (res || "(vazio)")); resolve(); }
                );
            } catch (e) {
                p("✗ evalScript ERR: " + (e.message || e));
                resolve();
            }
        });
        p("");

        // T5: CDN health
        p("── T5. CDN R2 health ──");
        try {
            var rr = await fetch(CDN_HEALTH, { method: "GET", cache: "no-store" });
            p("HTTP " + rr.status + " (" + CDN_HEALTH + ")");
        } catch (e) {
            p("✗ fetch CDN ERR: " + (e.message || e));
        }
        p("");

        p("═══ FIM ═══");
        // Refresh dots após o diag
        updateAll({ force: true });
    }

    function bind() {
        var btn = $("btn-diagnose");
        if (btn) btn.onclick = runDiagnostic;
        // Atualiza dots em eventos relevantes
        document.addEventListener("license:updated", function () { updateAll(); });
        document.addEventListener("auth:ready",      function () { updateAll(); });
        window.addEventListener("online",  function () { updateAll({ force: true }); });
        window.addEventListener("offline", function () { setDot("dot-cdn", "err", "Offline"); });
    }

    function init() {
        bind();
        updateAll({ force: true });
        // Refresh leve a cada 60s
        setInterval(function () { updateAll(); }, 60 * 1000);
    }

    return {
        init:           init,
        updateAll:      updateAll,
        runDiagnostic:  runDiagnostic
    };
})();
