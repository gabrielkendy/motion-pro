/* status-bar.js — Motion IA · ζ
 *
 * 4-dot status bar (BACK · HOST · NET · LIC) que renderiza dentro de
 * `#status-bar` (placeholder DOM adicionado por ε no index.html).
 *
 * Refresh: 30s setInterval + refreshNow() exposto.
 *
 * Cores:
 *   .dot.green   — OK
 *   .dot.yellow  — degradado / pendente / não rodando
 *   .dot.red     — erro
 *   .dot.unknown — ainda não checado
 *
 * Click em qualquer dot → dispatch `mv:open-config` com detail {dot}.
 * Hover → title nativo com último timestamp.
 *
 * Estilos injetados via <style> (self-contained — não toca css/app.css que
 * é scope de ε).
 */
(function (global) {
    "use strict";

    var REFRESH_MS = 30 * 1000;
    var CONTAINER_ID = "status-bar";
    var STYLE_ID = "mvia-status-bar-styles";
    var DOTS = ["BACK", "HOST", "NET", "LIC"];
    var LOCAL_API_HEALTH = "http://localhost:3333/health";

    var handle = null;
    var lastState = {
        BACK: { status: "unknown", at: null, msg: "" },
        HOST: { status: "unknown", at: null, msg: "" },
        NET:  { status: "unknown", at: null, msg: "" },
        LIC:  { status: "unknown", at: null, msg: "" }
    };

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var css = "" +
        "#" + CONTAINER_ID + "{display:flex;gap:14px;align-items:center;padding:6px 12px;" +
        "  background:#0e1014;border-top:1px solid #1f242c;font-family:'Inter','Segoe UI',sans-serif;" +
        "  font-size:10px;color:#6b7280}" +
        "#" + CONTAINER_ID + " .mvia-dot{display:flex;align-items:center;gap:6px;cursor:pointer;" +
        "  padding:2px 6px;border-radius:6px;transition:background .15s}" +
        "#" + CONTAINER_ID + " .mvia-dot:hover{background:#181c24}" +
        "#" + CONTAINER_ID + " .mvia-dot__indicator{width:8px;height:8px;border-radius:50%;background:#374151;" +
        "  box-shadow:0 0 0 0 rgba(0,0,0,0);transition:background .2s,box-shadow .2s}" +
        "#" + CONTAINER_ID + " .mvia-dot__label{font-weight:600;letter-spacing:.4px;color:#9ca3af}" +
        "#" + CONTAINER_ID + " .mvia-dot.green  .mvia-dot__indicator{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.5)}" +
        "#" + CONTAINER_ID + " .mvia-dot.yellow .mvia-dot__indicator{background:#eab308;box-shadow:0 0 6px rgba(234,179,8,.5)}" +
        "#" + CONTAINER_ID + " .mvia-dot.red    .mvia-dot__indicator{background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,.5)}" +
        "#" + CONTAINER_ID + " .mvia-dot.unknown .mvia-dot__indicator{background:#374151}";
        var st = document.createElement("style");
        st.id = STYLE_ID;
        st.textContent = css;
        document.head.appendChild(st);
    }

    function ensureContainer() {
        var el = document.getElementById(CONTAINER_ID);
        if (!el) {
            // ε deveria ter colocado no index.html. Como fallback, criamos no body.
            el = document.createElement("div");
            el.id = CONTAINER_ID;
            document.body.appendChild(el);
        }
        if (!el.hasAttribute("data-mvia-rendered")) {
            el.innerHTML = DOTS.map(function (id) {
                return '<div class="mvia-dot unknown" data-id="' + id + '">' +
                       '<span class="mvia-dot__indicator"></span>' +
                       '<span class="mvia-dot__label">' + id + '</span>' +
                       '</div>';
            }).join("");
            el.setAttribute("data-mvia-rendered", "1");
            el.addEventListener("click", function (e) {
                var dot = e.target && e.target.closest ? e.target.closest(".mvia-dot") : null;
                if (!dot) return;
                var id = dot.getAttribute("data-id");
                try {
                    document.dispatchEvent(new CustomEvent("mv:open-config", { detail: { dot: id } }));
                } catch (_) {}
            });
        }
        return el;
    }

    function setDot(id, status, msg) {
        lastState[id] = { status: status, at: new Date(), msg: msg || "" };
        var container = document.getElementById(CONTAINER_ID);
        if (!container) return;
        var el = container.querySelector('.mvia-dot[data-id="' + id + '"]');
        if (!el) return;
        el.classList.remove("green", "yellow", "red", "unknown");
        el.classList.add(status);
        var ts = lastState[id].at.toLocaleTimeString();
        el.setAttribute("title", id + ": " + status + " · last check " + ts +
                                 (msg ? " · " + msg : ""));
    }

    // ── Per-dot checks ──────────────────────────────────────────────────
    function checkBack() {
        var api = global.MvApi && global.MvApi.api;
        if (!api) { setDot("BACK", "yellow", "MvApi not loaded"); return Promise.resolve(); }
        return api("/v1/health", { method: "GET", timeoutMs: 5000 }).then(function (res) {
            if (res.ok && res.status === 200) setDot("BACK", "green", "200 OK");
            else if (res.status === 0)        setDot("BACK", "red", "network err");
            else                              setDot("BACK", "red", "HTTP " + res.status);
        }).catch(function (e) { setDot("BACK", "red", (e && e.message) || "exception"); });
    }

    function checkHost() {
        var hb = global.HostBridge;
        if (!hb || typeof hb.getDiagnostics !== "function") {
            setDot("HOST", "yellow", "HostBridge não carregado");
            return Promise.resolve();
        }
        try {
            var d = hb.getDiagnostics();
            if (d && d.lastError) {
                setDot("HOST", "red", String(d.lastError).slice(0, 80));
            } else if (d && d.bootstrapped) {
                setDot("HOST", "green", "ready");
            } else {
                setDot("HOST", "yellow", "not bootstrapped");
            }
        } catch (e) {
            setDot("HOST", "red", (e && e.message) || "diag exception");
        }
        return Promise.resolve();
    }

    function checkNet() {
        // localhost:3333 service. Timeout curto. 404/timeout = yellow.
        if (typeof fetch !== "function") {
            setDot("NET", "yellow", "no fetch");
            return Promise.resolve();
        }
        var ctrl = null, timeoutId = null;
        try {
            if (typeof AbortController !== "undefined") {
                ctrl = new AbortController();
                timeoutId = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 3000);
            }
        } catch (_) {}
        var init = { method: "GET" };
        if (ctrl) init.signal = ctrl.signal;
        return fetch(LOCAL_API_HEALTH, init).then(function (r) {
            if (timeoutId) clearTimeout(timeoutId);
            if (r.status === 200)      setDot("NET", "green", "local svc up");
            else if (r.status === 404) setDot("NET", "yellow", "service not running");
            else                       setDot("NET", "red", "HTTP " + r.status);
        }).catch(function (e) {
            if (timeoutId) clearTimeout(timeoutId);
            var m = (e && e.message) || "";
            if (/abort|timeout/i.test(m)) setDot("NET", "yellow", "timeout · svc down?");
            else                          setDot("NET", "yellow", "unreachable");
        });
    }

    function checkLic() {
        var cache = global.MvLicenseCache;
        if (!cache) {
            setDot("LIC", "yellow", "MvLicenseCache não carregado");
            return Promise.resolve();
        }
        var c = cache.getCache();
        if (!c) { setDot("LIC", "yellow", "no cache · pending check"); return Promise.resolve(); }
        if (!cache.isCacheValid()) { setDot("LIC", "red", "cache > 30d"); return Promise.resolve(); }
        if (!cache.coversIa()) { setDot("LIC", "red", "no IA coverage"); return Promise.resolve(); }
        var age = cache.ageHours();
        setDot("LIC", "green", "valid · " + (age != null ? age.toFixed(1) + "h old" : ""));
        return Promise.resolve();
    }

    function refreshNow() {
        ensureContainer();
        return Promise.all([checkBack(), checkHost(), checkNet(), checkLic()]);
    }

    function start() {
        ensureStyles();
        ensureContainer();
        refreshNow();
        if (handle) clearInterval(handle);
        handle = setInterval(refreshNow, REFRESH_MS);
        try { console.log("[mvia-status-bar] started · refresh=" + (REFRESH_MS / 1000) + "s"); } catch (_) {}
    }

    function stop() {
        if (handle) { clearInterval(handle); handle = null; }
    }

    function getState() {
        return JSON.parse(JSON.stringify(lastState));
    }

    global.MvStatusBar = {
        start:      start,
        stop:       stop,
        refreshNow: refreshNow,
        getState:   getState,
        REFRESH_MS: REFRESH_MS
    };
})(typeof window !== "undefined" ? window : globalThis);
