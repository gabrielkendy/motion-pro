/* Motion Legendas v4.0 — auth.js (JWT MotionVault)
 * Substitui o login Firebase do EP Legendas.
 * Roda ANTES de main.js. Expõe window.MPLAuth.
 */
(function () {
"use strict";

var CFG = window.MV_CONFIG || {};
var API = CFG.apiBaseUrl || "https://motionpro.vercel.app";
var PRODUCT = CFG.productId || "legendas";

var STATE = {
    sessionToken: localStorage.getItem("mpl_session") || null,
    email: localStorage.getItem("mpl_email") || null,
    name: localStorage.getItem("mpl_name") || null,
    subscription: null,
    plan: null,
    trialEndsAt: null
};

function $(id) { return document.getElementById(id); }
function show(id, val) { var el = $(id); if (el) el.style.display = val ? "" : "none"; }
function setText(id, t) { var el = $(id); if (el) el.textContent = t; }
function setError(msg, ok) {
    var el = $("login-error"); if (!el) return;
    el.textContent = msg || "";
    el.className = ok ? "ok" : "";
}

function api(path, body, opts) {
    opts = opts || {};
    var headers = { "Content-Type": "application/json" };
    if (STATE.sessionToken) headers["Authorization"] = "Bearer " + STATE.sessionToken;
    return fetch(API + path, {
        method: opts.method || (body ? "POST" : "GET"),
        headers: headers,
        body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
        return r.json().then(function (data) {
            if (!r.ok) throw new Error((data && data.error) || ("http_" + r.status));
            return data;
        });
    });
}

function showLoginOverlay() {
    var ov = $("login-overlay"); if (ov) ov.classList.remove("hidden");
    setError("");
}
function hideLoginOverlay() {
    var ov = $("login-overlay"); if (ov) ov.classList.add("hidden");
}
function showPaywall() {
    var pw = $("paywall"); if (pw) pw.classList.remove("hidden");
}
function hidePaywall() {
    var pw = $("paywall"); if (pw) pw.classList.add("hidden");
}

function toggleSignupMode(toSignup) {
    var hide = document.querySelectorAll(".signup-hide");
    var show = document.querySelectorAll(".signup-show");
    hide.forEach(function (el) { el.style.display = toSignup ? "none" : ""; });
    show.forEach(function (el) { el.style.display = toSignup ? "" : "none"; });
    var btn = $("login-confirm"); if (btn) btn.textContent = toSignup ? "Criar conta" : "Entrar";
    var hdr = document.querySelector("#login-overlay .capture-modal-header span");
    if (hdr) hdr.textContent = toSignup ? "Criar conta · 7 dias grátis" : "Entrar no Motion Legendas";
    window.__MPL_SIGNUP = toSignup;
}

function bindLoginUI() {
    var btn = $("login-confirm"); if (btn) btn.onclick = function () { handleLoginOrSignup(); };
    var emailInp = $("login-email");
    var pwInp = $("login-password");
    if (emailInp) emailInp.addEventListener("keydown", function (e) { if (e.key === "Enter") handleLoginOrSignup(); });
    if (pwInp)    pwInp.addEventListener("keydown", function (e) { if (e.key === "Enter") handleLoginOrSignup(); });

    var togSignup = $("login-toggle-signup");
    if (togSignup) togSignup.onclick = function () { toggleSignupMode(true); };
    var togLogin = $("login-toggle-login");
    if (togLogin) togLogin.onclick = function () { toggleSignupMode(false); };
    var forgot = $("login-forgot");
    if (forgot) forgot.onclick = function () {
        var em = (emailInp && emailInp.value) || "";
        if (!em) { setError("Digite seu email primeiro"); return; }
        api("/v1/auth/forgot", { email: em }).then(function () {
            setError("Email enviado se a conta existir", true);
        }).catch(function (e) { setError("Erro: " + e.message); });
    };

    // paywall
    var pwCta = $("paywall-cta");
    if (pwCta) pwCta.onclick = function () { openExternal(CFG.pricingUrl); };
    var pwOut = $("paywall-logout");
    if (pwOut) pwOut.onclick = logout;
    var trialBtn = $("btn-upgrade");
    if (trialBtn) trialBtn.onclick = function () { openExternal(CFG.pricingUrl); };
}

function openExternal(url) {
    try {
        var cs = new CSInterface();
        cs.openURLInDefaultBrowser(url);
    } catch (e) { window.open(url, "_blank"); }
}

function handleLoginOrSignup() {
    var em = ($("login-email") && $("login-email").value || "").trim();
    var pw = ($("login-password") && $("login-password").value || "");
    if (!em || !pw) { setError("Preencha email e senha"); return; }
    if (pw.length < 8) { setError("Senha precisa de pelo menos 8 caracteres"); return; }

    var isSignup = !!window.__MPL_SIGNUP;
    if (isSignup) {
        var nm = ($("signup-name") && $("signup-name").value || "").trim();
        var ph = ($("signup-phone") && $("signup-phone").value || "").trim();
        if (!nm) { setError("Digite seu nome"); return; }
        setError("Criando conta…", true);
        api("/v1/auth/signup", { email: em, password: pw, name: nm, phone: ph, productId: PRODUCT })
            .then(onAuthOK)
            .catch(function (e) { setError("Erro: " + e.message); });
    } else {
        setError("Entrando…", true);
        api("/v1/auth/login", { email: em, password: pw })
            .then(onAuthOK)
            .catch(function (e) { setError("Erro: " + e.message); });
    }
}

function onAuthOK(data) {
    STATE.sessionToken = data.session_token || data.token;
    STATE.email = data.email || ($("login-email") && $("login-email").value);
    STATE.name  = data.name  || null;
    localStorage.setItem("mpl_session", STATE.sessionToken);
    localStorage.setItem("mpl_email", STATE.email);
    if (STATE.name) localStorage.setItem("mpl_name", STATE.name);
    setText("status-user", STATE.email);
    var dot = document.getElementById("header-status-dot"); if (dot) { dot.classList.remove("dot-idle","dot-err"); dot.classList.add("dot-ok"); }
    hideLoginOverlay();
    // verifica assinatura
    checkSubscription();
    // dispara hook pro main.js iniciar
    if (typeof window.MPL_onAuthReady === "function") window.MPL_onAuthReady();
}

function checkSubscription() {
    if (!STATE.sessionToken) return;
    api("/v1/license/issue", { productId: PRODUCT })
        .then(function (d) {
            STATE.subscription = d.status;
            STATE.plan = d.plan;
            STATE.trialEndsAt = d.trial_ends_at || null;
            renderTrialBar(d);
            hidePaywall();
        })
        .catch(function (e) {
            if (String(e.message).indexOf("subscription_inactive") >= 0) {
                showPaywall();
            } else {
                console.warn("[MPL] license/issue:", e.message);
            }
        });
}

function renderTrialBar(d) {
    var bar = document.getElementById("trial-bar");
    if (!bar) return;
    if (d.plan === "lifetime" || d.plan === "yearly") { bar.classList.add("hidden"); return; }
    if (d.status === "trialing" && d.trial_ends_at) {
        var ms = new Date(d.trial_ends_at).getTime() - Date.now();
        var days = Math.ceil(ms / 86400000);
        bar.classList.remove("hidden", "expired", "warn");
        if (days <= 2) bar.classList.add("warn");
        if (days <= 0) bar.classList.add("expired");
        var info = document.getElementById("trial-info");
        if (info) info.textContent = days > 0 ? ("⏰ Trial: " + days + " dia" + (days===1?"":"s")) : "Trial expirado";
        return;
    }
    bar.classList.add("hidden");
}

function logout() {
    STATE.sessionToken = null; STATE.email = null;
    localStorage.removeItem("mpl_session");
    localStorage.removeItem("mpl_email");
    localStorage.removeItem("mpl_name");
    hidePaywall();
    setText("status-user", "—");
    var dot = document.getElementById("header-status-dot"); if (dot) { dot.classList.remove("dot-ok"); dot.classList.add("dot-idle"); }
    showLoginOverlay();
    toggleSignupMode(false);
}

function tryRestoreSession() {
    if (!STATE.sessionToken) { showLoginOverlay(); return; }
    setText("status-user", STATE.email || "");
    var dot = document.getElementById("header-status-dot"); if (dot) { dot.classList.remove("dot-idle"); dot.classList.add("dot-ok"); }
    checkSubscription();
    if (typeof window.MPL_onAuthReady === "function") window.MPL_onAuthReady();
}

function init() {
    bindLoginUI();
    tryRestoreSession();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else { init(); }

window.MPLAuth = {
    api: api, logout: logout,
    getState: function () { return STATE; },
    openExternal: openExternal
};

})();
