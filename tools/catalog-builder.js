#!/usr/bin/env node
/* tools/catalog-builder.js
 *
 * Scans every Motion Bro pack inside MOTIONVAULT_PACKS_ROOT (or the default),
 * normalizes every pack.json into the MotionVault unified schema, and writes
 * one consolidated catalog.json into plugin/catalog/.
 *
 * Schema written:
 *   { version, generated_at, total_items, packs: [
 *       { id, name, badge, color, count,
 *         categories: [ { name, children?, items? } ] } ] }
 *
 * Each *item* keeps the original absolute path (windows) but is also exposed
 * as a relative path (so the catalog can be portable when assets ship inside
 * the plugin or on a CDN).
 *
 * Usage:
 *   node catalog-builder.js
 *   node catalog-builder.js "C:\\Users\\Gabriel\\Documents\\Motion Bro" "./out/catalog.json"
 */
"use strict";
const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = "C:\\Users\\Gabriel\\Documents\\Motion Bro";
const DEFAULT_OUT  = path.resolve(__dirname, "..", "plugin", "catalog", "catalog.json");

const ROOT = process.argv[2] || process.env.MOTIONVAULT_PACKS_ROOT || DEFAULT_ROOT;
const OUT  = process.argv[3] || DEFAULT_OUT;

function slug(s) {
    return String(s).toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

function listPackDirs(root) {
    if (!fs.existsSync(root)) {
        console.error("Pasta raiz não existe:", root); process.exit(1);
    }
    return fs.readdirSync(root)
        .map(n => path.join(root, n))
        .filter(p => fs.statSync(p).isDirectory())
        .filter(p => fs.existsSync(path.join(p, "pack.json")));
}

function readPack(packDir) {
    const j = JSON.parse(fs.readFileSync(path.join(packDir, "pack.json"), "utf8"));
    return { dir: packDir, json: j };
}

function normalizeNode(node, packDir, counters) {
    if (!node) return null;
    const isLeaf = node.type && node.type !== "category";
    if (isLeaf) {
        counters.items++;
        return {
            id: "i" + counters.items.toString(36),
            name: node.name,
            mogrt: node.path,
            preview: node.preview || null,
            w: node.previewWidth || 480,
            h: node.previewHeight || 270,
            type: node.type || "mogrt"
        };
    }
    const children = (node.children || []).map(c => normalizeNode(c, packDir, counters)).filter(Boolean);
    const items = children.filter(c => c && c.mogrt !== undefined);
    const subcats = children.filter(c => !(c && c.mogrt !== undefined));
    const out = { name: node.name };
    if (subcats.length) out.children = subcats;
    if (items.length) out.items = items;
    return out;
}

function build() {
    const dirs = listPackDirs(ROOT);
    console.log("Encontrados " + dirs.length + " packs em " + ROOT);
    const counters = { items: 0 };
    const packs = [];

    for (const d of dirs) {
        const { dir, json } = readPack(d);
        const packId = slug(json.packName || path.basename(d));
        const categories = (json.categories || []).map(c => normalizeNode(c, dir, counters)).filter(Boolean);
        const count = countItems(categories);
        packs.push({
            id: packId,
            name: json.packName || path.basename(d),
            badge: json.badgeText || "MOTIONVAULT",
            color: json.badgeBackgroundColor || "#2563EB",
            author: json.author || "PacotesFX",
            version: json.version || "1.0.0",
            host: json.apps || "PP",
            count,
            categories
        });
        console.log("  · " + (json.packName || d) + " — " + count + " itens");
    }

    const out = {
        version: new Date().toISOString().slice(0, 10),
        generated_at: new Date().toISOString(),
        source_root: ROOT,
        total_items: counters.items,
        packs
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
    console.log("\n→ Total de " + counters.items + " items escritos em " + OUT);
}

function countItems(nodes) {
    let n = 0;
    for (const x of nodes || []) {
        if (x.items) n += x.items.length;
        if (x.children) n += countItems(x.children);
    }
    return n;
}

build();
