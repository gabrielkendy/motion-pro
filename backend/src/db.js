"use strict";
require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Neon/serverless-friendly: low limits, SSL required, idle timeouts short
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: (process.env.DATABASE_URL || "").indexOf("neon.tech") >= 0
        || (process.env.DATABASE_URL || "").indexOf("sslmode=require") >= 0
        ? { rejectUnauthorized: false }
        : false
});

async function migrate() {
    const dir = path.resolve(__dirname, "..", "migrations");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    for (const f of files) {
        const sql = fs.readFileSync(path.join(dir, f), "utf8");
        console.log("Applying " + f);
        await pool.query(sql);
    }
    console.log("Migrations done.");
}

if (require.main === module && process.argv.includes("--migrate")) {
    migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { pool };
