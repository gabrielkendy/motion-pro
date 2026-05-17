"use strict";
const jwt = require("jsonwebtoken");

const SESSION_SECRET = process.env.JWT_SECRET;
const LICENSE_SECRET = process.env.LICENSE_SECRET;
const TTL_HOURS = Number(process.env.LICENSE_TTL_HOURS || 24);

function signSession(userId, email) {
    return jwt.sign({ sub: userId, email }, SESSION_SECRET, { expiresIn: "30d", issuer: "motionvault" });
}
function verifySession(token) {
    try { return jwt.verify(token, SESSION_SECRET, { issuer: "motionvault" }); }
    catch (e) { return null; }
}

function signLicense({ userId, email, plan, fingerprint, packs }) {
    const ttl = plan === "lifetime" ? "365d" : `${TTL_HOURS}h`;
    return jwt.sign(
        { sub: email, uid: userId, plan, fp: fingerprint, packs: packs || ["*"] },
        LICENSE_SECRET,
        { expiresIn: ttl, issuer: "motionvault" }
    );
}

module.exports = { signSession, verifySession, signLicense };
