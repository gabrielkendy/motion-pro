"use strict";
const router = require("express").Router();
const { pool } = require("../db");

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

// Admin-only publish endpoint (gated elsewhere; for dev convenience)
router.post("/publish", async (req, res, next) => {
    try {
        const body = req.body;
        if (!body || !body.version) return res.status(400).json({ error: "version_required" });
        await pool.query("UPDATE catalog_versions SET is_active=false");
        await pool.query(
            "INSERT INTO catalog_versions(version, content, is_active) VALUES($1,$2,true)",
            [body.version, body]
        );
        res.json({ ok: true, version: body.version });
    } catch (e) { next(e); }
});

module.exports = { router };
