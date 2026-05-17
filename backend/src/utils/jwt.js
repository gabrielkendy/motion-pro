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

function verifyLicense(token) {
    try { return jwt.verify(token, LICENSE_SECRET, { issuer: "motionvault" }); }
    catch (e) { return null; }
}

// Reset token: short-lived JWT signed with LICENSE_SECRET
function signResetToken(userId, email) {
    return jwt.sign(
        { sub: userId, email, purpose: "password_reset" },
        LICENSE_SECRET,
        { expiresIn: "1h", issuer: "motionvault" }
    );
}
function verifyResetToken(token) {
    try {
        const p = jwt.verify(token, LICENSE_SECRET, { issuer: "motionvault" });
        if (p.purpose !== "password_reset") return null;
        return p;
    } catch (e) { return null; }
}

// Email verification token (válido 7 dias)
function signEmailVerifyToken(userId, email) {
    return jwt.sign(
        { sub: userId, email, purpose: "email_verify" },
        LICENSE_SECRET,
        { expiresIn: "7d", issuer: "motionvault" }
    );
}
function verifyEmailToken(token) {
    try {
        const p = jwt.verify(token, LICENSE_SECRET, { issuer: "motionvault" });
        if (p.purpose !== "email_verify") return null;
        return p;
    } catch (e) { return null; }
}

module.exports = {
    signSession, verifySession,
    signLicense, verifyLicense,
    signResetToken, verifyResetToken,
    signEmailVerifyToken, verifyEmailToken
};
