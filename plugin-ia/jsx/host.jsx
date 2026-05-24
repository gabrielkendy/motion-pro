/* host.jsx — MotionPro IA
 *
 * Roda dentro do ExtendScript do Premiere Pro. Expõe MotionProIA.* invocado
 * via CSInterface.evalScript pelo painel.
 *
 * Funções core (todas retornam JSON string):
 *   ping()                                  → { ok, host, version }
 *   getActiveSequenceInfo()                 → { hasSequence, name, fps, tracks, cti, ... }
 *   listTimelineClips()                     → { clips: [{ id, name, track, ... }] }
 *   getSelectedMediaPath()                  → { path, basename } | { error }
 *   importAndInsert(path, opts)             → importa media e insere na timeline
 *   addCutsAtSeconds([sec, sec, ...])       → razor em todas as tracks nos timestamps
 *   deleteRanges([[startSec, endSec], ...]) → ripple-delete sincronizado
 *   muteAudioRanges([[startSec, endSec]])   → silencia trechos sem cortar
 *   setCti(sec)                             → move o cursor
 *   selectClipsByName(needle)               → seleciona clips por substring
 *
 * Filosofia: defensiva. Sempre retorna {error} em vez de estourar.
 */
$.global.MotionProIA = (function () {

    // ─── compat JSON pra ExtendScript ────────────────────────────────────────
    if (typeof JSON === "undefined") JSON = {};
    if (typeof JSON.stringify !== "function") {
        JSON.stringify = function (obj) {
            var t = typeof obj;
            if (obj === null || obj === undefined) return "null";
            if (t === "string") return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
            if (t === "number") return isFinite(obj) ? String(obj) : "null";
            if (t === "boolean") return String(obj);
            if (obj instanceof Array) {
                var out = [];
                for (var i = 0; i < obj.length; i++) out.push(JSON.stringify(obj[i]));
                return "[" + out.join(",") + "]";
            }
            if (t === "object") {
                var props = [];
                for (var k in obj) if (obj.hasOwnProperty(k)) {
                    props.push(JSON.stringify(k) + ":" + JSON.stringify(obj[k]));
                }
                return "{" + props.join(",") + "}";
            }
            return "null";
        };
    }

    function ok(o)  { return JSON.stringify(o == null ? { ok: true } : o); }
    function err(m) { return JSON.stringify({ error: String(m) }); }

    function safeBasename(p) {
        if (!p) return "";
        var s = String(p).replace(/\\/g, "/");
        var i = s.lastIndexOf("/");
        return i >= 0 ? s.substring(i + 1) : s;
    }

    // Premiere usa ticks por segundo = 254016000000 (constante TICKS_PER_SECOND)
    var TPS = 254016000000;
    function secondsToTicks(sec) { return String(Math.round(Number(sec) * TPS)); }
    function ticksToSeconds(ticks) { return Number(ticks) / TPS; }

    function getSeq() {
        if (!app || !app.project) return null;
        return app.project.activeSequence || null;
    }

    function getFps(seq) {
        try {
            if (seq && seq.getSettings) {
                var s = seq.getSettings();
                if (s && s.videoFrameRate && s.videoFrameRate.ticks) {
                    var t = Number(s.videoFrameRate.ticks);
                    if (t > 0) return TPS / t;
                }
            }
        } catch (e) {}
        return 30;
    }

    function _secToTC(sec, seq) {
        var fps = getFps(seq);
        if (!isFinite(fps) || fps <= 0) fps = 30;
        var fpsInt = Math.round(fps);
        var totalFrames = Math.max(0, Math.floor(Number(sec) * fps));
        var h = Math.floor(totalFrames / (3600 * fpsInt));
        var m = Math.floor((totalFrames / (60 * fpsInt)) % 60);
        var s = Math.floor((totalFrames / fpsInt) % 60);
        var f = Math.floor(totalFrames % fpsInt);
        function p2(n) { return n < 10 ? "0" + n : "" + n; }
        return p2(h) + ":" + p2(m) + ":" + p2(s) + ":" + p2(f);
    }

    function ensureQE() {
        if (typeof qe !== "undefined" && qe && qe.project) return true;
        try { app.enableQE(); } catch (e1) {}
        return (typeof qe !== "undefined" && qe && qe.project);
    }

    // ────────────────────────────────────────────────────────────────────────
    function ping() {
        return ok({
            ok: true,
            host: (app && app.appName) ? app.appName : "Premiere Pro",
            version: (app && app.version) ? app.version : "?",
            qeAvailable: ensureQE()
        });
    }

    // ────────────────────────────────────────────────────────────────────────
    function getActiveSequenceInfo() {
        try {
            var seq = getSeq();
            if (!seq) return ok({ hasSequence: false });
            return ok({
                hasSequence: true,
                name: seq.name,
                fps: getFps(seq),
                videoTracks: seq.videoTracks.numTracks,
                audioTracks: seq.audioTracks.numTracks,
                cti: seq.getPlayerPosition().seconds,
                durationSeconds: seq.end ? ticksToSeconds(seq.end.ticks) : 0,
                projectPath: app.project.path || ""
            });
        } catch (e) { return err(e.message); }
    }

    // ────────────────────────────────────────────────────────────────────────
    function listTimelineClips() {
        try {
            var seq = getSeq();
            if (!seq) return err("Abra uma sequência no Premiere primeiro");

            var clips = [];
            var clipId = 0;
            var totalVideo = 0, totalAudio = 0;

            function scanTrack(track, idx, kind) {
                for (var i = 0; i < track.clips.numItems; i++) {
                    var c = track.clips[i];
                    var mediaPath = "", mediaName = "";
                    try {
                        if (c.projectItem) {
                            mediaName = c.projectItem.name || "";
                            if (c.projectItem.getMediaPath) mediaPath = c.projectItem.getMediaPath() || "";
                        }
                    } catch (eMp) {}
                    var sStart = ticksToSeconds(c.start.ticks);
                    var sEnd   = ticksToSeconds(c.end.ticks);
                    clips.push({
                        id: ++clipId,
                        name: c.name || mediaName,
                        track: idx + 1,
                        trackType: kind,
                        start: sStart,
                        end:   sEnd,
                        duration: sEnd - sStart,
                        mediaPath: mediaPath,
                        mediaName: mediaName,
                        isSelected: (c.isSelected ? c.isSelected() : false),
                        isDisabled: !!c.disabled
                    });
                    if (kind === "video") totalVideo++; else totalAudio++;
                }
            }

            for (var v = 0; v < seq.videoTracks.numTracks; v++) scanTrack(seq.videoTracks[v], v, "video");
            for (var a = 0; a < seq.audioTracks.numTracks; a++) scanTrack(seq.audioTracks[a], a, "audio");

            return ok({
                sequenceName: seq.name,
                fps: getFps(seq),
                cti: seq.getPlayerPosition().seconds,
                durationSeconds: seq.end ? ticksToSeconds(seq.end.ticks) : 0,
                totals: { video: totalVideo, audio: totalAudio, all: clips.length },
                clips: clips
            });
        } catch (e) { return err(e.message); }
    }

    // ────────────────────────────────────────────────────────────────────────
    function getSelectedMediaPath() {
        try {
            if (!app || !app.project) return err("Nenhum projeto aberto");
            var path = null, mediaName = null;

            try {
                var sel = app.project.getSelection ? app.project.getSelection() : null;
                if (sel && sel.length) {
                    for (var i = 0; i < sel.length; i++) {
                        var it = sel[i];
                        if (it && it.getMediaPath) {
                            var mp = it.getMediaPath();
                            if (mp) { path = mp; mediaName = it.name; break; }
                        }
                    }
                }
            } catch (e1) {}

            if (!path) {
                var seq = getSeq();
                if (seq) {
                    for (var t = 0; t < seq.videoTracks.numTracks && !path; t++) {
                        var trClips = seq.videoTracks[t].clips;
                        for (var c = 0; c < trClips.numItems; c++) {
                            var clip = trClips[c];
                            if (clip && clip.isSelected && clip.isSelected() && clip.projectItem) {
                                var mp2 = clip.projectItem.getMediaPath();
                                if (mp2) { path = mp2; mediaName = clip.projectItem.name; break; }
                            }
                        }
                    }
                    if (!path && seq.videoTracks.numTracks > 0) {
                        var first = seq.videoTracks[0].clips;
                        if (first.numItems > 0 && first[0].projectItem) {
                            path = first[0].projectItem.getMediaPath();
                            mediaName = first[0].projectItem.name;
                        }
                    }
                }
            }

            if (!path) return err("Nenhum clip selecionado. Selecione um clip na timeline ou no Project Panel.");
            return ok({ path: path, basename: safeBasename(path), mediaName: mediaName });
        } catch (e) { return err(e.message); }
    }

    // Retorna o timing do clip selecionado pra mapear tempo-do-arquivo → tempo-da-timeline.
    // Sem isso, cortes calculados sobre o arquivo (ffmpeg/whisper) erram a posição quando
    // o clip não começa em 00:00 da timeline ou tem in-point (trecho aparado).
    //   timelineStart = onde o clip começa na sequência (s)
    //   inPoint       = quanto do início do arquivo foi aparado (s)
    //   outPoint      = fim do trecho usado, no arquivo (s)
    // Mapeamento: timelineTime = timelineStart + (fileTime - inPoint)
    function getSelectedClipTiming() {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            var found = null;
            // procura clip selecionado em video tracks; fallback pro primeiro clip
            for (var t = 0; t < seq.videoTracks.numTracks && !found; t++) {
                var clips = seq.videoTracks[t].clips;
                for (var c = 0; c < clips.numItems; c++) {
                    var cl = clips[c];
                    if (cl && cl.isSelected && cl.isSelected()) { found = cl; break; }
                }
            }
            if (!found && seq.videoTracks.numTracks > 0 && seq.videoTracks[0].clips.numItems > 0) {
                found = seq.videoTracks[0].clips[0];
            }
            if (!found) return err("Nenhum clip na timeline");

            var timelineStart = ticksToSeconds(found.start.ticks);
            var timelineEnd   = ticksToSeconds(found.end.ticks);
            var inPoint = 0, outPoint = timelineEnd - timelineStart;
            try { if (found.inPoint  && found.inPoint.ticks  != null) inPoint  = ticksToSeconds(found.inPoint.ticks); } catch (eIn) {}
            try { if (found.outPoint && found.outPoint.ticks != null) outPoint = ticksToSeconds(found.outPoint.ticks); } catch (eOut) {}

            return ok({
                timelineStart: timelineStart,
                timelineEnd:   timelineEnd,
                inPoint:       inPoint,
                outPoint:      outPoint,
                clipDuration:  timelineEnd - timelineStart,
                name:          found.name || null
            });
        } catch (e) { return err(e.message); }
    }

    // ────────────────────────────────────────────────────────────────────────
    function importAndInsert(filePath, opts) {
        try {
            if (!app || !app.project) return err("Sem projeto aberto");
            if (!filePath) return err("filePath ausente");
            opts = opts || {};

            var f = new File(filePath);
            if (!f.exists) return err("Arquivo não encontrado: " + filePath);

            var root = app.project.rootItem;
            var binName = "MotionPro IA";
            var bin = null;
            for (var i = 0; i < root.children.numItems; i++) {
                var ch = root.children[i];
                if (ch && ch.name === binName && ch.type === 2) { bin = ch; break; }
            }
            if (!bin) bin = root.createBin(binName);

            var before = {};
            for (var b = 0; b < bin.children.numItems; b++) {
                var x = bin.children[b];
                if (x && x.nodeId) before[x.nodeId] = true;
            }

            var imported = app.project.importFiles([f.fsName], true, bin, false);
            if (!imported) return err("importFiles retornou false");

            var newItem = null;
            for (var k = 0; k < bin.children.numItems; k++) {
                var cur = bin.children[k];
                if (cur && cur.nodeId && !before[cur.nodeId]) { newItem = cur; break; }
            }
            if (!newItem && bin.children.numItems > 0) newItem = bin.children[bin.children.numItems - 1];

            var inserted = false, insertedAt = null;
            if (opts.insert && newItem) {
                var seq = getSeq();
                if (seq) {
                    var trackIdx = Number(opts.track || 0);
                    var isAudio = (opts.kind === "audio");
                    var trackArr = isAudio ? seq.audioTracks : seq.videoTracks;
                    if (trackIdx >= trackArr.numTracks) trackIdx = trackArr.numTracks - 1;
                    var tr = trackArr[trackIdx];

                    var pos = (opts.positionSec != null)
                        ? secondsToTicks(opts.positionSec)
                        : seq.getPlayerPosition().ticks;
                    try {
                        if (tr.overwriteClip) { tr.overwriteClip(newItem, pos); inserted = true; insertedAt = ticksToSeconds(pos); }
                        else if (tr.insertClip) { tr.insertClip(newItem, pos); inserted = true; insertedAt = ticksToSeconds(pos); }
                    } catch (eIns) {}
                }
            }

            return ok({
                imported: true, inserted: inserted, insertedAt: insertedAt,
                binName: binName, itemName: newItem ? newItem.name : null
            });
        } catch (e) { return err(e.message); }
    }

    // ────────────────────────────────────────────────────────────────────────
    // _razorAt(seq, sec) → faz razor em TODAS as tracks de vídeo e áudio
    // Estratégia: usa QE.getVideoTrackAt(i).razor(tc) por track — mais
    // confiável que qeSeq.razor() global que falha em algumas builds.
    // ────────────────────────────────────────────────────────────────────────
    function _razorAt(seq, sec) {
        if (!ensureQE()) return false;
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) return false;
        var tc = _secToTC(sec, seq);
        var cut = false;

        // Vídeo
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            try {
                var qv = qeSeq.getVideoTrackAt(v);
                if (qv && qv.razor) { qv.razor(tc); cut = true; }
            } catch (eV) {}
        }
        // Áudio
        for (var a = 0; a < seq.audioTracks.numTracks; a++) {
            try {
                var qa = qeSeq.getAudioTrackAt(a);
                if (qa && qa.razor) { qa.razor(tc); cut = true; }
            } catch (eA) {}
        }
        // Fallback: tenta o razor global (assinatura varia entre builds)
        if (!cut) {
            try { qeSeq.razor(tc); cut = true; } catch (eG) {}
        }
        return cut;
    }

    function addCutsAtSeconds(secondsArray) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            if (!secondsArray || !secondsArray.length) return err("Lista de cortes vazia");
            if (!ensureQE()) return err("QE DOM indisponível. Premiere muito antigo ou bloqueado.");

            var cuts = 0;
            // ordena pra evitar problemas de ordem
            var sorted = secondsArray.slice().sort(function (a, b) { return Number(a) - Number(b); });
            for (var i = 0; i < sorted.length; i++) {
                var sec = Number(sorted[i]);
                if (!isFinite(sec) || sec < 0) continue;
                if (_razorAt(seq, sec)) cuts++;
            }
            return ok({ cuts: cuts, requested: secondsArray.length });
        } catch (e) { return err(e.message); }
    }

    // ────────────────────────────────────────────────────────────────────────
    // deleteRanges → corta silêncios COM ripple-shift sincronizado.
    //
    // Processa do FIM pro INÍCIO. Pra cada [startSec, endSec]:
    //   1. razor em startSec e endSec (todas as tracks)
    //   2. remove clips que ficam totalmente dentro de [startSec, endSec]
    //   3. shift left por (endSec - startSec) tudo que está depois de endSec
    //      em TODAS as tracks de vídeo e áudio
    // Resultado: silêncio sumiu, timeline encurta uniformemente.
    // ────────────────────────────────────────────────────────────────────────
    function deleteRanges(rangesArray) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            if (!rangesArray || !rangesArray.length) return err("Lista vazia");
            if (!ensureQE()) return err("QE DOM indisponível");

            // do fim pro início pra preservar coordenadas
            var sorted = rangesArray.slice().sort(function (a, b) { return Number(b[0]) - Number(a[0]); });
            var deleted = 0, shifted = 0, failed = 0;

            for (var i = 0; i < sorted.length; i++) {
                var startSec = Number(sorted[i][0]);
                var endSec   = Number(sorted[i][1]);
                if (!isFinite(startSec) || !isFinite(endSec) || endSec <= startSec) { failed++; continue; }

                _razorAt(seq, startSec);
                _razorAt(seq, endSec);

                // remove clips no intervalo em todas as tracks (sem ripple — ripple do remove é por-track e dessincroniza)
                var rmAny = false;
                for (var tv = 0; tv < seq.videoTracks.numTracks; tv++) {
                    if (_removeClipsInRange(seq.videoTracks[tv], startSec, endSec)) rmAny = true;
                }
                for (var ta = 0; ta < seq.audioTracks.numTracks; ta++) {
                    if (_removeClipsInRange(seq.audioTracks[ta], startSec, endSec)) rmAny = true;
                }

                // shift sincronizado: tudo que está em start>=endSec move pra esquerda
                var delta = endSec - startSec;
                var shAny = _shiftAfter(seq, endSec, -delta);

                if (rmAny || shAny) { deleted++; if (shAny) shifted++; }
                else failed++;
            }

            return ok({ deleted: deleted, shifted: shifted, failed: failed, total: rangesArray.length });
        } catch (e) { return err(e.message); }
    }

    function _removeClipsInRange(track, startSec, endSec) {
        var removed = false;
        var tol = 0.05;       // tolerância de meio-frame
        for (var i = track.clips.numItems - 1; i >= 0; i--) {
            try {
                var c = track.clips[i];
                var s = ticksToSeconds(c.start.ticks);
                var e = ticksToSeconds(c.end.ticks);
                if (s >= startSec - tol && e <= endSec + tol) {
                    // remove(inRipple, alignToVideo) — false pra não rippar por-track
                    c.remove(false, false);
                    removed = true;
                }
            } catch (eRm) {}
        }
        return removed;
    }

    // Move TODOS os clips cujo start >= afterSec por deltaSec (pode ser negativo).
    function _shiftAfter(seq, afterSec, deltaSec) {
        var shifted = false;
        var tol = 0.05;
        function shiftTrack(track) {
            for (var i = 0; i < track.clips.numItems; i++) {
                try {
                    var c = track.clips[i];
                    var s = ticksToSeconds(c.start.ticks);
                    if (s >= afterSec - tol) {
                        // c.move() recebe segundos em alguns builds, Time em outros — usar Time é mais seguro
                        var tm = new Time();
                        tm.seconds = deltaSec;
                        try { c.move(tm); shifted = true; }
                        catch (eM) {
                            // fallback: setar c.start direto (depreciado mas funciona)
                            try {
                                var newStartSec = s + deltaSec;
                                c.start = newStartSec;   // alguns builds aceitam number
                                shifted = true;
                            } catch (eM2) {}
                        }
                    }
                } catch (eClip) {}
            }
        }
        for (var v = 0; v < seq.videoTracks.numTracks; v++) shiftTrack(seq.videoTracks[v]);
        for (var a = 0; a < seq.audioTracks.numTracks; a++) shiftTrack(seq.audioTracks[a]);
        return shifted;
    }

    // ────────────────────────────────────────────────────────────────────────
    // muteAudioRanges → razor + disable (não move nada na timeline)
    // ────────────────────────────────────────────────────────────────────────
    function muteAudioRanges(rangesArray) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            if (!rangesArray || !rangesArray.length) return err("Lista vazia");
            if (!ensureQE()) return err("QE DOM indisponível");

            var sorted = rangesArray.slice().sort(function (a, b) { return Number(b[0]) - Number(a[0]); });
            var muted = 0;

            for (var i = 0; i < sorted.length; i++) {
                var startSec = Number(sorted[i][0]);
                var endSec   = Number(sorted[i][1]);
                if (!isFinite(startSec) || !isFinite(endSec) || endSec <= startSec) continue;

                _razorAt(seq, startSec);
                _razorAt(seq, endSec);

                for (var tk = 0; tk < seq.audioTracks.numTracks; tk++) {
                    var tr = seq.audioTracks[tk];
                    for (var ci = 0; ci < tr.clips.numItems; ci++) {
                        try {
                            var c = tr.clips[ci];
                            var s = ticksToSeconds(c.start.ticks);
                            var e = ticksToSeconds(c.end.ticks);
                            if (s >= startSec - 0.05 && e <= endSec + 0.05) {
                                c.disabled = true; muted++;
                            }
                        } catch (eD) {}
                    }
                }
            }
            return ok({ muted: muted });
        } catch (e) { return err(e.message); }
    }

    // ────────────────────────────────────────────────────────────────────────
    function setCti(seconds) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            seq.setPlayerPosition(secondsToTicks(seconds));
            return ok({ ok: true, cti: Number(seconds) });
        } catch (e) { return err(e.message); }
    }

    // ────────────────────────────────────────────────────────────────────────
    function selectClipsByName(needle) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            if (!needle) return err("needle vazio");
            var lower = String(needle).toLowerCase();
            var count = 0;

            function scan(tracks) {
                for (var t = 0; t < tracks.numTracks; t++) {
                    for (var i = 0; i < tracks[t].clips.numItems; i++) {
                        try {
                            var c = tracks[t].clips[i];
                            var nm = (c.name || "").toLowerCase();
                            if (nm.indexOf(lower) >= 0) {
                                if (c.setSelected) { c.setSelected(true, true); count++; }
                            }
                        } catch (eS) {}
                    }
                }
            }
            scan(seq.videoTracks);
            scan(seq.audioTracks);
            return ok({ selected: count });
        } catch (e) { return err(e.message); }
    }

    // ════════════════════════════════════════════════════════════════════════
    // EXPANSÃO v2.0 — Skills agentic + Vision tools
    // ════════════════════════════════════════════════════════════════════════

    // Exporta frame da sequência ativa no tempo X pra PNG em outPath.
    // QE DOM (qe.project.getActiveSequence().exportFramePNG) é o caminho confiável.
    function exportFrame(timeSec, outPath) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            if (!outPath) return err("outPath obrigatório");
            // 1) Move CTI pro tempo (frame export é do CTI atual)
            seq.setPlayerPosition(secondsToTicks(timeSec));
            // 2) QE DOM PRECISA estar habilitado pra exportFramePNG
            if (!ensureQE()) return err("qe_dom_unavailable");
            try {
                var qeSeq = qe.project.getActiveSequence();
                if (!qeSeq) return err("qe_no_active_sequence");
                // QE exportFramePNG aceita (path) ou (path, timeStr). Tenta ambos.
                if (qeSeq.exportFramePNG) {
                    try { qeSeq.exportFramePNG(outPath); }
                    catch (e1) {
                        // alguns builds exigem timecode como 2º arg
                        try { qeSeq.exportFramePNG(outPath, _secToTC(timeSec, seq)); } catch (e2) { return err("qe_exportFramePNG_failed: " + e2.message); }
                    }
                    return ok({ path: outPath, time: timeSec, via: "qe_png" });
                }
                if (qeSeq.exportFrameJPEG) {
                    qeSeq.exportFrameJPEG(outPath);
                    return ok({ path: outPath, time: timeSec, via: "qe_jpeg" });
                }
            } catch (e3) { return err("qe_export_throw: " + e3.message); }
            return err("export_frame_not_supported_in_this_version");
        } catch (e) { return err(e.message); }
    }

    // Exporta múltiplos frames (1 por timestamp).
    function exportFramesAt(secondsArrayJson, outDir, prefix) {
        try {
            // Aceita array nativo OU JSON string (ES3 não tem eval seguro)
            var arr = secondsArrayJson;
            if (typeof arr === "string") {
                try { arr = JSON.parse(arr); } catch (eP) { arr = []; }
            }
            if (!arr || !arr.length) return err("array vazio");
            if (!outDir) return err("outDir obrigatório");
            prefix = prefix || "frame_";
            var saved = [];
            // Strip trailing slash sem regex: o literal /[\\/]$/ é parser-hostile em
            // ES3 ExtendScript (Premiere 26.x reporta "Expected: )" em line=567).
            // FIX B do briefing — defensivo via charAt/substring.
            var _lastChar = outDir.charAt(outDir.length - 1);
            if (_lastChar === "/" || _lastChar === "\\") {
                outDir = outDir.substring(0, outDir.length - 1);
            }
            for (var i = 0; i < arr.length; i++) {
                var sec = Number(arr[i]);
                var nm = outDir + "/" + prefix + i + "_" + Math.round(sec * 1000) + "ms.png";
                var r = exportFrame(sec, nm);
                var parsed; try { parsed = JSON.parse(r); } catch (eP) { parsed = {}; }
                if (parsed.path) saved.push({ time: sec, path: parsed.path });
            }
            return ok({ saved: saved, count: saved.length });
        } catch (e) { return err(e.message); }
    }

    // Lista TODOS os items do project panel (browsing pra IA achar mídia)
    function listProjectItems() {
        try {
            if (!app.project) return err("Sem project");
            var items = [];
            function walk(item, depth) {
                if (!item) return;
                if (item.type === ProjectItemType.BIN) {
                    for (var i = 0; i < item.children.numItems; i++) walk(item.children[i], depth + 1);
                } else {
                    var path = "";
                    try { path = item.getMediaPath() || ""; } catch (eP) {}
                    items.push({
                        name: item.name,
                        type: (item.type === ProjectItemType.CLIP ? "clip" : item.type === ProjectItemType.FILE ? "file" : "other"),
                        mediaPath: path,
                        depth: depth
                    });
                }
            }
            walk(app.project.rootItem, 0);
            return ok({ items: items, count: items.length });
        } catch (e) { return err(e.message); }
    }

    // Cria sequência duplicada (segurança antes de operações destrutivas)
    function duplicateActiveSequence(newName) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência ativa");
            var clone = null;
            try { if (seq.clone) clone = seq.clone(); } catch (eC) {}
            if (!clone) {
                // Fallback: snapshot do ID antes/depois (clone pode ter sido criado mas não retornado)
                try {
                    var idsBefore = {};
                    if (app.project.sequences) {
                        for (var ib = 0; ib < app.project.sequences.numSequences; ib++) {
                            var sb = app.project.sequences[ib];
                            if (sb && sb.sequenceID) idsBefore[sb.sequenceID] = true;
                        }
                    }
                    // Tenta seq.clone() de novo, ignorando retorno
                    try { seq.clone(); } catch (_) {}
                    // Procura sequencia nova
                    if (app.project.sequences) {
                        for (var ic = 0; ic < app.project.sequences.numSequences; ic++) {
                            var sc = app.project.sequences[ic];
                            if (sc && sc.sequenceID && !idsBefore[sc.sequenceID]) {
                                clone = sc;
                                break;
                            }
                        }
                    }
                } catch (eS) {}
            }
            if (!clone) return err("clone_failed — Premiere não suporta seq.clone() nesta versão");

            // Resolve nome (precisa LER pra confirmar antes de retornar — algumas versões setam async)
            var resolvedName = "";
            try { resolvedName = clone.name || ""; } catch (_) {}

            if (newName && clone.name !== undefined) {
                try { clone.name = newName; resolvedName = newName; } catch (eN) {}
            }
            // Re-lê o nome se vazio (fallback: nome derivado)
            if (!resolvedName) {
                try { resolvedName = clone.name; } catch (_) {}
                if (!resolvedName) resolvedName = (seq.name || "Sequence") + " (cópia)";
            }
            var resolvedId = null;
            try { resolvedId = clone.sequenceID || null; } catch (_) {}

            // Abre a nova (best-effort)
            try { if (resolvedId) app.project.openSequence(resolvedId); } catch (eO) {}

            return ok({ name: resolvedName, id: resolvedId });
        } catch (e) { return err(e.message); }
    }

    // Move CTI por delta (ms). Útil pra IA "scan" timeline.
    function nudgeCti(deltaMs) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            var cur = seq.getPlayerPosition().seconds;
            var nxt = Math.max(0, cur + (Number(deltaMs) / 1000));
            seq.setPlayerPosition(secondsToTicks(nxt));
            return ok({ cti: nxt });
        } catch (e) { return err(e.message); }
    }

    // Marca In/Out na sequência
    function setInOut(inSec, outSec) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            if (typeof inSec === "number" && seq.setInPoint)  seq.setInPoint(secondsToTicks(inSec));
            if (typeof outSec === "number" && seq.setOutPoint) seq.setOutPoint(secondsToTicks(outSec));
            // "in" precisa de aspas: é reserved word ES3, ExtendScript rejeita
            // como property name sem quoting (ES5+ permite, jshint --esversion=3 pega).
            return ok({ "in": inSec, "out": outSec });
        } catch (e) { return err(e.message); }
    }

    // Habilita/desabilita clip por nome (substring match)
    function setClipEnabled(needle, enabled) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            var lower = String(needle || "").toLowerCase();
            var changed = 0;
            function scan(tracks) {
                for (var t = 0; t < tracks.numTracks; t++) {
                    for (var i = 0; i < tracks[t].clips.numItems; i++) {
                        try {
                            var c = tracks[t].clips[i];
                            if ((c.name || "").toLowerCase().indexOf(lower) >= 0) {
                                if (c.disabled !== undefined) { c.disabled = !enabled; changed++; }
                            }
                        } catch (eS) {}
                    }
                }
            }
            scan(seq.videoTracks);
            scan(seq.audioTracks);
            return ok({ changed: changed, enabled: !!enabled });
        } catch (e) { return err(e.message); }
    }

    // Aplica MOGRT/Effect por nome do template no project panel — usa addTextAtCTI helper de QE
    function applyMogrtAtCti(mogrtPath, trackV, durationSec) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            if (!mogrtPath) return err("mogrtPath obrigatório");
            trackV = Math.max(0, Number(trackV || 0));
            durationSec = Number(durationSec || 5);
            var cti = seq.getPlayerPosition();
            // Premiere API: insertMogrt na track no CTI
            if (seq.importMGT) {
                var clip = seq.importMGT(mogrtPath, cti.ticks, trackV, 0);
                if (clip) {
                    try { clip.end = { ticks: String(Math.round(Number(cti.ticks) + durationSec * TPS)) }; } catch (eE) {}
                    return ok({ insertedAt: cti.seconds, track: trackV });
                }
            }
            return err("importMGT_not_available");
        } catch (e) { return err(e.message); }
    }

    // Snapshot leve do contexto: o que a IA precisa pra entender a edição
    function getContextSnapshot() {
        try {
            var seq = getSeq();
            if (!seq) return ok({ hasSequence: false });
            var clipsInfo = JSON.parse(listTimelineClips());
            if (clipsInfo.error) return ok({ hasSequence: true, error: clipsInfo.error });
            // Conta selected
            var selected = [];
            var selectedClip = null;
            for (var i = 0; i < (clipsInfo.clips || []).length; i++) {
                var c = clipsInfo.clips[i];
                if (c.isSelected) {
                    selected.push({ name: c.name, track: c.track, start: c.start, end: c.end, mediaPath: c.mediaPath });
                    if (!selectedClip) selectedClip = c;
                }
            }
            return ok({
                hasSequence: true,
                sequenceName: clipsInfo.sequenceName,
                fps: clipsInfo.fps,
                cti: clipsInfo.cti,
                durationSeconds: clipsInfo.durationSeconds,
                totals: clipsInfo.totals,
                selectedCount: selected.length,
                selectedClips: selected.slice(0, 10),
                firstSelectedMediaPath: selectedClip ? selectedClip.mediaPath : null,
                projectPath: (app.project && app.project.path) || ""
            });
        } catch (e) { return err(e.message); }
    }

    // Detecção rudimentar de "clipes em sequência" — heurística pra IA achar pontos de jump cut
    function findClipBoundaries() {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            var boundaries = [];
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                var tr = seq.videoTracks[t];
                for (var i = 0; i < tr.clips.numItems; i++) {
                    var c = tr.clips[i];
                    boundaries.push({ track: t + 1, kind: "video", start: ticksToSeconds(c.start.ticks), end: ticksToSeconds(c.end.ticks), name: c.name });
                }
            }
            boundaries.sort(function (a, b) { return a.start - b.start; });
            return ok({ boundaries: boundaries });
        } catch (e) { return err(e.message); }
    }

    // Tenta abrir Lumetri panel + selecionar clip alvo (pra IA pedir color grade manual)
    function focusLumetri(needle) {
        try {
            var sr = JSON.parse(selectClipsByName(needle || ""));
            if (sr.error) return err(sr.error);
            // Abre painel Lumetri via menu (best-effort)
            try { app.executeCommand("Lumetri Color"); } catch (eM) {}
            return ok({ selected: sr.selected });
        } catch (e) { return err(e.message); }
    }

    // Ping host expandido — pra agente saber capabilities
    function capabilities() {
        var caps = {
            qe: ensureQE(),
            premiereVersion: (app && app.version) ? app.version : "?",
            hasActiveSequence: !!getSeq(),
            extendscript: "ES3",
            api: "v2.0",
            features: {
                exportFrame: true,
                duplicateSequence: false,   // depende da versão; runtime check
                applyMogrt: true,
                rippleDelete: true,
                muteRanges: true,
                contextSnapshot: true
            }
        };
        // Detect runtime
        try {
            var seq = getSeq();
            if (seq && seq.clone) caps.features.duplicateSequence = true;
        } catch (e) {}
        return ok(caps);
    }

    // ════════════════════════════════════════════════════════════════════════
    // EXPANSÃO v3.0 — Funções pra fechar 100% das 12 skills
    // ════════════════════════════════════════════════════════════════════════

    // ─── MARKERS (Capítulos IA) ──────────────────────────────────────
    function addMarker(timeSec, name, comment, color) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            // Premiere API: sequence.markers.createMarker(timeSec)
            var m;
            try { m = seq.markers.createMarker(Number(timeSec)); } catch (e) { return err("createMarker_fail: " + e.message); }
            if (m) {
                try { if (name != null) m.name = String(name); } catch (e1) {}
                try { if (comment != null) m.comments = String(comment); } catch (e2) {}
                // colors: 0=verde, 1=vermelho, 2=roxo, 3=laranja, 4=amarelo, 5=branco, 6=azul, 7=ciano
                try { if (color != null) m.setColorByIndex(Number(color)); } catch (e3) {}
            }
            return ok({ added: true, time: timeSec, name: name });
        } catch (e) { return err(e.message); }
    }

    function addMarkersBatch(markersJson) {
        try {
            var arr = (typeof markersJson === "string") ? JSON.parse(markersJson) : markersJson;
            if (!arr || !arr.length) return err("array vazio");
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            var added = 0;
            for (var i = 0; i < arr.length; i++) {
                try {
                    var item = arr[i];
                    var m = seq.markers.createMarker(Number(item.start || item.time));
                    if (m) {
                        if (item.name)    try { m.name = String(item.name); } catch (_) {}
                        if (item.title)   try { m.name = String(item.title); } catch (_) {}
                        if (item.comment) try { m.comments = String(item.comment); } catch (_) {}
                        if (item.color != null) try { m.setColorByIndex(Number(item.color)); } catch (_) {}
                        added++;
                    }
                } catch (eM) {}
            }
            return ok({ added: added, total: arr.length });
        } catch (e) { return err(e.message); }
    }

    // ─── TRANSITIONS (Transições IA) ─────────────────────────────────
    // Aplica transição em todos os boundaries de clip nas video tracks
    // Premiere QE API varia muito por versão — tenta múltiplas assinaturas.
    function applyTransitionsAllCuts(durationSec, transitionName) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência ativa — abra uma sequência primeiro");
            if (!ensureQE()) return err("qe_dom_required — Premiere QE não está disponível. Reabra o Premiere ou ative QE.");
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) return err("qe_no_active_sequence — selecione uma sequência ativa");

            transitionName = transitionName || "Cross Dissolve";
            durationSec = Number(durationSec || 1);

            // Map de display name → variantes que diferentes versões de Premiere aceitam
            var NAME_MAP = {};
            NAME_MAP["Cross Dissolve"]      = ["Cross Dissolve", "AE.ADBE Cross Dissolve New"];
            NAME_MAP["Dip to Black"]        = ["Dip to Black", "AE.ADBE Dip to Black"];
            NAME_MAP["Dip to White"]        = ["Dip to White", "AE.ADBE Dip to White"];
            NAME_MAP["Additive Dissolve"]   = ["Additive Dissolve", "AE.ADBE Additive Dissolve"];
            NAME_MAP["Film Dissolve"]       = ["Film Dissolve", "AE.ADBE Film Dissolve"];
            NAME_MAP["Push"]                = ["Push", "AE.ADBE Push"];
            NAME_MAP["Slide"]               = ["Slide", "AE.ADBE Slide"];
            NAME_MAP["Wipe"]                = ["Wipe", "AE.ADBE Wipe"];
            NAME_MAP["Iris Cross"]          = ["Iris Cross", "AE.ADBE Iris Cross"];
            NAME_MAP["Split"]               = ["Split", "AE.ADBE Split"];
            NAME_MAP["Zoom Trails"]         = ["Zoom Trails", "AE.ADBE Zoom Trails"];
            NAME_MAP["Morph Cut"]           = ["Morph Cut", "AE.ADBE Morph Cut"];

            var nameVariants = NAME_MAP[transitionName] || [transitionName];
            var durStr = _secToTimeStr(durationSec);

            var applied = 0, failed = 0;
            var lastErr = "";
            var firstSuccessName = null;
            var boundariesFound = 0;

            for (var t = 0; t < qeSeq.numVideoTracks; t++) {
                var qeTrack;
                try { qeTrack = qeSeq.getVideoTrackAt(t); } catch (eT) { continue; }
                if (!qeTrack || qeTrack.numItems == null) continue;

                for (var i = 0; i < qeTrack.numItems - 1; i++) {
                    try {
                        var clipA = qeTrack.getItemAt(i);
                        if (!clipA || clipA.type !== "Clip") continue;
                        boundariesFound++;

                        var done = false;
                        // tenta cada variante de nome
                        for (var v = 0; v < nameVariants.length && !done; v++) {
                            var vName = nameVariants[v];

                            // Assinatura 1: clipA.addTransition(name, alignCenter, duration, atTime)
                            try {
                                clipA.addTransition(vName, false, durStr, clipA.end);
                                applied++; done = true;
                                if (!firstSuccessName) firstSuccessName = vName;
                                continue;
                            } catch (eA) { lastErr = "clip.addTransition[" + vName + "]: " + eA.message; }

                            // Assinatura 2: qeTrack.addVideoTransition(name, duration, atTime, alignCenter)
                            try {
                                qeTrack.addVideoTransition(vName, durStr, clipA.end, true);
                                applied++; done = true;
                                if (!firstSuccessName) firstSuccessName = vName;
                                continue;
                            } catch (eB) { lastErr = "track.addVideoTransition[" + vName + "]: " + eB.message; }
                        }
                        if (!done) failed++;
                    } catch (eC) { failed++; lastErr = "boundary_iter: " + eC.message; }
                }
            }
            return ok({
                applied: applied,
                failed: failed,
                boundaries_found: boundariesFound,
                transition: transitionName,
                resolved_name: firstSuccessName,
                duration_sec: durationSec,
                last_error: failed > 0 ? lastErr : null
            });
        } catch (e) { return err(e.message); }
    }
    function _secToTimeStr(sec) {
        // Premiere QE espera "00:00:01:00" (HH:MM:SS:FF)
        var seq = getSeq();
        var fps = getFps(seq);
        var totalFrames = Math.round(sec * fps);
        var h = Math.floor(totalFrames / (3600 * fps));
        var m = Math.floor((totalFrames % (3600 * fps)) / (60 * fps));
        var s = Math.floor((totalFrames % (60 * fps)) / fps);
        var f = Math.floor(totalFrames % fps);
        function p(n) { return n < 10 ? "0" + n : String(n); }
        return p(h) + ":" + p(m) + ":" + p(s) + ":" + p(f);
    }

    // ─── BINS (Organizar Bins) ───────────────────────────────────────
    function createBin(name) {
        try {
            if (!app.project) return err("Sem project");
            var root = app.project.rootItem;
            // checa se já existe
            for (var i = 0; i < root.children.numItems; i++) {
                var c = root.children[i];
                if (c.name === name && c.type === ProjectItemType.BIN) return ok({ id: c.nodeId, name: name, existed: true });
            }
            var bin = root.createBin(name);
            return ok({ id: bin ? bin.nodeId : null, name: name, existed: false });
        } catch (e) { return err(e.message); }
    }

    function moveToBin(itemNamesJson, binName) {
        try {
            var arr = (typeof itemNamesJson === "string") ? JSON.parse(itemNamesJson) : itemNamesJson;
            if (!arr || !arr.length) return err("array vazio");
            if (!app.project) return err("Sem project");
            var root = app.project.rootItem;
            // Acha/cria bin
            var bin = null;
            for (var i = 0; i < root.children.numItems; i++) {
                var c = root.children[i];
                if (c.name === binName && c.type === ProjectItemType.BIN) { bin = c; break; }
            }
            if (!bin) bin = root.createBin(binName);
            if (!bin) return err("bin_create_fail");

            var moved = 0;
            // Itera flat — encontra item por nome no root
            function findItem(node, targetName) {
                if (!node) return null;
                if (node.type === ProjectItemType.BIN) {
                    for (var i = 0; i < node.children.numItems; i++) {
                        var r = findItem(node.children[i], targetName);
                        if (r) return r;
                    }
                    return null;
                }
                if (node.name === targetName) return node;
                return null;
            }
            for (var j = 0; j < arr.length; j++) {
                var nm = arr[j];
                var item = findItem(root, nm);
                if (item && item.moveBin) {
                    try { item.moveBin(bin); moved++; } catch (eM) {}
                }
            }
            return ok({ moved: moved, total: arr.length, bin: binName });
        } catch (e) { return err(e.message); }
    }

    function organizeAllByType() {
        try {
            if (!app.project) return err("Sem project");
            var root = app.project.rootItem;
            var binNames = { video: "Vídeos", audio: "Áudios", image: "Imagens", sequence: "Sequências" };
            var bins = {};
            // Cria todos os bins
            for (var key in binNames) {
                var n = binNames[key];
                bins[key] = null;
                for (var i = 0; i < root.children.numItems; i++) {
                    if (root.children[i].name === n && root.children[i].type === ProjectItemType.BIN) {
                        bins[key] = root.children[i]; break;
                    }
                }
                if (!bins[key]) bins[key] = root.createBin(n);
            }
            // Move items
            var moved = { video: 0, audio: 0, image: 0, sequence: 0 };
            var items = [];
            for (var i2 = 0; i2 < root.children.numItems; i2++) {
                items.push(root.children[i2]);
            }
            for (var j = 0; j < items.length; j++) {
                var it = items[j];
                if (it.type === ProjectItemType.BIN) continue;
                var mp = ""; try { if (it.getMediaPath) mp = it.getMediaPath() || ""; } catch (_) {}
                var ext = mp.toLowerCase().split(".").pop();
                var cat = null;
                if (it.type === ProjectItemType.SEQUENCE || (it.name || "").toLowerCase().indexOf("sequence") >= 0) cat = "sequence";
                else if (/mp4|mov|mkv|avi|webm/.test(ext)) cat = "video";
                else if (/mp3|wav|aac|flac|m4a/.test(ext)) cat = "audio";
                else if (/jpg|jpeg|png|gif|psd|tiff|tif/.test(ext)) cat = "image";
                if (cat && bins[cat] && it.moveBin) {
                    try { it.moveBin(bins[cat]); moved[cat]++; } catch (_) {}
                }
            }
            // ES3 ExtendScript não tem Object.keys — conta via for-in com hasOwnProperty.
            var binCount = 0;
            for (var bk in binNames) { if (binNames.hasOwnProperty(bk)) binCount++; }
            return ok({ moved: moved, bins_created: binCount });
        } catch (e) { return err(e.message); }
    }

    // ─── MULTICAM ────────────────────────────────────────────────────
    // Tenta múltiplas estratégias até alguma funcionar.
    // Premiere muda essa API quase em toda versão — então robustez > elegância.
    //
    // ACEITA opcionalmente clip_names: ["clip1.mp4", "clip2.mp4"] que faz busca
    // por nome no Project Panel (mais confiável que getSelection() que é bugado).
    function createMulticamFromSelected(clipNamesJson) {
        try {
            if (!app.project) return err("Sem project");

            // Estratégia preferida: nomes vindos do plugin UI picker (não getSelection!)
            var sel = [];
            var names = null;
            try {
                if (clipNamesJson) names = (typeof clipNamesJson === "string") ? JSON.parse(clipNamesJson) : clipNamesJson;
            } catch (_) { names = null; }

            if (names && names.length) {
                // Busca recursiva por nome
                function findInRoot(node, target) {
                    if (!node || !node.children) return null;
                    for (var i = 0; i < node.children.numItems; i++) {
                        var c = node.children[i];
                        if (c.type === ProjectItemType.BIN) {
                            var r = findInRoot(c, target);
                            if (r) return r;
                        }
                        if (c.name === target) return c;
                    }
                    return null;
                }
                for (var j = 0; j < names.length; j++) {
                    var it = findInRoot(app.project.rootItem, names[j]);
                    if (it) sel.push(it);
                }
                if (sel.length < 2) return err("Apenas " + sel.length + " de " + names.length + " clips encontrados por nome — confira spelling");
            } else {
                // Fallback legacy: tenta getSelection (Premiere bugado em algumas versoes)
                sel = (app.project.getSelection && app.project.getSelection()) || [];
                if (!sel || sel.length < 2) {
                    return err("getSelection_falhou — chame createMulticamFromSelected com clip_names: [\"nome1\",\"nome2\"] em vez de depender do Premiere getSelection (bugado em algumas versões)");
                }
            }

            var name = "MultiCam_" + Date.now();
            var attempts = [];

            // Estratégia 1: API nativa createMulticamSequence (Premiere 23+)
            if (app.project.createMulticamSequence) {
                try {
                    var multi = app.project.createMulticamSequence(name, sel, 3); // 3 = audio sync
                    if (multi) return ok({ sequence: name, clips: sel.length, method: "native_audio_sync" });
                    attempts.push("createMulticamSequence: retornou null");
                } catch (eM) { attempts.push("createMulticamSequence: " + eM.message); }
            } else {
                attempts.push("createMulticamSequence: API indisponível");
            }

            // Estratégia 2: createNewSequenceFromClips (Premiere 22+)
            if (app.project.createNewSequenceFromClips) {
                try {
                    var seqFromClips = app.project.createNewSequenceFromClips(name, sel);
                    if (seqFromClips) return ok({ sequence: name, clips: sel.length, method: "from_clips" });
                    attempts.push("createNewSequenceFromClips: retornou null");
                } catch (eC) { attempts.push("createNewSequenceFromClips: " + eC.message); }
            } else {
                attempts.push("createNewSequenceFromClips: API indisponível");
            }

            // Estratégia 3: createNewSequence sem preset + insertClip em cada track
            try {
                // createNewSequence(name) sem preset usa default do projeto atual
                var seqManual = null;
                try { seqManual = app.project.createNewSequence(name); } catch (e1) {
                    try { seqManual = app.project.createNewSequence(name, ""); } catch (e2) {
                        attempts.push("createNewSequence: " + e2.message);
                    }
                }
                if (seqManual && seqManual.videoTracks) {
                    var inserted = 0;
                    for (var i = 0; i < sel.length && i < seqManual.videoTracks.numTracks; i++) {
                        try {
                            var track = seqManual.videoTracks[i];
                            if (track && track.insertClip && sel[i]) {
                                track.insertClip(sel[i], 0);
                                inserted++;
                            }
                        } catch (eT) { attempts.push("track[" + i + "].insertClip: " + eT.message); }
                    }
                    if (inserted > 0) {
                        return ok({
                            sequence: name,
                            clips: inserted,
                            method: "manual_tracks",
                            note: inserted < sel.length ? ("Apenas " + inserted + "/" + sel.length + " clips inseridos — tracks insuficientes") : null
                        });
                    }
                    attempts.push("createNewSequence: criada mas nenhum clip inserido");
                }
            } catch (eS) { attempts.push("manual_tracks: " + eS.message); }

            // Todas falharam — retorna detalhes do que tentou
            return err("multicam_failed | tentativas: " + attempts.join(" | ") + " | sugestão: selecione clips no Project Panel → click direito → 'Create Multi-Camera Source Sequence'");
        } catch (e) { return err(e.message); }
    }

    // ─── COPIAR SEQUÊNCIA CROSS-PROJECT (clipboard ExtendScript) ─────
    function copySequenceToClipboard() {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            // Premiere clipboard: app.project.activeSequence.exportAsFinalCutProXML
            // Workaround: usa duplicate + flag
            var clone = null;
            try { if (seq.clone) clone = seq.clone(); } catch (_) {}
            if (!clone) return err("clone_not_supported");
            try { clone.name = seq.name + "_copy_" + Date.now(); } catch (_) {}
            return ok({ copied_as: clone.name, message: "Sequência duplicada — pra colar em outro projeto, exporte como FCP XML em Arquivo > Exportar > FCP XML." });
        } catch (e) { return err(e.message); }
    }

    // ─── CRIA SEQUÊNCIA NOVA A PARTIR DE RANGE DE CLIP (highlights → shorts) ────
    // mediaPath é importado, sub-clip [start..end] é colocado numa nova sequência vertical
    function createSequenceFromRange(mediaPath, startSec, endSec, seqName, vertical) {
        try {
            if (!app.project) return err("Sem project");
            // Importa o arquivo se não estiver
            var item = null;
            try {
                app.project.importFiles([mediaPath], false, app.project.rootItem, false);
                // Acha o item recém importado
                for (var i = 0; i < app.project.rootItem.children.numItems; i++) {
                    var c = app.project.rootItem.children[i];
                    try {
                        if (c.getMediaPath && c.getMediaPath() === mediaPath) { item = c; break; }
                    } catch (_) {}
                }
            } catch (eI) {}
            if (!item) return err("import_failed");

            // Cria sequência
            var name = seqName || ("Short_" + Math.round(startSec) + "_" + Math.round(endSec));
            var seq;
            try {
                if (vertical) {
                    seq = app.project.createNewSequence(name, "1080x1920");
                } else {
                    seq = app.project.createNewSequence(name, "1920x1080");
                }
            } catch (eS) {
                // Fallback: usa preset auto
                try { seq = app.project.createNewSequenceFromMedia(name, [item], app.project.rootItem); } catch (eS2) {}
            }
            if (!seq) return err("sequence_create_failed");

            // Define In/Out no clip + insere
            try {
                item.setInPoint(startSec, 4);
                item.setOutPoint(endSec, 4);
            } catch (_) {}
            try {
                seq.videoTracks[0].insertClip(item, 0);
                if (seq.audioTracks[0]) seq.audioTracks[0].insertClip(item, 0);
            } catch (eIns) {}

            return ok({ created: name, start: startSec, end: endSec, vertical: !!vertical });
        } catch (e) { return err(e.message); }
    }

    // ─── CRIA SHORTS EM LOTE (Caça-Trechos auto-cria) ──────────────────────
    function createShortsFromHighlights(highlightsJson, mediaPath, vertical) {
        try {
            var arr = (typeof highlightsJson === "string") ? JSON.parse(highlightsJson) : highlightsJson;
            if (!arr || !arr.length) return err("array vazio");
            var created = 0, failed = 0, errors = [];
            for (var i = 0; i < arr.length; i++) {
                var h = arr[i];
                var name = "Short_" + String(i+1).replace(/^(\d)$/, "0$1") + "_" + (h.title || ("range_" + Math.round(h.start)))
                    .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
                var r = createSequenceFromRange(mediaPath, h.start, h.end, name, !!vertical);
                var parsed; try { parsed = JSON.parse(r); } catch (_) { parsed = {}; }
                if (parsed.error) { failed++; errors.push(name + ": " + parsed.error); }
                else { created++; }
            }
            return ok({ created: created, failed: failed, total: arr.length, errors: errors.slice(0, 5) });
        } catch (e) { return err(e.message); }
    }

    // ─── MULTICAM AUTO-SYNC (cria sequência multicam de verdade) ──────────
    function createMulticamAutoSync(clipNamesJson) {
        try {
            var names = (typeof clipNamesJson === "string") ? JSON.parse(clipNamesJson) : clipNamesJson;
            if (!names || !names.length) return err("array vazio");
            if (!app.project) return err("Sem project");

            // Acha os items pelos nomes
            var items = [];
            function find(node, target) {
                if (!node) return null;
                if (node.type === ProjectItemType.BIN) {
                    for (var i = 0; i < node.children.numItems; i++) {
                        var r = find(node.children[i], target);
                        if (r) return r;
                    }
                    return null;
                }
                if (node.name === target) return node;
                return null;
            }
            for (var j = 0; j < names.length; j++) {
                var it = find(app.project.rootItem, names[j]);
                if (it) items.push(it);
            }
            if (items.length < 2) return err("precisa_min_2_clips");

            // Premiere tem createNewSequenceFromMedia + multicamSequence
            // app.project.createMulticamSequence(name, items, syncMethod, ...)
            // syncMethod: 0=in, 1=out, 2=timecode, 3=audio, 4=markers
            try {
                var name = "MultiCam_AutoSync_" + Date.now();
                var multi;
                // Premiere recente: app.project.activeSequence.createMulticamFromClips OU app.project.createMulticamSequence
                if (app.project.createMulticamSequence) {
                    multi = app.project.createMulticamSequence(name, items, 3); // 3 = audio sync
                }
                if (!multi) {
                    // Fallback: cria sequência normal com clips em tracks separadas
                    return createMulticamFromSelected();
                }
                return ok({ sequence: name, clips: items.length, sync: "audio" });
            } catch (eM) { return err("multicam_create: " + eM.message); }
        } catch (e) { return err(e.message); }
    }

    // ─── IMPORT GENÉRICO DE ARQUIVO (sem inserir na timeline) ──────────
    function importFile(filePath) {
        try {
            if (!app.project) return err("Sem project");
            app.project.importFiles([filePath], false, app.project.rootItem, false);
            return ok({ imported: filePath });
        } catch (e) { return err(e.message); }
    }

    // Exporta sequência ativa pra FCP XML — pra abrir em outro projeto
    function exportActiveSequenceXML(outPath) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            if (!outPath) return err("outPath obrigatório");
            // app.project.exportFinalCutProXML(outPath)
            var ok2;
            try { ok2 = app.project.exportFinalCutProXML(outPath); } catch (eX) { return err("export_xml_fail: " + eX.message); }
            return ok({ exported: !!ok2, path: outPath });
        } catch (e) { return err(e.message); }
    }

    // ────────────────────────────────────────────────────────────────────────
    return {
        // v1.x (existentes)
        ping: ping,
        getActiveSequenceInfo: getActiveSequenceInfo,
        listTimelineClips: listTimelineClips,
        getSelectedMediaPath: getSelectedMediaPath,
        getSelectedClipTiming: getSelectedClipTiming,
        importAndInsert: importAndInsert,
        addCutsAtSeconds: addCutsAtSeconds,
        deleteRanges: deleteRanges,
        muteAudioRanges: muteAudioRanges,
        setCti: setCti,
        selectClipsByName: selectClipsByName,

        // v2.0 (skills agentic)
        capabilities: capabilities,
        getContextSnapshot: getContextSnapshot,
        exportFrame: exportFrame,
        exportFramesAt: exportFramesAt,
        listProjectItems: listProjectItems,
        duplicateActiveSequence: duplicateActiveSequence,
        nudgeCti: nudgeCti,
        setInOut: setInOut,
        setClipEnabled: setClipEnabled,
        applyMogrtAtCti: applyMogrtAtCti,
        findClipBoundaries: findClipBoundaries,
        focusLumetri: focusLumetri,

        // v3.0 (skills completas)
        addMarker: addMarker,
        addMarkersBatch: addMarkersBatch,
        applyTransitionsAllCuts: applyTransitionsAllCuts,
        createBin: createBin,
        moveToBin: moveToBin,
        organizeAllByType: organizeAllByType,
        createMulticamFromSelected: createMulticamFromSelected,
        createMulticamAutoSync: createMulticamAutoSync,
        copySequenceToClipboard: copySequenceToClipboard,
        exportActiveSequenceXML: exportActiveSequenceXML,
        createSequenceFromRange: createSequenceFromRange,
        createShortsFromHighlights: createShortsFromHighlights,
        importFile: importFile
    };
})();

// ============================================================
// eta · Onda 5 · MIA_* funcs for Agent timeline manipulation
// ES3 strict — Premiere [14.0, 99.9]
// Appended 2026-05-23 · preserves all lines above (incl. Onda 1
// fixes: L565-567 regex, L639 quoted "in"/"out", L1055 for-in count).
// ============================================================
(function () {

    var TICKS_PER_SECOND_MIA = 254016000000;

    function _ok(o)  { return JSON.stringify(o == null ? { ok: true } : o); }
    function _err(m) { return JSON.stringify({ ok: false, error: String(m) }); }
    function _data(d) { return JSON.stringify({ ok: true, data: d }); }

    function _getSeq() {
        if (!app || !app.project) return null;
        return app.project.activeSequence || null;
    }

    function _ctiSeconds(seq) {
        try {
            if ($.global.MotionProIAUtils && typeof $.global.MotionProIAUtils.getCti === "function") {
                return $.global.MotionProIAUtils.getCti();
            }
            if (!seq) return 0;
            var pos = seq.getPlayerPosition();
            if (!pos) return 0;
            if (typeof pos.seconds === "number" && isFinite(pos.seconds)) return pos.seconds;
            if (typeof pos.ticks !== "undefined") {
                var t = Number(pos.ticks);
                if (isFinite(t)) return t / TICKS_PER_SECOND_MIA;
            }
            return 0;
        } catch (e) { return 0; }
    }

    function _secondsToTicksStr(sec) {
        return String(Math.round(Number(sec) * TICKS_PER_SECOND_MIA));
    }

    function _fpsOf(seq) {
        try {
            if (seq && seq.getSettings) {
                var s = seq.getSettings();
                if (s && s.videoFrameRate && s.videoFrameRate.ticks) {
                    var t = Number(s.videoFrameRate.ticks);
                    if (t > 0) return TICKS_PER_SECOND_MIA / t;
                }
            }
        } catch (e) {}
        return 30;
    }

    // -- MIA_getActiveSequence ------------------------------------------
    function MIA_getActiveSequence() {
        try {
            var seq = _getSeq();
            if (!seq) return _err("no_active_sequence");

            var name = "";
            try { name = String(seq.name || ""); } catch (eN) {}

            var seqId = "";
            try { seqId = String(seq.sequenceID || seq.id || ""); } catch (eI) {}

            var fps = _fpsOf(seq);

            var inP = null, outP = null;
            try {
                if (typeof seq.getInPointAsTime === "function") {
                    var ip = seq.getInPointAsTime();
                    if (ip && typeof ip.seconds === "number") inP = ip.seconds;
                }
            } catch (eIn) {}
            try {
                if (typeof seq.getOutPointAsTime === "function") {
                    var op = seq.getOutPointAsTime();
                    if (op && typeof op.seconds === "number") outP = op.seconds;
                }
            } catch (eOut) {}

            var durationSec = 0;
            var durationTC = "";
            try {
                if (seq.end) {
                    var endTicks = Number(seq.end);
                    if (isFinite(endTicks)) durationSec = endTicks / TICKS_PER_SECOND_MIA;
                }
                if (typeof seq.getOutPoint === "function") {
                    var outv = seq.getOutPoint();
                    if (outv && typeof outv === "string") durationTC = outv;
                }
            } catch (eD) {}

            var vCount = 0, aCount = 0;
            try { vCount = seq.videoTracks ? (seq.videoTracks.numTracks || seq.videoTracks.length || 0) : 0; } catch (eV) {}
            try { aCount = seq.audioTracks ? (seq.audioTracks.numTracks || seq.audioTracks.length || 0) : 0; } catch (eA) {}

            var cti = _ctiSeconds(seq);

            // bracket notation pra "in"/"out" (reserved words em ES3)
            var out_data = {
                name:             name,
                id:               seqId,
                framerate:        fps,
                videoTracks:      vCount,
                audioTracks:      aCount,
                ctiSeconds:       cti,
                durationSeconds:  durationSec,
                durationTimecode: durationTC
            };
            out_data["in"]  = inP;
            out_data["out"] = outP;

            return _data(out_data);
        } catch (e) { return _err(e.message); }
    }

    // -- MIA_insertClipAtCti --------------------------------------------
    function MIA_insertClipAtCti(filePath, trackIndex) {
        try {
            if (!filePath) return _err("filePath required");
            var seq = _getSeq();
            if (!seq) return _err("no_active_sequence");
            var idx = (typeof trackIndex === "number" && trackIndex >= 0) ? trackIndex : 0;

            var track = null;
            try {
                if ($.global.MotionProIAUtils && typeof $.global.MotionProIAUtils.findVideoTrack === "function") {
                    track = $.global.MotionProIAUtils.findVideoTrack(seq, idx);
                }
                if (!track && seq.videoTracks && seq.videoTracks[idx]) track = seq.videoTracks[idx];
            } catch (eT) {}
            if (!track) return _err("track_not_found:idx=" + idx);

            var rootBefore = app.project.rootItem;
            var beforeCount = 0;
            try { beforeCount = rootBefore.children ? rootBefore.children.numItems : 0; } catch (eB) {}

            var importOk = false;
            try {
                importOk = app.project.importFiles([filePath], false, app.project.rootItem, false);
            } catch (eI) { return _err("import_failed: " + eI.message); }

            var newItem = null;
            try {
                var rootAfter = app.project.rootItem;
                var nowCount = rootAfter.children ? rootAfter.children.numItems : 0;
                if (nowCount > beforeCount) {
                    newItem = rootAfter.children[nowCount - 1];
                } else {
                    var base = String(filePath).replace(/\\/g, "/");
                    var slashAt = base.lastIndexOf("/");
                    var bn = slashAt >= 0 ? base.substring(slashAt + 1) : base;
                    for (var k = 0; k < nowCount; k++) {
                        var it = rootAfter.children[k];
                        if (it && it.name === bn) { newItem = it; break; }
                    }
                }
            } catch (eF) {}

            if (!newItem) return _err("imported_item_not_found");

            var ctiSec = _ctiSeconds(seq);
            var insertedName = "";
            var startSec = ctiSec, endSec = ctiSec;
            try {
                track.insertClip(newItem, ctiSec);
                try {
                    var clipsCount = track.clips ? (track.clips.numItems || track.clips.length || 0) : 0;
                    if (clipsCount > 0) {
                        var lastClip = track.clips[clipsCount - 1];
                        if (lastClip) {
                            try { insertedName = String(lastClip.name || ""); } catch (eN2) {}
                            try {
                                if (lastClip.start && typeof lastClip.start.seconds === "number") startSec = lastClip.start.seconds;
                                if (lastClip.end && typeof lastClip.end.seconds === "number") endSec = lastClip.end.seconds;
                            } catch (eSE) {}
                        }
                    }
                } catch (eC) {}
            } catch (eIns) { return _err("insertClip_failed: " + eIns.message); }

            return _data({
                clipName:     insertedName || String(newItem.name || ""),
                trackIndex:   idx,
                startSeconds: startSec,
                endSeconds:   endSec,
                importedOk:   !!importOk
            });
        } catch (e) { return _err(e.message); }
    }

    // -- MIA_cutAtCti ---------------------------------------------------
    function MIA_cutAtCti() {
        try {
            var seq = _getSeq();
            if (!seq) return _err("no_active_sequence");
            var ctiSec = _ctiSeconds(seq);
            if (!isFinite(ctiSec) || ctiSec < 0) return _err("invalid_cti");

            var splitCount = 0;
            var ctiTicks = _secondsToTicksStr(ctiSec);

            var vCount = 0;
            try { vCount = seq.videoTracks ? (seq.videoTracks.numTracks || seq.videoTracks.length || 0) : 0; } catch (eVC) {}
            for (var vi = 0; vi < vCount; vi++) {
                try {
                    var vt = seq.videoTracks[vi];
                    if (!vt) continue;
                    var did = false;
                    try {
                        if (typeof vt.razor === "function") { vt.razor(ctiTicks); did = true; }
                    } catch (eR1) {}
                    if (!did) {
                        try {
                            if (typeof vt.razorClipAtTime === "function") { vt.razorClipAtTime(ctiSec); did = true; }
                        } catch (eR2) {}
                    }
                    if (did) splitCount++;
                } catch (eVi) {}
            }

            var aCount = 0;
            try { aCount = seq.audioTracks ? (seq.audioTracks.numTracks || seq.audioTracks.length || 0) : 0; } catch (eAC) {}
            for (var ai = 0; ai < aCount; ai++) {
                try {
                    var at = seq.audioTracks[ai];
                    if (!at) continue;
                    var did2 = false;
                    try {
                        if (typeof at.razor === "function") { at.razor(ctiTicks); did2 = true; }
                    } catch (eR3) {}
                    if (!did2) {
                        try {
                            if (typeof at.razorClipAtTime === "function") { at.razorClipAtTime(ctiSec); did2 = true; }
                        } catch (eR4) {}
                    }
                    if (did2) splitCount++;
                } catch (eAi) {}
            }

            if (splitCount === 0) return _err("razor_unsupported_in_this_premiere_version");
            return _data({ splitCount: splitCount, ctiSeconds: ctiSec });
        } catch (e) { return _err(e.message); }
    }

    // -- MIA_addTextOverlay ---------------------------------------------
    // Premiere ES API pra titles legados (newTitle) foi removida em PPro 2022+.
    function MIA_addTextOverlay(text, durationSeconds, fontSizePx) {
        try {
            if (!text) return _err("text required");
            var dur = (typeof durationSeconds === "number" && durationSeconds > 0) ? durationSeconds : 5;
            var size = (typeof fontSizePx === "number" && fontSizePx > 0) ? fontSizePx : 72;
            var seq = _getSeq();
            if (!seq) return _err("no_active_sequence");

            var title = null;
            try {
                if (typeof app.project.newTitle === "function") {
                    title = app.project.newTitle(String(text).substring(0, 32));
                }
            } catch (eT1) {}

            if (!title) {
                return _err("legacy_titles_unavailable_use_mogrt_fallback (PPro 22+ removeu newTitle; use applyMogrtAtCti com template de texto)");
            }

            var ctiSec = _ctiSeconds(seq);
            var vCount = 0;
            try { vCount = seq.videoTracks ? (seq.videoTracks.numTracks || seq.videoTracks.length || 0) : 0; } catch (eVC2) {}
            if (vCount === 0) return _err("no_video_tracks");

            var inserted = false;
            for (var vt2 = vCount - 1; vt2 >= 0 && !inserted; vt2--) {
                try {
                    var trk = seq.videoTracks[vt2];
                    if (!trk) continue;
                    trk.insertClip(title, ctiSec);
                    inserted = true;
                } catch (eIns2) {}
            }
            if (!inserted) return _err("title_insert_failed");

            return _data({
                text: String(text),
                durationSeconds: dur,
                fontSizePx: size,
                ctiSeconds: ctiSec,
                note: "title legacy criado; ajuste de fonte/duracao via UI ou MOGRT recomendado"
            });
        } catch (e) { return _err(e.message); }
    }

    // -- MIA_exportPreview ----------------------------------------------
    function MIA_exportPreview(outPath) {
        try {
            if (!outPath) return _err("outPath required");
            var seq = _getSeq();
            if (!seq) return _err("no_active_sequence");

            if (!app.encoder) return _err("media_encoder_unavailable (AME nao instalado ou nao disponivel via ExtendScript)");

            var queued = null;
            try {
                if (typeof app.encoder.launchEncoder === "function") {
                    try { app.encoder.launchEncoder(); } catch (eL) {}
                }
                if (typeof app.encoder.encodeSequence === "function") {
                    queued = app.encoder.encodeSequence(
                        seq,
                        String(outPath),
                        "",
                        app.encoder.ENCODE_ENTIRE || 0,
                        1
                    );
                }
                if (typeof app.encoder.startBatch === "function") {
                    try { app.encoder.startBatch(); } catch (eSB) {}
                }
            } catch (eEnc) { return _err("encodeSequence_failed: " + eEnc.message); }

            return _data({
                queued: !!queued,
                outPath: String(outPath),
                note: "AME recebeu o job; conclusao depende do encoder rodar a fila"
            });
        } catch (e) { return _err(e.message); }
    }

    // -- Registro no namespace existente --------------------------------
    if ($.global.MotionProIA) {
        $.global.MotionProIA.MIA_getActiveSequence = MIA_getActiveSequence;
        $.global.MotionProIA.MIA_insertClipAtCti   = MIA_insertClipAtCti;
        $.global.MotionProIA.MIA_cutAtCti          = MIA_cutAtCti;
        $.global.MotionProIA.MIA_addTextOverlay    = MIA_addTextOverlay;
        $.global.MotionProIA.MIA_exportPreview     = MIA_exportPreview;
    } else {
        $.global.MotionProIA = {
            MIA_getActiveSequence: MIA_getActiveSequence,
            MIA_insertClipAtCti:   MIA_insertClipAtCti,
            MIA_cutAtCti:          MIA_cutAtCti,
            MIA_addTextOverlay:    MIA_addTextOverlay,
            MIA_exportPreview:     MIA_exportPreview
        };
    }

    $.writeln("[MotionProIA] eta MIA_* functions registered");
})();
