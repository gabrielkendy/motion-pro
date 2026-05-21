#!/usr/bin/env node
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
// --platform win | mac | all (default: win pra retro-compatibilidade)
const PLATFORM = arg("platform", "win");
if (!VERSION) { console.error("missing --version"); process.exit(1); }
if (!["win", "mac", "all"].includes(PLATFORM)) { console.error("--platform must be win|mac|all"); process.exit(1); }

// Se all → recursivamente roda pra win e mac
if (PLATFORM === "all") {
    console.log("[build-ia] PLATFORM=all → building win + mac em sequência");
    for (const p of ["win", "mac"]) {
        execSync(`node "${__filename}" --version ${VERSION} --platform ${p}${NO_OBFUSCATE ? " --no-obfuscate" : ""}`, { stdio: "inherit" });
    }
    process.exit(0);
}

const REPO = path.resolve(__dirname, "..");
const SRC  = path.join(REPO, "plugin-ia");
const STAGE_ROOT = path.join(require("os").tmpdir(), "mia-zip-" + Date.now());
const STAGE = path.join(STAGE_ROOT, "MotionPro-IA");
// Win mantém nome original (back-compat), Mac vira -mac.zip
const ZIP_NAME = PLATFORM === "win" ? `MotionPro-IA-${VERSION}.zip` : `MotionPro-IA-${VERSION}-${PLATFORM}.zip`;
const OUT = path.join(REPO, "landing", "installers", ZIP_NAME);

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

console.log("[build-ia] STAGE =", STAGE);
console.log("[build-ia] OUT   =", OUT);

copyDir(SRC, STAGE);

// Limpa arquivos dev
const stripDirs = ["TESTAR.md", "TESTAR-AGORA.bat", "CHECKLIST-TESTE.md", "SETUP-PRODUTO-IA.sql", "README.md"];
stripDirs.forEach(f => {
    const p = path.join(STAGE, f);
    if (fs.existsSync(p)) { fs.unlinkSync(p); console.log("[build-ia] removed", f); }
});
// Remove .DISABLED files
function walkAndRemoveDisabled(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) walkAndRemoveDisabled(p);
        else if (f.endsWith(".DISABLED")) { fs.unlinkSync(p); }
    }
}
walkAndRemoveDisabled(STAGE);

// Remove bin/ da plataforma OPOSTA pra reduzir tamanho do ZIP
const otherPlatform = PLATFORM === "win" ? "mac" : "win";
const otherBinDir = path.join(STAGE, "bin", otherPlatform);
if (fs.existsSync(otherBinDir)) {
    rmrf(otherBinDir);
    console.log("[build-ia] removed bin/" + otherPlatform + " (manteve bin/" + PLATFORM + ")");
}

// Atualiza versão manifest
const manifestPath = path.join(STAGE, "CSXS", "manifest.xml");
if (fs.existsSync(manifestPath)) {
    let manifest = fs.readFileSync(manifestPath, "utf8");
    manifest = manifest.replace(/ExtensionBundleVersion="[^"]+"/g, `ExtensionBundleVersion="${VERSION}"`);
    manifest = manifest.replace(/(<Extension Id="[^"]+" Version=)"[^"]+"/g, `$1"${VERSION}"`);
    fs.writeFileSync(manifestPath, manifest, "utf8");
    console.log("[build-ia] manifest.xml versão →", VERSION);
}

if (!NO_OBFUSCATE) {
    console.log("[build-ia] obfuscando JS…");
    const jsDir = path.join(STAGE, "js");
    execSync(`node "${path.join(REPO, "tools", "obfuscate.js")}" --src "${jsDir}" --profile balanced`, { stdio: "inherit" });
}

// Installers + LEIA-ME na raiz do ZIP (escolhe Windows OU macOS)
const installerSrc = path.join(REPO, "installers", "zip-manual-ia");
const installerFiles = PLATFORM === "mac"
    ? ["INSTALAR.command", "DESINSTALAR.command", "LEIA-ME.html"]
    : ["INSTALAR.bat", "DESINSTALAR.bat", "LEIA-ME.html"];
for (const f of installerFiles) {
    const sp = path.join(installerSrc, f);
    if (fs.existsSync(sp)) {
        const dp = path.join(STAGE_ROOT, f);
        fs.copyFileSync(sp, dp);
        // Permissão executável para .command
        if (f.endsWith(".command")) {
            try { fs.chmodSync(dp, 0o755); } catch (_) {}
        }
        console.log("[build-ia] incluso", f);
    }
}

console.log("[build-ia] zipando…");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
try { fs.unlinkSync(OUT); } catch (_) {}
const psCmd = `& { Compress-Archive -Path '${STAGE_ROOT.replace(/'/g, "''")}\\*' -DestinationPath '${OUT.replace(/'/g, "''")}' -CompressionLevel Optimal }`;
execSync("powershell -NoProfile -Command \"" + psCmd.replace(/"/g, '\\"') + "\"", { stdio: "inherit" });

console.log(`[build-ia] ✅ ${OUT}`);
console.log(`[build-ia]    tamanho: ${(fs.statSync(OUT).size/1024/1024).toFixed(2)} MB`);
rmrf(STAGE_ROOT);
