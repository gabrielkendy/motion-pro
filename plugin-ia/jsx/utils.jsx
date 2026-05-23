/* utils.jsx — utilitários ES3 compartilhados entre host.jsx e MIA_* funcs.
 *
 * Agente η · Onda 5 · 2026-05-23
 *
 * ATENÇÃO ES3 STRICT (Premiere [14.0, 99.9]):
 *   · NO let/const, NO arrow funcs, NO template literals
 *   · NO Object.keys, NO Array.prototype.map/forEach/filter/find/includes
 *   · Property names reservados em ES3 PRECISAM ser quoted ("in", "out", "class")
 *   · for/in só lê hasOwnProperty próprio com guarda explícita
 *
 * Carregado via $.evalFile() opcional pelo host.jsx — se ausente, MIA_* funcs
 * têm fallback inline.
 */
$.global.MotionProIAUtils = (function () {

    var TICKS_PER_SECOND = 254016000000;

    /* toSeconds(input, fps)
     *  Converte timecode "HH:MM:SS:FF" ou "MM:SS:FF" ou número/string-número
     *  pra segundos (Number). Sem dependência de Date/Number.parseFloat (mas
     *  parseFloat existe em ES3).
     */
    function toSeconds(input, fps) {
        if (input === null || typeof input === "undefined") return 0;
        if (typeof input === "number") return isFinite(input) ? input : 0;
        var s = String(input);
        // Numérico puro?
        if (s.length > 0 && s.indexOf(":") === -1) {
            var n = parseFloat(s);
            return isFinite(n) ? n : 0;
        }
        // Timecode HH:MM:SS:FF ou MM:SS:FF ou SS:FF
        var parts = s.split(":");
        var f = (typeof fps === "number" && fps > 0) ? fps : 30;
        var hh = 0, mm = 0, ss = 0, ff = 0;
        if (parts.length === 4) {
            hh = parseInt(parts[0], 10) || 0;
            mm = parseInt(parts[1], 10) || 0;
            ss = parseInt(parts[2], 10) || 0;
            ff = parseInt(parts[3], 10) || 0;
        } else if (parts.length === 3) {
            mm = parseInt(parts[0], 10) || 0;
            ss = parseInt(parts[1], 10) || 0;
            ff = parseInt(parts[2], 10) || 0;
        } else if (parts.length === 2) {
            ss = parseInt(parts[0], 10) || 0;
            ff = parseInt(parts[1], 10) || 0;
        } else {
            var nn = parseFloat(s);
            return isFinite(nn) ? nn : 0;
        }
        return hh * 3600 + mm * 60 + ss + (ff / f);
    }

    /* safeJsonStringify(obj)
     *  Wrapper try/catch sobre JSON.stringify. Replacer converte undefined→null
     *  pra evitar drop silencioso de propriedades em ExtendScript onde o
     *  fallback JSON polyfill pode não tratar bem.
     */
    function safeJsonStringify(obj) {
        try {
            return JSON.stringify(obj, function (k, v) {
                if (typeof v === "undefined") return null;
                return v;
            });
        } catch (e) {
            try {
                return JSON.stringify({ error: "stringify_failed: " + (e && e.message ? e.message : "unknown") });
            } catch (e2) {
                return '{"error":"stringify_failed_double"}';
            }
        }
    }

    /* getCti()
     *  Retorna position do CTI em segundos. Tenta seq.getPlayerPosition().seconds;
     *  se .seconds ausente, faz fallback via ticks / TICKS_PER_SECOND.
     */
    function getCti() {
        try {
            if (!app || !app.project) return 0;
            var seq = app.project.activeSequence;
            if (!seq) return 0;
            var pos = null;
            try { pos = seq.getPlayerPosition(); } catch (e) {}
            if (!pos) return 0;
            if (typeof pos.seconds === "number" && isFinite(pos.seconds)) return pos.seconds;
            if (typeof pos.ticks !== "undefined") {
                var t = Number(pos.ticks);
                if (isFinite(t)) return t / TICKS_PER_SECOND;
            }
            // Alguns builds expõem .secondsAsString
            if (typeof pos.secondsAsString === "string") {
                var n = parseFloat(pos.secondsAsString);
                if (isFinite(n)) return n;
            }
            return 0;
        } catch (e) {
            return 0;
        }
    }

    /* findVideoTrack(seq, idx)
     *  Bounds-check accessor. Retorna seq.videoTracks[idx] ou null.
     */
    function findVideoTrack(seq, idx) {
        try {
            if (!seq || !seq.videoTracks) return null;
            var i = Number(idx);
            if (!isFinite(i) || i < 0) return null;
            if (i >= seq.videoTracks.numTracks && i >= seq.videoTracks.length) return null;
            var t = seq.videoTracks[i];
            return t || null;
        } catch (e) {
            return null;
        }
    }

    return {
        toSeconds:          toSeconds,
        safeJsonStringify:  safeJsonStringify,
        getCti:             getCti,
        findVideoTrack:     findVideoTrack,
        TICKS_PER_SECOND:   TICKS_PER_SECOND
    };
})();

$.writeln("[MotionProIAUtils] carregado · " + (new Date()).toString());
