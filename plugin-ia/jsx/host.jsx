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
            for (var i = 0; i < arr.length; i++) {
                var sec = Number(arr[i]);
                var nm = outDir.replace(/[\\/]$/, "") + "/" + prefix + i + "_" + Math.round(sec * 1000) + "ms.png";
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
            // Premiere expõe app.project.activeSequence.clone() em versões recentes
            var clone = null;
            try { if (seq.clone) clone = seq.clone(); } catch (eC) {}
            if (!clone) return err("clone_not_supported (use ensureQE + QE clone)");
            if (newName && clone.name !== undefined) {
                try { clone.name = newName; } catch (eN) {}
            }
            // Abre a nova
            try { app.project.openSequence(clone.sequenceID); } catch (eO) {}
            return ok({ name: clone.name, id: clone.sequenceID });
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
    // Aplica Cross Dissolve em todos os boundaries de clip nas video tracks
    function applyTransitionsAllCuts(durationSec, transitionName) {
        try {
            var seq = getSeq();
            if (!seq) return err("Sem sequência");
            if (!ensureQE()) return err("qe_dom_required_for_transitions");
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) return err("qe_no_active_sequence");

            transitionName = transitionName || "Cross Dissolve";
            durationSec = Number(durationSec || 1);
            // QE addTransition: track.addTransition(name, ?alignment, ?duration, ?atTime)
            var applied = 0, failed = 0;

            for (var t = 0; t < qeSeq.numVideoTracks; t++) {
                var qeTrack;
                try { qeTrack = qeSeq.getVideoTrackAt(t); } catch (eT) { continue; }
                if (!qeTrack || qeTrack.numItems == null) continue;
                // Aplica entre cada item adjacente
                for (var i = 0; i < qeTrack.numItems - 1; i++) {
                    try {
                        var clipA = qeTrack.getItemAt(i);
                        if (!clipA || clipA.type !== "Clip") continue;
                        // addTransition(transitionName, alignmentCenter=true, durationStr, atTimecode)
                        // Tenta API mais comum:
                        try {
                            clipA.addTransition(transitionName, false, _secToTimeStr(durationSec), clipA.end);
                            applied++;
                        } catch (eA) {
                            // Fallback: addVideoTransition
                            try {
                                qeTrack.addVideoTransition(transitionName, _secToTimeStr(durationSec), clipA.end, true);
                                applied++;
                            } catch (eB) { failed++; }
                        }
                    } catch (eC) { failed++; }
                }
            }
            return ok({ applied: applied, failed: failed, transition: transitionName, duration_sec: durationSec });
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
            return ok({ moved: moved, bins_created: Object.keys(binNames).length });
        } catch (e) { return err(e.message); }
    }

    // ─── MULTICAM ────────────────────────────────────────────────────
    function createMulticamFromSelected() {
        try {
            // Premiere: app.project.createNewSequenceFromClips / createMulticamSequence
            if (!app.project) return err("Sem project");
            var sel = (app.project.getSelection && app.project.getSelection()) || [];
            if (!sel.length) return err("Selecione 2+ clips no Project Panel");
            // app.project.createNewSequenceFromClips não existe oficialmente
            // Workaround: cria nova sequência + insere clips em tracks separadas
            try {
                var seq = app.project.createNewSequence("MultiCam_" + Date.now(), "MultiCam");
                for (var i = 0; i < sel.length; i++) {
                    if (seq.videoTracks && seq.videoTracks[i] && sel[i] && sel[i].canProxy) {
                        seq.videoTracks[i].insertClip(sel[i], 0);
                    }
                }
                return ok({ sequence: seq.name, clips: sel.length });
            } catch (eS) { return err("multicam_create_fail: " + eS.message); }
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
