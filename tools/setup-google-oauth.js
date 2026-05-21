#!/usr/bin/env node
/**
 * setup-google-oauth.js
 *
 * Valida config Google OAuth do Motion IA + imprime instruções step-by-step.
 *
 * Uso:
 *   node tools/setup-google-oauth.js          # imprime guia + valida endpoint live
 *   node tools/setup-google-oauth.js --check  # só valida (CI)
 */
"use strict";
const https = require("https");

const API_BASE = process.env.API_BASE || "https://motionpro.vercel.app";
const LANDING  = process.env.LANDING_BASE || "https://motionpro-lp.vercel.app";

const CHECK_ONLY = process.argv.includes("--check");

function get(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "motion-ia-oauth-check" } }, (res) => {
            let body = "";
            res.on("data", c => body += c);
            res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
        });
        req.on("error", reject);
        req.setTimeout(10000, () => req.destroy(new Error("timeout")));
    });
}

async function checkBackend() {
    console.log("\n[1/3] Testando endpoint backend /v1/oauth/google/start ...");
    const r = await get(`${API_BASE}/v1/oauth/google/start?return_to=${encodeURIComponent(LANDING + "/oauth-bridge.html")}`);
    if (r.status === 302 || r.status === 301) {
        console.log("       ✓ Redirect 302 OK — Google client_id configurado e backend funcional");
        const loc = r.headers.location || "";
        if (loc.includes("accounts.google.com")) {
            console.log("       ✓ Redirect aponta pra Google: " + loc.slice(0, 80) + "...");
        }
        return { ok: true };
    }
    if (r.status === 503) {
        try {
            const j = JSON.parse(r.body);
            if (j.error === "oauth_not_configured") {
                console.log("       ✗ 503 oauth_not_configured — env vars NÃO setadas no Vercel");
                return { ok: false, reason: "missing_env" };
            }
        } catch (_) {}
    }
    console.log(`       ✗ HTTP ${r.status} inesperado: ${r.body.slice(0, 120)}`);
    return { ok: false, reason: "unexpected_" + r.status };
}

async function checkBridgePage() {
    console.log("\n[2/3] Testando página /oauth-bridge.html no landing ...");
    const r = await get(`${LANDING}/oauth-bridge.html`);
    if (r.status === 200 && r.body.includes("Login")) {
        console.log("       ✓ Página existe e renderiza");
        return { ok: true };
    }
    console.log(`       ✗ HTTP ${r.status}`);
    return { ok: false };
}

async function checkCallbackRoute() {
    console.log("\n[3/3] Testando callback /v1/oauth/google/callback ...");
    const r = await get(`${API_BASE}/v1/oauth/google/callback`);
    if (r.status === 400) {
        console.log("       ✓ 400 esperado (sem code/state) — rota acessível");
        return { ok: true };
    }
    console.log(`       ⚠ HTTP ${r.status}`);
    return { ok: false };
}

function printGuide() {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║   GUIA: Configurar Google OAuth para Motion IA (1x setup)     ║
╚════════════════════════════════════════════════════════════════╝

PASSO 1 · Criar OAuth Client no Google Cloud
────────────────────────────────────────────────────────────────
  a) Acesse:    https://console.cloud.google.com/apis/credentials
  b) Selecione ou crie um projeto (ex: "MotionPro")
  c) Clique  "Criar credenciais" → "ID do cliente OAuth"
  d) Tipo de aplicativo:  Aplicativo da Web
  e) Nome:                Motion IA
  f) Origens JS:          https://motionpro.vercel.app
  g) URIs de redirecionamento autorizados:
       https://motionpro.vercel.app/v1/oauth/google/callback
  h) Salvar → copie Client ID e Client Secret

PASSO 2 · Configurar Tela de Consentimento (se primeira vez)
────────────────────────────────────────────────────────────────
  a) Em "OAuth consent screen" → External (publico)
  b) App name:        Motion IA
  c) Logo:            (opcional) upload do logo PacotesFX
  d) Domain:          motionpro.vercel.app
  e) Scopes:          openid, email, profile  (default já cobre)
  f) Publish app:     pode ficar em Testing inicialmente
                      (libera 100 users, depois publish)

PASSO 3 · Setar Env Vars no Vercel
────────────────────────────────────────────────────────────────
  a) Vercel Dashboard → project "motionpro" → Settings
  b) Environment Variables → Add New (todas Production + Preview)
  c) Adicione 4 variáveis:

       OAUTH_GOOGLE_CLIENT_ID       = <copiado do passo 1>
       OAUTH_GOOGLE_CLIENT_SECRET   = <copiado do passo 1>
       OAUTH_REDIRECT_BASE          = https://motionpro.vercel.app
       OAUTH_SUCCESS_URL            = https://motionpro-lp.vercel.app/oauth-bridge.html

PASSO 4 · Redeploy do backend
────────────────────────────────────────────────────────────────
  vercel --prod --cwd backend

PASSO 5 · Validar
────────────────────────────────────────────────────────────────
  node tools/setup-google-oauth.js --check

  Você deve ver os 3 checks ✓ (backend redirect 302 + bridge 200 + callback 400)

PASSO 6 · Testar fluxo end-to-end
────────────────────────────────────────────────────────────────
  a) Abra Motion IA no Premiere → tela de login
  b) Clique "Continuar com Google"
  c) Browser abre → escolha conta Google
  d) Redireciona pra /oauth-bridge.html com JWT
  e) Copie código → volte ao Premiere → "Tenho código" → cole → Entrar
  f) Pronto. Próxima vez não precisa repetir (session sticky 30d)
`);
}

async function main() {
    if (!CHECK_ONLY) printGuide();

    console.log("\n────────────── VALIDAÇÃO LIVE ──────────────");
    const results = await Promise.all([
        checkBackend(),
        checkBridgePage(),
        checkCallbackRoute()
    ]);

    const allOk = results.every(r => r.ok);
    console.log("\n──────────────────────────────────────────────");
    if (allOk) {
        console.log("✅ Tudo configurado! Google OAuth está LIVE.");
        process.exit(0);
    } else {
        console.log("⚠️  Configuração incompleta.");
        if (results[0].reason === "missing_env") {
            console.log("   → Falta setar OAUTH_GOOGLE_CLIENT_ID + SECRET no Vercel (passo 3).");
        }
        process.exit(1);
    }
}

main().catch(e => {
    console.error("[FATAL]", e.message);
    process.exit(2);
});
