// MotionPro Admin Dashboard
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
        if (v === "users") refreshUsers();
        if (v === "subscriptions") refreshSubs();
        if (v === "devices") refreshDevices();
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
        return `<tr data-id="${u.id}">
            <td class="email-cell">${nameDisplay}${u.email}${emailVerifyIcon}${u.is_admin ? ' <span class="badge badge--purple" style="margin-left:6px">ADMIN</span>' : ''}<span class="id">${u.id.slice(0,8)}…</span>${phoneDisplay}</td>
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

// ===== SUBSCRIPTIONS =====
async function refreshSubs() {
    try {
        const r = await api("/v1/admin/users?status=active&limit=500");
        const rows = [];
        r.users.forEach(u => {
            (u.subscriptions || []).filter(s => ["active", "trialing"].includes(s.status)).forEach(s => {
                rows.push(`<tr>
                    <td class="email-cell">${u.email}</td>
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
async function refreshDevices() {
    try {
        const r = await api("/v1/admin/users?limit=500");
        const rows = [];
        r.users.forEach(u => {
            (u.subscriptions || []);
        });
        // Fetch full details — backend lista devices via users; vamos chamar detail de cada
        // Pra performance, pega só de usuarios com devices
        const candidates = r.users.filter(u => u.total_devices > 0);
        const detailRows = [];
        for (const u of candidates) {
            const d = await api("/v1/admin/users/" + u.id);
            d.devices.forEach(dev => {
                detailRows.push(`<tr>
                    <td class="email-cell">${u.email}</td>
                    <td><code>${dev.fingerprint.slice(0,16)}…</code></td>
                    <td>${dev.label || '—'}</td>
                    <td class="date-cell">${fmtDateTime(dev.first_seen)}</td>
                    <td class="date-cell">${fmtDateTime(dev.last_seen)}</td>
                    <td>${dev.revoked ? '<span class="badge badge--red">Revogado</span>' : '<span class="badge badge--green">Ativo</span>'}</td>
                    <td>${!dev.revoked ? `<button class="btn btn--danger btn--sm" data-revoke-device="${dev.id}">Revogar</button>` : ''}</td>
                </tr>`);
            });
        }
        document.getElementById("devices-tbody").innerHTML = detailRows.join("") || `<tr><td colspan="7" class="empty">Nenhum dispositivo registrado</td></tr>`;
        document.querySelectorAll("button[data-revoke-device]").forEach(b => {
            b.addEventListener("click", async (e) => {
                const id = e.target.dataset.revokeDevice;
                if (!confirm("Revogar este dispositivo? O cliente vai precisar reativar.")) return;
                try {
                    await api(`/v1/admin/devices/${id}/revoke`, { method: "POST" });
                    toast("Dispositivo revogado");
                    refreshDevices();
                } catch (e) { toast("Erro: " + e.message, "error"); }
            });
        });
    } catch (e) { toast("Erro: " + e.message, "error"); }
}

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
                <button class="btn btn--primary btn--sm" data-act="grant-yearly">+ Anual cortesia</button>
                <button class="btn btn--primary btn--sm" data-act="grant-lifetime">+ Vitalício cortesia</button>
                <button class="btn btn--danger btn--sm" data-act="revoke">🚫 Revogar acesso</button>
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
                        ${planBadge(s.plan)} ${statusBadge(s.status)}
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
                <h4>Auditoria (${d.audit.length} últimos)</h4>
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
            if (!confirm("Dar 1 ANO de cortesia?")) return;
            try { await api(`/v1/admin/users/${id}/grant`, { method: "POST", body: JSON.stringify({ plan: "yearly", reason: "courtesy" }) }); toast("Acesso anual concedido"); openUserDrawer(id); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="grant-lifetime"]', async () => {
            if (!confirm("Dar VITALÍCIO de cortesia?")) return;
            try { await api(`/v1/admin/users/${id}/grant`, { method: "POST", body: JSON.stringify({ plan: "lifetime", reason: "courtesy" }) }); toast("Vitalício concedido"); openUserDrawer(id); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="revoke"]', async () => {
            if (!confirm("⚠️ REVOGAR todo o acesso deste usuário? Vai desativar a licença e todos dispositivos.")) return;
            try { await api(`/v1/admin/users/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason: "admin_panel" }) }); toast("Acesso revogado"); openUserDrawer(id); refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        wire('[data-act="promote"]', async () => {
            if (!confirm("Promover esta conta a ADMIN?")) return;
            try { await api(`/v1/admin/users/${id}/promote`, { method: "POST" }); toast("Promovido a admin"); openUserDrawer(id); refreshUsers(); } catch (e) { toast(e.message, "error"); }
        });
        document.querySelectorAll('[data-revoke-dev]').forEach(b => {
            b.addEventListener("click", async () => {
                const did = b.dataset.revokeDev;
                if (!confirm("Revogar este dispositivo?")) return;
                try { await api(`/v1/admin/devices/${did}/revoke`, { method: "POST" }); toast("Dispositivo revogado"); openUserDrawer(id); } catch (e) { toast(e.message, "error"); }
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
