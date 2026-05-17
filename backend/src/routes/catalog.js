"use strict";
const router = require("express").Router();
const { pool } = require("../db");
const { requireAdmin } = require("../middleware/auth");

// GET /v1/catalog — público (plugin precisa baixar mesmo sem login).
// Conteúdo do catálogo é só metadata (nomes de packs/items), não tem assets.
router.get("/", async (req, res, next) => {
    try {
        const v = (req.query.v || "latest");
        let r;
        if (v === "latest") {
            r = await pool.query(
                "SELECT version, content FROM catalog_versions WHERE is_active=true ORDER BY published_at DESC LIMIT 1"
            );
        } else {
            r = await pool.query("SELECT version, content FROM catalog_versions WHERE version=$1", [v]);
        }
        if (r.rowCount === 0) return res.status(404).json({ error: "no_catalog" });
        res.json(r.rows[0].content);
    } catch (e) { next(e); }
});

// POST /v1/catalog/publish — SOMENTE admin.
// Bug crítico anterior: estava sem auth, qualquer um podia sobrescrever o catálogo.
router.post("/publish", requireAdmin, async (req, res, next) => {
    try {
        const body = req.body;
        if (!body || !body.version) return res.status(400).json({ error: "version_required" });
        await pool.query("UPDATE catalog_versions SET is_active=false");
        await pool.query(
            "INSERT INTO catalog_versions(version, content, is_active) VALUES($1,$2,true)",
            [body.version, body]
        );
        await pool.query(
            "INSERT INTO license_audit(user_id, action, detail) VALUES($1, 'catalog_publish', $2)",
            [req.user.id, { version: body.version }]
        );
        res.json({ ok: true, version: body.version });
    } catch (e) { next(e); }
});

module.exports = { router };
