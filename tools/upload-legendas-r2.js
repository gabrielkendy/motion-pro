#!/usr/bin/env node
/**
 * tools/upload-legendas-r2.js
 *
 * Migra os 61 MOGRTs do plugin-legendas pro Cloudflare R2 + registra em
 * `assets` table com product_id='legendas'. Atualiza o packs/catalog.json
 * pra ter cdn_key/sha256/id em cada item (não mexe nos previews .gif).
 *
 * Diferenças do upload-to-r2.js original (Titles):
 *  - SOURCE_ROOT fixo em plugin-legendas/packs
 *  - product_id = 'legendas'
 *  - cdn_key começa com 'legendas/<pack-folder>/<filename>.mogrt'
 *  - Reescreve packs/catalog.json no fim, atribuindo cdn_key/id/sha256
 *  - Não faz upload de .gif (previews ficam no ZIP, são leves)
 *
 * Env (tools/.env):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_BUCKET            (mesmo bucket do Titles serve)
 *   DATABASE_URL         (Neon prod)
 *
 * Uso:
 *   node tools/upload-legendas-r2.js                # upload + rewrite catalog
 *   node tools/upload-legendas-r2.js --dry-run      # só calcula, sem subir/escrever
 *   node tools/upload-legendas-r2.js --concurrency 4
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { Pool } = require("pg");

const argv = process.argv.slice(2);
const DRY_RUN     = argv.includes("--dry-run");
const CONCURRENCY = Number((argv.indexOf("--concurrency") >= 0 ? argv[argv.indexOf("--concurrency") + 1] : 4));

const REPO_ROOT  = path.resolve(__dirname, "..");
const PACKS_DIR  = path.join(REPO_ROOT, "plugin-legendas", "packs");
const CATALOG_FP = path.join(PACKS_DIR, "catalog.json");
const BUCKET     = process.env.R2_BUCKET || "motionpro-assets";

for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "DATABASE_URL"]) {
    if (!process.env[k]) { console.error("missing env: " + k); process.exit(2); }
}

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
    return String(s).toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}
function deriveCdnKey(packFolder, mogrtRelPath) {
    // packFolder ex: "ep-texto"  /  mogrtRelPath ex: "ep-texto/Texto 13.mogrt"
    const parts = mogrtRelPath.split(/[/\\]/).map(slugify);
    return "legendas/" + parts.join("/").replace(/\.mogrt$/i, ".mogrt");
}
function deriveAssetId(cdnKey) {
    return "legendas_" + crypto.createHash("sha1").update(cdnKey).digest("hex").slice(0, 12);
}

const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

async function headOrNull(key) {
    try { return await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); }
    catch (e) {
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
        throw e;
    }
}
async function putObject(key, filePath) {
    const body = fs.createReadStream(filePath);
    await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: "application/octet-stream",
    }));
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function upsertAsset(row) {
    if (DRY_RUN) return;
    await pool.query(
        `INSERT INTO assets(id, pack_id, name, cdn_key, sha256, size_bytes, kind, product_id, published, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'mogrt','legendas',true,now())
         ON CONFLICT (id) DO UPDATE SET
             pack_id=$2, name=$3, cdn_key=$4, sha256=$5, size_bytes=$6,
             kind='mogrt', product_id='legendas', published=true, updated_at=now()`,
        [row.id, row.pack_id, row.name, row.cdn_key, row.sha256, row.size_bytes]
    );
}

async function runPool(jobs, fn, concurrency) {
    let i = 0, active = 0;
    return new Promise((resolve) => {
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
    console.log("[legendas-upload] PACKS_DIR =", PACKS_DIR);
    console.log("[legendas-upload] BUCKET    =", BUCKET, DRY_RUN ? "(dry-run)" : "");

    const catalog = JSON.parse(fs.readFileSync(CATALOG_FP, "utf8"));
    const allItems = [];
    for (const pack of catalog.packs || []) {
        for (const cat of pack.categories || []) {
            for (const item of cat.items || []) {
                if (!item.mogrt) continue;
                const abs = path.join(PACKS_DIR, item.mogrt);
                if (!fs.existsSync(abs)) {
                    console.warn("[skip] não encontrado:", item.mogrt);
                    continue;
                }
                allItems.push({ item, abs, packId: pack.id || "legendas-default", category: cat.name || "" });
            }
        }
    }
    console.log(`[legendas-upload] ${allItems.length} mogrts no catálogo`);

    let uploaded = 0, skipped = 0, failed = 0;
    await runPool(allItems, async (entry) => {
        const { item, abs, packId } = entry;
        try {
            const stat = fs.statSync(abs);
            const cdnKey = deriveCdnKey(packId, item.mogrt);
            const assetId = deriveAssetId(cdnKey);
            const sha = await sha256File(abs);
            const head = await headOrNull(cdnKey);
            const needs = !head || head.ContentLength !== stat.size;

            if (needs && !DRY_RUN) {
                await putObject(cdnKey, abs);
                uploaded++;
            } else {
                skipped++;
            }
            await upsertAsset({
                id: assetId, pack_id: packId, name: item.name || path.basename(abs, ".mogrt"),
                cdn_key: cdnKey, sha256: sha, size_bytes: stat.size,
            });
            // Anota no item do catálogo
            item.id = assetId;
            item.cdn_key = cdnKey;
            item.sha256 = sha;
            item.size_bytes = stat.size;

            process.stdout.write(`\r  uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
        } catch (e) {
            failed++;
            console.error("\n[FAIL]", item.mogrt, "::", e.message);
        }
    }, CONCURRENCY);

    // Reescreve o catalog.json com cdn_keys
    if (!DRY_RUN) {
        catalog.cdn_migration_at = new Date().toISOString();
        catalog.cdn_enabled = true;
        fs.writeFileSync(CATALOG_FP, JSON.stringify(catalog, null, 2) + "\n", "utf8");
        console.log("\n[legendas-upload] catalog.json atualizado com cdn_keys");
    }

    console.log(`\n[legendas-upload] FIM. uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
    await pool.end();
})().catch((e) => {
    console.error("[legendas-upload] FATAL:", e);
    process.exit(1);
});
