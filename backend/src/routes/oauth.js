"use strict";
/**
 * OAuth + Magic Link routes.
 *
 * Providers suportados: google, github
 * Plus: magic link (passwordless via email)
 *
 * Flow OAuth (server-side, sem SDK frontend):
 *   1. GET /v1/oauth/:provider/start  → redirect pro provider com state
 *   2. provider → GET /v1/oauth/:provider/callback?code=...&state=...
 *   3. backend troca code por access_token, busca user info, cria/atualiza user
 *   4. emite JWT da casa (mesmo do login normal) e redireciona pra
 *      ${OAUTH_SUCCESS_URL}#token=<jwt>  (dashboard pega via hash)
 *
 * Magic Link:
 *   1. POST /v1/auth/magic-link { email } → email com link
 *   2. GET /v1/auth/magic-consume?token=... → emite JWT
 *
 * Env vars necessárias (aceita 2 prefixos pra compat — basta UM par
 * estar setado por provider):
 *   OAUTH_GOOGLE_CLIENT_ID  OU  GOOGLE_CLIENT_ID
 *   OAUTH_GOOGLE_CLIENT_SECRET OU GOOGLE_CLIENT_SECRET
 *   OAUTH_GITHUB_CLIENT_ID  OU  GITHUB_CLIENT_ID
 *   OAUTH_GITHUB_CLIENT_SECRET OU GITHUB_CLIENT_SECRET
 *   OAUTH_REDIRECT_BASE  (ex: https://motionpro.vercel.app)
 *   OAUTH_SUCCESS_URL    (ex: https://dashboard.motionpro.vercel.app)
 *   MV_JWT_SECRET
 */
const router  = require("express").Router();
const crypto  = require("crypto");
const jwt     = require("jsonwebtoken");
const { pool } = require("../db");
const { sendEmail, magicLinkEmail } = require("../utils/email");
const { clientIp, clientUa } = require("../utils/ipgeo");
// A7: tabela canônica de produtos + aliases — fonte única
const { normalizePlugin } = require("../utils/product-aliases");

const STATE_TTL_MS = 10 * 60 * 1000;             // 10min
const MAGIC_TTL_MIN = 15;

// State store em DB (tabela oauth_states, migration 013) — serverless-safe.
// Antes era Map<string, …> in-memory; em Vercel/Lambda zerava entre
// /start e /callback nas cold starts, causando "invalid_state" intermitente.
async function saveState(state, payload) {
    const expiresAt = new Date(Date.now() + STATE_TTL_MS);
    await pool.query(
        `INSERT INTO oauth_states(state, provider, return_to, plugin, expires_at)
              VALUES ($1, $2, $3, $4, $5)`,
        [state, payload.provider, payload.return_to, payload.plugin || null, expiresAt]
    );
}

// Consome state (single-use). Retorna o payload se válido + não consumido +
// não expirado; senão retorna null. Usa UPDATE … RETURNING pra ser atômico
// contra race condition de double-callback do provider.
async function consumeState(state, expectedProvider) {
    const r = await pool.query(
        `UPDATE oauth_states
            SET consumed_at = now()
          WHERE state = $1
            AND provider = $2
            AND consumed_at IS NULL
            AND expires_at > now()
       RETURNING provider, return_to, plugin`,
        [state, expectedProvider]
    );
    return r.rows[0] || null;
}

// GC oportunista — roda no /start, limpa registros velhos. Best-effort.
async function gcStates() {
    try {
        await pool.query(
            "DELETE FROM oauth_states WHERE expires_at < now() - interval '1 hour'"
        );
    } catch (_) { /* best-effort, não bloqueia OAuth */ }
}

function issueJwt(user) {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;   // 30d
    return jwt.sign({ sub: user.id, email: user.email }, process.env.MV_JWT_SECRET, {
        algorithm: "HS256",
        expiresIn: "30d",
    });
}

// Helper: aceita 2 conventions de naming (OAUTH_X_Y ou X_Y)
function envEither(...names) {
    for (const n of names) {
        const v = process.env[n];
        if (v && v.trim()) return v.trim();
    }
    return null;
}

const PROVIDERS = {
    google: {
        authorize:  "https://accounts.google.com/o/oauth2/v2/auth",
        token:      "https://oauth2.googleapis.com/token",
        userinfo:   "https://www.googleapis.com/oauth2/v2/userinfo",
        scope:      "openid email profile",
        client_id:  () => envEither("OAUTH_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"),
        client_secret: () => envEither("OAUTH_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
        normalize: (u) => ({
            provider_uid: u.id,
            email: u.email,
            name: u.name,
            avatar_url: u.picture,
        }),
    },
    github: {
        authorize:  "https://github.com/login/oauth/authorize",
        token:      "https://github.com/login/oauth/access_token",
        userinfo:   "https://api.github.com/user",
        userinfoEmails: "https://api.github.com/user/emails",
        scope:      "read:user user:email",
        client_id:  () => envEither("OAUTH_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID"),
        client_secret: () => envEither("OAUTH_GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"),
        normalize: (u, emails) => ({
            provider_uid: String(u.id),
            email: u.email || (emails || []).find(e => e.primary && e.verified)?.email || null,
            name:  u.name || u.login,
            avatar_url: u.avatar_url,
        }),
    },
};

// ───────────────────── status (público, sem secrets) ─────────────────────
// Útil pra debugar 503 sem mexer no Vercel dashboard. Retorna quais providers
// têm client_id + client_secret presentes. Não vaza valores.
router.get("/status", (_req, res) => {
    const status = {};
    for (const [name, p] of Object.entries(PROVIDERS)) {
        status[name] = {
            configured: !!(p.client_id() && p.client_secret()),
            has_client_id: !!p.client_id(),
            has_client_secret: !!p.client_secret()
        };
    }
    res.json({
        providers: status,
        redirect_base: process.env.OAUTH_REDIRECT_BASE || null,
        success_url: process.env.OAUTH_SUCCESS_URL || null
    });
});

// ───────────────────── /start ─────────────────────
router.get("/:provider/start", async (req, res, next) => {
    try {
        const p = PROVIDERS[req.params.provider];
        if (!p) return res.status(404).json({ error: "unknown_provider" });
        if (!p.client_id() || !p.client_secret()) {
            return res.status(503).json({
                error: "oauth_not_configured",
                provider: req.params.provider,
                hint: "Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (ou OAUTH_GOOGLE_CLIENT_ID/SECRET) no Vercel"
            });
        }

        gcStates();   // best-effort, não awaita
        const plugin = normalizePlugin(req.query.plugin);
        const state = crypto.randomBytes(24).toString("base64url");
        await saveState(state, {
            provider: req.params.provider,
            return_to: req.query.return_to || process.env.OAUTH_SUCCESS_URL || "/",
            plugin: plugin || null,
        });

        const url = new URL(p.authorize);
        url.searchParams.set("client_id", p.client_id());
        url.searchParams.set("redirect_uri", `${process.env.OAUTH_REDIRECT_BASE}/v1/oauth/${req.params.provider}/callback`);
        url.searchParams.set("scope", p.scope);
        url.searchParams.set("state", state);
        url.searchParams.set("response_type", "code");
        if (req.params.provider === "google") url.searchParams.set("access_type", "offline");

        res.redirect(url.toString());
    } catch (e) { next(e); }
});

// ───────────────────── /callback ─────────────────────
router.get("/:provider/callback", async (req, res, next) => {
    try {
        const p = PROVIDERS[req.params.provider];
        if (!p) return res.status(404).send("unknown_provider");
        const { code, state } = req.query;
        if (!code || !state) return res.status(400).send("missing code/state");
        const saved = await consumeState(String(state), req.params.provider);
        if (!saved) return res.status(400).send("invalid_state");

        // 1) trade code → access_token
        const tokenResp = await fetch(p.token, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
            body: new URLSearchParams({
                client_id: p.client_id(),
                client_secret: p.client_secret(),
                code: String(code),
                redirect_uri: `${process.env.OAUTH_REDIRECT_BASE}/v1/oauth/${req.params.provider}/callback`,
                grant_type: "authorization_code",
            }),
        });
        if (!tokenResp.ok) {
            const t = await tokenResp.text();
            console.error("[oauth] token exchange failed", req.params.provider, t);
            return res.status(502).send("oauth_token_exchange_failed");
        }
        const tok = await tokenResp.json();
        const accessToken = tok.access_token;
        if (!accessToken) return res.status(502).send("no_access_token");

        // 2) userinfo
        const ui = await fetch(p.userinfo, {
            headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json", "User-Agent": "MotionPro-OAuth" },
        });
        if (!ui.ok) return res.status(502).send("userinfo_failed");
        const profile = await ui.json();

        let emails = null;
        if (p.userinfoEmails) {
            try {
                const e = await fetch(p.userinfoEmails, {
                    headers: { "Authorization": `Bearer ${accessToken}`, "User-Agent": "MotionPro-OAuth" },
                });
                if (e.ok) emails = await e.json();
            } catch {}
        }

        const norm = p.normalize(profile, emails);
        if (!norm.email) return res.status(422).send("provider_no_email");

        // 3) link account → user
        let userId;
        const existing = await pool.query(
            "SELECT user_id FROM oauth_accounts WHERE provider=$1 AND provider_uid=$2",
            [req.params.provider, norm.provider_uid]
        );
        if (existing.rowCount > 0) {
            userId = existing.rows[0].user_id;
            await pool.query("UPDATE oauth_accounts SET last_used_at=now() WHERE user_id=$1 AND provider=$2", [userId, req.params.provider]);
        } else {
            // Existing user by email → link. Senão cria
            const u = await pool.query("SELECT id FROM users WHERE email=$1", [norm.email]);
            if (u.rowCount > 0) {
                userId = u.rows[0].id;
            } else {
                const ins = await pool.query(
                    "INSERT INTO users(email, name, email_verified_at) VALUES($1,$2,now()) RETURNING id",
                    [norm.email, norm.name || norm.email.split("@")[0]]
                );
                userId = ins.rows[0].id;
            }
            await pool.query(
                "INSERT INTO oauth_accounts(user_id, provider, provider_uid, email, name, avatar_url) VALUES($1,$2,$3,$4,$5,$6)",
                [userId, req.params.provider, norm.provider_uid, norm.email, norm.name, norm.avatar_url]
            );
        }

        const userRow = (await pool.query("SELECT id, email FROM users WHERE id=$1", [userId])).rows[0];
        const token = issueJwt(userRow);

        // Anexa plugin no fragment pra que a bridge mostre UI específica
        // (logo + texto + "voltar pro plugin X")
        const pluginFrag = saved.plugin ? `&plugin=${encodeURIComponent(saved.plugin)}` : "";
        const dest = saved.return_to + (saved.return_to.includes("#") ? "&" : "#") + "token=" + token + pluginFrag;
        res.redirect(dest);
    } catch (e) { next(e); }
});

// ───────────────────── magic link ─────────────────────
router.post("/magic/start", async (req, res, next) => {
    try {
        const email = String(req.body?.email || "").toLowerCase().trim();
        if (!email || !email.includes("@")) return res.status(400).json({ error: "invalid_email" });
        const plugin = normalizePlugin(req.body?.plugin || req.query?.plugin);

        const raw = crypto.randomBytes(32).toString("base64url");
        const hash = crypto.createHash("sha256").update(raw).digest("hex");
        const exp = new Date(Date.now() + MAGIC_TTL_MIN * 60 * 1000);

        await pool.query(
            "INSERT INTO magic_links(email, token_hash, expires_at, request_ip, request_ua) VALUES($1,$2,$3,$4,$5)",
            [email, hash, exp, clientIp(req), clientUa(req)]
        );

        const base = process.env.OAUTH_REDIRECT_BASE || "https://motionpro.vercel.app";
        const pluginQ = plugin ? `&plugin=${encodeURIComponent(plugin)}` : "";
        const magicUrl = `${base}/v1/oauth/magic/consume?token=${raw}${pluginQ}`;
        await magicLinkEmail({ email, magicUrl, ip: clientIp(req), expires_in_min: MAGIC_TTL_MIN }).catch(() => {});

        res.json({ ok: true, expires_in: MAGIC_TTL_MIN * 60 });
    } catch (e) { next(e); }
});

router.get("/magic/consume", async (req, res, next) => {
    try {
        const raw = String(req.query.token || "");
        if (!raw) return res.status(400).send("missing_token");
        const plugin = normalizePlugin(req.query.plugin);
        const hash = crypto.createHash("sha256").update(raw).digest("hex");

        const row = await pool.query(
            "SELECT id, email FROM magic_links WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at > now()",
            [hash]
        );
        if (row.rowCount === 0) return res.status(400).send("invalid_or_expired");

        await pool.query("UPDATE magic_links SET consumed_at=now() WHERE id=$1", [row.rows[0].id]);

        // get/create user
        const email = row.rows[0].email;
        let u = await pool.query("SELECT id, email FROM users WHERE email=$1", [email]);
        if (u.rowCount === 0) {
            u = await pool.query(
                "INSERT INTO users(email, name, email_verified_at) VALUES($1,$2,now()) RETURNING id, email",
                [email, email.split("@")[0]]
            );
        }
        const token = issueJwt(u.rows[0]);
        const pluginFrag = plugin ? `&plugin=${encodeURIComponent(plugin)}` : "";
        const dest = (process.env.OAUTH_SUCCESS_URL || "/") + "#token=" + token + pluginFrag;
        res.redirect(dest);
    } catch (e) { next(e); }
});

// ───────────────────── unlink ─────────────────────
router.delete("/account/:provider", require("../middleware/auth").requireAuth, async (req, res, next) => {
    try {
        await pool.query(
            "DELETE FROM oauth_accounts WHERE user_id=$1 AND provider=$2",
            [req.user.id, req.params.provider]
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
});

module.exports = router;
