/* host.jsx — runs inside Premiere Pro's ExtendScript engine.
 * Exposes MotionVault.* functions invoked from the panel via CSInterface.evalScript.
 *
 * Returns JSON-serialized strings (panel parses them). All errors come back as
 * { "error": "..." } so the JS side can show them as toasts.
 */
$.global.MotionVault = (function () {

    function ok(o) { return JSON.stringify(o == null ? { ok: true } : o); }
    function err(msg) { return JSON.stringify({ error: String(msg) }); }

    function ping() {
        return ok({ ok: true, host: app.name, version: app.version });
    }

    function getActiveSequenceInfo() {
        try {
            if (!app || !app.project) return ok({ hasSequence: false });
            var seq = app.project.activeSequence;
            if (!seq) return ok({ hasSequence: false });
            return ok({
                hasSequence: true,
                name: seq.name,
                videoTracks: seq.videoTracks.numTracks,
                audioTracks: seq.audioTracks.numTracks,
                cti: seq.getPlayerPosition().seconds
            });
        } catch (e) { return err(e.message); }
    }

    /**
     * Imports a .mogrt file onto the active sequence at current CTI on V2 (or
     * the first empty track at or above V1).
     */
    function importMogrt(mogrtPath) {
        try {
            if (!app || !app.project) return err("Projeto não disponível");
            var seq = app.project.activeSequence;
            if (!seq) return err("Nenhuma sequência ativa");

            var f = new File(mogrtPath);
            if (!f.exists) return err("Arquivo não encontrado: " + mogrtPath);

            var cti = seq.getPlayerPosition();        // Time obj
            var ticks = cti.ticks;

            // pick a target video track (first one that is empty at CTI, else V1)
            var targetTrack = 0;
            for (var i = 0; i < seq.videoTracks.numTracks; i++) {
                var tr = seq.videoTracks[i];
                if (!isOccupiedAt(tr, ticks)) { targetTrack = i; break; }
            }

            // importMGT signature: (path, ticksIn, vidTrackOffset, audTrackOffset)
            var clip = seq.importMGT(f.fsName, ticks, targetTrack, 0);
            if (!clip) return err("Premiere recusou importar o MOGRT");

            // try to push CTI to end of new clip so successive imports stack
            try {
                var endTicks = String(Number(ticks) + Number(clip.end.ticks) - Number(clip.start.ticks));
                seq.setPlayerPosition(endTicks);
            } catch (e) {}

            return ok({ ok: true, track: targetTrack, name: clip.name });
        } catch (e) { return err(e.message); }
    }

    function isOccupiedAt(track, ticks) {
        try {
            var t = Number(ticks);
            for (var i = 0; i < track.clips.numItems; i++) {
                var c = track.clips[i];
                var s = Number(c.start.ticks);
                var e = Number(c.end.ticks);
                if (t >= s && t < e) return true;
            }
            return false;
        } catch (e) { return true; }
    }

    return {
        ping: ping,
        importMogrt: importMogrt,
        getActiveSequenceInfo: getActiveSequenceInfo
    };
})();
