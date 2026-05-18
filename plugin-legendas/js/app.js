/* MotionPro Legendas — painel CEP
 *
 * Reusa toda a arquitetura de auth do MotionPro:
 *  - Login/signup inline
 *  - Trial bar com countdown
 *  - Banner de verificação de email
 *  - Paywall com botão pra browser
 *
 * UI específica: navega packs → categorias → títulos → insere na timeline.
 */
"use strict";

(function () {

var $ = function (id) { return document.getElementById(id); };
var fs = require("fs");
var nodePath = require("path");
var cs = new CSInterface();

// ============================================================ paths
function normalizeExtPath(p) {
    if (!p) return ".";
    return decodeURI(p).replace(/^file:[\\\/]+/i, "").replace(/\//g, "\\");
}
var EXT_PATH = normalizeExtPath(cs.getSystemPath(CSInterface.SystemPath.EXTENSION));

// ============================================================ config
var API_BASE     = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl)   || "https://motionpro.vercel.app";
var PRODUCT_ID   = (window.MV_CONFIG && window.MV_CONFIG.productId)    || "legendas";
var PRODUCT_NAME = (window.MV_CONFIG && window.MV_CONFIG.productName)  || "MotionPro Legendas";
var LANDING_URL  = (window.MV_CONFIG && window.MV_CONFIG.landingUrl)   || "https://motionpro-lp.vercel.app";
var PRICING_URL  = (window.MV_CONFIG && window.MV_CONFIG.pricingUrl)   || (LANDING_URL + "/legendas/#pricing");
var DEV_BYPASS   = (window.MV_CONFIG && window.MV_CONFIG.devMode === true);

// ============================================================ helpers UI
function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}
function toast(text, kind, ms) {
    var t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2200);
}
function openInBrowser(url) {
    try {
        if (typeof CSInterface !== "undefined") {
            var ci = new CSInterface();
            ci.openURLInDefaultBrowser(url);
            return true;
        }
    } catch (_) {}
    try {
        if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
            window.cep.util.openURLInDefaultBrowser(url);
            return true;
        }
    } catch (_) {}
    try { window.open(url, "_blank"); return true; } catch (_) {}
    toast("Cole no navegador: " + url, "warn", 5000);
    return false;
}

// ============================================================ catalog (packs)
var CATALOG = null;
var INDEX = [];

function loadCatalog() {
    try {
        var file = nodePath.join(EXT_PATH, "packs", "catalog.json");
        if (fs.existsSync(file)) {
            var raw = fs.readFileSync(file, "utf8");
            if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);    // strip BOM
            CATALOG = JSON.parse(raw);
        } else {
            CATALOG = { packs: [], total_items: 0 };
        }
        window.CATALOG_LEGENDAS = CATALOG;  // expõe pro editor.js
        return true;
    } catch (e) {
        console.error("loadCatalog fail:", e);
        CATALOG = { packs: [], total_items: 0 };
        window.CATALOG_LEGENDAS = CATALOG;
        return false;
    }
}

function buildIndex() {
    INDEX = [];
    (CATALOG.packs || []).forEach(function (p) { walk(p.categories || [], p, []); });
}
function walk(nodes, pack, crumb) {
    nodes.forEach(function (n) {
        if (n.items) n.items.forEach(function (it) {
            INDEX.push({ pack: pack, cat: crumb.concat(n.name).join(" › "), item: it });
        });
        if (n.children) walk(n.children, pack, crumb.concat(n.name));
    });
}
function countItems(node) {
    var n = node.items ? node.items.length : 0;
    if (node.children) node.children.forEach(function (c) { n += countItems(c); });
    return n;
}
function countPackItems(p) {
    return (p.categories || []).reduce(function (a, c) { return a + countItems(c); }, 0);
}

// ============================================================ favorites
var FAVS = (function () {
    try { return JSON.parse(localStorage.getItem("mvl_favs") || "[]"); }
    catch (e) { return []; }
})();
function favSave() { try { localStorage.setItem("mvl_favs", JSON.stringify(FAVS)); } catch (e) {} }
function favKey(item) { return item.mogrt || item.preview || item.name; }
function isFav(item) { return FAVS.indexOf(favKey(item)) >= 0; }
function toggleFav(item) {
    var k = favKey(item), i = FAVS.indexOf(k);
    if (i >= 0) FAVS.splice(i, 1); else FAVS.push(k);
    favSave();
}

// ============================================================ state
var STATE = {
    pack: null,
    catPath: [],
    expanded: {},
    search: "",
    page: 0,
    pageSize: 60,
    wordsFilter: null,    // null = todos, "1"/"2"/"3" = filtra por palavras
    items: []
};
window.LegendasState = STATE;

// ============================================================ UI: tabs
function renderTabs() {
    var el = $("tabs"); el.innerHTML = "";
    (CATALOG.packs || []).forEach(function (p) {
        var t = document.createElement("div");
        t.className = "tab";
        t.dataset.id = p.id;
        t.innerHTML = '<span>' + esc(p.name) + '</span><span class="tab__count">' + countPackItems(p) + '</span>';
        t.onclick = function () { selectPack(p.id); };
        el.appendChild(t);
    });
    if (CATALOG.packs && CATALOG.packs.length === 0) {
        $("status").textContent = "Nenhum pack instalado · re-instale o plugin pra incluir os packs";
    }
}

function selectPack(id) {
    STATE.pack = id; STATE.catPath = []; STATE.search = ""; STATE.page = 0;
    STATE.expanded = {};
    $("q").value = ""; $("q-clear").classList.add("hidden");
    [].forEach.call(document.querySelectorAll(".tab"), function (t) {
        t.classList.toggle("on", t.dataset.id === id);
    });
    renderSide(); renderGrid(); renderBreadcrumb();
}

function packById(id) {
    for (var i = 0; i < (CATALOG.packs || []).length; i++) if (CATALOG.packs[i].id === id) return CATALOG.packs[i];
    return null;
}

// ============================================================ UI: breadcrumb
function renderBreadcrumb() {
    var el = $("breadcrumb"); el.innerHTML = "";
    var crumbs = [];
    if (STATE.search) {
        crumbs.push({ label: 'Busca: "' + STATE.search + '"', last: true });
    } else if (STATE.pack === "__favs__") {
        crumbs.push({ label: "★ Favoritos", last: true });
    } else {
        var p = packById(STATE.pack);
        if (p) crumbs.push({ label: p.name, last: !STATE.catPath.length });
        STATE.catPath.forEach(function (c, i) {
            crumbs.push({ label: c, last: i === STATE.catPath.length - 1 });
        });
    }
    crumbs.forEach(function (c, i) {
        if (i > 0) {
            var sep = document.createElement("span");
            sep.className = "crumb__sep"; sep.textContent = "›";
            el.appendChild(sep);
        }
        var s = document.createElement("span");
        s.className = "crumb" + (c.last ? " last" : "");
        s.textContent = c.label;
        el.appendChild(s);
    });
}

// ============================================================ UI: sidebar
function renderSide() {
    var el = $("side"); el.innerHTML = "";
    if (STATE.pack === "__favs__") return;
    var p = packById(STATE.pack); if (!p) return;
    (p.categories || []).forEach(function (root) { renderCat(root, 0, [], el); });
}
function renderCat(node, depth, crumb, container) {
    var path = crumb.concat(node.name);
    var pathKey = path.join("/");
    var hasChildren = !!(node.children && node.children.length);
    var count = countItems(node);

    var d = document.createElement("div");
    d.className = "cat " + (depth === 0 ? "cat--root" : "cat--child");
    var isActive = STATE.catPath.join("/") === pathKey;
    if (isActive) d.classList.add("on");
    d.innerHTML = '<span class="cat__chev">' + (hasChildren ? '▸' : '·') + '</span>' +
                  '<span class="cat__name">' + esc(node.name) + '</span>' +
                  '<span class="cat__num">' + count + '</span>';
    d.onclick = function (e) {
        e.stopPropagation();
        STATE.catPath = path; STATE.page = 0;
        renderSide(); renderGrid(); renderBreadcrumb();
    };
    container.appendChild(d);

    if (hasChildren && (STATE.expanded[pathKey] || isActive || STATE.catPath.join("/").indexOf(pathKey) === 0)) {
        STATE.expanded[pathKey] = true;
        node.children.forEach(function (c) { renderCat(c, depth + 1, path, container); });
    }
}

// ============================================================ UI: grid
function collectItems() {
    var out = [];
    if (STATE.search) {
        var q = STATE.search.toLowerCase();
        INDEX.forEach(function (e) {
            if (e.item.name.toLowerCase().indexOf(q) >= 0) out.push(e);
        });
        return out;
    }
    if (STATE.pack === "__favs__") {
        INDEX.forEach(function (e) { if (isFav(e.item)) out.push(e); });
        return out;
    }
    // Filtro de palavras (1, 2 ou 3+)
    if (STATE.wordsFilter) {
        var wf = Number(STATE.wordsFilter);
        INDEX.forEach(function (e) {
            var n = e.item.name.trim().split(/\s+/).length;
            if (wf === 3 ? n >= 3 : n === wf) out.push(e);
        });
        return out;
    }
    // Default: todos os items (Geral)
    return INDEX.slice();
}

// ============================================================ MOCKUP SVG GEN
// Gera preview visual realista por categoria (sem precisar renderizar mogrt)
function categoryStyle(catName) {
    var c = String(catName).toLowerCase();
    if (c.indexOf("simple") >= 0)    return { bg: "#0a0a0a", fg: "#fff",     font: "Inter,sans-serif",  weight: 700, align: "center",  size: 28, kind: "title" };
    if (c.indexOf("fashion") >= 0)   return { bg: "#1a0a14", fg: "#ffd9e6",   font: "Playfair Display,serif", weight: 400, align: "center", size: 26, kind: "fashion" };
    if (c.indexOf("urban") >= 0)     return { bg: "#1a1a1a", fg: "#ffeb3b",   font: "Impact,sans-serif", weight: 900, align: "left",   size: 30, kind: "urban" };
    if (c.indexOf("glitch") >= 0)    return { bg: "#000",    fg: "#0ff",      font: "Courier,monospace", weight: 700, align: "center", size: 26, kind: "glitch" };
    if (c.indexOf("huge") >= 0)      return { bg: "#0a0a0a", fg: "#fff",      font: "Inter,sans-serif",  weight: 900, align: "center", size: 36, kind: "huge" };
    if (c.indexOf("minimal") >= 0)   return { bg: "#fafafa", fg: "#0a0a0a",   font: "Inter,sans-serif",  weight: 300, align: "center", size: 22, kind: "minimal" };
    if (c.indexOf("wedding") >= 0)   return { bg: "#f5ede0", fg: "#3a2820",   font: "Playfair Display,serif", weight: 400, align: "center", size: 24, kind: "wedding" };
    if (c.indexOf("elegant") >= 0)   return { bg: "#16161a", fg: "#d4af37",   font: "Playfair Display,serif", weight: 500, align: "center", size: 24, kind: "elegant" };
    if (c.indexOf("corporate") >= 0) return { bg: "#1a2540", fg: "#fff",      font: "Inter,sans-serif",  weight: 600, align: "left",   size: 24, kind: "corporate" };
    if (c.indexOf("lower") >= 0)     return { bg: "#1a1a20", fg: "#fff",      font: "Inter,sans-serif",  weight: 600, align: "left",   size: 18, kind: "lowerthird" };
    return { bg: "#1a1a20", fg: "#fff", font: "Inter,sans-serif", weight: 600, align: "center", size: 24, kind: "title" };
}

function shortenTitle(name) {
    // "Simple Title_01" → "Simple Title"
    var s = String(name).replace(/[_\-\s]+\d+$/, "").trim();
    if (s.length > 20) s = s.slice(0, 18) + "…";
    return s;
}

function categoryWords(cat) {
    // Palavras de exemplo por categoria pra mostrar nos previews
    var c = String(cat || "").toLowerCase();
    if (c.indexOf("simple") >= 0)    return ["Simple Title", "Preciso", "Agora"];
    if (c.indexOf("fashion") >= 0)   return ["FASHION", "Style", "Vogue"];
    if (c.indexOf("urban") >= 0)     return ["URBAN", "Street", "Vibe"];
    if (c.indexOf("glitch") >= 0)    return ["GLITCH", "ERROR", "404"];
    if (c.indexOf("huge") >= 0)      return ["HUGE", "BIG TEXT", "IMPACT"];
    if (c.indexOf("minimal") >= 0)   return ["minimal", "less is more", "clean"];
    if (c.indexOf("wedding") >= 0)   return ["Forever", "Love", "Wedding"];
    if (c.indexOf("elegant") >= 0)   return ["Elegant", "Luxury", "Royal"];
    if (c.indexOf("corporate") >= 0) return ["Corporate", "Business", "Pro"];
    if (c.indexOf("lower") >= 0)     return ["João Silva\nCEO · MotionPro", "Maria\nDesigner", "Nome\nCargo"];
    return ["Title", "Texto", "Demo"];
}

function mockupSvg(name, catPath) {
    var lastCat = (catPath || "").split(/[ ›\/]+/).filter(Boolean).pop() || "";
    var s = categoryStyle(lastCat);
    var label = shortenTitle(name);
    var W = 240, H = 135;   // 16:9
    var content = "";

    if (s.kind === "glitch") {
        // 3 cópias deslocadas pra simular RGB glitch
        var ts = function(c, dx) { return '<text x="' + (W/2+dx) + '" y="' + (H/2+8) + '" fill="' + c + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="' + s.size + '" text-anchor="middle" letter-spacing="1.5">' + escapeXml(label.toUpperCase()) + '</text>'; };
        content = ts("#ff0080", -3) + ts("#00ffff", 3) + ts("#fff", 0);
    } else if (s.kind === "lowerthird") {
        // Barra inferior + texto e linha
        content =
            '<rect x="14" y="' + (H - 50) + '" width="' + (W - 28) + '" height="34" fill="' + s.bg + '" stroke="' + s.fg + '" stroke-width="1" opacity="0.95"/>' +
            '<rect x="14" y="' + (H - 50) + '" width="4" height="34" fill="' + s.fg + '"/>' +
            '<text x="28" y="' + (H - 30) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="13">' + escapeXml(label) + '</text>' +
            '<text x="28" y="' + (H - 17) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="400" font-size="9" opacity="0.6">SUBTITLE / CARGO</text>';
    } else if (s.kind === "urban") {
        // Texto torto + traços
        content =
            '<g transform="rotate(-4 ' + (W/2) + ' ' + (H/2) + ')">' +
            '<rect x="20" y="' + (H/2 - 5) + '" width="' + (W - 40) + '" height="4" fill="' + s.fg + '"/>' +
            '<text x="20" y="' + (H/2 - 12) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="' + s.size + '" letter-spacing="2">' + escapeXml(label.toUpperCase()) + '</text>' +
            '</g>';
    } else if (s.kind === "wedding" || s.kind === "elegant") {
        // Linha fina decorativa
        var lineY = H/2 + 22;
        content =
            '<text x="' + (W/2) + '" y="' + (H/2 + 4) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="' + s.size + '" text-anchor="middle" font-style="italic">' + escapeXml(label) + '</text>' +
            '<line x1="' + (W/2 - 30) + '" y1="' + lineY + '" x2="' + (W/2 + 30) + '" y2="' + lineY + '" stroke="' + s.fg + '" stroke-width="0.6"/>' +
            '<circle cx="' + (W/2) + '" cy="' + lineY + '" r="1.6" fill="' + s.fg + '"/>';
    } else if (s.kind === "huge") {
        content = '<text x="' + (W/2) + '" y="' + (H/2 + 12) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="' + s.size + '" text-anchor="middle" letter-spacing="-1">' + escapeXml(label.toUpperCase()) + '</text>';
    } else if (s.kind === "minimal") {
        content =
            '<line x1="' + (W/2 - 15) + '" y1="' + (H/2 - 18) + '" x2="' + (W/2 + 15) + '" y2="' + (H/2 - 18) + '" stroke="' + s.fg + '" stroke-width="1"/>' +
            '<text x="' + (W/2) + '" y="' + (H/2 + 8) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="' + s.size + '" text-anchor="middle" letter-spacing="3">' + escapeXml(label.toLowerCase()) + '</text>';
    } else if (s.kind === "corporate") {
        content =
            '<rect x="20" y="' + (H/2 - 18) + '" width="4" height="36" fill="' + s.fg + '"/>' +
            '<text x="32" y="' + (H/2 + 2) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="' + s.size + '">' + escapeXml(label) + '</text>' +
            '<text x="32" y="' + (H/2 + 18) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="400" font-size="10" opacity="0.6">CORPORATE</text>';
    } else if (s.kind === "fashion") {
        content =
            '<text x="' + (W/2) + '" y="' + (H/2 + 8) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="' + s.size + '" text-anchor="middle" letter-spacing="4">' + escapeXml(label.toUpperCase()) + '</text>';
    } else {
        content = '<text x="' + (W/2) + '" y="' + (H/2 + 8) + '" fill="' + s.fg + '" font-family="' + s.font + '" font-weight="' + s.weight + '" font-size="' + s.size + '" text-anchor="middle">' + escapeXml(label) + '</text>';
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">' +
           '<rect width="' + W + '" height="' + H + '" fill="' + s.bg + '"/>' +
           content +
           '</svg>';
}

function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, function (c) {
        return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

var SELECTED_ITEM_KEY = null;
var SELECTED_ITEM = null;  // {item, cat} — usado pelo botão APLICAR do footer
window.LegendasRenderGrid = function () { renderGrid(); };
window.LegendasGetSelected = function () { return SELECTED_ITEM; };
window.LegendasInsertItem = function (item) { return insertItem(item); };
window.LegendasResolveMogrtPath = function (rel) {
    return rel ? nodePath.join(EXT_PATH, "packs", rel) : null;
};
function renderGrid() {
    var el = $("grid"); if (!el) return;
    el.innerHTML = "";
    var items = collectItems();
    var page = items.slice(0, (STATE.page + 1) * STATE.pageSize);

    page.forEach(function (e, i) {
        var globalIdx = i + 1;
        var card = document.createElement("div");
        card.className = "card";
        // data-cat dispara animação correta no hover (ver editor-extras.css)
        card.setAttribute("data-cat", (e.cat || "") + " " + (e.item && e.item.name ? String(e.item.name).toLowerCase() : ""));
        if (SELECTED_ITEM_KEY === favKey(e.item)) card.classList.add("selected");
        var fav = isFav(e.item) ? "on" : "";
        var preview = e.item.preview ? nodePath.join(EXT_PATH, "packs", e.item.preview) : null;
        // Palavra de exemplo varia por card (rotaciona entre 3 opções da categoria)
        var words = (typeof categoryWords === "function") ? categoryWords(e.cat) : ["Title"];
        var sampleWord = words[i % words.length];
        var thumbHtml = preview
            ? '<img loading="lazy" src="' + esc("file:///" + preview.replace(/\\/g, "/")) + '">'
            : (typeof mockupSvg === "function" ? mockupSvg(sampleWord, e.cat) : '<div class="card__placeholder">' + esc(sampleWord) + '</div>');
        var label = "Texto " + String(globalIdx).padStart(2, "0");
        card.innerHTML =
            '<div class="card__thumb">' + thumbHtml +
                '<button class="card__fav ' + fav + '" title="Favoritar">★</button>' +
            '</div>' +
            '<div class="card__title" title="' + esc(e.item.name) + '">' + label + '</div>';
        // Click = seleciona (preview + habilita APLICAR). Duplo-clique = insere já.
        card.onclick = function () {
            SELECTED_ITEM_KEY = favKey(e.item);
            SELECTED_ITEM = { item: e.item, cat: e.cat };
            renderGrid();
            updatePreviewSlot(e.item, e.cat);
            // habilita APLICAR no footer
            var btn = document.getElementById("btn-aplicar");
            if (btn) { btn.disabled = false; btn.textContent = "APLICAR · " + (e.item.name || "template"); }
            // atualiza select da automação pra refletir o item selecionado
            var auto = document.getElementById("auto-template");
            if (auto) {
                for (var i = 0; i < auto.options.length; i++) {
                    if (auto.options[i].value === e.item.name) { auto.selectedIndex = i; break; }
                }
            }
        };
        card.ondblclick = function () { insertItem(e.item); };
        card.querySelector(".card__fav").onclick = function (ev) {
            ev.stopPropagation(); toggleFav(e.item); renderGrid();
        };
        el.appendChild(card);
    });

    if (items.length > page.length) {
        var more = document.createElement("div");
        more.style.cssText = "grid-column:1/-1;padding:10px;text-align:center";
        more.innerHTML = '<button style="background:var(--bg3);color:var(--txt);padding:8px 16px;border-radius:5px;font:600 11px Inter">Carregar mais (' + (items.length - page.length) + ')</button>';
        more.querySelector("button").onclick = function () { STATE.page++; renderGrid(); };
        el.appendChild(more);
    }
    if (items.length === 0) {
        el.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--mut)">Nenhum template encontrado</div>';
    }

    // Atualiza contagem de palavras na sidebar
    updateWordCounts();
}

function updatePreviewSlot(item, cat) {
    var slot = $("preview-slot"); if (!slot) return;
    var preview = item.preview ? nodePath.join(EXT_PATH, "packs", item.preview) : null;
    var thumb = preview
        ? '<img style="max-width:100%;max-height:100%;object-fit:contain" src="' + esc("file:///" + preview.replace(/\\/g, "/")) + '">'
        : (typeof mockupSvg === "function" ? mockupSvg(item.name, cat) : '<span class="muted">' + esc(item.name) + '</span>');
    slot.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden">' + thumb + '</div>';
}

function updateWordCounts() {
    if (!CATALOG || !CATALOG.packs) return;
    var counts = { 1: 0, 2: 0, 3: 0 };
    INDEX.forEach(function (e) {
        var words = e.item.name.trim().split(/\s+/).length;
        if (words === 1) counts[1]++;
        else if (words === 2) counts[2]++;
        else counts[3]++;
    });
    var c1 = $("cnt-1"), c2 = $("cnt-2"), c3 = $("cnt-3");
    if (c1) c1.textContent = counts[1];
    if (c2) c2.textContent = counts[2];
    if (c3) c3.textContent = counts[3];
}

// ============================================================ insert
function insertItem(item) {
    if (!item.mogrt) { toast("Item sem .mogrt path", "err"); return; }
    var abs = nodePath.join(EXT_PATH, "packs", item.mogrt);
    var jsx = 'MotionProLegendas.importMogrt(' + JSON.stringify(abs) + ');';
    cs.evalScript(jsx, function (r) {
        try {
            var d = JSON.parse(r);
            if (d.error) {
                toast("Erro: " + d.error, "err", 4500);
                // Auto-abre log + escreve detalhes
                var lb = document.getElementById("log-body"); if (lb) lb.style.display = "block";
                var lh = document.getElementById("log-head"); if (lh) { var a = lh.querySelector(".logbar__arrow"); if (a) a.textContent = "▲"; }
                console.error("[INSERT FAIL]", item.name, "→", d.error, "path:", abs);
                var div = document.createElement("div"); div.className = "log-line";
                div.style.color = "#ff5566";
                div.textContent = "[INSERT ✗] " + item.name + " → " + d.error;
                if (lb) lb.appendChild(div);
            } else {
                toast("✓ " + (d.name || item.name) + " · V" + ((d.track||0)+1), "ok");
            }
        } catch (e) {
            toast("Falha — clique no botão TESTAR", "err", 5000);
            console.error("[INSERT PARSE FAIL]", r, e);
            var lb2 = document.getElementById("log-body"); if (lb2) lb2.style.display = "block";
            var div2 = document.createElement("div"); div2.className = "log-line";
            div2.style.color = "#ff5566";
            div2.textContent = "[INSERT ✗ parse] resposta bruta = " + String(r).slice(0, 200);
            if (lb2) lb2.appendChild(div2);
        }
    });
}

// ============================================================ search
$("q").addEventListener("input", function (e) {
    STATE.search = e.target.value.trim();
    STATE.page = 0;
    $("q-clear").classList.toggle("hidden", !STATE.search);
    renderGrid(); renderBreadcrumb();
});
$("q-clear").addEventListener("click", function () {
    $("q").value = ""; STATE.search = "";
    $("q-clear").classList.add("hidden");
    renderGrid(); renderBreadcrumb();
});
$("btn-favorites").addEventListener("click", function () { selectPack("__favs__"); });

// ============================================================ AUTH (idêntico ao MotionPro)
function gateApi(path, body) {
    var token = localStorage.getItem("mv_session");
    return fetch(API_BASE + path, {
        method: body ? "POST" : "GET",
        headers: Object.assign(
            { "Content-Type": "application/json" },
            token ? { "Authorization": "Bearer " + token } : {}
        ),
        body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
        return r.json().then(function (data) {
            if (!r.ok) throw (data && data.error) || ("http_" + r.status);
            return data;
        });
    });
}

function computeFingerprint() {
    var os = (typeof require === "function") ? require("os") : null;
    var parts = [];
    if (os) {
        parts.push(os.hostname()); parts.push(os.platform()); parts.push(os.arch());
        parts.push(String(os.totalmem()));
        try { parts.push(os.userInfo().username); } catch (e) {}
        var ifaces = os.networkInterfaces();
        var macs = [];
        for (var k in ifaces) {
            ifaces[k].forEach(function (i) {
                if (i.mac && i.mac !== "00:00:00:00:00:00") macs.push(i.mac);
            });
        }
        macs.sort(); parts.push(macs.join("|"));
    }
    parts.push(navigator.userAgent.substr(0, 60));
    parts.push(String(screen.width) + "x" + String(screen.height));
    var s = parts.join("::");
    var h1 = 0xdeadbeef >>> 0, h2 = 0x41c6ce57 >>> 0;
    for (var i = 0; i < s.length; i++) {
        h1 = Math.imul(h1 ^ s.charCodeAt(i), 2654435761) >>> 0;
        h2 = Math.imul(h2 ^ s.charCodeAt(i), 1597334677) >>> 0;
    }
    return h1.toString(16).padStart(8,"0") + h2.toString(16).padStart(8,"0") + s.length.toString(16);
}

function showGate(mode) {
    var g = $("gate"); if (!g) return;
    g.classList.remove("hidden");
    setGateMode(mode || "login");
}
function hideGate() { var g = $("gate"); if (g) g.classList.add("hidden"); }
function setGateMode(mode) {
    var isSignup = mode === "signup";
    $("gt-login").classList.toggle("active", !isSignup);
    $("gt-signup").classList.toggle("active", isSignup);
    $("g-submit").textContent = isSignup ? "Criar conta · iniciar 14 dias grátis" : "Entrar";
    $("g-msg").textContent = ""; $("g-msg").className = "gate__msg";
    $("g-submit").dataset.mode = mode;
    [].forEach.call(document.querySelectorAll(".signup-only"), function (el) { el.hidden = !isSignup; });
    $("g-password").autocomplete = isSignup ? "new-password" : "current-password";
}

function bindGate() {
    if (!$("gt-login")) return;
    $("gt-login").onclick = function () { setGateMode("login"); };
    $("gt-signup").onclick = function () { setGateMode("signup"); };
    $("g-forgot").onclick = function (e) {
        e.preventDefault();
        var email = $("g-email").value.trim();
        var url = LANDING_URL + "/reset-password.html" + (email ? "?email=" + encodeURIComponent(email) : "");
        openInBrowser(url);
        $("g-msg").textContent = "✓ Página de recuperação aberta no navegador";
        $("g-msg").className = "gate__msg ok";
    };
    $("g-submit").onclick = async function () {
        var mode = $("g-submit").dataset.mode || "login";
        var email = $("g-email").value.trim().toLowerCase();
        var password = $("g-password").value;
        var name = $("g-name").value.trim();
        var phone = $("g-phone").value.trim();
        var optin = $("g-optin").checked;
        var msg = $("g-msg"), sub = $("g-submit");
        if (!email || password.length < 8) { msg.textContent = "Email e senha (mín 8) obrigatórios"; return; }
        if (mode === "signup" && name.length < 2) { msg.textContent = "Digite seu nome completo"; return; }
        sub.disabled = true; msg.textContent = "Conectando..."; msg.className = "gate__msg";
        try {
            var fp = computeFingerprint();
            var payload = { email: email, password: password, fingerprint: fp };
            if (mode === "signup") {
                payload.name = name; payload.phone = phone || null; payload.marketing_optin = optin;
            }
            var data = await gateApi("/v1/auth/" + mode, payload);
            localStorage.setItem("mv_session", data.session_token);
            localStorage.setItem("mv_email", email);
            // issue license PARA O PRODUTO LEGENDAS
            var lic = await gateApi("/v1/license/issue", { fingerprint: fp, product_id: PRODUCT_ID });
            localStorage.setItem("mvl_license", lic.license);
            localStorage.setItem("mvl_plan", lic.plan);
            localStorage.setItem("mvl_status", lic.status || "");
            localStorage.setItem("mvl_expires", lic.expires_at || "");
            localStorage.setItem("mvl_via_bundle", lic.covers_via_bundle ? "true" : "false");
            if (mode === "signup") {
                localStorage.setItem("mvl_email_verified", "false");
                localStorage.removeItem("mvl_verify_dismissed_until");
                if (name) localStorage.setItem("mv_name", name);
            } else {
                setTimeout(checkEmailVerified, 800);
            }
            msg.textContent = "✓ " + (mode === "signup" ? "Conta criada! Trial de 14 dias ativo." : "Bem-vindo!");
            msg.className = "gate__msg ok";
            setTimeout(function () { hideGate(); updateTrialUI(); updateVerifyBar(); }, 500);
        } catch (e) {
            msg.textContent = "Erro: " + (typeof e === "string" ? e : (e.message || "falha"));
            msg.className = "gate__msg";
        }
        sub.disabled = false;
    };
}

// ============================================================ trial bar + paywall
function daysBetween(future) {
    if (!future) return null;
    var d = (new Date(future) - new Date()) / (1000*60*60*24);
    return Math.max(0, Math.ceil(d));
}
function updateTrialUI() {
    var plan = localStorage.getItem("mvl_plan") || "";
    var status = localStorage.getItem("mvl_status") || "";
    var expires = localStorage.getItem("mvl_expires") || "";
    var viaBundle = localStorage.getItem("mvl_via_bundle") === "true";
    var bar = $("trial-bar"), info = $("trial-info"), paywall = $("paywall");
    if (!bar) return;

    if (plan === "yearly" || plan === "lifetime") {
        bar.className = "trialbar hidden";
        if (paywall) paywall.classList.add("hidden");
        return;
    }
    if (plan === "trial" || status === "trialing") {
        var days = daysBetween(expires);
        if (days === null || days <= 0) { showPaywall("Seu trial expirou"); return; }
        var warn = days <= 3;
        bar.className = "trialbar" + (warn ? " warn" : "");
        info.textContent = "⏰ Trial: " + days + " dia" + (days === 1 ? "" : "s") + (viaBundle ? " (Pacote Completo)" : "");
        if (paywall) paywall.classList.add("hidden");
        return;
    }
    if (plan === "free" || plan === "expired" || status === "expired" || status === "canceled" || status === "revoked") {
        showPaywall(plan === "free" ? "Sem assinatura ativa" : "Sua assinatura expirou");
        return;
    }
    bar.className = "trialbar hidden";
}
function showPaywall(title) {
    var pw = $("paywall"); if (!pw) return;
    var t = pw.querySelector(".paywall__title");
    if (t && title) t.textContent = title;
    pw.classList.remove("hidden");
    var bar = $("trial-bar"); if (bar) bar.className = "trialbar expired";
    var info = $("trial-info"); if (info) info.textContent = "⚠️ " + title;
}
function bindTrialUI() {
    $("btn-upgrade").onclick = function () { openInBrowser(PRICING_URL); };
    $("paywall-cta").onclick = function () { openInBrowser(PRICING_URL); };
    $("paywall-bundle").onclick = function () { openInBrowser(LANDING_URL + "/#pricing"); };
    $("paywall-logout").onclick = function () {
        ["mv_session","mv_email","mvl_license","mvl_plan","mvl_status","mvl_expires","mvl_via_bundle","mvl_email_verified"].forEach(function(k){ localStorage.removeItem(k); });
        $("paywall").classList.add("hidden");
        showGate("login");
    };
    $("btn-resend-verify").onclick = async function () {
        var b = $("btn-resend-verify"); b.disabled = true; var o = b.textContent;
        b.textContent = "Enviando...";
        try {
            var r = await gateApi("/v1/auth/resend-verification", {});
            if (r.already_verified) {
                localStorage.setItem("mvl_email_verified","true");
                $("verify-bar").classList.add("hidden");
                toast("E-mail já estava verificado", "ok");
            } else {
                b.textContent = "✓ Enviado";
                toast("Cheque sua caixa de entrada", "ok");
                setTimeout(function () { b.textContent = o; b.disabled = false; }, 3000);
            }
        } catch (e) { b.textContent = o; b.disabled = false; toast("Erro: " + e, "err"); }
    };
    $("btn-dismiss-verify").onclick = function () {
        $("verify-bar").classList.add("hidden");
        localStorage.setItem("mvl_verify_dismissed_until", Date.now() + 24*60*60*1000);
    };
}

async function checkEmailVerified() {
    if (!localStorage.getItem("mv_session")) return;
    try {
        var r = await gateApi("/v1/me");
        var verified = r.user && r.user.email_verified;
        localStorage.setItem("mvl_email_verified", verified ? "true" : "false");
        if (r.user && r.user.name) localStorage.setItem("mv_name", r.user.name);
        updateVerifyBar();
    } catch (e) {}
}
function updateVerifyBar() {
    var bar = $("verify-bar"); if (!bar) return;
    var verified = localStorage.getItem("mvl_email_verified") === "true";
    var dismissed = Number(localStorage.getItem("mvl_verify_dismissed_until") || 0);
    if (verified || Date.now() < dismissed) bar.classList.add("hidden");
    else bar.classList.remove("hidden");
}

/* FILOSOFIA: nunca desloga automaticamente.
 * Sub revogada/expirada → paywall.
 * Token JWT inválido (após 30d) → relogin necessário. */
function startHeartbeat() {
    if (DEV_BYPASS) return;
    var fp = computeFingerprint();
    var tick = async function () {
        try {
            var r = await gateApi("/v1/license/heartbeat", { fingerprint: fp, product_id: PRODUCT_ID });
            if (r.revoked || r.subscription_inactive) {
                // Sub inativa → paywall, NÃO desloga
                localStorage.setItem("mvl_plan", r.plan || "free");
                localStorage.setItem("mvl_status", r.status || "revoked");
                if (r.expires_at) localStorage.setItem("mvl_expires", r.expires_at);
                updateTrialUI();
                return;
            }
            if (r.license) {
                localStorage.setItem("mvl_license", r.license);
                localStorage.setItem("mvl_plan", r.plan);
                localStorage.setItem("mvl_status", r.status || "");
                localStorage.setItem("mvl_expires", r.expires_at || "");
                localStorage.setItem("mvl_via_bundle", r.covers_via_bundle ? "true" : "false");
                updateTrialUI();
            }
        } catch (e) {
            var msg = (typeof e === "string" ? e : (e && e.message)) || "";
            if (msg === "invalid_token" || msg === "missing_token") {
                ["mv_session","mvl_license","mvl_plan","mvl_status","mvl_expires"].forEach(function(k){ localStorage.removeItem(k); });
                showGate("login");
            }
            // outros erros: offline grace
        }
    };
    tick(); setInterval(tick, 5*60*1000);
}

function tryRestoreSession() {
    if (DEV_BYPASS) { hideGate(); return true; }
    // Só precisa do session_token. License pode estar expirada — paywall trata.
    var t = localStorage.getItem("mv_session");
    if (t) { hideGate(); return true; }
    showGate("login");
    return false;
}

// ============================================================ boot
var BUILD = "3.4.0-diag-mode";

function boot() {
    loadCatalog();
    buildIndex();
    // No layout novo, mostra todos os items direto (sem precisar selectPack)
    renderGrid();
    var statusEl = $("status");
    if (statusEl) statusEl.textContent = "Pronto · " + PRODUCT_NAME + " · build " + BUILD;
    bindGate();
    bindTrialUI();
    tryRestoreSession();
    updateTrialUI();
    updateVerifyBar();
    checkEmailVerified();
    startHeartbeat();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}

})();
