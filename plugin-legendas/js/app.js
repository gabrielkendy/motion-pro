/* MotionPro Legendas — painel CEP
 *
 * Reusa toda a arquitetura de auth do MotionPro:
 *  - Login/signup inline
 *  - Trial bar com countdown
 *  - Banner de verificação de email
 *  - Paywall com botão pra browser
 *
 * UI específica: navega packs → categorias → títulos → insere na timeline.
 */
"use strict";

(function () {

var $ = function (id) { return document.getElementById(id); };
var fs = require("fs");
var nodePath = require("path");
var cs = new CSInterface();

// ============================================================ paths
function normalizeExtPath(p) {
    if (!p) return ".";
    return decodeURI(p).replace(/^file:[\\\/]+/i, "").replace(/\//g, "\\");
}
var EXT_PATH = normalizeExtPath(cs.getSystemPath(CSInterface.SystemPath.EXTENSION));

// ============================================================ config
var API_BASE     = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl)   || "https://motionpro.vercel.app";
var PRODUCT_ID   = (window.MV_CONFIG && window.MV_CONFIG.productId)    || "legendas";
var PRODUCT_NAME = (window.MV_CONFIG && window.MV_CONFIG.productName)  || "MotionPro Legendas";
var LANDING_URL  = (window.MV_CONFIG && window.MV_CONFIG.landingUrl)   || "https://motionpro-lp.vercel.app";
var PRICING_URL  = (window.MV_CONFIG && window.MV_CONFIG.pricingUrl)   || (LANDING_URL + "/legendas/#pricing");
var DEV_BYPASS   = (window.MV_CONFIG && window.MV_CONFIG.devMode === true);

// ============================================================ helpers UI
function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}
function toast(text, kind, ms) {
    var t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2200);
}
function openInBrowser(url) {
    try {
        if (typeof CSInterface !== "undefined") {
            var ci = new CSInterface();
            ci.openURLInDefaultBrowser(url);
            return true;
        }
    } catch (_) {}
    try {
        if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
            window.cep.util.openURLInDefaultBrowser(url);
            return true;
        }
    } catch (_) {}
    try { window.open(url, "_blank"); return true; } catch (_) {}
    toast("Cole no navegador: " + url, "warn", 5000);
    return false;
}

// ============================================================ catalog (packs)
var CATALOG = null;
var INDEX = [];

function loadCatalog() {
    try {
        // Catálogo local distribuído com o plugin (gerado pelo build do ZIP)
        var file = nodePath.join(EXT_PATH, "packs", "catalog.json");
        if (fs.existsSync(file)) {
            CATALOG = JSON.parse(fs.readFileSync(file, "utf8"));
        } else {
            // Fallback mínimo se catálogo não foi distribuído
            CATALOG = { packs: [], total_items: 0 };
        }
        return true;
    } catch (e) {
        console.error("loadCatalog fail:", e);
        CATALOG = { packs: [], total_items: 0 };
        return false;
    }
}

function buildIndex() {
    INDEX = [];
    (CATALOG.packs || []).forEach(function (p) { walk(p.categories || [], p, []); });
}
function walk(nodes, pack, crumb) {
    nodes.forEach(function (n) {
        if (n.items) n.items.forEach(function (it) {
            INDEX.push({ pack: pack, cat: crumb.concat(n.name).join(" › "), item: it });
        });
        if (n.children) walk(n.children, pack, crumb.concat(n.name));
    });
}
function countItems(node) {
    var n = node.items ? node.items.length : 0;
    if (node.children) node.children.forEach(function (c) { n += countItems(c); });
    return n;
}
function countPackItems(p) {
    return (p.categories || []).reduce(function (a, c) { return a + countItems(c); }, 0);
}

// ============================================================ favorites
var FAVS = (function () {
    try { return JSON.parse(localStorage.getItem("mvl_favs") || "[]"); }
    catch (e) { return []; }
})();
function favSave() { try { localStorage.setItem("mvl_favs", JSON.stringify(FAVS)); } catch (e) {} }
function favKey(item) { return item.mogrt || item.preview || item.name; }
function isFav(item) { return FAVS.indexOf(favKey(item)) >= 0; }
function toggleFav(item) {
    var k = favKey(item), i = FAVS.indexOf(k);
    if (i >= 0) FAVS.splice(i, 1); else FAVS.push(k);
    favSave();
}

// ============================================================ state
var STATE = {
    pack: null,
    catPath: [],
    expanded: {},
    search: "",
    page: 0,
    pageSize: 60,
    items: []
};

// ============================================================ UI: tabs
function renderTabs() {
    var el = $("tabs"); el.innerHTML = "";
    (CATALOG.packs || []).forEach(function (p) {
        var t = document.createElement("div");
        t.className = "tab";
        t.dataset.id = p.id;
        t.innerHTML = '<span>' + esc(p.name) + '</span><span class="tab__count">' + countPackItems(p) + '</span>';
        t.onclick = function () { selectPack(p.id); };
        el.appendChild(t);
    });
    if (CATALOG.packs && CATALOG.packs.length === 0) {
        $("status").textContent = "Nenhum pack instalado · re-instale o plugin pra incluir os packs";
    }
}

function selectPack(id) {
    STATE.pack = id; STATE.catPath = []; STATE.search = ""; STATE.page = 0;
    STATE.expanded = {};
    $("q").value = ""; $("q-clear").classList.add("hidden");
    [].forEach.call(document.querySelectorAll(".tab"), function (t) {
        t.classList.toggle("on", t.dataset.id === id);
    });
    renderSide(); renderGrid(); renderBreadcrumb();
}

function packById(id) {
    for (var i = 0; i < (CATALOG.packs || []).length; i++) if (CATALOG.packs[i].id === id) return CATALOG.packs[i];
    return null;
}

// ============================================================ UI: breadcrumb
function renderBreadcrumb() {
    var el = $("breadcrumb"); el.innerHTML = "";
    var crumbs = [];
    if (STATE.search) {
        crumbs.push({ label: 'Busca: "' + STATE.search + '"', last: true });
    } else if (STATE.pack === "__favs__") {
        crumbs.push({ label: "★ Favoritos", last: true });
    } else {
        var p = packById(STATE.pack);
        if (p) crumbs.push({ label: p.name, last: !STATE.catPath.length });
        STATE.catPath.forEach(function (c, i) {
            crumbs.push({ label: c, last: i === STATE.catPath.length - 1 });
        });
    }
    crumbs.forEach(function (c, i) {
        if (i > 0) {
            var sep = document.createElement("span");
            sep.className = "crumb__sep"; sep.textContent = "›";
            el.appendChild(sep);
        }
        var s = document.createElement("span");
        s.className = "crumb" + (c.last ? " last" : "");
        s.textContent = c.label;
        el.appendChild(s);
    });
}

// ============================================================ UI: sidebar
function renderSide() {
    var el = $("side"); el.innerHTML = "";
    if (STATE.pack === "__favs__") return;
    var p = packById(STATE.pack); if (!p) return;
    (p.categories || []).forEach(function (root) { renderCat(root, 0, [], el); });
}
function renderCat(node, depth, crumb, container) {
    var path = crumb.concat(node.name);
    var pathKey = path.join("/");
    var hasChildren = !!(node.children && node.children.length);
    var count = countItems(node);

    var d = document.createElement("div");
    d.className = "cat " + (depth === 0 ? "cat--root" : "cat--child");
    var isActive = STATE.catPath.join("/") === pathKey;
    if (isActive) d.classList.add("on");
    d.innerHTML = '<span class="cat__chev">' + (hasChildren ? '▸' : '·') + '</span>' +
                  '<span class="cat__name">' + esc(node.name) + '</span>' +
                  '<span class="cat__num">' + count + '</span>';
    d.onclick = function (e) {
        e.stopPropagation();
        STATE.catPath = path; STATE.page = 0;
        renderSide(); renderGrid(); renderBreadcrumb();
    };
    container.appendChild(d);

    if (hasChildren && (STATE.expanded[pathKey] || isActive || STATE.catPath.join("/").indexOf(pathKey) === 0)) {
        STATE.expanded[pathKey] = true;
        node.children.forEach(function (c) { renderCat(c, depth + 1, path, container); });
    }
}

// ============================================================ UI: grid
function collectItems() {
    var out = [];
    if (STATE.search) {
        var q = STATE.search.toLowerCase();
        INDEX.forEach(function (e) {
            if (e.item.name.toLowerCase().indexOf(q) >= 0) out.push(e);
        });
        return out;
    }
    if (STATE.pack === "__favs__") {
        INDEX.forEach(function (e) { if (isFav(e.item)) out.push(e); });
        return out;
    }
    var p = packById(STATE.pack); if (!p) return out;
    function walkP(nodes, crumb) {
        nodes.forEach(function (n) {
            var path = crumb.concat(n.name);
            if (n.items && (STATE.catPath.length === 0 || path.join("/").indexOf(STATE.catPath.join("/")) === 0)) {
                n.items.forEach(function (it) { out.push({ pack: p, cat: path.join(" › "), item: it }); });
            }
            if (n.children) walkP(n.children, path);
        });
    }
    walkP(p.categories || [], []);
    return out;
}

function renderGrid() {
    var el = $("grid"); el.innerHTML = "";
    var items = collectItems();
    var page = items.slice(0, (STATE.page + 1) * STATE.pageSize);
    $("count").textContent = items.length + " títulos";

    page.forEach(function (e) {
        var card = document.createElement("div");
        card.className = "card";
        var fav = isFav(e.item) ? "on" : "";
        var preview = e.item.preview ? nodePath.join(EXT_PATH, "packs", e.item.preview) : null;
        card.innerHTML =
            '<div class="card__thumb">' +
                (preview ? '<img loading="lazy" src="' + esc("file:///" + preview.replace(/\\/g, "/")) + '">' : '<div class="card__placeholder">' + esc(e.item.name.substr(0,2).toUpperCase()) + '</div>') +
            '</div>' +
            '<div class="card__title" title="' + esc(e.item.name) + '">' + esc(e.item.name) + '</div>' +
            '<button class="card__fav ' + fav + '" title="Favoritar">★</button>';
        card.ondblclick = function () { insertItem(e.item); };
        card.querySelector(".card__fav").onclick = function (ev) {
            ev.stopPropagation(); toggleFav(e.item); renderGrid();
        };
        el.appendChild(card);
    });

    if (items.length > page.length) {
        var more = document.createElement("button");
        more.className = "load-more";
        more.textContent = "Carregar mais (" + (items.length - page.length) + ")";
        more.onclick = function () { STATE.page++; renderGrid(); };
        el.appendChild(more);
    }
    if (items.length === 0) {
        el.innerHTML = '<div class="empty">Nenhum título encontrado</div>';
    }
}

// ============================================================ insert
function insertItem(item) {
    if (!item.mogrt) { toast("Item sem .mogrt path", "err"); return; }
    var abs = nodePath.join(EXT_PATH, "packs", item.mogrt);
    var jsx = 'MotionProLegendas.importMogrt(' + JSON.stringify(abs) + ');';
    cs.evalScript(jsx, function (r) {
        try {
            var d = JSON.parse(r);
            if (d.error) toast("Erro: " + d.error, "err", 3500);
            else toast("✓ " + (d.name || item.name) + " inserido", "ok");
        } catch (e) { toast("Falha ao inserir", "err"); }
    });
}

// ============================================================ search
$("q").addEventListener("input", function (e) {
    STATE.search = e.target.value.trim();
    STATE.page = 0;
    $("q-clear").classList.toggle("hidden", !STATE.search);
    renderGrid(); renderBreadcrumb();
});
$("q-clear").addEventListener("click", function () {
    $("q").value = ""; STATE.search = "";
    $("q-clear").classList.add("hidden");
    renderGrid(); renderBreadcrumb();
});
$("btn-favorites").addEventListener("click", function () { selectPack("__favs__"); });

// ============================================================ AUTH (idêntico ao MotionPro)
function gateApi(path, body) {
    var token = localStorage.getItem("mv_session");
    return fetch(API_BASE + path, {
        method: body ? "POST" : "GET",
        headers: Object.assign(
            { "Content-Type": "application/json" },
            token ? { "Authorization": "Bearer " + token } : {}
        ),
        body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
        return r.json().then(function (data) {
            if (!r.ok) throw (data && data.error) || ("http_" + r.status);
            return data;
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

function showGate(mode) {
    var g = $("gate"); if (!g) return;
    g.classList.remove("hidden");
    setGateMode(mode || "login");
}
function hideGate() { var g = $("gate"); if (g) g.classList.add("hidden"); }
function setGateMode(mode) {
    var isSignup = mode === "signup";
    $("gt-login").classList.toggle("active", !isSignup);
    $("gt-signup").classList.toggle("active", isSignup);
    $("g-submit").textContent = isSignup ? "Criar conta · iniciar 14 dias grátis" : "Entrar";
    $("g-msg").textContent = ""; $("g-msg").className = "gate__msg";
    $("g-submit").dataset.mode = mode;
    [].forEach.call(document.querySelectorAll(".signup-only"), function (el) { el.hidden = !isSignup; });
    $("g-password").autocomplete = isSignup ? "new-password" : "current-password";
}

function bindGate() {
    if (!$("gt-login")) return;
    $("gt-login").onclick = function () { setGateMode("login"); };
    $("gt-signup").onclick = function () { setGateMode("signup"); };
    $("g-forgot").onclick = function (e) {
        e.preventDefault();
        var email = $("g-email").value.trim();
        var url = LANDING_URL + "/reset-password.html" + (email ? "?email=" + encodeURIComponent(email) : "");
        openInBrowser(url);
        $("g-msg").textContent = "✓ Página de recuperação aberta no navegador";
        $("g-msg").className = "gate__msg ok";
    };
    $("g-submit").onclick = async function () {
        var mode = $("g-submit").dataset.mode || "login";
        var email = $("g-email").value.trim().toLowerCase();
        var password = $("g-password").value;
        var name = $("g-name").value.trim();
        var phone = $("g-phone").value.trim();
        var optin = $("g-optin").checked;
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
            var data = await gateApi("/v1/auth/" + mode, payload);
            localStorage.setItem("mv_session", data.session_token);
            localStorage.setItem("mv_email", email);
            // issue license PARA O PRODUTO LEGENDAS
            var lic = await gateApi("/v1/license/issue", { fingerprint: fp, product_id: PRODUCT_ID });
            localStorage.setItem("mvl_license", lic.license);
            localStorage.setItem("mvl_plan", lic.plan);
            localStorage.setItem("mvl_status", lic.status || "");
            localStorage.setItem("mvl_expires", lic.expires_at || "");
            localStorage.setItem("mvl_via_bundle", lic.covers_via_bundle ? "true" : "false");
            if (mode === "signup") {
                localStorage.setItem("mvl_email_verified", "false");
                localStorage.removeItem("mvl_verify_dismissed_until");
                if (name) localStorage.setItem("mv_name", name);
            } else {
                setTimeout(checkEmailVerified, 800);
            }
            msg.textContent = "✓ " + (mode === "signup" ? "Conta criada! Trial de 14 dias ativo." : "Bem-vindo!");
            msg.className = "gate__msg ok";
            setTimeout(function () { hideGate(); updateTrialUI(); updateVerifyBar(); }, 500);
        } catch (e) {
            msg.textContent = "Erro: " + (typeof e === "string" ? e : (e.message || "falha"));
            msg.className = "gate__msg";
        }
        sub.disabled = false;
    };
}

// ============================================================ trial bar + paywall
function daysBetween(future) {
    if (!future) return null;
    var d = (new Date(future) - new Date()) / (1000*60*60*24);
    return Math.max(0, Math.ceil(d));
}
function updateTrialUI() {
    var plan = localStorage.getItem("mvl_plan") || "";
    var status = localStorage.getItem("mvl_status") || "";
    var expires = localStorage.getItem("mvl_expires") || "";
    var viaBundle = localStorage.getItem("mvl_via_bundle") === "true";
    var bar = $("trial-bar"), info = $("trial-info"), paywall = $("paywall");
    if (!bar) return;

    if (plan === "yearly" || plan === "lifetime") {
        bar.className = "trialbar hidden";
        if (paywall) paywall.classList.add("hidden");
        return;
    }
    if (plan === "trial" || status === "trialing") {
        var days = daysBetween(expires);
        if (days === null || days <= 0) { showPaywall("Seu trial expirou"); return; }
        var warn = days <= 3;
        bar.className = "trialbar" + (warn ? " warn" : "");
        info.textContent = "⏰ Trial: " + days + " dia" + (days === 1 ? "" : "s") + (viaBundle ? " (Pacote Completo)" : "");
        if (paywall) paywall.classList.add("hidden");
        return;
    }
    if (plan === "free" || plan === "expired" || status === "expired" || status === "canceled" || status === "revoked") {
        showPaywall(plan === "free" ? "Sem assinatura ativa" : "Sua assinatura expirou");
        return;
    }
    bar.className = "trialbar hidden";
}
function showPaywall(title) {
    var pw = $("paywall"); if (!pw) return;
    var t = pw.querySelector(".paywall__title");
    if (t && title) t.textContent = title;
    pw.classList.remove("hidden");
    var bar = $("trial-bar"); if (bar) bar.className = "trialbar expired";
    var info = $("trial-info"); if (info) info.textContent = "⚠️ " + title;
}
function bindTrialUI() {
    $("btn-upgrade").onclick = function () { openInBrowser(PRICING_URL); };
    $("paywall-cta").onclick = function () { openInBrowser(PRICING_URL); };
    $("paywall-bundle").onclick = function () { openInBrowser(LANDING_URL + "/#pricing"); };
    $("paywall-logout").onclick = function () {
        ["mv_session","mv_email","mvl_license","mvl_plan","mvl_status","mvl_expires","mvl_via_bundle","mvl_email_verified"].forEach(function(k){ localStorage.removeItem(k); });
        $("paywall").classList.add("hidden");
        showGate("login");
    };
    $("btn-resend-verify").onclick = async function () {
        var b = $("btn-resend-verify"); b.disabled = true; var o = b.textContent;
        b.textContent = "Enviando...";
        try {
            var r = await gateApi("/v1/auth/resend-verification", {});
            if (r.already_verified) {
                localStorage.setItem("mvl_email_verified","true");
                $("verify-bar").classList.add("hidden");
                toast("E-mail já estava verificado", "ok");
            } else {
                b.textContent = "✓ Enviado";
                toast("Cheque sua caixa de entrada", "ok");
                setTimeout(function () { b.textContent = o; b.disabled = false; }, 3000);
            }
        } catch (e) { b.textContent = o; b.disabled = false; toast("Erro: " + e, "err"); }
    };
    $("btn-dismiss-verify").onclick = function () {
        $("verify-bar").classList.add("hidden");
        localStorage.setItem("mvl_verify_dismissed_until", Date.now() + 24*60*60*1000);
    };
}

async function checkEmailVerified() {
    if (!localStorage.getItem("mv_session")) return;
    try {
        var r = await gateApi("/v1/me");
        var verified = r.user && r.user.email_verified;
        localStorage.setItem("mvl_email_verified", verified ? "true" : "false");
        if (r.user && r.user.name) localStorage.setItem("mv_name", r.user.name);
        updateVerifyBar();
    } catch (e) {}
}
function updateVerifyBar() {
    var bar = $("verify-bar"); if (!bar) return;
    var verified = localStorage.getItem("mvl_email_verified") === "true";
    var dismissed = Number(localStorage.getItem("mvl_verify_dismissed_until") || 0);
    if (verified || Date.now() < dismissed) bar.classList.add("hidden");
    else bar.classList.remove("hidden");
}

function startHeartbeat() {
    if (DEV_BYPASS) return;
    var fp = computeFingerprint();
    var tick = async function () {
        try {
            var r = await gateApi("/v1/license/heartbeat", { fingerprint: fp, product_id: PRODUCT_ID });
            if (r.revoked) {
                if (r.subscription_inactive) {
                    localStorage.setItem("mvl_plan", r.plan || "free");
                    localStorage.setItem("mvl_status", r.status || "revoked");
                    updateTrialUI();
                } else {
                    localStorage.removeItem("mv_session");
                    localStorage.removeItem("mvl_license");
                    showGate("login");
                }
                return;
            }
            if (r.license) {
                localStorage.setItem("mvl_license", r.license);
                localStorage.setItem("mvl_plan", r.plan);
                localStorage.setItem("mvl_status", r.status || "");
                localStorage.setItem("mvl_expires", r.expires_at || "");
                localStorage.setItem("mvl_via_bundle", r.covers_via_bundle ? "true" : "false");
                updateTrialUI();
            }
        } catch (e) {}
    };
    tick(); setInterval(tick, 5*60*1000);
}

function tryRestoreSession() {
    if (DEV_BYPASS) { hideGate(); return true; }
    var t = localStorage.getItem("mv_session");
    var l = localStorage.getItem("mvl_license");
    if (t && l) { hideGate(); return true; }
    showGate("login");
    return false;
}

// ============================================================ boot
var BUILD = "1.0.0";

function boot() {
    loadCatalog();
    buildIndex();
    renderTabs();
    if (CATALOG.packs && CATALOG.packs.length) selectPack(CATALOG.packs[0].id);
    $("status").textContent = "Pronto · " + PRODUCT_NAME + " · build " + BUILD;
    bindGate();
    bindTrialUI();
    tryRestoreSession();
    updateTrialUI();
    updateVerifyBar();
    checkEmailVerified();
    startHeartbeat();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}

})();
