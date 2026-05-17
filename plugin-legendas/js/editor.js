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

// ============================================================ MODE TOGGLE (TEMPLATES | AUTOMAÇÃO SRT)
var CURRENT_MODE = "templates";
function setMode(mode) {
    CURRENT_MODE = mode;
    $("mode-templates").classList.toggle("active", mode === "templates");
    $("mode-automation").classList.toggle("active", mode === "automation");
    var auto = $("automation");
    if (mode === "automation") {
        // Esconde grid normal, mostra panel de automation
        $("grid").style.display = "none";
        $("side").style.display = "none";
        $("tabs").style.display = "none";
        $("breadcrumb").style.display = "none";
        if (auto) { auto.classList.remove("hidden"); auto.style.display = "block"; }
        renderAutomationOptions();
    } else {
        $("grid").style.display = "";
        $("side").style.display = "";
        $("tabs").style.display = "";
        $("breadcrumb").style.display = "";
        if (auto) auto.classList.add("hidden");
    }
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
            $("srt-title").textContent = "✓ " + file.name + " · " + SRT_DATA.length + " blocos";
            $("srt-sub").textContent = "Pronto para automação. Clique em AUTOMAÇÃO SRT pra processar.";
            document.querySelector(".srtbar").classList.add("loaded");
            logLine("[SRT] Carregado: " + file.name + " · " + SRT_DATA.length + " linhas");
        } catch (err) {
            logLine("[SRT] ERRO: " + err.message);
            alert("Erro ao ler SRT: " + err.message);
        }
    };
    reader.readAsText(file, "utf-8");
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
    var auto = $("automation"); if (!auto) return;
    var preview = $("auto-preview"); if (!preview) return;
    if (!SRT_DATA) {
        preview.innerHTML = '<div style="text-align:center;padding:40px;color:var(--mut)">Carregue um arquivo SRT primeiro (botão "Carregar agora" no topo)</div>';
        return;
    }
    var perBlock = Number($("auto-words").value || 3);
    var allWords = getAllWords();
    var blocks = [];
    for (var i = 0; i < allWords.length; i += perBlock) {
        blocks.push(allWords.slice(i, i + perBlock).join(" "));
    }
    preview.innerHTML = "";
    blocks.slice(0, 200).forEach(function (txt) {
        var c = document.createElement("div");
        c.className = "aw-chip";
        c.textContent = txt;
        c.title = txt;
        preview.appendChild(c);
    });
    if (blocks.length > 200) {
        var more = document.createElement("div");
        more.className = "aw-chip";
        more.style.background = "var(--bg)"; more.style.color = "var(--mut)";
        more.textContent = "+" + (blocks.length - 200) + " mais";
        preview.appendChild(more);
    }
}

// ============================================================ LOG
function logLine(text) {
    var body = $("log-body"); if (!body) return;
    var line = document.createElement("div");
    line.style.padding = "2px 0";
    var t = new Date().toLocaleTimeString("pt-BR", { hour12: false });
    line.textContent = "[" + t + "] " + text;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
    // também atualiza status line
    var status = $("status");
    if (status) status.textContent = text.replace(/^\[\w+\]\s*/, "");
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

    // SRT load
    var btnSrt = $("btn-load-srt");
    var fileSrt = $("srt-file");
    if (btnSrt && fileSrt) {
        btnSrt.onclick = function () { fileSrt.click(); };
        fileSrt.onchange = function (e) {
            var f = e.target.files && e.target.files[0];
            if (f) loadSRTFile(f);
        };
    }

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

    // Automation config
    var aw = $("auto-words");
    if (aw) aw.onchange = renderAutomationOptions;
    var apply = $("btn-apply-all");
    if (apply) apply.onclick = function () {
        if (!SRT_DATA) { alert("Carregue um SRT primeiro"); return; }
        var withSfx = $("opt-with-sfx") && $("opt-with-sfx").checked && SFX_SELECTED;
        var mode = (document.querySelector('input[name="apply-mode"]:checked') || {}).value || "keep";
        logLine("[APPLY] " + SRT_DATA.length + " blocos · SFX: " + (withSfx ? SFX_LIBRARY[SFX_SELECTED].name : "não") + " · modo: " + mode);
        toast("Automação iniciada · " + SRT_DATA.length + " blocos (preview — integração com Premiere na fase 2)", "ok", 4500);
    };

    // Log close
    var logClose = $("log-close");
    if (logClose) logClose.onclick = function () { $("log").classList.add("hidden"); };
    var logBtn = $("btn-debug");
    if (logBtn) logBtn.onclick = function () { $("log").classList.toggle("hidden"); };

    // Init UI
    updateTopStatus();
    updateSfxStatus();
    logLine("[BOOT] Editor Premium · build 2.0.0");
}

// Toca pra app.js poder atualizar status quando logar
window.editorUpdateStatus = function () { updateTopStatus(); };

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindEditor);
} else {
    bindEditor();
}

})();
