#!/usr/bin/env node
/**
 * tools/build-zip-titles.js
 *
 * Gera MotionPro-Plugin-<version>.zip (Motion Titles):
 *  1. Copia plugin/ → staging
 *  2. Obfusca JS via tools/obfuscate.js
 *  3. Atualiza versão em CSXS/manifest.xml e config.js
 *  4. Zipa pra landing/installers/MotionPro-Plugin-<version>.zip
 *
 * Templates Titles JÁ vêm do CDN R2 (catalog.json só tem metadados),
 * então não precisa remover MOGRTs.
 *
 * Uso:
 *   node tools/build-zip-titles.js --version 1.1.0
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
const NO_OBFUSCATE = args.includes("--no-obfuscate");
if (!VERSION) { console.error("missing --version"); process.exit(1); }

const REPO = path.resolve(__dirname, "..");
const SRC  = path.join(REPO, "plugin");
const STAGE_ROOT = path.join(require("os").tmpdir(), "mpt-zip-" + Date.now());
const STAGE = path.join(STAGE_ROOT, "MotionPro");
const OUT = path.join(REPO, "landing", "installers", `MotionPro-Plugin-${VERSION}.zip`);

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
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }

console.log("[build] STAGE =", STAGE);
console.log("[build] OUT   =", OUT);

console.log("[build] copiando plugin → staging");
copyDir(SRC, STAGE);

// versão manifest
const manifestPath = path.join(STAGE, "CSXS", "manifest.xml");
if (fs.existsSync(manifestPath)) {
    let manifest = fs.readFileSync(manifestPath, "utf8");
    manifest = manifest.replace(/ExtensionBundleVersion="[^"]+"/g, `ExtensionBundleVersion="${VERSION}"`);
    manifest = manifest.replace(/(<Extension Id="[^"]+" Version=)"[^"]+"/g, `$1"${VERSION}"`);
    fs.writeFileSync(manifestPath, manifest, "utf8");
    console.log("[build] manifest.xml versão →", VERSION);
}

const configPath = path.join(STAGE, "js", "config.js");
if (fs.existsSync(configPath)) {
    let cfg = fs.readFileSync(configPath, "utf8");
    cfg = cfg.replace(/version\s*:\s*["'][^"']+["']/g, `version: "${VERSION}"`);
    fs.writeFileSync(configPath, cfg, "utf8");
}

if (!NO_OBFUSCATE) {
    console.log("[build] obfuscando JS…");
    const jsDir = path.join(STAGE, "js");
    execSync(`node "${path.join(REPO, "tools", "obfuscate.js")}" --src "${jsDir}" --profile balanced`, { stdio: "inherit" });
}

// INSTALAR.bat + DESINSTALAR.bat + LEIA-ME na raiz do ZIP
const installerSrc = path.join(REPO, "installers", "zip-manual");
for (const f of ["INSTALAR.bat", "DESINSTALAR.bat", "LEIA-ME.html"]) {
    const sp = path.join(installerSrc, f);
    if (fs.existsSync(sp)) {
        fs.copyFileSync(sp, path.join(STAGE_ROOT, f));
        console.log("[build] incluso", f);
    }
}

console.log("[build] zipando…");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
try { fs.unlinkSync(OUT); } catch (_) {}

const psCmd = `& { Compress-Archive -Path '${STAGE_ROOT.replace(/'/g, "''")}\\*' -DestinationPath '${OUT.replace(/'/g, "''")}' -CompressionLevel Optimal }`;
execSync("powershell -NoProfile -Command \"" + psCmd.replace(/"/g, '\\"') + "\"", { stdio: "inherit" });

console.log(`[build] ✅ ${OUT}`);
console.log(`[build]    tamanho: ${(fs.statSync(OUT).size/1024/1024).toFixed(2)} MB`);
rmrf(STAGE_ROOT);
