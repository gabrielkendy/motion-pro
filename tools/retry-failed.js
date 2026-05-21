#!/usr/bin/env node
/**
 * tools/retry-failed.js
 *
 * Após o upload-to-r2.js terminar, este script:
 *   1. Lê .upload-state.json (arquivos que SUBIRAM)
 *   2. Walk no SOURCE_ROOT pra listar TODOS os .mogrt + .mp4 esperados
 *   3. Calcula a diferença = arquivos que falharam ou nunca rodaram
 *   4. Reprocessa esses com retry exponential + maior timeout
 *
 * Uso:
 *   node retry-failed.js              # retry 3x com backoff
 *   node retry-failed.js --max 5      # mais tentativas
 *   node retry-failed.js --dry-run    # só lista o que faltou
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { Pool } = require("pg");

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const MAX_RETRIES = Number(argv.includes("--max") ? argv[argv.indexOf("--max") + 1] : 3);

const SOURCE_ROOT = process.env.SOURCE_ROOT;
const BUCKET = process.env.R2_BUCKET || "Motion Titles-assets";
const STATE_FILE = path.join(__dirname, ".upload-state.json");

function slugify(s) {
    return String(s).toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function detectPackFromPath(absPath) {
    const rel = path.relative(SOURCE_ROOT, absPath).split(path.sep);
    const packDir = rel[0] || "unknown";
    const packId = slugify(packDir.replace(/_for_PP_by_.*$/i, "").replace(/_for_AE_by_.*$/i, ""));
    return { packId, packName: packDir };
}

function deriveCdnKey(absPath, kind) {
    const { packId } = detectPackFromPath(absPath);
    const rel = path.relative(SOURCE_ROOT, absPath).replace(/\\/g, "/");
    const parts = rel.split("/").slice(1).map(slugify);
    const filename = path.basename(absPath);
    const ext = path.extname(filename).toLowerCase();
    const fileSlug = slugify(path.basename(filename, ext)) + ext;
    return [kind, packId, ...parts.slice(0, -1), fileSlug].join("/");
}

function deriveAssetId(packId, cdnKey) {
    return packId + "_" + crypto.createHash("sha1").update(cdnKey).digest("hex").slice(0, 10);
}

function sha256File(p) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash("sha256");
        const s = fs.createReadStream(p);
        s.on("data", (c) => h.update(c));
        s.on("end", () => resolve(h.digest("hex")));
        s.on("error", reject);
    });
}

function walk(dir, pattern, out) {
    out = out || [];
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return out; }
    for (const f of entries) {
        const p = path.join(dir, f);
        let st;
        try { st = fs.statSync(p); } catch (_) { continue; }
        if (st.isDirectory()) walk(p, pattern, out);
        else if (pattern.test(f)) out.push(p);
    }
    return out;
}

const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: {
        // longer timeouts for flaky uploads
        connectionTimeout: 30000,
        socketTimeout: 120000,
    },
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function uploadWithRetry(filePath, cdnKey, contentType, attempts) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const body = fs.createReadStream(filePath);
            await r2.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: cdnKey,
                Body: body,
                ContentType: contentType,
            }));
            return { ok: true, attempt: i + 1 };
        } catch (e) {
            lastErr = e;
            if (i < attempts - 1) {
                await sleep(1000 * Math.pow(2, i));
            }
        }
    }
    return { ok: false, error: lastErr };
}

async function processOne(filePath, kind, state) {
    const cdnKey = deriveCdnKey(filePath, kind);
    const { packId } = detectPackFromPath(filePath);
    const assetId = deriveAssetId(packId, cdnKey);
    const stat = fs.statSync(filePath);
    const ct = filePath.toLowerCase().endsWith(".mp4") ? "video/mp4" : "application/octet-stream";

    if (DRY_RUN) {
        console.log("  WOULD retry:", cdnKey);
        return;
    }

    const r = await uploadWithRetry(filePath, cdnKey, ct, MAX_RETRIES);
    if (!r.ok) {
        console.error("  STILL FAILED:", cdnKey, "::", (r.error && r.error.message) || r.error);
        return false;
    }

    const sha = await sha256File(filePath);
    await pool.query(
        `INSERT INTO assets(id, pack_id, name, cdn_key, sha256, size_bytes, kind, product_id, published, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,now())
         ON CONFLICT (id) DO UPDATE SET
             pack_id=$2, name=$3, cdn_key=$4, sha256=$5, size_bytes=$6, kind=$7, product_id=$8,
             published=true, updated_at=now()`,
        [assetId, packId, path.basename(filePath, path.extname(filePath)), cdnKey, sha, stat.size, kind, "Motion Titles"]
    );

    state.done[cdnKey] = { size: stat.size, sha, assetId, uploadedAt: new Date().toISOString() };
    console.log("  RECOVERED:", cdnKey, "(attempt", r.attempt + ")");
    return true;
}

(async function main() {
    const state = fs.existsSync(STATE_FILE)
        ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
        : { done: {} };

    const allMogrt = walk(SOURCE_ROOT, /\.mogrt$/i, []).filter(p => !/\\MotionVault\\/i.test(p));
    const allMp4   = walk(SOURCE_ROOT, /\.mp4$/i,   []).filter(p => !/\\MotionVault\\/i.test(p));

    const expected = [
        ...allMogrt.map(p => ({ path: p, kind: "mogrt" })),
        ...allMp4.map(p => ({ path: p, kind: "preview" })),
    ];

    const missing = expected.filter(e => {
        const key = deriveCdnKey(e.path, e.kind);
        return !state.done[key];
    });

    console.log("[retry] expected =", expected.length);
    console.log("[retry] in state =", Object.keys(state.done).length);
    console.log("[retry] missing  =", missing.length);

    if (!missing.length) {
        console.log("[retry] all good, nothing to retry.");
        await pool.end();
        return;
    }

    let recovered = 0, failed = 0;
    for (const m of missing) {
        try {
            const ok = await processOne(m.path, m.kind, state);
            if (ok) recovered++;
            else failed++;
            if ((recovered + failed) % 10 === 0) {
                fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
            }
        } catch (e) {
            failed++;
            console.error("  EXCEPTION:", m.path, "::", e.message);
        }
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log("\n[retry] recovered =", recovered, "still_failed =", failed);
    await pool.end();
})().catch(e => {
    console.error("[retry] FATAL:", e);
    process.exit(1);
});
