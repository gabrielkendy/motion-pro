#!/usr/bin/env node
"use strict";
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = process.env.SOURCE_ROOT;

function slugify(s) {
    return String(s).toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}
function detectPack(absPath) {
    const rel = path.relative(SOURCE_ROOT, absPath).split(path.sep);
    return slugify(rel[0].replace(/_for_PP_by_.*$/i, "").replace(/_for_AE_by_.*$/i, ""));
}
function deriveCdnKey(absPath, kind) {
    const packId = detectPack(absPath);
    const rel = path.relative(SOURCE_ROOT, absPath).replace(/\\/g, "/");
    const parts = rel.split("/").slice(1).map(slugify);
    const ext = path.extname(absPath).toLowerCase();
    const fileSlug = slugify(path.basename(absPath, ext)) + ext;
    return [kind, packId, ...parts.slice(0, -1), fileSlug].join("/");
}
function walk(dir, pat, out) {
    out = out || [];
    try {
        for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            const st = fs.statSync(p);
            if (st.isDirectory()) walk(p, pat, out);
            else if (pat.test(f)) out.push(p);
        }
    } catch (_) {}
    return out;
}

const mogrt = walk(SOURCE_ROOT, /\.mogrt$/i).filter(p => !/\\MotionVault\\/i.test(p));
const mp4 = walk(SOURCE_ROOT, /\.mp4$/i).filter(p => !/\\MotionVault\\/i.test(p));

const keyToFiles = {};
for (const p of mogrt) {
    const k = deriveCdnKey(p, "mogrt");
    (keyToFiles[k] = keyToFiles[k] || []).push(p);
}
for (const p of mp4) {
    const k = deriveCdnKey(p, "preview");
    (keyToFiles[k] = keyToFiles[k] || []).push(p);
}

const collisions = Object.entries(keyToFiles).filter(([, fls]) => fls.length > 1);
const extras = collisions.reduce((s, [, fls]) => s + fls.length - 1, 0);

console.log("Total .mogrt found:", mogrt.length);
console.log("Total .mp4   found:", mp4.length);
console.log("Total expected uploads:", mogrt.length + mp4.length);
console.log("Unique CDN keys      :", Object.keys(keyToFiles).length);
console.log("Slug collisions      :", collisions.length);
console.log("Files lost to collision (extras only kept the last one):", extras);
console.log("");

if (collisions.length) {
    console.log("Sample collisions (first 8):");
    collisions.slice(0, 8).forEach(([k, files]) => {
        console.log("  KEY:", k);
        files.forEach(f => console.log("    <-", f));
    });
}
