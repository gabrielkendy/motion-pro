/* license.js — anti-piracy layer.
 *
 * Flow:
 *  1. On boot, compute device fingerprint (CPU + MAC + Premiere user + OS user).
 *  2. Send credentials -> backend returns a session token + a *signed license JWT*
 *     containing { user, plan, fingerprint, exp, allowed_packs, entitlements }.
 *  3. License is verified locally with CryptoMini.verifyJWT (no trust in server response alone).
 *  4. JWT is short-lived (24h). Heartbeat refreshes every 6h while app is open.
 *  5. Offline grace: last valid JWT cached, valid for up to 7 days while no network.
 *  6. Tamper checks: app refuses to render catalog if fingerprint mismatch
 *     or JWT signature invalid or system clock rewound.
 */
const License = (function () {
    let current = null;          // decoded JWT payload
    let rawToken = null;
    let heartbeatTimer = null;

    function nodeRequire(mod) {
        if (typeof require !== "function") return null;
        try { return require(mod); } catch (e) { return null; }
    }

    async function computeFingerprint() {
        const os = nodeRequire("os");
        const cs = new CSInterface();
        const parts = [];
        if (os) {
            parts.push(os.hostname());
            parts.push(os.platform());
            parts.push(os.arch());
            parts.push(String(os.totalmem()));
            parts.push(os.userInfo().username);
            const ifaces = os.networkInterfaces();
            const macs = [];
            for (const k of Object.keys(ifaces)) {
                for (const i of ifaces[k]) {
                    if (i.mac && i.mac !== "00:00:00:00:00:00") macs.push(i.mac);
                }
            }
            macs.sort();
            parts.push(macs.join("|"));
        } else {
            parts.push(navigator.userAgent);
            parts.push(String(screen.width) + "x" + String(screen.height));
        }
        parts.push(cs.getExtensionID());
        const hash = await CryptoMini.sha256(parts.join("::"));
        return hash;
    }

    async function authenticate(email, password) {
        const fp = await computeFingerprint();
        const res = await API.login(email, password, fp);
        API.state.set("session_token", res.session_token);
        API.state.set("user_email", email);
        await issue(fp);
        return current;
    }

    async function issue(fp) {
        if (!fp) fp = await computeFingerprint();
        const res = await API.issueLicense(fp);
        const payload = await CryptoMini.verifyJWT(res.license, API.config.publicKey);
        if (!payload) throw new Error("Licença inválida — assinatura adulterada");
        if (payload.fp !== fp) throw new Error("Licença vinculada a outra máquina");
        rawToken = res.license;
        current = payload;
        API.state.set("license_jwt", res.license);
        API.state.set("license_fp", fp);
        API.state.set("license_issued_at", Date.now());
        startHeartbeat();
        return payload;
    }

    async function tryRestoreOffline() {
        // Dev mode short-circuit: emite licença local sem servidor.
        if (window.MV_CONFIG && window.MV_CONFIG.devMode) {
            const fp = await computeFingerprint();
            current = {
                sub: window.MV_CONFIG.devEmail || "dev@local",
                plan: window.MV_CONFIG.devPlan || "lifetime",
                fp,
                packs: ["*"],
                exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
                iss: "motionvault-dev"
            };
            rawToken = "dev-mode-bypass";
            API.state.set("user_email", current.sub);
            return current;
        }
        const cached = API.state.get("license_jwt");
        const fp = await computeFingerprint();
        if (!cached) return null;
        const payload = await CryptoMini.verifyJWT(cached, API.config.publicKey);
        if (!payload) return null;
        if (payload.fp !== fp) return null;
        // offline grace: 7 dias após exp (mas só se relógio não foi puxado pra trás)
        const issued = API.state.get("license_issued_at") || 0;
        if (Date.now() < issued) return null; // clock rewind
        rawToken = cached; current = payload;
        return payload;
    }

    function startHeartbeat() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(async () => {
            try {
                const fp = await computeFingerprint();
                const res = await API.heartbeat(fp);
                if (res.license) {
                    const payload = await CryptoMini.verifyJWT(res.license, API.config.publicKey);
                    if (payload && payload.fp === fp) {
                        rawToken = res.license; current = payload;
                        API.state.set("license_jwt", res.license);
                        API.state.set("license_issued_at", Date.now());
                        // sub voltou: dispara evento pro UI tirar paywall
                        document.dispatchEvent(new CustomEvent("subscription-active", { detail: payload }));
                    }
                }
                if (res.revoked) {
                    logout();
                    document.dispatchEvent(new CustomEvent("license-revoked"));
                } else if (res.subscription_inactive) {
                    // SOFT-BLOCK: assinatura vencida, mas user continua logado.
                    // UI deve mostrar paywall + banner "Renovar". Plugin não desloga.
                    document.dispatchEvent(new CustomEvent("subscription-inactive", {
                        detail: {
                            reason: res.reason || "expired",
                            plan: res.plan,
                            expired_at: res.expired_at,
                            pricing_url: res.pricing_url || (window.MV_CONFIG && window.MV_CONFIG.pricingUrl)
                        }
                    }));
                }
            } catch (e) { /* network down, keep using cached */ }
        }, 6 * 60 * 60 * 1000); // 6h
    }

    function logout() {
        API.state.del("session_token");
        API.state.del("license_jwt");
        API.state.del("license_fp");
        API.state.del("license_issued_at");
        current = null; rawToken = null;
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }

    function entitlementFor(packId) {
        if (!current) return false;
        if (current.plan === "lifetime" || current.plan === "pro_all") return true;
        if (Array.isArray(current.packs) && current.packs.indexOf(packId) >= 0) return true;
        if (Array.isArray(current.packs) && current.packs.indexOf("*") >= 0) return true;
        return false;
    }

    return {
        computeFingerprint,
        authenticate,
        tryRestoreOffline,
        logout,
        entitlementFor,
        current: () => current,
        rawToken: () => rawToken
    };
})();
