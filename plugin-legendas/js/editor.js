/* MotionPro Legendas — Editor Premium · módulo SFX + Mode + SRT
 *
 * Responsabilidades:
 *  - SFX engine via Web Audio API (sons sintéticos sem precisar mp3s)
 *  - Modal de seleção SFX com tabs por categoria
 *  - Modo TEMPLATES vs AUTOMAÇÃO SRT
 *  - Importar/parsear arquivo .srt
 *  - Footer config (apply mode, audio track)
 *  - Top status bar e SRT bar
 *
 * Roda DEPOIS de app.js (que já criou: API_BASE, PRODUCT_ID, gateApi, openInBrowser, toast, $).
 */
(function () {
"use strict";

if (typeof window.MotionProLegendasEditor !== "undefined") return;
window.MotionProLegendasEditor = true;

var $ = function (id) { return document.getElementById(id); };

// ============================================================ SFX ENGINE (Web Audio)
var AudioCtx = window.AudioContext || window.webkitAudioContext;
var audioCtx = null;
function ctx() { if (!audioCtx) audioCtx = new AudioCtx(); return audioCtx; }

// Cada SFX é uma função que toca um som sintético no AudioContext.
// Permite ter biblioteca rica SEM precisar de mp3s — e cliente pode "Substituir" depois.
var SFX_LIBRARY = {
    "camera-shutter-01": { name: "Camera Shutter 01", category: "camera", play: function() { sfxShutter(0.04, 0.10); } },
    "camera-shutter-02": { name: "Camera Shutter 02", category: "camera", play: function() { sfxShutter(0.06, 0.14); } },
    "camera-click-01":   { name: "Camera Click 01",   category: "camera", play: function() { sfxClick(2400, 0.05); } },
    "camera-click-02":   { name: "Camera Click 02",   category: "camera", play: function() { sfxClick(2800, 0.06); } },
    "camera-double":     { name: "Camera Double",     category: "camera", play: function() { sfxClick(2400, 0.05); setTimeout(function(){ sfxClick(2400, 0.05); }, 90); } },
    "camera-snap":       { name: "Camera Snap",       category: "camera", play: function() { sfxClick(3200, 0.04); } },

    "button-01":         { name: "Button 01",         category: "click",  play: function() { sfxClick(1000, 0.08); } },
    "button-02":         { name: "Button 02",         category: "click",  play: function() { sfxClick(800, 0.10); } },
    "button-slow":       { name: "Button Slow",       category: "click",  play: function() { sfxClick(600, 0.18); } },
    "button-pop":        { name: "Button Pop",        category: "click",  play: function() { sfxPop(0.10); } },
    "button-tick":       { name: "Tick",              category: "click",  play: function() { sfxClick(3000, 0.03); } },
    "button-clack":      { name: "Clack",             category: "click",  play: function() { sfxKick(120, 0.06); } },
    "button-soft":       { name: "Soft Tap",          category: "click",  play: function() { sfxClick(600, 0.06, 0.4); } },

    "typing-single":     { name: "Type Single",       category: "typing", play: function() { sfxClick(2200, 0.025); } },
    "typing-burst":      { name: "Type Burst",        category: "typing", play: function() { sfxTypingBurst(); } },

    "whoosh-light":      { name: "Whoosh Light",      category: "whoosh", play: function() { sfxWhoosh(800, 200, 0.30); } },
    "whoosh-heavy":      { name: "Whoosh Heavy",      category: "whoosh", play: function() { sfxWhoosh(1200, 100, 0.50); } },
    "whoosh-pass":       { name: "Whoosh Pass",       category: "whoosh", play: function() { sfxWhoosh(2000, 300, 0.40); } },

    "impact-hit":        { name: "Impact Hit",        category: "impact", play: function() { sfxKick(80, 0.20); } },
    "impact-boom":       { name: "Impact Boom",       category: "impact", play: function() { sfxKick(45, 0.40); } },
    "impact-stab":       { name: "Stab",              category: "impact", play: function() { sfxStab(); } }
};

// ─── Sintetizadores ─────────────────────────────────────
function sfxClick(freq, dur, vol) {
    var c = ctx(); var o = c.createOscillator(); var g = c.createGain();
    o.frequency.value = freq;
    o.type = "square";
    g.gain.setValueAtTime(vol || 0.18, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
}
function sfxShutter(d1, d2) {
    var c = ctx();
    var n = c.createBufferSource();
    var buf = c.createBuffer(1, c.sampleRate * (d1 + d2), c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    n.buffer = buf;
    var g = c.createGain();
    g.gain.value = 0.18;
    n.connect(g).connect(c.destination);
    n.start();
    setTimeout(function() { sfxClick(900, d2 * 0.5, 0.10); }, d1 * 1000);
}
function sfxPop(dur) {
    var c = ctx(); var o = c.createOscillator(); var g = c.createGain();
    o.frequency.setValueAtTime(180, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(900, c.currentTime + dur);
    o.type = "sine";
    g.gain.setValueAtTime(0.25, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
}
function sfxKick(freq, dur) {
    var c = ctx(); var o = c.createOscillator(); var g = c.createGain();
    o.frequency.setValueAtTime(freq * 2, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq, c.currentTime + 0.05);
    o.type = "sine";
    g.gain.setValueAtTime(0.6, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
}
function sfxWhoosh(startFreq, endFreq, dur) {
    var c = ctx();
    var n = c.createBufferSource();
    var buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    n.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(startFreq, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(endFreq, c.currentTime + dur);
    f.Q.value = 4;
    var g = c.createGain();
    g.gain.setValueAtTime(0.001, c.currentTime);
    g.gain.linearRampToValueAtTime(0.4, c.currentTime + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    n.connect(f).connect(g).connect(c.destination);
    n.start();
}
function sfxTypingBurst() {
    for (var i = 0; i < 5; i++) {
        (function(idx) {
            setTimeout(function() { sfxClick(2000 + Math.random() * 600, 0.02); }, idx * 60);
        })(i);
    }
}
function sfxStab() {
    var c = ctx(); var o = c.createOscillator(); var g = c.createGain();
    o.frequency.setValueAtTime(180, c.currentTime);
    o.type = "sawtooth";
    g.gain.setValueAtTime(0.001, c.currentTime);
    g.gain.linearRampToValueAtTime(0.4, c.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.6);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.6);
}

// Resume audio context se Chromium suspender (cliente precisa interagir 1 vez)
document.addEventListener("click", function () {
    try { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); } catch (e) {}
}, { once: true });

// ============================================================ SFX MODAL
var SFX_SELECTED = localStorage.getItem("mvl_sfx_selected") || null;
var sfxCurrentTab = "all";

function sfxBuildCategories() {
    var byCat = { all: [] };
    Object.keys(SFX_LIBRARY).forEach(function (id) {
        var s = SFX_LIBRARY[id];
        byCat.all.push({ id: id, name: s.name, category: s.category });
        if (!byCat[s.category]) byCat[s.category] = [];
        byCat[s.category].push({ id: id, name: s.name, category: s.category });
    });
    return byCat;
}

function openSfxModal() {
    var modal = $("sfx-modal"); if (!modal) return;
    modal.classList.remove("hidden");
    renderSfxModal();
    setTimeout(function () { try { $("sfx-q").focus(); } catch (_) {} }, 60);
}
function closeSfxModal() {
    var modal = $("sfx-modal"); if (modal) modal.classList.add("hidden");
}

function renderSfxModal() {
    var cats = sfxBuildCategories();
    var tabsEl = $("sfx-tabs");
    var labels = { all: "Todos", camera: "Camera", click: "Click", typing: "Typing", whoosh: "Whoosh", impact: "Impact" };
    var order = ["all", "camera", "click", "typing", "whoosh", "impact"];
    tabsEl.innerHTML = "";
    order.forEach(function (cat) {
        if (!cats[cat] || !cats[cat].length) return;
        var b = document.createElement("button");
        b.className = "sfx-tab" + (sfxCurrentTab === cat ? " on" : "");
        b.textContent = (labels[cat] || cat) + " (" + cats[cat].length + ")";
        b.onclick = function () { sfxCurrentTab = cat; renderSfxModal(); };
        tabsEl.appendChild(b);
    });

    var listEl = $("sfx-list");
    var search = ($("sfx-q").value || "").toLowerCase();
    var items = (cats[sfxCurrentTab] || []).filter(function (i) {
        return !search || i.name.toLowerCase().indexOf(search) >= 0;
    });
    listEl.innerHTML = "";
    items.forEach(function (item) {
        var row = document.createElement("div");
        row.className = "sfx-item" + (SFX_SELECTED === item.id ? " applied" : "");
        row.innerHTML =
            '<button class="sfx-item__play" title="Tocar preview">▶</button>' +
            '<div class="sfx-item__info">' +
                '<div class="sfx-item__name">' + item.name + '</div>' +
                '<div class="sfx-item__cat">' + item.category + '</div>' +
            '</div>' +
            '<button class="sfx-item__use' + (SFX_SELECTED === item.id ? " applied" : "") + '">' +
                (SFX_SELECTED === item.id ? "Usando" : "Usar") +
            '</button>';
        var playBtn = row.querySelector(".sfx-item__play");
        var useBtn  = row.querySelector(".sfx-item__use");
        playBtn.onclick = function () {
            row.classList.add("playing");
            playBtn.classList.add("on");
            try { SFX_LIBRARY[item.id].play(); } catch (e) {}
            setTimeout(function () { row.classList.remove("playing"); playBtn.classList.remove("on"); }, 600);
        };
        useBtn.onclick = function () {
            SFX_SELECTED = (SFX_SELECTED === item.id) ? null : item.id;
            if (SFX_SELECTED) localStorage.setItem("mvl_sfx_selected", SFX_SELECTED);
            else localStorage.removeItem("mvl_sfx_selected");
            renderSfxModal();
            updateSfxStatus();
            try { logLine("[SFX] " + (SFX_SELECTED ? "Selecionado: " + item.name : "Removido")); } catch (e) {}
        };
        listEl.appendChild(row);
    });
    if (items.length === 0) {
        listEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--mut);font:500 12px Inter">Nenhum SFX encontrado</div>';
    }
}

function updateSfxStatus() {
    var btn = $("btn-open-sfx");
    if (!btn) return;
    if (SFX_SELECTED && SFX_LIBRARY[SFX_SELECTED]) {
        btn.textContent = "⚡ " + SFX_LIBRARY[SFX_SELECTED].name;
        btn.style.background = "#22c55e";
        btn.style.color = "#fff";
    } else {
        btn.textContent = "⚡ Selecionar SFX";
        btn.style.background = "";
        btn.style.color = "";
    }
}

// ============================================================ MODE TOGGLE
var CURRENT_MODE = "templates";
function setMode(mode) {
    CURRENT_MODE = mode;
    var btnT = $("mode-templates"), btnA = $("mode-automation");
    if (btnT) btnT.classList.toggle("active", mode === "templates");
    if (btnA) btnA.classList.toggle("active", mode === "automation");
    var mainT = $("main-templates"), mainA = $("main-automation");
    if (mainT) mainT.classList.toggle("hidden", mode !== "templates");
    if (mainA) mainA.classList.toggle("hidden", mode !== "automation");
    if (mode === "automation") { renderAutomationOptions(); updateAutomationUI(SRT_DATA ? "SRT atual" : null); }
    logLine("[MODE] " + mode.toUpperCase());
}

// ============================================================ SRT PARSER
var SRT_DATA = null;
function parseSRT(text) {
    var blocks = text.replace(/\r/g, "").split(/\n\n+/);
    var items = [];
    blocks.forEach(function (b) {
        var lines = b.trim().split("\n");
        if (lines.length < 2) return;
        // primeira linha pode ser índice (ou não)
        var ti = lines.findIndex(function (l) { return /-->/.test(l); });
        if (ti < 0) return;
        var m = lines[ti].match(/(\d{2}:\d{2}:\d{2}[,.](\d{3}))\s*-->\s*(\d{2}:\d{2}:\d{2}[,.](\d{3}))/);
        if (!m) return;
        function toSec(s) {
            var p = s.replace(",", ".").split(/[:.]/);
            return Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2]) + Number(p[3]) / 1000;
        }
        var start = toSec(m[1]);
        var end = toSec(m[3]);
        var text = lines.slice(ti + 1).join(" ").trim();
        if (text) items.push({ start: start, end: end, text: text });
    });
    return items;
}

function loadSRTFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            SRT_DATA = parseSRT(e.target.result);
            var t = $("srt-title"); if (t) t.textContent = "✓ " + file.name + " · " + SRT_DATA.length + " blocos";
            var bar = document.querySelector(".srtbar"); if (bar) bar.classList.add("loaded");
            updateAutomationUI(file.name);
            logLine("[SRT] Carregado: " + file.name + " · " + SRT_DATA.length + " linhas");
        } catch (err) {
            logLine("[SRT] ERRO: " + err.message);
            alert("Erro ao ler SRT: " + err.message);
        }
    };
    reader.readAsText(file, "utf-8");
}

// Atualiza painel AUTOMAÇÃO (empty state vs SRT carregado + botão APLICAR)
function updateAutomationUI(name) {
    var empty = $("auto-empty");
    var loaded = $("srt-loaded");
    var apply = $("btn-apply-all");
    if (SRT_DATA && SRT_DATA.length) {
        if (empty) empty.classList.add("hidden");
        if (loaded) {
            loaded.classList.remove("hidden");
            var n = $("srt-loaded-name"); if (n) n.textContent = name || "SRT carregado";
            var c = $("srt-loaded-count"); if (c) c.textContent = SRT_DATA.length + " linhas";
        }
        if (apply) apply.disabled = false;
    } else {
        if (empty) empty.classList.remove("hidden");
        if (loaded) loaded.classList.add("hidden");
        if (apply) apply.disabled = true;
    }
}

// =============================== DIAGNÓSTICO LIVE
// Roda uma série de testes e mostra o resultado no LOG (auto-expande)
function openLog() {
    var body = $("log-body");
    var head = $("log-head");
    if (body) body.style.display = "block";
    if (head) {
        var arrow = head.querySelector(".logbar__arrow");
        if (arrow) arrow.textContent = "▲";
    }
}

function runDiagnostics() {
    openLog();
    var btn = $("btn-diag");
    if (btn) { btn.className = "topbar__diag"; btn.textContent = "🩺 Testando…"; }
    logLine("════════ DIAGNÓSTICO LIVE ════════");

    // 1) Ambiente
    var hasCS = typeof CSInterface !== "undefined";
    logLine("[1] CSInterface.js: " + (hasCS ? "OK ✓" : "AUSENTE ✗"));
    if (!hasCS) { if (btn) { btn.className = "topbar__diag err"; btn.textContent = "✗ FALHA"; } return; }

    var cs = new CSInterface();
    var hostEnv = cs.getHostEnvironment();
    logLine("[2] Host: " + hostEnv.appName + " v" + hostEnv.appVersion + " (id=" + hostEnv.appId + ")");
    if (hostEnv.appId !== "PPRO" && hostEnv.appId !== "AEFT") {
        logLine("    ⚠ Plugin foi feito pra Premiere/AE. Você tá em: " + hostEnv.appId);
    }

    // 3) Catalog
    var cat = window.CATALOG_LEGENDAS;
    if (cat && cat.packs) {
        var n = 0;
        cat.packs.forEach(function (p) { (p.categories || []).forEach(function (c) { n += (c.items || []).length; }); });
        logLine("[3] Catálogo: " + n + " items carregados ✓");
    } else {
        logLine("[3] Catálogo: NÃO CARREGADO ✗ (window.CATALOG_LEGENDAS undefined)");
    }

    // 4) Ping ExtendScript
    logLine("[4] Pingando ExtendScript…");
    cs.evalScript("typeof MotionProLegendas", function (typeofResult) {
        logLine("    typeof MotionProLegendas = " + JSON.stringify(typeofResult));
        if (String(typeofResult).indexOf("object") < 0) {
            logLine("    ✗ host.jsx NÃO foi carregado pelo Premiere!");
            logLine("    Possíveis causas:");
            logLine("    - manifest ScriptPath errado");
            logLine("    - Plugin instalado mas Premiere reiniciado é preciso");
            logLine("    - Erro de sintaxe no host.jsx (cheque ExtendScript Toolkit)");
            if (btn) { btn.className = "topbar__diag err"; btn.textContent = "✗ host.jsx OFF"; }
            return;
        }

        // 5) ping()
        cs.evalScript("MotionProLegendas.ping();", function (res) {
            logLine("[5] ping() = " + res);

            // 6) Sequência ativa
            cs.evalScript("MotionProLegendas.getActiveSequenceInfo();", function (res2) {
                logLine("[6] getActiveSequenceInfo() = " + res2);
                var info; try { info = JSON.parse(res2 || "{}"); } catch (e) { info = {}; }
                if (!info.hasSequence) {
                    logLine("    ⚠ Nenhuma sequência ativa. Abra um .prproj com timeline aberta!");
                    if (btn) { btn.className = "topbar__diag err"; btn.textContent = "⚠ Sem sequência"; }
                    return;
                }
                logLine("    ✓ Sequência: " + info.name + " · V" + info.videoTracks + " · A" + info.audioTracks);
                logLine("    ✓ CTI em " + info.cti.toFixed(2) + "s");
                logLine("    ✓ Captions: " + (info.hasCaptions ? "SIM (transcribe pronta)" : "NÃO (faça Window → Text → Transcript no Premiere)"));

                // 7) Teste de import de 1 MOGRT (se houver template selecionado OU pega o primeiro)
                var sel = window.LegendasGetSelected && window.LegendasGetSelected();
                var firstItem = null;
                if (!sel && cat && cat.packs && cat.packs[0] && cat.packs[0].categories && cat.packs[0].categories[0]) {
                    firstItem = cat.packs[0].categories[0].items[0];
                }
                var item = sel ? sel.item : firstItem;
                if (!item || !item.mogrt) {
                    logLine("[7] ✗ Sem item.mogrt pra testar import");
                    if (btn) { btn.className = "topbar__diag ok"; btn.textContent = "✓ Conectado"; }
                    return;
                }
                var abs = window.LegendasResolveMogrtPath(item.mogrt);
                logLine("[7] Testando importMogrt: " + item.name);
                logLine("    path: " + abs);
                var jsx = 'MotionProLegendas.importMogrt(' + JSON.stringify(abs) + ');';
                cs.evalScript(jsx, function (res3) {
                    logLine("    result: " + res3);
                    var d; try { d = JSON.parse(res3 || "{}"); } catch (e) { d = {}; }
                    if (d.error) {
                        logLine("    ✗ FALHOU: " + d.error);
                        if (btn) { btn.className = "topbar__diag err"; btn.textContent = "✗ Import falhou"; }
                    } else {
                        logLine("    ✓ Inserido " + (d.name || "?") + " na V" + ((d.track||0)+1));
                        if (btn) { btn.className = "topbar__diag ok"; btn.textContent = "✓ Tudo OK"; }
                    }
                    logLine("══════════════════════════════════");
                });
            });
        });
    });
}

// =============================== TRANSCRIBE — usa Speech-to-Text NATIVO do Premiere
// Premiere 2024+ tem transcrição AI nativa em Window → Text → Transcript.
// Quando ela cria captions na sequência, lemos via ExtendScript e populamos SRT_DATA.
function transcribeSelectedClip() {
    var cs = (typeof CSInterface !== "undefined") ? new CSInterface() : null;
    if (!cs) { toast("CSInterface indisponível", "err"); return; }
    logLine("[TRANSCRIBE] Lendo captions da sequência ativa…");
    cs.evalScript("MotionProLegendas.readActiveCaptions();", function (res) {
        var data; try { data = JSON.parse(res || "{}"); } catch (e) { data = { error: "parse: " + res }; }
        if (data.error) {
            logLine("[TRANSCRIBE] " + data.error);
            // Mostra instrução clara ao invés de só falhar
            var msg = "Sem captions ainda. No Premiere: Window → Text → Transcript → Create transcription (PT-BR). Depois clique aqui de novo.";
            toast(msg, "warn", 6500);
            return;
        }
        SRT_DATA = data.blocks;
        var bar = document.querySelector(".srtbar"); if (bar) bar.classList.add("loaded");
        var t = $("srt-title"); if (t) t.textContent = "✓ Transcrição Premiere · " + SRT_DATA.length + " blocos";
        updateAutomationUI("Transcrição do Premiere");
        logLine("[TRANSCRIBE] " + SRT_DATA.length + " linhas importadas via captions nativas");
        toast("✓ " + SRT_DATA.length + " linhas importadas do Premiere", "ok", 3500);
    });
}

// =============================== APLICAR template selecionado (footer)
function applySelectedTemplate() {
    var sel = (typeof window.LegendasGetSelected === "function") ? window.LegendasGetSelected() : null;
    if (!sel || !sel.item) {
        toast("Selecione um template primeiro", "warn"); return;
    }
    if (!sel.item.mogrt) {
        toast("Template sem .mogrt — não dá pra aplicar", "err"); return;
    }
    if (typeof window.LegendasInsertItem === "function") {
        logLine("[APPLY] " + sel.item.name);
        window.LegendasInsertItem(sel.item);
        // SFX opcional no momento do apply
        if ($("opt-with-sfx") && $("opt-with-sfx").checked && SFX_SELECTED && SFX_LIBRARY[SFX_SELECTED]) {
            try { SFX_LIBRARY[SFX_SELECTED].play(); } catch (e) {}
        }
    }
}

// =============================== APLICAR NA TIMELINE (batch SRT real)
// Agrupa palavras de N em N respeitando a duração proporcional do bloco original.
function chunkSrtByWords(blocks, wordsPerChunk, connectors) {
    var out = [];
    blocks.forEach(function (b) {
        var words = (b.text || "").trim().split(/\s+/).filter(Boolean);
        if (!words.length) return;
        var totalDur = Math.max(.4, b.end - b.start);
        var nChunks = Math.ceil(words.length / wordsPerChunk);
        for (var i = 0; i < nChunks; i++) {
            var slice = words.slice(i * wordsPerChunk, (i + 1) * wordsPerChunk);
            var sep = connectors === "none" ? "" : (connectors === "space" ? " " : " ");
            var txt = slice.join(sep);
            var start = b.start + (i / nChunks) * totalDur;
            var end   = b.start + ((i + 1) / nChunks) * totalDur;
            out.push({ start: start, end: end, text: txt });
        }
    });
    return out;
}

function applySrtBatchReal() {
    if (!SRT_DATA || !SRT_DATA.length) { toast("Carregue um SRT primeiro", "warn"); return; }
    var cs = (typeof CSInterface !== "undefined") ? new CSInterface() : null;
    if (!cs) { toast("CSInterface indisponível", "err"); return; }

    // Acha mogrt do template selecionado no dropdown
    var sel = $("auto-template");
    var tplName = sel && sel.value;
    if (!tplName || tplName === "Carregar SRT primeiro" || tplName === "Catálogo vazio") {
        toast("Selecione um template no dropdown", "warn"); return;
    }
    var item = findCatalogItemByName(tplName);
    if (!item || !item.mogrt) { toast("Template não encontrado no catálogo", "err"); return; }

    // Monta blocos finais aplicando "palavras por bloco" + conectores
    var n = parseInt($("auto-words").value, 10) || 3;
    var conn = ($("auto-connectors") && $("auto-connectors").value) || "smart";
    var blocks = chunkSrtByWords(SRT_DATA, n, conn);
    var trackMode = ($("auto-track") && $("auto-track").value) || "last";

    var mogrtAbs = window.LegendasResolveMogrtPath ? window.LegendasResolveMogrtPath(item.mogrt) : null;
    if (!mogrtAbs) { toast("Não consegui resolver path do .mogrt", "err"); return; }

    var btn = $("btn-apply-all");
    if (btn) { btn.disabled = true; btn.textContent = "Aplicando " + blocks.length + " títulos…"; }
    logLine("[BATCH] " + blocks.length + " blocos · template " + tplName + " · track " + trackMode);

    var jsx = "MotionProLegendas.applySrtBatch(" +
              JSON.stringify(mogrtAbs) + "," +
              JSON.stringify(JSON.stringify(blocks)) + "," +
              JSON.stringify(JSON.stringify({ trackMode: trackMode })) + ");";
    cs.evalScript(jsx, function (res) {
        if (btn) { btn.disabled = false; btn.textContent = "⚡ APLICAR NA TIMELINE"; }
        var data; try { data = JSON.parse(res || "{}"); } catch (e) { data = { error: "parse: " + res }; }
        if (data.error) {
            logLine("[BATCH] ERRO: " + data.error);
            toast("Erro: " + data.error, "err", 5000);
            return;
        }
        logLine("[BATCH] OK · " + data.applied + " aplicados · " + data.skipped + " pulados");
        toast("✓ " + data.applied + " títulos criados na track V" + (data.track + 1), "ok", 4500);

        // SFX: se ligado e SFX selecionado, renderiza WAV e importa nas posições
        if ($("opt-with-sfx") && $("opt-with-sfx").checked && SFX_SELECTED) {
            var audioTrack = ($("opt-audio-track") && $("opt-audio-track").value) || "A2";
            if (audioTrack) placeSfxOnTimeline(blocks, audioTrack);
        }
    });
}

function findCatalogItemByName(name) {
    var cat = window.CATALOG_LEGENDAS;
    if (!cat || !cat.packs) return null;
    for (var p = 0; p < cat.packs.length; p++) {
        var cats = cat.packs[p].categories || [];
        for (var c = 0; c < cats.length; c++) {
            var items = cats[c].items || [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].name === name) return items[i];
            }
        }
    }
    return null;
}

// =============================== SFX na timeline (renderiza WAV → importa)
function renderSfxToWav(sfxKey) {
    var def = SFX_LIBRARY[sfxKey]; if (!def) return null;
    var sampleRate = 44100;
    var seconds = 1.0; // duração max por SFX
    var OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) return null;
    var off = new OfflineCtx(1, sampleRate * seconds, sampleRate);
    // monkey-patch ctx() temporário pra rodar o synth no offline
    var prev = audioCtx; audioCtx = off;
    try { def.play(); } catch (e) {}
    audioCtx = prev;
    return off.startRendering().then(function (buf) { return audioBufferToWavBlob(buf); });
}

function audioBufferToWavBlob(buffer) {
    var numCh = buffer.numberOfChannels;
    var sr = buffer.sampleRate;
    var samples = buffer.length;
    var dataSize = samples * numCh * 2;
    var ab = new ArrayBuffer(44 + dataSize);
    var view = new DataView(ab);
    function w(o, s) { for (var i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); }
    w(0, "RIFF"); view.setUint32(4, 36 + dataSize, true);
    w(8, "WAVE"); w(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true); view.setUint32(28, sr * numCh * 2, true);
    view.setUint16(32, numCh * 2, true); view.setUint16(34, 16, true);
    w(36, "data"); view.setUint32(40, dataSize, true);
    var ch = buffer.getChannelData(0); var off = 44;
    for (var i = 0; i < samples; i++, off += 2) {
        var s = Math.max(-1, Math.min(1, ch[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([ab], { type: "audio/wav" });
}

function placeSfxOnTimeline(blocks, audioTrack) {
    if (!SFX_SELECTED) return;
    var sfxKey = SFX_SELECTED;
    var fs = window.require ? window.require("fs") : null;
    var os = window.require ? window.require("os") : null;
    if (!fs || !os) { logLine("[SFX] node fs indisponível"); return; }

    var wavPromise = renderSfxToWav(sfxKey);
    if (!wavPromise) { logLine("[SFX] OfflineAudioContext indisponível"); return; }

    wavPromise.then(function (blob) {
        var reader = new FileReader();
        reader.onload = function () {
            var buf = new Uint8Array(reader.result);
            var tmpPath = os.tmpdir() + "/mpl_sfx_" + sfxKey.replace(/[^a-z0-9]/gi, "_") + ".wav";
            try { fs.writeFileSync(tmpPath, Buffer.from(buf)); } catch (e) { logLine("[SFX] write fail: " + e.message); return; }
            // Calcula ticks pra cada start de bloco
            var TICKS = 254016000000;
            var positions = blocks.map(function (b) { return String(Math.round(b.start * TICKS)); });
            var cs = new CSInterface();
            var jsx = "MotionProLegendas.importAudioFile(" +
                      JSON.stringify(tmpPath) + "," +
                      JSON.stringify(JSON.stringify(positions)) + "," +
                      JSON.stringify(audioTrack) + ");";
            cs.evalScript(jsx, function (res) {
                var d; try { d = JSON.parse(res || "{}"); } catch (e) { d = {}; }
                if (d.error) { logLine("[SFX] " + d.error); toast("SFX: " + d.error, "warn", 4000); }
                else { logLine("[SFX] " + d.placed + " SFX em " + d.track); toast("✓ SFX em " + d.track, "ok"); }
            });
        };
        reader.readAsArrayBuffer(blob);
    }).catch(function (e) { logLine("[SFX] render fail: " + e.message); });
}

function getAllWords() {
    if (!SRT_DATA) return [];
    var words = [];
    SRT_DATA.forEach(function (b) {
        b.text.split(/\s+/).forEach(function (w) {
            w = w.replace(/[^\wÀ-ú\-]/g, "").trim();
            if (w) words.push(w);
        });
    });
    return words;
}

function renderAutomationOptions() {
    var auto = $("auto-template"); if (!auto) return;
    if (window.CATALOG_LEGENDAS && window.CATALOG_LEGENDAS.packs && window.CATALOG_LEGENDAS.packs[0]) {
        // popula select com templates do catalog
        auto.innerHTML = '';
        var allItems = [];
        (window.CATALOG_LEGENDAS.packs[0].categories || []).forEach(function (cat) {
            (cat.items || []).forEach(function (it, idx) {
                allItems.push({ name: it.name, label: "Texto " + String(allItems.length + 1).padStart(2, "0") + " (" + cat.name.split(" - ").pop() + ")" });
            });
        });
        if (allItems.length === 0) {
            auto.innerHTML = '<option>Catálogo vazio</option>';
        } else {
            allItems.slice(0, 100).forEach(function (it, i) {
                var opt = document.createElement("option");
                opt.value = it.name;
                opt.textContent = it.label;
                auto.appendChild(opt);
            });
        }
    } else {
        auto.innerHTML = '<option>Carregando catálogo...</option>';
    }
}

// ============================================================ LOG
function logLine(text) {
    var body = $("log-body"); if (!body) return;
    var line = document.createElement("div");
    line.className = "log-line";
    var t = new Date().toLocaleTimeString("pt-BR", { hour12: false });
    line.textContent = "[" + t + "] " + text;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
}

// ============================================================ TOP STATUS
function updateTopStatus() {
    var top = $("topstatus"); if (!top) return;
    var email = localStorage.getItem("mv_email");
    if (email && localStorage.getItem("mv_session")) {
        top.classList.remove("gated");
        $("topstatus-email").textContent = "Logado — " + email;
    } else {
        top.classList.add("gated");
        $("topstatus-email").textContent = "Não autenticado";
    }
}

// ============================================================ BIND ALL
function bindEditor() {
    // Mode toggle
    var btnT = $("mode-templates"), btnA = $("mode-automation");
    if (btnT) btnT.onclick = function () { setMode("templates"); };
    if (btnA) btnA.onclick = function () { setMode("automation"); };

    // SRT load (botão no topo + dentro de AUTOMAÇÃO)
    var btnSrt = $("btn-load-srt");
    var btnSrt2 = $("btn-load-srt-2");
    var fileSrt = $("srt-file");
    function openSrtPicker() { if (fileSrt) fileSrt.click(); }
    if (btnSrt) btnSrt.onclick = openSrtPicker;
    if (btnSrt2) btnSrt2.onclick = openSrtPicker;
    if (fileSrt) {
        fileSrt.onchange = function (e) {
            var f = e.target.files && e.target.files[0];
            if (f) loadSRTFile(f);
        };
    }

    // NOVO: Transcrever do clipe selecionado
    var btnTr = $("btn-transcribe-clip");
    if (btnTr) btnTr.onclick = transcribeSelectedClip;

    // 🩺 Diagnóstico
    var btnDiag = $("btn-diag");
    if (btnDiag) btnDiag.onclick = runDiagnostics;

    // LOG toggle
    var logHead = $("log-head");
    if (logHead) logHead.onclick = function () {
        var body = $("log-body");
        var arrow = logHead.querySelector(".logbar__arrow");
        if (!body) return;
        var open = body.style.display !== "none";
        body.style.display = open ? "none" : "block";
        if (arrow) arrow.textContent = open ? "▼" : "▲";
    };

    // SFX modal
    var openSfx = $("btn-open-sfx");
    if (openSfx) openSfx.onclick = openSfxModal;
    var closeSfx = $("sfx-close");
    if (closeSfx) closeSfx.onclick = closeSfxModal;
    var overlay = document.querySelector("#sfx-modal .sfx-modal__overlay");
    if (overlay) overlay.onclick = closeSfxModal;
    var sfxQ = $("sfx-q");
    if (sfxQ) sfxQ.oninput = renderSfxModal;
    var refresh = $("sfx-refresh");
    if (refresh) refresh.onclick = function () { renderSfxModal(); logLine("[SFX] Catálogo atualizado · " + Object.keys(SFX_LIBRARY).length + " sons"); };
    var remove = $("sfx-remove");
    if (remove) remove.onclick = function () {
        SFX_SELECTED = null;
        localStorage.removeItem("mvl_sfx_selected");
        renderSfxModal(); updateSfxStatus();
        logLine("[SFX] Removido");
    };

    // Automation config + APLICAR NA TIMELINE (real)
    var aw = $("auto-words");
    if (aw) aw.onchange = renderAutomationOptions;
    var apply = $("btn-apply-all");
    if (apply) apply.onclick = applySrtBatchReal;

    // Footer APLICAR (template selecionado vai no CTI)
    var aplicarBtn = document.getElementById("btn-aplicar");
    if (aplicarBtn) aplicarBtn.onclick = applySelectedTemplate;

    // Log close
    var logClose = $("log-close");
    if (logClose) logClose.onclick = function () { $("log").classList.add("hidden"); };
    var logBtn = $("btn-debug");
    if (logBtn) logBtn.onclick = function () { $("log").classList.toggle("hidden"); };

    // Sidebar (Categorias + Palavras)
    document.querySelectorAll(".side__item").forEach(function (item) {
        item.onclick = function () {
            document.querySelectorAll(".side__item").forEach(function (x) { x.classList.remove("on"); });
            item.classList.add("on");
            // window.STATE_LEGENDAS é setado pelo app.js
            var words = item.dataset.words;
            if (window.LegendasState) {
                window.LegendasState.wordsFilter = words || null;
                window.LegendasState.page = 0;
                if (window.LegendasRenderGrid) window.LegendasRenderGrid();
            }
        };
    });

    // (APLICAR já bindado acima — applySelectedTemplate)

    // Init UI
    updateTopStatus();
    updateSfxStatus();
    logLine("[BOOT] Editor Premium · build 3.3 · Premiere integration LIVE");
}

// Toca pra app.js poder atualizar status quando logar
window.editorUpdateStatus = function () { updateTopStatus(); };

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindEditor);
} else {
    bindEditor();
}

})();
