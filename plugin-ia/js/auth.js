/* auth.js — autenticação + licença + heartbeat pra Motion IA.
 *
 * Reusa o backend MotionVault. Único diferencial vs Motion Legendas:
 *   - product_id = "ia"
 *   - prefixo localStorage = "mvi_*" (mvi = Motion Vault IA)
 *
 * Token de sessão é compartilhado com os outros plugins via "mv_session"
 * pra UX unificada (login uma vez, vale pros 3 plugins).
 */
window.Auth = (function () {

    var API_BASE     = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl)   || "https://motionpro.vercel.app";
    var PRODUCT_ID   = (window.MV_CONFIG && window.MV_CONFIG.productId)    || "ia";
    var PRODUCT_NAME = (window.MV_CONFIG && window.MV_CONFIG.productName)  || "Motion IA";
    var LANDING_URL  = (window.MV_CONFIG && window.MV_CONFIG.landingUrl)   || "https://motionpro-lp.vercel.app";
    var PRICING_URL  = (window.MV_CONFIG && window.MV_CONFIG.pricingUrl)   || (LANDING_URL + "/ia/#pricing");
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
        return h1.toString(16).padStart(8,"0") + h2.toString(16).padStart(8,"0") + s.length.toString(16);
    }

    function openInBrowser(url) {
        try { new CSInterface().openURLInDefaultBrowser(url); return; } catch (e) {}
        try { window.cep.util.openURLInDefaultBrowser(url); return; } catch (e) {}
        try { window.open(url, "_blank"); return; } catch (e) {}
    }

    function setGateMode(mode) {
        var isSignup = mode === "signup";
        $("gt-login").classList.toggle("active", !isSignup);
        $("gt-signup").classList.toggle("active", isSignup);
        $("g-submit").textContent = isSignup ? "Criar conta · 7 dias grátis" : "Entrar";
        $("g-msg").textContent = ""; $("g-msg").className = "gate__msg";
        $("g-submit").dataset.mode = mode;
        [].forEach.call(document.querySelectorAll(".signup-only"), function (el) { el.hidden = !isSignup; });
        $("g-password").autocomplete = isSignup ? "new-password" : "current-password";
    }

    function showGate(mode) { $("gate").classList.remove("hidden"); setGateMode(mode || "login"); }
    function hideGate() { $("gate").classList.add("hidden"); }

    function bindGate() {
        $("gt-login").onclick  = function () { setGateMode("login"); };
        $("gt-signup").onclick = function () { setGateMode("signup"); };
        $("g-forgot").onclick  = function (e) {
            e.preventDefault();
            var email = $("g-email").value.trim();
            openInBrowser(LANDING_URL + "/reset-password.html" + (email ? "?email=" + encodeURIComponent(email) : ""));
            $("g-msg").textContent = "✓ Página de recuperação aberta no navegador";
            $("g-msg").className = "gate__msg ok";
        };
        $("g-submit").onclick = async function () {
            var mode = $("g-submit").dataset.mode || "login";
            var email = $("g-email").value.trim().toLowerCase();
            var password = $("g-password").value;
            var name  = ($("g-name") && $("g-name").value || "").trim();
            var phone = ($("g-phone") && $("g-phone").value || "").trim();
            var optin = $("g-optin") ? $("g-optin").checked : false;
            var msg = $("g-msg"), sub = $("g-submit");
            if (!email || password.length < 8) { msg.textContent = "Email e senha (mín 8) obrigatórios"; return; }
            if (mode === "signup" && name.length < 2) { msg.textContent = "Digite seu nome completo"; return; }
            sub.disabled = true; msg.textContent = "Conectando..."; msg.className = "gate__msg";
            try {
                var fp = computeFingerprint();
                var payload = { email: email, password: password, fingerprint: fp };
                if (mode === "signup") {
                    payload.name = name; payload.phone = phone || null; payload.marketing_optin = optin;
                }
                var data = await api("/v1/auth/" + mode, payload);
                localStorage.setItem("mv_session", data.session_token);
                localStorage.setItem("mv_email", email);

                // Busca perfil real do backend pra detectar is_admin (não confia
                // só no localStorage que poderia ser editado via DevTools)
                try {
                    var meRes = await fetch(API_BASE + "/v1/me", { headers: { "Authorization": "Bearer " + data.session_token } });
                    if (meRes.ok) {
                        var me = await meRes.json();
                        var meta = { is_admin_verified: !!me.is_admin, email: me.email };
                        localStorage.setItem("mia_user_meta", JSON.stringify(meta));
                    }
                } catch (_) { /* não bloqueia login */ }

                var lic = await api("/v1/license/issue", { fingerprint: fp, product_id: PRODUCT_ID });
                localStorage.setItem("mvi_license", lic.license);
                localStorage.setItem("mvi_plan", lic.plan);
                localStorage.setItem("mvi_status", lic.status || "");
                localStorage.setItem("mvi_expires", lic.expires_at || "");
                localStorage.setItem("mvi_via_bundle", lic.covers_via_bundle ? "true" : "false");

                if (mode === "signup") {
                    localStorage.setItem("mvi_email_verified", "false");
                    localStorage.removeItem("mvi_verify_dismissed_until");
                    if (name) localStorage.setItem("mv_name", name);
                } else {
                    setTimeout(checkEmailVerified, 800);
                }
                msg.textContent = "✓ " + (mode === "signup" ? "Conta criada! trial de 7 dias ativo." : "Bem-vindo!");
                msg.className = "gate__msg ok";
                setTimeout(function () {
                    hideGate(); updateTrialUI(); updateVerifyBar();
                    document.dispatchEvent(new CustomEvent("auth:ready"));
                }, 500);
            } catch (e) {
                msg.textContent = "Erro: " + (typeof e === "string" ? e : (e.message || "falha"));
                msg.className = "gate__msg";
            }
            sub.disabled = false;
        };

        // ────────── Google OAuth (device-style: browser externo + paste JWT) ──────────
        var gGoogle = $("g-google");
        if (gGoogle) {
            gGoogle.onclick = function () {
                var bridgeUrl = LANDING_URL + "/oauth-bridge.html";
                var url = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl ? window.MV_CONFIG.apiBaseUrl : "https://motionpro.vercel.app")
                        + "/v1/oauth/google/start?return_to=" + encodeURIComponent(bridgeUrl);
                openInBrowser(url);
                // Auto-mostra caixa de código pra colar quando voltar
                var box = $("g-code-box");
                if (box) box.style.display = "block";
                $("g-msg").textContent = "Login Google aberto no navegador. Cole o código aqui depois.";
                $("g-msg").className = "gate__msg ok";
            };
        }

        var gHaveCode = $("g-have-code");
        if (gHaveCode) {
            gHaveCode.onclick = function (e) {
                e.preventDefault();
                var box = $("g-code-box");
                if (box) box.style.display = box.style.display === "none" ? "block" : "none";
            };
        }

        var gCodeCancel = $("g-code-cancel");
        if (gCodeCancel) {
            gCodeCancel.onclick = function () {
                $("g-code-box").style.display = "none";
                $("g-code-input").value = "";
            };
        }

        var gCodeSubmit = $("g-code-submit");
        if (gCodeSubmit) {
            gCodeSubmit.onclick = async function () {
                var token = ($("g-code-input").value || "").trim();
                var msg = $("g-msg");
                if (!token || token.length < 20) {
                    msg.textContent = "Cole o código completo gerado no navegador.";
                    msg.className = "gate__msg err";
                    return;
                }
                gCodeSubmit.disabled = true;
                gCodeSubmit.textContent = "Validando…";
                try {
                    // Valida JWT chamando /v1/me com Bearer token
                    var apiBase = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl) || "https://motionpro.vercel.app";
                    var r = await fetch(apiBase + "/v1/me", {
                        headers: { "Authorization": "Bearer " + token }
                    });
                    if (!r.ok) throw new Error("Código inválido ou expirado (HTTP " + r.status + ")");
                    var me = await r.json();
                    if (!me.email) throw new Error("Resposta inválida do servidor");
                    // Salva como sessão normal
                    localStorage.setItem("mv_session", token);
                    localStorage.setItem("mv_email", me.email);
                    if (me.is_admin) localStorage.setItem("mia_user_meta", JSON.stringify({ is_admin: true }));
                    msg.textContent = "✓ Login Google: " + me.email;
                    msg.className = "gate__msg ok";
                    setTimeout(function () {
                        hideGate(); updateTrialUI(); updateVerifyBar();
                        document.dispatchEvent(new CustomEvent("auth:ready"));
                    }, 600);
                } catch (e) {
                    msg.textContent = "Erro: " + (e.message || e);
                    msg.className = "gate__msg err";
                } finally {
                    gCodeSubmit.disabled = false;
                    gCodeSubmit.textContent = "Entrar com código";
                }
            };
        }
    }

    function daysBetween(future) {
        if (!future) return null;
        var d = (new Date(future) - new Date()) / (1000*60*60*24);
        return Math.max(0, Math.ceil(d));
    }

    function updateTrialUI() {
        var plan = localStorage.getItem("mvi_plan") || "";
        var status = localStorage.getItem("mvi_status") || "";
        var expires = localStorage.getItem("mvi_expires") || "";
        var paywall = $("paywall");

        // Layout v3.0: paywall só mostra se NÃO tiver license key ativada
        // License keys são prioritárias — admin/lifetime user também passa
        var licenseOk = window.LicenseCache && window.LicenseCache.isValidForOfflineUse && window.LicenseCache.isValidForOfflineUse();
        if (licenseOk) {
            if (paywall) paywall.classList.add("hidden");
            return;
        }

        // Master account flag local (mantido por sessões anteriores)
        try {
            var meta = JSON.parse(localStorage.getItem("mia_user_meta") || "{}");
            if (meta.is_admin || meta.lifetime) {
                if (paywall) paywall.classList.add("hidden");
                return;
            }
        } catch (_) {}

        if (plan === "yearly" || plan === "lifetime") {
            if (paywall) paywall.classList.add("hidden");
            return;
        }
        if (plan === "trial" || status === "trialing") {
            var days = daysBetween(expires);
            if (days === null || days <= 0) { showPaywall("Seu trial expirou"); return; }
            if (paywall) paywall.classList.add("hidden");
            return;
        }
        if (plan === "free" || plan === "expired" || status === "expired" || status === "canceled" || status === "revoked") {
            showPaywall(plan === "free" ? "Sem assinatura ativa" : "Sua assinatura expirou");
            return;
        }
    }

    function updateStatusLogin(gated) {
        // Layout v3.0 não tem status-login específico; o sidebar foot mostra email
        var sb = $("sb-email");
        if (sb) sb.textContent = localStorage.getItem("mv_email") || "—";
    }

    function showPaywall(title) {
        var pw = $("paywall"); if (!pw) return;
        var t = pw.querySelector(".paywall__title");
        if (t && title) t.textContent = title;
        pw.classList.remove("hidden");
        var bar = $("trial-bar"); if (bar) bar.className = "trialbar expired";
        var info = $("trial-info"); if (info) info.textContent = "⚠️ " + title;
        updateStatusLogin(true);
    }

    function bindTrialUI() {
        // Layout v3.0 — só pw-logout existe
        var pw = $("pw-logout");
        if (pw) pw.onclick = function () {
            ["mv_session","mv_email","mvi_license","mvi_plan","mvi_status","mvi_expires","mvi_via_bundle","mvi_email_verified"]
                .forEach(function(k){ localStorage.removeItem(k); });
            var paywall = $("paywall"); if (paywall) paywall.classList.add("hidden");
            showGate("login");
        };
        // Elementos antigos não existem — silent skip (defensivo)
    }

    async function checkEmailVerified() {
        if (!localStorage.getItem("mv_session")) return;
        try {
            var r = await api("/v1/me");
            var verified = r.user && r.user.email_verified;
            localStorage.setItem("mvi_email_verified", verified ? "true" : "false");
            if (r.user && r.user.name) localStorage.setItem("mv_name", r.user.name);
            updateVerifyBar();
        } catch (e) {}
    }

    function updateVerifyBar() {
        // Layout v3.0 — verify-bar não existe mais. No-op defensivo.
        var bar = $("verify-bar");
        if (bar) bar.classList.add("hidden");
    }

    function startHeartbeat() {
        if (DEV_BYPASS) return;
        var fp = computeFingerprint();
        var tick = async function () {
            try {
                var r = await api("/v1/license/heartbeat", { fingerprint: fp, product_id: PRODUCT_ID });
                if (r.revoked || r.subscription_inactive) {
                    localStorage.setItem("mvi_plan", r.plan || "free");
                    localStorage.setItem("mvi_status", r.status || "revoked");
                    if (r.expires_at) localStorage.setItem("mvi_expires", r.expires_at);
                    updateTrialUI();
                    return;
                }
                if (r.license) {
                    localStorage.setItem("mvi_license", r.license);
                    localStorage.setItem("mvi_plan", r.plan);
                    localStorage.setItem("mvi_status", r.status || "");
                    localStorage.setItem("mvi_expires", r.expires_at || "");
                    localStorage.setItem("mvi_via_bundle", r.covers_via_bundle ? "true" : "false");
                    updateTrialUI();
                }
            } catch (e) {
                var msg = (typeof e === "string" ? e : (e && e.message)) || "";
                if (msg === "invalid_token" || msg === "missing_token") {
                    ["mv_session","mvi_license","mvi_plan","mvi_status","mvi_expires"].forEach(function(k){ localStorage.removeItem(k); });
                    showGate("login");
                }
            }
        };
        tick(); setInterval(tick, 5*60*1000);
    }

    function tryRestoreSession() {
        if (DEV_BYPASS) { hideGate(); return true; }
        var t = localStorage.getItem("mv_session");
        if (t) { hideGate(); return true; }
        showGate("login");
        return false;
    }

    function init() {
        bindGate();
        bindTrialUI();
        tryRestoreSession();
        updateTrialUI();
        updateVerifyBar();
        if (localStorage.getItem("mv_session")) {
            checkEmailVerified();
            startHeartbeat();
            // Garante que mia_user_meta tem is_admin_verified (refresh do backend)
            refreshUserMeta();
            document.dispatchEvent(new CustomEvent("auth:ready"));
        }
    }

    // Busca /v1/me e salva is_admin_verified em mia_user_meta.
    // Roda no init (sessão restaurada) e após login bem-sucedido.
    async function refreshUserMeta() {
        var tok = localStorage.getItem("mv_session");
        if (!tok) return;
        try {
            var r = await fetch(API_BASE + "/v1/me", { headers: { "Authorization": "Bearer " + tok } });
            if (!r.ok) return;
            var me = await r.json();
            var meta = { is_admin_verified: !!me.is_admin, email: me.email };
            localStorage.setItem("mia_user_meta", JSON.stringify(meta));
            // Atualiza sidebar locks (libera features se virou admin)
            if (window.MIA_Features && window.MIA_Features.updateSidebarLocks) {
                window.MIA_Features.updateSidebarLocks();
                if (window.MIA_Features.renderHomeGrid) window.MIA_Features.renderHomeGrid();
            }
        } catch (_) {}
    }

    function logout() {
        ["mv_session","mv_email","mvi_license","mvi_plan","mvi_status","mvi_expires","mvi_via_bundle","mvi_email_verified","mia_user_meta"]
            .forEach(function(k){ localStorage.removeItem(k); });
    }

    function isLoggedIn() {
        return !!localStorage.getItem("mv_session");
    }

    /* ═══ ε · EPSILON — Reconnect banner (sticky, NEVER logout automático) ═══ */
    function showReconnectBanner() {
        var bar = document.getElementById("reauth-bar");
        if (!bar) {
            bar = document.createElement("div");
            bar.id = "reauth-bar";
            bar.className = "reauthbar";
            bar.innerHTML =
                '<span class="reauthbar__info">🔒 Sessão expirou. Reconecte pra atualizar sua assinatura — cache local continua intacto.</span>' +
                '<button id="btn-reauth-ia" class="reauthbar__cta">Reconectar</button>';
            document.body.insertBefore(bar, document.body.firstChild);
        }
        bar.classList.remove("hidden");
        var btn = document.getElementById("btn-reauth-ia");
        if (btn) btn.onclick = function () {
            bar.classList.add("hidden");
            showGate("login");
        };
    }

    function hideReconnectBanner() {
        var bar = document.getElementById("reauth-bar");
        if (bar) bar.classList.add("hidden");
    }

    /* ═══ ε · Persist session helper (Motion Titles parity shim) ═══ */
    function persistSession(token) {
        if (!token) return Promise.reject(new Error("missing_token"));
        localStorage.setItem("mv_session", token);
        return fetch(API_BASE + "/v1/me", {
            headers: { "Authorization": "Bearer " + token }
        }).then(function (r) {
            if (!r.ok) throw new Error("invalid_token");
            return r.json();
        }).then(function (me) {
            if (me && me.email) localStorage.setItem("mv_email", me.email);
            if (me && me.name)  localStorage.setItem("mv_name",  me.name);
            if (me && me.is_admin) {
                localStorage.setItem("mia_user_meta", JSON.stringify({ is_admin_verified: true, email: me.email }));
            }
            hideReconnectBanner();
            return me;
        });
    }

    /* ═══ ε · Logout com confirmação (NUNCA silent) ═══ */
    function logoutWithConfirm() {
        if (typeof confirm === "function" && !confirm("Sair da conta? Suas configurações locais permanecem.")) return false;
        logout();
        showGate("login");
        return true;
    }

    return {
        init: init,
        api: api,
        computeFingerprint: computeFingerprint,
        openInBrowser: openInBrowser,
        showGate: showGate,
        hideGate: hideGate,
        showReconnectBanner: showReconnectBanner,
        hideReconnectBanner: hideReconnectBanner,
        persistSession: persistSession,
        logoutWithConfirm: logoutWithConfirm,
        logout: logout,
        isLoggedIn: isLoggedIn,
        updateTrialUI: updateTrialUI,
        updateStatusLogin: updateStatusLogin
    };
})();

/* ═══════════════════════════════════════════════════════════════
   ε · window.MvAuth — API unificada (Motion Titles/Legendas parity)
   Shim leve sobre window.Auth pra outros plugins consumirem com
   mesmo contrato. NÃO substitui window.Auth (back-compat).
   ═══════════════════════════════════════════════════════════════ */
window.MvAuth = {
    isLoggedIn: function () { return window.Auth && window.Auth.isLoggedIn(); },
    showAuthScreen: function () { return window.Auth && window.Auth.showGate("login"); },
    hideAuthScreen: function () { return window.Auth && window.Auth.hideGate(); },
    persistSession: function (token) { return window.Auth && window.Auth.persistSession(token); },
    showReconnectBanner: function () { return window.Auth && window.Auth.showReconnectBanner(); },
    hideReconnectBanner: function () { return window.Auth && window.Auth.hideReconnectBanner(); },
    logout: function () { return window.Auth && window.Auth.logoutWithConfirm(); }
};

