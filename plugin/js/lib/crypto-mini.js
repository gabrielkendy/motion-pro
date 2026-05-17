/* crypto-mini — small helpers around Web Crypto / Node crypto
 * Used for: hardware fingerprint hashing, JWT signature verification (HS256),
 * AES-GCM decryption of locally cached catalog and asset URLs.
 */
const CryptoMini = (function () {
    const subtle = (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    function b64uToBytes(b64u) {
        const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/")
            + "===".slice(0, (4 - b64u.length % 4) % 4);
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    function bytesToB64u(bytes) {
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    async function sha256(str) {
        const buf = await subtle.digest("SHA-256", enc.encode(str));
        return bytesToB64u(new Uint8Array(buf));
    }
    async function hmacSha256(secret, message) {
        const key = await subtle.importKey(
            "raw", enc.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false, ["sign", "verify"]
        );
        const sig = await subtle.sign("HMAC", key, enc.encode(message));
        return bytesToB64u(new Uint8Array(sig));
    }
    async function verifyJWT(token, secret) {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const [h, p, s] = parts;
        const expected = await hmacSha256(secret, h + "." + p);
        if (expected !== s) return null;
        try {
            const payload = JSON.parse(dec.decode(b64uToBytes(p)));
            if (payload.exp && payload.exp * 1000 < Date.now()) return null;
            return payload;
        } catch (e) { return null; }
    }
    async function aesGcmDecrypt(b64uKey, b64uIv, b64uCipher) {
        const key = await subtle.importKey(
            "raw", b64uToBytes(b64uKey),
            { name: "AES-GCM" }, false, ["decrypt"]
        );
        const pt = await subtle.decrypt(
            { name: "AES-GCM", iv: b64uToBytes(b64uIv) },
            key, b64uToBytes(b64uCipher)
        );
        return dec.decode(pt);
    }
    return { sha256, hmacSha256, verifyJWT, aesGcmDecrypt, b64uToBytes, bytesToB64u };
})();
