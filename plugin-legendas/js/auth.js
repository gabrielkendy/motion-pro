/* auth.js — autenticação + Google OAuth + heartbeat pra Motion Legendas.
 *
 * Reusa o backend MotionVault. Único diferencial vs Motion IA:
 *   - product_id   = "legendas"
 *   - prefixo localStorage = "mtl_*" (Motion Tools Legendas)
 *   - cobertura via bundle Motion Suite (MTS-) aceita
 *
 * Token de sessão é compartilhado com os outros plugins via "mv_session"
 * — SSO unificado (login uma vez vale pros 3 plugins).
 *
 * Migração 1-2 sprints: legacy `mpl_session/mpl_email/mpl_name` é copiado
 * pra `mv_session/mv_email/mv_name` no boot. Mantém ambos por retrocompat.
 */
window.Auth = (function () {
    "use strict";

    var API_BASE     = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl)   || "https://motionpro.vercel.app";
    var PRODUCT_ID   = (window.MV_CONFIG && window.MV_CONFIG.productId)    || "legendas";
    var PRODUCT_NAME = (window.MV_CONFIG && window.MV_CONFIG.productName)  || "Motion Legendas";
    var LANDING_URL  = (window.MV_CONFIG && window.MV_CONFIG.landingUrl)   || "https://motionpro-lp.vercel.app";
    var PRICING_URL  = (window.MV_CONFIG && window.MV_CONFIG.pricingUrl)   || (LANDING_URL + "/legendas/#pricing");
    var DEV_BYPASS   = (window.MV_CONFIG && window.MV_CONFIG.devMode === true);

    function $(id) { return document.getElementById(id); }

    // ── Migração legacy: mpl_session → mv_session (não desloga users antigos) ──
    function migrateLegacySession() {
        try {
            if (!localStorage.getItem("mv_session") && localStorage.getItem("mpl_session")) {
                localStorage.setItem("mv_session", localStorage.getItem("mpl_session"));
            }
            if (!localStorage.getItem("mv_email") && localStorage.getItem("mpl_email")) {
                localStorage.setItem("mv_email", localStorage.getItem("mpl_email"));
            }
            if (!localStorage.getItem("mv_name") && localStorage.getItem("mpl_name")) {
                localStorage.setItem("mv_name", localStorage.getItem("mpl_name"));
            }
        } catch (_) {}
    }
    migrateLegacySession();

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
        return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + s.length.toString(16);
    }

    function openInBrowser(url) {
        try { new CSInterface().openURLInDefaultBrowser(url); return; } catch (e) {}
        try { window.cep.util.openURLInDefaultBrowser(url); return; } catch (e) {}
        try { window.open(url, "_blank"); return; } catch (e) {}
    }

    function setGateMode(mode) {
        var isSignup = mode === "signup";
        if ($("gt-login"))  $("gt-login").classList.toggle("active", !isSignup);
        if ($("gt-signup")) $("gt-signup").classList.toggle("active", isSignup);
        if ($("g-submit"))  $("g-submit").textContent = isSignup ? "Criar conta · 7 dias grátis" : "Entrar";
        if ($("g-msg"))     { $("g-msg").textContent = ""; $("g-msg").className = "gate__msg"; }
        if ($("g-submit"))  $("g-submit").dataset.mode = mode;
        [].forEach.call(document.querySelectorAll(".signup-only"), function (el) { el.hidden = !isSignup; });
        if ($("g-password")) $("g-password").autocomplete = isSignup ? "new-password" : "current-password";
    }

    function showGate(mode) {
        var g = $("gate"); if (g) g.classList.remove("hidden");
        setGateMode(mode || "login");
    }
    function hideGate() {
        var g = $("gate"); if (g) g.classList.add("hidden");
    }

    function bindGate() {
        if ($("gt-login"))  $("gt-login").onclick  = function () { setGateMode("login"); };
        if ($("gt-signup")) $("gt-signup").onclick = function () { setGateMode("signup"); };
        if ($("g-forgot"))  $("g-forgot").onclick  = function (e) {
            e.preventDefault();
            var email = $("g-email") ? $("g-email").value.trim() : "";
            openInBrowser(LANDING_URL + "/reset-password.html" + (email ? "?email=" + encodeURIComponent(email) : ""));
            if ($("g-msg")) { $("g-msg").textContent = "✓ Página de recuperação aberta no navegador"; $("g-msg").className = "gate__msg ok"; }
        };

        if ($("g-submit")) $("g-submit").onclick = async function () {
            var mode = $("g-submit").dataset.mode || "login";
            var email = ($("g-email") && $("g-email").value || "").trim().toLowerCase();
            var password = ($("g-password") && $("g-password").value) || "";
            var name  = ($("g-name") && $("g-name").value || "").trim();
            var phone = ($("g-phone") && $("g-phone").value || "").trim();
            var msg = $("g-msg"), sub = $("g-submit");
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
                    payload.name = name; payload.phone = phone || null;
                }
                var data = await api("/v1/auth/" + mode, payload);
                localStorage.setItem("mv_session", data.session_token || data.token);
                localStorage.setItem("mv_email", email);
                if (name) localStorage.setItem("mv_name", name);

                // Refresh user meta (is_admin verificado pelo backend)
                try {
                    var meRes = await fetch(API_BASE + "/v1/me", {
                        headers: { "Authorization": "Bearer " + (data.session_token || data.token) }
                    });
                    if (meRes.ok) {
                        var me = await meRes.json();
                        var meta = { is_admin_verified: !!me.is_admin, email: me.email };
                        localStorage.setItem("mtl_user_meta", JSON.stringify(meta));
                    }
                } catch (_) {}

                // Tenta emitir licença/trial pra esse produto (legendas)
                try {
                    var lic = await api("/v1/license/issue", { fingerprint: fp, product_id: PRODUCT_ID });
                    if (lic) {
                        if (lic.license)  localStorage.setItem("mtl_license", lic.license);
                        if (lic.plan)     localStorage.setItem("mtl_plan", lic.plan);
                        if (lic.status)   localStorage.setItem("mtl_status", lic.status);
                        if (lic.expires_at) localStorage.setItem("mtl_expires", lic.expires_at);
                        localStorage.setItem("mtl_via_bundle", lic.covers_via_bundle ? "true" : "false");
                    }
                } catch (_) { /* sem licença ainda é ok — paywall trata */ }

                if (msg) {
                    msg.textContent = "✓ " + (mode === "signup" ? "Conta criada! Trial de 7 dias ativo." : "Bem-vindo!");
                    msg.className = "gate__msg ok";
                }
                setTimeout(function () {
                    hideGate();
                    updateTrialUI();
                    fireAuthReady();
                }, 500);
            } catch (e) {
                if (msg) {
                    msg.textContent = "Erro: " + (typeof e === "string" ? e : (e.message || "falha"));
                    msg.className = "gate__msg err";
                }
            }
            sub.disabled = false;
        };

        // ────────── Google OAuth (device-style: browser externo + paste JWT) ──────────
        if ($("g-google")) {
            $("g-google").onclick = function () {
                var bridgeUrl = LANDING_URL + "/oauth-bridge.html#plugin=legendas";
                var url = API_BASE
                        + "/v1/oauth/google/start?plugin=" + encodeURIComponent(PRODUCT_ID)
                        + "&return_to=" + encodeURIComponent(bridgeUrl);
                openInBrowser(url);
                var box = $("g-code-box");
                if (box) box.style.display = "block";
                if ($("g-msg")) {
                    $("g-msg").textContent = "Login Google aberto no navegador. Cole o código aqui depois.";
                    $("g-msg").className = "gate__msg ok";
                }
            };
        }

        if ($("g-have-code")) {
            $("g-have-code").onclick = function (e) {
                e.preventDefault();
                var box = $("g-code-box");
                if (box) box.style.display = box.style.display === "none" ? "block" : "none";
            };
        }

        if ($("g-code-cancel")) {
            $("g-code-cancel").onclick = function () {
                if ($("g-code-box"))   $("g-code-box").style.display = "none";
                if ($("g-code-input")) $("g-code-input").value = "";
            };
        }

        if ($("g-code-submit")) {
            $("g-code-submit").onclick = async function () {
                var token = ($("g-code-input") && $("g-code-input").value || "").trim();
                var msg = $("g-msg");
                if (!token || token.length < 20) {
                    if (msg) { msg.textContent = "Cole o código completo gerado no navegador."; msg.className = "gate__msg err"; }
                    return;
                }
                $("g-code-submit").disabled = true;
                $("g-code-submit").textContent = "Validando…";
                try {
                    var r = await fetch(API_BASE + "/v1/me", {
                        headers: { "Authorization": "Bearer " + token }
                    });
                    if (!r.ok) throw new Error("Código inválido ou expirado (HTTP " + r.status + ")");
                    var me = await r.json();
                    if (!me.email) throw new Error("Resposta inválida do servidor");
                    localStorage.setItem("mv_session", token);
                    localStorage.setItem("mv_email", me.email);
                    if (me.name) localStorage.setItem("mv_name", me.name);
                    var meta = { is_admin_verified: !!me.is_admin, email: me.email };
                    localStorage.setItem("mtl_user_meta", JSON.stringify(meta));

                    // Tenta puxar licença pós-OAuth
                    try {
                        var fp = computeFingerprint();
                        var lic = await api("/v1/license/issue", { fingerprint: fp, product_id: PRODUCT_ID });
                        if (lic) {
                            if (lic.license)  localStorage.setItem("mtl_license", lic.license);
                            if (lic.plan)     localStorage.setItem("mtl_plan", lic.plan);
                            if (lic.status)   localStorage.setItem("mtl_status", lic.status);
                            if (lic.expires_at) localStorage.setItem("mtl_expires", lic.expires_at);
                            localStorage.setItem("mtl_via_bundle", lic.covers_via_bundle ? "true" : "false");
                        }
                    } catch (_) {}

                    if (msg) { msg.textContent = "✓ Login Google: " + me.email; msg.className = "gate__msg ok"; }
                    setTimeout(function () {
                        hideGate();
                        updateTrialUI();
                        fireAuthReady();
                    }, 600);
                } catch (e) {
                    if (msg) {
                        msg.textContent = "Erro: " + (e.message || e);
                        msg.className = "gate__msg err";
                    }
                } finally {
                    $("g-code-submit").disabled = false;
                    $("g-code-submit").textContent = "Entrar com código";
                }
            };
        }
    }

    // ── Triggers de boot pro main.js ─────────────────────────────────
    function fireAuthReady() {
        try { document.dispatchEvent(new CustomEvent("auth:ready")); } catch (_) {}
        // Backward compat com auth.js antigo do plugin-legendas
        if (typeof window.MPL_onAuthReady === "function") {
            try { window.MPL_onAuthReady(); } catch (e) { console.warn("[auth] MPL_onAuthReady falhou:", e); }
        }
    }

    function daysBetween(future) {
        if (!future) return null;
        var d = (new Date(future) - new Date()) / (1000 * 60 * 60 * 24);
        return Math.max(0, Math.ceil(d));
    }

    function updateTrialUI() {
        var plan    = localStorage.getItem("mtl_plan") || "";
        var status  = localStorage.getItem("mtl_status") || "";
        var expires = localStorage.getItem("mtl_expires") || "";
        var paywall = $("paywall");

        // License key MTL-/MTS- ativada via LicenseCache tem prioridade total
        var licenseOk = window.LicenseCache && window.LicenseCache.isValidForOfflineUse && window.LicenseCache.isValidForOfflineUse();
        if (licenseOk) {
            if (paywall) paywall.classList.add("hidden");
            return;
        }

        // Admin verificado → libera
        try {
            var meta = JSON.parse(localStorage.getItem("mtl_user_meta") || "{}");
            if (meta.is_admin_verified) {
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
            renderTrialBar(days);
            return;
        }
        if (plan === "free" || plan === "expired" || status === "expired" || status === "canceled" || status === "revoked") {
            showPaywall(plan === "free" ? "Sem assinatura ativa" : "Sua assinatura expirou");
            return;
        }
    }

    function renderTrialBar(days) {
        var bar = $("trial-bar");
        if (!bar) return;
        bar.classList.remove("hidden", "expired", "warn");
        if (days <= 2) bar.classList.add("warn");
        if (days <= 0) bar.classList.add("expired");
        var info = $("trial-info");
        if (info) info.textContent = days > 0 ? ("⏰ Trial: " + days + " dia" + (days === 1 ? "" : "s")) : "Trial expirado";
    }

    function showPaywall(title) {
        var pw = $("paywall"); if (!pw) return;
        var t = pw.querySelector(".paywall__title");
        if (t && title) t.textContent = title;
        pw.classList.remove("hidden");
    }

    function bindTrialUI() {
        var pwLogout = $("paywall-logout");
        if (pwLogout) pwLogout.onclick = logout;
        var pwCta = $("paywall-cta");
        if (pwCta) pwCta.onclick = function () { openInBrowser(PRICING_URL); };
        var trialBtn = $("btn-upgrade");
        if (trialBtn) trialBtn.onclick = function () { openInBrowser(PRICING_URL); };
    }

    function startHeartbeat() {
        if (DEV_BYPASS) return;
        var fp = computeFingerprint();
        var tick = async function () {
            try {
                var r = await api("/v1/license/heartbeat", { fingerprint: fp, product_id: PRODUCT_ID });
                if (r.revoked || r.subscription_inactive) {
                    localStorage.setItem("mtl_plan", r.plan || "free");
                    localStorage.setItem("mtl_status", r.status || "revoked");
                    if (r.expires_at) localStorage.setItem("mtl_expires", r.expires_at);
                    updateTrialUI();
                    return;
                }
                if (r.license) {
                    localStorage.setItem("mtl_license", r.license);
                    localStorage.setItem("mtl_plan", r.plan);
                    localStorage.setItem("mtl_status", r.status || "");
                    localStorage.setItem("mtl_expires", r.expires_at || "");
                    localStorage.setItem("mtl_via_bundle", r.covers_via_bundle ? "true" : "false");
                    updateTrialUI();
                }
            } catch (e) {
                var msg = (typeof e === "string" ? e : (e && e.message)) || "";
                // Sticky session: invalid_token NÃO desloga imediatamente.
                // Chunk 7 vai mostrar banner "Reconectar" em vez de forçar logout.
                if (msg === "invalid_token" || msg === "missing_token") {
                    console.warn("[auth] heartbeat token inválido — sticky session, aguardando reconectar");
                }
            }
        };
        tick();
        setInterval(tick, 5 * 60 * 1000);
    }

    async function refreshUserMeta() {
        var tok = localStorage.getItem("mv_session");
        if (!tok) return;
        try {
            var r = await fetch(API_BASE + "/v1/me", { headers: { "Authorization": "Bearer " + tok } });
            if (!r.ok) return;
            var me = await r.json();
            var meta = { is_admin_verified: !!me.is_admin, email: me.email };
            localStorage.setItem("mtl_user_meta", JSON.stringify(meta));
            if (me.name) localStorage.setItem("mv_name", me.name);
            // Hook pro Chunk 6 (tier-gating) atualizar locks ao logar
            if (window.MPL_Features && typeof window.MPL_Features.refresh === "function") {
                try { window.MPL_Features.refresh(); } catch (_) {}
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
        [
            "mv_session", "mv_email", "mv_name",
            "mtl_license", "mtl_plan", "mtl_status", "mtl_expires",
            "mtl_via_bundle", "mtl_email_verified", "mtl_user_meta",
            // limpa legacy também
            "mpl_session", "mpl_email", "mpl_name"
        ].forEach(function (k) { localStorage.removeItem(k); });
        // Limpa cache de licença MTL-
        if (window.LicenseCache && typeof window.LicenseCache.clearCache === "function") {
            try { window.LicenseCache.clearCache(); } catch (_) {}
        }
        var pw = $("paywall"); if (pw) pw.classList.add("hidden");
        showGate("login");
    }

    function isLoggedIn() {
        return !!localStorage.getItem("mv_session");
    }

    function init() {
        bindGate();
        bindTrialUI();
        tryRestoreSession();
        updateTrialUI();
        if (isLoggedIn()) {
            refreshUserMeta();
            startHeartbeat();
            fireAuthReady();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else { init(); }

    // ── API pública ──────────────────────────────────────────────────
    var Public = {
        init:               init,
        api:                api,
        computeFingerprint: computeFingerprint,
        openInBrowser:      openInBrowser,
        showGate:           showGate,
        hideGate:           hideGate,
        logout:             logout,
        isLoggedIn:         isLoggedIn,
        updateTrialUI:      updateTrialUI,
        refreshUserMeta:    refreshUserMeta,
        getState:           function () {
            return {
                sessionToken: localStorage.getItem("mv_session") || null,
                email:        localStorage.getItem("mv_email") || null,
                name:         localStorage.getItem("mv_name") || null,
                plan:         localStorage.getItem("mtl_plan") || null,
                status:       localStorage.getItem("mtl_status") || null
            };
        }
    };

    // Backward compat com auth antigo (main.js pode referenciar)
    window.MPLAuth = Public;

    return Public;
})();
