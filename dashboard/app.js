// Motion Titles Admin Dashboard
const API = window.MV_API || "https://motionpro.vercel.app";
const TOKEN_KEY = "mv_admin_token";

document.getElementById("api-url-display").textContent = API;

// ===== AUTH =====
let token = localStorage.getItem(TOKEN_KEY);
let me = null;

async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;
    const r = await fetch(API + path, { ...opts, headers });
    const data = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
    if (!r.ok) throw new Error(data?.error || data?.message || ("HTTP " + r.status));
    return data;
}

function showApp() {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app").hidden = false;
    document.getElementById("me-email").textContent = me?.email || "";
    refreshOverview();
}

function showLogin() {
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("app").hidden = true;
    document.getElementById("login-pass").value = "";
}

async function checkAuth() {
    if (!token) return showLogin();
    try {
        const r = await api("/v1/admin/stats");
        me = { email: localStorage.getItem("mv_admin_email") };
        showApp();
        return r;
    } catch (e) {
        if (e.message === "admin_required") {
            toast("Sua conta não é admin", "error");
            localStorage.removeItem(TOKEN_KEY);
            token = null;
        }
        showLogin();
    }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-pass").value;
    const err = document.getElementById("login-error");
    err.textContent = "";
    try {
        const r = await api("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
        token = r.session_token;
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem("mv_admin_email", email);
        me = { email };
        // verify admin
        await api("/v1/admin/stats");
        showApp();
    } catch (e2) {
        err.textContent = e2.message === "admin_required"
            ? "Esta conta não tem permissão de admin"
            : "Credenciais inválidas ou erro: " + e2.message;
        localStorage.removeItem(TOKEN_KEY);
        token = null;
    }
});

document.getElementById("logout-btn").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("mv_admin_email");
    token = null; me = null;
    showLogin();
});

// ===== NAV =====
document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
        e.preventDefault();
        const v = item.dataset.view;
        document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n === item));
        document.querySelectorAll(".view").forEach(s => s.classList.toggle("active", s.id === "view-" + v));
        if (v === "overview") refreshOverview();
        if (v === "analytics") refreshAnalytics();
        if (v === "users") refreshUsers();
        if (v === "subscriptions") refreshSubs();
        if (v === "devices") refreshDevices();
        if (v === "sessions") { /* lazy: só carrega quando user clica Carregar */ }
        if (v === "audit") refreshAudit();
    });
});

// ===== HELPERS =====
function fmtBRL(v) { return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d) {
    if (!d) return "—";
    const dt = new Date(d);
    return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
    if (!d) return "—";
    return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function daysUntil(d) {
    if (!d) return null;
    const diff = (new Date(d) - new Date()) / (1000 * 60 * 60 * 24);
    return Math.floor(diff);
}
function planBadge(plan) {
    const c = plan === "lifetime" ? "purple" : plan === "yearly" ? "blue" : plan === "trial" ? "orange" : "gray";
    const label = plan === "lifetime" ? "Vitalício" : plan === "yearly" ? "Anual" : plan === "trial" ? "Trial" : plan || "—";
    return `<span class="badge badge--${c}">${label}</span>`;
}
function productBadge(productId) {
    if (!productId) return '';
    const map = {
        motionpro:  { emoji: "🎬", label: "Titles",   color: "blue" },
        legendas:   { emoji: "💬", label: "Legendas", color: "green" },
        ia:         { emoji: "🤖", label: "IA",       color: "orange" },
        bundle_all: { emoji: "💎", label: "Bundle",   color: "purple" }
    };
    const p = map[productId] || { emoji: "📦", label: productId, color: "gray" };
    return `<span class="badge badge--${p.color}" title="${productId}">${p.emoji} ${p.label}</span>`;
}
function statusBadge(s) {
    const map = {
        active: ["green", "Ativo"], trialing: ["orange", "Trial"],
        canceled: ["red", "Cancelado"], past_due: ["red", "Atrasado"],
        revoked: ["red", "Revogado"], incomplete: ["gray", "Incompleto"]
    };
    const [c, l] = map[s] || ["gray", s || "—"];
    return `<span class="badge badge--${c}">${l}</span>`;
}
function toast(msg, type = "success") {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast " + type;
    t.hidden = false;
    setTimeout(() => { t.hidden = true; }, 3000);
}
function activeSub(subs) { return (subs || []).find(s => s.status === "active" || s.status === "trialing"); }

// ===== OVERVIEW =====
async function refreshOverview() {
    try {
        const s = await api("/v1/admin/stats");
        document.getElementById("kpis").innerHTML = `
            <div class="kpi"><div class="kpi-label">Receita total</div><div class="kpi-value green">${fmtBRL(s.total_revenue_brl || 0)}</div><div class="kpi-sub">Soma bruta de assinaturas</div></div>
            <div class="kpi"><div class="kpi-label">MRR estimado</div><div class="kpi-value">${fmtBRL(s.mrr_brl || 0)}</div><div class="kpi-sub">Receita mensal recorrente</div></div>
            <div class="kpi"><div class="kpi-label">Assinaturas ativas</div><div class="kpi-value blue">${s.active_subs || 0}</div><div class="kpi-sub">Inclui trial</div></div>
            <div class="kpi"><div class="kpi-label">Usuários totais</div><div class="kpi-value">${s.total_users || 0}</div><div class="kpi-sub">+${s.new_users_30d || 0} últimos 30d</div></div>
            <div class="kpi"><div class="kpi-label">Dispositivos ativos</div><div class="kpi-value">${s.active_devices || 0}</div><div class="kpi-sub">Plugin Premiere instalado</div></div>
            <div class="kpi"><div class="kpi-label">Cancelados</div><div class="kpi-value orange">${s.canceled_subs || 0}</div><div class="kpi-sub">Churn histórico</div></div>
        `;
        document.getElementById("plan-distribution").innerHTML = `
            <div class="card-row"><span>Vitalício</span><strong>${s.lifetime_subs || 0} clientes</strong></div>
            <div class="card-row"><span>Anual</span><strong>${s.yearly_subs || 0} clientes</strong></div>
            <div class="card-row"><span>Em trial</span><strong>${s.trialing_subs || 0} clientes</strong></div>
        `;
        document.getElementById("recent-stats").innerHTML = `
            <div class="card-row"><span>Novos usuários (7d)</span><strong>${s.new_users_7d || 0}</strong></div>
            <div class="card-row"><span>Novos usuários (30d)</span><strong>${s.new_users_30d || 0}</strong></div>
            <div class="card-row"><span>Atualizado</span><span style="color:var(--mut);font-size:12px">${fmtDateTime(s.generated_at)}</span></div>
        `;
    } catch (e) { toast("Erro: " + e.message, "error"); }
}
document.getElementById("refresh-stats").addEventListener("click", refreshOverview);

// ===== USERS =====
let usersCache = [];
async function refreshUsers() {
    const q = document.getElementById("users-search").value.trim();
    const status = document.getElementById("users-status").value;
    try {
        const params = new URLSearchParams({ q, status });
        const r = await api("/v1/admin/users?" + params);
        usersCache = r.users;
        renderUsers(r.users);
    } catch (e) { toast("Erro: " + e.message, "error"); }
}
function renderUsers(users) {
    const tbody = document.getElementById("users-tbody");
    document.getElementById("users-empty").hidden = users.length > 0;
    tbody.innerHTML = users.map(u => {
        const sub = activeSub(u.subscriptions);
        const stripeLink = u.stripe_customer ? `<a href="https://dashboard.stripe.com/customers/${u.stripe_customer}" target="_blank" style="color:var(--blue)">↗ ver</a>` : '<span class="muted">—</span>';
        const venc = sub?.current_period_end ? fmtDate(sub.current_period_end) : (sub?.plan === "lifetime" ? "♾️ nunca" : "—");
        const dias = sub?.current_period_end ? daysUntil(sub.current_period_end) : null;
        const vencSub = dias !== null ? `<small>${dias > 0 ? "em " + dias + "d" : Math.abs(dias) + "d atrás"}</small>` : "";
        const nameDisplay = u.name ? `<strong>${u.name}</strong><br>` : '';
        const emailVerifyIcon = u.email_verified
            ? '<span title="E-mail verificado" style="color:var(--green);margin-left:4px">✓</span>'
            : '<span title="E-mail NÃO verificado" style="color:var(--orange);margin-left:4px">⚠</span>';
        const phoneDisplay = u.phone
            ? `<small style="color:var(--mut);display:block;margin-top:2px">📱 ${u.phone}</small>`
            : '';
        // Lista TODOS os produtos que o user tem (active/trialing)
        const activeProducts = (u.subscriptions || []).filter(s => ["active","trialing"].includes(s.status));
        const productsHtml = activeProducts.length
            ? activeProducts.map(s => productBadge(s.product_id)).join(' ')
            : '<span class="muted">—</span>';
        return `<tr data-id="${u.id}">
            <td class="email-cell">${nameDisplay}${u.email}${emailVerifyIcon}${u.is_admin ? ' <span class="badge badge--purple" style="margin-left:6px">ADMIN</span>' : ''}<span class="id">${u.id.slice(0,8)}…</span>${phoneDisplay}</td>
            <td>${productsHtml}</td>
            <td>${sub ? planBadge(sub.plan) : '<span class="muted">sem assinatura</span>'}</td>
            <td>${sub ? statusBadge(sub.status) : '—'}</td>
            <td class="date-cell">${fmtDate(u.created_at)}</td>
            <td class="date-cell">${venc}${vencSub}</td>
            <td>${u.active_devices}/${u.total_devices || 0}</td>
            <td>${stripeLink}</td>
            <td><div class="row-actions">
                <button class="btn btn--ghost btn--sm" data-action="detail">Detalhes</button>
            </div></td>
        </tr>`;
    }).join("");
    tbody.querySelectorAll("button[data-action='detail']").forEach(b => {
        b.addEventListener("click", (e) => {
            const id = e.target.closest("tr").dataset.id;
            openUserDrawer(id);
        });
    });
}
document.getElementById("refresh-users").addEventListener("click", refreshUsers);
document.getElementById("users-search").addEventListener("input", () => {
    clearTimeout(window._searchT);
    window._searchT = setTimeout(refreshUsers, 300);
});
document.getElementById("users-status").addEventListener("change", refreshUsers);

// Devices + Sessions wiring
document.getElementById("refresh-devices")?.addEventListener("click", refreshDevices);
document.getElementById("devices-search")?.addEventListener("input", () => {
    clearTimeout(window._devT);
    window._devT = setTimeout(refreshDevices, 300);
});
document.getElementById("devices-country")?.addEventListener("change", refreshDevices);
document.getElementById("devices-status")?.addEventListener("change", refreshDevices);
document.getElementById("refresh-sessions")?.addEventListener("click", refreshSessions);

// ===== SUBSCRIPTIONS =====
async function refreshSubs() {
    try {
        const r = await api("/v1/admin/users?status=active&limit=500");
        const rows = [];
        r.users.forEach(u => {
            (u.subscriptions || []).filter(s => ["active", "trialing"].includes(s.status)).forEach(s => {
                rows.push(`<tr>
                    <td class="email-cell">${u.email}</td>
                    <td>${productBadge(s.product_id || 'motionpro')}</td>
                    <td>${planBadge(s.plan)}</td>
                    <td>${statusBadge(s.status)}</td>
                    <td class="date-cell">${fmtDate(s.started_at)}</td>
                    <td class="date-cell">${s.current_period_end ? fmtDate(s.current_period_end) : (s.plan === 'lifetime' ? '♾️' : '—')}</td>
                    <td><code>${s.stripe_sub_id ? s.stripe_sub_id.slice(0,20) + '…' : 'manual'}</code></td>
                    <td><div class="row-actions">
                        ${s.stripe_sub_id && !s.stripe_sub_id.startsWith('manual_') ? `<button class="btn btn--danger btn--sm" data-cancel="${s.stripe_sub_id}">Cancelar</button>` : ''}
                    </div></td>
                </tr>`);
            });
        });
        document.getElementById("subs-tbody").innerHTML = rows.join("") || `<tr><td colspan="7" class="empty">Sem assinaturas ativas</td></tr>`;
        document.querySelectorAll("button[data-cancel]").forEach(b => {
            b.addEventListener("click", async (e) => {
                const subId = e.target.dataset.cancel;
                if (!confirm("Cancelar assinatura ao fim do período atual?")) return;
                try {
                    await api(`/v1/admin/subscriptions/${subId}/cancel`, { method: "POST", body: JSON.stringify({ immediate: false }) });
                    toast("Cancelamento agendado pra fim do período");
                    refreshSubs();
                } catch (e) { toast("Erro: " + e.message, "error"); }
            });
        });
    } catch (e) { toast("Erro: " + e.message, "error"); }
}
document.getElementById("refresh-subs").addEventListener("click", refreshSubs);

// ===== DEVICES =====
function flag(country) {
    return ({ BR: "🇧🇷", US: "🇺🇸", PT: "🇵🇹", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", ES: "🇪🇸", MX: "🇲🇽", AR: "🇦🇷", LOCAL: "🏠" }[country]) || "🌐";
}

async function refreshDevices() {
    try {
        const params = new URLSearchParams();
        const s = document.getElementById("devices-search")?.value.trim();
        const c = document.getElementById("devices-country")?.value;
        const r = document.getElementById("devices-status")?.value;
        if (s) params.set("search", s);
        if (c) params.set("country", c);
        if (r) params.set("revoked", r);
        params.set("limit", "200");

        const d = await api("/v1/admin/devices?" + params);
        const rows = (d.devices || []).map(dev => {
            const loc = [dev.city, dev.country].filter(Boolean).join(", ");
            return `<tr>
                <td class="email-cell">${dev.email}</td>
                <td>${dev.label || dev.hostname || '—'}<br><small><code>${(dev.id||"").slice(0,8)}</code></small></td>
                <td>${dev.os_name || '—'}</td>
                <td><code>${dev.last_ip || '—'}</code></td>
                <td>${flag(dev.country)} ${loc || '—'}</td>
                <td class="date-cell">${fmtDateTime(dev.last_seen)}</td>
                <td>${dev.revoked ? '<span class="badge badge--red">Revogado</span>' : '<span class="badge badge--green">Ativo</span>'}</td>
                <td>
                  ${!dev.revoked ? `<button class="btn btn--danger btn--sm" data-revoke-device="${dev.id}">Revogar</button>` : ''}
                  <button class="btn btn--ghost btn--sm" data-load-sessions="${dev.user_id}" title="Ver sessões deste user">🔐</button>
                </td>
            </tr>`;
        });
        document.getElementById("devices-tbody").innerHTML = rows.join("") || `<tr><td colspan="8" class="empty">Nenhum dispositivo encontrado</td></tr>`;

        document.querySelectorAll("button[data-revoke-device]").forEach(b => {
            b.addEventListener("click", async (e) => {
                const id = e.target.dataset.revokeDevice;
                if (!confirm("Revogar este dispositivo? O cliente vai precisar reativar.")) return;
                try { await api(`/v1/admin/devices/${id}/revoke`, { method: "POST" }); toast("Revogado"); refreshDevices(); }
                catch (e) { toast("Erro: " + e.message, "error"); }
            });
        });
        document.querySelectorAll("button[data-load-sessions]").forEach(b => {
            b.addEventListener("click", (e) => {
                const uid = e.target.dataset.loadSessions;
                document.querySelector('.nav-item[data-view="sessions"]').click();
                document.getElementById("sessions-user-id").value = uid;
                refreshSessions();
            });
        });
    } catch (e) { toast("Erro: " + e.message, "error"); }
}

// ===== SESSIONS =====
async function refreshSessions() {
    const uid = document.getElementById("sessions-user-id").value.trim();
    if (!uid) { toast("Cole um user_id primeiro", "error"); return; }
    try {
        const r = await api(`/v1/admin/users/${uid}/sessions`);
        const rows = (r.sessions || []).map(s => {
            const expired = new Date(s.expires_at) < new Date();
            const revoked = s.revoked;
            const cls = revoked ? "row-revoked" : (expired ? "row-expired" : "");
            return `<tr class="${cls}">
                <td>${s.device_label || s.hostname || '—'}<br><small>${s.os_name || ''}</small></td>
                <td><code>${s.last_ip || '?'}</code> ${flag(s.country)}</td>
                <td class="date-cell">${fmtDateTime(s.issued_at)}</td>
                <td class="date-cell">${fmtDateTime(s.expires_at)}</td>
                <td class="date-cell">${fmtDateTime(s.last_seen_at)}</td>
                <td>${revoked ? `<span class="badge badge--red">Revogada</span><br><small>${s.revoke_reason || ''}</small>` : (expired ? '<span class="badge badge--gray">Expirada</span>' : '<span class="badge badge--green">Ativa</span>')}</td>
                <td>${!revoked && !expired ? `<button class="btn btn--danger btn--sm" data-revoke-session="${s.id}">Kill</button>` : ''}</td>
            </tr>`;
        });
        document.getElementById("sessions-tbody").innerHTML = rows.join("") + `
            <tr><td colspan="7" style="text-align:right;padding-top:18px">
                <button class="btn btn--danger" id="revoke-all-sessions" data-uid="${uid}">⚠️ Kill TODAS sessões deste user</button>
            </td></tr>`;

        document.querySelectorAll("button[data-revoke-session]").forEach(b => {
            b.addEventListener("click", async (e) => {
                if (!confirm("Kill esta sessão? User vai precisar relogar nesse device.")) return;
                try { await api(`/v1/admin/sessions/${e.target.dataset.revokeSession}/revoke`, { method: "POST", body: JSON.stringify({ reason: "admin_kill" }) }); toast("Kill"); refreshSessions(); }
                catch (e) { toast("Erro: " + e.message, "error"); }
            });
        });
        const allBtn = document.getElementById("revoke-all-sessions");
        if (allBtn) allBtn.addEventListener("click", async () => {
            if (!confirm("KILL TODAS as sessões deste user? Vai deslogar em todos os devices.")) return;
            try { const r2 = await api(`/v1/admin/users/${uid}/sessions/revoke-all`, { method: "POST", body: JSON.stringify({ reason: "admin_killall" }) }); toast(`Killed ${r2.revoked} sessions`); refreshSessions(); }
            catch (e) { toast("Erro: " + e.message, "error"); }
        });
    } catch (e) { toast("Erro: " + e.message, "error"); }
}

// ===== ANALYTICS =====
let charts = { signups: null, revenue: null, products: null };
async function refreshAnalytics() {
    const days = document.getElementById("analytics-range").value || "30";
    try {
        const d = await api("/v1/admin/stats/timeline?days=" + days);

        // Conversion cards (por produto)
        document.getElementById("conv-cards").innerHTML = d.conversion.map(c => {
            const productName = { motionpro: "Motion Titles", legendas: "Motion Legendas", ia: "Motion IA", bundle_all: "Bundle" }[c.product_id] || c.product_id;
            const emoji = { motionpro: "🎬", legendas: "💬", ia: "🤖", bundle_all: "💎" }[c.product_id] || "📦";
            return `<div class="kpi">
                <div class="kpi-label">${emoji} ${productName} · Conversão</div>
                <div class="kpi-value ${c.conversion_rate >= 30 ? 'green' : c.conversion_rate >= 15 ? 'blue' : 'orange'}">${c.conversion_rate}%</div>
                <div class="kpi-sub">${c.converted} pagantes de ${c.trials} trials</div>
            </div>`;
        }).join("") || `<div class="kpi"><div class="kpi-label">Sem dados ainda</div><div class="kpi-value muted">—</div></div>`;

        // Chart 1: signups por dia
        const signupsByDay = {};
        d.signups.forEach(s => signupsByDay[s.day.slice(0,10)] = s.count);
        const labels = fillDateRange(Number(days));
        const signupData = labels.map(l => signupsByDay[l] || 0);
        renderLine("chart-signups", labels, [
            { label: "Novos usuários", data: signupData, color: "#2563EB" }
        ]);

        // Chart 2: revenue por dia
        const revByDay = {};
        d.checkouts.forEach(c => {
            const day = c.day.slice(0,10);
            revByDay[day] = (revByDay[day] || 0) + Number(c.revenue || 0);
        });
        const revData = labels.map(l => revByDay[l] || 0);
        renderLine("chart-revenue", labels, [
            { label: "Receita (R$)", data: revData, color: "#22c55e" }
        ], { yLabel: "R$" });

        // Chart 3: subs por produto (doughnut)
        const byProduct = {};
        d.subs_active.forEach(s => {
            if (s.status === "active" || s.status === "trialing") {
                const key = s.product_id || "Motion Titles";
                byProduct[key] = (byProduct[key] || 0) + s.count;
            }
        });
        renderDoughnut("chart-products",
            Object.keys(byProduct).map(k => ({
                motionpro: "Motion Titles", legendas: "Motion Legendas", ia: "Motion IA", bundle_all: "Bundle"
            }[k] || k)),
            Object.values(byProduct),
            ["#2563EB", "#22c55e", "#f97316", "#a855f7", "#f59e0b"]
        );
    } catch (e) { toast("Erro: " + e.message, "error"); }
}

function fillDateRange(days) {
    const out = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}

function renderLine(canvasId, labels, datasets, opts) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === "undefined") return;
    if (charts[canvasId]) { charts[canvasId].destroy(); }
    charts[canvasId] = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels.map(l => l.slice(5)),
            datasets: datasets.map(d => ({
                label: d.label, data: d.data,
                borderColor: d.color, backgroundColor: d.color + "22",
                fill: true, tension: 0.3, borderWidth: 2,
                pointRadius: 0, pointHoverRadius: 5
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: "#a0a0aa", font: { family: "Inter" }}}},
            scales: {
                x: { ticks: { color: "#7e8395", maxTicksLimit: 10 }, grid: { color: "#26262e" }},
                y: {
                    beginAtZero: true,
                    ticks: { color: "#7e8395", callback: v => (opts?.yLabel ? opts.yLabel + " " + v : v) },
                    grid: { color: "#26262e" }
                }
            }
        }
    });
}
function renderDoughnut(canvasId, labels, data, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === "undefined") return;
    if (charts[canvasId]) { charts[canvasId].destroy(); }
    charts[canvasId] = new Chart(ctx, {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#06070a", borderWidth: 2 }]},
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: "bottom", labels: { color: "#a0a0aa", font: { family: "Inter" }, padding: 14 }}}
        }
    });
}
document.getElementById("refresh-analytics").addEventListener("click", refreshAnalytics);
document.getElementById("analytics-range").addEventListener("change", refreshAnalytics);

// ===== AUDIT =====
async function refreshAudit() {
    try {
        const r = await api("/v1/admin/audit?limit=200");
        document.getElementById("audit-tbody").innerHTML = r.events.map(ev => `
            <tr>
                <td class="date-cell">${fmtDateTime(ev.created_at)}</td>
                <td class="email-cell">${ev.email || '<span class="muted">—</span>'}</td>
                <td><span class="badge badge--gray">${ev.action}</span></td>
                <td><code>${JSON.stringify(ev.detail || {}).slice(0,80)}</code></td>
            </tr>
        `).join("") || `<tr><td colspan="4" class="empty">Sem eventos</td></tr>`;
    } catch (e) { toast("Erro: " + e.message, "error"); }
}
document.getElementById("refresh-audit").addEventListener("click", refreshAudit);

// ===== USER DRAWER =====
async function openUserDrawer(id) {
    const drawer = document.getElementById("drawer");
    drawer.hidden = false;
    document.getElementById("drawer-title").textContent = "Carregando...";
    document.getElementById("drawer-body").innerHTML = '<div class="loading"></div>';
    try {
        const d = await api("/v1/admin/users/" + id);
        const u = d.user;
        const sub = activeSub(d.subscriptions);
        document.getElementById("drawer-title").textContent = u.email;
        document.getElementById("drawer-body").innerHTML = `
            <div class="drawer-actions">
                <select id="grant-product" style="background:var(--bg2);border:1px solid var(--border2);color:var(--txt);border-radius:6px;padding:7px 10px;font:600 12px Inter;cursor:pointer">
                    <option value="motionpro">🎬 Motion Titles</option>
                    <option value="legendas">💬 Motion Legendas</option>
                    <option value="ia">🤖 Motion IA</option>
                    <option value="bundle_all">💎 Bundle Completo</option>
                </select>
                <button class="btn btn--primary btn--sm" data-act="grant-yearly">+ Anual cortesia</button>
                <button class="btn btn--primary btn--sm" data-act="grant-lifetime">+ Vitalício cortesia</button>
                <button class="btn btn--ghost btn--sm" data-act="extend-trial">⏰ +7d trial</button>
                <button class="btn btn--ghost btn--sm" data-act="send-email">📧 Enviar email</button>
                <button class="btn btn--ghost btn--sm" data-act="killall-sessions">🔐 Kill sessions</button>
                ${(d.subscriptions || []).some(s => s.status === 'revoked')
                    ? '<button class="btn btn--primary btn--sm" data-act="unblock">✅ Desbloquear</button>'
                    : '<button class="btn btn--danger btn--sm" data-act="block">🚫 BLOQUEAR</button>'}
                <button class="btn btn--danger btn--sm" data-act="delete-user" style="background:#7f1d1d">🗑 DELETAR</button>
                ${!u.is_admin ? '<button class="btn btn--ghost btn--sm" data-act="promote">🛡 Promover a admin</button>' : ''}
                ${u.stripe_customer ? `<a class="btn btn--ghost btn--sm" target="_blank" href="https://dashboard.stripe.com/customers/${u.stripe_customer}">↗ Stripe</a>` : ''}
            </div>

            <div class="drawer-section">
                <h4>Dados da conta</h4>
                <div class="drawer-grid">
                    <div class="drawer-field"><div class="drawer-field-label">Nome</div><div class="drawer-field-value">${u.name || '<span class="muted">não informado</span>'}</div></div>
                    <div class="drawer-field"><div class="drawer-field-label">Telefone</div><div class="drawer-field-value">${u.phone ? '📱 ' + u.phone : '<span class="muted">não informado</span>'} ${u.phone && u.phone_verified ? '<span style="color:var(--green)">✓ verificado</span>' : ''}</div></div>
                    <div class="drawer-field"><div class="drawer-field-label">E-mail</div><div class="drawer-field-value">${u.email} ${u.email_verified ? '<span style="color:var(--green)">✓ verificado</span>' : '<span style="color:var(--orange)">⚠ não verificado</span>'}</div></div>
                    <div class="drawer-field"><div class="drawer-field-label">Marketing opt-in</div><div class="drawer-field-value">${u.marketing_optin ? '✅ Aceita' : '🚫 Recusou'}</div></div>
                    <div class="drawer-field"><div class="drawer-field-label">Cadastro</div><div class="drawer-field-value">${fmtDateTime(u.created_at)}</div></div>
                    <div class="drawer-field"><div class="drawer-field-label">Admin?</div><div class="drawer-field-value">${u.is_admin ? '✅ Sim' : '—'}</div></div>
                    <div class="drawer-field" style="grid-column:1/-1"><div class="drawer-field-label">ID</div><div class="drawer-field-value"><code>${u.id}</code></div></div>
                    <div class="drawer-field" style="grid-column:1/-1"><div class="drawer-field-label">Stripe Customer</div><div class="drawer-field-value"><code>${u.stripe_customer || '—'}</code></div></div>
                </div>
            </div>

            <div class="drawer-section">
                <h4>Assinaturas (${d.subscriptions.length})</h4>
                ${d.subscriptions.length === 0 ? '<p class="muted">Sem assinaturas</p>' : d.subscriptions.map(s => `
                    <div class="drawer-field" style="margin-bottom:10px">
                        ${productBadge(s.product_id || 'motionpro')} ${planBadge(s.plan)} ${statusBadge(s.status)}
                        <div style="margin-top:8px;font-size:13px">
                            <div>Início: <strong>${fmtDateTime(s.started_at)}</strong></div>
                            <div>Próxima cobrança: <strong>${s.current_period_end ? fmtDateTime(s.current_period_end) : (s.plan === 'lifetime' ? '♾️ nunca' : '—')}</strong></div>
                            ${s.cancel_at ? `<div>Cancela em: <strong>${fmtDateTime(s.cancel_at)}</strong></div>` : ''}
                            <div>Stripe Sub: <code>${s.stripe_sub_id || 'manual'}</code></div>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="drawer-section">
                <h4>Dispositivos (${d.devices.length})</h4>
                ${d.devices.length === 0 ? '<p class="muted">Sem dispositivos</p>' : d.devices.map(dev => `
                    <div class="drawer-field" style="margin-bottom:8px">
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div>
                                <code>${dev.fingerprint.slice(0,24)}…</code>
                                ${dev.revoked ? '<span class="badge badge--red">Revogado</span>' : '<span class="badge badge--green">Ativo</span>'}
                                <div style="font-size:12px;color:var(--mut);margin-top:4px">
                                    Último acesso: ${fmtDateTime(dev.last_seen)} · Primeiro: ${fmtDateTime(dev.first_seen)}
                                </div>
                            </div>
                            ${!dev.revoked ? `<button class="btn btn--danger btn--sm" data-revoke-dev="${dev.id}">Revogar</button>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="drawer-section">
                <h4>Faturas Stripe (${d.stripe_invoices.length})</h4>
                ${d.stripe_invoices.length === 0 ? '<p class="muted">Sem faturas no Stripe</p>' : d.stripe_invoices.map(i => `
                    <div class="drawer-field" style="margin-bottom:8px">
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div>
                                <strong>${i.number || i.id}</strong> · ${fmtBRL(i.amount_paid)}
                                <span class="badge badge--${i.status === 'paid' ? 'green' : 'orange'}" style="margin-left:6px">${i.status}</span>
                                <div style="font-size:12px;color:var(--mut);margin-top:4px">
                                    ${fmtDate(i.created * 1000)} · período ${fmtDate(i.period_start * 1000)} → ${fmtDate(i.period_end * 1000)}
                                </div>
                            </div>
                            ${i.hosted_invoice_url ? `<a target="_blank" href="${i.hosted_invoice_url}" class="btn btn--ghost btn--sm">↗ ver</a>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="drawer-section">
                <h4>🔐 Sessões ativas (${(d.sessions || []).filter(s => !s.revoked && new Date(s.expires_at) > new Date()).length}/${(d.sessions || []).length})</h4>
                ${!(d.sessions || []).length ? '<p class="muted">Sem sessions registradas (migration 006 pendente?)</p>' : (d.sessions || []).slice(0, 10).map(s => {
                    const exp = new Date(s.expires_at);
                    const ativo = !s.revoked && exp > new Date();
                    return `
                    <div class="drawer-field" style="margin-bottom:6px;font-size:13px">
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div>
                                ${ativo ? '<span class="badge badge--green">🟢 ativa</span>' : (s.revoked ? '<span class="badge badge--red">revogada</span>' : '<span class="badge badge--gray">expirada</span>')}
                                <code style="font-size:11px;margin:0 8px">${s.last_ip || '?'}</code>
                                ${flag(s.country)} ${s.country || ''}
                                <div style="font-size:11px;color:var(--mut);margin-top:2px">
                                    último ping: ${fmtDateTime(s.last_seen_at)} · expira ${fmtDate(s.expires_at)}
                                </div>
                            </div>
                            ${ativo ? `<button class="btn btn--danger btn--sm" data-revoke-session="${s.id}">Kill</button>` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>

            <div class="drawer-section">
                <h4>📥 Downloads recentes (${(d.downloads || []).length})</h4>
                ${!(d.downloads || []).length ? '<p class="muted">Nenhum download registrado</p>' : (d.downloads || []).slice(0, 10).map(dl => `
                    <div class="drawer-field" style="margin-bottom:4px;font-size:12.5px">
                        <span class="muted">${fmtDateTime(dl.created_at)}</span>
                        <code style="font-size:11px;margin-left:8px">IP ${dl.ip || '?'}</code>
                    </div>
                `).join('')}
            </div>

            <div class="drawer-section">
                <h4>📜 Auditoria (${d.audit.length} últimos)</h4>
                ${d.audit.length === 0 ? '<p class="muted">Sem eventos</p>' : d.audit.slice(0, 20).map(a => `
                    <div class="drawer-field" style="margin-bottom:6px;font-size:13px">
                        <span class="muted">${fmtDateTime(a.created_at)}</span>
                        <span class="badge badge--gray" style="margin:0 6px">${a.action}</span>
                        <code style="font-size:11px">${JSON.stringify(a.detail || {}).slice(0,60)}</code>
                    </div>
                `).join('')}
            </div>
        `;

        // Wire action buttons
        const wire = (sel, fn) => document.querySelector(sel)?.addEventListener("click", fn);
        wire('[data-act="grant-yearly"]', async () => {
            const product_id = document.getElementById("grant-product").value;
            if (!confirm(`Dar 1 ANO de cortesia do produto "${product_id}"?`)) return;
            try { await api(`/v1/admin/users/${id}/grant`, { method: "POST", body: JSON.stringify({ plan: "yearly", product_id, reason: "courtesy" }) }); toast("Anual concedido pra " + product_id); openUserDrawer(id); refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="grant-lifetime"]', async () => {
            const product_id = document.getElementById("grant-product").value;
            if (!confirm(`Dar VITALÍCIO de cortesia do produto "${product_id}"?`)) return;
            try { await api(`/v1/admin/users/${id}/grant`, { method: "POST", body: JSON.stringify({ plan: "lifetime", product_id, reason: "courtesy" }) }); toast("Vitalício concedido pra " + product_id); openUserDrawer(id); refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="revoke"]', async () => {
            if (!confirm("⚠️ REVOGAR todo o acesso deste usuário? Vai desativar a licença e todos dispositivos.")) return;
            try { await api(`/v1/admin/users/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason: "admin_panel" }) }); toast("Acesso revogado"); openUserDrawer(id); refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="promote"]', async () => {
            if (!confirm("Promover esta conta a ADMIN?")) return;
            try { await api(`/v1/admin/users/${id}/promote`, { method: "POST" }); toast("Promovido a admin"); openUserDrawer(id); refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="extend-trial"]', async () => {
            const days = Number(prompt("Estender trial em quantos dias?", "7")) || 7;
            if (days < 1 || days > 365) { toast("Dias inválido (1-365)", "error"); return; }
            try { await api(`/v1/admin/users/${id}/extend-trial`, { method: "POST", body: JSON.stringify({ days }) }); toast(`Trial +${days}d`); openUserDrawer(id); refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="send-email"]', async () => {
            const subject = prompt("Assunto do email:", "Aviso importante");
            if (!subject) return;
            const text = prompt("Mensagem (texto simples):", "");
            if (!text) return;
            const html = `<div style="font-family:Inter,sans-serif;padding:24px;max-width:560px;color:#0a0a0a"><h2 style="color:#2563eb">${subject}</h2><p style="line-height:1.6;color:#444">${text.replace(/\n/g,'<br>')}</p><hr style="margin:24px 0;border:none;border-top:1px solid #e6e6ea"><p style="font-size:12px;color:#888">PacotesFX · MotionPro · suporte@pacotesfx.com</p></div>`;
            try { const r = await api(`/v1/admin/users/${id}/send-email`, { method: "POST", body: JSON.stringify({ subject, html, text }) }); toast(`Email enviado pra ${r.sent_to}`); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="killall-sessions"]', async () => {
            if (!confirm("Kill TODAS as sessões deste user? Ele vai precisar logar de novo em todos os devices.")) return;
            try { const r = await api(`/v1/admin/users/${id}/sessions/revoke-all`, { method: "POST", body: JSON.stringify({ reason: "admin_killall" }) }); toast(`Killed ${r.revoked || 0} sessions`); openUserDrawer(id); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="block"]', async () => {
            const reason = prompt("Motivo do bloqueio? (vai pro audit log)", "fraude/abuso") || "admin_block";
            if (!confirm(`⛔ BLOQUEAR este usuário?\n\nVai:\n  • Cancelar todas subscriptions\n  • Revogar todos dispositivos\n  • Kill todas sessions\n  • Cliente vê paywall ao tentar usar\n\nReversível via Desbloquear.`)) return;
            try { await api(`/v1/admin/users/${id}/block`, { method: "POST", body: JSON.stringify({ reason }) }); toast("Usuário BLOQUEADO", "success"); openUserDrawer(id); refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="unblock"]', async () => {
            if (!confirm("Desbloquear este usuário?\n\nVai reativar subs/devices que foram revogados pelo admin.")) return;
            try { await api(`/v1/admin/users/${id}/unblock`, { method: "POST" }); toast("Usuário desbloqueado"); openUserDrawer(id); refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="delete-user"]', async () => {
            const email = u.email;
            const confirma1 = prompt(`⚠️ AÇÃO IRREVERSÍVEL\n\nIsso vai DELETAR PERMANENTEMENTE:\n  • Conta de ${email}\n  • Todos devices/sessions/subscriptions/audit\n  • Cancelar Stripe sub se ativa\n  • Liberar email pra novo signup\n\nDigite o email completo pra confirmar:`);
            if (confirma1 !== email) { toast("Email não bateu — abortado", "error"); return; }
            if (!confirm(`Última chance. DELETAR ${email}?`)) return;
            try { await api(`/v1/admin/users/${id}`, { method: "DELETE" }); toast(`${email} deletado`, "success"); document.getElementById("drawer").hidden = true; refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        document.querySelectorAll('[data-revoke-dev]').forEach(b => {
            b.addEventListener("click", async () => {
                const did = b.dataset.revokeDev;
                if (!confirm("Revogar este dispositivo?")) return;
                try { await api(`/v1/admin/devices/${did}/revoke`, { method: "POST" }); toast("Dispositivo revogado"); openUserDrawer(id); } catch (e) { toast(e.message, "error"); }
            });
        });
        document.querySelectorAll('[data-revoke-session]').forEach(b => {
            b.addEventListener("click", async () => {
                const sid = b.dataset.revokeSession;
                if (!confirm("Kill esta session?")) return;
                try { await api(`/v1/admin/sessions/${sid}/revoke`, { method: "POST", body: JSON.stringify({ reason: "admin_drawer" }) }); toast("Session killed"); openUserDrawer(id); } catch (e) { toast(e.message, "error"); }
            });
        });
    } catch (e) {
        document.getElementById("drawer-body").innerHTML = `<p class="error-msg">${e.message}</p>`;
    }
}
document.getElementById("drawer-close").addEventListener("click", () => { document.getElementById("drawer").hidden = true; });
document.querySelector(".drawer-overlay").addEventListener("click", () => { document.getElementById("drawer").hidden = true; });

// ===== INIT =====
checkAuth();
