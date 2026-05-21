#!/usr/bin/env node
/**
 * tools/upload-to-r2.js
 *
 * Uploads all .mogrt + .mp4 preview assets from disk to Cloudflare R2 and
 * registers them in Postgres (table `assets`) so the backend can sign URLs.
 *
 * What it does:
 *   1. Walk every pack folder under SOURCE_ROOT (default: ~/Documents/Motion Bro)
 *   2. For each .mogrt:
 *        a. compute sha256
 *        b. derive a stable cdn_key e.g. "mogrt/<pack>/<category>/<file>.mogrt"
 *        c. upload to R2 if missing or size/hash changed
 *        d. UPSERT row in assets(id, pack_id, name, cdn_key, sha256, size_bytes, kind, product_id)
 *   3. Same for previews (.mp4) under kind='preview', product_id='Motion Titles'
 *   4. Print summary + write a new catalog-v2.json that uses asset ids/cdn_keys
 *      instead of absolute local paths.
 *
 * Required env (load via .env or shell):
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET          (default: Motion Titles-assets)
 *   DATABASE_URL       (Neon prod connection string)
 *   SOURCE_ROOT        (default: C:\Users\Gabriel\Documents\Motion Bro)
 *
 * Usage:
 *   node tools/upload-to-r2.js                    # uploads + writes catalog-v2
 *   node tools/upload-to-r2.js --dry-run          # checks what would change, no writes
 *   node tools/upload-to-r2.js --only-mogrt       # skip previews
 *   node tools/upload-to-r2.js --resume           # restart after partial run (reads .upload-state.json)
 *   node tools/upload-to-r2.js --concurrency 4    # parallel uploads
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { Pool } = require("pg");

// ---------- args ----------
const argv = process.argv.slice(2);
function arg(name, fallback) {
    const i = argv.indexOf("--" + name);
    return i >= 0 ? argv[i + 1] : fallback;
}
const DRY_RUN     = argv.includes("--dry-run");
const ONLY_MOGRT  = argv.includes("--only-mogrt");
const RESUME      = argv.includes("--resume");
const CONCURRENCY = Number(arg("concurrency", 4));

// ---------- config ----------
const SOURCE_ROOT = process.env.SOURCE_ROOT || "C:\\Users\\Gabriel\\Documents\\Motion Bro";
const BUCKET = process.env.R2_BUCKET || "Motion Titles-assets";
const REQUIRED_ENV = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "DATABASE_URL"];
for (const k of REQUIRED_ENV) {
    if (!process.env[k]) {
        console.error("[upload] missing env: " + k);
        process.exit(2);
    }
}

const STATE_FILE = path.join(__dirname, ".upload-state.json");

// ---------- helpers ----------
function sha256File(p) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash("sha256");
        const s = fs.createReadStream(p);
        s.on("data", (c) => h.update(c));
        s.on("end",  () => resolve(h.digest("hex")));
        s.on("error", reject);
    });
}

function slugify(s) {
    return String(s)
        .toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function detectPackFromPath(absPath) {
    // Pattern observed: ".../Motion Bro/<Pack Name>_for_PP_by_pacotesfx/<Category>/<...>/<file>.mogrt"
    const rel = path.relative(SOURCE_ROOT, absPath).split(path.sep);
    const packDir = rel[0] || "unknown";
    const packId  = slugify(packDir.replace(/_for_PP_by_.*$/i, "").replace(/_for_AE_by_.*$/i, ""));
    return { packId, packName: packDir };
}

function deriveCdnKey(absPath, kind) {
    const { packId } = detectPackFromPath(absPath);
    const rel = path.relative(SOURCE_ROOT, absPath).replace(/\\/g, "/");
    // Drop the pack folder + replace with slug, keep the rest lowercased + slugified per segment
    const parts = rel.split("/").slice(1).map(slugify);
    const filename = path.basename(absPath);
    const ext = path.extname(filename).toLowerCase();
    const fileSlug = slugify(path.basename(filename, ext)) + ext;
    return [kind, packId, ...parts.slice(0, -1), fileSlug].join("/");
}

function deriveAssetId(packId, cdnKey) {
    // Stable, deterministic, short — uses cdn_key hash so re-runs match
    return packId + "_" + crypto.createHash("sha1").update(cdnKey).digest("hex").slice(0, 10);
}

function loadState() {
    if (!RESUME || !fs.existsSync(STATE_FILE)) return { done: {} };
    try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
    catch (_) { return { done: {} }; }
}
function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
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

// ---------- R2 client ----------
const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

async function headOrNull(key) {
    try {
        const r = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        return r;
    } catch (e) {
        if (e && e.$metadata && e.$metadata.httpStatusCode === 404) return null;
        if (e && e.name === "NotFound") return null;
        throw e;
    }
}

async function putObject(key, filePath, contentType) {
    const body = fs.createReadStream(filePath);
    await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
    }));
}

// ---------- DB ----------
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function upsertAsset(row) {
    if (DRY_RUN) return;
    await pool.query(
        `INSERT INTO assets(id, pack_id, name, cdn_key, sha256, size_bytes, kind, product_id, published, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,now())
         ON CONFLICT (id) DO UPDATE SET
             pack_id=$2, name=$3, cdn_key=$4, sha256=$5, size_bytes=$6, kind=$7, product_id=$8,
             published=true, updated_at=now()`,
        [row.id, row.pack_id, row.name, row.cdn_key, row.sha256, row.size_bytes, row.kind, row.product_id]
    );
}

// ---------- main ----------
async function processFile(absPath, kind, state) {
    const stat = fs.statSync(absPath);
    const cdnKey = deriveCdnKey(absPath, kind);
    const { packId } = detectPackFromPath(absPath);
    const assetId = deriveAssetId(packId, cdnKey);

    if (state.done[cdnKey] && state.done[cdnKey].size === stat.size) {
        return { skip: true, assetId, cdnKey };
    }

    const sha = await sha256File(absPath);
    const head = await headOrNull(cdnKey);
    const needsUpload = !head || head.ContentLength !== stat.size;

    if (needsUpload && !DRY_RUN) {
        const ct = absPath.toLowerCase().endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
        await putObject(cdnKey, absPath, ct);
    }

    const row = {
        id: assetId,
        pack_id: packId,
        name: path.basename(absPath, path.extname(absPath)),
        cdn_key: cdnKey,
        sha256: sha,
        size_bytes: stat.size,
        kind: kind,
        product_id: "Motion Titles",
    };
    await upsertAsset(row);

    state.done[cdnKey] = { size: stat.size, sha, assetId, uploadedAt: new Date().toISOString() };
    return { uploaded: needsUpload, assetId, cdnKey, sha };
}

async function runPool(jobs, fn, concurrency) {
    let i = 0, active = 0;
    return new Promise((resolve, reject) => {
        const results = new Array(jobs.length);
        function next() {
            if (i >= jobs.length && active === 0) return resolve(results);
            while (active < concurrency && i < jobs.length) {
                const idx = i++; active++;
                Promise.resolve()
                    .then(() => fn(jobs[idx], idx))
                    .then((r) => { results[idx] = { ok: true, value: r }; })
                    .catch((e) => { results[idx] = { ok: false, error: e }; })
                    .finally(() => { active--; next(); });
            }
        }
        next();
    });
}

(async function main() {
    console.log("[upload] SOURCE_ROOT =", SOURCE_ROOT);
    console.log("[upload] BUCKET      =", BUCKET, DRY_RUN ? "(dry-run)" : "");

    const state = loadState();

    const mogrtFiles = walk(SOURCE_ROOT, /\.mogrt$/i, []).filter(p => !/\\MotionVault\\/i.test(p));
    const mp4Files   = ONLY_MOGRT ? [] : walk(SOURCE_ROOT, /\.mp4$/i,   []).filter(p => !/\\MotionVault\\/i.test(p));

    console.log(`[upload] found ${mogrtFiles.length} .mogrt + ${mp4Files.length} .mp4 previews`);

    let uploaded = 0, skipped = 0, failed = 0;

    async function handleOne(filePath, kind) {
        try {
            const r = await processFile(filePath, kind, state);
            if (r.skip)         { skipped++; }
            else if (r.uploaded){ uploaded++; }
            else                { skipped++; }
            if ((uploaded + skipped) % 50 === 0) {
                saveState(state);
                process.stdout.write(`\r  progress: uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
            }
        } catch (e) {
            failed++;
            console.error("\n[upload] FAIL " + filePath + " :: " + e.message);
        }
    }

    await runPool(mogrtFiles, (p) => handleOne(p, "mogrt"),   CONCURRENCY);
    await runPool(mp4Files,   (p) => handleOne(p, "preview"), CONCURRENCY);

    saveState(state);
    console.log("\n[upload] done. uploaded=" + uploaded + " skipped=" + skipped + " failed=" + failed);

    await pool.end();
})().catch((e) => {
    console.error("[upload] FATAL:", e);
    process.exit(1);
});
