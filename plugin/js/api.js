/* api.js — HTTP client for MotionVault SaaS backend. */
const API = (function () {
    const CONFIG = {
        baseUrl: (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl) || "https://api.motionvault.app",
        publicKey: (window.MV_CONFIG && window.MV_CONFIG.licensePublicKey) || "MV_PUB_KEY_PLACEHOLDER",
        timeoutMs: 12000
    };

    async function request(path, opts = {}) {
        const url = CONFIG.baseUrl + path;
        const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
        const token = State.get("session_token");
        if (token) headers["Authorization"] = "Bearer " + token;

        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
        try {
            const res = await fetch(url, {
                method: opts.method || "GET",
                headers,
                body: opts.body ? JSON.stringify(opts.body) : undefined,
                signal: ctrl.signal
            });
            const ct = res.headers.get("content-type") || "";
            const data = ct.includes("json") ? await res.json() : await res.text();
            if (!res.ok) throw { status: res.status, data };
            return data;
        } finally { clearTimeout(t); }
    }

    // --- Simple local state (persisted in localStorage) ---
    const State = {
        get(k) { try { return JSON.parse(localStorage.getItem("mv_" + k)); } catch (e) { return null; } },
        set(k, v) { localStorage.setItem("mv_" + k, JSON.stringify(v)); },
        del(k) { localStorage.removeItem("mv_" + k); }
    };

    return {
        config: CONFIG,
        state: State,

        login(email, password, fingerprint) {
            return request("/v1/auth/login", {
                method: "POST",
                body: { email, password, fingerprint, app_version: "1.0.0" }
            });
        },
        signup(email, password) {
            return request("/v1/auth/signup", {
                method: "POST", body: { email, password }
            });
        },
        me() { return request("/v1/me"); },
        machines() { return request("/v1/me/machines"); },
        revokeMachine(id) { return request("/v1/me/machines/" + id, { method: "DELETE" }); },

        issueLicense(fingerprint) {
            return request("/v1/license/issue", {
                method: "POST", body: { fingerprint }
            });
        },
        heartbeat(fingerprint) {
            return request("/v1/license/heartbeat", {
                method: "POST", body: { fingerprint }
            });
        },

        catalog(version) {
            return request("/v1/catalog?v=" + (version || "latest"));
        },
        assetUrl(assetId, fingerprint) {
            return request("/v1/assets/sign", {
                method: "POST", body: { asset_id: assetId, fingerprint }
            });
        },
        billingPortal() { return request("/v1/billing/portal", { method: "POST" }); },
        checkoutUrl(plan) { return request("/v1/billing/checkout?plan=" + plan, { method: "POST" }); }
    };
})();
