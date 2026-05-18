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
    function EP_applyOneGroup(mogrtPath, ticksStr, trackMode, text, durSec, slotIndicesJson) {
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

            // Parse slot indices override (do slot-info.json)
            var slotIdx = null;
            if (slotIndicesJson) {
                try { slotIdx = JSON.parse(slotIndicesJson); } catch (eP) {}
            }

            // troca texto usando o handle DIRETO (não precisa achar de novo)
            var setRes = setMogrtText(clip, text, slotIdx);

            return ok({
                ok: true,
                track: target,
                name: clip.name,
                textChanged: setRes.changed,
                textAttempts: setRes.attempts,
                textSlots: setRes.slots,
                textSlotNames: setRes.slotNames,
                textAssignment: setRes.assignment,
                textMode: setRes.mode,
                textError: setRes.error
            });
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── DIAGNOSE TEMPLATE SLOTS
    // Importa o MOGRT, identifica TODAS as text-slot detectadas pelo
    // setMogrtText logic (mas sem trocar valor), retorna lista detalhada.
    // Útil pra diagnosticar templates "estranhos" sem ter que aplicar.
    function EP_diagnoseTemplateSlots(mogrtPath) {
        try {
            if (!app || !app.project) return err("Sem projeto");
            var seq = app.project.activeSequence;
            if (!seq) return err("Sem sequência");
            var f = new File(mogrtPath);
            if (!f.exists) return err("MOGRT não existe: " + mogrtPath);

            var ticks = String(seq.getPlayerPosition().ticks);
            var target = seq.videoTracks.numTracks - 1;
            var clip = seq.importMGT(f.fsName, ticks, target, 0);
            if (!clip) return err("Premiere recusou importar");

            // Roda o setMogrtText com texto dummy só pra coletar slots detectados
            // (faz a detecção mas vai trocar valor — usa um texto reconhecível)
            var setRes = setMogrtText(clip, "__MPL_PROBE__");

            var info = {
                ok: true,
                clipName: clip.name,
                slotsDetected: setRes.slots,
                slotNames: setRes.slotNames,
                mode: setRes.mode,
                assignment: setRes.assignment
            };

            // Lista TODAS as master props pra comparação
            try {
                var mc = clip.getMGTComponent && clip.getMGTComponent();
                if (mc && mc.properties) {
                    info.allMasterProps = [];
                    for (var i = 0; i < mc.properties.numItems; i++) {
                        var p = mc.properties[i];
                        var entry = {
                            idx: i,
                            displayName: String(p.displayName || ""),
                            name: String(p.name || ""),
                            value: ""
                        };
                        try {
                            var raw = p.getValue ? p.getValue() : "";
                            var s = String(raw);
                            entry.value = s.length > 100 ? s.substring(0, 100) + "…" : s;
                        } catch (eVal) { entry.value = "[err:" + eVal.message + "]"; }
                        info.allMasterProps.push(entry);
                    }
                }
            } catch (eList) { info.listErr = eList.message; }

            // Remove o clip de diagnose
            try { clip.remove(false, true); } catch (e3) {}

            return ok(info);
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── SET TEXT IN MOGRT
    // MOGRTs do EP usam Master Property "Source Text" exposta.
    //
    // MULTI-SLOT FIX (v4.16):
    // Templates EP nomeiam slots com o placeholder original ("tempo", "de um",
    // "tratamento", "convencional_") e expõem cada slot com nome `[EP] {nome}`.
    // Modifiers usam separador ` | `: `[EP] tempo | Rotacao`, `[EP] tempo | Fill`.
    //
    // ALGUNS TEMPLATES TÊM BUG NO NOME (autor copiou e colou errado) — o slot
    // "convencional_" aparece como `[EP] tempo | Rotacao`, igual ao modifier.
    // Pra lidar com isso, classificação é em ORDEM DE CERTEZA:
    //   1. VALOR é JSON text document → text slot (certeza absoluta)
    //   2. Nome `[EP] xxx` SEM ` | ` separador → text slot EP (alta certeza)
    //   3. VALOR é string razoável e nome não tem keyword de modifier → text slot
    //   4. Tudo mais → não-texto
    function setMogrtText(clip, newText, slotIndicesOverride) {
        var t = String(newText || "");
        var changed = 0;
        var attempts = 0;
        var lastError = "";
        var mode = "single";
        var detectedNames = [];

        function valuesFor(s) {
            return [
                String(s == null ? "" : s),
                '{"textEditValue":' + JSON.stringify(String(s == null ? "" : s)) + '}',
                '{"mTextDocument":{"mString":' + JSON.stringify(String(s == null ? "" : s)) + '}}'
            ];
        }

        function trySet(prop, slotText) {
            var values = valuesFor(slotText);
            for (var v = 0; v < values.length; v++) {
                try {
                    prop.setValue(values[v], 1);
                    return true;
                } catch (e1) {
                    lastError = String(e1);
                    try { prop.setValue(values[v]); return true; } catch (e2) { lastError = String(e2); }
                }
            }
            return false;
        }

        // Helper: nome de modifier? Usado pra desempate quando VALOR não decide.
        function hasModifierSuffix(n) {
            // EP padrão: "[EP] xxx | Rotacao" — separador " | " indica modifier
            if (n.indexOf(" | ") >= 0) return true;
            return false;
        }
        function hasModifierKeyword(n) {
            n = String(n || "").toLowerCase();
            var keys = ["color","fill","stroke","rotac","rotat","opacid","opacit",
                        "escal","scale","posic","posit","track","fonte","font",
                        "tamanh","size","weight","anchor","leading","kerning",
                        "outline","shadow","glow","blur","contrast","brightness",
                        "tint","saturation","hue","margin","padding","spacing"];
            for (var i = 0; i < keys.length; i++) {
                if (n.indexOf(keys[i]) >= 0) return true;
            }
            return false;
        }

        // Detecta se a prop é um text slot.
        // ORDEM DE CERTEZA (top = mais confiável):
        //   1. VALOR é JSON text document → text slot (CERTEZA)
        //   2. Nome `[EP] xxx` SEM ` | ` → text slot EP (ALTA confiança)
        //   3. VALOR é string razoável (não numérica/hex/JSON estrutural) → text slot
        //   4. Tudo mais → null (não é texto)
        function classifyTextProp(prop) {
            var n = String(prop.displayName || prop.name || "");
            var nl = n.toLowerCase();
            var v;
            try { v = String(prop.getValue ? prop.getValue() : ""); } catch (e) { return null; }
            if (v == null) v = "";
            var clean = v.replace(/\s/g, "");

            // CASE 1: VALOR é JSON text document — text slot CERTEZA
            // Funciona mesmo se o nome for "rotacao" bugado (caso convencional_ do Texto 04)
            if (v.indexOf('"textEditValue"') >= 0 ||
                v.indexOf('"mTextDocument"') >= 0 ||
                v.indexOf('"mString"') >= 0) {
                return { kind: "textdoc", currentValue: v, displayName: n };
            }

            // CASE 2: Nome `[EP] xxx` SEM ` | ` separador — text slot EP
            // Esse padrão é específico dos templates do EP Legendas.
            // Pega slots EP mesmo quando o valor é string simples sem JSON envelope.
            if (nl.indexOf("[ep]") >= 0 && !hasModifierSuffix(n)) {
                return { kind: "ep-slot", currentValue: v, displayName: n };
            }

            // CASE 3: Exclusão por VALOR — coisas que NUNCA são texto
            if (/^-?\d+(\.\d+)?$/.test(clean)) return null;              // número puro
            if (/^#?[0-9a-f]{6,8}$/i.test(clean)) return null;           // hex color
            if (/^\{.*"x".*"y".*\}$/.test(clean)) return null;           // {x,y} position
            if (/^\[\s*-?[\d.,\s-]+\]$/.test(clean)) return null;        // array [r,g,b,a]

            // CASE 4: Exclusão por NOME (modifier obvio que escapou por ter valor estranho)
            if (hasModifierSuffix(n)) return null;
            if (hasModifierKeyword(nl)) return null;

            // CASE 5: nome explicitamente de texto
            if (nl.indexOf("source text") >= 0 || nl === "text" || nl === "texto" ||
                nl.indexOf("headline") >= 0 || nl.indexOf("title") >= 0) {
                return { kind: "named-text", currentValue: v, displayName: n };
            }

            // CASE 6: string razoável — chuta como text slot
            if (v.length > 0 && v.length < 300) {
                return { kind: "string-guess", currentValue: v, displayName: n };
            }
            return null;
        }

        // Coleta props do MGT component (master) — onde os Source Text expostos vivem
        var mgtProps = [];
        try {
            var mc = clip.getMGTComponent && clip.getMGTComponent();
            if (mc && mc.properties) {
                for (var i = 0; i < mc.properties.numItems; i++) {
                    mgtProps.push(mc.properties[i]);
                }
            }
        } catch (e) { lastError = "mc:" + e.message; }

        var textProps = [];

        // ═══ MODO EXATO ═══ (preferido — usa slot-info.json pré-computado)
        // Se o caller passou slotIndices, usa direto. Esses índices vêm de
        // pré-análise do definition.json (clientControls type=6 = TEXT_FONT).
        // É 100% confiável — bypassa toda heurística de nome/valor.
        if (slotIndicesOverride && slotIndicesOverride.length > 0) {
            for (var si = 0; si < slotIndicesOverride.length; si++) {
                var idx = Number(slotIndicesOverride[si]);
                if (idx >= 0 && idx < mgtProps.length) {
                    var p = mgtProps[idx];
                    var n = String(p.displayName || p.name || "?");
                    textProps.push({ p: p, info: { kind: "exact-idx", displayName: n }, mgtIdx: idx });
                    detectedNames.push("[" + idx + "]" + n + "·exact");
                }
            }
            mode = "exact-idx-" + textProps.length;
        }

        // ═══ MODO HEURÍSTICA ═══ (fallback se não tem slot-info)
        if (textProps.length === 0) {
            var seenKeys = {};
            for (var k = 0; k < mgtProps.length; k++) {
                var pH = mgtProps[k];
                var info = classifyTextProp(pH);
                if (!info) continue;
                var key = info.displayName + "|" + info.kind + "|" + (info.currentValue.length > 40 ? info.currentValue.substring(0,40) : info.currentValue);
                if (seenKeys[key]) continue;
                seenKeys[key] = true;
                textProps.push({ p: pH, info: info, mgtIdx: k });
                detectedNames.push("[" + k + "]" + info.displayName + "·" + info.kind);
            }
        }

        // Se NÃO achou nada nas master props, busca em todos os components (fallback)
        if (textProps.length === 0) {
            var seenKeys2 = {};
            try {
                var comps = clip.components;
                if (comps) {
                    for (var c = 0; c < comps.numItems; c++) {
                        var comp = comps[c];
                        if (!comp.properties) continue;
                        for (var pi = 0; pi < comp.properties.numItems; pi++) {
                            var pp = comp.properties[pi];
                            var info2 = classifyTextProp(pp);
                            if (!info2) continue;
                            var key2 = info2.displayName + "|" + info2.kind + "|c" + c;
                            if (seenKeys2[key2]) continue;
                            seenKeys2[key2] = true;
                            textProps.push({ p: pp, info: info2, mgtIdx: -1 });
                            detectedNames.push("c" + c + "[" + pi + "]" + info2.displayName + "·" + info2.kind);
                        }
                    }
                }
            } catch (e3) { lastError = "comp:" + e3.message; }
        }

        // Tokeniza palavras do input
        var words = t.split(/\s+/);
        var wordsTrim = [];
        for (var wi = 0; wi < words.length; wi++) {
            if (words[wi] !== "") wordsTrim.push(words[wi]);
        }

        // Pipeline de distribuição: P1, P2, P3... (uma posição por slot)
        // Cada slot recebe exatamente UMA palavra. Sobras vão pro último slot.
        var assignment = [];
        if (textProps.length >= 2) {
            mode = "multi-slot-P1..P" + textProps.length;
            for (var s = 0; s < textProps.length; s++) {
                var slotText;
                if (s < wordsTrim.length) {
                    if (s === textProps.length - 1 && wordsTrim.length > textProps.length) {
                        slotText = wordsTrim.slice(s).join(" ");
                    } else {
                        slotText = wordsTrim[s];
                    }
                } else {
                    slotText = "";
                }
                assignment.push("P" + (s+1) + "=\"" + slotText + "\"→" + textProps[s].info.displayName);
                attempts++;
                if (trySet(textProps[s].p, slotText)) changed++;
            }
        } else if (textProps.length === 1) {
            mode = "single-P1";
            assignment.push("P1=\"" + t + "\"→" + textProps[0].info.displayName);
            attempts++;
            if (trySet(textProps[0].p, t)) changed++;
        }

        // Fallback final: nada funcionou, tenta TODAS as master props com a frase inteira
        if (changed === 0) {
            mode = "fallback-all";
            for (var y = 0; y < mgtProps.length; y++) {
                var p2 = mgtProps[y];
                var nm = String(p2.displayName || p2.name || "").toLowerCase();
                if (isModifierName(nm)) continue;
                attempts++;
                if (trySet(p2, t)) { changed++; break; }
            }
        }

        return {
            changed: changed,
            attempts: attempts,
            slots: textProps.length,
            slotNames: detectedNames,
            assignment: assignment,
            mode: mode,
            error: changed === 0 ? lastError : null
        };
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

                    setMogrtText(clip, g.text, g.slotIndices || null);

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

    // ──────────────────────────────────────────────── CHECK FONTS ON SYSTEM
    // Verifica por PostScript name (HelveticaNeue-Bold, ChamberiDisplay-Italic)
    // se a fonte está instalada no Windows. Lê o registry pra cruzar.
    // Recebe lista de PostScript names; devolve quais estão presentes/ausentes.
    function EP_checkSystemFonts(fontPostScriptNamesJson) {
        try {
            var names; try { names = JSON.parse(fontPostScriptNamesJson); } catch (e) { return err("names inválido"); }
            if (!names || !names.length) return ok({ ok: true, installed: [], missing: [] });

            // PowerShell pra listar fontes instaladas com seus PostScript names
            // Lê tanto HKLM (system) quanto HKCU (user)
            var tmp = Folder.temp.fsName + "/_mpl_fonts_list.txt";
            var psCmd =
                "powershell -NoProfile -Command \"" +
                "$paths=@('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'," +
                "'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts');" +
                "$out=@(); foreach($p in $paths){" +
                "try{ (Get-ItemProperty $p).PSObject.Properties | ? { $_.Name -notmatch '^PS' } | %% { $out += $_.Name + '|' + $_.Value } }catch{} }; " +
                "$out -join \\\"`n\\\" | Out-File -FilePath '" + tmp.replace(/\\/g, "\\\\") + "' -Encoding utf8" +
                "\"";
            if (system && system.callSystem) system.callSystem(psCmd);

            var f = new File(tmp);
            var installedReg = "";
            if (f.exists) {
                f.encoding = "UTF-8";
                f.open("r"); installedReg = f.read(); f.close();
            }
            // installedReg formato: "Helvetica Bold (TrueType)|HELVETICA-BOLD.TTF\n..."

            var installed = [], missing = [];
            for (var i = 0; i < names.length; i++) {
                var psName = names[i];
                // Fonte é instalada se aparece em alguma chave do registry
                // Comparação fuzzy: psName "HelveticaNeue-Bold" vs registry "Helvetica Neue Bold (OpenType)"
                if (isFontRegistered(psName, installedReg)) {
                    installed.push(psName);
                } else {
                    missing.push(psName);
                }
            }
            return ok({ ok: true, installed: installed, missing: missing });
        } catch (e) { return err(e.message); }
    }

    // Fuzzy match: PostScript name "HelveticaNeue-Bold" deve achar registry
    // "Helvetica Neue Bold (TrueType)" — comparamos letras/dígitos lowercase.
    function isFontRegistered(psName, registryDump) {
        if (!psName || !registryDump) return false;
        var key = String(psName).toLowerCase().replace(/[^a-z0-9]/g, "");
        var lines = registryDump.split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].split("|")[0].toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
            if (!line) continue;
            // match exato OU contém OU é contido
            if (line === key) return true;
            if (line.indexOf(key) >= 0) return true;
            if (key.indexOf(line) >= 0 && line.length >= 6) return true;
        }
        return false;
    }

    // ──────────────────────────────────────────────── INSPECT TEMPLATE FONTS
    // Lê o definition.json de cada .mogrt e retorna a lista de fontes que ele
    // realmente usa (PostScript names). MOGRTs do EP usam HelveticaNeue-* que
    // NÃO está na pasta /fonts shipped → Premiere substitui silenciosamente.
    function EP_inspectTemplateFonts(packsDir) {
        try {
            // packsDir = .../packs/ep-texto OU passar diretamente uma pasta
            var dir = new Folder(packsDir);
            if (!dir.exists) return err("packs dir não existe: " + packsDir);

            var mogrts = dir.getFiles(/\.mogrt$/);
            var fontUsage = {};        // { "HelveticaNeue-Bold": ["Texto 13.mogrt", ...] }
            var templateFonts = {};    // { "Texto 13": ["HelveticaNeue-Bold"] }

            for (var i = 0; i < mogrts.length; i++) {
                var m = mogrts[i];
                var tplName = m.name.replace(/\.mogrt$/i, "");
                var fonts = readMogrtFonts(m.fsName);
                templateFonts[tplName] = fonts;
                for (var j = 0; j < fonts.length; j++) {
                    var fn = fonts[j];
                    if (!fontUsage[fn]) fontUsage[fn] = [];
                    fontUsage[fn].push(tplName);
                }
            }

            return ok({
                ok: true,
                total: mogrts.length,
                fontUsage: fontUsage,
                templateFonts: templateFonts
            });
        } catch (e) { return err(e.message); }
    }

    // Lê o ZIP do MOGRT (que é um .zip), extrai definition.json e pega
    // a lista de fontes via fontEditValue dos capParams.
    // ExtendScript não tem unzip nativo, mas $.evalFile + binarystring
    // pode resolver. Como workaround: usa shell `tar -xf` no Windows 10+
    // (tem suporte nativo a zip). Se falhar, retorna lista vazia.
    function readMogrtFonts(mogrtPath) {
        var fonts = [];
        try {
            // Usa o tmp do user pra extrair só o definition.json
            var tmp = Folder.temp.fsName + "/_mpl_mogrt_inspect";
            var tmpFolder = new Folder(tmp);
            if (!tmpFolder.exists) tmpFolder.create();
            // Limpa anterior
            try {
                var defFile = new File(tmp + "/definition.json");
                if (defFile.exists) defFile.remove();
            } catch (e) {}

            // PowerShell pra extrair só definition.json
            var cmd = 'powershell -NoProfile -Command "' +
                "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
                "$zip = [System.IO.Compression.ZipFile]::OpenRead('" + mogrtPath.replace(/'/g, "''") + "'); " +
                "$entry = $zip.Entries | Where-Object { $_.Name -eq 'definition.json' } | Select-Object -First 1; " +
                "if ($entry) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '" + (tmp + "/definition.json").replace(/'/g, "''") + "', $true); } " +
                "$zip.Dispose()" +
                '"';
            if (system && system.callSystem) system.callSystem(cmd);

            var dfFile = new File(tmp + "/definition.json");
            if (!dfFile.exists) return fonts;
            dfFile.encoding = "UTF-8";
            dfFile.open("r");
            var content = dfFile.read();
            dfFile.close();

            // Regex pra pegar fontEditValue (mais robusto que parse completo do JSON)
            var fontRegex = /"fontEditValue"\s*:\s*("([^"]+)"|\[\s*"([^"]+)"\s*\])/g;
            var match;
            var seen = {};
            while ((match = fontRegex.exec(content)) !== null) {
                var f = match[2] || match[3];
                if (f && !seen[f]) { seen[f] = true; fonts.push(f); }
            }
        } catch (e) {}
        return fonts;
    }

    // ──────────────────────────────────────────────── INJECT MODE
    // Em vez de importar MOGRT e tentar setar texto via setValue (problemático
    // com slots multi-palavra), gera MOGRTs CUSTOMIZADOS em disco com o texto
    // já substituído no definition.json, depois importa esses.
    //
    // É garantido funcionar porque o Premiere apenas LÊ o placeholder do mogrt;
    // não precisa setar via API. Cada palavra já vem no slot certo do template.
    //
    // FASE 1: Prepara N mogrts customizados em batch via PowerShell.
    // FASE 2: Premiere importa cada custom mogrt (sem PowerShell envolvido).
    function EP_prepareInjectMogrts(jobsJson) {
        try {
            var jobs; try { jobs = JSON.parse(jobsJson); } catch (e) { return err("jobs inválido: " + e.message); }
            if (!jobs || !jobs.length) return err("jobs vazio");

            // Pasta tmp dedicada
            var tmpDir = Folder.temp.fsName + "/_mpl_inject";
            var tmpFolder = new Folder(tmpDir);
            if (!tmpFolder.exists) tmpFolder.create();

            // Escreve arquivo de jobs
            var jobsFile = new File(tmpDir + "/jobs.json");
            jobsFile.encoding = "UTF-8";
            jobsFile.open("w");
            jobsFile.write(JSON.stringify(jobs));
            jobsFile.close();

            // Arquivo de resultado
            var resultFile = new File(tmpDir + "/result.json");
            if (resultFile.exists) resultFile.remove();

            // Roda PowerShell pra processar TODOS os jobs de uma vez
            var psScript = tmpDir + "/process.ps1";
            writePowerShellScript(psScript);

            var cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + psScript +
                      '" -JobsFile "' + jobsFile.fsName +
                      '" -ResultFile "' + resultFile.fsName + '"';
            if (system && system.callSystem) system.callSystem(cmd);

            // Lê resultado
            if (!resultFile.exists) return err("PowerShell não gerou result");
            resultFile.encoding = "UTF-8";
            resultFile.open("r");
            var resultRaw = resultFile.read();
            resultFile.close();
            var result; try { result = JSON.parse(resultRaw); } catch (e) { return err("result inválido: " + resultRaw.substring(0, 200)); }
            return ok(result);
        } catch (e) { return err(e.message); }
    }

    // Escreve o script PowerShell em disco (só uma vez por sessão)
    var POWERSHELL_WRITTEN = false;
    function writePowerShellScript(path) {
        if (POWERSHELL_WRITTEN) {
            var f = new File(path); if (f.exists) return;
        }
        var f = new File(path);
        f.encoding = "UTF-8";
        f.open("w");
        f.write(POWERSHELL_INJECT_SCRIPT);
        f.close();
        POWERSHELL_WRITTEN = true;
    }

    // Script PowerShell embutido — recebe jobs, gera custom mogrts
    // Estratégia: cada slot do template tem UM `textEditValue` no JSON.
    // O JSON do mogrt expõe N text slots na ordem visual. Substituímos as N
    // primeiras ocorrências de textEditValue pelas N palavras. Idem capPropDefault.
    var POWERSHELL_INJECT_SCRIPT =
        "param([string]$JobsFile, [string]$ResultFile)\n" +
        "Add-Type -AssemblyName System.IO.Compression.FileSystem\n" +
        "Add-Type -AssemblyName System.IO.Compression\n" +
        "$ErrorActionPreference = 'Continue'\n" +
        "$jobs = (Get-Content $JobsFile -Raw -Encoding UTF8) | ConvertFrom-Json\n" +
        "$results = @()\n" +
        "\n" +
        "function Replace-OrderedTextFields {\n" +
        "  param([string]$json, [string]$pattern, [string]$replaceTemplate, [string[]]$words)\n" +
        "  $matches = [regex]::Matches($json, $pattern)\n" +
        "  if ($matches.Count -eq 0) { return $json }\n" +
        "  $lf = [string][char]10; $cr = [string][char]13; $tab = [string][char]9\n" +
        "  $sb = New-Object System.Text.StringBuilder\n" +
        "  $lastIdx = 0; $i = 0\n" +
        "  foreach ($m in $matches) {\n" +
        "    $null = $sb.Append($json.Substring($lastIdx, $m.Index - $lastIdx))\n" +
        "    $w = if ($i -lt $words.Count) { [string]$words[$i] } else { '' }\n" +
        "    $wEsc = $w.Replace('\\','\\\\').Replace('\"','\\\"').Replace($lf,'\\n').Replace($cr,'\\r').Replace($tab,'\\t')\n" +
        "    $null = $sb.Append($replaceTemplate.Replace('{TEXT}', $wEsc))\n" +
        "    $lastIdx = $m.Index + $m.Length\n" +
        "    $i++\n" +
        "  }\n" +
        "  $null = $sb.Append($json.Substring($lastIdx))\n" +
        "  return $sb.ToString()\n" +
        "}\n" +
        "\n" +
        "foreach ($j in $jobs) {\n" +
        "  $r = @{ id=$j.id; success=$false; error=$null; outPath=$null }\n" +
        "  try {\n" +
        "    if (-not (Test-Path $j.srcMogrt)) { throw 'src não existe' }\n" +
        "    Copy-Item -Path $j.srcMogrt -Destination $j.dstMogrt -Force\n" +
        "    $zipBytes = [System.IO.File]::ReadAllBytes($j.dstMogrt)\n" +
        "    $ms = New-Object System.IO.MemoryStream\n" +
        "    $ms.Write($zipBytes, 0, $zipBytes.Length)\n" +
        "    $zip = New-Object System.IO.Compression.ZipArchive($ms, [System.IO.Compression.ZipArchiveMode]::Update)\n" +
        "    $entry = $zip.Entries | Where-Object { $_.Name -eq 'definition.json' } | Select-Object -First 1\n" +
        "    if (-not $entry) { throw 'definition.json não encontrado no zip' }\n" +
        "    $reader = New-Object System.IO.StreamReader($entry.Open())\n" +
        "    $json = $reader.ReadToEnd(); $reader.Close()\n" +
        "    $words = @($j.words)\n" +
        "    $wordCount = $words.Count\n" +
        "    # 1. Substitui textEditValue (master clientControls)\n" +
        "    $json = Replace-OrderedTextFields -json $json -pattern '\"textEditValue\"\\s*:\\s*\"([^\"]*)\"' -replaceTemplate '\"textEditValue\":\"{TEXT}\"' -words $words\n" +
        "    # 2. Substitui capPropDefault somente onde capPropFontEdit:true (slots de texto em capsuleparams)\n" +
        "    $json = Replace-OrderedTextFields -json $json -pattern '\"capPropDefault\"\\s*:\\s*\"([^\"]*)\"\\s*,\\s*\"capPropFontEdit\"\\s*:\\s*true' -replaceTemplate '\"capPropDefault\":\"{TEXT}\",\"capPropFontEdit\":true' -words $words\n" +
        "    # Re-escreve definition.json no zip\n" +
        "    $entry.Delete()\n" +
        "    $newEntry = $zip.CreateEntry('definition.json')\n" +
        "    $writer = New-Object System.IO.StreamWriter($newEntry.Open())\n" +
        "    $writer.Write($json); $writer.Close()\n" +
        "    $zip.Dispose()\n" +
        "    [System.IO.File]::WriteAllBytes($j.dstMogrt, $ms.ToArray())\n" +
        "    $ms.Dispose()\n" +
        "    $r.success = $true\n" +
        "    $r.outPath = $j.dstMogrt\n" +
        "    $r.wordsUsed = $wordCount\n" +
        "  } catch {\n" +
        "    $r.error = $_.Exception.Message\n" +
        "  }\n" +
        "  $results += $r\n" +
        "}\n" +
        "$out = @{ ok=$true; jobs=$results }\n" +
        "$out | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath $ResultFile -Encoding UTF8 -NoNewline\n";

    // Importa um MOGRT customizado (já com texto substituído) na timeline.
    // Mais simples que EP_applyOneGroup porque NÃO precisa setar texto depois.
    function EP_importPreparedMogrt(customMogrtPath, ticksStr, trackMode, durSec) {
        try {
            if (!app || !app.project) return err("Sem projeto");
            var seq = app.project.activeSequence;
            if (!seq) return err("Sem sequência");
            var f = new File(customMogrtPath);
            if (!f.exists) return err("Custom mogrt não existe: " + customMogrtPath);

            var ticks = String(ticksStr);
            var target = pickTargetTrack(seq, trackMode, ticks);
            var clip = seq.importMGT(f.fsName, ticks, target, 0);
            if (!clip) return err("Premiere recusou importar");

            // Ajusta duração
            try {
                var dur = Number(durSec) || 1.0;
                var startSec = Number(ticks) / TICKS_PER_SECOND;
                var endTicks = String(Math.round((startSec + dur) * TICKS_PER_SECOND));
                clip.end = { ticks: endTicks };
            } catch (eDur) {}

            return ok({ ok: true, track: target, name: clip.name });
        } catch (e) { return err(e.message); }
    }

    // Limpa pasta tmp/_mpl_inject após uso
    function EP_cleanInjectTmp() {
        try {
            var tmpDir = Folder.temp.fsName + "/_mpl_inject";
            var d = new Folder(tmpDir);
            if (!d.exists) return ok({ cleaned: 0 });
            var files = d.getFiles();
            var removed = 0;
            for (var i = 0; i < files.length; i++) {
                try {
                    if (files[i] instanceof File && /\.mogrt$/i.test(files[i].name)) {
                        if (files[i].remove()) removed++;
                    }
                } catch (e) {}
            }
            return ok({ cleaned: removed });
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── RENDER PREVIEW
    // Dispara o "Sequence > Render Effects In to Out" (cria cache verde).
    // Vital depois de aplicar muitos MOGRTs — sem render preview, o export
    // tenta processar todos em real-time e estoura GPU/RAM.
    function EP_renderInToOut() {
        try {
            // Premiere CC tem app.enableQE() pra ativar QE DOM
            if (typeof app.enableQE === "function") {
                try { app.enableQE(); } catch (e) {}
            }
            // Comando "Render Effects In to Out" — ID varia por versão
            // Tentamos via executeCommand com IDs conhecidos
            var commandIds = [
                "Sequence.RenderInToOut",   // moderno
                "Sequence.RenderEntireWorkArea",
                12,                          // ID legado
                21                           // ID alternativo
            ];
            var done = false;
            for (var i = 0; i < commandIds.length; i++) {
                try {
                    if (app.executeCommand) {
                        app.executeCommand(commandIds[i]);
                        done = true; break;
                    }
                } catch (e) {}
            }
            if (!done) {
                // Fallback: pede pro user fazer manual
                return ok({ ok: false, manual: true, msg: "Pressione ENTER na timeline (Sequence > Render In to Out)" });
            }
            return ok({ ok: true, started: true });
        } catch (e) { return err(e.message); }
    }

    // ──────────────────────────────────────────────── NEST CLIPS
    // Seleciona todos os clips de uma track de vídeo específica e cria um
    // nested sequence — alivia a timeline pesada de muitas legendas.
    function EP_nestVideoTrack(trackIndex) {
        try {
            var seq = app.project && app.project.activeSequence;
            if (!seq) return err("Sem sequência ativa");
            var idx = Number(trackIndex);
            if (!isFinite(idx) || idx < 0) idx = seq.videoTracks.numTracks - 1;
            if (idx >= seq.videoTracks.numTracks) return err("Track " + idx + " não existe");

            var track = seq.videoTracks[idx];
            var count = track.clips.numItems;
            if (count === 0) return err("Track V" + (idx + 1) + " está vazia");

            // Seleciona todos os clips dessa track
            try { seq.setSelection([]); } catch (e) {}
            var sel = [];
            for (var i = 0; i < count; i++) {
                try { sel.push(track.clips[i]); } catch (e) {}
            }
            // Aplica seleção (depende da versão; alguns Premieres usam .setSelected)
            try {
                if (seq.setSelection) seq.setSelection(sel);
                else {
                    for (var j = 0; j < sel.length; j++) {
                        try { sel[j].setSelected(true, true); } catch (e) {}
                    }
                }
            } catch (e) {}

            // Comando "Clip > Nest..." — IDs conhecidos
            var nestCommands = ["Clip.Nest", 14];
            var done = false;
            for (var k = 0; k < nestCommands.length; k++) {
                try {
                    if (app.executeCommand) {
                        app.executeCommand(nestCommands[k]);
                        done = true; break;
                    }
                } catch (e) {}
            }
            if (!done) {
                return ok({ ok: false, manual: true, msg: "Selecione as legendas e use Clip > Nest manualmente" });
            }
            return ok({ ok: true, nestedCount: count, track: idx + 1 });
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
        EP_diagnoseTemplateSlots: EP_diagnoseTemplateSlots,
        EP_installFonts: EP_installFonts,
        EP_checkFonts: EP_checkFonts,
        EP_checkSystemFonts: EP_checkSystemFonts,
        EP_inspectTemplateFonts: EP_inspectTemplateFonts,
        EP_renderInToOut: EP_renderInToOut,
        EP_nestVideoTrack: EP_nestVideoTrack,
        EP_prepareInjectMogrts: EP_prepareInjectMogrts,
        EP_importPreparedMogrt: EP_importPreparedMogrt,
        EP_cleanInjectTmp: EP_cleanInjectTmp,
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
