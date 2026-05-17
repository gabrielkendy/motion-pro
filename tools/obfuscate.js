#!/usr/bin/env node
/* tools/obfuscate.js
 *
 * Wrapper around `javascript-obfuscator` that hardens every panel JS file
 * before shipping. The CEP host loads the obfuscated bundle in place of
 * the source files in /js/ — sources stay in /js-src/ for developer use.
 *
 * Pre-req:  npm i -g javascript-obfuscator
 * Usage:    node obfuscate.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "plugin");
const SRC  = path.join(ROOT, "js");
const DST  = path.join(ROOT, "js-min");

function walk(dir, out) {
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const s = fs.statSync(p);
        if (s.isDirectory()) walk(p, out);
        else if (f.endsWith(".js")) out.push(p);
    }
    return out;
}

const opts = [
    "--compact true",
    "--control-flow-flattening true",
    "--control-flow-flattening-threshold 0.6",
    "--dead-code-injection true",
    "--dead-code-injection-threshold 0.3",
    "--identifier-names-generator hexadecimal",
    "--rename-globals false",
    "--self-defending true",
    "--simplify true",
    "--string-array true",
    "--string-array-encoding rc4",
    "--string-array-threshold 0.75",
    "--transform-object-keys true",
    "--unicode-escape-sequence false"
].join(" ");

fs.rmSync(DST, { recursive: true, force: true });
for (const file of walk(SRC, [])) {
    const rel = path.relative(SRC, file);
    const target = path.join(DST, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (rel.indexOf("lib/") === 0) {
        // libs only minified, not obfuscated (vendor code)
        fs.copyFileSync(file, target);
        continue;
    }
    execSync(`javascript-obfuscator "${file}" --output "${target}" ${opts}`, { stdio: "inherit" });
}
console.log("Hardened bundle in " + DST);
