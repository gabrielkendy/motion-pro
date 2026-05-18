/* ════════════════════════════════════════════════════════════════
   MotionPro Legendas v4.0 — main.js
   Pipeline funcional inspirado no EP Legendas:
   - Load catalog local (com 549 .mogrt)
   - Render grid + categorias + preview
   - Tab Templates: clica → seleciona → APLICAR insere no CTI
   - Tab Auto SRT: carrega .srt OU lê captions, renderiza editor por grupos,
     APLICAR NA TIMELINE chama EP_hybridApplyTextsAndTiming (batch real)
   - SFX picker (Web Audio synth → tmp WAV → import no Premiere)
   ════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

var BUILD = "4.10.0-wc-correct+captions-multi-api+helpModal";

var nodePath = typeof require === "function" ? require("path") : null;
var nodeFs   = typeof require === "function" ? require("fs") : null;
var nodeOs   = typeof require === "function" ? require("os") : null;
var TICKS = 254016000000;

var $ = function (id) { return document.getElementById(id); };

var cs = (typeof CSInterface !== "undefined") ? new CSInterface() : null;
var EXT_PATH = cs ? normalizeExtPath(cs.getSystemPath(CSInterface.SystemPath.EXTENSION)) : "";

function normalizeExtPath(p) {
    if (!p) return "";
    p = String(p);
    // CSInterface devolve "file:///C:/..." em alguns Premieres — remove prefixo
    p = p.replace(/^file:\/{2,3}/i, "").replace(/^file:/i, "");
    // converte URI-style /C:/ pra C:/ no Windows
    p = p.replace(/^\/([A-Za-z]:)/, "$1");
    // URI decode (espaços etc.)
    try { p = decodeURI(p); } catch (e) {}
    return p;
}

// ── STATE
var CATALOG = null;            // { packs: [...] }
var ALL_TEMPLATES = [];        // achatado: [{ name, mogrt, preview, wc, cat }]
var FILTER = { cat: "all", q: "" };
var SELECTED = null;           // template selecionado
var SRT_DATA = [];             // [{ start, end, text }]
var SRT_GROUPS = [];           // [{ start, end, text, wc, tplName, selected }]
var SFX_SELECTED = localStorage.getItem("mpl_sfx") || null;

// ────────────────────────────────────────────────  LOG / TOAST
function log(msg, kind) {
    var b = $("log-messages"); if (!b) { console.log(msg); return; }
    var d = document.createElement("div");
    d.className = "log-line" + (kind ? " " + kind : "");
    var t = new Date().toLocaleTimeString("pt-BR", { hour12: false });
    d.textContent = "[" + t + "] " + msg;
    b.appendChild(d); b.scrollTop = b.scrollHeight;
    console.log("[MPL] " + msg);
}
function openLog() {
    var body = $("log-body"); var head = $("toggle-log");
    if (body) body.classList.remove("hidden");
    if (head) head.classList.add("open");
}
function toast(text, kind, ms) {
    var old = document.querySelector(".toast"); if (old) old.remove();
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2800);
}
window.MPLLog = log; window.MPLToast = toast;

function setStatus(txt) { var s = $("status-text"); if (s) s.textContent = txt; }

// ────────────────────────────────────────────────  evalScript helper
function jsx(funcCall, cb) {
    if (!cs) { cb && cb({ error: "no_cs" }); return; }
    cs.evalScript(funcCall, function (raw) {
        var d; try { d = JSON.parse(raw || "{}"); } catch (e) { d = { error: "parse_fail", raw: String(raw||"").slice(0,200) }; }
        if (cb) cb(d, raw);
    });
}

// Força reload do host.jsx sem reiniciar Premiere (cache do ExtendScript engine)
function reloadHostJsx(done) {
    if (!cs) { done && done(); return; }
    var hostFile = (EXT_PATH + "/jsx/host.jsx").replace(/\\/g, "/");
    var script = '(function(){try{$.evalFile(new File("' + hostFile + '"));return "reloaded:"+($.global._MPL_VERSION||"?");}catch(e){return "err:"+e.message;}})();';
    log("Recarregando host.jsx…", "info");
    cs.evalScript(script, function (r) {
        log("host.jsx → " + String(r), "info");
        if (done) done();
    });
}

// ────────────────────────────────────────────────  CATALOG
function loadCatalog() {
    if (!nodeFs || !nodePath) { log("Node FS indisponível", "err"); openLog(); return; }
    log("EXT_PATH = " + EXT_PATH, "info");
    var path = nodePath.join(EXT_PATH, "packs", "catalog.json");
    log("catalog path = " + path, "info");
    try {
        if (!nodeFs.existsSync(path)) {
            log("Catalog NÃO EXISTE em " + path, "err"); openLog();
            // tenta fallback (path com forward slashes)
            var alt = path.replace(/\\/g, "/");
            if (nodeFs.existsSync(alt)) { path = alt; }
            else { toast("Catálogo não encontrado", "err"); return; }
        }
        var raw = nodeFs.readFileSync(path, "utf8");
        CATALOG = JSON.parse(raw);
        ALL_TEMPLATES = flatten(CATALOG);
        buildTplIndex();
        var wcDist = Object.keys(TPLS_BY_WC).sort().map(function (k) { return k + "p:" + TPLS_BY_WC[k].length; }).join(" · ");
        log("✓ Catalog: " + ALL_TEMPLATES.length + " templates · " + wcDist, "info");
        renderCategories();
        renderGrid();
        renderTplPickerOptions();
        renderAutoSrtTemplateOptions();
        populateSfxTracks();
    } catch (e) {
        log("Catalog FAIL: " + e.message, "err"); openLog();
        toast("Catálogo não carregou — veja LOG", "err", 5000);
    }
}

function flatten(catalog) {
    var out = [];
    (catalog.packs || []).forEach(function (p) {
        (p.categories || []).forEach(function (c) {
            (c.items || []).forEach(function (it) {
                out.push({
                    name: it.name,
                    mogrt: it.mogrt,
                    preview: it.preview || null,
                    wc: (it.wc != null) ? it.wc : deriveWordCount(it.name, c.name),
                    cat: c.name || p.name || "Geral",
                    pack: p.id || p.name,
                    ep: !!it.ep_id   // marcador "template estilo EP"
                });
            });
        });
    });
    return out;
}

function deriveWordCount(name, cat) {
    // 1) "1 Palavra", "2 Palavras" na categoria
    var m = /(\d+)\s*palavra/i.exec(cat || "");
    if (m) return Number(m[1]);
    // 2) "Texto 01" → derivar por mapeamento (similar ao EP onde o nome dita)
    var n = /(?:Texto|Kinetic|Title|Lower)\s*(\d+)/i.exec(name || "");
    if (n) {
        var idx = Number(n[1]);
        // Heurística: ordena por número, usa o resto / 3 (estimativa)
        // — não é precisa mas dá uma sensação de variação por wc
        return Math.max(1, Math.min(7, ((idx - 1) % 7) + 1));
    }
    return null;
}

// ────────────────────────────────────────────────  RENDER
function renderCategories() {
    var el = $("cat-list"); if (!el) return;
    var cats = {};
    ALL_TEMPLATES.forEach(function (t) { cats[t.cat] = (cats[t.cat] || 0) + 1; });
    el.innerHTML = '<button class="cat-item active" data-cat="all">Todos (' + ALL_TEMPLATES.length + ')</button>';
    Object.keys(cats).sort().forEach(function (c) {
        var b = document.createElement("button");
        b.className = "cat-item"; b.setAttribute("data-cat", c);
        b.textContent = c + " (" + cats[c] + ")";
        el.appendChild(b);
    });
    el.querySelectorAll(".cat-item").forEach(function (b) {
        b.onclick = function () {
            el.querySelectorAll(".cat-item").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
            FILTER.cat = b.getAttribute("data-cat");
            renderGrid();
        };
    });
}

function applyFilter() {
    var q = (FILTER.q || "").toLowerCase();
    return ALL_TEMPLATES.filter(function (t) {
        if (FILTER.cat && FILTER.cat !== "all" && t.cat !== FILTER.cat) return false;
        if (q && t.name.toLowerCase().indexOf(q) < 0) return false;
        return true;
    });
}

function renderGrid() {
    var g = $("template-grid"); if (!g) return;
    var loading = $("grid-loading"); if (loading) loading.classList.add("hidden");
    var items = applyFilter();
    g.innerHTML = "";

    var emptyEl = $("grid-empty");
    if (items.length === 0) { emptyEl && emptyEl.classList.remove("hidden"); return; }
    emptyEl && emptyEl.classList.add("hidden");

    // limita a 200 visíveis (perf)
    var limit = Math.min(items.length, 200);
    for (var i = 0; i < limit; i++) {
        g.appendChild(makeTplCard(items[i], i));
    }
    if (items.length > limit) {
        var more = document.createElement("div");
        more.style.cssText = "grid-column:1/-1;padding:10px;text-align:center";
        more.innerHTML = '<button class="btn-util">Carregar mais (' + (items.length - limit) + ')</button>';
        g.appendChild(more);
    }
}

function makeTplCard(t, idx) {
    var card = document.createElement("div");
    card.className = "tpl-card";
    if (SELECTED && SELECTED.name === t.name) card.classList.add("selected");

    var thumbHtml = '<div class="tpl-card__thumb">' + thumbFor(t) +
                    (t.wc ? '<span class="tpl-card__wc">' + t.wc + 'p</span>' : '') +
                    '</div>' +
                    '<div class="tpl-card__name" title="' + esc(t.name) + '">' + esc(t.name) + '</div>';
    card.innerHTML = thumbHtml;

    card.onclick = function () {
        SELECTED = t;
        document.querySelectorAll(".tpl-card.selected").forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        showPreview(t);
        var btn = $("btn-hybrid-apply-all"); if (btn) { btn.disabled = false; btn.textContent = "⚡ APLICAR · " + t.name; }
    };
    card.ondblclick = function () { applySingle(); };
    return card;
}

function thumbFor(t) {
    if (t.preview && nodeFs && nodePath) {
        var p = nodePath.join(EXT_PATH, "packs", t.preview);
        if (nodeFs.existsSync(p)) {
            var url = "file:///" + p.replace(/\\/g, "/").replace(/ /g, "%20");
            return '<img src="' + url + '" loading="lazy" style="width:100%;height:100%;object-fit:cover">';
        }
    }
    return mockupSvg(t.name, t.cat);
}

function mockupSvg(label, cat) {
    var s = styleFor(cat);
    var lbl = (label || "").length > 18 ? label.slice(0, 16) + "…" : label;
    return '<svg viewBox="0 0 130 73" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">' +
           '<rect width="130" height="73" fill="' + s.bg + '"/>' +
           '<text x="65" y="42" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="' + s.size + '" text-anchor="middle" letter-spacing="' + (s.tracking || 0) + '">' + esc(lbl) + '</text>' +
           '</svg>';
}

function styleFor(cat) {
    cat = String(cat || "").toLowerCase();
    if (cat.indexOf("lower") >= 0) return { bg: "#1c1c25", fg: "#fff", font: "Inter", weight: 600, size: 9 };
    if (cat.indexOf("title") >= 0 || cat.indexOf("simple") >= 0) return { bg: "#0d0d11", fg: "#fff", font: "Inter", weight: 700, size: 11 };
    return { bg: "#15151c", fg: "#38e287", font: "Inter", weight: 800, size: 11, tracking: 1 };
}

function showPreview(t) {
    var img = $("preview-img"); var ph = $("preview-placeholder");
    if (t.preview && nodeFs && nodePath) {
        var p = nodePath.join(EXT_PATH, "packs", t.preview);
        if (nodeFs.existsSync(p)) {
            img.src = "file:///" + p.replace(/\\/g, "/");
            img.style.display = ""; ph.style.display = "none";
        } else {
            img.style.display = "none"; ph.style.display = "";
            ph.innerHTML = mockupSvg(t.name, t.cat);
        }
    } else {
        img.style.display = "none"; ph.style.display = "";
        ph.innerHTML = mockupSvg(t.name, t.cat);
    }
    var nm = $("preview-name"); if (nm) nm.textContent = t.name;
    var mt = $("preview-meta"); if (mt) mt.textContent = t.cat + (t.wc ? " · " + t.wc + " palavra" + (t.wc === 1 ? "" : "s") : "");
}

function esc(s) { return String(s||"").replace(/[<>&"']/g, function (c) { return { "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;" }[c]; }); }

// ────────────────────────────────────────────────  TEMPLATE PICKER (modal)
function renderTplPickerOptions() {
    var list = $("tpl-picker-list"); if (!list) return;
    var search = $("tpl-picker-search");
    var wcF = $("tpl-picker-wc-filter");
    var wcSel = null;

    function build() {
        var q = (search.value || "").toLowerCase();
        list.innerHTML = "";
        var items = ALL_TEMPLATES.filter(function (t) {
            if (wcSel != null && t.wc !== wcSel) return false;
            if (q && t.name.toLowerCase().indexOf(q) < 0) return false;
            return true;
        }).slice(0, 200);
        items.forEach(function (t) {
            var el = document.createElement("div"); el.className = "tpl-pick";
            el.innerHTML = '<div class="tpl-pick__thumb">' + thumbFor(t) + '</div>' +
                           '<div class="tpl-pick__name">' + esc(t.name) + '</div>' +
                           '<div class="tpl-pick__wc">' + (t.wc ? t.wc + "p" : "—") + '</div>';
            el.onclick = function () { onTplPicked(t); };
            list.appendChild(el);
        });
    }

    if (search) search.oninput = build;
    var wcs = [1, 2, 3, 4, 5, 6, 7];
    wcF.innerHTML = '<button class="wc-pill active" data-wc="">Todos</button>' +
                    wcs.map(function (w) { return '<button class="wc-pill" data-wc="'+w+'">'+w+'p</button>'; }).join("");
    wcF.querySelectorAll(".wc-pill").forEach(function (b) {
        b.onclick = function () {
            wcF.querySelectorAll(".wc-pill").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
            var v = b.getAttribute("data-wc");
            wcSel = v ? Number(v) : null;
            build();
        };
    });
    build();
}

var TPL_PICKER_CB = null;
function openTplPicker(cb) {
    TPL_PICKER_CB = cb;
    var ov = $("tpl-picker-overlay"); if (ov) ov.classList.remove("hidden");
}
function closeTplPicker() {
    var ov = $("tpl-picker-overlay"); if (ov) ov.classList.add("hidden");
    TPL_PICKER_CB = null;
}
function onTplPicked(t) {
    if (TPL_PICKER_CB) TPL_PICKER_CB(t);
    closeTplPicker();
}

// ────────────────────────────────────────────────  APLICAR SINGLE
function applySingle() {
    if (!SELECTED) { toast("Selecione um template", "warn"); return; }
    if (!SELECTED.mogrt) { toast("Template sem .mogrt", "err"); return; }
    var abs = nodePath.join(EXT_PATH, "packs", SELECTED.mogrt);
    log("Aplicando: " + SELECTED.name);
    var withSfx = $("tpl-with-sfx") && $("tpl-with-sfx").checked && SFX_SELECTED;
    var audioTrack = withSfx ? ($("tpl-sfx-track-select") && $("tpl-sfx-track-select").value) : null;

    // Pega CTI primeiro pra mandar ticks certos
    jsx("$.global.EP_getCTI();", function (cti) {
        var ticks = (cti && cti.ticks) ? cti.ticks : "0";
        var call = "$.global.EP_applyOneGroup(" +
            JSON.stringify(abs) + "," +
            JSON.stringify(ticks) + ",\"last\"," +
            JSON.stringify(SELECTED.name) + ",2.0);";
        cs.evalScript(call, function (raw) {
            var d; try { d = JSON.parse(raw || "{}"); } catch (e) { d = { error: "parse: " + String(raw||"").slice(0,120) }; }
            if (d.error) {
                log("✗ " + d.error, "err"); openLog();
                toast("Erro: " + d.error, "err", 4500);
                return;
            }
            log("✓ V" + (d.track + 1) + " · textChanged=" + d.textChanged + " (de " + d.textAttempts + " tentativas)", d.textChanged ? "info" : "warn");
            toast("✓ " + SELECTED.name + " · V" + (d.track + 1), "ok");
            if (withSfx && audioTrack) placeSfxAt(ticks, audioTrack);
        });
    });
}

// ────────────────────────────────────────────────  SRT PARSER + EDITOR
function parseSRT(text) {
    var blocks = text.replace(/\r/g, "").split(/\n\n+/);
    var out = [];
    blocks.forEach(function (b) {
        var lines = b.trim().split("\n");
        if (lines.length < 2) return;
        var ti = -1;
        for (var i = 0; i < lines.length; i++) { if (lines[i].indexOf("-->") >= 0) { ti = i; break; } }
        if (ti < 0) return;
        var m = lines[ti].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
        if (!m) return;
        function tos(h, mn, s, ms) { return Number(h)*3600 + Number(mn)*60 + Number(s) + Number(ms)/1000; }
        var s = tos(m[1],m[2],m[3],m[4]);
        var e = tos(m[5],m[6],m[7],m[8]);
        var txt = lines.slice(ti+1).join(" ").trim();
        if (txt) out.push({ start: s, end: e, text: txt });
    });
    return out;
}

function chunkByWords(blocks, perChunk) {
    var groups = [];
    blocks.forEach(function (b) {
        var words = (b.text || "").trim().split(/\s+/).filter(Boolean);
        if (!words.length) return;
        var dur = Math.max(.4, b.end - b.start);
        var n = Math.ceil(words.length / perChunk);
        for (var i = 0; i < n; i++) {
            var slice = words.slice(i*perChunk, (i+1)*perChunk);
            var s = b.start + (i / n) * dur;
            var e = b.start + ((i + 1) / n) * dur;
            groups.push({
                start: s, end: e,
                text: slice.join(" "),
                wc: slice.length,
                tplName: null,
                selected: false
            });
        }
    });
    return groups;
}

// === DISTRIBUIÇÃO INTELIGENTE ===
// Quebra o SRT respeitando pontuação, conectores e usando word counts que
// CASAM com os templates disponíveis. Resultado: zero ajuste manual.
var CONNECTORS = ["a","o","e","ou","de","do","da","dos","das","em","no","na","nos","nas",
    "ao","aos","à","às","com","para","pra","por","pelo","pela","pelos","pelas","que","se",
    "um","uma","uns","umas","é","mas","como","já","só","seu","sua","seus","suas","meu","minha","te","me","lhe","nos","vos"];

function smartDistribute(blocks) {
    if (!TPLS_BY_WC) buildTplIndex();
    var availableWcs = Object.keys(TPLS_BY_WC).map(Number).filter(function (k) { return k > 0; }).sort(function (a, b) { return a - b; });
    if (!availableWcs.length) return chunkByWords(blocks, 3);
    var minWc = availableWcs[0];
    var maxWc = availableWcs[availableWcs.length - 1];

    // Conector mode da UI
    var connMode = ($("auto-srt-connector-mode") && $("auto-srt-connector-mode").value) || "smart";

    var groups = [];

    blocks.forEach(function (b) {
        var words = (b.text || "").trim().split(/\s+/).filter(Boolean);
        if (!words.length) return;
        var totalDur = Math.max(.4, b.end - b.start);
        var totalWords = words.length;

        // Encontra quebras naturais (pontuação no meio do bloco)
        var hardBreaks = [];   // índices onde HÁ que quebrar (depois de . ! ?)
        for (var i = 0; i < words.length - 1; i++) {
            if (/[\.!?]$/.test(words[i])) hardBreaks.push(i + 1);
        }

        // Particiona em segmentos baseado em hardBreaks
        var segs = [];
        var last = 0;
        hardBreaks.forEach(function (idx) {
            segs.push(words.slice(last, idx));
            last = idx;
        });
        if (last < words.length) segs.push(words.slice(last));

        // Pra cada segmento, decide melhor wc
        segs.forEach(function (seg) {
            chunkSegment(seg);
        });

        function chunkSegment(seg) {
            if (!seg.length) return;
            // Se cabe num wc disponível, vai inteiro
            if (seg.length <= maxWc && availableWcs.indexOf(seg.length) >= 0) {
                emit(seg);
                return;
            }
            if (seg.length <= maxWc) {
                // Não tem template exato — usa mais próximo
                emit(seg);
                return;
            }
            // Precisa dividir: prefere chunks 3-4p (sweet spot)
            var target = (availableWcs.indexOf(3) >= 0) ? 3 : (availableWcs.indexOf(4) >= 0 ? 4 : Math.min(maxWc, 3));
            var cursor = 0;
            while (cursor < seg.length) {
                var chunkSize = Math.min(target, seg.length - cursor);
                // smart connector: se a próxima word é conector, agrega ao chunk anterior
                if (connMode === "smart" && cursor + chunkSize < seg.length) {
                    var nextWord = (seg[cursor + chunkSize] || "").toLowerCase().replace(/[^\wÀ-ú]/g, "");
                    if (CONNECTORS.indexOf(nextWord) >= 0 && chunkSize < maxWc) chunkSize++;
                }
                if (connMode === "always_isolate" && chunkSize >= 2) {
                    // isola conectores no início do chunk como grupo separado
                    var firstWord = (seg[cursor] || "").toLowerCase().replace(/[^\wÀ-ú]/g, "");
                    if (CONNECTORS.indexOf(firstWord) >= 0) {
                        emit([seg[cursor]]); cursor++; continue;
                    }
                }
                emit(seg.slice(cursor, cursor + chunkSize));
                cursor += chunkSize;
            }
        }

        function emit(slice) {
            var startRatio = wordsBeforeOffset(slice) / totalWords;
            var endRatio = (wordsBeforeOffset(slice) + slice.length) / totalWords;
            groups.push({
                start: b.start + startRatio * totalDur,
                end:   b.start + endRatio * totalDur,
                text:  slice.join(" "),
                wc:    slice.length,
                tplName: null,
                selected: false
            });
        }

        function wordsBeforeOffset(slice) {
            var s = slice.join(" ");
            var idx = words.join(" ").indexOf(s);
            if (idx < 0) return 0;
            return words.join(" ").substring(0, idx).split(/\s+/).filter(Boolean).length;
        }
    });

    return groups;
}

// === GERA SRT DO ZERO A PARTIR DE SCRIPT ===
// Quebra o texto OTIMIZADO pelos word counts dos templates disponíveis
// e CALCULA timings baseado em WPM (palavras-por-minuto)
function scriptToSrt(text, opts) {
    opts = opts || {};
    var wpm = opts.wpm || 150;
    var gap = opts.gap || 0.3;            // pausa em segundos após ponto final
    var startSec = opts.startSec || 0;
    var secPerWord = 60 / wpm;             // duração média de 1 palavra

    if (!TPLS_BY_WC) buildTplIndex();
    var availableWcs = Object.keys(TPLS_BY_WC).map(Number).filter(function (k) { return k > 0; }).sort(function (a, b) { return a - b; });
    var maxWc = availableWcs[availableWcs.length - 1] || 4;

    // Tokeniza preservando pontuação
    var sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[\.!?])\s+/).filter(Boolean);

    var groups = [];
    var cursor = startSec;

    sentences.forEach(function (sentence) {
        var words = sentence.split(/\s+/).filter(Boolean);
        if (!words.length) return;

        // Divide a frase em chunks que casam com templates
        var chunks = greedyChunkForTemplates(words, availableWcs);

        // Distribui timing proporcional à contagem de palavras
        chunks.forEach(function (chunk) {
            var dur = Math.max(0.5, chunk.length * secPerWord);
            groups.push({
                start: cursor,
                end: cursor + dur,
                text: chunk.join(" "),
                wc: chunk.length,
                tplName: null,
                selected: false
            });
            cursor += dur + 0.05;          // pequeno gap entre legendas
        });

        cursor += gap;                     // pausa após pontuação final
    });

    return groups;
}

// Greedy: a partir das word counts disponíveis, distribui as palavras
// preferindo chunks que existem como template, e quando possível 3-4 palavras
function greedyChunkForTemplates(words, availableWcs) {
    var out = [];
    var i = 0;
    while (i < words.length) {
        var remaining = words.length - i;
        var picked;

        // Tenta achar size que existe nos templates, preferindo "near 3"
        var byPref = availableWcs.slice().sort(function (a, b) {
            // sort: 1) size <= remaining preferido 2) proximidade de 3 3) decrescente
            var distA = Math.abs(a - 3), distB = Math.abs(b - 3);
            var fitA = a <= remaining ? 0 : 100, fitB = b <= remaining ? 0 : 100;
            return (fitA - fitB) || (distA - distB);
        });
        picked = byPref[0] || 3;
        if (picked > remaining) picked = remaining;

        // Se a sobra após esse chunk for "lixo" (1 palavra solta no fim),
        // tenta agregar pra evitar
        if (i + picked < words.length - 1 && words.length - (i + picked) === 1 && picked < maxWcOf(availableWcs)) {
            picked = Math.min(picked + 1, remaining);
        }

        out.push(words.slice(i, i + picked));
        i += picked;
    }
    return out;
}

function maxWcOf(arr) { return arr.length ? arr[arr.length - 1] : 5; }

function applySmartDistribution() {
    if (!SRT_DATA.length) { toast("Carregue um SRT primeiro", "warn"); return; }
    resetAutoPickRotation();
    SRT_GROUPS = smartDistribute(SRT_DATA);
    SRT_GROUPS.forEach(function (g) { g.tplName = defaultTplForWc(g.wc); g.selected = false; });
    renderSrtEditor(); updateSrtSummary();

    // Log estatística: distribuição por wc
    var byWc = {};
    SRT_GROUPS.forEach(function (g) { byWc[g.wc] = (byWc[g.wc] || 0) + 1; });
    var stats = Object.keys(byWc).sort().map(function (k) { return k + "p:" + byWc[k]; }).join(" · ");
    log("⚡ Distribuição: " + SRT_GROUPS.length + " grupos · " + stats, "info");
    // Mostra exemplos
    SRT_GROUPS.slice(0, 5).forEach(function (g, i) {
        log("   #" + (i+1) + " '" + g.text + "' (" + g.wc + "p) → " + g.tplName, "info");
    });
    toast("⚡ " + SRT_GROUPS.length + " grupos · revise →", "ok");
    switchTab("tab-srt-editor");
}

// ────────────────────────────────────────────────  CRIAR LEGENDAS DO ZERO

function timecodeToSecs(tc) {
    var m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(tc || "00:00:00,000");
    if (!m) return 0;
    return Number(m[1])*3600 + Number(m[2])*60 + Number(m[3]) + Number(m[4]) / 1000;
}
function secsToTimecode(s) {
    var h = Math.floor(s / 3600); s -= h*3600;
    var m = Math.floor(s / 60);   s -= m*60;
    var sec = Math.floor(s);
    var ms = Math.round((s - sec) * 1000);
    function pad(n, w) { var v = String(n); while (v.length < w) v = "0" + v; return v; }
    return pad(h,2) + ":" + pad(m,2) + ":" + pad(sec,2) + "," + pad(ms,3);
}

function generateLegendasFromScript() {
    var text = ($("create-script") && $("create-script").value || "").trim();
    if (!text) { toast("Escreva ou cole o roteiro primeiro", "warn"); return; }
    var startSec = timecodeToSecs($("create-start").value);
    var wpm = parseInt($("create-wpm").value, 10) || 150;
    var gap = parseFloat($("create-gap").value) || 0;

    var groups = scriptToSrt(text, { startSec: startSec, wpm: wpm, gap: gap });
    if (!groups.length) { toast("Não consegui gerar grupos do texto", "err"); return; }

    // Atribui templates por wc
    groups.forEach(function (g) { g.tplName = defaultTplForWc(g.wc); g.selected = false; });

    // Cria SRT_DATA (formato bloco) e SRT_GROUPS (já distribuído)
    SRT_DATA = groups.map(function (g) { return { start: g.start, end: g.end, text: g.text }; });
    SRT_GROUPS = groups;

    // Renderiza preview na própria tab
    renderCreatePreview(groups);
    log("✨ Script → SRT: " + groups.length + " grupos (" + wpm + " wpm)", "info");
}

function renderCreatePreview(groups) {
    var box = $("create-preview");
    var list = $("create-preview-list");
    var count = $("create-preview-count");
    if (!box || !list) return;
    box.classList.remove("hidden");
    count.textContent = groups.length + " grupos · duração " + groups[groups.length-1].end.toFixed(1) + "s";
    list.innerHTML = "";
    groups.slice(0, 60).forEach(function (g) {
        var row = document.createElement("div");
        row.className = "create-prev-row";
        row.innerHTML =
            '<span class="t">' + fmtTime(g.start) + '</span>' +
            '<span class="x">' + esc(g.text) + '</span>' +
            '<span class="w">' + g.wc + 'p</span>' +
            '<span class="tpl">' + esc(g.tplName || "—") + '</span>';
        list.appendChild(row);
    });
    if (groups.length > 60) {
        var more = document.createElement("div");
        more.className = "create-prev-row";
        more.style.cssText = "justify-content:center;color:var(--text-3);font-style:italic";
        more.textContent = "… +" + (groups.length - 60) + " grupos";
        list.appendChild(more);
    }
}

function applyCreatedLegendas() {
    if (!SRT_GROUPS.length) { toast("Gere as legendas primeiro", "warn"); return; }
    // marca SRT como carregado
    var bar = $("ep-srt-status-banner");
    if (bar) {
        bar.classList.add("loaded");
        bar.querySelector(".ep-srt-status-text").textContent = "✓ Roteiro gerado · " + SRT_GROUPS.length + " grupos";
        bar.querySelector(".ep-srt-status-action").textContent = "Editar →";
    }
    $("auto-srt-bulk-bar").classList.add("show");
    var bs = $("btn-srt-smart-dist"); if (bs) bs.disabled = false;
    renderSrtEditor(); updateSrtSummary();
    var ap = $("btn-auto-srt-apply"); if (ap) ap.disabled = false;
    hideEditorEmpty();
    switchTab("tab-srt-editor");
    toast("✓ SRT pronto · revise e clique APLICAR NA TIMELINE", "ok", 4500);
}

// ────────────────────────────────────────────────  FONTES

function checkFontsBanner() {
    if (localStorage.getItem("mpl_fonts_dismiss")) return;
    if (!cs || !nodePath) return;
    var fontsDir = nodePath.join(EXT_PATH, "fonts");
    jsx("$.global.EP_checkFonts(" + JSON.stringify(fontsDir) + ");", function (d) {
        if (d.error) return;
        if (d.missing > 0) {
            var banner = $("font-banner");
            if (banner) {
                banner.classList.remove("hidden");
                var txt = $("font-banner-text");
                if (txt) txt.textContent = "🔤 " + d.missing + " fontes premium dos templates faltando — instale pra renderizar correto";
            }
        }
    });
}

function installFonts() {
    if (!cs || !nodePath) { toast("Node FS indisponível", "err"); return; }
    var fontsDir = nodePath.join(EXT_PATH, "fonts");
    var btn = $("btn-install-fonts");
    if (btn) { btn.textContent = "Instalando…"; btn.disabled = true; }
    log("Instalando fontes de " + fontsDir, "info");
    jsx("$.global.EP_installFonts(" + JSON.stringify(fontsDir) + ");", function (d) {
        if (btn) { btn.disabled = false; }
        if (d.error) {
            log("✗ Fontes: " + d.error, "err"); openLog();
            toast("Erro: " + d.error, "err", 5000);
            if (btn) btn.textContent = "Tentar novamente";
            return;
        }
        log("✓ Fontes: " + d.installed + " instaladas · " + d.skipped + " já existiam", "info");
        log("  pasta: " + d.fontDir, "info");
        toast("✓ " + d.installed + " fontes instaladas! Reinicie o Premiere pra elas aparecerem.", "ok", 6000);
        $("font-banner").classList.add("hidden");
        localStorage.setItem("mpl_fonts_dismiss", "1");
    });
}

// Cache de templates agrupados por wc pra picking eficiente
var TPLS_BY_WC = null;
function buildTplIndex() {
    TPLS_BY_WC = {};
    ALL_TEMPLATES.forEach(function (t) {
        var w = t.wc != null ? t.wc : 0;
        if (!TPLS_BY_WC[w]) TPLS_BY_WC[w] = [];
        TPLS_BY_WC[w].push(t);
    });
}

// Escolhe template AUTO por wc (rotaciona entre disponíveis pra variar visual)
// IMPORTANTE: sempre prioriza o wc REAL do grupo, independente do dropdown.
// Dropdown "Template" só sobrescreve quando user explicitamente fixou.
var AUTO_PICK_IDX = {};
function defaultTplForWc(wc) {
    var tplSel = $("auto-srt-default-tpl");
    var fixedName = tplSel && tplSel.value;

    if (!TPLS_BY_WC) buildTplIndex();

    // 1) Se user escolheu template fixo no dropdown E ele bate com o wc do grupo, usa
    if (fixedName) {
        var fixedTpl = ALL_TEMPLATES.find(function (t) { return t.name === fixedName; });
        if (fixedTpl && fixedTpl.wc === wc) return fixedName;
        // Se não bate, IGNORA o dropdown e escolhe certo pelo wc
    }

    // 2) Acha pool do wc EXATO do grupo
    var pool = TPLS_BY_WC[wc];
    if (!pool || !pool.length) {
        // fallback: wc mais próximo disponível
        var keys = Object.keys(TPLS_BY_WC).map(Number).filter(function (k) { return k > 0; }).sort(function (a, b) {
            return Math.abs(a - wc) - Math.abs(b - wc);
        });
        if (!keys.length) return ALL_TEMPLATES[0] ? ALL_TEMPLATES[0].name : null;
        pool = TPLS_BY_WC[keys[0]];
    }

    // 3) Rotação pra variar visualmente entre grupos do mesmo wc
    var key = "wc" + wc;
    var idx = AUTO_PICK_IDX[key] || 0;
    AUTO_PICK_IDX[key] = (idx + 1) % pool.length;
    return pool[idx].name;
}

// Reset rotação (chamado quando user faz nova distribuição)
function resetAutoPickRotation() { AUTO_PICK_IDX = {}; }

function rebuildGroups() {
    var per = parseInt($("auto-srt-groupsize") && $("auto-srt-groupsize").value, 10) || 3;
    resetAutoPickRotation();
    SRT_GROUPS = chunkByWords(SRT_DATA, per);
    SRT_GROUPS.forEach(function (g) { g.tplName = defaultTplForWc(g.wc); g.selected = false; });
    renderSrtEditor();
    updateSrtSummary();
    var ap = $("btn-auto-srt-apply"); if (ap) ap.disabled = SRT_GROUPS.length === 0;
}

function renderSrtEditor() {
    var ed = $("auto-srt-editor"); if (!ed) return;
    ed.innerHTML = "";
    SRT_GROUPS.forEach(function (g, idx) {
        var row = document.createElement("div");
        row.className = "srt-grp" + (g.selected ? " selected" : "");
        row.innerHTML =
            '<input type="checkbox"' + (g.selected ? " checked" : "") + '>' +
            '<div class="srt-grp__time">' + fmtTime(g.start) + '</div>' +
            '<input class="srt-grp__text" type="text" value="' + esc(g.text) + '">' +
            '<div class="srt-grp__wc" title="palavras">' + g.wc + '</div>' +
            '<button class="srt-grp__tpl-btn' + (g.tplName ? " has" : "") + '" title="' + esc(g.tplName || "Sem template") + '">' + (g.tplName ? "✓" : "+") + '</button>';
        // wire
        row.querySelector("input[type=checkbox]").onchange = function (e) {
            g.selected = e.target.checked; row.classList.toggle("selected", g.selected);
            updateBulkActions();
        };
        row.querySelector(".srt-grp__text").oninput = function (e) {
            g.text = e.target.value;
            g.wc = g.text.trim().split(/\s+/).filter(Boolean).length;
            row.querySelector(".srt-grp__wc").textContent = g.wc;
        };
        row.querySelector(".srt-grp__tpl-btn").onclick = function () {
            openTplPicker(function (t) {
                g.tplName = t.name; renderSrtEditor();
            });
        };
        ed.appendChild(row);
    });
}

function fmtTime(s) {
    var m = Math.floor(s / 60); var ss = Math.floor(s % 60);
    return (m < 10 ? "0" : "") + m + ":" + (ss < 10 ? "0" : "") + ss;
}

function updateSrtSummary() {
    var sm = $("auto-srt-summary");
    if (sm) {
        if (SRT_GROUPS.length === 0) { sm.classList.remove("show"); }
        else {
            sm.classList.add("show");
            var withTpl = SRT_GROUPS.filter(function (g) { return g.tplName; }).length;
            sm.innerHTML = "<b>" + SRT_GROUPS.length + "</b> grupos · <b>" + withTpl + "</b> com template · <b>" + (SRT_GROUPS.length - withTpl) + "</b> sem";
        }
    }
    // Atualiza footer + badge sempre
    updateApplyFooter();
    var badge = document.getElementById("tab-editor-badge");
    if (badge) {
        if (SRT_GROUPS && SRT_GROUPS.length) { badge.classList.remove("hidden"); badge.textContent = SRT_GROUPS.length; }
        else { badge.classList.add("hidden"); }
    }
}

function updateBulkActions() {
    var n = SRT_GROUPS.filter(function (g) { return g.selected; }).length;
    var bar = $("auto-srt-bulk-actions");
    if (!bar) return;
    if (n > 0) {
        bar.classList.remove("hidden");
        $("auto-srt-sel-count").textContent = n + " selecionado" + (n === 1 ? "" : "s");
    } else {
        bar.classList.add("hidden");
    }
}

// ────────────────────────────────────────────────  AUTO SRT — load file
function loadSRT(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            SRT_DATA = parseSRT(e.target.result);
            log("✓ SRT carregado: " + SRT_DATA.length + " blocos", "info");
            var bar = $("ep-srt-status-banner");
            if (bar) {
                bar.classList.add("loaded");
                bar.querySelector(".ep-srt-status-text").textContent = "✓ " + file.name + " · " + SRT_DATA.length + " blocos";
                bar.querySelector(".ep-srt-status-action").textContent = "Editar →";
            }
            $("auto-srt-bulk-bar").classList.add("show");
            // habilita smart-dist
            var bs = $("btn-srt-smart-dist"); if (bs) bs.disabled = false;
            // RECOMENDA usar Distribuição Inteligente — mostra hint
            log("💡 Use o botão ⚡ Distribuição Inteligente pra auto-otimizar templates", "info");
            rebuildGroups();
            hideEditorEmpty();
        } catch (err) {
            log("SRT ERROR: " + err.message, "err"); openLog();
            toast("Erro lendo SRT: " + err.message, "err", 4500);
        }
    };
    reader.readAsText(file, "utf-8");
}

function hideEditorEmpty() {
    var em = $("editor-no-srt"); if (em) em.style.display = "none";
}

function showCaptionsHelpModal() {
    var ov = $("captions-help-overlay"); if (ov) ov.classList.remove("hidden");
}
function hideCaptionsHelpModal() {
    var ov = $("captions-help-overlay"); if (ov) ov.classList.add("hidden");
}

function loadCaptions() {
    log("Lendo captions/transcript nativos do Premiere…");
    jsx("$.global.EP_readCaptions();", function (d) {
        if (d.error) {
            log(d.error, "warn"); openLog();
            showCaptionsHelpModal();
            return;
        }
        log("✓ Lido via " + (d.source || "?") + " · " + d.blocks.length + " blocos", "info");
        SRT_DATA = d.blocks;
        log("✓ " + SRT_DATA.length + " captions importadas", "info");
        var bar = $("ep-srt-status-banner");
        if (bar) {
            bar.classList.add("loaded");
            bar.querySelector(".ep-srt-status-text").textContent = "✓ Transcrição Premiere · " + SRT_DATA.length + " blocos";
            bar.querySelector(".ep-srt-status-action").textContent = "Editar →";
        }
        $("auto-srt-bulk-bar").classList.add("show");
        var bs = $("btn-srt-smart-dist"); if (bs) bs.disabled = false;
        rebuildGroups();
        hideEditorEmpty();
        toast("✓ " + SRT_DATA.length + " linhas importadas", "ok");
    });
}

// ────────────────────────────────────────────────  AUTO SRT — APLICAR
var APPLY_CANCELED = false;

function applySrtBatch() {
    if (!SRT_GROUPS.length) { toast("Sem grupos pra aplicar", "warn"); return; }
    var groups = SRT_GROUPS.filter(function (g) { return g.tplName && g.text; });
    if (!groups.length) { toast("Nenhum grupo tem template. Use 'Aplicar template...'", "warn"); return; }

    var payload = groups.map(function (g) {
        var tpl = ALL_TEMPLATES.find(function (t) { return t.name === g.tplName; });
        if (!tpl || !tpl.mogrt) return null;
        return {
            mogrtPath: nodePath.join(EXT_PATH, "packs", tpl.mogrt),
            start: g.start, end: g.end, text: g.text
        };
    }).filter(Boolean);

    if (!payload.length) { toast("Templates não encontrados", "err"); return; }

    var trackMode = ($("auto-srt-track") && $("auto-srt-track").value) || "-1";
    var policy = (document.querySelector('input[name="postApplyPolicy"]:checked') || {}).value || "keep";

    APPLY_CANCELED = false;
    openLog();
    log("► Batch APLY: " + payload.length + " grupos · track=" + trackMode);

    var btn = $("btn-auto-srt-apply");
    var orig = btn.textContent;
    btn.disabled = false;
    btn.textContent = "⏸ CANCELAR (0/" + payload.length + ")";
    btn.onclick = function () { APPLY_CANCELED = true; log("Cancelando…", "warn"); };

    var applied = 0, failed = 0, idx = 0;
    var startedAt = Date.now();

    function next() {
        if (APPLY_CANCELED) {
            finish();
            return;
        }
        if (idx >= payload.length) { finish(); return; }
        var g = payload[idx];
        idx++;

        btn.textContent = "⏸ CANCELAR (" + idx + "/" + payload.length + ")";
        var statusEl = $("apply-footer-status");
        if (statusEl) {
            var elapsed = (Date.now() - startedAt) / 1000;
            var rate = idx / elapsed;
            var eta = Math.round((payload.length - idx) / rate);
            statusEl.textContent = idx + "/" + payload.length + " · " + applied + " OK · " + failed + " erros · ETA " + eta + "s";
        }

        var ticks = String(Math.round(g.start * TICKS));
        var durSec = Math.max(0.4, g.end - g.start);
        // 1 chamada atomica: importa + ajusta duração + troca texto usando handle direto
        var script = "$.global.EP_applyOneGroup(" +
            JSON.stringify(g.mogrtPath) + "," +
            JSON.stringify(ticks) + "," +
            JSON.stringify(trackMode) + "," +
            JSON.stringify(g.text) + "," +
            durSec + ");";

        cs.evalScript(script, function (raw) {
            var d; try { d = JSON.parse(raw || "{}"); } catch (e) { d = { error: "parse:" + String(raw||"").slice(0,80) }; }
            if (d.error) {
                failed++;
                if (failed <= 5) log("  ✗ #" + idx + ": " + d.error, "err");
            } else {
                applied++;
                // Loga primeira ocorrência do estado do setText pra diagnosticar
                if (idx === 1) {
                    log("  diag #1 textChanged=" + d.textChanged + " attempts=" + d.textAttempts + (d.textError ? " err=" + d.textError : ""), d.textChanged ? "info" : "warn");
                }
            }
            setTimeout(next, 30);
        });
    }

    function finish() {
        btn.disabled = false;
        btn.textContent = orig;
        btn.onclick = applySrtBatch;
        log("✓ Batch DONE · " + applied + " aplicados · " + failed + " falhas", "info");
        toast("✓ " + applied + " títulos criados" + (failed ? " (" + failed + " falhas)" : ""), failed ? "warn" : "ok", 4000);

        if (!APPLY_CANCELED) {
            // policy: disable originals
            if (policy === "disable") {
                jsx("(function(){try{var s=app.project.activeSequence;var n=s.videoTracks.numTracks;var t=" + (trackMode === "-1" ? "n-1" : trackMode) + ";if(t>0){var b=s.videoTracks[t-1];for(var i=0;i<b.clips.numItems;i++){try{b.clips[i].disabled=true;}catch(e){}}}}catch(e){}return JSON.stringify({ok:true});})();", function () {
                    log("✓ Originais desativados", "info");
                });
            }
            // SFX
            var sfxTrack = $("auto-srt-sfx-track") && $("auto-srt-sfx-track").value;
            if (sfxTrack && SFX_SELECTED) {
                var positions = payload.map(function (g) { return String(Math.round(g.start * TICKS)); });
                placeSfxBatch(positions, sfxTrack);
            }
        }
    }

    next();
}

// ────────────────────────────────────────────────  SFX (synth → WAV → tmp → import)
var SFX_LIBRARY = {
    "click":   { cat: "click", name: "Click",   play: function () { sfxClick(1000, .08); } },
    "pop":     { cat: "click", name: "Pop",     play: function () { sfxPop(.10); } },
    "tick":    { cat: "click", name: "Tick",    play: function () { sfxClick(3000, .03); } },
    "shutter": { cat: "camera", name: "Camera Shutter", play: function () { sfxShutter(.04, .10); } },
    "snap":    { cat: "camera", name: "Camera Snap",    play: function () { sfxClick(3200, .04); } },
    "whoosh-light": { cat: "whoosh", name: "Whoosh Light", play: function () { sfxWhoosh(800, 200, .30); } },
    "whoosh-heavy": { cat: "whoosh", name: "Whoosh Heavy", play: function () { sfxWhoosh(1200, 100, .50); } },
    "impact":  { cat: "impact", name: "Impact",  play: function () { sfxKick(80, .20); } },
    "boom":    { cat: "impact", name: "Boom",    play: function () { sfxKick(45, .40); } },
    "typing":  { cat: "typing", name: "Typing",  play: function () { sfxTypingBurst(); } }
};

var ACtx = window.AudioContext || window.webkitAudioContext;
var audioCtx = null;
function ctx() { if (!audioCtx) audioCtx = new ACtx(); return audioCtx; }

// SFX synths — volumes aumentados 3x pra exportar audível em WAV
function sfxClick(f, d, v) {
    var c = ctx(); var o = c.createOscillator(); var g = c.createGain();
    o.frequency.value = f; o.type = "square";
    g.gain.setValueAtTime(v||.6, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, c.currentTime + d);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + d);
}
function sfxPop(d) {
    var c = ctx(); var o = c.createOscillator(); var g = c.createGain();
    o.frequency.setValueAtTime(180, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(900, c.currentTime + d);
    o.type = "sine";
    g.gain.setValueAtTime(.7, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, c.currentTime + d);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + d);
}
function sfxShutter(d1, d2) {
    var c = ctx();
    var n = c.createBufferSource();
    var buf = c.createBuffer(1, c.sampleRate * (d1 + d2), c.sampleRate);
    var dat = buf.getChannelData(0);
    for (var i = 0; i < dat.length; i++) dat[i] = (Math.random()*2 - 1) * (1 - i/dat.length) * 0.85;
    n.buffer = buf;
    var g = c.createGain(); g.gain.value = .6;
    n.connect(g).connect(c.destination); n.start();
    setTimeout(function(){ sfxClick(900, d2 * .5, .4); }, d1*1000);
}
function sfxKick(f, d) {
    var c = ctx(); var o = c.createOscillator(); var g = c.createGain();
    o.frequency.setValueAtTime(f*2.5, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(f, c.currentTime + d * .5);
    g.gain.setValueAtTime(.9, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, c.currentTime + d);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + d);
}
function sfxWhoosh(fHi, fLo, d) {
    var c = ctx();
    var b = c.createBufferSource();
    var buf = c.createBuffer(1, c.sampleRate * d, c.sampleRate);
    var dat = buf.getChannelData(0);
    for (var i = 0; i < dat.length; i++) {
        var t = i / dat.length;
        dat[i] = (Math.random()*2 - 1) * (1 - Math.abs(t - .5) * 2) * .9;
    }
    b.buffer = buf;
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 6;
    bp.frequency.setValueAtTime(fHi, c.currentTime);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, fLo), c.currentTime + d);
    var amp = c.createGain(); amp.gain.value = 2.2;
    b.connect(bp).connect(amp).connect(c.destination); b.start();
}
function sfxTypingBurst() {
    for (var i = 0; i < 6; i++) setTimeout(function () { sfxClick(2000 + Math.random()*600, .03, .4); }, i * 55);
}

function offlineRenderSfx(key) {
    var def = SFX_LIBRARY[key]; if (!def) return null;
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) return null;
    var sr = 44100, dur = 1.0;
    var off = new OC(1, sr * dur, sr);
    var prev = audioCtx; audioCtx = off;
    try { def.play(); } catch (e) {}
    audioCtx = prev;
    return off.startRendering().then(function (buf) { return bufferToWav(buf); });
}
function bufferToWav(buf) {
    var n = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
    var ab = new ArrayBuffer(44 + len*n*2);
    var v = new DataView(ab);
    function w(o,s){ for(var i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i)); }
    w(0,"RIFF"); v.setUint32(4, 36+len*n*2, true);
    w(8,"WAVE"); w(12,"fmt "); v.setUint32(16,16,true);
    v.setUint16(20,1,true); v.setUint16(22,n,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*n*2,true);
    v.setUint16(32,n*2,true); v.setUint16(34,16,true);
    w(36,"data"); v.setUint32(40,len*n*2,true);
    var ch = buf.getChannelData(0); var off=44;
    for (var i=0;i<len;i++,off+=2) {
        var s = Math.max(-1, Math.min(1, ch[i]));
        v.setInt16(off, s < 0 ? s*0x8000 : s*0x7FFF, true);
    }
    return new Blob([ab], { type: "audio/wav" });
}

function placeSfxAt(ticks, audioTrack) { placeSfxBatch([ticks], audioTrack); }
function placeSfxBatch(positions, audioTrack) {
    if (!SFX_SELECTED) { log("SFX: nenhum SFX selecionado", "warn"); return; }
    if (!nodeFs || !nodeOs) { log("Node FS indisponível pra SFX", "warn"); return; }
    log("SFX: renderizando " + SFX_SELECTED + " offline…");
    var p = offlineRenderSfx(SFX_SELECTED);
    if (!p) { log("OfflineAudioContext indisponível", "warn"); return; }
    p.then(function (blob) {
        log("SFX: WAV blob " + blob.size + " bytes");
        var fr = new FileReader();
        fr.onload = function () {
            var buf = new Uint8Array(fr.result);
            var tmp = nodeOs.tmpdir() + nodePath.sep + "mpl_sfx_" + SFX_SELECTED.replace(/[^a-z0-9]/gi,"_") + ".wav";
            try { nodeFs.writeFileSync(tmp, Buffer.from(buf)); } catch (e) { log("✗ write SFX: " + e.message, "err"); return; }
            try { var st = nodeFs.statSync(tmp); log("SFX: tmp file " + tmp + " · " + st.size + " bytes"); } catch (e) {}
            jsx("$.global.MotionProLegendas.importAudioFile(" +
                JSON.stringify(tmp) + "," +
                JSON.stringify(JSON.stringify(positions)) + "," +
                JSON.stringify(audioTrack) + ");",
            function (d) {
                if (d.error) { log("✗ SFX: " + d.error, "err"); openLog(); }
                else { log("✓ SFX " + SFX_LIBRARY[SFX_SELECTED].name + " em " + d.track + " (" + d.placed + "/" + positions.length + ")", "info"); }
            });
        };
        fr.readAsArrayBuffer(blob);
    }).catch(function (e) { log("✗ SFX render: " + e.message, "err"); });
}

function renderSfxPicker() {
    var list = $("sfx-picker-list"); if (!list) return;
    var search = $("sfx-picker-search");
    var catF = $("sfx-picker-cat-filter");
    var catSel = null;
    var cats = {}; Object.keys(SFX_LIBRARY).forEach(function (k) { cats[SFX_LIBRARY[k].cat] = true; });

    catF.innerHTML = '<button class="wc-pill active" data-cat="">Todas</button>' +
                     Object.keys(cats).map(function (c) { return '<button class="wc-pill" data-cat="'+c+'">'+c+'</button>'; }).join("");
    catF.querySelectorAll(".wc-pill").forEach(function (b) {
        b.onclick = function () {
            catF.querySelectorAll(".wc-pill").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
            catSel = b.getAttribute("data-cat") || null;
            build();
        };
    });

    function build() {
        list.innerHTML = "";
        var q = (search.value || "").toLowerCase();
        Object.keys(SFX_LIBRARY).forEach(function (k) {
            var s = SFX_LIBRARY[k];
            if (catSel && s.cat !== catSel) return;
            if (q && s.name.toLowerCase().indexOf(q) < 0) return;
            var el = document.createElement("div");
            el.className = "sfx-pick" + (SFX_SELECTED === k ? " selected" : "");
            el.innerHTML = '<div class="tpl-pick__thumb" style="display:flex;align-items:center;justify-content:center;font-size:18px">🔊</div>' +
                           '<div class="sfx-pick__name">' + esc(s.name) + '<div class="sfx-pick__cat">' + s.cat + '</div></div>' +
                           '<button class="sfx-pick__play">▶</button>';
            el.querySelector(".sfx-pick__play").onclick = function (ev) { ev.stopPropagation(); s.play(); };
            el.onclick = function () {
                SFX_SELECTED = k; localStorage.setItem("mpl_sfx", k);
                updateSfxButton();
                build();
            };
            list.appendChild(el);
        });
    }

    if (search) search.oninput = build;
    build();
}

function updateSfxButton() {
    var btn = $("tpl-sfx-pick-name");
    if (btn) btn.textContent = SFX_SELECTED && SFX_LIBRARY[SFX_SELECTED] ? SFX_LIBRARY[SFX_SELECTED].name : "Selecionar SFX";
}

function populateSfxTracks() {
    jsx("$.global.EP_getAudioTracksInfo();", function (d) {
        var sels = [$("tpl-sfx-track-select"), $("auto-srt-sfx-track")];
        sels.forEach(function (sel) {
            if (!sel) return;
            sel.innerHTML = '<option value="">Sem SFX</option>';
            if (d.tracks && d.tracks.length) {
                d.tracks.forEach(function (t) {
                    var opt = document.createElement("option");
                    opt.value = t.name; opt.textContent = t.name;
                    sel.appendChild(opt);
                });
            } else {
                ["A2","A3","A4"].forEach(function (n) {
                    var opt = document.createElement("option");
                    opt.value = n; opt.textContent = n;
                    sel.appendChild(opt);
                });
            }
        });
    });
}

// ────────────────────────────────────────────────  AUTO SRT default template select
function renderAutoSrtTemplateOptions() {
    var sel = $("auto-srt-default-tpl"); if (!sel) return;
    sel.innerHTML = '<option value="">Auto por palavras</option>';
    ALL_TEMPLATES.slice(0, 100).forEach(function (t) {
        var opt = document.createElement("option");
        opt.value = t.name; opt.textContent = t.name + " (" + (t.wc||"?") + "p)";
        sel.appendChild(opt);
    });
}

// ────────────────────────────────────────────────  TABS
function switchTab(id) {
    document.querySelectorAll(".tab-btn").forEach(function (b) {
        b.classList.toggle("active", b.getAttribute("data-tab") === id);
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) {
        p.classList.toggle("active", p.id === id);
    });
    updateWizardAndFooter(id);
}

function updateWizardAndFooter(tabId) {
    var isLegenda = tabId === "tab-create" || tabId === "tab-auto-srt" || tabId === "tab-srt-editor";
    var wiz = document.getElementById("wizard-bar");
    var footer = document.getElementById("apply-footer");

    if (wiz) {
        if (isLegenda) {
            wiz.classList.remove("hidden");
            // Marca etapas: 1=create/importar / 2=editor / 3=apply
            var has = SRT_GROUPS && SRT_GROUPS.length > 0;
            var withTpl = has ? SRT_GROUPS.filter(function (g) { return g.tplName; }).length : 0;
            wiz.querySelectorAll(".wiz-step").forEach(function (s) { s.classList.remove("active","done"); });
            var s1 = wiz.querySelector('[data-step="create"]');
            var s2 = wiz.querySelector('[data-step="editor"]');
            var s3 = wiz.querySelector('[data-step="apply"]');
            if (s1) s1.classList.add(has ? "done" : "active");
            if (s2) s2.classList.add(has ? (tabId === "tab-srt-editor" ? "active" : "done") : "");
            if (s3) s3.classList.add((withTpl > 0 && has) ? "active" : "");
        } else { wiz.classList.add("hidden"); }
    }

    if (footer) {
        if (isLegenda) {
            footer.classList.remove("hidden");
            updateApplyFooter();
        } else { footer.classList.add("hidden"); }
    }

    // Badge na aba Editar com count de grupos
    var badge = document.getElementById("tab-editor-badge");
    if (badge) {
        if (SRT_GROUPS && SRT_GROUPS.length) {
            badge.classList.remove("hidden");
            badge.textContent = SRT_GROUPS.length;
        } else { badge.classList.add("hidden"); }
    }
}

function updateApplyFooter() {
    var summary = document.getElementById("apply-footer-summary");
    var status = document.getElementById("apply-footer-status");
    var btn = document.getElementById("btn-auto-srt-apply");
    if (!summary) return;
    if (!SRT_GROUPS || !SRT_GROUPS.length) {
        summary.innerHTML = "<span style='color:var(--text-3)'>Carregue ou crie legendas pra aplicar</span>";
        if (status) status.textContent = "";
        if (btn) btn.disabled = true;
        return;
    }
    var withTpl = SRT_GROUPS.filter(function (g) { return g.tplName; }).length;
    summary.innerHTML = "<b>" + SRT_GROUPS.length + "</b> grupos · <b>" + withTpl + "</b> com template";
    if (status) status.textContent = withTpl < SRT_GROUPS.length ? "(" + (SRT_GROUPS.length - withTpl) + " sem template — vai pular)" : "✓ pronto";
    if (btn) btn.disabled = withTpl === 0;
}

// ────────────────────────────────────────────────  DIAG
function runDiag() {
    openLog();
    var btn = $("btn-diag");
    if (btn) { btn.className = "btn-diag"; btn.textContent = "🩺 …"; }
    log("════════ DIAGNÓSTICO LIVE ════════");
    if (!cs) { log("CSInterface ausente", "err"); if (btn) { btn.className = "btn-diag err"; btn.textContent = "✗"; } return; }
    var hostEnv = cs.getHostEnvironment();
    log("[1] Host: " + hostEnv.appName + " v" + hostEnv.appVersion + " (" + hostEnv.appId + ")");
    log("[2] Catálogo: " + ALL_TEMPLATES.length + " templates");
    cs.evalScript("typeof $.global.EP_ping", function (r) {
        log("[3] EP_ping disponível: " + r);
        if (String(r).indexOf("function") < 0) {
            log("✗ host.jsx NÃO foi carregado. Click no botão recarregar host.jsx no boot — recarregue o painel.", "err");
            if (btn) { btn.className = "btn-diag err"; btn.textContent = "✗ host OFF"; }
            return;
        }
        jsx("$.global.EP_ping();", function (d) {
            log("[4] ping: " + JSON.stringify(d));
            jsx("$.global.EP_getActiveSequenceInfo();", function (info) {
                log("[5] sequence: " + JSON.stringify(info));
                if (!info.hasSequence) {
                    log("⚠ Abra uma sequência no Premiere", "warn");
                    if (btn) { btn.className = "btn-diag err"; btn.textContent = "⚠ Sem seq"; }
                    return;
                }

                // [6] Se um template está selecionado, INSPECIONA pra ver props
                if (SELECTED && SELECTED.mogrt) {
                    var abs = nodePath.join(EXT_PATH, "packs", SELECTED.mogrt);
                    log("[6] Inspecionando MOGRT: " + SELECTED.name);
                    jsx("$.global.EP_inspectMogrt(" + JSON.stringify(abs) + ");", function (r2) {
                        if (r2.error) { log("✗ inspect: " + r2.error, "err"); }
                        else {
                            log("  clip: " + r2.clipName);
                            (r2.components || []).forEach(function (c) {
                                log("  ▸ " + c.name + " (" + c.count + " props)");
                                (c.props || []).slice(0, 10).forEach(function (p) {
                                    log("      [" + p.idx + "] " + p.displayName + " = " + p.value);
                                });
                            });
                        }
                        if (btn) { btn.className = "btn-diag ok"; btn.textContent = "✓"; }
                        log("════════ DIAG DONE ════════", "info");
                    });
                } else {
                    log("[6] Pra inspecionar MOGRT, selecione um template e clique 🩺 de novo");
                    if (btn) { btn.className = "btn-diag ok"; btn.textContent = "✓"; }
                    log("════════ DIAG OK ════════", "info");
                }
            });
        });
    });
}

// ────────────────────────────────────────────────  BINDS
function bind() {
    // diag
    var bd = $("btn-diag"); if (bd) bd.onclick = runDiag;

    // tabs
    document.querySelectorAll(".tab-btn").forEach(function (b) {
        b.onclick = function () { switchTab(b.getAttribute("data-tab")); };
    });
    var srtBanner = $("ep-srt-status-banner"); if (srtBanner) srtBanner.onclick = function () {
        // se tem SRT carregado vai pro editor; senão pro config
        if (SRT_DATA && SRT_DATA.length) switchTab("tab-srt-editor");
        else switchTab("tab-auto-srt");
    };

    // search
    var q = $("search-input");
    if (q) q.oninput = function () { FILTER.q = q.value; renderGrid(); };

    // APLICAR template selecionado
    var apl = $("btn-hybrid-apply-all"); if (apl) apl.onclick = applySingle;

    // SFX picker
    var pick = $("tpl-sfx-pick-btn"); if (pick) pick.onclick = function () {
        $("sfx-picker-overlay").classList.remove("hidden"); renderSfxPicker();
    };
    var pickClose = $("sfx-picker-close"); if (pickClose) pickClose.onclick = function () { $("sfx-picker-overlay").classList.add("hidden"); };
    var pickConfirm = $("sfx-picker-confirm"); if (pickConfirm) pickConfirm.onclick = function () { $("sfx-picker-overlay").classList.add("hidden"); };
    var pickRm = $("sfx-picker-remove"); if (pickRm) pickRm.onclick = function () {
        SFX_SELECTED = null; localStorage.removeItem("mpl_sfx"); updateSfxButton(); renderSfxPicker();
    };
    updateSfxButton();

    // tpl picker
    var tpc = $("tpl-picker-close"); if (tpc) tpc.onclick = closeTplPicker;

    // SRT swap (carregar arquivo)
    var btnSwap = $("btn-auto-srt-swap"); if (btnSwap) btnSwap.onclick = function () {
        var inp = document.createElement("input");
        inp.type = "file"; inp.accept = ".srt,.vtt"; inp.style.display = "none";
        document.body.appendChild(inp);
        inp.onchange = function (e) {
            var f = e.target.files && e.target.files[0];
            if (f) loadSRT(f);
            inp.remove();
        };
        inp.click();
    };

    // captions Premiere
    var btnCap = $("btn-auto-srt-captions"); if (btnCap) btnCap.onclick = loadCaptions;
    var capClose = $("captions-help-close"); if (capClose) capClose.onclick = hideCaptionsHelpModal;
    var capOk = $("captions-help-ok"); if (capOk) capOk.onclick = hideCaptionsHelpModal;
    var capRetry = $("captions-help-retry"); if (capRetry) capRetry.onclick = function () { hideCaptionsHelpModal(); loadCaptions(); };

    // ⚡ Distribuição Inteligente
    var btnSmart = $("btn-srt-smart-dist"); if (btnSmart) btnSmart.onclick = applySmartDistribution;

    // ✍️ CRIAR LEGENDAS DO ZERO
    var btnCreateGen = $("btn-create-srt"); if (btnCreateGen) btnCreateGen.onclick = generateLegendasFromScript;
    var btnCreateApply = $("btn-create-apply"); if (btnCreateApply) btnCreateApply.onclick = applyCreatedLegendas;
    var btnCreateCti = $("btn-create-from-cti"); if (btnCreateCti) btnCreateCti.onclick = function () {
        jsx("$.global.EP_getCTI();", function (d) {
            if (d.error || !d.seconds) { toast("Sem CTI", "warn"); return; }
            $("create-start").value = secsToTimecode(d.seconds);
        });
    };

    // 🔤 INSTALAR FONTES
    checkFontsBanner();
    var btnInstFont = $("btn-install-fonts"); if (btnInstFont) btnInstFont.onclick = installFonts;
    var btnDismiss = $("btn-dismiss-fonts"); if (btnDismiss) btnDismiss.onclick = function () { $("font-banner").classList.add("hidden"); localStorage.setItem("mpl_fonts_dismiss", "1"); };

    // re-chunk on words change
    var ws = $("auto-srt-groupsize"); if (ws) ws.onchange = function () { if (SRT_DATA.length) rebuildGroups(); };

    // bulk
    var selAll = $("btn-srt-select-all"); if (selAll) selAll.onclick = function () {
        SRT_GROUPS.forEach(function (g) { g.selected = true; }); renderSrtEditor(); updateBulkActions();
    };
    var selNone = $("btn-srt-select-none"); if (selNone) selNone.onclick = function () {
        SRT_GROUPS.forEach(function (g) { g.selected = false; }); renderSrtEditor(); updateBulkActions();
    };
    var setTpl = $("btn-srt-bulk-set-tpl"); if (setTpl) setTpl.onclick = function () {
        openTplPicker(function (t) {
            SRT_GROUPS.forEach(function (g) { if (g.selected) g.tplName = t.name; });
            renderSrtEditor(); updateSrtSummary();
        });
    };

    // APLICAR NA TIMELINE
    var btnApply = $("btn-auto-srt-apply"); if (btnApply) btnApply.onclick = applySrtBatch;

    // LOG toggle
    var togLog = $("toggle-log"); if (togLog) togLog.onclick = function () {
        var b = $("log-body"); if (!b) return;
        b.classList.toggle("hidden");
        togLog.classList.toggle("open", !b.classList.contains("hidden"));
    };
}

// ────────────────────────────────────────────────  BOOT
window.MPL_onAuthReady = function () {
    log("BUILD " + BUILD, "info");
    setStatus("Carregando catálogo…");
    loadCatalog();
    reloadHostJsx(function () {
        setStatus("Pronto.");
    });
    updateApplyFooter();   // estado inicial
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
} else { bind(); }

})();
