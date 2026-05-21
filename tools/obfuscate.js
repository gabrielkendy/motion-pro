#!/usr/bin/env node
/* tools/obfuscate.js
 *
 * Hardens CEP panel JS files with javascript-obfuscator. Operates IN-PLACE
 * on a staging directory so the source tree (plugin/js, plugin-legendas/js)
 * stays untouched for development.
 *
 * Usage:
 *   node tools/obfuscate.js --src "<path-to-stage>/Motion Titles/js"
 *   node tools/obfuscate.js --src "<path-to-stage>/Motion Titles/js" --profile aggressive
 *
 * Profiles:
 *   balanced    (default) — safe for CEP runtime, ~3x slower startup
 *   aggressive  — control-flow flattening + self-defending, harder to crack
 *
 * Library files under js/lib/ are skipped (vendor code: CSInterface, crypto-mini).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

// ---------- CLI args ----------
const args = process.argv.slice(2);
function arg(name, fallback) {
    const i = args.indexOf("--" + name);
    return i >= 0 ? args[i + 1] : fallback;
}

const SRC = path.resolve(arg("src", ""));
const PROFILE = arg("profile", "balanced");
const VERBOSE = args.includes("--verbose");

if (!SRC || !fs.existsSync(SRC)) {
    console.error("[obfuscate] ERROR: --src missing or path does not exist:", SRC);
    process.exit(1);
}

// ---------- Profiles ----------
const BALANCED = {
    compact: true,
    controlFlowFlattening: false,         // off — too slow on large bundles
    deadCodeInjection: false,             // off — bloats size
    debugProtection: false,               // off — would block Adobe debugger
    disableConsoleOutput: false,
    identifierNamesGenerator: "hexadecimal",
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,                 // CSInterface, MotionVault.* depend on globals
    selfDefending: false,                 // off — can hang CEF rendering thread
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.75,
    transformObjectKeys: false,           // off — some keys are CSS class names
    unicodeEscapeSequence: false,
    target: "browser"
};

const AGGRESSIVE = Object.assign({}, BALANCED, {
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.3,
    selfDefending: true,
    stringArrayEncoding: ["rc4"],
    transformObjectKeys: true
});

const OPTIONS = PROFILE === "aggressive" ? AGGRESSIVE : BALANCED;

// ---------- Reserved identifiers ----------
OPTIONS.reservedNames = [
    "^CSInterface$",
    "^MotionVault$",
    "^MotionPro$",
    "^MPL_",                 // Motion Pro Legendas globals
    "^MP_",                  // Motion Pro Titles globals
    "^EP_",                  // ExtendScript Legendas helpers (EP_ping, etc)
    "^window$",
    "^document$",
    "^require$",             // Node integration
    "^module$",
    "^exports$",
    "^process$",
    "^AssetLoader$"
];

OPTIONS.reservedStrings = [
    "MotionVault\\.",
    "MotionPro\\.",
    "MPL_",
    "MP_",
    "EP_",
    "\\$\\.global"
];

// ---------- Walker ----------
function walk(dir, out) {
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) walk(p, out);
        else if (f.endsWith(".js")) out.push(p);
    }
    return out;
}

// ---------- Run ----------
const files = walk(SRC, []);
let skipped = 0, processed = 0, totalIn = 0, totalOut = 0;

console.log("[obfuscate] profile=" + PROFILE + " src=" + SRC);

for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/");

    // Skip vendor libs
    if (rel.indexOf("lib/") === 0) {
        if (VERBOSE) console.log("  [skip vendor] " + rel);
        skipped++;
        continue;
    }

    const code = fs.readFileSync(file, "utf8");
    const sizeIn = Buffer.byteLength(code, "utf8");
    totalIn += sizeIn;

    try {
        const obf = JavaScriptObfuscator.obfuscate(code, OPTIONS).getObfuscatedCode();
        fs.writeFileSync(file, obf, "utf8");
        const sizeOut = Buffer.byteLength(obf, "utf8");
        totalOut += sizeOut;
        processed++;
        if (VERBOSE) {
            console.log("  [obf] " + rel + "  " + sizeIn + " -> " + sizeOut + " bytes");
        }
    } catch (err) {
        console.error("[obfuscate] FAILED on " + rel + ": " + err.message);
        process.exit(2);
    }
}

const ratio = totalIn > 0 ? (totalOut / totalIn).toFixed(2) : "n/a";
console.log("[obfuscate] done: " + processed + " files obfuscated, " + skipped + " skipped (vendor).");
console.log("[obfuscate] size: " + totalIn + " -> " + totalOut + " bytes (ratio " + ratio + "x)");
