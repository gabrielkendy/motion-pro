#!/usr/bin/env node
/**
 * Smoke test E2E Motion IA v3.0
 *
 * Verifica em ordem:
 *   1. Sintaxe de TODOS os JS do plugin
 *   2. Sintaxe do host.jsx (ES3-compat via Function ctor)
 *   3. Backend endpoints LIVE (HTTP status esperado)
 *   4. License key flow: gera → ativa → valida → desativa
 *   5. Binários locais existem (ffmpeg, whisper-cli, yt-dlp, aria2c)
 *   6. Modelos Whisper config existem (ou são baixáveis)
 *
 * Rode: node tools/smoke-test-motion-ia.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN = path.join(ROOT, "plugin-ia");
const API = "https://motionpro.vercel.app";

let pass = 0, fail = 0, warn = 0;

function ok(msg)   { console.log("\x1b[32m  ✓\x1b[0m", msg); pass++; }
function err(msg)  { console.log("\x1b[31m  ✗\x1b[0m", msg); fail++; }
function info(msg) { console.log("  ·", msg); }
function head(msg) { console.log("\n\x1b[36m▸ " + msg + "\x1b[0m"); }
function w(msg)    { console.log("\x1b[33m  ⚠\x1b[0m", msg); warn++; }

function httpRequest(opts, body) {
    return new Promise(function (resolve, reject) {
        const u = typeof opts === "string" ? new URL(opts) : opts;
        const reqOpts = typeof opts === "string"
            ? { method: "GET", hostname: u.hostname, path: u.pathname + u.search, port: u.port || 443 }
            : opts;
        const req = https.request(reqOpts, function (res) {
            let chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => {
                resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
            });
        });
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

async function postJSON(path, body, headers) {
    return await httpRequest({
        method: "POST",
        hostname: "motionpro.vercel.app",
        path: path,
        port: 443,
        headers: Object.assign({ "Content-Type": "application/json" }, headers || {})
    }, JSON.stringify(body || {}));
}

async function getJSON(path, headers) {
    return await httpRequest({
        method: "GET",
        hostname: "motionpro.vercel.app",
        path: path,
        port: 443,
        headers: headers || {}
    });
}

async function main() {
    console.log("\x1b[1mMotion IA v3.0 · Smoke Test\x1b[0m");
    console.log("API:", API);

    // ── 1. Sintaxe JS ───────────────────────────────────────────
    head("Sintaxe dos JS do plugin");
    const jsDir = path.join(PLUGIN, "js");
    const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith(".js"));
    for (const f of jsFiles) {
        try {
            new Function(fs.readFileSync(path.join(jsDir, f), "utf8"));
            ok(f);
        } catch (e) {
            err(f + " — " + e.message);
        }
    }

    // ── 2. Sintaxe host.jsx (ES3-friendly check) ────────────────
    head("Sintaxe host.jsx (ES3)");
    try {
        const jsx = fs.readFileSync(path.join(PLUGIN, "jsx/host.jsx"), "utf8");
        new Function(jsx);
        const lines = jsx.split("\n").length;
        ok("host.jsx (" + lines + " linhas)");
        // Detecta ES6+ proibido em ES3
        const es6 = [];
        if (/\s=>\s/.test(jsx)) es6.push("arrow function");
        if (/\bconst\s/.test(jsx)) es6.push("const");
        if (/\blet\s/.test(jsx)) es6.push("let");
        if (es6.length) w("ES6 detectado: " + es6.join(", ") + " (CEP ExtendScript=ES3, pode quebrar)");
        else ok("nenhum ES6 detectado em host.jsx");
    } catch (e) {
        err("host.jsx — " + e.message);
    }

    // ── 3. Binários ──────────────────────────────────────────────
    head("Binários locais bin/win/");
    const requiredBins = ["ffmpeg.exe", "whisper-cli.exe", "yt-dlp.exe", "aria2c.exe", "ffprobe.exe"];
    const binDir = path.join(PLUGIN, "bin/win");
    if (!fs.existsSync(binDir)) {
        err("bin/win NÃO existe — rode tools/download-bin-motion-ia.ps1");
    } else {
        for (const b of requiredBins) {
            const p = path.join(binDir, b);
            if (fs.existsSync(p)) {
                const sz = (fs.statSync(p).size / 1024 / 1024).toFixed(1);
                ok(b + " (" + sz + " MB)");
            } else {
                err(b + " ausente");
            }
        }
    }

    // ── 4. Backend health ────────────────────────────────────────
    head("Backend endpoints");
    const endpoints = [
        { m: "POST", p: "/v1/auth/login",                expect: [400] },
        { m: "POST", p: "/v1/license-keys/activate",     expect: [400] },
        { m: "POST", p: "/v1/license-keys/validate",     expect: [400] },
        { m: "POST", p: "/v1/license-keys/deactivate",   expect: [400] },
        { m: "POST", p: "/v1/license/issue",             expect: [400, 401] },
        { m: "POST", p: "/v1/license/heartbeat",         expect: [400, 401] },
        { m: "GET",  p: "/v1/me/ai-settings",            expect: [401] },
        { m: "POST", p: "/v1/usage/deduct",              expect: [401] },
        { m: "GET",  p: "/v1/usage/balance",             expect: [401] },
    ];
    for (const e of endpoints) {
        try {
            const r = e.m === "POST"
                ? await postJSON(e.p, {})
                : await getJSON(e.p);
            if (e.expect.indexOf(r.status) >= 0) {
                ok(e.m + " " + e.p + " → HTTP " + r.status);
            } else {
                err(e.m + " " + e.p + " → HTTP " + r.status + " (esperado " + e.expect.join("|") + ")");
            }
        } catch (ex) {
            err(e.m + " " + e.p + " — " + ex.message);
        }
    }

    // ── 5. License key flow E2E ──────────────────────────────────
    head("License key flow E2E");
    const loginResp = await postJSON("/v1/auth/login", {
        email: "gabriel.kend@gmail.com", password: "Kendy.123"
    });
    let token = null;
    try { token = JSON.parse(loginResp.body).session_token; } catch (e) {}
    if (!token) { err("login admin falhou"); }
    else {
        ok("login admin OK (" + token.length + " chars)");

        // Gera key teste
        const genResp = await postJSON("/v1/admin/license-keys/generate",
            { tier: "pro", products: ["ia"], max_devices: 5, notes: "smoke" },
            { "Authorization": "Bearer " + token });
        let genKey = null;
        try { genKey = JSON.parse(genResp.body).key; } catch (e) {}
        if (!genKey || !genKey.startsWith("MIA-")) {
            err("generate falhou");
        } else {
            ok("generate OK · " + genKey);

            // Ativa
            const fp = "smoke-fp-" + Date.now();
            const actResp = await postJSON("/v1/license-keys/activate",
                { key: genKey, device_fingerprint: fp, device_name: "smoke" });
            if (actResp.status === 200) ok("activate OK"); else err("activate HTTP " + actResp.status);

            // Valida
            const valResp = await postJSON("/v1/license-keys/validate",
                { key: genKey, device_fingerprint: fp });
            let valJson = {};
            try { valJson = JSON.parse(valResp.body); } catch (e) {}
            if (valJson.active === true) ok("validate active=true · tier=" + valJson.tier);
            else err("validate ativa=" + valJson.active);

            // Desativa
            const deactResp = await postJSON("/v1/license-keys/deactivate",
                { key: genKey, device_fingerprint: fp });
            if (deactResp.status === 200) ok("deactivate OK"); else err("deactivate HTTP " + deactResp.status);
        }
    }

    // ── 6. Manifest + ZIP ────────────────────────────────────────
    head("Build artifacts");
    const manifestPath = path.join(PLUGIN, "CSXS/manifest.xml");
    const TARGET_VER = "3.1.0";
    if (fs.existsSync(manifestPath)) {
        const m = fs.readFileSync(manifestPath, "utf8");
        const versionMatch = m.match(/ExtensionBundleVersion="([^"]+)"/);
        if (versionMatch && versionMatch[1] === TARGET_VER) ok("manifest v" + TARGET_VER);
        else err("manifest version = " + (versionMatch ? versionMatch[1] : "?") + " (esperado " + TARGET_VER + ")");
    }
    const zipPath = path.join(ROOT, "landing/installers/MotionPro-IA-" + TARGET_VER + ".zip");
    if (fs.existsSync(zipPath)) {
        const sz = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
        ok("ZIP v" + TARGET_VER + " (" + sz + " MB)");
    } else {
        w("ZIP v" + TARGET_VER + " ainda não gerado — rode tools/build-zip-ia.js --version " + TARGET_VER);
    }

    // ── 7. Arquivos novos v3.1 ──────────────────────────────────
    head("Arquivos v3.1");
    const newFiles = [
        "plugin-ia/js/face-tracker.js",
        "plugin-ia/js/onboarding-tour.js"
    ];
    for (const f of newFiles) {
        const p = path.join(ROOT, f);
        if (fs.existsSync(p)) ok(f + " (" + (fs.statSync(p).size / 1024).toFixed(1) + " KB)");
        else err(f + " ausente");
    }
    // Carrega skills.js e checa Skills.transitions / Skills.casperDefaults
    try {
        const sk = fs.readFileSync(path.join(PLUGIN, "js/skills.js"), "utf8");
        if (/TRANSITIONS_CATALOG\s*=/.test(sk)) ok("TRANSITIONS_CATALOG presente em skills.js");
        else err("TRANSITIONS_CATALOG ausente em skills.js");
        if (/"casper"\s*:\s*casper/.test(sk)) ok("skill 'casper' registrada");
        else err("skill 'casper' não registrada");
        if (/fetchPixabay/.test(sk) && /fetchGiphy/.test(sk)) ok("Pixabay + Giphy fetchers presentes");
        else err("Pixabay/Giphy fetchers ausentes em skills.js");
    } catch (e) { err("skills.js check fail: " + e.message); }

    // ── RESUMO ───────────────────────────────────────────────────
    console.log("\n\x1b[1mResumo:\x1b[0m");
    console.log("  \x1b[32m" + pass + " passou\x1b[0m");
    if (warn > 0) console.log("  \x1b[33m" + warn + " warnings\x1b[0m");
    if (fail > 0) console.log("  \x1b[31m" + fail + " falhou\x1b[0m");
    else          console.log("  \x1b[32mTUDO PRONTO!\x1b[0m");

    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
    console.error("\n\x1b[31mFATAL: " + e.message + "\x1b[0m");
    process.exit(2);
});
