/* host.jsx — MotionPro Legendas v3.3
 * ExtendScript do Premiere Pro
 * Funções:
 *   - importMogrt(path)                          → aplica 1 template no CTI
 *   - applySrtBatch(mogrtPath, blocks, opts)     → percorre SRT e cria todos os títulos
 *   - readActiveCaptions()                       → lê captions/transcript do Premiere e devolve como SRT
 *   - importAudioFile(path, ticks, audioTrack)   → coloca SFX/áudio na timeline
 *   - getActiveSequenceInfo / ping
 */
$.global.MotionProLegendas = (function () {

    function ok(o)  { return JSON.stringify(o == null ? { ok: true } : o); }
    function err(m) { return JSON.stringify({ error: String(m) }); }
    function trim(s){ return String(s||"").replace(/^\s+|\s+$/g,""); }

    var TICKS_PER_SECOND = 254016000000; // Premiere ticks/sec (constante oficial)

    function ping() {
        return ok({ ok: true, host: app.name, version: app.version });
    }

    function getActiveSequenceInfo() {
        try {
            if (!app || !app.project) return ok({ hasSequence: false });
            var seq = app.project.activeSequence;
            if (!seq) return ok({ hasSequence: false });
            var info = {
                hasSequence: true,
                name: seq.name,
                videoTracks: seq.videoTracks.numTracks,
                audioTracks: seq.audioTracks.numTracks,
                cti: seq.getPlayerPosition().seconds
            };
            try { info.hasCaptions = !!(seq.captionTracks && seq.captionTracks.numTracks > 0); } catch (e) { info.hasCaptions = false; }
            return ok(info);
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

    // Escolhe track de vídeo destino
    function pickTargetTrack(seq, mode, ticks) {
        var n = seq.videoTracks.numTracks;
        if (mode === "new") return n; // forçará createNewTrack (não suportado direto; fallback last)
        if (mode === "last") return n - 1;
        if (/^V(\d+)$/.test(mode)) {
            var idx = Number(mode.replace("V", "")) - 1;
            if (idx >= 0 && idx < n) return idx;
        }
        // fallback: primeira vazia a partir de V2
        for (var i = 1; i < n; i++) {
            if (!isOccupiedAt(seq.videoTracks[i], ticks)) return i;
        }
        return n - 1;
    }

    // Importa 1 mogrt no CTI da sequência ativa
    function importMogrt(mogrtPath) {
        try {
            if (!app || !app.project) return err("Projeto não disponível");
            var seq = app.project.activeSequence;
            if (!seq) return err("Abra uma sequência primeiro");

            var f = new File(mogrtPath);
            if (!f.exists) return err("Arquivo não encontrado: " + mogrtPath);

            var cti = seq.getPlayerPosition();
            var ticks = String(cti.ticks);
            var targetTrack = pickTargetTrack(seq, "auto", ticks);

            var clip = seq.importMGT(f.fsName, ticks, targetTrack, 0);
            if (!clip) return err("Premiere recusou importar o MOGRT");

            try {
                var endTicks = String(Number(ticks) + (Number(clip.end.ticks) - Number(clip.start.ticks)));
                seq.setPlayerPosition(endTicks);
            } catch (e) {}

            return ok({ ok: true, track: targetTrack, name: clip.name });
        } catch (e) { return err(e.message); }
    }

    /**
     * applySrtBatch — percorre SRT, cria 1 título por bloco no MOGRT escolhido,
     * substitui texto pelo conteúdo do bloco. Tudo numa undo group.
     *
     * params:
     *   mogrtPath: string
     *   blocksJson: JSON string com [{start: seconds, end: seconds, text: "..."}]
     *   optsJson: JSON string com { trackMode: "V2"|"last"|..., disableOriginals: bool }
     */
    function applySrtBatch(mogrtPath, blocksJson, optsJson) {
        try {
            if (!app || !app.project) return err("Projeto não disponível");
            var seq = app.project.activeSequence;
            if (!seq) return err("Abra uma sequência primeiro");

            var f = new File(mogrtPath);
            if (!f.exists) return err("MOGRT não encontrado: " + mogrtPath);

            var blocks; try { blocks = JSON.parse(blocksJson); } catch (e) { return err("blocks inválido"); }
            var opts;   try { opts = JSON.parse(optsJson||"{}"); } catch (e) { opts = {}; }
            if (!blocks || !blocks.length) return err("Nenhum bloco SRT");

            var trackMode = opts.trackMode || "last";
            var firstTicks = String(Math.round(Number(blocks[0].start) * TICKS_PER_SECOND));
            var targetTrack = pickTargetTrack(seq, trackMode, firstTicks);
            var vt = seq.videoTracks[targetTrack];

            app.enableQE && app.enableQE();
            // undo group
            try { app.beginUndoGroup && app.beginUndoGroup("MotionPro Legendas · SRT batch"); } catch (e) {}

            var applied = 0, skipped = 0, errors = [];
            for (var i = 0; i < blocks.length; i++) {
                var b = blocks[i];
                var startTicks = String(Math.round(Number(b.start) * TICKS_PER_SECOND));
                try {
                    var clip = seq.importMGT(f.fsName, startTicks, targetTrack, 0);
                    if (!clip) { skipped++; continue; }

                    // trim end conforme duração do bloco SRT
                    try {
                        var durSec = Math.max(0.4, Number(b.end) - Number(b.start));
                        var endTicks = String(Math.round((Number(b.start) + durSec) * TICKS_PER_SECOND));
                        clip.end = { ticks: endTicks };
                    } catch (e2) {}

                    // troca texto do MOGRT via componentParams
                    try { setMogrtText(clip, b.text); } catch (e3) { errors.push(String(e3)); }

                    applied++;
                } catch (eClip) {
                    errors.push("bloco " + (i+1) + ": " + eClip.message);
                    skipped++;
                }
            }

            try { app.endUndoGroup && app.endUndoGroup(); } catch (e) {}

            return ok({ ok: true, applied: applied, skipped: skipped, track: targetTrack, errors: errors.slice(0, 5) });
        } catch (e) { return err(e.message); }
    }

    /**
     * Troca o texto editável dentro de um MOGRT já importado.
     * Procura o primeiro componente "AE.ADBE Text" ou propriedade "Source Text".
     */
    function setMogrtText(clip, newText) {
        var t = String(newText || "");
        // 1) tenta a API moderna do MOGRT (Premiere 2022+)
        try {
            var mc = clip.getMGTComponent && clip.getMGTComponent();
            if (mc && mc.properties) {
                for (var i = 0; i < mc.properties.numItems; i++) {
                    var p = mc.properties[i];
                    var dn = (p.displayName || "").toLowerCase();
                    if (dn.indexOf("text") >= 0 || dn.indexOf("texto") >= 0) {
                        try { p.setValue(t, true); return true; } catch (e) {}
                    }
                }
            }
        } catch (e) {}
        // 2) fallback: percorre todos os components procurando text properties
        try {
            var comps = clip.components;
            if (!comps) return false;
            for (var c = 0; c < comps.numItems; c++) {
                var comp = comps[c];
                if (!comp.properties) continue;
                for (var pi = 0; pi < comp.properties.numItems; pi++) {
                    var pp = comp.properties[pi];
                    var nm = (pp.displayName || pp.name || "").toLowerCase();
                    if (nm.indexOf("source text") >= 0 || nm === "text" || nm === "texto") {
                        try { pp.setValue(t, true); return true; } catch (e2) {}
                    }
                }
            }
        } catch (e3) {}
        return false;
    }

    /**
     * Lê captions da sequência ativa (se Premiere já transcreveu) e devolve
     * como array no formato SRT_DATA do plugin: [{start, end, text}, ...].
     */
    function readActiveCaptions() {
        try {
            if (!app || !app.project) return err("Projeto não disponível");
            var seq = app.project.activeSequence;
            if (!seq) return err("Abra uma sequência primeiro");
            if (!seq.captionTracks || seq.captionTracks.numTracks === 0) {
                return err("Esta sequência não tem captions. No Premiere: Window → Text → Transcript → Create transcription, depois Caption.");
            }
            var out = [];
            for (var t = 0; t < seq.captionTracks.numTracks; t++) {
                var ct = seq.captionTracks[t];
                if (!ct || !ct.captions) continue;
                for (var i = 0; i < ct.captions.length; i++) {
                    var c = ct.captions[i];
                    var startSec, endSec, txt;
                    try { startSec = Number(c.start.seconds); } catch (e) { startSec = 0; }
                    try { endSec   = Number(c.end.seconds); }   catch (e) { endSec   = startSec + 1; }
                    try { txt = String(c.text || ""); } catch (e) { txt = ""; }
                    if (txt) out.push({ start: startSec, end: endSec, text: txt });
                }
            }
            if (!out.length) return err("Captions vazias");
            return ok({ ok: true, blocks: out });
        } catch (e) { return err(e.message); }
    }

    /**
     * Importa um arquivo de áudio (SFX) na timeline na audio track escolhida,
     * em N posições (ticks). Útil pra colar SFX nos starts de cada bloco SRT.
     */
    function importAudioFile(audioPath, positionsJson, audioTrackName) {
        try {
            if (!app || !app.project) return err("Projeto não disponível");
            var seq = app.project.activeSequence;
            if (!seq) return err("Abra uma sequência primeiro");
            var f = new File(audioPath);
            if (!f.exists) return err("Áudio não encontrado: " + audioPath);

            var positions; try { positions = JSON.parse(positionsJson); } catch (e) { return err("positions inválido"); }
            if (!positions || !positions.length) positions = [seq.getPlayerPosition().ticks];

            var trackIdx = 1; // A2 default
            if (/^A(\d+)$/.test(audioTrackName)) {
                trackIdx = Number(audioTrackName.replace("A", "")) - 1;
            }
            if (trackIdx < 0 || trackIdx >= seq.audioTracks.numTracks) trackIdx = Math.min(1, seq.audioTracks.numTracks - 1);
            var at = seq.audioTracks[trackIdx];

            // importa no project bin (se ainda não estiver)
            var item = null;
            try {
                app.project.importFiles([f.fsName], false, app.project.rootItem, false);
                item = app.project.rootItem.children[app.project.rootItem.children.numItems - 1];
            } catch (e) {}
            if (!item) return err("Falha ao importar SFX");

            var placed = 0;
            for (var i = 0; i < positions.length; i++) {
                try {
                    at.insertClip(item, String(positions[i]));
                    placed++;
                } catch (e2) {}
            }
            return ok({ ok: true, placed: placed, track: "A" + (trackIdx + 1) });
        } catch (e) { return err(e.message); }
    }

    function importAtom(atomPath) { return importMogrt(atomPath); }

    return {
        ping: ping,
        importMogrt: importMogrt,
        importAtom: importAtom,
        applySrtBatch: applySrtBatch,
        readActiveCaptions: readActiveCaptions,
        importAudioFile: importAudioFile,
        getActiveSequenceInfo: getActiveSequenceInfo
    };
})();
