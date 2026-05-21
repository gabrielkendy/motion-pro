#!/usr/bin/env node
/**
 * tools/build-zip-legendas.js
 *
 * Gera MotionPro-Legendas-<version>.zip pronto pra distribuição:
 *  1. Copia plugin-legendas → staging
 *  2. REMOVE todos os .mogrt da pasta packs/ (assets agora vêm da CDN R2)
 *  3. Obfusca JS via tools/obfuscate.js
 *  4. Atualiza versão em CSXS/manifest.xml e js/config.js
 *  5. Zipa pra landing/installers/MotionPro-Legendas-<version>.zip
 *  6. Limpa staging
 *
 * Uso:
 *   node tools/build-zip-legendas.js --version 1.2.0
 *   node tools/build-zip-legendas.js --version 1.2.0 --keep-mogrts   # debug
 *   node tools/build-zip-legendas.js --version 1.2.0 --no-obfuscate  # debug
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const args = process.argv.slice(2);
function arg(name, fallback) {
    const i = args.indexOf("--" + name);
    return i >= 0 ? args[i + 1] : fallback;
}
const VERSION = arg("version", null);
const KEEP_MOGRTS = args.includes("--keep-mogrts");
const NO_OBFUSCATE = args.includes("--no-obfuscate");
if (!VERSION) { console.error("missing --version"); process.exit(1); }

const REPO = path.resolve(__dirname, "..");
const SRC  = path.join(REPO, "plugin-legendas");
const STAGE_ROOT = path.join(require("os").tmpdir(), "mpl-zip-" + Date.now());
const STAGE = path.join(STAGE_ROOT, "MotionPro");
const OUT = path.join(REPO, "landing", "installers", `MotionPro-Legendas-${VERSION}.zip`);

function copyDir(srcDir, dstDir) {
    fs.mkdirSync(dstDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
        const s = path.join(srcDir, f);
        const d = path.join(dstDir, f);
        const st = fs.statSync(s);
        if (st.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}
function rmrf(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
}
function walk(dir, predicate, out) {
    out = out || [];
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p, predicate, out);
        else if (predicate(p)) out.push(p);
    }
    return out;
}

console.log("[build] STAGE =", STAGE);
console.log("[build] OUT   =", OUT);

// 1. Copia
console.log("[build] copiando plugin-legendas → staging");
copyDir(SRC, STAGE);

// 2. Remove .mogrt (assets vêm do CDN agora)
if (!KEEP_MOGRTS) {
    const packsDir = path.join(STAGE, "packs");
    const mogrts = walk(packsDir, p => p.toLowerCase().endsWith(".mogrt"));
    let removed = 0, freedBytes = 0;
    for (const m of mogrts) {
        freedBytes += fs.statSync(m).size;
        fs.unlinkSync(m);
        removed++;
    }
    console.log(`[build] removidos ${removed} mogrts (${(freedBytes/1024/1024).toFixed(1)} MB economizados)`);
}

// 3. Atualiza versão em manifest.xml e config.js
const manifestPath = path.join(STAGE, "CSXS", "manifest.xml");
let manifest = fs.readFileSync(manifestPath, "utf8");
manifest = manifest.replace(/ExtensionBundleVersion="[^"]+"/g, `ExtensionBundleVersion="${VERSION}"`);
manifest = manifest.replace(/<Extension Id="[^"]+" Version="[^"]+"/g, m => m.replace(/Version="[^"]+"$/, `Version="${VERSION}"`));
fs.writeFileSync(manifestPath, manifest, "utf8");
console.log("[build] manifest.xml versão →", VERSION);

const configPath = path.join(STAGE, "js", "config.js");
if (fs.existsSync(configPath)) {
    let cfg = fs.readFileSync(configPath, "utf8");
    cfg = cfg.replace(/version\s*:\s*["'][^"']+["']/g, `version: "${VERSION}"`);
    fs.writeFileSync(configPath, cfg, "utf8");
    console.log("[build] config.js versão →", VERSION);
}

// 4. Obfusca JS
if (!NO_OBFUSCATE) {
    console.log("[build] obfuscando JS…");
    const jsDir = path.join(STAGE, "js");
    execSync(`node "${path.join(REPO, "tools", "obfuscate.js")}" --src "${jsDir}" --profile balanced`, {
        stdio: "inherit"
    });
}

// Inclui INSTALAR.bat / DESINSTALAR.bat / LEIA-ME.html ao nível raiz do ZIP
const installerSrc = path.join(REPO, "installers", "zip-manual-legendas");
for (const f of ["INSTALAR.bat", "DESINSTALAR.bat", "LEIA-ME.html"]) {
    const sp = path.join(installerSrc, f);
    if (fs.existsSync(sp)) {
        fs.copyFileSync(sp, path.join(STAGE_ROOT, f));
        console.log("[build] incluso", f);
    }
}

// 5. Zipa todo o conteúdo de STAGE_ROOT (MotionPro/ + INSTALAR.bat + ...)
console.log("[build] zipando…");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
try { fs.unlinkSync(OUT); } catch (_) {}

const psCmd = `& { Compress-Archive -Path '${STAGE_ROOT.replace(/'/g, "''")}\\*' -DestinationPath '${OUT.replace(/'/g, "''")}' -CompressionLevel Optimal }`;
execSync("powershell -NoProfile -Command \"" + psCmd.replace(/"/g, '\\"') + "\"", { stdio: "inherit" });

const zipSize = fs.statSync(OUT).size;
console.log(`[build] ✅ ${OUT}`);
console.log(`[build]    tamanho: ${(zipSize/1024/1024).toFixed(2)} MB`);

// 6. Limpa
rmrf(STAGE_ROOT);
console.log("[build] limpou staging");
