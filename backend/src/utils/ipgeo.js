"use strict";
/**
 * IP extraction + GeoIP lookup leve.
 *
 * Estratégia: usa ipapi.co free (1k req/dia) só pra IPs NOVOS — cacheamos
 * o resultado por 7 dias em-memória pra evitar gastar quota. Se cache miss
 * E vier rate-limited, retorna {} (não bloqueia o fluxo).
 *
 * Vercel injeta `x-forwarded-for` + `x-vercel-ip-country` + `x-vercel-ip-city`
 * direto. Quando disponíveis, pulamos lookup externo.
 */

const cache = new Map();   // ip → { country, region, city, ts }
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function clientIp(req) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) {
        const first = String(xff).split(",")[0].trim();
        if (first) return first;
    }
    return req.ip || req.connection?.remoteAddress || null;
}

function clientUa(req) {
    return (req.headers["user-agent"] || "").slice(0, 300);
}

async function geoLookup(ip, req) {
    if (!ip) return {};

    // Vercel injeta isso de graça quando deploy é via Vercel
    const vercelCountry = req?.headers?.["x-vercel-ip-country"];
    const vercelRegion  = req?.headers?.["x-vercel-ip-country-region"];
    const vercelCity    = req?.headers?.["x-vercel-ip-city"];
    if (vercelCountry) {
        return {
            country: vercelCountry,
            region:  vercelRegion || null,
            city:    vercelCity ? decodeURIComponent(vercelCity) : null,
        };
    }

    // IPs privados/loopback — sem geo
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|localhost)/.test(ip)) {
        return { country: "LOCAL", region: null, city: null };
    }

    const cached = cache.get(ip);
    if (cached && Date.now() - cached.ts < TTL_MS) {
        return { country: cached.country, region: cached.region, city: cached.city };
    }

    try {
        const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
            signal: AbortSignal.timeout(2500),
        });
        if (!r.ok) return {};
        const j = await r.json();
        const out = {
            country: j.country_code || null,
            region:  j.region || null,
            city:    j.city || null,
        };
        cache.set(ip, { ...out, ts: Date.now() });
        return out;
    } catch {
        return {};
    }
}

function parseUaToOs(ua) {
    if (!ua) return null;
    if (/Windows NT 10/i.test(ua)) return "Windows 10/11";
    if (/Windows/i.test(ua))       return "Windows";
    if (/Mac OS X/i.test(ua))      return "macOS";
    if (/Linux/i.test(ua))         return "Linux";
    if (/CEP\/|Premiere/i.test(ua))return "Adobe CEP";
    return null;
}

module.exports = { clientIp, clientUa, geoLookup, parseUaToOs };
