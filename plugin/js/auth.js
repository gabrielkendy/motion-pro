/* auth.js — autenticação + Google OAuth pro Motion Titles.
 *
 * Reusa o backend MotionVault unificado (igual Motion IA / Motion Legendas):
 *   - PRODUCT_ID = "titles"
 *   - prefixo localStorage por produto = "mvt_*"
 *   - sessão global compartilhada com os outros plugins = "mv_session"
 *     (login uma vez → vale pros 3 plugins da Motion Suite)
 *
 * Responsabilidades (Chunk 2):
 *   - bindGate(): tabs / submit / forgot / Google OAuth / "Tenho código"
 *   - tryRestoreSession(): sticky session 30d
 *   - refreshUserMeta(): grava mia_user_meta.is_admin_verified (compartilhada
 *     entre plugins pra unificar tier-gating)
 *
 * NÃO inclui heartbeat / paywall / trial UI — esses ficam no app.js legacy
 * por enquanto e serão unificados no Chunk 6.
 */
window.Auth = (function () {

    var API_BASE     = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl)   || "https://motionpro.vercel.app";
    var PRODUCT_ID   = (window.MV_CONFIG && window.MV_CONFIG.productId)    || "titles";
    var PRODUCT_NAME = (window.MV_CONFIG && window.MV_CONFIG.productName)  || "Motion Titles";
    var LANDING_URL  = (window.MV_CONFIG && window.MV_CONFIG.landingUrl)   || "https://motionpro-lp.vercel.app";
    var PRICING_URL  = (window.MV_CONFIG && window.MV_CONFIG.pricingUrl)   || (LANDING_URL + "/titles/#pricing");
    var DEV_BYPASS   = (window.MV_CONFIG && window.MV_CONFIG.devMode === true);

    function $(id) { return document.getElementById(id); }

    function api(path, body) {
        var token = localStorage.getItem("mv_session");
        return fetch(API_BASE + path, {
            method: body ? "POST" : "GET",
            headers: Object.assign(
                { "Content-Type": "application/json" },
                token ? { "Authorization": "Bearer " + token } : {}
            ),
            body: body ? JSON.stringify(body) : undefined
        }).then(function (r) {
            return r.json().then(function (d) {
                if (!r.ok) throw (d && d.error) || ("http_" + r.status);
                return d;
            });
        });
    }

    function computeFingerprint() {
        // Reusa fingerprint persistido pelo license-cache se existir (Chunk 3),
        // assim auth+license+CDN usam o mesmo fp em toda a Motion Suite.
        if (window.LicenseCache && typeof window.LicenseCache.deviceFingerprint === "function") {
            try { return window.LicenseCache.deviceFingerprint(); } catch (_) {}
        }
        var saved = localStorage.getItem("mvt_device_fp");
        if (saved) return saved;
        var os = (typeof require === "function") ? require("os") : null;
        var parts = [];
        if (os) {
            parts.push(os.hostname()); parts.push(os.platform()); parts.push(os.arch());
            parts.push(String(os.totalmem()));
            try { parts.push(os.userInfo().username); } catch (e) {}
            var ifaces = os.networkInterfaces();
            var macs = [];
            for (var k in ifaces) {
                ifaces[k].forEach(function (i) {
                    if (i.mac && i.mac !== "00:00:00:00:00:00") macs.push(i.mac);
                });
            }
            macs.sort(); parts.push(macs.join("|"));
        }
        parts.push(navigator.userAgent.substr(0, 60));
        parts.push(String(screen.width) + "x" + String(screen.height));
        var s = parts.join("::");
        var h1 = 0xdeadbeef >>> 0, h2 = 0x41c6ce57 >>> 0;
        for (var i = 0; i < s.length; i++) {
            h1 = Math.imul(h1 ^ s.charCodeAt(i), 2654435761) >>> 0;
            h2 = Math.imul(h2 ^ s.charCodeAt(i), 1597334677) >>> 0;
        }
        var fp = h1.toString(16).padStart(8,"0") + h2.toString(16).padStart(8,"0") + s.length.toString(16);
        try { localStorage.setItem("mvt_device_fp", fp); } catch (_) {}
        return fp;
    }

    function openInBrowser(url) {
        try { new CSInterface().openURLInDefaultBrowser(url); return; } catch (e) {}
        try { window.cep.util.openURLInDefaultBrowser(url); return; } catch (e) {}
        try { window.open(url, "_blank"); return; } catch (e) {}
    }

    function setGateMode(mode) {
        var isSignup = mode === "signup";
        var gtL = $("gt-login"), gtS = $("gt-signup");
        if (gtL) gtL.classList.toggle("active", !isSignup);
        if (gtS) gtS.classList.toggle("active", isSignup);
        var sub = $("g-submit");
        if (sub) {
            sub.textContent = isSignup ? "Criar conta · 7 dias grátis" : "Entrar";
            sub.dataset.mode = mode;
        }
        var msg = $("g-msg");
        if (msg) { msg.textContent = ""; msg.className = "gate__msg"; }
        [].forEach.call(document.querySelectorAll(".signup-only"), function (el) { el.hidden = !isSignup; });
        var pass = $("g-password");
        if (pass) pass.autocomplete = isSignup ? "new-password" : "current-password";
    }

    function showGate(mode) {
        var g = $("gate"); if (g) g.classList.remove("hidden");
        setGateMode(mode || "login");
    }
    function hideGate() {
        var g = $("gate"); if (g) g.classList.add("hidden");
    }

    function bindGate() {
        var gtL = $("gt-login"), gtS = $("gt-signup");
        if (gtL) gtL.onclick = function () { setGateMode("login"); };
        if (gtS) gtS.onclick = function () { setGateMode("signup"); };

        var forgot = $("g-forgot");
        if (forgot) forgot.onclick = function (e) {
            e.preventDefault();
            var email = ($("g-email") && $("g-email").value || "").trim();
            openInBrowser(LANDING_URL + "/reset-password.html" + (email ? "?email=" + encodeURIComponent(email) : ""));
            var msg = $("g-msg");
            if (msg) { msg.textContent = "✓ Página de recuperação aberta no navegador"; msg.className = "gate__msg ok"; }
        };

        var sub = $("g-submit");
        if (sub) sub.onclick = async function () {
            var mode  = sub.dataset.mode || "login";
            var email = ($("g-email") && $("g-email").value || "").trim().toLowerCase();
            var password = ($("g-password") && $("g-password").value) || "";
            var name  = ($("g-name") && $("g-name").value || "").trim();
            var phone = ($("g-phone") && $("g-phone").value || "").trim();
            var optin = $("g-optin") ? $("g-optin").checked : false;
            var msg   = $("g-msg");
            if (!email || password.length < 8) {
                if (msg) { msg.textContent = "Email e senha (mín 8) obrigatórios"; msg.className = "gate__msg err"; }
                return;
            }
            if (mode === "signup" && name.length < 2) {
                if (msg) { msg.textContent = "Digite seu nome completo"; msg.className = "gate__msg err"; }
                return;
            }
            sub.disabled = true;
            if (msg) { msg.textContent = "Conectando..."; msg.className = "gate__msg"; }
            try {
                var fp = computeFingerprint();
                var payload = { email: email, password: password, fingerprint: fp };
                if (mode === "signup") {
                    payload.name = name; payload.phone = phone || null; payload.marketing_optin = optin;
                }
                var data = await api("/v1/auth/" + mode, payload);
                localStorage.setItem("mv_session", data.session_token);
                localStorage.setItem("mv_email", email);

                // Busca perfil real do backend (não confia só no localStorage,
                // que poderia ser editado via DevTools pra forjar admin).
                try {
                    var meRes = await fetch(API_BASE + "/v1/me", {
                        headers: { "Authorization": "Bearer " + data.session_token }
                    });
                    if (meRes.ok) {
                        var me = await meRes.json();
                        var meta = { is_admin_verified: !!me.is_admin, email: me.email };
                        // Chave "mia_user_meta" é compartilhada com os outros plugins
                        // da Motion Suite (intencional: admin no IA = admin no Titles).
                        localStorage.setItem("mia_user_meta", JSON.stringify(meta));
                    }
                } catch (_) { /* não bloqueia login */ }

                // Emite licença trial via fluxo legacy (separado da chave MTI- do Chunk 3)
                try {
                    var lic = await api("/v1/license/issue", { fingerprint: fp, product_id: PRODUCT_ID });
                    localStorage.setItem("mvt_license", lic.license || "");
                    localStorage.setItem("mvt_plan",    lic.plan || "");
                    localStorage.setItem("mvt_status",  lic.status || "");
                    localStorage.setItem("mvt_expires", lic.expires_at || "");
                    localStorage.setItem("mvt_via_bundle", lic.covers_via_bundle ? "true" : "false");
                    // Aliases legacy mv_* pra compat com app.js trial/paywall até Chunk 6
                    localStorage.setItem("mv_license",  lic.license || "");
                    localStorage.setItem("mv_plan",     lic.plan || "");
                    localStorage.setItem("mv_status",   lic.status || "");
                    localStorage.setItem("mv_expires",  lic.expires_at || "");
                    localStorage.setItem("mv_license_jwt", lic.license || "");
                    localStorage.setItem("mv_license_fp",  fp);
                    localStorage.setItem("mv_license_issued_at", String(Date.now()));
                } catch (_) { /* sem trial, segue pro paywall via heartbeat */ }

                if (mode === "signup") {
                    localStorage.setItem("mvt_email_verified", "false");
                    localStorage.removeItem("mvt_verify_dismissed_until");
                    if (name) localStorage.setItem("mv_name", name);
                }
                if (msg) {
                    msg.textContent = "✓ " + (mode === "signup" ? "Conta criada! Trial de 7 dias ativo." : "Bem-vindo!");
                    msg.className = "gate__msg ok";
                }
                setTimeout(function () {
                    hideGate();
                    document.dispatchEvent(new CustomEvent("auth:ready"));
                }, 500);
            } catch (e) {
                if (msg) {
                    msg.textContent = "Erro: " + (typeof e === "string" ? e : (e.message || "falha"));
                    msg.className = "gate__msg err";
                }
            }
            sub.disabled = false;
        };

        // ────────── Google OAuth (browser externo + paste JWT) ──────────
        var gGoogle = $("g-google");
        if (gGoogle) gGoogle.onclick = function () {
            var bridgeUrl = LANDING_URL + "/oauth-bridge.html#plugin=" + encodeURIComponent(PRODUCT_ID);
            var url = API_BASE
                    + "/v1/oauth/google/start"
                    + "?plugin=" + encodeURIComponent(PRODUCT_ID)
                    + "&return_to=" + encodeURIComponent(bridgeUrl);
            openInBrowser(url);
            var box = $("g-code-box");
            if (box) box.style.display = "block";
            var msg = $("g-msg");
            if (msg) {
                msg.textContent = "Login Google aberto no navegador. Cole o código aqui depois.";
                msg.className = "gate__msg ok";
            }
        };

        var gHave = $("g-have-code");
        if (gHave) gHave.onclick = function (e) {
            e.preventDefault();
            var box = $("g-code-box");
            if (box) box.style.display = box.style.display === "none" ? "block" : "none";
        };

        var gCancel = $("g-code-cancel");
        if (gCancel) gCancel.onclick = function () {
            var box = $("g-code-box"); if (box) box.style.display = "none";
            var inp = $("g-code-input"); if (inp) inp.value = "";
        };

        var gCodeSubmit = $("g-code-submit");
        if (gCodeSubmit) gCodeSubmit.onclick = async function () {
            var token = (($("g-code-input") && $("g-code-input").value) || "").trim();
            var msg = $("g-msg");
            if (!token || token.length < 20) {
                if (msg) { msg.textContent = "Cole o código completo gerado no navegador."; msg.className = "gate__msg err"; }
                return;
            }
            gCodeSubmit.disabled = true;
            gCodeSubmit.textContent = "Validando…";
            try {
                var r = await fetch(API_BASE + "/v1/me", { headers: { "Authorization": "Bearer " + token } });
                if (!r.ok) throw new Error("Código inválido ou expirado (HTTP " + r.status + ")");
                var me = await r.json();
                if (!me.email) throw new Error("Resposta inválida do servidor");
                localStorage.setItem("mv_session", token);
                localStorage.setItem("mv_email", me.email);
                var meta = { is_admin_verified: !!me.is_admin, email: me.email };
                localStorage.setItem("mia_user_meta", JSON.stringify(meta));
                if (msg) { msg.textContent = "✓ Login Google: " + me.email; msg.className = "gate__msg ok"; }
                setTimeout(function () {
                    hideGate();
                    document.dispatchEvent(new CustomEvent("auth:ready"));
                }, 600);
            } catch (e) {
                if (msg) { msg.textContent = "Erro: " + (e.message || e); msg.className = "gate__msg err"; }
            } finally {
                gCodeSubmit.disabled = false;
                gCodeSubmit.textContent = "Entrar com código";
            }
        };
    }

    async function refreshUserMeta() {
        var tok = localStorage.getItem("mv_session");
        if (!tok) return;
        try {
            var r = await fetch(API_BASE + "/v1/me", { headers: { "Authorization": "Bearer " + tok } });
            if (!r.ok) return;
            var me = await r.json();
            var meta = { is_admin_verified: !!me.is_admin, email: me.email };
            localStorage.setItem("mia_user_meta", JSON.stringify(meta));
            // Sidebar/tier-gating hooks (Chunk 5) podem reagir aqui
            if (window.Features && typeof window.Features.updateUI === "function") {
                window.Features.updateUI();
            }
        } catch (_) {}
    }

    function tryRestoreSession() {
        if (DEV_BYPASS) { hideGate(); return true; }
        var t = localStorage.getItem("mv_session");
        if (t) { hideGate(); return true; }
        showGate("login");
        return false;
    }

    function logout() {
        ["mv_session","mv_email","mv_name",
         "mvt_license","mvt_plan","mvt_status","mvt_expires","mvt_via_bundle","mvt_email_verified",
         "mv_license","mv_plan","mv_status","mv_expires",
         "mv_license_jwt","mv_license_fp","mv_license_issued_at",
         "mv_email_verified","mv_verify_dismissed_until",
         "mia_user_meta"]
            .forEach(function (k) { localStorage.removeItem(k); });
    }

    function isLoggedIn() { return !!localStorage.getItem("mv_session"); }

    function init() {
        bindGate();
        var hadSession = tryRestoreSession();
        if (hadSession) {
            refreshUserMeta();
            document.dispatchEvent(new CustomEvent("auth:ready"));
        }
    }

    return {
        init: init,
        api: api,
        computeFingerprint: computeFingerprint,
        openInBrowser: openInBrowser,
        showGate: showGate,
        hideGate: hideGate,
        logout: logout,
        isLoggedIn: isLoggedIn,
        refreshUserMeta: refreshUserMeta,
        PRODUCT_ID: PRODUCT_ID,
        LANDING_URL: LANDING_URL,
        PRICING_URL: PRICING_URL,
        API_BASE: API_BASE
    };
})();
