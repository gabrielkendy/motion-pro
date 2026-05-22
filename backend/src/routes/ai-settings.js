"use strict";
/**
 * AI Settings — config por usuário do plugin Motion IA.
 *
 * v4 (2026-05-21): migrado pra Gemini Flash · Anthropic removido.
 *   - A key Gemini do usuário fica CLIENT-SIDE (localStorage), porque o
 *     plugin chama o Gemini direto (BYOK). Backend não precisa armazenar/
 *     servir chave Gemini — só model, max_tokens e configurações secundárias.
 *   - Campos legacy `anthropic_key_enc` / `anthropic_key_set` no schema continuam
 *     existindo (não vamos quebrar a tabela), mas NÃO são lidos/escritos.
 *
 * Endpoints (todos com requireAuth):
 *   GET  /v1/me/ai-settings           → retorna config (model, max_tokens, motor, mcp)
 *   PUT  /v1/me/ai-settings           → atualiza config
 *   POST /v1/me/ai-settings/validate  → testa motor + mcp (Gemini validado client-side)
 *   POST /v1/me/ai-settings/reset     → apaga config
 *   GET  /v1/me/ai-settings/key       → 410 Gone (endpoint legacy Anthropic)
 */
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

// ============================================================
// GET — retorna config (sem campos Anthropic legacy)
// ============================================================
router.get("/me/ai-settings", requireAuth, async (req, res, next) => {
    try {
        const r = await pool.query(
            `SELECT model, max_tokens, motor_url, motor_enabled,
                    mcp_enabled, mcp_url, skills_enabled, custom_system, updated_at
               FROM user_ai_settings WHERE user_id=$1`,
            [req.user.id]
        );
        if (r.rowCount === 0) {
            return res.json({
                configured: false,
                model: "gemini-2.0-flash",
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
        // Normaliza model legacy (Claude → Gemini) pra UI não ficar quebrada
        let model = row.model || "gemini-2.0-flash";
        if (!/^gemini/i.test(model)) model = "gemini-2.0-flash";
        res.json({
            configured: true,
            model,
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
// GET key (legacy Anthropic) — 410 Gone na v4
// ============================================================
router.get("/me/ai-settings/key", requireAuth, async (_req, res) => {
    res.status(410).json({
        error: "endpoint_removed_v4",
        detail: "Motion IA migrou pra Google Gemini Flash. A key Gemini fica no plugin (localStorage). Configure em Licença & Config."
    });
});

// ============================================================
// PUT — atualiza config. Aceita atualizações parciais.
// ============================================================
router.put("/me/ai-settings", requireAuth, async (req, res, next) => {
    try {
        const body = req.body || {};
        const updates = {};

        // v4: rejeita silenciosamente anthropic_key (legacy) — não armazena
        // mas também não dá 400 pra não quebrar plugins antigos que ainda mandam.
        // Logamos pra eventualmente alertar.
        if (body.anthropic_key) {
            console.warn("[ai-settings] PUT recebeu anthropic_key (legacy) do user", req.user.id, "— ignorando");
        }

        if (typeof body.model === "string") {
            // Aceita modelos Gemini. Modelos Claude legacy são auto-substituídos.
            let m = body.model;
            if (!/^gemini/i.test(m)) m = "gemini-2.0-flash";
            updates.model = m;
        }
        if (typeof body.max_tokens === "number") {
            updates.max_tokens = Math.max(256, Math.min(8192, body.max_tokens));
        }
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

        // Audit
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'ai_settings_updated', $2)",
            [req.user.id, { fields: Object.keys(updates) }]
        );

        res.json({ ok: true, updated_fields: Object.keys(updates) });
    } catch (e) { next(e); }
});

// ============================================================
// VALIDATE — testa motor + mcp (Gemini é validado client-side via GeminiClient)
// ============================================================
router.post("/me/ai-settings/validate", requireAuth, async (req, res, next) => {
    try {
        const body = req.body || {};

        const result = {
            // gemini não é mais validado server-side (key fica no client)
            gemini: { ok: null, note: "Gemini key fica no plugin (localStorage). Valide no botão Testar conexões do plugin." },
            motor:  { ok: false, error: null, info: null, tested: false },
            mcp:    { ok: false, error: null, info: null, tested: false },
        };

        // 1. Motor (opcional)
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

        // 2. MCP (opcional)
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
