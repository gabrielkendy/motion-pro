"use strict";
const { verifySession } = require("../utils/jwt");
const { pool } = require("../db");

function requireAuth(req, res, next) {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: "missing_token" });
    const payload = verifySession(m[1]);
    if (!payload) return res.status(401).json({ error: "invalid_token" });
    req.user = { id: payload.sub, email: payload.email };
    next();
}

async function requireAdmin(req, res, next) {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: "missing_token" });
    const payload = verifySession(m[1]);
    if (!payload) return res.status(401).json({ error: "invalid_token" });
    try {
        const r = await pool.query("SELECT id, email, is_admin FROM users WHERE id=$1", [payload.sub]);
        if (!r.rowCount || !r.rows[0].is_admin) return res.status(403).json({ error: "admin_required" });
        req.user = { id: r.rows[0].id, email: r.rows[0].email, is_admin: true };
        next();
    } catch (e) { next(e); }
}

module.exports = { requireAuth, requireAdmin };
