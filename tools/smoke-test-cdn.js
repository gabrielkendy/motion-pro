#!/usr/bin/env node
/**
 * tools/smoke-test-cdn.js
 *
 * Valida pipeline ponta-a-ponta:
 *   1. Lê 5 assets aleatórios do Neon (com cdn_key real já uploaded)
 *   2. Assina cada URL localmente com o CDN_SIGN_SECRET
 *   3. GET no Worker (cdn.kendyproducoes.com.br)
 *   4. Confirma status 200 + Content-Length bate com size_bytes
 *   5. Também testa: URL não-assinada deve falhar (401)
 *
 * Uso:
 *   node smoke-test-cdn.js                # 5 amostras random
 *   node smoke-test-cdn.js --count 20     # mais amostras
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const crypto = require("crypto");
const https = require("https");
const { Pool } = require("pg");

const argv = process.argv.slice(2);
const COUNT = Number(argv.includes("--count") ? argv[argv.indexOf("--count") + 1] : 5);

const SECRET   = process.env.CDN_SIGN_SECRET;
const CDN_BASE = process.env.CDN_BASE || "https://cdn.kendyproducoes.com.br";

if (!SECRET) { console.error("missing CDN_SIGN_SECRET in .env"); process.exit(2); }

function signCdnUrl(key, fingerprint) {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const data = `${key}\n${fingerprint}\n${exp}`;
    const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
    const k = encodeURI(key);
    return `${CDN_BASE}/${k}?fp=${fingerprint}&e=${exp}&s=${sig}`;
}

function head(url) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: "GET" }, (res) => {
            const cl = res.headers["content-length"];
            res.on("data", () => {});
            res.on("end", () => resolve({ status: res.statusCode, contentLength: cl }));
        });
        req.on("error", reject);
        req.setTimeout(15000, () => { req.destroy(new Error("timeout")); });
        req.end();
    });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async function main() {
    console.log("[smoke] CDN_BASE =", CDN_BASE);

    const r = await pool.query(
        `SELECT id, pack_id, cdn_key, size_bytes, kind FROM assets
         WHERE product_id='Motion Titles' AND published=true
         ORDER BY random() LIMIT $1`, [COUNT]);

    console.log("[smoke] testing", r.rows.length, "random assets:\n");

    let pass = 0, fail = 0;
    for (const row of r.rows) {
        const fp = "smoke-test-" + Math.random().toString(36).slice(2, 10);
        const signed = signCdnUrl(row.cdn_key, fp);
        process.stdout.write(`  ${row.kind.padEnd(7)} ${row.cdn_key.slice(0, 60).padEnd(60)} `);
        try {
            const res = await head(signed);
            const sizeOk = !row.size_bytes || !res.contentLength || String(row.size_bytes) === res.contentLength;
            const ok = res.status === 200 && sizeOk;
            console.log(ok ? "OK" : "FAIL", `(status=${res.status}, size=${res.contentLength}/${row.size_bytes})`);
            if (ok) pass++; else fail++;
        } catch (e) {
            console.log("ERR", e.message);
            fail++;
        }
    }

    // Negative test: same key but no signature -> 401
    if (r.rows[0]) {
        const unsigned = `${CDN_BASE}/${encodeURI(r.rows[0].cdn_key)}`;
        process.stdout.write("\n  [neg] unsigned should 401: ");
        try {
            const res = await head(unsigned);
            console.log(res.status === 401 ? "OK (got 401)" : `FAIL (got ${res.status})`);
        } catch (e) { console.log("ERR", e.message); }
    }

    console.log(`\n[smoke] pass=${pass} fail=${fail}`);
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error("[smoke] FATAL:", e); process.exit(1); });
