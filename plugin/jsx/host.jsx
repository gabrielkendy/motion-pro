/* host.jsx — runs inside Premiere Pro's ExtendScript engine.
 * Exposes MotionVault.* functions invoked from the panel via CSInterface.evalScript.
 *
 * Returns JSON-serialized strings (panel parses them). All errors come back as
 * { "error": "..." } so the JS side can show them as toasts.
 */
$.global.MotionVault = (function () {

    function ok(o)  { return JSON.stringify(o == null ? { ok: true } : o); }
    function err(m) { return JSON.stringify({ error: String(m) }); }

    function ping() {
        try {
            return ok({
                ok: true,
                host: (app && app.name) || "?",
                version: (app && app.version) || "?",
                hasProject: !!(app && app.project),
                hasSequence: !!(app && app.project && app.project.activeSequence)
            });
        } catch (e) { return err(e.message); }
    }

    function getActiveSequenceInfo() {
        try {
            if (!app || !app.project) return ok({ hasSequence: false, reason: "no_project" });
            var seq = app.project.activeSequence;
            if (!seq) return ok({ hasSequence: false, reason: "no_sequence" });
            return ok({
                hasSequence: true,
                name: seq.name,
                videoTracks: seq.videoTracks.numTracks,
                audioTracks: seq.audioTracks.numTracks,
                cti: seq.getPlayerPosition().seconds
            });
        } catch (e) { return err(e.message); }
    }

    /* Pick the best video track for inserting the .mogrt.
     * Priority:
     *   1. The first video track that is empty at the playhead, starting from V1.
     *   2. If all are occupied, return -1 (host will keep V1, Premiere stacks above).
     */
    function pickTargetTrack(seq, ticks) {
        try {
            var t = Number(ticks);
            for (var i = 0; i < seq.videoTracks.numTracks; i++) {
                var tr = seq.videoTracks[i];
                if (tr.isLocked && tr.isLocked()) continue;
                if (!isOccupiedAt(tr, t)) return i;
            }
        } catch (e) {}
        return -1;
    }

    function isOccupiedAt(track, t) {
        try {
            for (var i = 0; i < track.clips.numItems; i++) {
                var c = track.clips[i];
                var s = Number(c.start.ticks);
                var e = Number(c.end.ticks);
                if (t >= s && t < e) return true;
            }
            return false;
        } catch (e) { return false; }
    }

    /**
     * Imports a .mogrt onto the active sequence at the current CTI.
     * Returns JSON { ok, track, name } on success or { error } on failure.
     */
    function importMogrt(mogrtPath) {
        try {
            if (!app)                      return err("Premiere Pro indisponível");
            if (!app.project)              return err("Nenhum projeto aberto");
            var seq = app.project.activeSequence;
            if (!seq)                      return err("Abra uma sequência antes de importar");

            var f = new File(mogrtPath);
            if (!f.exists)                 return err("Arquivo não encontrado:\n" + mogrtPath);

            var cti     = seq.getPlayerPosition();
            var ticks   = cti.ticks;
            var pick    = pickTargetTrack(seq, ticks);
            var target  = pick >= 0 ? pick : 0;   // fallback V1 if everything occupied

            // importMGT(path, ticksIn, vidTrackOffset, audTrackOffset)
            var clip = seq.importMGT(f.fsName, String(ticks), target, 0);
            if (!clip) {
                // try once again on V1 in case track index was invalid
                clip = seq.importMGT(f.fsName, String(ticks), 0, 0);
            }
            if (!clip)                     return err("Premiere recusou a importação. Verifique se a versão suporta .mogrt e se a sequência não está bloqueada.");

            // advance CTI to the end of the new clip so successive imports stack in time
            try {
                var dur     = Number(clip.end.ticks) - Number(clip.start.ticks);
                var endStr  = String(Number(ticks) + dur);
                seq.setPlayerPosition(endStr);
            } catch (e) {}

            return ok({ ok: true, track: target, name: clip.name, pickedEmpty: pick >= 0 });
        } catch (e) {
            return err((e && e.message) ? e.message : String(e));
        }
    }

    return {
        ping:                  ping,
        importMogrt:           importMogrt,
        getActiveSequenceInfo: getActiveSequenceInfo
    };
})();
