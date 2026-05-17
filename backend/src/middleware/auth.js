"use strict";
const { verifySession } = require("../utils/jwt");

function requireAuth(req, res, next) {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: "missing_token" });
    const payload = verifySession(m[1]);
    if (!payload) return res.status(401).json({ error: "invalid_token" });
    req.user = { id: payload.sub, email: payload.email };
    next();
}

module.exports = { requireAuth };
