/* ============================================================
   Motion Pro Admin · app.js v3
   ============================================================ */
"use strict";

const API = "https://motionpro.vercel.app";
document.getElementById("api-url-display").textContent = API;
const apiUrl2 = document.getElementById("api-url-display-2");
if (apiUrl2) apiUrl2.textContent = API;
const dashUrl = document.getElementById("dashboard-url");
if (dashUrl) dashUrl.textContent = location.origin;

let TOKEN = localStorage.getItem("admin_token") || "";
let ME = null;
let STATE = {
    users: [],
    devices: [],
    sessions: [],
    duplicates: [],
    selectedUser: null,
};

// ===========================================================
// API HELPERS
// ===========================================================
async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (TOKEN) opts.headers.Authorization = "Bearer " + TOKEN;
    if (body !== undefined) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
    }
    const r = await fetch(API + path, opts);
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!r.ok) {
        const err = new Error((json && json.error) || ("HTTP " + r.status));
        err.status = r.status;
        err.data = json;
        throw err;
    }
    return json;
}
const get = (p) => api("GET", p);
const post = (p, b) => api("POST", p, b);
const del = (p) => api("DELETE", p);

// ===========================================================
// TOAST
// ===========================================================
function toast(msg, kind = "ok", ms = 3000) {
    const el = document.createElement("div");
    el.className = "toast toast--" + kind;
    el.textContent = msg;
    document.getElementById("toast-area").appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(20px)"; }, ms - 200);
    setTimeout(() => el.remove(), ms);
}

// ===========================================================
// MODAL
// ===========================================================
function modal(title, body, onConfirm, opts = {}) {
    const back = document.getElementById("modal-backdrop");
    const mc = document.getElementById("modal-content");
    mc.innerHTML = `
        <h3>${title}</h3>
        ${typeof body === "string" ? body : ""}
        <div class="modal-actions">
          <button class="btn btn--sm" id="m-cancel">Cancelar</button>
          <button class="btn btn--sm ${opts.danger ? "btn--danger" : "btn--primary"}" id="m-ok">${opts.okText || "Confirmar"}</button>
        </div>
    `;
    if (typeof body !== "string") mc.querySelector("h3").after(body);
    back.classList.add("open");
    document.getElementById("m-cancel").onclick = () => back.classList.remove("open");
    document.getElementById("m-ok").onclick = async () => {
        try {
            const result = await onConfirm(mc);
            if (result !== false) back.classList.remove("open");
        } catch (e) {
            toast("Erro: " + e.message, "err");
        }
    };
}
document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") e.currentTarget.classList.remove("open");
});

function confirmDanger(title, msg, onYes) {
    modal(title, `<p>${msg}</p>`, async () => { await onYes(); return true; }, { danger: true, okText: "Sim, executar" });
}

// ===========================================================
// FORMATTERS
// ===========================================================
const FLAGS = { BR: "🇧🇷", US: "🇺🇸", PT: "🇵🇹", ES: "🇪🇸", DE: "🇩🇪", FR: "🇫🇷", AR: "🇦🇷", MX: "🇲🇽", CL: "🇨🇱", LOCAL: "🏠" };
const flag = (c) => c ? (FLAGS[c.toUpperCase()] || ("🌐 " + c)) : "—";

function fmtDate(d) {
    if (!d) return "—";
    const dt = new Date(d);
    return dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtRelative(d) {
    if (!d) return "—";
    const ms = Date.now() - new Date(d).getTime();
    if (ms < 0) return "no futuro";
    const s = ms / 1000;
    if (s < 60) return Math.floor(s) + "s atrás";
    if (s < 3600) return Math.floor(s / 60) + "min atrás";
    if (s < 86400) return Math.floor(s / 3600) + "h atrás";
    if (s < 30 * 86400) return Math.floor(s / 86400) + "d atrás";
    return fmtDate(d);
}
function fmtBrl(v) { return "R$ " + (Number(v) || 0).toFixed(2).replace(".", ","); }
function shortId(s, n = 8) { return s ? String(s).slice(0, n) + "…" : "—"; }
function shortFp(s) { return s ? String(s).slice(0, 16) + "…" : "—"; }

const PRODUCT_NAMES = { motionpro: "Titles", ia: "IA", legendas: "Legendas", bundle_all: "Bundle" };
const STATUS_META = {
    active:    { label: "ATIVO",     cls: "badge--ok" },
    trialing:  { label: "TRIAL",     cls: "badge--warn" },
    canceled:  { label: "CANCELADO", cls: "badge--mut" },
    expired:   { label: "EXPIRADO",  cls: "badge--err" },
    revoked:   { label: "REVOGADO",  cls: "badge--err" },
    past_due:  { label: "PAGTO PEND",cls: "badge--err" },
    incomplete:{ label: "INCOMPLETO",cls: "badge--mut" },
    none:      { label: "—",         cls: "badge--mut" },
};
function statusBadge(s) {
    const m = STATUS_META[s] || { label: (s || "?").toUpperCase(), cls: "badge--mut" };
    return `<span class="badge ${m.cls}">${m.label}</span>`;
}
function productBadge(p) {
    const name = PRODUCT_NAMES[p] || p;
    return `<span class="prod-badge prod-badge--${p}">${name}</span>`;
}
function deviceStatusDot(lastSeen, revoked) {
    if (revoked) return `<span class="dot dot--offline"></span><span class="muted small">revogado</span>`;
    if (!lastSeen) return `<span class="dot dot--offline"></span><span class="muted small">nunca</span>`;
    const ms = Date.now() - new Date(lastSeen).getTime();
    if (ms < 10 * 60 * 1000) return `<span class="dot dot--online"></span><span class="small" style="color:var(--ok)">online</span>`;
    if (ms < 24 * 60 * 60 * 1000) return `<span class="dot dot--idle"></span><span class="small" style="color:var(--warn)">idle</span>`;
    return `<span class="dot dot--offline"></span><span class="muted small">offline</span>`;
}
function osIcon(os) {
    if (!os) return "❓";
    if (/Windows/i.test(os)) return "🪟";
    if (/macOS|Mac/i.test(os)) return "🍎";
    if (/Linux/i.test(os)) return "🐧";
    if (/CEP|Premiere/i.test(os)) return "🎬";
    return "💻";
}

// ===========================================================
// LOGIN / SESSION
// ===========================================================
async function tryRestoreSession() {
    if (!TOKEN) return false;
    try {
        const sum = await get("/v1/admin/dashboard-summary");
        ME = { email: localStorage.getItem("admin_email") };
        document.getElementById("me-email").textContent = ME.email || "admin";
        showApp();
        renderOverview(sum);
        return true;
    } catch (e) {
        TOKEN = ""; localStorage.removeItem("admin_token");
        return false;
    }
}

function showApp() {
    document.getElementById("login-screen").hidden = true;
    document.getElementById("app").hidden = false;
}
function showLogin() {
    document.getElementById("login-screen").hidden = false;
    document.getElementById("app").hidden = true;
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const pass = document.getElementById("login-pass").value;
    const errEl = document.getElementById("login-error");
    errEl.textContent = "";
    try {
        const r = await post("/v1/auth/login", { email, password: pass });
        if (!r.session_token) throw new Error("sem token");
        TOKEN = r.session_token;
        localStorage.setItem("admin_token", TOKEN);
        localStorage.setItem("admin_email", email);
        try {
            const sum = await get("/v1/admin/dashboard-summary");
            ME = { email };
            document.getElementById("me-email").textContent = email;
            showApp();
            renderOverview(sum);
        } catch (e) {
            TOKEN = ""; localStorage.removeItem("admin_token");
            errEl.textContent = "Conta sem privilégio admin.";
        }
    } catch (e) {
        errEl.textContent = e.message === "invalid_credentials" ? "Credenciais inválidas" : ("Erro: " + e.message);
    }
});

document.getElementById("logout-btn").addEventListener("click", () => {
    TOKEN = ""; localStorage.removeItem("admin_token"); localStorage.removeItem("admin_email");
    showLogin();
});

// ===========================================================
// NAV
// ===========================================================
document.querySelectorAll(".nav-item").forEach(a => {
    a.addEventListener("click", (e) => {
        e.preventDefault();
        const view = a.dataset.view;
        document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n === a));
        document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
        loadView(view);
    });
});

function loadView(view) {
    if (view === "overview") loadOverview();
    if (view === "users") loadUsers();
    if (view === "subscriptions") loadSubs();
    if (view === "devices") loadDevices();
    if (view === "sessions") loadSessions();
    if (view === "licenses") loadLicenses();
    if (view === "transactions") loadTransactions();
    if (view === "duplicates") loadDuplicates();
    if (view === "audit") loadAudit();
}

// ===========================================================
// OVERVIEW
// ===========================================================
async function loadOverview() {
    document.getElementById("overview-sub").textContent = "Atualizando…";
    try {
        const sum = await get("/v1/admin/dashboard-summary");
        renderOverview(sum);
    } catch (e) { toast("Falha ao carregar overview: " + e.message, "err"); }
}
document.getElementById("refresh-overview").onclick = loadOverview;

function renderOverview(s) {
    const kpis = [
        { label: "Usuários totais", value: s.total_users || 0,        cls: "kpi--accent" },
        { label: "Online agora",    value: s.online_now || 0,          delta: (s.active_24h || 0) + " últimas 24h", cls: "kpi--ok" },
        { label: "Pagantes",        value: s.paying_users || 0,        delta: fmtBrl(s.mrr_brl || 0) + " MRR" },
        { label: "Em trial",        value: s.trial_users || 0 },
        { label: "Bloqueados",      value: s.blocked_users || 0,       cls: (s.blocked_users > 0 ? "kpi--err" : "") },
        { label: "Novos 7d",        value: s.new_users_7d || 0,        delta: (s.new_users_24h || 0) + " últimas 24h" },
        { label: "Receita 30d",     value: fmtBrl(s.revenue_30d_brl || 0) },
        { label: "Receita total",   value: fmtBrl(s.revenue_all_time_brl || 0) },
        { label: "Dispositivos",    value: s.total_devices || 0,       delta: (s.active_24h || 0) + " ativos 24h" },
        { label: "Sessões ativas",  value: s.active_sessions || 0 },
        { label: "Churn 30d",       value: s.churned_30d || 0,         cls: (s.churned_30d > 0 ? "kpi--warn" : "") },
    ];
    document.getElementById("kpi-grid").innerHTML = kpis.map(k => `
        <div class="kpi ${k.cls || ""}">
          <div class="kpi__label">${k.label}</div>
          <div class="kpi__value">${k.value}</div>
          ${k.delta ? `<div class="kpi__delta">${k.delta}</div>` : ""}
        </div>
    `).join("");

    const byProd = s.by_product || [];
    const productGroups = {};
    byProd.forEach(r => { (productGroups[r.product_id] = productGroups[r.product_id] || []).push(r); });
    document.getElementById("by-product-list").innerHTML = Object.keys(productGroups).length === 0
        ? `<div class="muted small">Sem dados ainda</div>`
        : Object.entries(productGroups).map(([p, rows]) => `
            <div style="margin-bottom:12px">
              <div style="margin-bottom:6px">${productBadge(p)}</div>
              <div class="tag-row" style="padding-left:8px">
                ${rows.map(r => `<span class="badge badge--mut">${r.status}: <b>${r.n}</b></span>`).join("")}
              </div>
            </div>
        `).join("");

    const tc = s.top_countries || [];
    document.getElementById("top-countries-list").innerHTML = tc.length === 0
        ? `<div class="muted small">Sem geo gravado ainda — login + heartbeat vai popular</div>`
        : tc.map(c => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line-soft)"><span>${flag(c.country)} <b>${c.country}</b></span><span class="muted">${c.n} disp.</span></div>`).join("");

    const ra = s.recent_activity || [];
    document.getElementById("recent-activity").innerHTML = ra.map(e => {
        const cls = e.action.includes("denied") || e.action.includes("blocked") ? "ev--err"
              : e.action.includes("checkout") || e.action.includes("active") ? "ev--ok"
              : e.action.includes("trial") || e.action.includes("warning") ? "ev--warn" : "";
        return `<li>
            <div class="ts">${fmtDate(e.created_at)} · ${fmtRelative(e.created_at)}</div>
            <div class="ev ${cls}">${e.action} <span class="muted small">${e.email || "(sistema)"}</span></div>
            ${e.detail ? `<div class="det">${JSON.stringify(e.detail).slice(0, 200)}</div>` : ""}
        </li>`;
    }).join("") || `<li class="muted small">Sem eventos recentes</li>`;

    document.getElementById("overview-sub").textContent = "Atualizado " + new Date().toLocaleTimeString("pt-BR");
}

// ===========================================================
// USERS
// ===========================================================
async function loadUsers() {
    const q = document.getElementById("users-search").value.trim();
    const status = document.getElementById("users-status").value;
    const product = document.getElementById("users-product").value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    try {
        const r = await get("/v1/admin/users?" + params.toString());
        STATE.users = r.users;
        let filtered = r.users;
        if (product !== "all") {
            filtered = filtered.filter(u => (u.subscriptions || []).some(s => s.product_id === product));
        }
        renderUsers(filtered);
        document.getElementById("users-count").textContent = filtered.length;
    } catch (e) { toast("Falha ao carregar usuários: " + e.message, "err"); }
}
document.getElementById("users-search").addEventListener("input", () => { clearTimeout(window._usSearch); window._usSearch = setTimeout(loadUsers, 250); });
document.getElementById("users-status").addEventListener("change", loadUsers);
document.getElementById("users-product").addEventListener("change", loadUsers);
document.getElementById("refresh-users").onclick = loadUsers;

function renderUsers(users) {
    const tb = document.getElementById("users-tbody");
    if (users.length === 0) {
        tb.innerHTML = `<tr><td colspan="7" class="tbl-empty">Nenhum usuário encontrado</td></tr>`;
        return;
    }
    tb.innerHTML = users.map(u => {
        const subs = u.subscriptions || [];
        const products = subs.map(s => productBadge(s.product_id)).join(" ");
        const mainSub = subs.find(s => s.status === "active") || subs.find(s => s.status === "trialing") || subs[0];
        const status = mainSub ? statusBadge(mainSub.status) : statusBadge("none");
        const ld = u.last_device || {};
        const loc = ld.country ? `${flag(ld.country)} ${ld.city || ld.country}` : "—";
        const blocked = u.blocked_at ? " blocked" : "";
        const lifetime = u.lifetime_until ? `<span class="badge badge--ok" title="Lifetime">∞</span>` : "";
        return `<tr class="clickable${blocked}" data-uid="${u.id}">
            <td><b>${u.email}</b> ${lifetime}${u.is_admin ? ` <span class="badge badge--ok">ADMIN</span>` : ""}<br>
                <span class="muted small mono">${shortId(u.id, 8)}</span></td>
            <td>${products || `<span class="muted small">sem subs</span>`}</td>
            <td>${status}</td>
            <td><span class="dot ${(u.active_devices > 0) ? "dot--online" : "dot--offline"}"></span>${u.active_devices}/${u.total_devices}<br>
                <span class="muted small">${u.active_sessions || 0} sessões</span></td>
            <td>${fmtRelative(u.last_seen)}</td>
            <td>${loc}<br><span class="muted small mono">${ld.ip || "—"}</span></td>
            <td><span class="muted small">${fmtDate(u.created_at)}</span></td>
        </tr>`;
    }).join("");
    tb.querySelectorAll("tr.clickable").forEach(tr => {
        tr.addEventListener("click", () => openUserDrawer(tr.dataset.uid));
    });
}

// ===========================================================
// SUBSCRIPTIONS
// ===========================================================
async function loadSubs() {
    try {
        const s = await get("/v1/admin/dashboard-summary");
        const kpiHtml = [
            { label: "Pagantes",       value: s.paying_users || 0, cls: "kpi--ok" },
            { label: "Em trial",       value: s.trial_users || 0 },
            { label: "MRR estimado",   value: fmtBrl(s.mrr_brl || 0) },
            { label: "Receita 30d",    value: fmtBrl(s.revenue_30d_brl || 0) },
            { label: "Total receita",  value: fmtBrl(s.revenue_all_time_brl || 0) },
            { label: "Churn 30d",      value: s.churned_30d || 0, cls: (s.churned_30d > 0 ? "kpi--warn" : "") },
        ].map(k => `<div class="kpi ${k.cls || ""}"><div class="kpi__label">${k.label}</div><div class="kpi__value">${k.value}</div></div>`).join("");
        document.getElementById("subs-kpis").innerHTML = kpiHtml;

        const tb = document.querySelector("#subs-breakdown tbody");
        const users = STATE.users.length > 0 ? STATE.users : (await get("/v1/admin/users?limit=500")).users;
        const breakdown = {};
        users.forEach(u => (u.subscriptions || []).forEach(sub => {
            const key = `${sub.product_id}|${sub.plan}|${sub.status}`;
            breakdown[key] = (breakdown[key] || 0) + 1;
        }));
        const rows = Object.entries(breakdown).map(([k, n]) => {
            const [p, pl, st] = k.split("|");
            return { p, pl, st, n };
        }).sort((a, b) => a.p.localeCompare(b.p) || a.st.localeCompare(b.st));
        tb.innerHTML = rows.length === 0
            ? `<tr><td colspan="4" class="tbl-empty">Sem subs</td></tr>`
            : rows.map(r => `<tr>
                <td>${productBadge(r.p)}</td>
                <td><code>${r.pl || "—"}</code></td>
                <td>${statusBadge(r.st)}</td>
                <td><b>${r.n}</b></td>
            </tr>`).join("");
    } catch (e) { toast("Falha subs: " + e.message, "err"); }
}

// ===========================================================
// DEVICES
// ===========================================================
async function loadDevices() {
    try {
        const r = await get("/v1/admin/devices?limit=500");
        STATE.devices = r.devices || [];
        renderDevices();
    } catch (e) { toast("Falha devices: " + e.message, "err"); }
}
document.getElementById("devices-search").addEventListener("input", () => { clearTimeout(window._dsSearch); window._dsSearch = setTimeout(renderDevices, 250); });
document.getElementById("devices-status").addEventListener("change", renderDevices);
document.getElementById("refresh-devices").onclick = loadDevices;

function renderDevices() {
    const q = (document.getElementById("devices-search").value || "").toLowerCase().trim();
    const filt = document.getElementById("devices-status").value;
    let list = STATE.devices.slice();
    if (q) list = list.filter(d => [d.email, d.fingerprint, d.last_ip, d.city].some(x => (x || "").toLowerCase().includes(q)));
    const now = Date.now();
    if (filt === "online") list = list.filter(d => !d.revoked && d.last_seen && (now - new Date(d.last_seen).getTime()) < 600000);
    if (filt === "active") list = list.filter(d => !d.revoked && d.last_seen && (now - new Date(d.last_seen).getTime()) < 86400000);
    if (filt === "revoked") list = list.filter(d => d.revoked);

    document.getElementById("devices-count").textContent = STATE.devices.length;
    document.getElementById("devices-online").textContent = STATE.devices.filter(d => !d.revoked && d.last_seen && (now - new Date(d.last_seen).getTime()) < 600000).length;

    const tb = document.getElementById("devices-tbody");
    if (list.length === 0) {
        tb.innerHTML = `<tr><td colspan="8" class="tbl-empty">Nenhum dispositivo encontrado</td></tr>`;
        return;
    }
    tb.innerHTML = list.map(d => `
        <tr>
          <td>${deviceStatusDot(d.last_seen, d.revoked)}</td>
          <td><a href="#" data-uid="${d.user_id}" class="user-link"><b>${d.email || "—"}</b></a></td>
          <td>${osIcon(d.os_name)} <span class="small">${d.os_name || "—"}</span></td>
          <td class="mono small">${d.last_ip || "—"}</td>
          <td>${d.country ? flag(d.country) + " " + (d.city || d.country) : "—"}<br><span class="muted small">${d.region || ""}</span></td>
          <td>${fmtRelative(d.last_seen)}<br><span class="muted small">${fmtDate(d.last_seen)}</span></td>
          <td class="mono small">${shortFp(d.fingerprint)}</td>
          <td>${d.revoked ? `<span class="badge badge--err">revogado</span>` : `<button class="btn btn--sm btn--danger" data-revoke="${d.id}">Revogar</button>`}</td>
        </tr>
    `).join("");
    tb.querySelectorAll(".user-link").forEach(a => a.onclick = (e) => { e.preventDefault(); openUserDrawer(a.dataset.uid); });
    tb.querySelectorAll("[data-revoke]").forEach(b => b.onclick = async () => {
        const id = b.dataset.revoke;
        confirmDanger("Revogar dispositivo", "Isso bloqueia o uso desse device até nova ativação.", async () => {
            await post(`/v1/admin/devices/${id}/revoke`, {});
            toast("Device revogado", "ok");
            loadDevices();
        });
    });
}

// ===========================================================
// SESSIONS (agrega via per-user)
// ===========================================================
async function loadSessions() {
    try {
        const users = STATE.users.length > 0 ? STATE.users : (await get("/v1/admin/users?limit=500")).users;
        const usersWithActive = users.filter(u => Number(u.active_sessions || 0) > 0).slice(0, 50);
        const allSessions = [];
        for (const u of usersWithActive) {
            try {
                const full = await get(`/v1/admin/users/${u.id}/full`);
                (full.sessions || []).filter(s => !s.revoked && new Date(s.expires_at) > new Date())
                    .forEach(s => allSessions.push({ ...s, email: u.email, user_id: u.id }));
            } catch (_) {}
        }
        STATE.sessions = allSessions;
        renderSessions();
    } catch (e) { toast("Falha sessions: " + e.message, "err"); }
}
document.getElementById("sessions-search").addEventListener("input", () => { clearTimeout(window._ssSearch); window._ssSearch = setTimeout(renderSessions, 250); });
document.getElementById("refresh-sessions").onclick = loadSessions;

function renderSessions() {
    const q = (document.getElementById("sessions-search").value || "").toLowerCase().trim();
    let list = STATE.sessions.slice();
    if (q) list = list.filter(s => [s.email, s.last_ip].some(x => (x || "").toLowerCase().includes(q)));
    document.getElementById("sessions-count").textContent = STATE.sessions.length;

    const tb = document.getElementById("sessions-tbody");
    if (list.length === 0) {
        tb.innerHTML = `<tr><td colspan="8" class="tbl-empty">Nenhuma sessão ativa</td></tr>`;
        return;
    }
    tb.innerHTML = list.map(s => `
        <tr>
          <td><a href="#" data-uid="${s.user_id}" class="user-link"><b>${s.email}</b></a></td>
          <td class="mono small">${s.last_ip || "—"}</td>
          <td>${s.country ? flag(s.country) + " " + s.country : "—"}</td>
          <td>${osIcon(s.device_os)} <span class="small">${s.device_os || "—"}</span></td>
          <td>${fmtDate(s.issued_at)}</td>
          <td>${fmtRelative(s.last_seen_at)}</td>
          <td>${fmtDate(s.expires_at)}</td>
          <td><button class="btn btn--sm btn--danger" data-rev-sess="${s.id}">Encerrar</button></td>
        </tr>
    `).join("");
    tb.querySelectorAll(".user-link").forEach(a => a.onclick = (e) => { e.preventDefault(); openUserDrawer(a.dataset.uid); });
    tb.querySelectorAll("[data-rev-sess]").forEach(b => b.onclick = async () => {
        confirmDanger("Encerrar sessão", "O usuário será deslogado nesse device imediatamente.", async () => {
            await post(`/v1/admin/sessions/${b.dataset["revSess"]}/revoke`, {});
            toast("Sessão encerrada", "ok");
            loadSessions();
        });
    });
}

// ===========================================================
// DUPLICATES
// ===========================================================
async function loadDuplicates() {
    try {
        const r = await get("/v1/admin/duplicates");
        STATE.duplicates = r.groups || [];
        renderDuplicates();
    } catch (e) { toast("Falha duplicates: " + e.message, "err"); }
}
document.getElementById("refresh-duplicates").onclick = loadDuplicates;

function renderDuplicates() {
    const wrap = document.getElementById("duplicates-list");
    if (STATE.duplicates.length === 0) {
        wrap.innerHTML = `<div class="card"><div class="muted">🎉 Nenhuma conta duplicada detectada</div></div>`;
        return;
    }
    wrap.innerHTML = STATE.duplicates.map(g => `
        <div class="card">
          <div class="card__head">
            <div><b>${g.prefix}@${g.domain}</b> <span class="badge badge--warn">${g.n} contas</span></div>
          </div>
          <table style="width:100%">
            <thead><tr><th>E-mail</th><th>Criado em</th><th>ID</th><th></th></tr></thead>
            <tbody>
              ${g.users.map((u, i) => `<tr>
                <td><b>${u.email}</b> ${i === 0 ? `<span class="badge badge--ok">MAIS ANTIGA</span>` : ""}</td>
                <td>${fmtDate(u.created_at)}</td>
                <td class="mono small">${shortId(u.id)}</td>
                <td>
                  ${i === 0
                    ? `<button class="btn btn--sm" data-open-uid="${u.id}">Abrir</button>`
                    : `<button class="btn btn--sm btn--warn" data-merge-into="${g.users[0].id}" data-merge-from="${u.id}" data-merge-emails="${u.email}|${g.users[0].email}">Merge → ${g.users[0].email}</button>`}
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
    `).join("");
    wrap.querySelectorAll("[data-open-uid]").forEach(b => b.onclick = () => openUserDrawer(b.dataset.openUid));
    wrap.querySelectorAll("[data-merge-into]").forEach(b => b.onclick = async () => {
        const [from, to] = b.dataset.mergeEmails.split("|");
        confirmDanger("Merge de contas",
            `Vai mover TODOS dados (subs, devices, audit, downloads) de <b>${from}</b> pra <b>${to}</b> e deletar <b>${from}</b>. Irreversível.`,
            async () => {
                await post(`/v1/admin/users/${b.dataset.mergeInto}/merge`, { source_id: b.dataset.mergeFrom });
                toast(`Merge OK: ${from} → ${to}`, "ok");
                loadDuplicates();
            });
    });
}

// ===========================================================
// AUDIT (global)
// ===========================================================
async function loadAudit() {
    try {
        const r = await get("/v1/admin/audit?limit=200");
        const tl = document.getElementById("global-audit");
        const items = r.items || r.audit || [];
        if (items.length === 0) {
            tl.innerHTML = `<li class="muted">Sem eventos</li>`;
            return;
        }
        tl.innerHTML = items.map(e => {
            const cls = e.action.includes("denied") || e.action.includes("blocked") || e.action.includes("revoked") ? "ev--err"
                : e.action.includes("checkout") || e.action.includes("active") || e.action.includes("grant") ? "ev--ok"
                : e.action.includes("trial") || e.action.includes("warning") ? "ev--warn" : "";
            return `<li>
                <div class="ts">${fmtDate(e.created_at)} · ${fmtRelative(e.created_at)}</div>
                <div class="ev ${cls}">${e.action} <span class="muted small">${e.email || e.user_email || "(sistema)"}</span></div>
                ${e.detail ? `<div class="det">${JSON.stringify(e.detail).slice(0, 300)}</div>` : ""}
            </li>`;
        }).join("");
    } catch (e) { toast("Falha audit: " + e.message, "err"); }
}
document.getElementById("refresh-audit").onclick = loadAudit;

// ===========================================================
// MAINTENANCE
// ===========================================================
document.getElementById("run-migration-006").onclick = async () => {
    confirmDanger("Rodar migration 006", "Adiciona colunas IP/geo nos devices e cria tabela sessions. É idempotente.", async () => {
        try {
            const r = await post("/v1/admin/maintenance/run-migration-006", {});
            document.getElementById("migration-result").style.display = "block";
            document.getElementById("migration-result").textContent = JSON.stringify(r, null, 2);
            toast("Migration executada ✅", "ok");
        } catch (e) { toast("Falha migration: " + e.message, "err"); throw e; }
    });
};

// ===========================================================
// DRAWER (user detail)
// ===========================================================
async function openUserDrawer(uid) {
    document.getElementById("drawer-backdrop").classList.add("open");
    document.getElementById("user-drawer").classList.add("open");
    document.getElementById("drawer-email").textContent = "Carregando…";
    document.getElementById("drawer-id").textContent = uid;
    document.querySelectorAll(".drawer__panel").forEach(p => p.innerHTML = `<div class="skel"></div>`);
    try {
        const full = await get(`/v1/admin/users/${uid}/full`);
        STATE.selectedUser = full;
        renderDrawer(full);
    } catch (e) { toast("Falha ao carregar usuário: " + e.message, "err"); }
}
document.getElementById("drawer-close").onclick = closeDrawer;
document.getElementById("drawer-backdrop").onclick = closeDrawer;
function closeDrawer() {
    document.getElementById("drawer-backdrop").classList.remove("open");
    document.getElementById("user-drawer").classList.remove("open");
    STATE.selectedUser = null;
}

document.querySelectorAll(".drawer__tab").forEach(t => {
    t.onclick = () => {
        document.querySelectorAll(".drawer__tab").forEach(x => x.classList.toggle("active", x === t));
        document.querySelectorAll(".drawer__panel").forEach(p => p.classList.toggle("active", p.dataset.panel === t.dataset.tab));
    };
});

function renderDrawer(d) {
    const u = d.user;
    document.getElementById("drawer-email").textContent = u.email + (u.is_admin ? " 👑" : "");
    document.getElementById("drawer-id").textContent = u.id;

    const unblockBtn = document.querySelector('[data-action="unblock"]');
    const blockBtn   = document.querySelector('[data-action="block"]');
    if (u.blocked_at) { unblockBtn.hidden = false; blockBtn.hidden = true; }
    else              { unblockBtn.hidden = true;  blockBtn.hidden = false; }

    document.getElementById("panel-profile").innerHTML = `
      <div class="drawer-section">
        <h3>Dados</h3>
        <div class="detail-grid">
          <div class="k">E-mail</div><div class="v">${u.email} ${u.email_verified ? "✅" : `<span class="badge badge--warn">não verificado</span>`}</div>
          <div class="k">Nome</div><div class="v">${u.name || "—"}</div>
          <div class="k">Telefone</div><div class="v">${u.phone || "—"}</div>
          <div class="k">Criada em</div><div class="v">${fmtDate(u.created_at)} (${fmtRelative(u.created_at)})</div>
          <div class="k">Admin</div><div class="v">${u.is_admin ? "✅ SIM" : "Não"}</div>
          <div class="k">Lifetime</div><div class="v">${u.lifetime_until ? "✅ até " + fmtDate(u.lifetime_until) : "Não"}</div>
          <div class="k">Bloqueado</div><div class="v">${u.blocked_at ? `<span class="badge badge--err">SIM desde ${fmtDate(u.blocked_at)}</span><br><span class="muted small">${u.blocked_reason || ""}</span>` : "Não"}</div>
          <div class="k">Stripe customer</div><div class="v mono small">${u.stripe_customer || "—"}</div>
          <div class="k">Marketing opt-in</div><div class="v">${u.marketing_optin ? "✅" : "❌"}</div>
        </div>
      </div>
      <div class="drawer-section">
        <h3>Stats</h3>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi__label">Total gasto</div><div class="kpi__value">${fmtBrl(d.stats?.total_spent_brl || 0)}</div></div>
          <div class="kpi"><div class="kpi__label">Devices ativos</div><div class="kpi__value">${d.stats?.active_devices || 0}</div></div>
          <div class="kpi"><div class="kpi__label">Online agora</div><div class="kpi__value">${d.stats?.online_now || 0}</div></div>
          <div class="kpi"><div class="kpi__label">Sessões ativas</div><div class="kpi__value">${d.stats?.active_sessions || 0}</div></div>
        </div>
        ${d.stats?.countries_seen?.length > 0 ? `<div style="margin-top:10px"><span class="muted small">Países vistos: </span>${d.stats.countries_seen.map(c => flag(c) + " " + c).join(" · ")}</div>` : ""}
      </div>
    `;

    document.getElementById("panel-subs").innerHTML = `
      <div class="drawer-section">
        <h3>${d.subscriptions.length} assinatura(s)</h3>
        ${d.subscriptions.length === 0 ? `<div class="muted">Sem subs</div>` : `
          <table style="width:100%">
            <thead><tr><th>Produto</th><th>Plano</th><th>Status</th><th>Início</th><th>Expira</th></tr></thead>
            <tbody>
              ${d.subscriptions.map(s => `<tr>
                <td>${productBadge(s.product_id)}</td>
                <td><code>${s.plan || "—"}</code></td>
                <td>${statusBadge(s.status)}</td>
                <td>${fmtDate(s.started_at)}</td>
                <td>${fmtDate(s.current_period_end)}<br><span class="muted small">${fmtRelative(s.current_period_end)}</span></td>
              </tr>`).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;

    document.getElementById("panel-devices").innerHTML = `
      <div class="drawer-section">
        <h3>${d.devices.length} dispositivo(s)</h3>
        ${d.devices.length === 0 ? `<div class="muted">Nenhum device registrado ainda</div>` : `
          <table style="width:100%">
            <thead><tr><th>Status</th><th>OS</th><th>IP</th><th>Local</th><th>Último acesso</th><th></th></tr></thead>
            <tbody>
              ${d.devices.map(dev => `<tr>
                <td>${deviceStatusDot(dev.last_seen, dev.revoked)}</td>
                <td>${osIcon(dev.os_name)} <span class="small">${dev.os_name || "—"}</span></td>
                <td class="mono small">${dev.last_ip || "—"}</td>
                <td>${dev.country ? flag(dev.country) + " " + (dev.city || dev.country) : "—"}</td>
                <td>${fmtRelative(dev.last_seen)}</td>
                <td>${dev.revoked ? `<span class="muted small">revogado</span>` : `<button class="btn btn--sm btn--danger" data-rev-dev="${dev.id}">Revogar</button>`}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;
    document.querySelectorAll("[data-rev-dev]").forEach(b => b.onclick = async () => {
        confirmDanger("Revogar device", "Bloqueia esse device até nova ativação.", async () => {
            await post(`/v1/admin/devices/${b.dataset.revDev}/revoke`, {});
            toast("Device revogado", "ok");
            openUserDrawer(u.id);
        });
    });

    const activeSess = d.sessions.filter(s => !s.revoked && new Date(s.expires_at) > new Date());
    document.getElementById("panel-sessions").innerHTML = `
      <div class="drawer-section">
        <h3>${activeSess.length} sessão(ões) ativa(s) · ${d.sessions.length} total</h3>
        ${d.sessions.length === 0 ? `<div class="muted">Sem sessões registradas</div>` : `
          <table style="width:100%">
            <thead><tr><th>Status</th><th>IP</th><th>Local</th><th>OS</th><th>Iniciada</th><th>Expira</th><th></th></tr></thead>
            <tbody>
              ${d.sessions.map(s => `<tr>
                <td>${s.revoked ? `<span class="badge badge--err">revogada</span>` : new Date(s.expires_at) < new Date() ? `<span class="badge badge--mut">expirada</span>` : `<span class="badge badge--ok">ativa</span>`}</td>
                <td class="mono small">${s.last_ip || "—"}</td>
                <td>${s.country ? flag(s.country) + " " + s.country : "—"}</td>
                <td>${osIcon(s.device_os)} <span class="small">${s.device_os || "—"}</span></td>
                <td>${fmtDate(s.issued_at)}</td>
                <td>${fmtDate(s.expires_at)}</td>
                <td>${(s.revoked || new Date(s.expires_at) < new Date()) ? "" : `<button class="btn btn--sm btn--danger" data-rev-sess="${s.id}">Encerrar</button>`}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;
    document.querySelectorAll("[data-rev-sess]").forEach(b => b.onclick = async () => {
        confirmDanger("Encerrar sessão", "User será deslogado imediatamente.", async () => {
            await post(`/v1/admin/sessions/${b.dataset["revSess"]}/revoke`, {});
            toast("Sessão encerrada", "ok");
            openUserDrawer(u.id);
        });
    });

    document.getElementById("panel-payments").innerHTML = `
      <div class="drawer-section">
        <h3>${d.payments.length} evento(s) de pagamento</h3>
        ${d.payments.length === 0 ? `<div class="muted">Sem pagamentos</div>` : `
          <ul class="timeline">
            ${d.payments.map(p => `<li>
              <div class="ts">${fmtDate(p.created_at)}</div>
              <div class="ev ev--ok">${p.detail?.amount ? fmtBrl(p.detail.amount / 100) : "—"} <span class="muted small">${p.detail?.product_id || ""} ${p.detail?.plan || ""}</span></div>
              <div class="det">${JSON.stringify(p.detail || {}).slice(0, 200)}</div>
            </li>`).join("")}
          </ul>
        `}
      </div>
    `;

    document.getElementById("panel-audit").innerHTML = `
      <div class="drawer-section">
        <h3>${d.audit.length} evento(s)</h3>
        <ul class="timeline">
          ${d.audit.map(e => {
              const cls = e.action.includes("denied") || e.action.includes("blocked") ? "ev--err"
                  : e.action.includes("checkout") || e.action.includes("grant") ? "ev--ok"
                  : e.action.includes("trial") ? "ev--warn" : "";
              return `<li>
                <div class="ts">${fmtDate(e.created_at)} · ${fmtRelative(e.created_at)}</div>
                <div class="ev ${cls}">${e.action}</div>
                ${e.detail ? `<div class="det">${JSON.stringify(e.detail).slice(0, 200)}</div>` : ""}
              </li>`;
          }).join("") || `<li class="muted">Sem eventos</li>`}
        </ul>
      </div>
    `;
}

// === Drawer actions ===
document.querySelectorAll("[data-action]").forEach(b => {
    b.onclick = () => {
        const uid = STATE.selectedUser?.user?.id;
        if (!uid) return;
        const act = b.dataset.action;
        if (act === "extend-trial") {
            confirmDanger("Estender trial +7 dias", "Adiciona 7 dias ao trial atual.", async () => {
                await post(`/v1/admin/users/${uid}/extend-trial`, { days: 7 });
                toast("Trial estendido +7 dias", "ok");
                openUserDrawer(uid);
            });
        } else if (act === "grant-trial") {
            modalGrantTrial(uid);
        } else if (act === "send-email") {
            modalSendEmail(uid);
        } else if (act === "kill-sessions") {
            confirmDanger("Matar TODAS as sessões", "User será deslogado em todos os devices.", async () => {
                await post(`/v1/admin/users/${uid}/sessions/revoke-all`, {});
                toast("Todas sessões encerradas", "ok");
                openUserDrawer(uid);
            });
        } else if (act === "revoke-all-licenses") {
            modalRevokeAllLicenses(uid);
        } else if (act === "block") {
            modalBlock(uid);
        } else if (act === "unblock") {
            confirmDanger("Desbloquear conta", "User volta a poder logar normalmente.", async () => {
                await post(`/v1/admin/users/${uid}/unblock`, {});
                toast("Conta desbloqueada", "ok");
                openUserDrawer(uid);
            });
        } else if (act === "delete") {
            confirmDanger("DELETAR conta", "Cancela sub Stripe e apaga TUDO (cascade). IRREVERSÍVEL.", async () => {
                await del(`/v1/admin/users/${uid}`);
                toast("Conta deletada", "ok");
                closeDrawer();
                loadUsers();
            });
        }
    };
});

function modalGrantTrial(uid) {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Cria sub trial pra um produto que o usuário ainda não tem.</p>
      <label>Produto</label>
      <select id="gt-product">
        <option value="motionpro">Motion Titles</option>
        <option value="ia">Motion IA</option>
        <option value="legendas" selected>Motion Legendas</option>
        <option value="bundle_all">Bundle (todos)</option>
      </select>
      <label>Duração (dias)</label>
      <input id="gt-days" type="number" value="14" min="1" max="365">
    `;
    modal("🎁 Conceder trial", body, async () => {
        const product = document.getElementById("gt-product").value;
        const days = Number(document.getElementById("gt-days").value || 7);
        await post(`/v1/admin/users/${uid}/grant-trial`, { product, days });
        toast(`Trial de ${product} concedido (${days}d)`, "ok");
        openUserDrawer(uid);
    }, { okText: "Conceder" });
}

function modalSendEmail(uid) {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Envia e-mail customizado pelo Resend.</p>
      <label>Assunto</label>
      <input id="em-sub" placeholder="Assunto">
      <label>Mensagem (HTML permitido)</label>
      <textarea id="em-body" placeholder="Olá! ..."></textarea>
    `;
    modal("✉️ Enviar e-mail", body, async () => {
        const subject = document.getElementById("em-sub").value.trim();
        const html = document.getElementById("em-body").value.trim();
        if (!subject || !html) return false;
        await post(`/v1/admin/users/${uid}/send-email`, { subject, html });
        toast("E-mail enviado", "ok");
    }, { okText: "Enviar" });
}

function modalRevokeAllLicenses(uid) {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Kill switch: revoga TODAS as license_keys vinculadas ao email desse user.</p>
      <p>Inclui todas as ativações de devices (MIA/MTI/MTL/MTS). Reversível só via reissue manual.</p>
      <label>Motivo</label>
      <input id="ra-reason" placeholder="Ex: chargeback total, fraude confirmada">
    `;
    modal("🔑 Revogar TODAS licenças do user", body, async () => {
        const reason = document.getElementById("ra-reason").value.trim() || "admin_kill_switch";
        const r = await post(`/v1/admin/users/${uid}/licenses/revoke-all`, { reason });
        toast(`${r.revoked} licença(s) revogadas`, "warn");
        openUserDrawer(uid);
    }, { danger: true, okText: "Revogar tudo" });
}

function modalBlock(uid) {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Bloqueia o login E impede emissão de novas licenses. User não consegue entrar nem usar os plugins.</p>
      <label>Motivo</label>
      <input id="bk-reason" placeholder="Ex: violação de termos, fraude…">
    `;
    modal("🚫 Bloquear conta", body, async () => {
        const reason = document.getElementById("bk-reason").value.trim();
        await post(`/v1/admin/users/${uid}/block`, { reason });
        toast("Conta bloqueada", "warn");
        openUserDrawer(uid);
    }, { danger: true, okText: "Bloquear" });
}

// ===========================================================
// LICENSES (license_keys MIA-/MTI-/MTL-/MTS-)
// ===========================================================
STATE.licenses = [];

async function loadLicenses() {
    try {
        const r = await get("/v1/admin/license-keys?limit=500");
        STATE.licenses = r.keys || [];
        renderLicenses();
    } catch (e) { toast("Falha ao carregar licenças: " + e.message, "err"); }
}
function attachLicenseFilters() {
    const ids = ["licenses-search", "licenses-tier", "licenses-product", "licenses-status"];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el || el._bound) return;
        el._bound = true;
        const ev = el.tagName === "INPUT" ? "input" : "change";
        el.addEventListener(ev, () => { clearTimeout(window._lsSearch); window._lsSearch = setTimeout(renderLicenses, 200); });
    });
}
function licenseStatusOf(k) {
    if (k.revoked_at) return "revoked";
    if (k.expires_at && new Date(k.expires_at) < new Date()) return "expired";
    return "active";
}
function renderLicenses() {
    attachLicenseFilters();
    const q = (document.getElementById("licenses-search")?.value || "").toLowerCase().trim();
    const tier = document.getElementById("licenses-tier")?.value || "all";
    const prod = document.getElementById("licenses-product")?.value || "all";
    const stat = document.getElementById("licenses-status")?.value || "all";

    let list = STATE.licenses.slice();
    if (q)    list = list.filter(k => [k.key_prefix, k.customer_email, k.notes].some(x => (x || "").toLowerCase().includes(q)));
    if (tier !== "all") list = list.filter(k => (k.tier || "").toUpperCase().startsWith(tier));
    if (prod !== "all") list = list.filter(k => (k.products || []).includes(prod));
    if (stat !== "all") list = list.filter(k => licenseStatusOf(k) === stat);

    document.getElementById("licenses-count").textContent = STATE.licenses.length;
    document.getElementById("licenses-active").textContent = STATE.licenses.filter(k => licenseStatusOf(k) === "active").length;

    const tb = document.getElementById("licenses-tbody");
    if (list.length === 0) {
        tb.innerHTML = `<tr><td colspan="9" class="tbl-empty">Nenhuma licença encontrada</td></tr>`;
        return;
    }
    tb.innerHTML = list.map(k => {
        const s = licenseStatusOf(k);
        const stBadge = s === "active"  ? `<span class="badge badge--ok">ATIVA</span>`
                     : s === "revoked" ? `<span class="badge badge--err">REVOGADA</span>`
                     :                    `<span class="badge badge--warn">EXPIRADA</span>`;
        const products = (k.products || []).map(p => productBadge(p)).join(" ") || `<span class="muted small">—</span>`;
        const validade = k.expires_at ? fmtDate(k.expires_at) : `<span class="badge badge--ok" title="lifetime">∞</span>`;
        return `<tr>
            <td class="mono small"><b>${k.key_prefix}…</b></td>
            <td><span class="badge badge--mut">${(k.tier || "").toUpperCase()}</span></td>
            <td>${products}</td>
            <td>${k.active_devices || 0}/${k.max_devices}<br><span class="muted small">${k.total_activations || 0} total</span></td>
            <td>${k.customer_email || `<span class="muted small">—</span>`}</td>
            <td>${validade}</td>
            <td>${stBadge}</td>
            <td><span class="muted small">${fmtDate(k.created_at)}</span></td>
            <td>
              ${s === "active" ? `<button class="btn btn--sm btn--warn" data-reissue="${k.id}">Reemitir</button>
              <button class="btn btn--sm btn--danger" data-revoke-key="${k.id}">Revogar</button>` : ""}
            </td>
        </tr>`;
    }).join("");
    tb.querySelectorAll("[data-revoke-key]").forEach(b => b.onclick = () => modalRevokeKey(b.dataset.revokeKey));
    tb.querySelectorAll("[data-reissue]").forEach(b => b.onclick = () => modalReissueKey(b.dataset.reissue));
}
const _refLicBtn = document.getElementById("refresh-licenses");
if (_refLicBtn) _refLicBtn.onclick = loadLicenses;

function modalRevokeKey(id) {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Revoga a license_key e desativa TODOS os devices associados. Reversível só via reissue.</p>
      <label>Motivo</label>
      <input id="rk-reason" placeholder="Ex: chargeback, fraude, abuso">
    `;
    modal("🚫 Revogar license", body, async () => {
        const reason = document.getElementById("rk-reason").value.trim() || "admin_revoked";
        await post(`/v1/admin/license-keys/${id}/revoke`, { reason });
        toast("License revogada", "warn");
        loadLicenses();
    }, { danger: true, okText: "Revogar" });
}

function modalReissueKey(id) {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Revoga a key antiga e gera uma nova mantendo tier/produtos/max_devices/expires.</p>
      <p><b>A nova key aparece UMA VEZ.</b> Copie e envie pro cliente.</p>
      <label>Motivo</label>
      <input id="ri-reason" placeholder="Ex: cliente perdeu a key, troca de máquina">
    `;
    modal("♻️ Reemitir license", body, async () => {
        const reason = document.getElementById("ri-reason").value.trim() || "admin_reissue";
        const r = await post(`/v1/admin/license-keys/${id}/reissue`, { reason });
        modalShowKey(r.new_key, r.old_key_prefix);
        loadLicenses();
        return true;
    }, { okText: "Reemitir" });
}

function modalShowKey(plaintext, oldPrefix) {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Nova license emitida (antiga <code>${oldPrefix}</code> revogada). <b>Aparece UMA VEZ.</b></p>
      <textarea readonly id="show-key" style="font-family:monospace;font-size:14px;font-weight:700;color:var(--ok);background:var(--bg);min-height:50px">${plaintext}</textarea>
      <button class="btn btn--primary btn--sm" id="copy-key" style="margin-top:8px">📋 Copiar</button>
    `;
    modal("✅ Key gerada", body, async () => true, { okText: "Fechar" });
    setTimeout(() => {
        const btn = document.getElementById("copy-key");
        if (!btn) return;
        btn.onclick = () => {
            const ta = document.getElementById("show-key");
            ta.select();
            try { navigator.clipboard.writeText(plaintext); toast("Key copiada", "ok"); } catch (_) { document.execCommand("copy"); }
        };
    }, 50);
}

function modalGenerateKey() {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Gera license_key avulsa pra entrega manual (cliente comprou fora do Stripe, parceiro, etc).</p>
      <label>Tier</label>
      <select id="gk-tier">
        <option value="PRO" selected>PRO (validade)</option>
        <option value="LIFE">LIFETIME</option>
        <option value="BASIC">BASIC</option>
        <option value="FREE">FREE (trial)</option>
      </select>
      <label>Produtos (multi)</label>
      <select id="gk-products" multiple size="4" style="height:auto">
        <option value="motionpro" selected>Motion Titles</option>
        <option value="ia" selected>Motion IA</option>
        <option value="legendas" selected>Motion Legendas</option>
        <option value="bundle_all">Bundle</option>
      </select>
      <label>Max devices</label>
      <input id="gk-max" type="number" value="3" min="1" max="50">
      <label>Email do cliente (opcional)</label>
      <input id="gk-email" type="email" placeholder="cliente@email.com">
      <label>Validade (dias · 0 = lifetime)</label>
      <input id="gk-days" type="number" value="0" min="0" max="3650">
      <label>Notas internas</label>
      <input id="gk-notes" placeholder="Ex: Gumroad #12345, parceiro X">
    `;
    modal("🔑 Gerar license_key", body, async () => {
        const tier = document.getElementById("gk-tier").value;
        const products = [...document.getElementById("gk-products").selectedOptions].map(o => o.value);
        const max_devices = Number(document.getElementById("gk-max").value || 3);
        const customer_email = document.getElementById("gk-email").value.trim() || null;
        const days = Number(document.getElementById("gk-days").value || 0);
        const notes = document.getElementById("gk-notes").value.trim() || null;
        const expires_at = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
        const r = await post("/v1/admin/license-keys/generate", { tier, products, max_devices, customer_email, expires_at, notes });
        modalShowKey(r.key, "—");
        loadLicenses();
        return true;
    }, { okText: "Gerar" });
}
const _genBtn = document.getElementById("generate-key-btn");
if (_genBtn) _genBtn.onclick = modalGenerateKey;

// ===========================================================
// TRANSACTIONS (Stripe charges + refund)
// ===========================================================
STATE.transactions = [];
STATE.txTotals = null;

async function loadTransactions() {
    const days = document.getElementById("transactions-days")?.value || 30;
    const status = document.getElementById("transactions-status")?.value || "all";
    try {
        document.getElementById("transactions-sub").textContent = "Buscando charges no Stripe…";
        const r = await get(`/v1/admin/transactions?days=${days}&status=${status === "all" ? "" : status}&limit=100`);
        STATE.transactions = r.transactions || [];
        STATE.txTotals = r.totals;
        renderTransactions();
        document.getElementById("transactions-sub").textContent =
            `${r.transactions.length} charge(s) · janela: ${r.filter.days}d · ${fmtRelative(r.generated_at)}`;
    } catch (e) {
        toast("Falha ao carregar transações: " + e.message, "err");
        document.getElementById("transactions-sub").textContent = "Erro ao buscar (Stripe indisponível?)";
    }
}
function attachTxFilters() {
    ["transactions-days", "transactions-status"].forEach(id => {
        const el = document.getElementById(id);
        if (!el || el._bound) return;
        el._bound = true;
        el.addEventListener("change", loadTransactions);
    });
    const s = document.getElementById("transactions-search");
    if (s && !s._bound) {
        s._bound = true;
        s.addEventListener("input", () => { clearTimeout(window._txSearch); window._txSearch = setTimeout(renderTransactions, 200); });
    }
}
function renderTransactions() {
    attachTxFilters();
    const q = (document.getElementById("transactions-search")?.value || "").toLowerCase().trim();
    let list = STATE.transactions.slice();
    if (q) list = list.filter(t => [t.user_email, t.customer_id, t.id, t.description].some(x => (x || "").toLowerCase().includes(q)));

    const t = STATE.txTotals || {};
    document.getElementById("transactions-kpis").innerHTML = [
        { label: "Bruto (período)",  value: fmtBrl(t.gross_brl || 0), cls: "kpi--ok" },
        { label: "Reembolsado",      value: fmtBrl(t.refunded_brl || 0), cls: (t.refunded_brl > 0 ? "kpi--warn" : "") },
        { label: "Líquido",          value: fmtBrl(t.net_brl || 0), cls: "kpi--accent" },
        { label: "Charges",          value: t.count || 0 },
    ].map(k => `<div class="kpi ${k.cls || ""}"><div class="kpi__label">${k.label}</div><div class="kpi__value">${k.value}</div></div>`).join("");

    const tb = document.getElementById("transactions-tbody");
    if (list.length === 0) {
        tb.innerHTML = `<tr><td colspan="7" class="tbl-empty">Nenhuma transação encontrada</td></tr>`;
        return;
    }
    tb.innerHTML = list.map(c => {
        let stBadge;
        if (c.refunded || c.amount_refunded >= c.amount) stBadge = `<span class="badge badge--warn">REEMBOLSADO</span>`;
        else if (c.amount_refunded > 0)                  stBadge = `<span class="badge badge--warn">PARCIAL</span>`;
        else if (c.disputed)                              stBadge = `<span class="badge badge--err">DISPUTADO</span>`;
        else if (c.paid && c.status === "succeeded")     stBadge = `<span class="badge badge--ok">PAGA</span>`;
        else if (c.status === "pending")                  stBadge = `<span class="badge badge--mut">PENDENTE</span>`;
        else                                              stBadge = `<span class="badge badge--err">FALHOU</span>`;

        const canRefund = c.paid && !c.refunded && c.amount_refunded < c.amount;
        return `<tr>
          <td>${fmtDate(c.created)}<br><span class="muted small">${fmtRelative(c.created)}</span></td>
          <td>${c.user_id
              ? `<a href="#" class="user-link" data-uid="${c.user_id}"><b>${c.user_email}</b></a>`
              : (c.user_email ? `<b>${c.user_email}</b>` : `<span class="muted small">—</span>`)}<br>
              <span class="muted small mono">${c.customer_id || "—"}</span></td>
          <td><b>${fmtBrl(c.amount)}</b>${c.amount_refunded > 0 ? `<br><span class="small" style="color:var(--warn)">-${fmtBrl(c.amount_refunded)} reemb.</span>` : ""}</td>
          <td>${stBadge}</td>
          <td><span class="small">${c.description || "—"}</span></td>
          <td class="mono small">${(c.id || "").slice(0, 18)}…</td>
          <td>
              ${c.receipt_url ? `<a href="${c.receipt_url}" target="_blank" class="btn btn--sm">Recibo ↗</a> ` : ""}
              ${canRefund ? `<button class="btn btn--sm btn--warn" data-refund="${c.id}" data-amt="${c.amount}">Reembolsar</button>` : ""}
          </td>
        </tr>`;
    }).join("");
    tb.querySelectorAll(".user-link").forEach(a => a.onclick = (e) => { e.preventDefault(); openUserDrawer(a.dataset.uid); });
    tb.querySelectorAll("[data-refund]").forEach(b => b.onclick = () => modalRefund(b.dataset.refund, Number(b.dataset.amt)));
}
const _refTxBtn = document.getElementById("refresh-transactions");
if (_refTxBtn) _refTxBtn.onclick = loadTransactions;

function modalRefund(chargeId, maxAmount) {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Refund via Stripe. Total ou parcial. Após confirmação, é IRREVERSÍVEL.</p>
      <p>Charge: <code>${chargeId}</code> · Valor original: <b>${fmtBrl(maxAmount)}</b></p>
      <label>Valor a reembolsar (deixe 0 = TOTAL)</label>
      <input id="rf-amount" type="number" step="0.01" min="0" max="${maxAmount}" value="0">
      <label>Motivo</label>
      <select id="rf-reason">
        <option value="requested_by_customer" selected>Solicitado pelo cliente</option>
        <option value="duplicate">Cobrança duplicada</option>
        <option value="fraudulent">Fraude</option>
        <option value="">—</option>
      </select>
    `;
    modal("💸 Reembolsar Stripe", body, async () => {
        const amount_brl = Number(document.getElementById("rf-amount").value || 0);
        const reason = document.getElementById("rf-reason").value || null;
        const r = await post(`/v1/admin/transactions/${chargeId}/refund`, {
            amount_brl: amount_brl > 0 ? amount_brl : null,
            reason
        });
        toast(`Refund OK: ${fmtBrl(r.refund.amount)} (${r.refund.status})`, "ok");
        loadTransactions();
    }, { danger: true, okText: "Reembolsar" });
}

// ===========================================================
// DRAWER · LICENSES PANEL (license_keys do user)
// ===========================================================
async function renderDrawerLicenses(uid) {
    const panel = document.getElementById("panel-licenses");
    panel.innerHTML = `<div class="skel"></div>`;
    try {
        const r = await get(`/v1/admin/users/${uid}/licenses`);
        const ls = r.licenses || [];
        if (ls.length === 0) {
            panel.innerHTML = `
              <div class="drawer-section">
                <h3>Sem licenças vinculadas</h3>
                <div class="muted small">Nenhuma license_key com customer_email = <code>${r.user_email}</code>.</div>
              </div>`;
            return;
        }
        panel.innerHTML = `
          <div class="drawer-section">
            <h3>${ls.length} licença(s) · ${ls.filter(k => !k.revoked_at).length} ativa(s)</h3>
            ${ls.map(k => {
                const s = licenseStatusOf(k);
                const stBadge = s === "active"  ? `<span class="badge badge--ok">ATIVA</span>`
                             : s === "revoked" ? `<span class="badge badge--err">REVOGADA</span>`
                             :                    `<span class="badge badge--warn">EXPIRADA</span>`;
                const products = (k.products || []).map(p => productBadge(p)).join(" ");
                const activations = (k.activations || []).filter(a => !a.deactivated_at);
                return `
                  <div class="card" style="margin-bottom:12px">
                    <div class="card__head" style="margin-bottom:8px">
                      <div>
                        <div class="mono" style="font-weight:700">${k.key_prefix}…</div>
                        <div class="small muted">Tier <b>${k.tier}</b> · ${products} · ${k.active_devices}/${k.max_devices} devices · ${k.expires_at ? "expira " + fmtDate(k.expires_at) : "lifetime"}</div>
                      </div>
                      <div>${stBadge}</div>
                    </div>
                    ${activations.length > 0 ? `
                      <table style="width:100%;font-size:12px">
                        <thead><tr><th>Device</th><th>OS</th><th>IP</th><th>Última validação</th><th></th></tr></thead>
                        <tbody>
                          ${activations.map(a => `<tr>
                            <td class="mono small">${shortFp(a.device_fingerprint)}<br><span class="muted">${a.device_name || "—"}</span></td>
                            <td>${osIcon(a.device_os)} <span class="small">${a.device_os || "—"}</span></td>
                            <td class="mono small">${a.ip_address || "—"}</td>
                            <td>${fmtRelative(a.last_validation_at)}</td>
                            <td>${!k.revoked_at ? `<button class="btn btn--sm" data-transfer-key="${k.id}" data-from="${a.device_fingerprint}">↔ Transferir</button>` : ""}</td>
                          </tr>`).join("")}
                        </tbody>
                      </table>
                    ` : `<div class="muted small">Nenhum device ativado</div>`}
                    ${s === "active" ? `
                      <div style="margin-top:10px;display:flex;gap:6px">
                        <button class="btn btn--sm btn--warn" data-drawer-reissue="${k.id}">♻️ Reemitir</button>
                        <button class="btn btn--sm btn--danger" data-drawer-revoke-key="${k.id}">🚫 Revogar</button>
                      </div>` : ""}
                  </div>
                `;
            }).join("")}
          </div>
        `;
        panel.querySelectorAll("[data-drawer-revoke-key]").forEach(b => b.onclick = () => {
            modalRevokeKey(b.dataset.drawerRevokeKey);
            // Após confirmar, vai recarregar via loadLicenses — recarrega tb o painel
            setTimeout(() => renderDrawerLicenses(uid), 800);
        });
        panel.querySelectorAll("[data-drawer-reissue]").forEach(b => b.onclick = () => {
            modalReissueKey(b.dataset.drawerReissue);
            setTimeout(() => renderDrawerLicenses(uid), 800);
        });
        panel.querySelectorAll("[data-transfer-key]").forEach(b => b.onclick = () => {
            modalTransferDevice(b.dataset.transferKey, b.dataset.from, () => renderDrawerLicenses(uid));
        });
    } catch (e) {
        panel.innerHTML = `<div class="muted">Erro ao carregar licenças: ${e.message}</div>`;
    }
}

function modalTransferDevice(keyId, fromFp, after) {
    const body = document.createElement("div");
    body.innerHTML = `
      <p>Desativa o device de origem e ativa o destino na mesma license_key. Útil quando o cliente troca de máquina.</p>
      <label>Fingerprint de origem</label>
      <input id="td-from" value="${fromFp}" readonly class="mono">
      <label>Fingerprint de destino</label>
      <input id="td-to" placeholder="abc123...">
      <label>Nome do device destino (opcional)</label>
      <input id="td-name" placeholder="Workstation cliente">
      <label>OS destino (opcional)</label>
      <input id="td-os" placeholder="Windows 11">
    `;
    modal("↔ Transferir device", body, async () => {
        const to_fingerprint = document.getElementById("td-to").value.trim();
        if (!to_fingerprint) return false;
        const to_name = document.getElementById("td-name").value.trim() || null;
        const to_os = document.getElementById("td-os").value.trim() || null;
        await post(`/v1/admin/license-keys/${keyId}/transfer-device`, {
            from_fingerprint: fromFp, to_fingerprint, to_name, to_os
        });
        toast("Device transferido", "ok");
        if (after) after();
    }, { okText: "Transferir" });
}

// Intercepta o click nas tabs do drawer pra carregar Licenses sob demanda
document.querySelectorAll(".drawer__tab").forEach(t => {
    if (t.dataset.tab === "licenses") {
        t.addEventListener("click", () => {
            const uid = STATE.selectedUser?.user?.id;
            if (uid) renderDrawerLicenses(uid);
        });
    }
});

// ===========================================================
// BOOT
// ===========================================================
(async () => {
    const restored = await tryRestoreSession();
    if (!restored) showLogin();
})();
