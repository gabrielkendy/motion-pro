#!/usr/bin/env node
/* tools/sign-license.js
 * Generates a signed HS256 JWT license for manual issuance (e.g. lifetime grants,
 * legacy customers, refund recovery). Mirrors what the backend produces.
 *
 * Usage:
 *   MV_JWT_SECRET="..." node sign-license.js --email gabriel@x.com --plan lifetime --fp <fp>
 */
"use strict";
const crypto = require("crypto");
const args = parseArgs(process.argv.slice(2));
if (!process.env.MV_JWT_SECRET) {
    console.error("Defina MV_JWT_SECRET"); process.exit(1);
}
if (!args.email || !args.plan || !args.fp) {
    console.error("Use: --email <email> --plan <pro|lifetime|pro_all> --fp <fingerprint>"); process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const exp = args.plan === "lifetime" ? now + 60 * 60 * 24 * 365 * 50 : now + 60 * 60 * 24;
const payload = {
    sub: args.email,
    plan: args.plan,
    fp: args.fp,
    packs: ["*"],
    iat: now,
    exp,
    iss: "motionvault"
};

const header = { alg: "HS256", typ: "JWT" };
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const signing = enc(header) + "." + enc(payload);
const sig = crypto.createHmac("sha256", process.env.MV_JWT_SECRET).update(signing).digest("base64url");
console.log(signing + "." + sig);

function parseArgs(a) {
    const o = {};
    for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, "")] = a[i + 1];
    return o;
}
