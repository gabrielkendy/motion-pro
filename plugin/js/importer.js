/* importer.js — bridges the panel to the Premiere Pro host via ExtendScript.
 * Calls into jsx/host.jsx exposed functions.
 */
const Importer = (function () {
    const cs = new CSInterface();

    function esc(str) {
        return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }
    function call(fnExpr) {
        return new Promise((resolve, reject) => {
            cs.evalScript(fnExpr, function (res) {
                if (!res || res === "undefined") return resolve(null);
                if (res === "EvalScript error.") return reject(new Error("ExtendScript error"));
                try {
                    const parsed = JSON.parse(res);
                    if (parsed && parsed.error) return reject(new Error(parsed.error));
                    return resolve(parsed);
                } catch (e) { return resolve(res); }
            });
        });
    }

    async function ensureHostLoaded() {
        // host.jsx is auto-loaded via ScriptPath in manifest, but warm it up
        try { return await call("$.global.MotionVault && MotionVault.ping()"); }
        catch (e) { return null; }
    }

    async function importMogrt(absPath) {
        if (!absPath) throw new Error("Caminho do .mogrt vazio");
        const expr = 'MotionVault.importMogrt("' + esc(absPath) + '")';
        return await call(expr);
    }

    async function getActiveSequenceInfo() {
        return await call("MotionVault.getActiveSequenceInfo()");
    }

    return { ensureHostLoaded, importMogrt, getActiveSequenceInfo };
})();
