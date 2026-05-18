#!/usr/bin/env node
/**
 * tools/migrate-catalog.js
 *
 * Reads the current catalog.json (with absolute Windows paths) and rewrites it
 * to a "catalog-v2.json" that uses asset ids + cdn_keys instead of paths,
 * pulling the asset map from Postgres (populated by upload-to-r2.js).
 *
 * Strategy:
 *   1. Read plugin/catalog/catalog.json
 *   2. Walk every item; derive the cdn_key the same way upload-to-r2.js does
 *      (so they MATCH).
 *   3. Look up `assets` table by cdn_key → grab id + sha256 + size_bytes
 *   4. Replace item.mogrt / item.preview with item.cdn_key / item.preview_key,
 *      plus item.id (matches assets.id), item.sha256, item.size_bytes
 *   5. Write catalog-v2.json and catalog-v2.js (window.MV_CATALOG = …)
 *
 * Required env:
 *   DATABASE_URL
 *   SOURCE_ROOT   (must match upload script)
 */
"use strict";
const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const SOURCE_ROOT  = process.env.SOURCE_ROOT || "C:\\Users\\Gabriel\\Documents\\Motion Bro";
const CATALOG_IN   = path.resolve(__dirname, "..", "plugin", "catalog", "catalog.json");
const CATALOG_OUT  = path.resolve(__dirname, "..", "plugin", "catalog", "catalog.json");        // overwrite
const CATALOG_JS   = path.resolve(__dirname, "..", "plugin", "catalog", "catalog.js");
const CATALOG_BAK  = path.resolve(__dirname, "..", "plugin", "catalog", "catalog.legacy.json"); // backup

function slugify(s) {
    return String(s)
        .toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function detectPackFromPath(absPath) {
    const rel = path.relative(SOURCE_ROOT, absPath).split(path.sep);
    const packDir = rel[0] || "unknown";
    const packId  = slugify(packDir.replace(/_for_PP_by_.*$/i, "").replace(/_for_AE_by_.*$/i, ""));
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

(async function main() {
    if (!process.env.DATABASE_URL) {
        console.error("[migrate-catalog] DATABASE_URL missing");
        process.exit(2);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

    const raw = fs.readFileSync(CATALOG_IN, "utf8");
    const catalog = JSON.parse(raw);

    // Load all assets map: cdn_key -> { id, sha256, size_bytes }
    const rows = (await pool.query("SELECT id, cdn_key, sha256, size_bytes FROM assets")).rows;
    const byKey = new Map();
    for (const r of rows) byKey.set(r.cdn_key, r);

    let mapped = 0, missing = 0;
    function visitItems(items) {
        for (const it of items) {
            if (it.mogrt) {
                const k = deriveCdnKey(it.mogrt, "mogrt");
                const row = byKey.get(k);
                if (row) {
                    it.id           = row.id;
                    it.cdn_key      = k;
                    it.sha256       = row.sha256;
                    it.size_bytes   = row.size_bytes;
                    mapped++;
                } else {
                    missing++;
                }
                delete it.mogrt;
            }
            if (it.preview) {
                const k = deriveCdnKey(it.preview, "preview");
                const row = byKey.get(k);
                if (row) {
                    it.preview_key       = k;
                    it.preview_size      = row.size_bytes;
                }
                delete it.preview;
            }
        }
    }

    function visitPacks(packs) {
        for (const p of packs) {
            for (const cat of (p.categories || [])) {
                if (Array.isArray(cat.items)) visitItems(cat.items);
                for (const child of (cat.children || [])) {
                    if (Array.isArray(child.items)) visitItems(child.items);
                }
            }
        }
    }

    visitPacks(catalog.packs || []);

    catalog.cdn_version = new Date().toISOString();
    catalog.mode = "cdn";

    if (!fs.existsSync(CATALOG_BAK)) {
        fs.writeFileSync(CATALOG_BAK, raw, "utf8");
        console.log("[migrate-catalog] backup written: " + CATALOG_BAK);
    }
    fs.writeFileSync(CATALOG_OUT, JSON.stringify(catalog, null, 2), "utf8");
    fs.writeFileSync(CATALOG_JS, "window.MV_CATALOG = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");

    console.log("[migrate-catalog] done. mapped=" + mapped + " missing=" + missing);
    await pool.end();
})().catch(e => { console.error("[migrate-catalog] FATAL", e); process.exit(1); });
