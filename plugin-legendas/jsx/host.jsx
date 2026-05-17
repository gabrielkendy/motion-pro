/* host.jsx — MotionPro Legendas
 * Roda dentro do ExtendScript engine do Premiere/AE.
 * Expõe MotionProLegendas.* invocado via CSInterface.evalScript.
 */
$.global.MotionProLegendas = (function () {

    function ok(o)  { return JSON.stringify(o == null ? { ok: true } : o); }
    function err(m) { return JSON.stringify({ error: String(m) }); }

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
                cti: seq.getPlayerPosition().seconds
            });
        } catch (e) { return err(e.message); }
    }

    function isOccupiedAt(track, ticks) {
        try {
            var t = Number(ticks);
            for (var i = 0; i < track.clips.numItems; i++) {
                var c = track.clips[i];
                if (t >= Number(c.start.ticks) && t < Number(c.end.ticks)) return true;
            }
            return false;
        } catch (e) { return true; }
    }

    /**
     * Importa um .mogrt (Motion Graphics Template) no CTI da sequência ativa.
     * Procura primeira track de vídeo VAZIA (default V1) e empilha o título.
     */
    function importMogrt(mogrtPath) {
        try {
            if (!app || !app.project) return err("Projeto não disponível");
            var seq = app.project.activeSequence;
            if (!seq) return err("Abra uma sequência primeiro");

            var f = new File(mogrtPath);
            if (!f.exists) return err("Arquivo não encontrado: " + mogrtPath);

            var cti = seq.getPlayerPosition();
            var ticks = cti.ticks;

            // Acha primeira track de vídeo vazia no CTI (preferindo V2+ pra não atrapalhar vídeo principal)
            var targetTrack = 1;
            for (var i = 1; i < seq.videoTracks.numTracks; i++) {
                if (!isOccupiedAt(seq.videoTracks[i], ticks)) { targetTrack = i; break; }
            }

            var clip = seq.importMGT(f.fsName, ticks, targetTrack, 0);
            if (!clip) return err("Premiere recusou importar o MOGRT");

            try {
                var endTicks = String(Number(ticks) + Number(clip.end.ticks) - Number(clip.start.ticks));
                seq.setPlayerPosition(endTicks);
            } catch (e) {}

            return ok({ ok: true, track: targetTrack, name: clip.name });
        } catch (e) { return err(e.message); }
    }

    /**
     * Importa um arquivo .atom (formato AtomX) — extrai e aplica template.
     * .atom é zip com .mogrt + .json de metadados.
     * Pra simplicidade do MVP: trata como mogrt direto (versão futura faz unzip).
     */
    function importAtom(atomPath) {
        // Por enquanto chama importMogrt. AtomX usa formato proprietário que pode ser
        // expandido depois. Plugin já tem os .mogrts extraídos.
        return importMogrt(atomPath);
    }

    return {
        ping: ping,
        importMogrt: importMogrt,
        importAtom: importAtom,
        getActiveSequenceInfo: getActiveSequenceInfo
    };
})();
