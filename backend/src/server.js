"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const auth = require("./routes/auth");
const license = require("./routes/license");
const billing = require("./routes/billing");
const me = require("./routes/me");
const catalog = require("./routes/catalog");
const assets = require("./routes/assets");
const admin = require("./routes/admin");

const app = express();

// Vercel está atrás de proxy — confiar no X-Forwarded-For pra rate limit por IP funcionar
app.set("trust proxy", 1);

// Stripe webhook needs raw body — register *before* express.json()
app.use("/v1/billing/webhook", express.raw({ type: "application/json" }), billing.webhook);

// Helmet: configurado pra API pública (sem CSP/COOP/CORP que bloqueariam browsers cross-origin)
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
    referrerPolicy: { policy: "no-referrer-when-downgrade" }
}));
app.use(cors({
    origin: true,            // reflete o Origin do request
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400
}));
app.use(express.json({ limit: "1mb" }));

// === RATE LIMITERS ===
// Global: 300/min — generoso pra plugin/dashboard normais
const globalLimiter = rateLimit({
    windowMs: 60_000, max: 300,
    standardHeaders: true, legacyHeaders: false,
    message: { error: "rate_limit_exceeded" }
});
// Auth (login/signup): brute-force protection — 10 tentativas/min por IP
const authLimiter = rateLimit({
    windowMs: 60_000, max: 10,
    standardHeaders: true, legacyHeaders: false,
    message: { error: "too_many_auth_attempts" },
    skipSuccessfulRequests: true        // sucessos não contam (só falhas brute-force)
});
// Forgot password: 3 tentativas / 15 min — evita email bombing
const forgotLimiter = rateLimit({
    windowMs: 15 * 60_000, max: 3,
    standardHeaders: true, legacyHeaders: false,
    message: { error: "too_many_password_requests" }
});

app.use(globalLimiter);
app.use("/v1/auth/login",  authLimiter);
app.use("/v1/auth/signup", authLimiter);
app.use("/v1/auth/forgot-password", forgotLimiter);

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use("/v1/auth", auth.router);
app.use("/v1/license", license.router);
app.use("/v1/billing", billing.router);
app.use("/v1/me", me.router);
app.use("/v1/catalog", catalog.router);
app.use("/v1/assets", assets.router);
app.use("/v1/admin", admin.router);

// Error handler: NÃO loga senhas, tokens nem PII completa
app.use((err, req, res, _next) => {
    const safe = {
        msg: err.message || "internal_error",
        code: err.code,
        path: req.path,
        method: req.method
    };
    console.error("[error]", safe);
    res.status(err.status || 500).json({ error: err.message || "internal_error" });
});

// Local: listen on port. Vercel/serverless: just export the app (no listen).
if (!process.env.VERCEL) {
    const port = Number(process.env.PORT || 8080);
    app.listen(port, () => console.log("MotionVault API on :" + port));
}

module.exports = app;
