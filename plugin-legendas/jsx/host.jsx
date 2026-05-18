/* ════════════════════════════════════════════════════════════════
 * MotionPro Legendas · host.jsx v4.0
 * ExtendScript do Premiere Pro
 *
 * Replica o protocolo do EP Legendas (EP_*) e mantém aliases
 * MotionProLegendas.* pra compatibilidade.
 * ════════════════════════════════════════════════════════════════ */
$.global._MPL_VERSION = "4.0.0";

(function () {

    function ok(o)  { return JSON.stringify(o == null ? { ok: true } : o); }
    function err(m) { return JSON.stringify({ error: String(m) }); }
    var TICKS_PER_SECOND = 254016000000;

    function trim(s) { return String(s||"").replace(/^\s+|\s+$/g, ""); }

    // ──────────────────────────────────────────────── BASIC
    function EP_ping() {
        return ok({ ok: true, host: app.name, version: app.version, mpl: $.global._MPL_VERSION });
    }
    function EP_isReady() { return ok({ ok: true, loaded: true }); }

    function EP_getCTI() {
        try {
            var seq = app.project && app.project.activeSequence;
            if (!seq) return ok({ ok: false, reason: "no_sequence" });
            return ok({ ok: true, ticks: String(seq.getPlayerPosition().ticks), seconds: seq.getPlayerPosition().seconds });
        } catch (e) { return err(e.message); }
    }

    function EP_getActiveSequenceInfo() {
        try {
            if (!app || !app.project) return ok({ hasSequence: false, reason: "no_project" });
            var seq = app.project.activeSequence;
            if (!seq) return ok({ hasSequence: false, reason: "no_sequence" });
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

    function EP_getAudioTracksInfo() {
        try {
            var seq = app.project && app.project.activeSequence;
            if (!seq) return ok({ ok: false, tracks: [] });
            var t = [];
            for (var i = 0; i < seq.audioTracks.numTracks; i++) {
                t.push({ name: "A" + (i + 1), index: i, clips: seq.audioTracks[i].clips.numItems });
            }
            return ok({ ok: true, tracks: t });
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── TRACK PICKING
    function pickTargetTrack(seq, mode, ticksStr) {
        var n = seq.videoTracks.numTracks;
        if (mode === "last" || mode === "-1" || mode == null) return n - 1;
        var idx = parseInt(mode, 10);
        if (!isNaN(idx)) {
            if (idx >= 0 && idx < n) return idx;
            if (idx === -1) return n - 1;
        }
        if (/^V(\d+)$/.test(String(mode))) {
            var v = Number(String(mode).replace("V", "")) - 1;
            if (v >= 0 && v < n) return v;
        }
        return n - 1;
    }

    // ──────────────────────────────────────────────── INSERT MOGRT
    function EP_hybridInsertMogrt(mogrtPath, ticksStr, trackMode, optsJson) {
        try {
            if (!app || !app.project) return err("Projeto não disponível");
            var seq = app.project.activeSequence;
            if (!seq) return err("Abra uma sequência primeiro");

            var f = new File(mogrtPath);
            if (!f.exists) return err("MOGRT não existe: " + mogrtPath);

            var ticks = ticksStr ? String(ticksStr) : String(seq.getPlayerPosition().ticks);
            var target = pickTargetTrack(seq, trackMode, ticks);

            var clip = seq.importMGT(f.fsName, ticks, target, 0);
            if (!clip) return err("Premiere recusou importar (verifique versão do MOGRT vs Premiere)");

            // avança CTI até o fim do clip
            try {
                var dur = Number(clip.end.ticks) - Number(clip.start.ticks);
                seq.setPlayerPosition(String(Number(ticks) + dur));
            } catch (e) {}

            return ok({ ok: true, track: target, name: clip.name, startTicks: ticks });
        } catch (e) { return err(e.message); }
    }

    // alias legado
    function importMogrt(path) { return EP_hybridInsertMogrt(path, null, null, null); }

    // ──────────────────────────────────────────────── APPLY ONE GROUP (atomic)
    // Importa MOGRT + ajusta duração + troca texto NUMA SÓ CHAMADA, usando o
    // handle retornado por importMGT direto (sem precisar reachar o clip).
    function EP_applyOneGroup(mogrtPath, ticksStr, trackMode, text, durSec) {
        try {
            if (!app || !app.project) return err("Sem projeto");
            var seq = app.project.activeSequence;
            if (!seq) return err("Sem sequência");
            var f = new File(mogrtPath);
            if (!f.exists) return err("MOGRT não existe: " + mogrtPath);

            var ticks = String(ticksStr);
            var target = pickTargetTrack(seq, trackMode, ticks);

            var clip = seq.importMGT(f.fsName, ticks, target, 0);
            if (!clip) return err("Premiere recusou importar");

            // ajusta duração pelo SRT
            try {
                var dur = Number(durSec) || 1.0;
                var startSec = Number(ticks) / TICKS_PER_SECOND;
                var endTicks = String(Math.round((startSec + dur) * TICKS_PER_SECOND));
                clip.end = { ticks: endTicks };
            } catch (eDur) {}

            // troca texto usando o handle DIRETO (não precisa achar de novo)
            var setRes = setMogrtText(clip, text);

            return ok({
                ok: true,
                track: target,
                name: clip.name,
                textChanged: setRes.changed,
                textAttempts: setRes.attempts,
                textError: setRes.error
            });
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── SET TEXT IN MOGRT
    // MOGRTs do EP usam Master Property "Source Text" exposta. Em ExtendScript,
    // o valor pode ser STRING simples OU JSON com o text document do AE.
    // Estratégia: tenta cada componente, cada property, com 3 formatos diferentes
    // até um deles aceitar. Devolve quantos params trocou (>0 = sucesso).
    function setMogrtText(clip, newText) {
        var t = String(newText || "");
        var changed = 0;
        var attempts = 0;
        var lastError = "";

        // valores a tentar:
        //   1) string simples
        //   2) JSON do AE TextDocument: { textEditValue: "..." }
        //   3) JSON com mTextDocument: { mTextDocument: { mString: "..." } }
        var values = [
            t,
            '{"textEditValue":' + JSON.stringify(t) + '}',
            '{"mTextDocument":{"mString":' + JSON.stringify(t) + '}}'
        ];

        function trySet(prop) {
            for (var v = 0; v < values.length; v++) {
                try {
                    prop.setValue(values[v], 1);   // true → updateUI
                    return true;
                } catch (e1) {
                    lastError = String(e1);
                    try { prop.setValue(values[v]); return true; } catch (e2) { lastError = String(e2); }
                }
            }
            return false;
        }

        function isTextProp(p) {
            var n = String(p.displayName || p.name || "").toLowerCase();
            if (n.indexOf("source text") >= 0) return true;
            if (n === "text" || n === "texto") return true;
            if (n.indexOf("text") >= 0 && n.indexOf("color") < 0 && n.indexOf("size") < 0 && n.indexOf("font") < 0) return true;
            // [EP] prefix do EP Legendas
            if (n.indexOf("[ep]") >= 0) return true;
            return false;
        }

        // Coleta todas as properties acessíveis
        var props = [];
        try {
            var mc = clip.getMGTComponent && clip.getMGTComponent();
            if (mc && mc.properties) {
                for (var i = 0; i < mc.properties.numItems; i++) props.push({ p: mc.properties[i], src: "mgt" });
            }
        } catch (e) { lastError = "mc:" + e.message; }
        try {
            var comps = clip.components;
            if (comps) {
                for (var c = 0; c < comps.numItems; c++) {
                    var comp = comps[c];
                    if (!comp.properties) continue;
                    for (var pi = 0; pi < comp.properties.numItems; pi++) props.push({ p: comp.properties[pi], src: "comp" + c });
                }
            }
        } catch (e3) { lastError = "comp:" + e3.message; }

        // Passo 1: tenta SÓ as text-named props primeiro (mais rápido + correto)
        for (var x = 0; x < props.length; x++) {
            var item = props[x];
            if (isTextProp(item.p)) {
                attempts++;
                if (trySet(item.p)) changed++;
            }
        }

        // Passo 2: SE nada mudou, tenta TODAS as props (algumas MOGRTs têm
        // texto exposto com nome custom tipo "Headline", "Title 1", "[EP] frase")
        if (changed === 0) {
            for (var y = 0; y < props.length; y++) {
                var p2 = props[y].p;
                // pula props que já tentamos
                if (isTextProp(p2)) continue;
                // pula visualmente coisas que NÃO são texto
                var n2 = String(p2.displayName || p2.name || "").toLowerCase();
                if (n2.indexOf("color") >= 0 || n2.indexOf("opacity") >= 0 || n2.indexOf("scale") >= 0 ||
                    n2.indexOf("position") >= 0 || n2.indexOf("rotation") >= 0 || n2.indexOf("size") >= 0 ||
                    n2.indexOf("font") >= 0 || n2.indexOf("anchor") >= 0 || n2.indexOf("track") >= 0) continue;
                attempts++;
                if (trySet(p2)) changed++;
                if (changed > 0) break;  // achou — para
            }
        }

        return { changed: changed, attempts: attempts, error: changed === 0 ? lastError : null };
    }

    // ──────────────────────────────────────────────── INSPECT MOGRT (DEBUG)
    // Importa o MOGRT, lista TODAS as propriedades de cada componente,
    // e retorna no JSON pra ver no log do plugin.
    function EP_inspectMogrt(mogrtPath) {
        try {
            if (!app || !app.project) return err("Projeto não disponível");
            var seq = app.project.activeSequence;
            if (!seq) return err("Abra uma sequência");
            var f = new File(mogrtPath);
            if (!f.exists) return err("MOGRT não existe: " + mogrtPath);

            var ticks = String(seq.getPlayerPosition().ticks);
            var target = seq.videoTracks.numTracks - 1;
            var clip = seq.importMGT(f.fsName, ticks, target, 0);
            if (!clip) return err("Premiere recusou importar");

            var report = { ok: true, clipName: clip.name, components: [] };

            // master MGT component
            try {
                var mc = clip.getMGTComponent && clip.getMGTComponent();
                if (mc && mc.properties) {
                    var mcInfo = { name: "MGTComponent", count: mc.properties.numItems, props: [] };
                    for (var i = 0; i < mc.properties.numItems; i++) {
                        var p = mc.properties[i];
                        var info = {
                            idx: i,
                            displayName: String(p.displayName || ""),
                            name: String(p.name || ""),
                            value: "?"
                        };
                        try { info.value = String(p.getValue ? p.getValue() : ""); } catch (e) { info.value = "[err]"; }
                        if (info.value && info.value.length > 80) info.value = info.value.substring(0, 80) + "…";
                        mcInfo.props.push(info);
                    }
                    report.components.push(mcInfo);
                }
            } catch (e1) { report.components.push({ name: "MGTComponent", error: e1.message }); }

            // outros components
            try {
                var comps = clip.components;
                if (comps) {
                    for (var c = 0; c < comps.numItems; c++) {
                        var comp = comps[c];
                        var ci = { name: String(comp.displayName || comp.name || ("comp[" + c + "]")), count: 0, props: [] };
                        if (comp.properties) {
                            ci.count = comp.properties.numItems;
                            for (var pi = 0; pi < comp.properties.numItems; pi++) {
                                var pp = comp.properties[pi];
                                var info = {
                                    idx: pi,
                                    displayName: String(pp.displayName || ""),
                                    name: String(pp.name || ""),
                                    value: "?"
                                };
                                try { info.value = String(pp.getValue ? pp.getValue() : ""); } catch (e) { info.value = "[err]"; }
                                if (info.value && info.value.length > 80) info.value = info.value.substring(0, 80) + "…";
                                ci.props.push(info);
                            }
                        }
                        report.components.push(ci);
                    }
                }
            } catch (e2) { report.componentsErr = e2.message; }

            // Remove o clip de teste
            try { clip.remove(false, true); } catch (e3) {}

            return ok(report);
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── BATCH APPLY
    /**
     * groups: array de { mogrtPath, start (seconds), end (seconds), text, sfxPath?, audioTrack? }
     * opts: { trackMode, disableOriginals }
     */
    function EP_hybridApplyTextsAndTiming(groupsJson, optsJson) {
        try {
            if (!app || !app.project) return err("Projeto não disponível");
            var seq = app.project.activeSequence;
            if (!seq) return err("Abra uma sequência primeiro");

            var groups; try { groups = JSON.parse(groupsJson); } catch (e) { return err("groups inválido: " + e); }
            var opts;   try { opts = JSON.parse(optsJson || "{}"); } catch (e) { opts = {}; }
            if (!groups || !groups.length) return err("Nenhum grupo");

            try { app.beginUndoGroup && app.beginUndoGroup("MotionPro Legendas · SRT batch"); } catch (e) {}

            var applied = 0, failed = 0, errors = [];

            for (var i = 0; i < groups.length; i++) {
                var g = groups[i];
                if (!g || !g.mogrtPath || !g.text) { failed++; continue; }

                var f = new File(g.mogrtPath);
                if (!f.exists) { errors.push("MOGRT não encontrado: " + g.mogrtPath); failed++; continue; }

                var startTicks = String(Math.round(Number(g.start) * TICKS_PER_SECOND));
                var target = pickTargetTrack(seq, opts.trackMode || "last", startTicks);

                try {
                    var clip = seq.importMGT(f.fsName, startTicks, target, 0);
                    if (!clip) { failed++; continue; }

                    // ajusta fim conforme duração do SRT
                    try {
                        var durSec = Math.max(0.4, Number(g.end) - Number(g.start));
                        clip.end = { ticks: String(Math.round((Number(g.start) + durSec) * TICKS_PER_SECOND)) };
                    } catch (eDur) {}

                    setMogrtText(clip, g.text);

                    // SFX opcional por grupo
                    if (g.sfxPath && g.audioTrack) {
                        try { placeSfxAt(seq, g.sfxPath, startTicks, g.audioTrack); } catch (eSfx) {}
                    }

                    applied++;
                } catch (eClip) {
                    failed++;
                    if (errors.length < 5) errors.push("g" + (i+1) + ": " + eClip.message);
                }
            }

            // desativar originais (track ABAIXO da nossa target)
            if (opts.disableOriginals) {
                try { disableTrackBelow(seq, opts.trackMode || "last"); } catch (e) {}
            }

            try { app.endUndoGroup && app.endUndoGroup(); } catch (e) {}
            return ok({ ok: true, applied: applied, failed: failed, errors: errors });
        } catch (e) { return err(e.message); }
    }

    function placeSfxAt(seq, sfxPath, ticks, audioTrackName) {
        var f = new File(sfxPath); if (!f.exists) return false;
        // importa pro bin
        var before = app.project.rootItem.children.numItems;
        app.project.importFiles([f.fsName], false, app.project.rootItem, false);
        var item = app.project.rootItem.children[app.project.rootItem.children.numItems - 1];
        if (!item) return false;
        var idx = 1;
        if (/^A(\d+)$/.test(String(audioTrackName))) idx = Number(String(audioTrackName).replace("A","")) - 1;
        if (idx < 0 || idx >= seq.audioTracks.numTracks) return false;
        try { seq.audioTracks[idx].insertClip(item, String(ticks)); return true; } catch (e) { return false; }
    }

    function disableTrackBelow(seq, trackMode) {
        var target = pickTargetTrack(seq, trackMode, "0");
        if (target <= 0) return;
        var below = seq.videoTracks[target - 1];
        if (!below) return;
        for (var i = 0; i < below.clips.numItems; i++) {
            try { below.clips[i].disabled = true; } catch (e) {}
        }
    }

    // ──────────────────────────────────────────────── CAPTIONS / TRANSCRIPT
    // Tenta MÚLTIPLAS APIs do Premiere:
    //   1. seq.captionTracks (closed captions — quando user cria "Captions from transcript")
    //   2. seq.captionTrack(0) (versão singular, Premiere 2024+)
    //   3. seq.transcripts (transcript propriamente — algumas versões)
    //   4. app.project.transcripts (transcript no project, não na sequência)
    //   5. Procura nos audio clips por transcript metadata
    function EP_readCaptions() {
        try {
            var seq = app.project && app.project.activeSequence;
            if (!seq) return err("Abra uma sequência primeiro");

            var out = [];
            var triedMethods = [];

            // MÉTODO 1: captionTracks (closed caption tracks)
            try {
                if (seq.captionTracks && seq.captionTracks.numTracks > 0) {
                    for (var t = 0; t < seq.captionTracks.numTracks; t++) {
                        var ct = seq.captionTracks[t];
                        if (!ct || !ct.captions) continue;
                        for (var i = 0; i < ct.captions.length; i++) {
                            var c = ct.captions[i];
                            var s, e, x;
                            try { s = Number(c.start.seconds); } catch (er1) { s = 0; }
                            try { e = Number(c.end.seconds); } catch (er2) { e = s + 1; }
                            try { x = String(c.text || ""); } catch (er3) { x = ""; }
                            if (x) out.push({ start: s, end: e, text: x });
                        }
                    }
                    if (out.length) return ok({ ok: true, source: "captionTracks", blocks: out });
                    triedMethods.push("captionTracks:empty");
                } else { triedMethods.push("captionTracks:none"); }
            } catch (eA) { triedMethods.push("captionTracks:err"); }

            // MÉTODO 2: captionTrack singular
            try {
                if (typeof seq.captionTrack === "function") {
                    var ctSingle = seq.captionTrack(0);
                    if (ctSingle && ctSingle.captions) {
                        for (var j = 0; j < ctSingle.captions.length; j++) {
                            var cc = ctSingle.captions[j];
                            try {
                                var ss = Number(cc.start.seconds);
                                var ee = Number(cc.end.seconds);
                                var xx = String(cc.text || "");
                                if (xx) out.push({ start: ss, end: ee, text: xx });
                            } catch (eIn) {}
                        }
                        if (out.length) return ok({ ok: true, source: "captionTrack(0)", blocks: out });
                    }
                    triedMethods.push("captionTrack:empty");
                }
            } catch (eB) { triedMethods.push("captionTrack:err"); }

            // MÉTODO 3: procura transcript no project (raw transcript items)
            try {
                if (app.project.transcripts && app.project.transcripts.length > 0) {
                    for (var k = 0; k < app.project.transcripts.length; k++) {
                        var tr = app.project.transcripts[k];
                        if (tr && tr.segments) {
                            for (var sg = 0; sg < tr.segments.length; sg++) {
                                var seg = tr.segments[sg];
                                try {
                                    var st = Number(seg.startTime);
                                    var en = Number(seg.endTime);
                                    var tx = String(seg.text || seg.speakerText || "");
                                    if (tx) out.push({ start: st, end: en, text: tx });
                                } catch (eS) {}
                            }
                        }
                    }
                    if (out.length) return ok({ ok: true, source: "transcripts", blocks: out });
                    triedMethods.push("transcripts:empty");
                }
            } catch (eC) { triedMethods.push("transcripts:err"); }

            // Nenhum método funcionou — devolve erro acionável
            return err("Transcrição não encontrada via API. No Premiere: 1) Window → Text → Captions (não Transcript). 2) 'Create captions from transcript'. 3) Volte aqui. Tentei: " + triedMethods.join(", "));
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── HYBRID CAPTURE SELECTION
    function EP_hybridCaptureSelection() {
        try {
            var seq = app.project && app.project.activeSequence;
            if (!seq) return err("Abra uma sequência primeiro");
            var sel = [];
            for (var i = 0; i < seq.videoTracks.numTracks; i++) {
                var tr = seq.videoTracks[i];
                for (var j = 0; j < tr.clips.numItems; j++) {
                    var c = tr.clips[j];
                    if (c.isSelected && c.isSelected()) {
                        sel.push({
                            name: c.name,
                            start: c.start.seconds,
                            end: c.end.seconds,
                            track: i + 1,
                            ticks: String(c.start.ticks)
                        });
                    }
                }
            }
            return ok({ ok: true, clips: sel });
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── FILE DIALOGS
    function EP_selectSRTFile() {
        try {
            var f = File.openDialog("Selecione arquivo SRT", "SRT/VTT:*.srt;*.vtt");
            if (!f) return ok({ ok: false, canceled: true });
            return ok({ ok: true, path: f.fsName, name: f.name });
        } catch (e) { return err(e.message); }
    }

    function EP_selectMogrtFile() {
        try {
            var f = File.openDialog("Selecione .MOGRT", "MOGRT:*.mogrt");
            if (!f) return ok({ ok: false, canceled: true });
            return ok({ ok: true, path: f.fsName, name: f.name });
        } catch (e) { return err(e.message); }
    }

    function EP_selectImageFile() {
        try {
            var f = File.openDialog("Selecione imagem", "Imagens:*.png;*.jpg;*.jpeg;*.gif;*.webp");
            if (!f) return ok({ ok: false, canceled: true });
            return ok({ ok: true, path: f.fsName, name: f.name });
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── DATA FOLDER
    function EP_getDataFolderPath() {
        try {
            var base = Folder.userData.fsName + "/MotionProLegendas";
            var f = new Folder(base);
            if (!f.exists) f.create();
            return ok({ ok: true, path: base });
        } catch (e) { return err(e.message); }
    }

    function EP_openDataFolder() {
        try {
            var r = JSON.parse(EP_getDataFolderPath());
            if (r.ok) { var f = new Folder(r.path); f.execute(); return ok({ ok: true }); }
            return err(r.error || "no_path");
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── FONT INSTALL
    // Copia fontes do plugin/fonts pra %LOCALAPPDATA%\Microsoft\Windows\Fonts
    // que é o destino user-mode (não precisa admin).
    function EP_installFonts(fontsSrcPath) {
        try {
            var srcDir = new Folder(fontsSrcPath);
            if (!srcDir.exists) return err("Pasta de fontes não existe: " + fontsSrcPath);

            // Acha pasta de fontes do user
            var localAppData = "";
            try { localAppData = $.getenv("LOCALAPPDATA"); } catch (e) {}
            if (!localAppData) return err("LOCALAPPDATA não definido");

            var userFontDir = new Folder(localAppData + "/Microsoft/Windows/Fonts");
            if (!userFontDir.exists) userFontDir.create();

            var fontFiles = srcDir.getFiles(/\.(ttf|otf|TTF|OTF)$/);
            var installed = 0;
            var skipped = 0;
            var errors = [];
            var alreadyInstalled = [];

            for (var i = 0; i < fontFiles.length; i++) {
                var f = fontFiles[i];
                var dest = new File(userFontDir.fsName + "/" + f.name);
                try {
                    if (dest.exists) {
                        alreadyInstalled.push(f.name);
                        skipped++;
                    } else {
                        if (f.copy(dest.fsName)) {
                            installed++;
                            // registra no registry pra Windows reconhecer
                            try {
                                var regCmd = 'reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" /v "' +
                                    f.name.replace(/\.(ttf|otf)$/i, "") + ' (' + (f.name.match(/\.ttf$/i) ? "TrueType" : "OpenType") + ')" /t REG_SZ /d "' +
                                    dest.fsName.replace(/\\/g, "\\\\") + '" /f';
                                if (system && system.callSystem) system.callSystem(regCmd);
                            } catch (eReg) {}
                        } else {
                            errors.push(f.name);
                        }
                    }
                } catch (eCp) {
                    errors.push(f.name + ": " + eCp.message);
                }
            }

            return ok({
                ok: true,
                installed: installed,
                skipped: skipped,
                alreadyInstalled: alreadyInstalled.slice(0, 5),
                errors: errors,
                fontDir: userFontDir.fsName,
                note: "Fontes instaladas no user space. Pode ser necessário reiniciar o Premiere pra elas aparecerem."
            });
        } catch (e) { return err(e.message); }
    }

    // Checa quantas fontes do plugin já estão instaladas
    function EP_checkFonts(fontsSrcPath) {
        try {
            var srcDir = new Folder(fontsSrcPath);
            if (!srcDir.exists) return ok({ ok: false, missing: 0, total: 0, reason: "no_src" });

            var localAppData = "";
            try { localAppData = $.getenv("LOCALAPPDATA"); } catch (e) {}
            var userFontDir = new Folder(localAppData + "/Microsoft/Windows/Fonts");
            var winFontDir = new Folder("C:/Windows/Fonts");

            var fontFiles = srcDir.getFiles(/\.(ttf|otf|TTF|OTF)$/);
            var installed = 0, missing = 0;
            var missingNames = [];

            for (var i = 0; i < fontFiles.length; i++) {
                var name = fontFiles[i].name;
                var inUser = new File(userFontDir.fsName + "/" + name);
                var inSys = new File(winFontDir.fsName + "/" + name);
                if (inUser.exists || inSys.exists) installed++;
                else { missing++; missingNames.push(name); }
            }

            return ok({
                ok: true,
                total: fontFiles.length,
                installed: installed,
                missing: missing,
                missingNames: missingNames.slice(0, 5)
            });
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── EXPORT
    $.global.MotionProLegendas = {
        // novos nomes (EP-compat)
        EP_ping: EP_ping,
        EP_isReady: EP_isReady,
        EP_getCTI: EP_getCTI,
        EP_getActiveSequenceInfo: EP_getActiveSequenceInfo,
        EP_getAudioTracksInfo: EP_getAudioTracksInfo,
        EP_hybridInsertMogrt: EP_hybridInsertMogrt,
        EP_hybridApplyTextsAndTiming: EP_hybridApplyTextsAndTiming,
        EP_applyOneGroup: EP_applyOneGroup,
        EP_hybridCaptureSelection: EP_hybridCaptureSelection,
        EP_readCaptions: EP_readCaptions,
        EP_selectSRTFile: EP_selectSRTFile,
        EP_selectMogrtFile: EP_selectMogrtFile,
        EP_selectImageFile: EP_selectImageFile,
        EP_getDataFolderPath: EP_getDataFolderPath,
        EP_openDataFolder: EP_openDataFolder,
        EP_inspectMogrt: EP_inspectMogrt,
        EP_installFonts: EP_installFonts,
        EP_checkFonts: EP_checkFonts,
        // helper texto utilizável pelo main.js via $.global.setMogrtTextOnClip
        _setMogrtText: setMogrtText,
        // aliases legados
        ping: EP_ping,
        importMogrt: importMogrt,
        importAtom: importMogrt,
        applySrtBatch: function (mogrtPath, blocksJson, optsJson) {
            // converte pra format groups
            var blocks; try { blocks = JSON.parse(blocksJson); } catch (e) { return err("blocks inválido"); }
            var groups = blocks.map(function (b) { return { mogrtPath: mogrtPath, start: b.start, end: b.end, text: b.text }; });
            return EP_hybridApplyTextsAndTiming(JSON.stringify(groups), optsJson);
        },
        readActiveCaptions: EP_readCaptions,
        importAudioFile: function (audioPath, positionsJson, audioTrack) {
            try {
                var seq = app.project && app.project.activeSequence;
                if (!seq) return err("Abra uma sequência primeiro");
                var positions; try { positions = JSON.parse(positionsJson); } catch (e) { return err("positions inválido"); }
                var f = new File(audioPath); if (!f.exists) return err("Áudio não existe: " + audioPath);

                // resolve track index
                var trackIdx = 1;
                if (/^A(\d+)$/.test(String(audioTrack))) trackIdx = Number(String(audioTrack).replace("A","")) - 1;
                if (trackIdx < 0 || trackIdx >= seq.audioTracks.numTracks) {
                    return err("Audio track " + audioTrack + " não existe (sequência tem " + seq.audioTracks.numTracks + " tracks)");
                }
                var at = seq.audioTracks[trackIdx];
                if (at.isLocked && at.isLocked()) return err("Track " + audioTrack + " está travada");

                // importa o arquivo UMA vez no projeto
                var before = app.project.rootItem.children.numItems;
                var imported = app.project.importFiles([f.fsName], false, app.project.rootItem, false);
                var item = null;
                // procura o item recém-importado pelo nome
                for (var x = app.project.rootItem.children.numItems - 1; x >= 0; x--) {
                    var ch = app.project.rootItem.children[x];
                    if (ch && ch.name && ch.name.indexOf(f.displayName.replace(/\.[^.]+$/,"")) >= 0) { item = ch; break; }
                }
                if (!item && app.project.rootItem.children.numItems > before) {
                    item = app.project.rootItem.children[app.project.rootItem.children.numItems - 1];
                }
                if (!item) return err("Falha ao importar SFX (project item não encontrado)");

                var placed = 0; var errors = [];
                for (var i = 0; i < positions.length; i++) {
                    try {
                        at.insertClip(item, String(positions[i]));
                        placed++;
                    } catch (eIns) {
                        if (errors.length < 3) errors.push("pos " + i + ": " + eIns.message);
                    }
                }
                return ok({ ok: true, placed: placed, total: positions.length, track: audioTrack, errors: errors });
            } catch (e) { return err(e.message); }
        },
        getActiveSequenceInfo: EP_getActiveSequenceInfo
    };

})();

// expõe direto no global pra compatibilidade total com chamadas EP_*
for (var k in $.global.MotionProLegendas) {
    if (k.indexOf("EP_") === 0) {
        try { $.global[k] = $.global.MotionProLegendas[k]; } catch (e) {}
    }
}
$.global._setMogrtTextOnClip = $.global.MotionProLegendas._setMogrtText;

"MPL host loaded v" + $.global._MPL_VERSION;
