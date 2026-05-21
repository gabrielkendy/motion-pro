"use strict";
/**
 * License Keys — sistema "estilo Phantom" pra Motion IA.
 *
 * Endpoints PÚBLICOS:
 *   POST /v1/license-keys/activate     — ativa key + device
 *   GET  /v1/license-keys/status?key=  — status duma key
 *   POST /v1/license-keys/deactivate   — desativa key num device
 *   POST /v1/license-keys/validate     — re-valida (chamado periodicamente)
 *
 * Endpoints ADMIN:
 *   POST /v1/admin/license-keys/generate     — gera key(s) avulsa(s)
 *   POST /v1/admin/license-keys/generate-bulk — gera N keys de uma vez (Gumroad CSV)
 *   GET  /v1/admin/license-keys              — lista todas
 *   POST /v1/admin/license-keys/:id/revoke   — bane key
 */
const router = require("express").Router();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { clientIp } = require("../utils/ipgeo");

// ============================================================
// KEY GENERATION (admin)
// ============================================================
function genKey(tier) {
    // Formato: MIA-{TIER}-XXXX-XXXX-XXXX-XXXX (4 grupos de 4 hex)
    const t = (tier || "PRO").toUpperCase().slice(0, 4);
    const rand = () => crypto.randomBytes(2).toString("hex").toUpperCase();
    return `MIA-${t}-${rand()}-${rand()}-${rand()}-${rand()}`;
}

async function saveKey({ key, tier, products, maxDevices, expiresAt, notes, customerEmail, issuedBy }) {
    const hash = await bcrypt.hash(key, 10);
    const prefix = key.slice(0, 14); // "MIA-PRO-XXXX-X"
    const r = await pool.query(
        `INSERT INTO license_keys
         (key_hash, key_prefix, tier, products, max_devices, expires_at, notes, customer_email, issued_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, key_prefix, tier, products, max_devices, expires_at, created_at`,
        [hash, prefix, tier, products || [], maxDevices || 3, expiresAt || null, notes || null, customerEmail || null, issuedBy || null]
    );
    return r.rows[0];
}

// Localiza key no banco. Como armazenamos só hash, brute force seria caro;
// usamos key_prefix pra estreitar busca → bcrypt.compare nos candidatos.
async function findKeyByPlaintext(plaintext) {
    if (!plaintext || !plaintext.startsWith("MIA-")) return null;
    const prefix = plaintext.slice(0, 14);
    const candidates = await pool.query(
        "SELECT * FROM license_keys WHERE key_prefix=$1 AND revoked_at IS NULL",
        [prefix]
    );
    for (const row of candidates.rows) {
        if (await bcrypt.compare(plaintext, row.key_hash)) return row;
    }
    return null;
}

// ============================================================
// PUBLIC: ACTIVATE
// ============================================================
router.post("/license-keys/activate", async (req, res, next) => {
    try {
        const { key, device_fingerprint, device_name, device_os } = req.body || {};
        if (!key || !device_fingerprint) {
            return res.status(400).json({ error: "key_and_fingerprint_required" });
        }

        const row = await findKeyByPlaintext(key.trim());
        if (!row)        return res.status(404).json({ error: "invalid_key" });
        if (row.revoked_at) return res.status(403).json({ error: "key_revoked", reason: row.revoke_reason });
        if (row.expires_at && new Date(row.expires_at) < new Date()) {
            return res.status(403).json({ error: "key_expired", expired_at: row.expires_at });
        }

        // Conta devices ativos
        const dev = await pool.query(
            "SELECT id, deactivated_at FROM license_key_activations WHERE license_key_id=$1 AND device_fingerprint=$2",
            [row.id, device_fingerprint]
        );

        let activation;
        if (dev.rowCount > 0) {
            // Já existe — reativa
            const id = dev.rows[0].id;
            await pool.query(
                "UPDATE license_key_activations SET deactivated_at=NULL, last_validation_at=now(), ip_address=$2 WHERE id=$1",
                [id, clientIp(req)]
            );
            activation = { id, reactivated: true };
        } else {
            // Novo device — verifica cap
            const active = await pool.query(
                "SELECT COUNT(*)::int AS n FROM license_key_activations WHERE license_key_id=$1 AND deactivated_at IS NULL",
                [row.id]
            );
            if (active.rows[0].n >= row.max_devices) {
                return res.status(403).json({
                    error: "device_limit_reached",
                    max_devices: row.max_devices,
                    active_devices: active.rows[0].n
                });
            }
            const ins = await pool.query(
                `INSERT INTO license_key_activations(license_key_id, device_fingerprint, device_name, device_os, ip_address)
                 VALUES($1,$2,$3,$4,$5) RETURNING id`,
                [row.id, device_fingerprint, device_name || null, device_os || null, clientIp(req)]
            );
            activation = { id: ins.rows[0].id, reactivated: false };
        }

        // Conta total atualizado
        const ac = await pool.query(
            "SELECT COUNT(*)::int AS n FROM license_key_activations WHERE license_key_id=$1 AND deactivated_at IS NULL",
            [row.id]
        );

        res.json({
            ok: true,
            license: {
                tier: row.tier,
                products: row.products,
                max_devices: row.max_devices,
                active_devices: ac.rows[0].n,
                expires_at: row.expires_at,
                masked_key: row.key_prefix + "…" + key.trim().slice(-4)
            },
            activation
        });
    } catch (e) { next(e); }
});

// ============================================================
// PUBLIC: STATUS (re-validate)
// ============================================================
router.post("/license-keys/validate", async (req, res, next) => {
    try {
        const { key, device_fingerprint } = req.body || {};
        if (!key || !device_fingerprint) return res.status(400).json({ error: "missing_params" });

        const row = await findKeyByPlaintext(key.trim());
        if (!row) return res.status(404).json({ active: false, error: "invalid_key" });
        if (row.revoked_at) return res.json({ active: false, error: "revoked" });
        if (row.expires_at && new Date(row.expires_at) < new Date()) {
            return res.json({ active: false, error: "expired" });
        }

        const dev = await pool.query(
            "SELECT id, deactivated_at FROM license_key_activations WHERE license_key_id=$1 AND device_fingerprint=$2",
            [row.id, device_fingerprint]
        );
        if (dev.rowCount === 0) return res.json({ active: false, error: "device_not_activated" });
        if (dev.rows[0].deactivated_at) return res.json({ active: false, error: "device_deactivated" });

        // Atualiza last_validation
        await pool.query(
            "UPDATE license_key_activations SET last_validation_at=now() WHERE id=$1",
            [dev.rows[0].id]
        );

        res.json({
            active: true,
            tier: row.tier,
            products: row.products,
            max_devices: row.max_devices,
            expires_at: row.expires_at,
            last_validation_at: new Date().toISOString(),
            masked_key: row.key_prefix + "…" + key.trim().slice(-4)
        });
    } catch (e) { next(e); }
});

// ============================================================
// PUBLIC: DEACTIVATE
// ============================================================
router.post("/license-keys/deactivate", async (req, res, next) => {
    try {
        const { key, device_fingerprint } = req.body || {};
        if (!key || !device_fingerprint) return res.status(400).json({ error: "missing_params" });
        const row = await findKeyByPlaintext(key.trim());
        if (!row) return res.status(404).json({ error: "invalid_key" });
        await pool.query(
            "UPDATE license_key_activations SET deactivated_at=now() WHERE license_key_id=$1 AND device_fingerprint=$2 AND deactivated_at IS NULL",
            [row.id, device_fingerprint]
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
});

// ============================================================
// ADMIN: GENERATE
// ============================================================
router.post("/admin/license-keys/generate", requireAdmin, async (req, res, next) => {
    try {
        const { tier, products, max_devices, expires_at, notes, customer_email } = req.body || {};
        if (!tier) return res.status(400).json({ error: "tier_required" });

        const plaintext = genKey(tier);
        const saved = await saveKey({
            key: plaintext, tier,
            products: products || ["motionpro", "ia", "legendas"],
            maxDevices: max_devices || 3,
            expiresAt: expires_at,
            notes,
            customerEmail: customer_email,
            issuedBy: req.user.id
        });

        // IMPORTANTE: única chance de ver a key em plaintext. Backend só guarda hash.
        res.json({
            ok: true,
            key: plaintext,
            details: saved,
            warning: "Esta é a ÚNICA vez que a key aparece em plaintext. Guarde agora."
        });
    } catch (e) { next(e); }
});

router.post("/admin/license-keys/generate-bulk", requireAdmin, async (req, res, next) => {
    try {
        const { count, tier, products, max_devices, expires_at, notes } = req.body || {};
        const n = Math.min(Math.max(Number(count) || 1, 1), 100);
        if (!tier) return res.status(400).json({ error: "tier_required" });

        const keys = [];
        for (let i = 0; i < n; i++) {
            const plaintext = genKey(tier);
            await saveKey({
                key: plaintext, tier,
                products: products || ["motionpro", "ia", "legendas"],
                maxDevices: max_devices || 3,
                expiresAt: expires_at,
                notes: (notes || "") + " (batch " + (i + 1) + "/" + n + ")",
                issuedBy: req.user.id
            });
            keys.push(plaintext);
        }
        res.json({ ok: true, count: n, keys, csv: keys.join("\n") });
    } catch (e) { next(e); }
});

router.get("/admin/license-keys", requireAdmin, async (req, res, next) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const tier = req.query.tier;
        const params = [limit];
        let where = "";
        if (tier) { params.push(tier); where = "WHERE tier=$2"; }
        const r = await pool.query(
            `SELECT id, key_prefix, tier, products, max_devices,
                    expires_at, revoked_at, notes, customer_email, created_at,
                    active_devices, total_activations
               FROM license_keys_with_usage
              ${where}
              ORDER BY created_at DESC
              LIMIT $1`,
            params
        );
        res.json({ keys: r.rows, count: r.rowCount });
    } catch (e) { next(e); }
});

router.post("/admin/license-keys/:id/revoke", requireAdmin, async (req, res, next) => {
    try {
        const { reason } = req.body || {};
        await pool.query(
            "UPDATE license_keys SET revoked_at=now(), revoke_reason=$2 WHERE id=$1",
            [req.params.id, reason || "admin_revoked"]
        );
        // Marca todas as ativações como deactivated
        await pool.query(
            "UPDATE license_key_activations SET deactivated_at=now() WHERE license_key_id=$1 AND deactivated_at IS NULL",
            [req.params.id]
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
});

// Endpoint admin pra rodar a migration 009
router.post("/admin/maintenance/run-migration-009", requireAdmin, async (_req, res, next) => {
    try {
        const fs = require("fs"); const path = require("path");
        const sqlPath = path.join(__dirname, "..", "..", "migrations", "009_license_keys.sql");
        await pool.query(fs.readFileSync(sqlPath, "utf8"));
        res.json({ ok: true, migration: "009_license_keys", executed_at: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ error: "migration_failed", message: e.message });
    }
});

module.exports = { router };
