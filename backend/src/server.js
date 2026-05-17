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

const app = express();

// Stripe webhook needs raw body — register *before* express.json()
app.use("/v1/billing/webhook", express.raw({ type: "application/json" }), billing.webhook);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use("/v1/auth", auth.router);
app.use("/v1/license", license.router);
app.use("/v1/billing", billing.router);
app.use("/v1/me", me.router);
app.use("/v1/catalog", catalog.router);
app.use("/v1/assets", assets.router);

app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "internal_error" });
});

// Local: listen on port. Vercel/serverless: just export the app (no listen).
if (!process.env.VERCEL) {
    const port = Number(process.env.PORT || 8080);
    app.listen(port, () => console.log("MotionVault API on :" + port));
}

module.exports = app;
