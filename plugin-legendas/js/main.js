/* ════════════════════════════════════════════════════════════════
   Motion Legendas v4.0 — main.js
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

var BUILD = "4.25.1-global-style-no-color";

// ────────────────────────────────────────────────  ESTILO GLOBAL
// { enabled, tplName, font, fontCustom }
// Persistido em localStorage("mpl_global_style").
// Quando enabled=true:
//   - tplName não-vazio → força esse template em TODAS legendas (override determinístico)
//   - font não-vazio    → injeta no fontEditValue do definition.json (PowerShell)
// Cor não é exposta no .mogrt (vive hardcoded no .aep binário) — feature removida na 4.25.1
var GLOBAL_STYLE = { enabled: false, tplName: "", font: "", fontCustom: "" };
function loadGlobalStyle() {
    try {
        var raw = localStorage.getItem("mpl_global_style");
        if (!raw) return;
        var d = JSON.parse(raw);
        if (d && typeof d === "object") {
            for (var k in d) if (d.hasOwnProperty(k) && GLOBAL_STYLE.hasOwnProperty(k)) GLOBAL_STYLE[k] = d[k];
        }
    } catch (e) {}
}
function saveGlobalStyle() {
    try { localStorage.setItem("mpl_global_style", JSON.stringify(GLOBAL_STYLE)); } catch (e) {}
}
function getActiveGlobalStyle() {
    if (!GLOBAL_STYLE.enabled) return null;
    var hasAnything = GLOBAL_STYLE.tplName || GLOBAL_STYLE.font || GLOBAL_STYLE.fontCustom;
    if (!hasAnything) return null;
    return {
        tplName: GLOBAL_STYLE.tplName || "",
        font: (GLOBAL_STYLE.font === "__custom__" ? (GLOBAL_STYLE.fontCustom || "") : (GLOBAL_STYLE.font || ""))
    };
}
function updateGlobalStyleSummary() {
    var chip = $("gs-summary-chip");
    var panel = $("global-style-panel");
    if (!chip || !panel) return;
    var active = getActiveGlobalStyle();
    if (!GLOBAL_STYLE.enabled) {
        chip.textContent = "desligado";
        panel.classList.remove("active");
        return;
    }
    panel.classList.add("active");
    if (!active) { chip.textContent = "ligado · sem overrides"; return; }
    var parts = [];
    if (active.tplName) parts.push(active.tplName);
    if (active.font)    parts.push(active.font);
    chip.textContent = parts.join(" · ") || "ligado";
}
function populateGlobalStyleTemplates() {
    var sel = $("gs-template");
    if (!sel || !ALL_TEMPLATES.length) return;
    var current = GLOBAL_STYLE.tplName || "";
    // Preserva primeiro option (auto), limpa resto
    while (sel.options.length > 1) sel.remove(1);
    // Agrupa por wc
    var byWc = {};
    ALL_TEMPLATES.forEach(function (t) {
        var wc = t.wc || 0;
        (byWc[wc] = byWc[wc] || []).push(t);
    });
    Object.keys(byWc).sort(function (a,b) { return Number(a)-Number(b); }).forEach(function (wc) {
        var grp = document.createElement("optgroup");
        grp.label = wc + " palavra" + (wc == "1" ? "" : "s");
        byWc[wc].forEach(function (t) {
            var opt = document.createElement("option");
            opt.value = t.name; opt.textContent = t.name;
            grp.appendChild(opt);
        });
        sel.appendChild(grp);
    });
    sel.value = current;
}
function bindGlobalStyleUI() {
    var cb     = $("gs-enabled");
    var tplSel = $("gs-template");
    var fontSel = $("gs-font");
    var fontCustom = $("gs-font-custom");
    var resetBtn = $("gs-reset");
    var panel = $("global-style-panel");
    if (!cb) return;

    // Hidrata UI com state salvo
    cb.checked = !!GLOBAL_STYLE.enabled;
    if (panel) {
        if (GLOBAL_STYLE.enabled) panel.setAttribute("open", "");
    }
    if (tplSel) tplSel.value = GLOBAL_STYLE.tplName || "";
    if (fontSel) {
        // Se font não bate com nenhuma option, marca custom
        var opts = Array.prototype.slice.call(fontSel.options).map(function (o) { return o.value; });
        if (GLOBAL_STYLE.font && opts.indexOf(GLOBAL_STYLE.font) === -1 && GLOBAL_STYLE.font !== "__custom__") {
            GLOBAL_STYLE.fontCustom = GLOBAL_STYLE.font;
            GLOBAL_STYLE.font = "__custom__";
        }
        fontSel.value = GLOBAL_STYLE.font || "";
    }
    if (fontCustom) {
        fontCustom.value = GLOBAL_STYLE.fontCustom || "";
        fontCustom.classList.toggle("hidden", GLOBAL_STYLE.font !== "__custom__");
    }

    cb.onchange = function () {
        GLOBAL_STYLE.enabled = cb.checked;
        saveGlobalStyle(); updateGlobalStyleSummary();
        // Abre painel automaticamente se ligando
        if (panel && cb.checked) panel.setAttribute("open", "");
    };
    if (tplSel) tplSel.onchange = function () {
        GLOBAL_STYLE.tplName = tplSel.value || "";
        saveGlobalStyle(); updateGlobalStyleSummary();
    };
    if (fontSel) fontSel.onchange = function () {
        GLOBAL_STYLE.font = fontSel.value || "";
        if (fontCustom) fontCustom.classList.toggle("hidden", GLOBAL_STYLE.font !== "__custom__");
        saveGlobalStyle(); updateGlobalStyleSummary();
    };
    if (fontCustom) fontCustom.oninput = function () {
        GLOBAL_STYLE.fontCustom = fontCustom.value.trim();
        saveGlobalStyle(); updateGlobalStyleSummary();
    };
    if (resetBtn) resetBtn.onclick = function () {
        GLOBAL_STYLE = { enabled: false, tplName: "", font: "", fontCustom: "" };
        saveGlobalStyle();
        cb.checked = false;
        if (tplSel) tplSel.value = "";
        if (fontSel) fontSel.value = "";
        if (fontCustom) { fontCustom.value = ""; fontCustom.classList.add("hidden"); }
        updateGlobalStyleSummary();
        toast("Estilo Global resetado", "info");
    };

    updateGlobalStyleSummary();
}

var nodePath = typeof require === "function" ? require("path") : null;
var nodeFs   = typeof require === "function" ? require("fs") : null;
var nodeOs   = typeof require === "function" ? require("os") : null;
var nodeCp   = typeof require === "function" ? require("child_process") : null;
var TICKS = 254016000000;

// FPS detectado da sequência ativa (cacheado, default 30)
var SEQ_FPS = 30;

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
// Mapa { "Texto 47": { slotCount: 3, slotIndices: [8,15,24], slotNames: [...] } }
// Pré-computado em build-time a partir do clientControls type=6 (TEXT_FONT) dos definition.json
var SLOT_INFO = {};

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
function loadSlotInfo() {
    if (!nodeFs || !nodePath) return;
    var p = nodePath.join(EXT_PATH, "packs", "slot-info.json");
    try {
        if (!nodeFs.existsSync(p)) { log("⚠️ slot-info.json não encontrado em " + p, "warn"); return; }
        var raw = nodeFs.readFileSync(p, "utf8");
        var d = JSON.parse(raw);
        SLOT_INFO = d.templates || {};
        log("📐 Slot-info: " + Object.keys(SLOT_INFO).length + " templates indexados", "info");
    } catch (e) {
        log("⚠️ slot-info.json: " + e.message, "warn");
    }
}

function getSlotIndicesFor(tplName) {
    var info = SLOT_INFO[tplName];
    if (!info) return null;
    return info.slotIndices || null;
}

// ─────────────────────────────────────────────────────────────────
// MOGRT path resolver — CDN-first (v1.2+) com fallback pra local (legacy)
// Retorna Promise<string> com path absoluto no disco pronto pra usar.
// ─────────────────────────────────────────────────────────────────
function resolveMogrtPath(item) {
    if (!item) return Promise.reject(new Error("no_item"));
    // Modo CDN: tem cdn_key → usa AssetLoader (baixa/cacheia)
    if (item.cdn_key && window.MPL_AssetLoader) {
        return window.MPL_AssetLoader.get(item);
    }
    // Modo legacy: usa path local relativo ao EXT_PATH/packs
    if (item.mogrt) {
        var abs = nodePath.join(EXT_PATH, "packs", item.mogrt);
        if (nodeFs && nodeFs.existsSync(abs)) return Promise.resolve(abs);
    }
    return Promise.reject(new Error("mogrt_unavailable"));
}

function loadCatalog() {
    if (!nodeFs || !nodePath) { log("Node FS indisponível", "err"); openLog(); return; }
    log("EXT_PATH = " + EXT_PATH, "info");
    // Expõe pro asset-loader.js usar como fallback de path
    window.MPL_EXT_PATH = EXT_PATH;
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
        populateGlobalStyleTemplates();
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
                    // CDN fields (v1.2+: populados pelo upload-legendas-r2.js)
                    id: it.id || null,
                    cdn_key: it.cdn_key || null,
                    sha256: it.sha256 || null,
                    size_bytes: it.size_bytes || null,
                    preview: it.preview || null,
                    wc: (it.wc != null) ? it.wc : deriveWordCount(it.name, c.name),
                    cat: c.name || p.name || "Geral",
                    pack: p.id || p.name,
                    ep: !!it.ep_id   // marcador "template estilo EP"
                });
            });
        });
    });

    // Renumera displayName sequencialmente DENTRO de cada categoria/wc
    // Ex: 2 Palavras → Estilo 01, Estilo 02, ... (mantém .name como id interno)
    var byCat = {};
    out.forEach(function (t) {
        var key = t.cat + "|" + t.wc;
        byCat[key] = byCat[key] || [];
        byCat[key].push(t);
    });
    Object.keys(byCat).forEach(function (key) {
        var list = byCat[key];
        // Ordena natural por nome original (Texto 03, Texto 10, Texto 29...)
        list.sort(function (a, b) {
            var nA = parseInt((a.name.match(/\d+/) || ["0"])[0], 10);
            var nB = parseInt((b.name.match(/\d+/) || ["0"])[0], 10);
            return nA - nB;
        });
        list.forEach(function (t, idx) {
            var n = (idx + 1).toString().padStart(2, "0");
            t.displayName = "Estilo " + n;
            t.idxInCat = idx + 1;
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
    var el = $("cat-pills"); if (!el) return;
    var cats = {};
    ALL_TEMPLATES.forEach(function (t) { cats[t.cat] = (cats[t.cat] || 0) + 1; });
    el.innerHTML = '<button class="cat-pill active" data-cat="all">Todos (' + ALL_TEMPLATES.length + ')</button>';
    Object.keys(cats).sort().forEach(function (c) {
        var b = document.createElement("button");
        b.className = "cat-pill"; b.setAttribute("data-cat", c);
        b.textContent = c + " (" + cats[c] + ")";
        el.appendChild(b);
    });
    el.querySelectorAll(".cat-pill").forEach(function (b) {
        b.onclick = function () {
            el.querySelectorAll(".cat-pill").forEach(function (x) { x.classList.remove("active"); });
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
    card.setAttribute("data-tpl", t.name);
    if (SELECTED && SELECTED.name === t.name) card.classList.add("selected");

    // Verifica fontes faltantes
    var missingFonts = getMissingFontsForTemplate(t.name);
    var fontBadge = "";
    if (missingFonts.length) {
        card.classList.add("tpl-card--missing-font");
        card.title = "⚠️ Precisa de " + missingFonts.join(", ") + " (fonte não instalada)";
        fontBadge = '<span class="tpl-card__font-warn" title="Fonte faltando">⚠</span>';
    }

    var dispName = t.displayName || t.name;
    var thumbHtml = '<div class="tpl-card__thumb">' + thumbFor(t) +
                    (t.wc ? '<span class="tpl-card__wc">' + t.wc + 'p</span>' : '') +
                    fontBadge +
                    '</div>' +
                    '<div class="tpl-card__name" title="' + esc(dispName) + ' · id: ' + esc(t.name) + '">' + esc(dispName) + '</div>';
    card.innerHTML = thumbHtml;

    card.onclick = function () {
        SELECTED = t;
        document.querySelectorAll(".tpl-card.selected").forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        showPreview(t);
        var btn = $("btn-hybrid-apply-all"); if (btn) { btn.disabled = false; btn.textContent = "⚡ APLICAR · " + t.name; }
        var dg = $("btn-tpl-diagnose"); if (dg) dg.disabled = false;
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
    return { bg: "#15151c", fg: "#2563eb", font: "Inter", weight: 800, size: 11, tracking: 1 };
}

function showPreview(t) {
    var box = $("preview-inline"); if (box) box.classList.remove("hidden");
    var img = $("preview-img");
    if (t.preview && nodeFs && nodePath) {
        var p = nodePath.join(EXT_PATH, "packs", t.preview);
        if (nodeFs.existsSync(p)) {
            img.src = "file:///" + p.replace(/\\/g, "/");
            img.style.display = "";
        } else {
            img.style.display = "none";
        }
    } else {
        img.style.display = "none";
    }
    var dispName = t.displayName || t.name;
    var nm = $("preview-name");
    if (nm) nm.innerHTML = esc(dispName) + ' <span style="color:var(--text-3);font-weight:500;font-size:10px">(id: ' + esc(t.name) + ')</span>';
    var mt = $("preview-meta");
    if (mt) mt.textContent = t.cat + (t.wc ? " · " + t.wc + " palavra" + (t.wc === 1 ? "" : "s") : "");
}

function hidePreview() {
    var box = $("preview-inline"); if (box) box.classList.add("hidden");
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
    if (!SELECTED.mogrt && !SELECTED.cdn_key) { toast("Template sem .mogrt", "err"); return; }
    log("Aplicando: " + SELECTED.name);
    if (SELECTED.cdn_key) toast("⬇ Baixando do CDN…", "info", 1500);
    resolveMogrtPath(SELECTED).then(function (abs) { _applySingleWithPath(abs); })
        .catch(function (e) {
            log("✗ resolveMogrt: " + e.message, "err");
            // Mensagens user-friendly mapeadas pra erros conhecidos do asset-loader.
            var msg = e.message;
            var friendly = {
                "not_logged_in":            "Sessao expirada. Clique em Sair e faca login novamente.",
                "auth_expired":             "Sessao expirada. Faca login novamente.",
                "subscription_inactive":    "Plano expirou. Renove em Config > Licenca.",
                "device_not_authorized":    "Dispositivo nao autorizado. Reative em Config > Licenca.",
                "asset_not_found":          "Template removido do catalogo. Atualize o catalog.",
                "no_cdn_key_and_no_local":  "Template sem arquivo local nem CDN. Reinstale o plugin.",
                "sign_parse_failed":        "Backend respondeu invalido. Tente novamente em 1min."
            };
            var pretty = friendly[msg] || ("Falha ao obter template: " + msg);
            toast(pretty, "err", 6000);
            // Auto-acao: se sessao caiu, mostra banner reconectar
            if (msg === "not_logged_in" || msg === "auth_expired") {
                if (window.Auth && typeof window.Auth.showReconnectBanner === "function") {
                    window.Auth.showReconnectBanner();
                }
            }
        });
}
function _applySingleWithPath(abs) {
    if (!SELECTED) return;
    var withSfx = $("tpl-with-sfx") && $("tpl-with-sfx").checked && SFX_SELECTED;
    var audioTrack = withSfx ? ($("tpl-sfx-track-select") && $("tpl-sfx-track-select").value) : null;

    var gs = getActiveGlobalStyle();

    // Caminho A: Estilo Global com fonte → usa inject mode mesmo pra single,
    //   pra que fontEditValue seja aplicado igual ao batch SRT.
    if (gs && gs.font) {
        _applySingleViaInject(abs, gs, withSfx, audioTrack);
        return;
    }

    // Caminho B: clássico (setValue API) — sem GS, sem font, sem cor
    // Pega slot indices pré-computados (override determinístico)
    var slotIndices = getSlotIndicesFor(SELECTED.name);
    var slotIdxJson = slotIndices ? JSON.stringify(slotIndices) : "null";

    // Pega CTI primeiro pra mandar ticks certos
    jsx("$.global.EP_getCTI();", function (cti) {
        var ticks = (cti && cti.ticks) ? cti.ticks : "0";
        var call = "$.global.EP_applyOneGroup(" +
            JSON.stringify(abs) + "," +
            JSON.stringify(ticks) + ",\"last\"," +
            JSON.stringify(SELECTED.name) + ",2.0," +
            JSON.stringify(slotIdxJson) + ");";
        cs.evalScript(call, function (raw) {
            var d; try { d = JSON.parse(raw || "{}"); } catch (e) { d = { error: "parse: " + String(raw||"").slice(0,120) }; }
            if (d.error) {
                log("✗ " + d.error, "err"); openLog();
                toast("Erro: " + d.error, "err", 4500);
                return;
            }
            log("✓ V" + (d.track + 1) + " · slots=" + d.textSlots + " mode=" + d.textMode + " changed=" + d.textChanged + "/" + d.textAttempts, d.textChanged ? "info" : "warn");
            if (d.textAssignment && d.textAssignment.length) {
                log("  " + d.textAssignment.join("  ·  "), "info");
            }
            toast("✓ " + SELECTED.name + " · V" + (d.track + 1), "ok");
            if (withSfx && audioTrack) placeSfxAt(ticks, audioTrack);
        });
    });
}

// Aplica single template via inject mode (mogrt customizado com fonte global injetada)
function _applySingleViaInject(abs, gs, withSfx, audioTrack) {
    if (!nodeOs || !nodeFs || !nodePath) {
        log("Inject mode indisponível (Node.js)", "warn");
        toast("Node.js indisponível pra inject mode", "err"); return;
    }
    log("Aplicando com Estilo Global (inject mode) · font=" + (gs.font || "—"), "info");
    var tmpDir = nodeOs.tmpdir().replace(/\\/g, "/") + "/_mpl_inject";
    try { if (!nodeFs.existsSync(tmpDir)) nodeFs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
    var job = {
        id: "single",
        srcMogrt: abs,
        dstMogrt: tmpDir + "/inject_single_" + Date.now() + ".mogrt",
        words: []   // sem substituir texto — mantém placeholders do template
    };
    if (gs.font) job.font = gs.font;

    prepareInjectMogrtsNode([job], function (err, res) {
        if (err) { log("✗ Prepare single: " + err, "err"); toast("Falha ao preparar template", "err"); return; }
        var pj = (res && res.jobs && res.jobs[0]) || null;
        if (!pj || !pj.success) {
            log("✗ Prepare single failed: " + (pj && pj.error || "?"), "err");
            toast("Falha ao preparar template", "err"); return;
        }
        jsx("$.global.EP_getCTI();", function (cti) {
            var ticks = (cti && cti.ticks) ? cti.ticks : "0";
            var call = "$.global.EP_importPreparedMogrt(" +
                JSON.stringify(pj.outPath) + "," +
                JSON.stringify(ticks) + ",\"last\",2.0);";
            cs.evalScript(call, function (raw) {
                var d; try { d = JSON.parse(raw || "{}"); } catch (e) { d = { error: "parse:" + String(raw||"").slice(0,120) }; }
                if (d.error) {
                    log("✗ Import: " + d.error, "err"); openLog();
                    toast("Erro: " + d.error, "err", 4500); return;
                }
                log("✓ V" + (d.track + 1) + " · " + SELECTED.name + " (Estilo Global · fonte=" + gs.font + ")", "info");
                toast("✓ " + SELECTED.name + " · V" + (d.track + 1), "ok");
                if (withSfx && audioTrack) placeSfxAt(ticks, audioTrack);
            });
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

// ──────────────────────────────────────────────── CUT CONFIG (estilo "Criar legendas")
// Limites de corte aplicados na distribuição (smart + create). Persistido em localStorage.
var CUT_OPTS_KEY = "mpl_cut_opts_v1";
var CUT_DEFAULTS = { oneWord: true, layout: "double", maxChars: 19, minDur: 0.4, gapFrames: 0 };

function isOneWordMode() {
    var el = $("cut-oneword");
    return el ? !!el.checked : CUT_DEFAULTS.oneWord;
}

function getCutOpts() {
    var oneWord = isOneWordMode();
    var layout   = ($("cut-layout")     && $("cut-layout").value)     || CUT_DEFAULTS.layout;
    var maxChars = parseInt($("cut-max-chars")  && $("cut-max-chars").value,  10);
    var minDur   = parseFloat($("cut-min-dur")    && $("cut-min-dur").value);
    var gapFrm   = parseInt($("cut-gap-frames") && $("cut-gap-frames").value, 10);
    if (!isFinite(maxChars) || maxChars < 6)  maxChars = CUT_DEFAULTS.maxChars;
    if (!isFinite(minDur)   || minDur   < 0)  minDur   = CUT_DEFAULTS.minDur;
    if (!isFinite(gapFrm)   || gapFrm   < 0)  gapFrm   = CUT_DEFAULTS.gapFrames;
    // Linha dupla = 2× caracteres por legenda (cabe em 2 linhas)
    var maxCharsTotal = layout === "double" ? maxChars * 2 : maxChars;
    // No modo 1-palavra, max chars = comprimento da maior palavra (não limita)
    if (oneWord) maxCharsTotal = 999;
    return {
        oneWord: oneWord,
        layout: layout,
        maxCharsLine: maxChars,
        maxCharsTotal: maxCharsTotal,
        minDur: minDur,
        gapFrames: gapFrm,
        gapSec: gapFrm / (SEQ_FPS || 30)
    };
}

function saveCutOpts() {
    try {
        var c = {
            oneWord: $("cut-oneword") && $("cut-oneword").checked,
            layout: $("cut-layout") && $("cut-layout").value,
            maxChars: $("cut-max-chars") && $("cut-max-chars").value,
            minDur: $("cut-min-dur") && $("cut-min-dur").value,
            gapFrames: $("cut-gap-frames") && $("cut-gap-frames").value
        };
        localStorage.setItem(CUT_OPTS_KEY, JSON.stringify(c));
    } catch (e) {}
}

function loadCutOpts() {
    try {
        var raw = localStorage.getItem(CUT_OPTS_KEY);
        if (raw) {
            var c = JSON.parse(raw);
            if (c.oneWord   != null && $("cut-oneword"))    $("cut-oneword").checked = !!c.oneWord;
            if (c.layout    != null && $("cut-layout"))     $("cut-layout").value = c.layout;
            if (c.maxChars  != null && $("cut-max-chars"))  $("cut-max-chars").value = c.maxChars;
            if (c.minDur    != null && $("cut-min-dur"))    $("cut-min-dur").value = c.minDur;
            if (c.gapFrames != null && $("cut-gap-frames")) $("cut-gap-frames").value = c.gapFrames;
        }
    } catch (e) {}
    applyModeUI();   // sincroniza visibilidade dos controles
}

// Aplica/remove class no body conforme modo, escondendo controles irrelevantes
function applyModeUI() {
    if (isOneWordMode()) {
        document.body.classList.add("mode-oneword");
        // expande o details "Configuração de corte" só se houver mudança útil
    } else {
        document.body.classList.remove("mode-oneword");
        // abre o details automaticamente pra usuário ver os controles
        var d = $("cut-config"); if (d) d.open = true;
    }
}

function bindCutOpts() {
    ["cut-oneword","cut-layout","cut-max-chars","cut-min-dur","cut-gap-frames"].forEach(function (id) {
        var el = $(id); if (!el) return;
        el.addEventListener("change", saveCutOpts);
        el.addEventListener("input", saveCutOpts);
    });
    var sw = $("cut-oneword");
    if (sw) sw.addEventListener("change", applyModeUI);
}

// ──────────────────────────────────────────────── MODO 1 PALAVRA POR LEGENDA
// Para cada bloco SRT, cria 1 grupo POR PALAVRA com timing proporcional.
// Sempre usa template de 1p — evita 100% do problema de slot múltiplo.
function oneWordPerCaption(blocks) {
    var groups = [];
    if (!blocks || !blocks.length) return groups;

    blocks.forEach(function (b) {
        var words = String(b.text || "").trim().split(/\s+/).filter(Boolean);
        if (!words.length) return;
        var totalDur = Math.max(0.2, Number(b.end) - Number(b.start));
        var per = totalDur / words.length;
        for (var i = 0; i < words.length; i++) {
            groups.push({
                start: Number(b.start) + i * per,
                end:   Number(b.start) + (i + 1) * per,
                text:  words[i],
                wc:    1,
                tplName: null,
                selected: false
            });
        }
    });

    return groups;
}

// Detecta fps da sequência ativa (cacheado em SEQ_FPS, atualiza UI)
function detectSeqFps() {
    if (!cs) return;
    // ExtendScript inline pra pegar timebase da sequência ativa
    var script =
        "(function(){try{" +
            "var s=app.project&&app.project.activeSequence;" +
            "if(!s)return JSON.stringify({fps:null});" +
            "var tb=Number(s.timebase);" +    // ticks por frame
            "var fps=tb>0?(254016000000/tb):null;" +
            "return JSON.stringify({fps:fps});" +
        "}catch(e){return JSON.stringify({fps:null,err:String(e)});}})();";
    try {
        cs.evalScript(script, function (raw) {
            try {
                var d = JSON.parse(raw || "{}");
                if (d.fps && isFinite(d.fps) && d.fps > 0) {
                    // arredonda pra valor "humano" (23.976, 24, 29.97, 30, 50, 59.94, 60)
                    var f = Math.round(d.fps * 1000) / 1000;
                    SEQ_FPS = f;
                    var lbl = $("cut-fps");
                    if (lbl) lbl.textContent = (f % 1 === 0) ? String(f) : f.toFixed(2);
                }
            } catch (e) {}
        });
    } catch (e) {}
}

// ──────────────────────────────────────────────── CUT POST-PROCESS
// Aplica máx caracteres, duração mínima e gap entre clips ao array de grupos.
// Recebe grupos {start,end,text,wc,...} já cortados — re-quebra/mescla conforme limites.
function enforceCutOpts(groups, opts) {
    if (!groups || !groups.length) return groups;
    opts = opts || getCutOpts();
    var maxCharsTotal = opts.maxCharsTotal;
    var minDur = opts.minDur;
    var gapSec = opts.gapSec;

    // PASS 1: re-quebra grupos que excedem maxCharsTotal
    var split = [];
    for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        var txt = String(g.text || "").trim();
        if (txt.length <= maxCharsTotal) { split.push(g); continue; }
        var words = txt.split(/\s+/).filter(Boolean);
        // Agrupa palavras ate atingir maxCharsTotal
        var chunks = [];
        var cur = [], curLen = 0;
        for (var w = 0; w < words.length; w++) {
            var word = words[w];
            var addLen = (cur.length ? 1 : 0) + word.length;
            if (cur.length && curLen + addLen > maxCharsTotal) {
                chunks.push(cur); cur = [word]; curLen = word.length;
            } else {
                cur.push(word); curLen += addLen;
            }
        }
        if (cur.length) chunks.push(cur);
        // Distribui timing proporcional ao número de palavras
        var totalWords = words.length;
        var startSec = Number(g.start), endSec = Number(g.end);
        var totalDur = Math.max(0.1, endSec - startSec);
        var off = 0;
        for (var k = 0; k < chunks.length; k++) {
            var chunkWords = chunks[k];
            var s = startSec + (off / totalWords) * totalDur;
            var e = startSec + ((off + chunkWords.length) / totalWords) * totalDur;
            split.push({
                start: s,
                end: e,
                text: chunkWords.join(" "),
                wc: chunkWords.length,
                tplName: g.tplName || null,
                selected: false
            });
            off += chunkWords.length;
        }
    }

    // PASS 2: aplica duração mínima — mescla grupos curtos consecutivos quando possível
    // EXCEÇÃO: no modo 1-palavra, NUNCA mescla (cada palavra fica como grupo próprio)
    var oneWord = !!opts.oneWord;
    var merged = [];
    for (var j = 0; j < split.length; j++) {
        var cg = split[j];
        var dur = cg.end - cg.start;
        if (dur >= minDur || !merged.length) {
            merged.push(cg);
            continue;
        }
        // No modo 1-palavra: NUNCA mescla — só pusha (extend é tratado depois)
        if (oneWord) {
            merged.push(cg);
            continue;
        }
        // grupo atual é curto demais — tenta mesclar com o anterior SE o texto combinado couber
        var prev = merged[merged.length - 1];
        var combined = (prev.text + " " + cg.text).trim();
        if (combined.length <= maxCharsTotal) {
            prev.end = cg.end;
            prev.text = combined;
            prev.wc = combined.split(/\s+/).filter(Boolean).length;
        } else {
            // não cabe — só estende a duração até atingir minDur (ou até próximo grupo)
            var nextStart = (split[j + 1] && Number(split[j + 1].start)) || (cg.end + minDur);
            cg.end = Math.min(cg.start + minDur, nextStart - 0.01);
            if (cg.end <= cg.start) cg.end = cg.start + minDur;
            merged.push(cg);
        }
    }
    // Última passada: se ainda há algum grupo abaixo do mínimo, estende (sem mesclar)
    for (var m = 0; m < merged.length; m++) {
        var mg = merged[m];
        if (mg.end - mg.start < minDur) {
            var next = merged[m + 1];
            var hardLimit = next ? Number(next.start) - 0.01 : (mg.start + minDur);
            mg.end = Math.max(mg.end, Math.min(mg.start + minDur, hardLimit));
        }
    }

    // PASS 3: aplica gap entre clips (se necessário, encurta o fim do anterior)
    if (gapSec > 0) {
        for (var n = 0; n < merged.length - 1; n++) {
            var a = merged[n], b = merged[n + 1];
            var requiredEnd = b.start - gapSec;
            if (a.end > requiredEnd) {
                a.end = Math.max(a.start + 0.1, requiredEnd);
            }
        }
    }

    return merged;
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
    if (!availableWcs.length) return enforceCutOpts(chunkByWords(blocks, 3));
    var minWc = availableWcs[0];
    var maxWc = availableWcs[availableWcs.length - 1];

    // Conector mode da UI
    var connMode = ($("auto-srt-connector-mode") && $("auto-srt-connector-mode").value) || "smart";
    var cutOpts = getCutOpts();
    var maxCharsTotal = cutOpts.maxCharsTotal;

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

        // Helpers de caracteres
        function charsOf(slice) {
            if (!slice || !slice.length) return 0;
            var s = slice.join(" ");
            return s.length;
        }
        function fitsCharLimit(slice) {
            return charsOf(slice) <= maxCharsTotal;
        }

        function chunkSegment(seg) {
            if (!seg.length) return;
            // Se cabe num wc disponível E respeita maxChars, vai inteiro
            if (seg.length <= maxWc && availableWcs.indexOf(seg.length) >= 0 && fitsCharLimit(seg)) {
                emit(seg);
                return;
            }
            if (seg.length <= maxWc && fitsCharLimit(seg)) {
                // Não tem template exato — usa mais próximo
                emit(seg);
                return;
            }
            // Precisa dividir: prefere chunks 3-4p (sweet spot) MAS respeita maxChars
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
                // Encolhe chunk se estourar maxChars
                while (chunkSize > 1 && !fitsCharLimit(seg.slice(cursor, cursor + chunkSize))) {
                    chunkSize--;
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

    // Aplica constraints de corte (maxChars/minDur/gap)
    return enforceCutOpts(groups, cutOpts);
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

    var cutOpts = getCutOpts();
    var maxCharsTotal = cutOpts.maxCharsTotal;

    // Tokeniza preservando pontuação
    var sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[\.!?])\s+/).filter(Boolean);

    var groups = [];
    var cursor = startSec;

    sentences.forEach(function (sentence) {
        var words = sentence.split(/\s+/).filter(Boolean);
        if (!words.length) return;

        // Divide a frase em chunks que casam com templates E com maxChars
        var chunks = greedyChunkForTemplates(words, availableWcs, maxCharsTotal);

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

    // Aplica constraints (maxChars/minDur/gap entre clips)
    return enforceCutOpts(groups, cutOpts);
}

// Greedy: a partir das word counts disponíveis, distribui as palavras
// preferindo chunks que existem como template, e quando possível 3-4 palavras
// Respeita maxCharsTotal se passado.
function greedyChunkForTemplates(words, availableWcs, maxCharsTotal) {
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

        // Respeita maxCharsTotal — encolhe chunk se estourar
        if (maxCharsTotal && maxCharsTotal > 0) {
            while (picked > 1 && words.slice(i, i + picked).join(" ").length > maxCharsTotal) {
                picked--;
            }
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

    var oneWord = isOneWordMode();
    if (oneWord) {
        // Modo 1 palavra por legenda: cada palavra vira grupo próprio, template 1p
        var raw = oneWordPerCaption(SRT_DATA);
        SRT_GROUPS = enforceCutOpts(raw, getCutOpts());
    } else {
        SRT_GROUPS = smartDistribute(SRT_DATA);
    }
    SRT_GROUPS.forEach(function (g) { g.tplName = defaultTplForWc(g.wc); g.selected = false; });
    renderSrtEditor(); updateSrtSummary();

    // Log estatística: distribuição por wc
    var byWc = {};
    SRT_GROUPS.forEach(function (g) { byWc[g.wc] = (byWc[g.wc] || 0) + 1; });
    var stats = Object.keys(byWc).sort().map(function (k) { return k + "p:" + byWc[k]; }).join(" · ");
    var modeLbl = oneWord ? " [modo 1-palavra]" : "";
    log("⚡ Distribuição: " + SRT_GROUPS.length + " grupos · " + stats + modeLbl, "info");
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

    var groups;
    if (isOneWordMode()) {
        // 1 palavra por legenda: usa WPM pra calcular duração de cada palavra
        var secPerWord = 60 / wpm;
        var words = text.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
        var cursor = startSec;
        groups = [];
        for (var i = 0; i < words.length; i++) {
            var dur = Math.max(0.2, secPerWord);
            groups.push({
                start: cursor,
                end: cursor + dur,
                text: words[i],
                wc: 1,
                tplName: null,
                selected: false
            });
            cursor += dur + 0.02;
            if (/[\.!?]$/.test(words[i])) cursor += gap;
        }
        groups = enforceCutOpts(groups, getCutOpts());
    } else {
        groups = scriptToSrt(text, { startSec: startSec, wpm: wpm, gap: gap });
    }
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

// Cache global: { "HelveticaNeue-Bold": ["Texto 13", "Texto 24"], ... }
var FONT_REQUIREMENTS = null;
// Set de fontes que SABEMOS estar faltando (PostScript name)
var MISSING_FONTS = [];

// Checa fontes instaladas no sistema via PowerShell (do lado Node, não JSX).
// Retorna lista de PostScript names instalados e ausentes.
function checkSystemFontsNode(postScriptNames, cb) {
    if (!nodeCp || !nodeFs || !nodeOs || !nodePath) { cb("Node APIs indisponíveis"); return; }
    if (!postScriptNames || !postScriptNames.length) { cb(null, { installed: [], missing: [] }); return; }
    var tmpDir = nodePath.join(nodeOs.tmpdir(), "_mpl_fonts");
    try { if (!nodeFs.existsSync(tmpDir)) nodeFs.mkdirSync(tmpDir, { recursive: true }); }
    catch (e) { cb("mkdir falhou: " + e.message); return; }
    var dumpFile = nodePath.join(tmpDir, "fonts_dump.txt");
    try {
        nodeCp.execFileSync("powershell", [
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
            "$paths=@('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts');" +
            "$out=@(); foreach($p in $paths){ try{ (Get-ItemProperty $p).PSObject.Properties | ?{ $_.Name -notmatch '^PS' } | %{ $out += $_.Name + '|' + $_.Value } }catch{} };" +
            "$out -join \"`n\" | Out-File -FilePath '" + dumpFile.replace(/\\/g, "\\\\") + "' -Encoding utf8"
        ], { timeout: 15000, windowsHide: true });
    } catch (e) {
        // Ignora — usa dump parcial se conseguiu
    }
    var dump = "";
    try { dump = nodeFs.readFileSync(dumpFile, "utf8"); } catch (e) { cb("read dump falhou"); return; }

    function normalize(s) { return String(s||"").toLowerCase().replace(/[^a-z0-9]/g, ""); }
    var registryNorm = dump.split(/\r?\n/).map(function (l) {
        return normalize(l.split("|")[0].replace(/\(.*?\)/g, ""));
    }).filter(Boolean);

    var installed = [], missing = [];
    postScriptNames.forEach(function (n) {
        var k = normalize(n);
        var found = false;
        for (var i = 0; i < registryNorm.length; i++) {
            var r = registryNorm[i];
            if (!r) continue;
            if (r === k || r.indexOf(k) >= 0 || (k.indexOf(r) >= 0 && r.length >= 6)) {
                found = true; break;
            }
        }
        if (found) installed.push(n); else missing.push(n);
    });
    cb(null, { installed: installed, missing: missing });
}

// Carrega font-requirements.json (pré-computado em build) e cruza com fontes do sistema
function checkFontsBanner() {
    if (!cs || !nodePath || !nodeFs) return;
    var reqPath = nodePath.join(EXT_PATH, "packs", "font-requirements.json");
    var raw;
    try { raw = nodeFs.readFileSync(reqPath, "utf8"); }
    catch (e) {
        // fallback: usa o método antigo (checa arquivos shipped)
        checkFontsLegacy(); return;
    }
    var req; try { req = JSON.parse(raw); } catch (e) { checkFontsLegacy(); return; }
    FONT_REQUIREMENTS = req;

    var allFonts = Object.keys(req.font_usage || {});
    if (!allFonts.length) return;

    log("🔤 Checando " + allFonts.length + " fontes únicas usadas nos templates…", "info");
    checkSystemFontsNode(allFonts, function (errF, d) {
        if (errF) { log("✗ checkFonts: " + errF, "warn"); return; }
        MISSING_FONTS = d.missing || [];
        var instCount = (d.installed || []).length;
        log("🔤 Fontes: " + instCount + " OK · " + MISSING_FONTS.length + " faltando", instCount === allFonts.length ? "info" : "warn");

        if (MISSING_FONTS.length > 0) {
            // Quantos templates ficam afetados
            var affectedSet = {};
            MISSING_FONTS.forEach(function (fn) {
                (req.font_usage[fn] || []).forEach(function (tpl) { affectedSet[tpl] = true; });
            });
            var affected = Object.keys(affectedSet).length;

            // Log detalhado
            MISSING_FONTS.forEach(function (fn) {
                var users = req.font_usage[fn] || [];
                log("   ❌ " + fn + " → " + users.length + " template(s) afetado(s)", "warn");
            });

            showFontWarningBanner(MISSING_FONTS, affected, req.total_templates);
            markTemplatesWithMissingFonts();
        } else {
            // Tudo OK — esconde banner se aberto
            var b = $("font-banner"); if (b) b.classList.add("hidden");
        }
    });
}

// Fallback se font-requirements.json não existir (modo antigo)
function checkFontsLegacy() {
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

function showFontWarningBanner(missingFonts, affectedCount, totalTpls) {
    var banner = $("font-banner");
    if (!banner) return;
    banner.classList.remove("hidden");
    var txt = $("font-banner-text");
    if (txt) {
        var examples = missingFonts.slice(0, 3).join(", ") + (missingFonts.length > 3 ? "…" : "");
        txt.innerHTML = "🔤 <b>" + missingFonts.length + " fontes faltando</b> " +
                        "(" + examples + ") · afeta <b>" + affectedCount + "/" + totalTpls + "</b> templates — render fica diferente do preview";
    }
}

// Marca cards de templates que dependem de fontes faltantes
function markTemplatesWithMissingFonts() {
    if (!FONT_REQUIREMENTS || !MISSING_FONTS.length) return;
    var missingSet = {}; MISSING_FONTS.forEach(function (f) { missingSet[f] = true; });
    var affected = {};
    Object.keys(FONT_REQUIREMENTS.template_fonts || {}).forEach(function (tpl) {
        var fonts = FONT_REQUIREMENTS.template_fonts[tpl];
        if (!fonts) return;
        if (typeof fonts === "string") fonts = [fonts];
        if (!Array.isArray(fonts)) return;
        for (var i = 0; i < fonts.length; i++) {
            if (missingSet[fonts[i]]) { affected[tpl] = fonts[i]; break; }
        }
    });
    // Aplica no DOM (se grid já está renderizado)
    Object.keys(affected).forEach(function (tpl) {
        var cards = document.querySelectorAll('.tpl-card[data-tpl="' + cssEscape(tpl) + '"]');
        cards.forEach(function (c) {
            c.classList.add("tpl-card--missing-font");
            c.title = "⚠️ Precisa de " + affected[tpl] + " (fonte não instalada)";
        });
    });
}

function cssEscape(s) {
    return String(s).replace(/"/g, '\\"');
}

// Retorna fontes faltantes pra um template específico (ou [] se OK)
function getMissingFontsForTemplate(tplName) {
    if (!FONT_REQUIREMENTS || !MISSING_FONTS.length) return [];
    var fonts = (FONT_REQUIREMENTS.template_fonts || {})[tplName];
    if (!fonts) return [];
    // Defensivo: aceita string OU array (PowerShell ConvertTo-Json às vezes desempacota arrays de 1 elemento)
    if (typeof fonts === "string") fonts = [fonts];
    if (!Array.isArray(fonts)) return [];
    var missingSet = {}; MISSING_FONTS.forEach(function (f) { missingSet[f] = true; });
    return fonts.filter(function (f) { return missingSet[f]; });
}

function installFonts() {
    if (!nodePath || !nodeFs || !nodeOs || !nodeCp) { toast("Node APIs indisponíveis", "err"); return; }
    var fontsDir = nodePath.join(EXT_PATH, "fonts");
    var btn = $("btn-install-fonts");
    if (btn) { btn.textContent = "Instalando…"; btn.disabled = true; }
    log("Instalando fontes de " + fontsDir, "info");

    // Pasta user-space pra fontes (não precisa admin)
    var userFontDir = nodePath.join(nodeOs.homedir(), "AppData", "Local", "Microsoft", "Windows", "Fonts");
    try { if (!nodeFs.existsSync(userFontDir)) nodeFs.mkdirSync(userFontDir, { recursive: true }); } catch (e) {}

    var installed = 0, skipped = 0;
    var errors = [];
    var files;
    try { files = nodeFs.readdirSync(fontsDir).filter(function (f) { return /\.(ttf|otf)$/i.test(f); }); }
    catch (e) { log("✗ Lendo pasta fonts: " + e.message, "err"); if (btn) btn.textContent = "Tentar novamente"; return; }

    files.forEach(function (name) {
        var srcF = nodePath.join(fontsDir, name);
        var dstF = nodePath.join(userFontDir, name);
        try {
            if (nodeFs.existsSync(dstF)) { skipped++; return; }
            nodeFs.copyFileSync(srcF, dstF);
            installed++;
            // Registra no registry HKCU pra Windows reconhecer
            try {
                var fontType = /\.ttf$/i.test(name) ? "TrueType" : "OpenType";
                var regName = name.replace(/\.(ttf|otf)$/i, "") + " (" + fontType + ")";
                nodeCp.execFileSync("reg", [
                    "add", "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
                    "/v", regName, "/t", "REG_SZ", "/d", dstF, "/f"
                ], { timeout: 5000, windowsHide: true });
            } catch (eReg) { /* registry write pode falhar mas o arquivo já tá lá */ }
        } catch (eCp) {
            errors.push(name + ": " + eCp.message);
        }
    });

    if (btn) btn.disabled = false;
    log("✓ Fontes: " + installed + " instaladas · " + skipped + " já existiam" + (errors.length ? " · " + errors.length + " erros" : ""), "info");
    log("  pasta: " + userFontDir, "info");
    toast("✓ " + installed + " fontes instaladas! Reinicie o Premiere pra elas aparecerem.", "ok", 6000);

    // Re-check apos 3s (da tempo do registry escrever). Se ainda missing, mostra
    // banner pedindo restart do Premiere em vez de esconder cegamente.
    setTimeout(function () {
        if (typeof checkFontsBanner === "function") {
            checkFontsBanner();
            // Se ainda houver fontes missing, atualiza texto pra "reinicie Premiere"
            setTimeout(function () {
                if (MISSING_FONTS && MISSING_FONTS.length > 0) {
                    var txt = $("font-banner-text");
                    if (txt) {
                        txt.innerHTML = "✓ Fontes instaladas — <b>reinicie o Premiere</b> pra elas aparecerem nos templates";
                    }
                } else {
                    $("font-banner").classList.add("hidden");
                }
            }, 500);
        }
    }, 3000);
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
    var oneWord = isOneWordMode();

    if (!TPLS_BY_WC) buildTplIndex();

    // No modo 1-palavra: FORÇA wc=1 (ignora overrides, ignora qualquer wc != 1)
    if (oneWord) wc = 1;

    // 0) Estilo Global ligado com template fixo? Force absoluto (independente do wc do grupo).
    //    Usuário pediu explicitamente esse template pra TODAS legendas — respeita.
    var gs = getActiveGlobalStyle();
    if (gs && gs.tplName) {
        var gsTpl = ALL_TEMPLATES.find(function (t) { return t.name === gs.tplName; });
        if (gsTpl) return gs.tplName;
    }

    // 1) Se user escolheu template fixo no dropdown E ele bate com o wc do grupo, usa
    //    (no modo 1-palavra, só aceita se o template fixo também for 1p)
    if (fixedName && !oneWord) {
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

// ──────────────────────────────────────────────── INJECT MODE (Node.js side)
// Gera MOGRTs customizados em batch via PowerShell — rodando do CEP/Node,
// não do ExtendScript (que não tem `system.callSystem` no Premiere CC moderno).
// jobs: [{id, srcMogrt, dstMogrt, words}]
function prepareInjectMogrtsNode(jobs, cb) {
    if (!nodeCp || !nodeFs || !nodeOs || !nodePath) {
        cb("Node.js APIs indisponíveis"); return;
    }
    var tmpDir = nodePath.join(nodeOs.tmpdir(), "_mpl_inject");
    try { if (!nodeFs.existsSync(tmpDir)) nodeFs.mkdirSync(tmpDir, { recursive: true }); }
    catch (e) { cb("mkdir falhou: " + e.message); return; }

    var jobsFile   = nodePath.join(tmpDir, "jobs.json");
    var resultFile = nodePath.join(tmpDir, "result.json");
    var ps1File    = nodePath.join(tmpDir, "process.ps1");

    // Escreve jobs
    try { nodeFs.writeFileSync(jobsFile, JSON.stringify(jobs), "utf8"); }
    catch (e) { cb("write jobs falhou: " + e.message); return; }

    // Limpa result anterior
    try { if (nodeFs.existsSync(resultFile)) nodeFs.unlinkSync(resultFile); } catch (e) {}

    // Escreve script PowerShell (idempotente)
    try { nodeFs.writeFileSync(ps1File, POWERSHELL_INJECT_SCRIPT, "utf8"); }
    catch (e) { cb("write ps1 falhou: " + e.message); return; }

    // Roda PowerShell sincronamente (bloqueia UI ~5-15s pra 100+ jobs)
    var psStdout = "", psStderr = "", psExit = 0;
    try {
        psStdout = nodeCp.execFileSync("powershell", [
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", ps1File,
            "-JobsFile", jobsFile,
            "-ResultFile", resultFile
        ], { timeout: 120000, windowsHide: true, encoding: "utf8" });
    } catch (e) {
        psExit = e.status || -1;
        psStderr = String(e.stderr || e.message || "");
        log("⚠️ PowerShell exit=" + psExit + " stderr: " + psStderr.substring(0, 300), "warn");
    }

    // Lê resultado
    try {
        if (!nodeFs.existsSync(resultFile)) {
            cb("result.json não foi gerado. PS exit=" + psExit + " stderr=" + psStderr.substring(0,200));
            return;
        }
        var raw = nodeFs.readFileSync(resultFile, "utf8");
        // Remove BOM se houver
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
        raw = raw.trim();
        if (!raw) {
            cb("result.json vazio. PS exit=" + psExit + " stderr=" + psStderr.substring(0,200));
            return;
        }
        var d = JSON.parse(raw);
        cb(null, d);
    } catch (e) {
        log("✗ Result.json content (primeiros 200 chars): " + (raw||"").substring(0, 200), "err");
        cb("read result falhou: " + e.message + " · PS stderr: " + psStderr.substring(0,200));
    }
}

// Script PowerShell — gera mogrt customizado por job (mesma lógica do host.jsx,
// mas aqui usado direto via child_process do Node).
//
// Job shape: { id, srcMogrt, dstMogrt, words[], font? }
//   - font: PostScript name opcional. Quando setado, substitui TODOS os
//     fontEditValue do definition.json (string e array). Mexe só em fontes
//     editáveis (capPropType=6 / TEXT_FONT) — não toca em fontes embutidas
//     no .aep binário.
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
    "function Replace-FontEditValue {\n" +
    "  # Substitui TODAS as ocorrencias de fontEditValue (string ou array) pelo PostScript name escolhido.\n" +
    "  param([string]$json, [string]$font)\n" +
    "  if (-not $font) { return $json }\n" +
    "  $fEsc = $font.Replace('\\','\\\\').Replace('\"','\\\"')\n" +
    "  # Forma A: \"fontEditValue\":\"X\"\n" +
    "  $json = [regex]::Replace($json, '\"fontEditValue\"\\s*:\\s*\"[^\"]*\"', '\"fontEditValue\":\"' + $fEsc + '\"')\n" +
    "  # Forma B: \"fontEditValue\":[\"X\"] (pode ter varios items)\n" +
    "  $json = [regex]::Replace($json, '\"fontEditValue\"\\s*:\\s*\\[\\s*(\"[^\"]*\"(\\s*,\\s*\"[^\"]*\")*)\\s*\\]', {\n" +
    "    param($m)\n" +
    "    $inner = $m.Groups[1].Value\n" +
    "    $items = [regex]::Matches($inner, '\"[^\"]*\"')\n" +
    "    $newItems = @()\n" +
    "    for ($k=0; $k -lt $items.Count; $k++) { $newItems += '\"' + $fEsc + '\"' }\n" +
    "    return '\"fontEditValue\":[' + ($newItems -join ',') + ']'\n" +
    "  })\n" +
    "  return $json\n" +
    "}\n" +
    "\n" +
    "foreach ($j in $jobs) {\n" +
    "  $r = @{ id=$j.id; success=$false; error=$null; outPath=$null }\n" +
    "  try {\n" +
    "    if (-not (Test-Path $j.srcMogrt)) { throw 'src nao existe' }\n" +
    "    Copy-Item -Path $j.srcMogrt -Destination $j.dstMogrt -Force\n" +
    "    $zipBytes = [System.IO.File]::ReadAllBytes($j.dstMogrt)\n" +
    "    $ms = New-Object System.IO.MemoryStream\n" +
    "    $ms.Write($zipBytes, 0, $zipBytes.Length)\n" +
    "    $zip = New-Object System.IO.Compression.ZipArchive($ms, [System.IO.Compression.ZipArchiveMode]::Update)\n" +
    "    $entry = $zip.Entries | Where-Object { $_.Name -eq 'definition.json' } | Select-Object -First 1\n" +
    "    if (-not $entry) { throw 'definition.json nao encontrado no zip' }\n" +
    "    $reader = New-Object System.IO.StreamReader($entry.Open())\n" +
    "    $json = $reader.ReadToEnd(); $reader.Close()\n" +
    "    $words = @($j.words)\n" +
    "    $json = Replace-OrderedTextFields -json $json -pattern '\"textEditValue\"\\s*:\\s*\"([^\"]*)\"' -replaceTemplate '\"textEditValue\":\"{TEXT}\"' -words $words\n" +
    "    $json = Replace-OrderedTextFields -json $json -pattern '\"capPropDefault\"\\s*:\\s*\"([^\"]*)\"\\s*,\\s*\"capPropFontEdit\"\\s*:\\s*true' -replaceTemplate '\"capPropDefault\":\"{TEXT}\",\"capPropFontEdit\":true' -words $words\n" +
    "    if ($j.font) { $json = Replace-FontEditValue -json $json -font ([string]$j.font) }\n" +
    "    $entry.Delete()\n" +
    "    $newEntry = $zip.CreateEntry('definition.json')\n" +
    "    $writer = New-Object System.IO.StreamWriter($newEntry.Open())\n" +
    "    $writer.Write($json); $writer.Close()\n" +
    "    $zip.Dispose()\n" +
    "    [System.IO.File]::WriteAllBytes($j.dstMogrt, $ms.ToArray())\n" +
    "    $ms.Dispose()\n" +
    "    $r.success = $true\n" +
    "    $r.outPath = $j.dstMogrt\n" +
    "    $r.wordsUsed = $words.Count\n" +
    "    if ($j.font) { $r.fontInjected = [string]$j.font }\n" +
    "  } catch {\n" +
    "    $r.error = $_.Exception.Message\n" +
    "  }\n" +
    "  $results += $r\n" +
    "}\n" +
    "$out = @{ ok=$true; jobs=$results }\n" +
    "$out | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath $ResultFile -Encoding UTF8 -NoNewline\n";

// Limpa mogrts temporários gerados
function cleanInjectTmpNode() {
    if (!nodeFs || !nodeOs || !nodePath) return 0;
    var tmpDir = nodePath.join(nodeOs.tmpdir(), "_mpl_inject");
    var cleaned = 0;
    try {
        if (!nodeFs.existsSync(tmpDir)) return 0;
        var files = nodeFs.readdirSync(tmpDir);
        files.forEach(function (f) {
            if (/^inject_.*\.mogrt$/i.test(f)) {
                try { nodeFs.unlinkSync(nodePath.join(tmpDir, f)); cleaned++; } catch (e) {}
            }
        });
    } catch (e) {}
    return cleaned;
}

function applySrtBatch() {
    if (!SRT_GROUPS.length) { toast("Sem grupos pra aplicar", "warn"); return; }
    var groups = SRT_GROUPS.filter(function (g) { return g.tplName && g.text; });
    if (!groups.length) { toast("Nenhum grupo tem template. Use 'Aplicar template...'", "warn"); return; }

    // CDN-aware: resolve cada template (baixa do R2 se necessário) em paralelo
    var resolutions = groups.map(function (g, gi) {
        var tpl = ALL_TEMPLATES.find(function (t) { return t.name === g.tplName; });
        if (!tpl || (!tpl.mogrt && !tpl.cdn_key)) return Promise.resolve(null);
        return resolveMogrtPath(tpl).then(function (abs) {
            return { id: "g" + gi, mogrtPath: abs, start: g.start, end: g.end, text: g.text, tplName: g.tplName };
        }).catch(function (e) {
            log("✗ resolve " + tpl.name + ": " + e.message, "err");
            return null;
        });
    });

    toast("⬇ Preparando templates (CDN)…", "info", 1500);
    Promise.all(resolutions).then(function (resolved) {
        var payload = resolved.filter(Boolean);
        if (!payload.length) { toast("Templates não encontrados", "err"); return; }
        _applySrtBatchWithPayload(payload);
    });
}
function _applySrtBatchWithPayload(payload) {

    var trackMode = ($("auto-srt-track") && $("auto-srt-track").value) || "-1";
    var policy = (document.querySelector('input[name="postApplyPolicy"]:checked') || {}).value || "keep";

    APPLY_CANCELED = false;
    openLog();
    var gs = getActiveGlobalStyle();
    var gsLog = gs ? " · GS:" + [gs.tplName && "tpl=" + gs.tplName, gs.font && "font=" + gs.font].filter(Boolean).join(",") : "";
    log("► Batch APLY: " + payload.length + " grupos · track=" + trackMode + gsLog);

    var btn = $("btn-auto-srt-apply");
    var orig = btn.textContent;
    btn.disabled = false;
    btn.textContent = "⏳ Preparando mogrts…";

    // Vars compartilhadas entre as fases (finish() acessa essas)
    var applied = 0, failed = 0;

    // ── FASE 1: gera custom mogrts via PowerShell (todos em batch)
    var tmpDir = (nodeOs ? nodeOs.tmpdir() : "C:/Windows/Temp").replace(/\\/g, "/") + "/_mpl_inject";
    var jobs = payload.map(function (g, i) {
        var words = String(g.text).split(/\s+/).filter(Boolean);
        var job = {
            id: g.id,
            srcMogrt: g.mogrtPath,
            dstMogrt: tmpDir + "/inject_" + i + "_" + Date.now() + ".mogrt",
            words: words
        };
        if (gs && gs.font) job.font = gs.font;
        return job;
    });
    // Marca dstMogrt no payload pra usar depois
    jobs.forEach(function (j, i) { payload[i].customMogrt = j.dstMogrt; });

    log("⚙️ Preparando " + jobs.length + " mogrts customizados via Node/PowerShell…", "info");
    // Yield 1 frame pra UI atualizar antes do PowerShell bloquear
    setTimeout(function () {
    prepareInjectMogrtsNode(jobs, function (errPrep, prepRes) {
        if (errPrep) {
            log("✗ Prepare failed: " + errPrep, "err");
            log("→ Fallback pro modo legacy (setValue)", "warn");
            applySrtBatchLegacy(payload, trackMode, policy, btn, orig);
            return;
        }

        // Conta sucesso/falha da fase prep
        var prepJobs = prepRes.jobs || [];
        var prepOk = prepJobs.filter(function (j) { return j.success; }).length;
        var prepFail = prepJobs.length - prepOk;
        log("⚙️ Preparados: " + prepOk + " OK · " + prepFail + " falhas", prepFail ? "warn" : "info");
        if (prepFail > 0 && prepFail <= 3) {
            prepJobs.filter(function (j) { return !j.success; }).slice(0, 3).forEach(function (j) {
                log("  ✗ " + j.id + ": " + j.error, "err");
            });
        }

        // Mapa id → outPath
        var byId = {};
        prepJobs.forEach(function (j) { byId[j.id] = j; });

        // ── FASE 2: importa os custom mogrts em loop (sem setValue)
        var idx = 0;
        var startedAt = Date.now();
        btn.onclick = function () { APPLY_CANCELED = true; log("Cancelando…", "warn"); };

        function next() {
            if (APPLY_CANCELED || idx >= payload.length) { finish(); return; }
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

            var prepJob = byId[g.id];
            if (!prepJob || !prepJob.success || !prepJob.outPath) {
                failed++;
                if (failed <= 5) log("  ✗ #" + idx + " sem custom mogrt (" + (prepJob && prepJob.error || "?") + ")", "err");
                setTimeout(next, 10);
                return;
            }

            var ticks = String(Math.round(g.start * TICKS));
            var durSec = Math.max(0.4, g.end - g.start);
            var script = "$.global.EP_importPreparedMogrt(" +
                JSON.stringify(prepJob.outPath) + "," +
                JSON.stringify(ticks) + "," +
                JSON.stringify(trackMode) + "," +
                durSec + ");";

            cs.evalScript(script, function (raw) {
                var d; try { d = JSON.parse(raw || "{}"); } catch (e) { d = { error: "parse:" + String(raw||"").slice(0,80) }; }
                if (d.error) {
                    failed++;
                    if (failed <= 5) log("  ✗ #" + idx + " import: " + d.error, "err");
                } else {
                    applied++;
                    if (idx === 1) {
                        log("  ✓ #1 V" + (d.track + 1) + " · '" + g.text + "' (inject mode)", "info");
                    }
                }
                setTimeout(next, 30);
            });
        }

        next();
    });
    }, 50);   // ← fecha o setTimeout wrapper do prepareInjectMogrtsNode

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
            // Volume alto → mostra painel pós-aplicar com dicas de render
            if (applied >= 50) {
                showPostApplyPanel(applied, trackMode);
            }
        }

        // Limpa custom mogrts temporários (no Node, mais rápido)
        var cleaned = cleanInjectTmpNode();
        if (cleaned) log("🧹 " + cleaned + " mogrts temp removidos", "info");
    }
}

// ── Fallback legacy: se a fase de prepare falhar, usa o setValue antigo
function applySrtBatchLegacy(payload, trackMode, policy, btn, orig) {
    log("[legacy mode] aplicando via setValue…", "warn");
    var idx = 0;
    var applied = 0, failed = 0;
    var startedAt = Date.now();
    btn.onclick = function () { APPLY_CANCELED = true; log("Cancelando…", "warn"); };

    function next() {
        if (APPLY_CANCELED || idx >= payload.length) { finish(); return; }
        var g = payload[idx];
        idx++;
        btn.textContent = "⏸ CANCELAR (" + idx + "/" + payload.length + ")";
        var ticks = String(Math.round(g.start * TICKS));
        var durSec = Math.max(0.4, g.end - g.start);
        var slotIdx = getSlotIndicesFor(g.tplName);
        var slotIdxJson = slotIdx ? JSON.stringify(JSON.stringify(slotIdx)) : "null";
        var script = "$.global.EP_applyOneGroup(" +
            JSON.stringify(g.mogrtPath) + "," +
            JSON.stringify(ticks) + "," +
            JSON.stringify(trackMode) + "," +
            JSON.stringify(g.text) + "," +
            durSec + "," +
            slotIdxJson + ");";
        cs.evalScript(script, function (raw) {
            var d; try { d = JSON.parse(raw || "{}"); } catch (e) { d = { error: "parse" }; }
            if (d.error) { failed++; if (failed <= 5) log("  ✗ #" + idx + " " + d.error, "err"); }
            else { applied++; }
            setTimeout(next, 30);
        });
    }
    function finish() {
        btn.disabled = false;
        btn.textContent = orig;
        btn.onclick = applySrtBatch;
        log("✓ Legacy DONE · " + applied + " aplicados · " + failed + " falhas", "info");
        toast("✓ " + applied + " títulos (modo legacy)", failed ? "warn" : "ok", 4000);
    }
    next();
}

// ────────────────────────────────────────────────  POST-APPLY HELPER (render safety)
// Mostra um banner com botões pra renderizar preview (cache verde) e
// agrupar legendas em nest — evita Premiere travar no export com muitos MOGRTs.
function showPostApplyPanel(count, trackMode) {
    var p = $("post-apply-panel"); if (!p) return;
    p.classList.remove("hidden");
    var c = $("post-apply-count"); if (c) c.textContent = count;
    log("⚠️ " + count + " legendas é volume alto. Faça RENDER PREVIEW antes de exportar pra evitar crash.", "warn");
    log("   • Sequence > Render Effects In to Out (ou ENTER na timeline)", "info");
    log("   • Ou Clip > Nest pra agrupar em sequência aninhada (muito mais leve)", "info");

    // Wire dos botões (idempotente)
    var rp = $("btn-render-preview");
    if (rp) rp.onclick = function () {
        log("🎬 Disparando Render Effects In to Out…", "info");
        rp.disabled = true; rp.textContent = "Renderizando…";
        jsx("$.global.EP_renderInToOut();", function (d) {
            rp.disabled = false; rp.textContent = "🎬 Renderizar preview";
            if (d && d.manual) {
                toast("⚠️ " + d.msg, "warn", 5000);
                log("→ " + d.msg, "warn");
            } else if (d && d.started) {
                toast("🎬 Render preview iniciado — aguarde a barra verde", "ok", 4000);
            } else if (d && d.error) {
                toast("Erro: " + d.error, "err");
                log("✗ Render: " + d.error, "err");
            }
        });
    };

    var ne = $("btn-nest-clips");
    if (ne) ne.onclick = function () {
        var trackIdx = (trackMode === "-1") ? -1 : parseInt(trackMode, 10);
        log("📦 Agrupando legendas em Nest…", "info");
        ne.disabled = true; ne.textContent = "Aninhando…";
        jsx("$.global.EP_nestVideoTrack(" + trackIdx + ");", function (d) {
            ne.disabled = false; ne.textContent = "📦 Agrupar em Nest";
            if (d && d.manual) {
                toast("⚠️ " + d.msg, "warn", 5000);
            } else if (d && d.nestedCount) {
                toast("✓ " + d.nestedCount + " legendas agrupadas em Nest na V" + d.track, "ok", 4000);
                hidePostApplyPanel();
            } else if (d && d.error) {
                toast("Erro: " + d.error, "err");
            }
        });
    };

    var x = $("post-apply-close");
    if (x) x.onclick = hidePostApplyPanel;
}

function hidePostApplyPanel() {
    var p = $("post-apply-panel"); if (p) p.classList.add("hidden");
}

// ────────────────────────────────────────────────  SFX (synth → WAV → tmp → import)
var SFX_LIBRARY = {
    "click":   { cat: "click", name: "Click",   source: "synth", play: function () { sfxClick(1000, .08); } },
    "pop":     { cat: "click", name: "Pop",     source: "synth", play: function () { sfxPop(.10); } },
    "tick":    { cat: "click", name: "Tick",    source: "synth", play: function () { sfxClick(3000, .03); } },
    "shutter": { cat: "camera", name: "Camera Shutter", source: "synth", play: function () { sfxShutter(.04, .10); } },
    "snap":    { cat: "camera", name: "Camera Snap",    source: "synth", play: function () { sfxClick(3200, .04); } },
    "whoosh-light": { cat: "whoosh", name: "Whoosh Light", source: "synth", play: function () { sfxWhoosh(800, 200, .30); } },
    "whoosh-heavy": { cat: "whoosh", name: "Whoosh Heavy", source: "synth", play: function () { sfxWhoosh(1200, 100, .50); } },
    "impact":  { cat: "impact", name: "Impact",  source: "synth", play: function () { sfxKick(80, .20); } },
    "boom":    { cat: "impact", name: "Boom",    source: "synth", play: function () { sfxKick(45, .40); } },
    "typing":  { cat: "typing", name: "Typing",  source: "synth", play: function () { sfxTypingBurst(); } }
};

// ────────────────────────────────────────────────  SFX REAIS (packs/sfx/)
// Scanner automático: lê packs/sfx/<categoria>/*.{mp3,wav,ogg,m4a}
// Cada arquivo vira um SFX clicável. Nome do arquivo = nome do SFX, subpasta = categoria.
function scanRealSfx() {
    if (!nodeFs || !nodePath) return;
    var sfxRoot = nodePath.join(EXT_PATH, "packs", "sfx");
    try {
        if (!nodeFs.existsSync(sfxRoot)) { return; }
        var cats = nodeFs.readdirSync(sfxRoot);
        var added = 0;
        cats.forEach(function (catDir) {
            var catPath = nodePath.join(sfxRoot, catDir);
            var stat; try { stat = nodeFs.statSync(catPath); } catch (e) { return; }
            if (!stat.isDirectory()) return;
            var files = nodeFs.readdirSync(catPath);
            files.forEach(function (fn) {
                if (!/\.(mp3|wav|ogg|m4a)$/i.test(fn)) return;
                var key = "real:" + catDir + "/" + fn;
                var displayName = fn.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
                // Capitaliza
                displayName = displayName.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
                SFX_LIBRARY[key] = {
                    cat: catDir.toLowerCase(),
                    name: displayName,
                    source: "real",
                    filePath: nodePath.join(catPath, fn)
                };
                added++;
            });
        });
        if (added) log("🔊 SFX reais escaneados: " + added + " arquivos em " + sfxRoot, "info");
    } catch (e) {
        log("⚠️ scanRealSfx: " + e.message, "warn");
    }
}

// Renderiza o grid da aba SFX
function renderSfxGrid() {
    var grid = $("sfx-grid"); if (!grid) return;
    var empty = $("sfx-empty");
    var q = ($("sfx-search-input") && $("sfx-search-input").value || "").toLowerCase().trim();
    var catSel = SFX_CAT_FILTER || "all";

    var keys = Object.keys(SFX_LIBRARY).filter(function (k) {
        var s = SFX_LIBRARY[k];
        if (catSel !== "all" && s.cat !== catSel) return false;
        if (q && s.name.toLowerCase().indexOf(q) < 0) return false;
        return true;
    });

    grid.innerHTML = "";
    if (!keys.length) {
        if (empty) empty.classList.remove("hidden");
        return;
    }
    if (empty) empty.classList.add("hidden");

    keys.forEach(function (k) {
        var s = SFX_LIBRARY[k];
        var card = document.createElement("div");
        card.className = "sfx-card" + (SFX_SELECTED === k ? " selected" : "");
        card.setAttribute("data-sfx", k);
        var sourceLabel = s.source === "real" ? '<span class="sfx-card__source real" title="Arquivo real">FILE</span>'
                                              : '<span class="sfx-card__source" title="Som sintético">SYN</span>';
        card.innerHTML =
            '<div class="sfx-card__wave">' +
                '<svg viewBox="0 0 130 56" preserveAspectRatio="none">' +
                    sfxWaveformPath(k) +
                '</svg>' +
                '<span class="sfx-card__cat">' + esc(s.cat) + '</span>' +
                sourceLabel +
            '</div>' +
            '<div class="sfx-card__name" title="' + esc(s.name) + '">' + esc(s.name) + '</div>' +
            '<div class="sfx-card__actions">' +
                '<button class="sfx-card__btn sfx-card__play" title="Tocar preview">▶</button>' +
                '<button class="sfx-card__btn sfx-card__select" title="Selecionar">✓</button>' +
            '</div>';

        // Clique no card = seleciona
        card.onclick = function (e) {
            if (e.target.closest(".sfx-card__btn")) return;
            selectSfx(k);
        };
        // ▶ Play preview
        card.querySelector(".sfx-card__play").onclick = function (e) {
            e.stopPropagation();
            playSfxPreview(k, e.currentTarget);
        };
        // ✓ Selecionar
        card.querySelector(".sfx-card__select").onclick = function (e) {
            e.stopPropagation();
            selectSfx(k);
        };
        grid.appendChild(card);
    });
}

// Gera um path SVG random-ish "waveform-like" pro card (visual)
function sfxWaveformPath(seed) {
    // Hash simples do seed pra ter forma estável
    var h = 0; for (var i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    function rnd() { h = (h * 9301 + 49297) % 233280; return h / 233280; }
    var bars = 28, w = 130 / bars, parts = [];
    for (var i2 = 0; i2 < bars; i2++) {
        var t = i2 / bars;
        // envelope: ataque rápido, decai
        var env = Math.max(0.1, Math.pow(1 - t, 0.6) * (0.4 + rnd() * 0.6));
        var bh = env * 48;
        var x = i2 * w + w * 0.15;
        var y = 28 - bh / 2;
        parts.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (w * 0.65).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="currentColor" opacity="' + (0.5 + rnd()*0.5).toFixed(2) + '" rx="1"/>');
    }
    return parts.join("");
}

// Renderiza pílulas de categoria do SFX
var SFX_CAT_FILTER = "all";
function renderSfxCategories() {
    var el = $("sfx-cat-pills"); if (!el) return;
    var cats = {};
    Object.keys(SFX_LIBRARY).forEach(function (k) {
        var s = SFX_LIBRARY[k];
        cats[s.cat] = (cats[s.cat] || 0) + 1;
    });
    var total = Object.keys(SFX_LIBRARY).length;
    el.innerHTML = '<button class="cat-pill active" data-cat="all">Todos (' + total + ')</button>';
    Object.keys(cats).sort().forEach(function (c) {
        var b = document.createElement("button");
        b.className = "cat-pill"; b.setAttribute("data-cat", c);
        b.textContent = c.charAt(0).toUpperCase() + c.slice(1) + " (" + cats[c] + ")";
        el.appendChild(b);
    });
    el.querySelectorAll(".cat-pill").forEach(function (b) {
        b.onclick = function () {
            el.querySelectorAll(".cat-pill").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
            SFX_CAT_FILTER = b.getAttribute("data-cat");
            renderSfxGrid();
        };
    });
}

// Preview do SFX (toca uma vez no contexto do user)
function playSfxPreview(key, btnEl) {
    var s = SFX_LIBRARY[key]; if (!s) return;
    if (btnEl) { btnEl.classList.add("playing"); setTimeout(function () { btnEl.classList.remove("playing"); }, 600); }
    try {
        if (s.source === "synth" && s.play) { s.play(); }
        else if (s.source === "real" && s.filePath) {
            // Toca via <audio> nativo do browser
            var url = "file:///" + s.filePath.replace(/\\/g, "/");
            var a = new Audio(url); a.volume = 0.85;
            a.play().catch(function (e) { log("✗ play preview: " + e.message, "warn"); });
        }
    } catch (e) { log("✗ playSfxPreview: " + e.message, "warn"); }
}

function selectSfx(key) {
    SFX_SELECTED = key;
    try { localStorage.setItem("mpl_sfx", key); } catch (e) {}
    document.querySelectorAll(".sfx-card.selected").forEach(function (c) { c.classList.remove("selected"); });
    var sel = document.querySelector('.sfx-card[data-sfx="' + key.replace(/"/g, '\\"') + '"]');
    if (sel) sel.classList.add("selected");
    // Habilita botões de aplicar
    var c1 = $("btn-sfx-apply-cti"); if (c1) c1.disabled = false;
    var c2 = $("btn-sfx-apply-all"); if (c2) c2.disabled = false;
    // Mostra nome no botão SFX da aba templates pra reaproveitar seleção
    updateSfxButton();
    var s = SFX_LIBRARY[key];
    log("🔊 SFX selecionado: " + (s ? s.name : key), "info");
}

// Popula track selector da aba SFX com as tracks de áudio da sequência
function populateSfxApplyTracks() {
    var sel = $("sfx-apply-track"); if (!sel) return;
    jsx("$.global.EP_getAudioTracksInfo();", function (d) {
        if (!d || !d.tracks) return;
        var current = sel.value;
        sel.innerHTML = '<option value="">Auto (primeira vazia)</option>';
        d.tracks.forEach(function (t) {
            var opt = document.createElement("option");
            opt.value = String(t.index);
            opt.textContent = t.name + (t.clips > 0 ? " (" + t.clips + " clips)" : " (vazia)");
            sel.appendChild(opt);
        });
        if (current) sel.value = current;
    });
}

// Aplicar SFX no CTI atual
function applySfxAtCti() {
    if (!SFX_SELECTED) { toast("Selecione um SFX primeiro", "warn"); return; }
    jsx("$.global.EP_getCTI();", function (cti) {
        if (!cti || !cti.ticks) { toast("Sem CTI ativo", "warn"); return; }
        var track = $("sfx-apply-track") && $("sfx-apply-track").value;
        if (!track) track = "auto";
        log("🔊 Aplicando SFX no CTI · track=" + track, "info");
        placeSfxBatch([cti.ticks], track);
    });
}

// Aplicar SFX em todos os clips da última track de vídeo (legendas)
function applySfxAtAllLegendas() {
    if (!SFX_SELECTED) { toast("Selecione um SFX primeiro", "warn"); return; }
    var track = $("sfx-apply-track") && $("sfx-apply-track").value;
    if (!track) track = "auto";
    // Pega ticks dos clips na última track de vídeo via JSX
    var sniffScript =
        "(function(){try{var s=app.project.activeSequence;if(!s)return JSON.stringify({error:'no_seq'});" +
        "var n=s.videoTracks.numTracks;var last=null;" +
        "for(var i=n-1;i>=0;i--){if(s.videoTracks[i].clips.numItems>0){last=s.videoTracks[i];break;}}" +
        "if(!last)return JSON.stringify({error:'sem_clips_de_legenda'});" +
        "var out=[]; for(var c=0;c<last.clips.numItems;c++){out.push(String(last.clips[c].start.ticks));}" +
        "return JSON.stringify({ok:true,ticks:out,trackIndex:n-1});}catch(e){return JSON.stringify({error:e.message});}})();";
    jsx(sniffScript, function (d) {
        if (d.error) { toast("Erro: " + d.error, "err"); return; }
        if (!d.ticks || !d.ticks.length) { toast("Sem clips de legenda na timeline", "warn"); return; }

        // Guarda contra travamento Premiere: > 80 clips em uma rajada bug GPU em
        // videos grandes (relato real: 3min/16GB GPU travou). Avisa user + sugere
        // alternativa (aplicar selecionado em CTI um por um).
        var n = d.ticks.length;
        var HARD_LIMIT = 200;   // acima disso, recusa
        var SOFT_LIMIT = 80;    // entre 80-200, confirma
        if (n > HARD_LIMIT) {
            toast(
                n + " legendas é demais. Premiere trava acima de " + HARD_LIMIT + ". " +
                "Selecione só um trecho da timeline e use 'Aplicar no CTI'.",
                "err", 7000
            );
            log("✗ SFX-em-todas BLOQUEADO: " + n + " clips > " + HARD_LIMIT, "err");
            return;
        }
        if (n > SOFT_LIMIT) {
            var ok = confirm(
                "⚠ Atenção: " + n + " SFX serão inseridos na timeline.\n\n" +
                "Premiere pode ficar lento ou travar (depende da placa/CPU).\n" +
                "Recomendado: aplicar em trecho menor por vez.\n\n" +
                "Continuar mesmo assim?"
            );
            if (!ok) { log("SFX-em-todas cancelado pelo user", "info"); return; }
        }

        log("🔊 Aplicando SFX em " + n + " legendas · track=" + track, "info");
        placeSfxBatch(d.ticks, track);
    });
}

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

    var sfx = SFX_LIBRARY[SFX_SELECTED];
    if (!sfx) { log("SFX inválido: " + SFX_SELECTED, "err"); return; }

    function importNow(filePath) {
        jsx("$.global.MotionProLegendas.importAudioFile(" +
            JSON.stringify(filePath) + "," +
            JSON.stringify(JSON.stringify(positions)) + "," +
            JSON.stringify(audioTrack) + ");",
        function (d) {
            if (d.error) { log("✗ SFX: " + d.error, "err"); openLog(); toast("Erro SFX: " + d.error, "err", 4000); }
            else {
                log("✓ SFX " + sfx.name + " em " + d.track + " (" + d.placed + "/" + positions.length + ")", "info");
                toast("✓ SFX aplicado em " + d.placed + " pontos", "ok", 3000);
            }
        });
    }

    // ── SFX REAL: arquivo direto do disco
    if (sfx.source === "real" && sfx.filePath) {
        log("🔊 SFX (arquivo real): " + sfx.filePath, "info");
        importNow(sfx.filePath);
        return;
    }

    // ── SFX SINTÉTICO: renderiza WAV via Web Audio offline + salva em tmp
    log("🔊 SFX (sintético): renderizando " + SFX_SELECTED + " offline…");
    var p = offlineRenderSfx(SFX_SELECTED);
    if (!p) { log("OfflineAudioContext indisponível", "warn"); return; }
    p.then(function (blob) {
        var fr = new FileReader();
        fr.onload = function () {
            var buf = new Uint8Array(fr.result);
            var tmp = nodeOs.tmpdir() + nodePath.sep + "mpl_sfx_" + SFX_SELECTED.replace(/[^a-z0-9]/gi,"_") + ".wav";
            try { nodeFs.writeFileSync(tmp, Buffer.from(buf)); } catch (e) { log("✗ write SFX: " + e.message, "err"); return; }
            importNow(tmp);
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

                // [6] Se um template está selecionado, INSPECIONA pra ver props (CDN-aware)
                if (SELECTED && (SELECTED.mogrt || SELECTED.cdn_key)) {
                    log("[6] Inspecionando MOGRT: " + SELECTED.name);
                    resolveMogrtPath(SELECTED).then(function (abs) {
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
                    }).catch(function (e) {
                        log("✗ resolveMogrt inspect: " + e.message, "err");
                        if (btn) { btn.className = "btn-diag err"; btn.textContent = "✗"; }
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

    // Fechar preview inline
    var pc = $("preview-close"); if (pc) pc.onclick = hidePreview;

    // ── ABA SFX ──
    var sfxSearch = $("sfx-search-input");
    if (sfxSearch) sfxSearch.oninput = renderSfxGrid;
    var sfxAplyCti = $("btn-sfx-apply-cti");
    if (sfxAplyCti) sfxAplyCti.onclick = applySfxAtCti;
    var sfxAplyAll = $("btn-sfx-apply-all");
    if (sfxAplyAll) sfxAplyAll.onclick = applySfxAtAllLegendas;
    // popula tracks ao trocar pra aba SFX
    var sfxTabBtn = document.querySelector('.tab-btn[data-tab="tab-sfx"]');
    if (sfxTabBtn) sfxTabBtn.addEventListener("click", function () {
        populateSfxApplyTracks();
        if (!Object.keys(SFX_LIBRARY).filter(function (k) { return SFX_LIBRARY[k].source === "real"; }).length) {
            // Faz scan na 1ª vez que abrir a aba (caso user tenha dropado arquivos depois)
            scanRealSfx();
            renderSfxCategories();
            renderSfxGrid();
        }
    });

    // 🔍 DIAGNOSE template selecionado (importa, lista slots detectados, remove)
    var diag = $("btn-tpl-diagnose");
    if (diag) diag.onclick = function () {
        if (!SELECTED || (!SELECTED.mogrt && !SELECTED.cdn_key)) { toast("Selecione um template", "warn"); return; }
        openLog();
        log("🔍 Diagnosticando template: " + SELECTED.name, "info");
        diag.disabled = true;
        resolveMogrtPath(SELECTED).then(function (abs) {
        jsx("$.global.EP_diagnoseTemplateSlots(" + JSON.stringify(abs) + ");", function (d) {
            diag.disabled = false;
            if (d.error) { log("✗ " + d.error, "err"); toast("Erro: " + d.error, "err"); return; }
            log("  📊 slots detectados: " + d.slotsDetected, "info");
            log("  📊 mode: " + d.mode, "info");
            if (d.slotNames && d.slotNames.length) {
                d.slotNames.forEach(function (s, i) {
                    log("    P" + (i+1) + " · " + s, "info");
                });
            }
            if (d.allMasterProps && d.allMasterProps.length) {
                log("  📋 todas as props master (" + d.allMasterProps.length + "):", "info");
                d.allMasterProps.forEach(function (p) {
                    var val = p.value || "";
                    if (val.length > 50) val = val.substring(0, 50) + "…";
                    log("    [" + p.idx + "] " + p.displayName + " = " + val, "info");
                });
            }
            toast("✓ " + d.slotsDetected + " slots detectados — veja LOG", "ok", 4000);
        });
        }).catch(function (e) {
            diag.disabled = false;
            log("✗ resolveMogrt diagnose: " + e.message, "err");
            toast("Falha ao obter MOGRT: " + e.message, "err", 5000);
        });
    };

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

    // ── CUT CONFIG (estilo Premiere) — load/save/listen
    loadCutOpts();
    bindCutOpts();
    // Re-cortar automaticamente quando user muda os limites E já tem SRT carregado
    ["cut-oneword","cut-layout","cut-max-chars","cut-min-dur","cut-gap-frames"].forEach(function (id) {
        var el = $(id); if (!el) return;
        el.addEventListener("change", function () {
            if (SRT_DATA && SRT_DATA.length) {
                // re-aplica distribuição inteligente com novos limites
                applySmartDistribution();
            }
        });
    });

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

    // ── ESTILO GLOBAL: hidrata UI + wire eventos (templates populados depois do catálogo)
    loadGlobalStyle();
    bindGlobalStyleUI();

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
    loadSlotInfo();
    scanRealSfx();
    renderSfxCategories();
    renderSfxGrid();
    reloadHostJsx(function () {
        setStatus("Pronto.");
        // depois do JSX carregar, descobre fps da sequência ativa
        detectSeqFps();
    });
    updateApplyFooter();   // estado inicial
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
} else { bind(); }

})();
