#!/usr/bin/env node
/* tools/thumb-generator.js
 *
 * Pre-generates static .jpg thumbnails for every preview .mp4 in the catalog,
 * writing them to plugin/thumbs/<hash>.jpg with the same hash the runtime
 * uses. After running this once, the panel is INSTANT — no canvas capture
 * happens at runtime; it just shows <img>.
 *
 * Requirements:
 *   - ffmpeg in PATH (https://ffmpeg.org / `winget install ffmpeg` on Win)
 *
 * Usage:
 *   node thumb-generator.js                  # generate all
 *   node thumb-generator.js --pack create-pack    # only one pack
 *   node thumb-generator.js --concurrency 8       # parallel jobs (default 4)
 *   node thumb-generator.js --force          # regenerate existing
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CATALOG = path.join(ROOT, "plugin", "catalog", "catalog.json");
const OUT_DIR = path.join(ROOT, "plugin", "thumbs");

const args = process.argv.slice(2);
const argv = {
    pack: pick("--pack"),
    concurrency: Number(pick("--concurrency") || 4),
    force: args.includes("--force")
};
function pick(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

function sha1Short(str) {
    // mirror runtime hash so files match
    let h = 0xdeadbeef >>> 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 2654435761) >>> 0;
    }
    return (h.toString(16) + str.length.toString(16)).padStart(10, "0");
}

if (!fs.existsSync(CATALOG)) {
    console.error("Catálogo não encontrado em " + CATALOG); process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const tasks = [];
for (const p of cat.packs) {
    if (argv.pack && p.id !== argv.pack) continue;
    walk(p.categories || [], (item) => {
        if (!item.preview) return;
        const dst = path.join(OUT_DIR, sha1Short(item.mogrt || item.preview || item.name) + ".jpg");
        if (!argv.force && fs.existsSync(dst)) return;
        tasks.push({ item, src: item.preview, dst });
    });
}
function walk(nodes, cb) {
    for (const n of nodes || []) {
        if (n.items) for (const it of n.items) cb(it);
        if (n.children) walk(n.children, cb);
    }
}
console.log(`${tasks.length} thumbs to generate (concurrency=${argv.concurrency})`);
if (tasks.length === 0) { console.log("Tudo em dia."); process.exit(0); }

let i = 0, done = 0, errs = 0;
const total = tasks.length;
const start = Date.now();

function next() {
    if (i >= tasks.length) return;
    const t = tasks[i++];
    if (!fs.existsSync(t.src)) { done++; finalize(); next(); return; }

    // ffmpeg -ss <middle> -i src -vframes 1 -q:v 3 dst
    // We pick a frame at ~75% of duration. To avoid ffprobe, use -sseof -1.5
    // which seeks from the end (1.5s before EOF) — perfect "settled" frame.
    const args = [
        "-y",
        "-sseof", "-1.5",
        "-i", t.src,
        "-vframes", "1",
        "-q:v", "3",
        "-vf", "scale='min(640,iw)':-2",
        t.dst
    ];
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", d => { stderr += d.toString(); });
    ff.on("close", (code) => {
        if (code !== 0) {
            // try fallback: seek from start to ~1.5s
            const args2 = ["-y", "-ss", "1.2", "-i", t.src, "-vframes", "1", "-q:v", "3", "-vf", "scale='min(640,iw)':-2", t.dst];
            const ff2 = spawn("ffmpeg", args2, { stdio: ["ignore", "ignore", "ignore"] });
            ff2.on("close", (c2) => {
                if (c2 !== 0) { errs++; console.error("✗ " + path.basename(t.src)); }
                done++; finalize(); next();
            });
        } else { done++; finalize(); next(); }
    });
}

function finalize() {
    if (done % 50 === 0 || done === total) {
        const pct = ((done / total) * 100).toFixed(1);
        const ela = ((Date.now() - start) / 1000).toFixed(0);
        const rate = (done / Math.max(1, (Date.now() - start) / 1000)).toFixed(1);
        process.stdout.write(`\r  ${done}/${total} (${pct}%) · ${rate}/s · ${ela}s · ${errs} errs   `);
    }
    if (done === total) {
        console.log("\n\nGerados em " + OUT_DIR);
        console.log(errs > 0 ? `${errs} falhas (provavelmente .mp4 inválidos)` : "Sem erros.");
        process.exit(errs > 0 ? 0 : 0);
    }
}

// kick off N parallel workers
for (let k = 0; k < argv.concurrency; k++) next();
