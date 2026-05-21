"use strict";
/**
 * AI Settings — config por usuário do plugin Motion IA.
 *
 * Endpoints (todos com requireAuth):
 *   GET  /v1/me/ai-settings           → retorna config (key masked)
 *   PUT  /v1/me/ai-settings           → atualiza config
 *   POST /v1/me/ai-settings/validate  → testa key + motor + mcp; retorna status de cada
 *   POST /v1/me/ai-settings/reset     → apaga config (logout do plugin)
 *
 * Criptografia simples: se env PG_AI_KEY_SECRET existir, AES-256-GCM.
 * Senão, salva plaintext (não-ideal mas funcional pra MVP).
 */
const router = require("express").Router();
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const SECRET = process.env.PG_AI_KEY_SECRET || "";

function encrypt(plain) {
    if (!plain) return null;
    if (!SECRET) return "plain:" + plain;  // fallback plaintext-tagged
    const key = crypto.createHash("sha256").update(SECRET).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return "enc:" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}
function decrypt(blob) {
    if (!blob) return null;
    if (blob.startsWith("plain:")) return blob.slice(6);
    if (!blob.startsWith("enc:")) return null;
    if (!SECRET) return null;  // chave perdida
    const [, ivHex, tagHex, encHex] = blob.split(":");
    const key = crypto.createHash("sha256").update(SECRET).digest();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    try {
        const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
        return dec.toString("utf8");
    } catch (e) { return null; }
}
function maskKey(k) {
    if (!k || k.length < 12) return null;
    return k.slice(0, 7) + "…" + k.slice(-4);
}

// ============================================================
// GET — retorna config (key SEMPRE mascarada; cliente NÃO recebe key)
// ============================================================
router.get("/me/ai-settings", requireAuth, async (req, res, next) => {
    try {
        const r = await pool.query(
            `SELECT anthropic_key_enc, anthropic_key_set, model, max_tokens,
                    motor_url, motor_enabled, mcp_enabled, mcp_url,
                    skills_enabled, custom_system, updated_at
               FROM user_ai_settings WHERE user_id=$1`,
            [req.user.id]
        );
        if (r.rowCount === 0) {
            return res.json({
                configured: false,
                anthropic_key_mask: null,
                anthropic_key_set: false,
                model: "claude-sonnet-4-6",
                max_tokens: 4096,
                motor_url: null,
                motor_enabled: false,
                mcp_enabled: false,
                mcp_url: null,
                skills_enabled: {},
                custom_system: null,
            });
        }
        const row = r.rows[0];
        const key = decrypt(row.anthropic_key_enc);
        res.json({
            configured: true,
            anthropic_key_mask: maskKey(key),
            anthropic_key_set: !!row.anthropic_key_set,
            model: row.model,
            max_tokens: row.max_tokens,
            motor_url: row.motor_url,
            motor_enabled: row.motor_enabled,
            mcp_enabled: row.mcp_enabled,
            mcp_url: row.mcp_url,
            skills_enabled: row.skills_enabled || {},
            custom_system: row.custom_system,
            updated_at: row.updated_at,
        });
    } catch (e) { next(e); }
});

// ============================================================
// GET key (raw) — usado SÓ pelo plugin pra fazer chamadas Claude
// Endpoint separado e dedicado pra restringir acesso depois se quiser
// ============================================================
router.get("/me/ai-settings/key", requireAuth, async (req, res, next) => {
    try {
        const r = await pool.query(
            "SELECT anthropic_key_enc FROM user_ai_settings WHERE user_id=$1",
            [req.user.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: "not_configured" });
        const key = decrypt(r.rows[0].anthropic_key_enc);
        if (!key) return res.status(404).json({ error: "no_key" });
        res.json({ key });
    } catch (e) { next(e); }
});

// ============================================================
// PUT — atualiza config. Aceita atualizações parciais.
// ============================================================
router.put("/me/ai-settings", requireAuth, async (req, res, next) => {
    try {
        const body = req.body || {};
        const updates = {};
        if (typeof body.anthropic_key === "string" && body.anthropic_key) {
            updates.anthropic_key_enc = encrypt(body.anthropic_key.trim());
            updates.anthropic_key_set = true;
        }
        if (typeof body.model === "string") updates.model = body.model;
        if (typeof body.max_tokens === "number") updates.max_tokens = Math.max(256, Math.min(8192, body.max_tokens));
        if (typeof body.motor_url === "string" || body.motor_url === null) updates.motor_url = body.motor_url;
        if (typeof body.motor_enabled === "boolean") updates.motor_enabled = body.motor_enabled;
        if (typeof body.mcp_enabled === "boolean") updates.mcp_enabled = body.mcp_enabled;
        if (typeof body.mcp_url === "string" || body.mcp_url === null) updates.mcp_url = body.mcp_url;
        if (body.skills_enabled && typeof body.skills_enabled === "object") updates.skills_enabled = body.skills_enabled;
        if (typeof body.custom_system === "string" || body.custom_system === null) updates.custom_system = body.custom_system;

        if (Object.keys(updates).length === 0) return res.status(400).json({ error: "no_changes" });

        // Upsert
        const keys = Object.keys(updates);
        const vals = keys.map(k => updates[k]);
        const setSql = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");

        await pool.query(
            `INSERT INTO user_ai_settings(user_id, ${keys.join(", ")}, updated_at)
             VALUES($1, ${keys.map((_, i) => "$" + (i + 2)).join(", ")}, now())
             ON CONFLICT (user_id) DO UPDATE SET ${setSql}, updated_at=now()`,
            [req.user.id, ...vals]
        );

        // Audit (sem expor a key)
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'ai_settings_updated', $2)",
            [req.user.id, { fields: Object.keys(updates).filter(k => k !== "anthropic_key_enc") }]
        );

        res.json({ ok: true, updated_fields: Object.keys(updates) });
    } catch (e) { next(e); }
});

// ============================================================
// VALIDATE — testa key Anthropic + motor + mcp
// ============================================================
router.post("/me/ai-settings/validate", requireAuth, async (req, res, next) => {
    try {
        const body = req.body || {};
        // Aceita key direta (pra testar antes de salvar) OU usa a salva
        let key = body.anthropic_key;
        const model = body.model || "claude-sonnet-4-6";
        if (!key) {
            const r = await pool.query("SELECT anthropic_key_enc FROM user_ai_settings WHERE user_id=$1", [req.user.id]);
            if (r.rowCount) key = decrypt(r.rows[0].anthropic_key_enc);
        }

        const result = {
            anthropic: { ok: false, error: null, model: null },
            motor:     { ok: false, error: null, info: null, tested: false },
            mcp:       { ok: false, error: null, info: null, tested: false },
        };

        // 1. Anthropic
        if (!key) {
            result.anthropic.error = "no_key";
        } else if (!key.startsWith("sk-ant-")) {
            result.anthropic.error = "invalid_format (deve começar com sk-ant-)";
        } else {
            try {
                const r = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    body: JSON.stringify({
                        model, max_tokens: 16,
                        messages: [{ role: "user", content: "ping" }]
                    }),
                    signal: AbortSignal.timeout(8000)
                });
                if (r.ok) {
                    const data = await r.json();
                    result.anthropic = { ok: true, error: null, model: data.model, usage: data.usage };
                } else if (r.status === 401) result.anthropic.error = "key_rejected_401";
                else if (r.status === 403) result.anthropic.error = "model_not_allowed_403";
                else if (r.status === 429) result.anthropic.error = "rate_or_credit_429";
                else result.anthropic.error = "http_" + r.status;
            } catch (e) { result.anthropic.error = "network: " + e.message; }
        }

        // 2. Motor (opcional)
        if (body.motor_url) {
            result.motor.tested = true;
            try {
                const r = await fetch(body.motor_url + "/api/status", { signal: AbortSignal.timeout(3000) });
                if (r.ok) {
                    const d = await r.json().catch(() => ({}));
                    result.motor = { ok: true, error: null, info: d, tested: true };
                } else result.motor.error = "http_" + r.status;
            } catch (e) { result.motor.error = "offline_or_timeout"; }
        }

        // 3. MCP (opcional — tipicamente WebSocket; testa polling HTTP fallback)
        if (body.mcp_url) {
            result.mcp.tested = true;
            try {
                const r = await fetch(body.mcp_url + "/health", { signal: AbortSignal.timeout(3000) }).catch(() => null);
                if (r && r.ok) result.mcp = { ok: true, error: null, info: { reachable: true }, tested: true };
                else result.mcp.error = "no_health_endpoint";
            } catch (e) { result.mcp.error = "offline"; }
        }

        res.json(result);
    } catch (e) { next(e); }
});

// ============================================================
// RESET — apaga config IA do user
// ============================================================
router.post("/me/ai-settings/reset", requireAuth, async (req, res, next) => {
    try {
        await pool.query("DELETE FROM user_ai_settings WHERE user_id=$1", [req.user.id]);
        await pool.query(
            "INSERT INTO license_audit(user_id, action) VALUES($1, 'ai_settings_reset')",
            [req.user.id]
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
});

module.exports = { router };
