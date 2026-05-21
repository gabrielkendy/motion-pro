/* MotionVault — production browser (AtomX-inspired, simplified & fast).
 *
 * Key design choices:
 *  - Thumbnails are pre-generated .jpg files in ./thumbs/<hash>.jpg
 *    referenced with RELATIVE URLs. No file:// encoding pitfalls.
 *  - padding-bottom trick instead of `aspect-ratio` (works on every CEF).
 *  - IntersectionObserver lazy load; max 2 concurrent video frame captures.
 *  - Paging 60 items at a time; "Load more" at bottom.
 *  - Favorites stored in localStorage.
 *  - Breadcrumb shows current location (pack › cat › subcat).
 *  - Top tools: All Packs · Grid · Favorites.
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

function sha1Short(str) {
    var h = 0xdeadbeef >>> 0;
    for (var i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 2654435761) >>> 0;
    return (h.toString(16) + str.length.toString(16)).padStart(10, "0");
}
function thumbRel(item) { return "thumbs/" + sha1Short(item.mogrt || item.preview || item.name) + ".jpg"; }
function thumbAbs(item) { return EXT_PATH + "\\thumbs\\" + sha1Short(item.mogrt || item.preview || item.name) + ".jpg"; }

function fileUrl(p) {
    var s = String(p).replace(/\\/g, "/");
    return "file:///" + s.split("/").map(function (seg, i) {
        if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg;
        return encodeURIComponent(seg);
    }).join("/");
}

// ============================================================ catalog
var CATALOG = null;
var INDEX = [];

function loadCatalog() {
    try {
        var file = nodePath.join(EXT_PATH, "catalog", "catalog.json");
        CATALOG = JSON.parse(fs.readFileSync(file, "utf8"));
        return true;
    } catch (e) {
        showFatal("Falha ao carregar catálogo: " + e.message);
        return false;
    }
}

function buildIndex() {
    INDEX = [];
    CATALOG.packs.forEach(function (p) { walk(p.categories || [], p, []); });
}
function walk(nodes, pack, crumb) {
    nodes.forEach(function (n) {
        if (n.items) n.items.forEach(function (it) {
            INDEX.push({ pack: pack, cat: crumb.concat(n.name).join(" › "), item: it, catArr: crumb.concat(n.name) });
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

// ============================================================ favorites (localStorage)
var FAVS = (function () {
    try { return JSON.parse(localStorage.getItem("mv_favs") || "[]"); }
    catch (e) { return []; }
})();
function favSave() { try { localStorage.setItem("mv_favs", JSON.stringify(FAVS)); } catch (e) {} }
function favKey(item) { return item.mogrt || item.preview || item.name; }
function isFav(item) { return FAVS.indexOf(favKey(item)) >= 0; }
function toggleFav(item) {
    var k = favKey(item), i = FAVS.indexOf(k);
    if (i >= 0) FAVS.splice(i, 1); else FAVS.push(k);
    favSave();
}

// ============================================================ state
var STATE = {
    pack: null,            // pack id, or "__all__" or "__favs__"
    catPath: [],           // ["01. Typography","Big Typo"]
    expanded: {},
    search: "",
    page: 0,
    pageSize: 60,
    items: []
};

// ============================================================ render: tabs
function renderTabs() {
    var el = $("tabs"); el.innerHTML = "";
    CATALOG.packs.forEach(function (p) {
        var t = document.createElement("div");
        t.className = "tab";
        t.dataset.id = p.id;
        t.innerHTML = '<span>' + esc(p.name) + '</span><span class="tab__count">' + countPackItems(p).toLocaleString("pt-BR") + '</span>';
        t.onclick = function () { selectPack(p.id); };
        el.appendChild(t);
    });
}

function selectPack(id) {
    STATE.pack = id; STATE.catPath = []; STATE.search = ""; STATE.page = 0;
    STATE.expanded = {};
    $("q").value = ""; $("q-clear").classList.add("hidden");
    [].forEach.call(document.querySelectorAll(".tab"), function (t) {
        t.classList.toggle("on", t.dataset.id === id);
    });
    [].forEach.call(document.querySelectorAll(".tool"), function (t) {
        t.classList.toggle("active", t.dataset.view === "grid");
    });
    renderSide();
    renderGrid();
    renderBreadcrumb();
}

function packById(id) {
    for (var i = 0; i < CATALOG.packs.length; i++) if (CATALOG.packs[i].id === id) return CATALOG.packs[i];
    return null;
}

// ============================================================ render: breadcrumb
function renderBreadcrumb() {
    var el = $("breadcrumb"); el.innerHTML = "";
    var crumbs = [];

    if (STATE.search) {
        crumbs.push({ label: "Busca: \"" + STATE.search + "\"", last: true });
    } else if (STATE.pack === "__favs__") {
        crumbs.push({ label: "★ Favoritos", last: true });
    } else if (STATE.pack === "__all__") {
        crumbs.push({ label: "Todos os packs", last: true });
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

// ============================================================ render: sidebar
function renderSide() {
    var el = $("side"); el.innerHTML = "";

    if (STATE.pack === "__favs__" || STATE.pack === "__all__") {
        // sidebar shows packs as roots in these modes
        CATALOG.packs.forEach(function (p) {
            var d = document.createElement("div");
            d.className = "cat cat--root";
            d.innerHTML = '<span class="cat__chev">·</span><span class="cat__name">' + esc(p.name) + '</span><span class="cat__num">' + countPackItems(p).toLocaleString("pt-BR") + '</span>';
            d.onclick = function () { selectPack(p.id); };
            el.appendChild(d);
        });
        return;
    }

    var p = packById(STATE.pack); if (!p) return;
    (p.categories || []).forEach(function (root) { renderCat(root, 0, [], el); });
}

function renderCat(node, depth, crumb, container) {
    var path = crumb.concat(node.name);
    var pathKey = path.join("/");
    var hasChildren = !!(node.children && node.children.length);
    var hasItems = !!(node.items && node.items.length);
    var count = countItems(node);

    var d = document.createElement("div");
    d.className = "cat " + (depth === 0 ? "cat--root" : depth === 1 ? "cat--child" : "cat--child2");
    if (STATE.catPath.join("/") === pathKey) d.classList.add("on");

    var chev = '<span class="cat__chev' + (STATE.expanded[pathKey] ? " open" : "") + '">' + (hasChildren ? "▸" : "·") + '</span>';
    d.innerHTML = chev + '<span class="cat__name">' + esc(node.name) + '</span>' + (count ? '<span class="cat__num">' + count + '</span>' : "");

    d.onclick = function (e) {
        e.stopPropagation();
        STATE.page = 0;
        if (hasChildren && !hasItems) {
            STATE.expanded[pathKey] = !STATE.expanded[pathKey];
            renderSide();
            return;
        }
        STATE.catPath = path;
        STATE.search = "";
        if (hasChildren) STATE.expanded[pathKey] = true;
        renderSide();
        renderGrid();
        renderBreadcrumb();
    };
    container.appendChild(d);

    if (hasChildren && STATE.expanded[pathKey]) {
        node.children.forEach(function (c) { renderCat(c, depth + 1, path, container); });
    }
}

function findNode(nodes, pathArr) {
    var cur = { children: nodes };
    for (var i = 0; i < pathArr.length; i++) {
        var next = null;
        (cur.children || []).forEach(function (n) { if (n.name === pathArr[i]) next = n; });
        if (!next) return null;
        cur = next;
    }
    return cur;
}
function findFirstLeaf(node, crumb) {
    crumb = crumb || (node.name ? [node.name] : []);
    if (node.items && node.items.length) return { path: crumb, node: node };
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            var nm = node.children[i].name;
            var r = findFirstLeaf(node.children[i], crumb.concat(nm));
            if (r) return r;
        }
    }
    return null;
}
function collectAll(node, out, max) {
    if (node.items) for (var i = 0; i < node.items.length && out.length < max; i++) out.push(node.items[i]);
    if (node.children) for (var j = 0; j < node.children.length && out.length < max; j++) collectAll(node.children[j], out, max);
}

// ============================================================ render: grid
function getItemsForActive() {
    if (STATE.search) {
        var q = STATE.search.toLowerCase();
        var out = [];
        for (var i = 0; i < INDEX.length && out.length < 500; i++) {
            var r = INDEX[i];
            if ((r.item.name + " " + r.cat + " " + r.pack.name).toLowerCase().indexOf(q) >= 0) {
                out.push({ pack: r.pack, item: r.item });
            }
        }
        return out;
    }
    if (STATE.pack === "__favs__") {
        var favs = [];
        for (var i2 = 0; i2 < INDEX.length; i2++) {
            if (isFav(INDEX[i2].item)) favs.push({ pack: INDEX[i2].pack, item: INDEX[i2].item });
        }
        return favs;
    }
    if (STATE.pack === "__all__") {
        return INDEX.slice(0, 500).map(function (r) { return { pack: r.pack, item: r.item }; });
    }
    var p = packById(STATE.pack); if (!p) return [];
    if (STATE.catPath.length) {
        var found = findNode(p.categories, STATE.catPath);
        if (!found) return [];
        var col = [];
        collectAll(found, col, 5000);
        return col.map(function (it) { return { pack: p, item: it }; });
    }
    // pack overview = first leaf
    var leaf = findFirstLeaf({ children: p.categories });
    if (leaf) {
        STATE.catPath = leaf.path;
        renderBreadcrumb();
        return leaf.node.items.map(function (it) { return { pack: p, item: it }; });
    }
    return [];
}

function renderGrid() {
    var el = $("grid"); el.innerHTML = "";
    STATE.items = getItemsForActive();
    STATE.page = 0;

    if (!STATE.items.length) {
        var msg = STATE.pack === "__favs__"
            ? '<h3>Nenhum favorito</h3><p>Passe o mouse num template e clique na estrela.</p>'
            : '<h3>Nenhum item</h3><p>Selecione uma subcategoria à esquerda.</p>';
        el.innerHTML = '<div class="empty">' + msg + '</div>';
        $("status").textContent = "Pronto";
        return;
    }
    appendPage();
    $("count").textContent = STATE.items.length.toLocaleString("pt-BR") + " no total";
}

function appendPage() {
    var el = $("grid");
    var old = $("load-more"); if (old) old.remove();
    var start = STATE.page * STATE.pageSize;
    var end = Math.min(start + STATE.pageSize, STATE.items.length);
    for (var i = start; i < end; i++) el.appendChild(buildCard(STATE.items[i].pack, STATE.items[i].item));
    if (end < STATE.items.length) {
        var b = document.createElement("button");
        b.id = "load-more"; b.className = "load-more";
        b.textContent = "Carregar mais (" + (STATE.items.length - end).toLocaleString("pt-BR") + " restantes)";
        b.onclick = function () { STATE.page++; appendPage(); };
        el.appendChild(b);
    }
    $("status").textContent = end.toLocaleString("pt-BR") + " / " + STATE.items.length.toLocaleString("pt-BR") + " exibidos";
}

// ============================================================ cards
var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
        if (e.isIntersecting && !e.target.dataset.loaded) {
            e.target.dataset.loaded = "1";
            loadCardImage(e.target);
        }
    });
}, { rootMargin: "400px" });

function buildCard(pack, item) {
    var c = document.createElement("div");
    c.className = "card";
    c._item = item; c._pack = pack;

    var thumb = document.createElement("div");
    thumb.className = "card__thumb";
    thumb.style.background = "linear-gradient(135deg, " + colorFromName(item.name) + ", #15151a 80%)";

    // play overlay (visible on hover, click = import)
    var play = document.createElement("div");
    play.className = "playicon";
    play.title = "Clique para importar na timeline";
    play.innerHTML = '<svg viewBox="0 0 24 24" width="42" height="42" fill="rgba(255,255,255,0.95)"><path d="M8 5v14l11-7z"/></svg>';
    play.onclick = function (e) { e.stopPropagation(); importMogrt(item); };
    thumb.appendChild(play);

    // top-left badge
    if (item.preview) {
        var b = document.createElement("div");
        b.className = "badge";
        b.textContent = (item.type || "mogrt").toUpperCase();
        thumb.appendChild(b);
    }

    // top-right favorite star
    var fav = document.createElement("div");
    fav.className = "card__fav" + (isFav(item) ? " on" : "");
    fav.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="' + (isFav(item) ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2"><polygon points="12,2 15,9 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 9,9"/></svg>';
    fav.onclick = function (e) {
        e.stopPropagation();
        toggleFav(item);
        fav.classList.toggle("on");
        fav.querySelector("svg").setAttribute("fill", isFav(item) ? "currentColor" : "none");
        if (STATE.pack === "__favs__" && !isFav(item)) renderGrid();
    };
    thumb.appendChild(fav);

    c.appendChild(thumb);

    var n = document.createElement("div");
    n.className = "card__name"; n.textContent = item.name; n.title = item.name;
    c.appendChild(n);

    c.addEventListener("mouseenter", function () { onHover(c, item); });
    c.addEventListener("mouseleave", function () { offHover(c); });
    // Single click no card importa. O play icon e a estrela têm seus próprios handlers e param a propagação.
    c.addEventListener("click", function (e) {
        if (e.target.closest && (e.target.closest(".card__fav") || e.target.closest(".playicon"))) return;
        importMogrt(item);
    });

    observer.observe(c);
    return c;
}

function colorFromName(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var hue = h % 360;
    return "hsl(" + hue + ", 38%, 24%)";
}

function loadCardImage(card) {
    var item = card._item;
    if (!item) return;
    var thumb = card.querySelector(".card__thumb"); if (!thumb) return;
    if (thumb.querySelector("img.frame")) return;

    var img = document.createElement("img");
    img.className = "frame";
    img.draggable = false;
    img.loading = "lazy";
    img.onerror = function () { img.style.display = "none"; captureRuntime(card, item); };
    img.src = thumbRel(item);
    thumb.insertBefore(img, thumb.firstChild);
}

var QUEUE = [], ACTIVE = 0, MAX = 2;
function q(fn) { QUEUE.push(fn); drain(); }
function drain() {
    while (ACTIVE < MAX && QUEUE.length) {
        var task = QUEUE.shift(); ACTIVE++;
        try { task(function () { ACTIVE--; drain(); }); } catch (e) { ACTIVE--; drain(); }
    }
}
function captureRuntime(card, item) {
    if (!item.preview) return;
    q(function (done) {
        var v = document.createElement("video");
        v.muted = true; v.playsInline = true; v.preload = "auto";
        var cnv = document.createElement("canvas");
        var ctx = cnv.getContext("2d");
        var tmo = setTimeout(function () { cleanup(); done(); }, 8000);
        function cleanup() { try { v.removeAttribute("src"); v.load(); } catch (e) {} }
        v.addEventListener("loadedmetadata", function () {
            try { v.currentTime = Math.max(0.5, (v.duration || 4) * 0.85); } catch (e) {}
        });
        v.addEventListener("seeked", function () {
            try {
                cnv.width = v.videoWidth; cnv.height = v.videoHeight;
                ctx.drawImage(v, 0, 0, cnv.width, cnv.height);
                var data = cnv.toDataURL("image/jpeg", 0.82).split(",")[1];
                fs.writeFileSync(thumbAbs(item), Buffer.from(data, "base64"));
                var img = card.querySelector("img.frame");
                if (img) {
                    img.style.display = "";
                    img.src = thumbRel(item) + "?v=" + Date.now();
                }
            } catch (e) {}
            clearTimeout(tmo); cleanup(); done();
        });
        v.addEventListener("error", function () { clearTimeout(tmo); cleanup(); done(); });
        v.src = fileUrl(item.preview);
    });
}

function onHover(card, item) {
    if (!item.preview) return;
    if (card.querySelector("video.live")) return;
    var v = document.createElement("video");
    v.className = "live";
    v.src = fileUrl(item.preview);
    v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
    card.querySelector(".card__thumb").appendChild(v);
    v.play().catch(function () {});
}
function offHover(card) {
    var v = card.querySelector("video.live");
    if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {} v.remove(); }
}

// ============================================================ import
function logLine(msg, kind) {
    try {
        var body = document.getElementById("log-body");
        if (!body) return;
        var d = document.createElement("div");
        d.className = "log__line" + (kind ? " log__line--" + kind : "");
        var time = new Date().toTimeString().slice(0, 8);
        d.textContent = "[" + time + "] " + msg;
        body.appendChild(d);
        body.scrollTop = body.scrollHeight;
    } catch (e) {}
}

function importMogrt(item) {
    if (!item || (!item.mogrt && !item.cdn_key)) {
        toast("Item sem caminho .mogrt", "err", 3000);
        logLine("ABORT: item sem .mogrt/cdn_key: " + JSON.stringify(item), "err");
        return;
    }

    $("status").textContent = "Preparando " + item.name + "...";
    logLine("→ importMogrt: " + item.name);

    // Resolve path: legacy local path OR CDN-cached download
    var resolvePath;
    if (window.AssetLoader && (item.cdn_key || !fs.existsSync(item.mogrt || ""))) {
        // CDN path (also fallback when local file is missing)
        resolvePath = window.AssetLoader.get(item).catch(function (err) {
            var msg = String(err && err.message || err);
            if (msg === "auth_expired")           toast("Sessão expirou — entre de novo", "err", 4000);
            else if (msg === "subscription_inactive") toast("Plano vencido — renove pra baixar", "err", 4000);
            else if (msg === "device_not_authorized") toast("Dispositivo não autorizado", "err", 4000);
            else if (msg === "asset_not_found")   toast("Template indisponível", "err", 4000);
            else                                  toast("Falha no download: " + msg, "err", 4000);
            logLine("ASSET LOAD FAIL: " + msg, "err");
            throw err;
        });
    } else if (item.mogrt) {
        // Legacy path (Gabriel's dev machine, or already cached)
        resolvePath = Promise.resolve(item.mogrt);
    } else {
        toast("Item sem caminho local", "err", 3000);
        return;
    }

    resolvePath.then(function (absPath) {
        if (!absPath) return;
        try {
            if (!fs.existsSync(absPath)) {
                toast(".mogrt não encontrado no cache", "err", 4000);
                logLine("MISSING FILE: " + absPath, "err");
                return;
            }
        } catch (e) {}

        var p = String(absPath).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        $("status").textContent = "Importando " + item.name + "...";
        logLine("  path: " + absPath);

        cs.evalScript('MotionVault.importMogrt("' + p + '")', function (res) {
        logLine("← host res: " + (res || "(vazio)"));
        if (!res || res === "undefined") {
            toast("Sem resposta do Premiere. O host.jsx carregou?", "err", 4000);
            $("status").textContent = "Sem resposta do host";
            return;
        }
        if (res === "EvalScript error.") {
            toast("ExtendScript falhou. Veja o console (Ctrl+`).", "err", 4000);
            logLine("EvalScript error retornado pelo Premiere", "err");
            $("status").textContent = "ExtendScript error";
            return;
        }
        var ok = false, errMsg = "";
        try {
            var j = JSON.parse(res);
            ok = j && j.ok;
            if (!ok && j) errMsg = j.error || "";
        } catch (e) { errMsg = "Resposta inválida: " + res; }

        if (ok) {
            toast("✓ " + item.name, "ok");
            $("status").textContent = "Importado: " + item.name;
        } else {
            toast(errMsg || "Falha ao importar", "err", 4500);
            logLine("FAIL: " + (errMsg || "(sem msg)"), "err");
            $("status").textContent = "Erro: " + (errMsg || "desconhecido");
        }
        }); // close cs.evalScript
    }, function () { /* resolvePath rejected — toast já mostrado */ }); // close resolvePath.then
}

/* Pinga o host.jsx no boot pra confirmar que carregou. Mostra toast se falhar. */
function hostPing() {
    cs.evalScript("(typeof $.global.MotionVault === 'object') ? MotionVault.ping() : 'undefined'", function (res) {
        logLine("ping host: " + (res || "(vazio)"));
        if (!res || res === "undefined" || res === "EvalScript error.") {
            toast("⚠ host.jsx não carregou. Reabra o painel.", "err", 6000);
            logLine("HOST AUSENTE — verifique manifest e jsx/host.jsx", "err");
            return;
        }
        try {
            var j = JSON.parse(res);
            if (j && j.error) logLine("ping error: " + j.error, "err");
            else logLine("host ok: " + j.host + " " + j.version + " seq=" + j.hasSequence);
        } catch (e) {}
    });
}

// ============================================================ ui events
$("q").addEventListener("input", function () {
    var v = $("q").value;
    $("q-clear").classList.toggle("hidden", !v);
    clearTimeout(window._st);
    window._st = setTimeout(function () {
        STATE.search = v.trim();
        if (STATE.search) {
            STATE.catPath = [];
            [].forEach.call(document.querySelectorAll(".cat"), function (el) { el.classList.remove("on"); });
        }
        renderGrid();
        renderBreadcrumb();
    }, 200);
});
$("q-clear").addEventListener("click", function () {
    $("q").value = ""; STATE.search = ""; $("q-clear").classList.add("hidden");
    renderGrid(); renderBreadcrumb(); $("q").focus();
});

$("btn-density").addEventListener("click", function () {
    var seq = ["normal", "dense", "wide"];
    var cur = document.body.classList.contains("dense") ? "dense" : document.body.classList.contains("wide") ? "wide" : "normal";
    var next = seq[(seq.indexOf(cur) + 1) % seq.length];
    document.body.classList.remove("dense", "wide");
    if (next !== "normal") document.body.classList.add(next);
});

$("btn-favorites").addEventListener("click", function () {
    STATE.pack = "__favs__"; STATE.catPath = []; STATE.search = "";
    $("q").value = ""; $("q-clear").classList.add("hidden");
    [].forEach.call(document.querySelectorAll(".tab"), function (t) { t.classList.remove("on"); });
    [].forEach.call(document.querySelectorAll(".tool"), function (t) { t.classList.remove("active"); });
    $("btn-favorites").classList.add("active");
    renderSide(); renderGrid(); renderBreadcrumb();
});
// "All" view (first tool button)
document.querySelectorAll(".tool[data-view='all']").forEach(function (b) {
    b.addEventListener("click", function () {
        STATE.pack = "__all__"; STATE.catPath = []; STATE.search = "";
        $("q").value = ""; $("q-clear").classList.add("hidden");
        [].forEach.call(document.querySelectorAll(".tab"), function (t) { t.classList.remove("on"); });
        [].forEach.call(document.querySelectorAll(".tool"), function (t) { t.classList.remove("active"); });
        b.classList.add("active");
        renderSide(); renderGrid(); renderBreadcrumb();
    });
});
document.querySelectorAll(".tool[data-view='grid']").forEach(function (b) {
    b.addEventListener("click", function () {
        if (!CATALOG.packs[0]) return;
        selectPack(CATALOG.packs[0].id);
    });
});

$("btn-debug").addEventListener("click", function () { var l = $("log"); if (l) l.classList.toggle("hidden"); });
$("log-close").addEventListener("click", function () { $("log").classList.add("hidden"); });
document.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.key === "`") $("log").classList.toggle("hidden");
    if (e.ctrlKey && e.key === "k") { e.preventDefault(); $("q").focus(); $("q").select(); }
});

// ============================================================ misc
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
function showFatal(msg) {
    document.body.innerHTML = '<div style="padding:30px;color:#ff5566;font-family:sans-serif">' + esc(msg) + '</div>';
}

// ============================================================ AUTH (login/signup gate)
var API_BASE = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl) || "https://motionpro.vercel.app";
var LANDING_URL = "https://motionpro-lp.vercel.app";
var DEV_BYPASS = (window.MV_CONFIG && window.MV_CONFIG.devMode === true);

// Abre URL no navegador externo (Chrome/Safari/Edge), nunca dentro do CEP
function openInBrowser(url) {
    try {
        if (typeof CSInterface !== "undefined") {
            var cs = new CSInterface();
            cs.openURLInDefaultBrowser(url);
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
    toast("Não consegui abrir o navegador. Cole no browser: " + url, "warn", 5000);
    return false;
}

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

/* Hardware fingerprint — combines several entropy sources, SHA-256 hashed.
 * FASE 2 hardening 2026-05-18: substituiu FNV (Math.imul) por crypto.createHash
 * via Node module (disponível em CEP), com fallback SubtleCrypto async-friendly.
 * Stable per machine, hard to spoof. */
function computeFingerprint() {
    var os = (typeof require === "function") ? require("os") : null;
    var parts = [];
    if (os) {
        parts.push(os.hostname());
        parts.push(os.platform());
        parts.push(os.arch());
        parts.push(String(os.totalmem()));
        try { parts.push(os.userInfo().username); } catch (e) {}
        var ifaces = os.networkInterfaces();
        var macs = [];
        for (var k in ifaces) {
            ifaces[k].forEach(function (i) {
                if (i.mac && i.mac !== "00:00:00:00:00:00") macs.push(i.mac);
            });
        }
        macs.sort();
        parts.push(macs.join("|"));
    }
    parts.push(navigator.userAgent.substr(0, 60));
    parts.push(String(screen.width) + "x" + String(screen.height));
    var s = parts.join("::");

    // ── crypto-grade hash (Node crypto, disponível dentro do CEP via require) ──
    try {
        var crypto = (typeof require === "function") ? require("crypto") : null;
        if (crypto && crypto.createHash) {
            return crypto.createHash("sha256").update(s, "utf8").digest("hex");
        }
    } catch (e) { /* fallback abaixo */ }

    // Fallback FNV (mantido como defesa em profundidade — se algum dia rodar
    // fora do Node, ainda gera fingerprint estável mas marca como WEAK)
    var h1 = 0xdeadbeef >>> 0, h2 = 0x41c6ce57 >>> 0;
    for (var i = 0; i < s.length; i++) {
        h1 = Math.imul(h1 ^ s.charCodeAt(i), 2654435761) >>> 0;
        h2 = Math.imul(h2 ^ s.charCodeAt(i), 1597334677) >>> 0;
    }
    return "fnv:" + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + s.length.toString(16);
}

function showGate(initialMode) {
    var gate = document.getElementById("gate");
    if (!gate) return;
    gate.classList.remove("hidden");
    setGateMode(initialMode || "login");
}
function hideGate() {
    var gate = document.getElementById("gate");
    if (gate) gate.classList.add("hidden");
}
function setGateMode(mode) {
    var isSignup = mode === "signup";
    document.getElementById("gt-login").classList.toggle("active", !isSignup);
    document.getElementById("gt-signup").classList.toggle("active", isSignup);
    document.getElementById("g-submit").textContent = isSignup ? "Criar conta · iniciar 7 dias grátis" : "Entrar";
    document.getElementById("g-msg").textContent = "";
    document.getElementById("g-msg").className = "gate__msg";
    document.getElementById("g-submit").dataset.mode = mode;
    // Mostra/esconde campos extras do signup
    [].forEach.call(document.querySelectorAll(".signup-only"), function (el) {
        el.hidden = !isSignup;
    });
    // autocomplete da senha
    document.getElementById("g-password").autocomplete = isSignup ? "new-password" : "current-password";
}

function bindGate() {
    var gtL = document.getElementById("gt-login");
    var gtS = document.getElementById("gt-signup");
    var sub = document.getElementById("g-submit");
    var msg = document.getElementById("g-msg");
    var forgot = document.getElementById("g-forgot");
    if (!gtL) return;

    gtL.onclick = function () { setGateMode("login"); };
    gtS.onclick = function () { setGateMode("signup"); };

    // Esqueci minha senha → abre browser na página de reset
    if (forgot) {
        forgot.onclick = function (e) {
            e.preventDefault();
            var email = document.getElementById("g-email").value.trim();
            var url = LANDING_URL + "/reset-password.html";
            if (email) url += "?email=" + encodeURIComponent(email);
            openInBrowser(url);
            msg.textContent = "✓ Página de recuperação aberta no navegador";
            msg.className = "gate__msg ok";
        };
    }

    sub.onclick = async function () {
        var mode = sub.dataset.mode || "login";
        var email = document.getElementById("g-email").value.trim().toLowerCase();
        var password = document.getElementById("g-password").value;
        var name = document.getElementById("g-name").value.trim();
        var phone = document.getElementById("g-phone").value.trim();
        var optin = document.getElementById("g-optin").checked;
        if (!email || password.length < 8) {
            msg.textContent = "Email e senha (mín 8) obrigatórios"; return;
        }
        if (mode === "signup" && name.length < 2) {
            msg.textContent = "Digite seu nome completo"; return;
        }
        sub.disabled = true; msg.textContent = "Conectando..."; msg.className = "gate__msg";
        try {
            var fp = computeFingerprint();
            var payload = { email: email, password: password, fingerprint: fp };
            if (mode === "signup") {
                payload.name = name;
                payload.phone = phone || null;
                payload.marketing_optin = optin;
            }
            var data = await gateApi("/v1/auth/" + mode, payload);
            localStorage.setItem("mv_session", data.session_token);
            localStorage.setItem("mv_email", email);
            // issue license
            var lic = await gateApi("/v1/license/issue", { fingerprint: fp });
            localStorage.setItem("mv_license", lic.license);
            localStorage.setItem("mv_plan", lic.plan);
            localStorage.setItem("mv_status", lic.status || "");
            localStorage.setItem("mv_expires", lic.expires_at || "");
            // Marca email como não verificado no signup (vai mostrar banner)
            if (mode === "signup") {
                localStorage.setItem("mv_email_verified", "false");
                localStorage.removeItem("mv_verify_dismissed_until");
                if (name) localStorage.setItem("mv_name", name);
            } else {
                // No login, busca status atual do banco
                setTimeout(checkEmailVerified, 800);
            }
            msg.textContent = "✓ " + (mode === "signup" ? "Conta criada! Verifique seu e-mail. trial de 7 dias ativo." : "Bem-vindo!");
            msg.className = "gate__msg ok";
            setTimeout(function () { hideGate(); hideReauthBar(); updateTrialUI(); updateVerifyBar(); }, 500);
        } catch (e) {
            msg.textContent = "Erro: " + (typeof e === "string" ? e : (e.message || "falha"));
            msg.className = "gate__msg";
        }
        sub.disabled = false;
    };
}

/* ============================================================
   TRIAL BAR + PAYWALL
   Mostra status do plano no topo. Bloqueia se trial expirou.
   ============================================================ */
function daysBetween(future) {
    if (!future) return null;
    var d = (new Date(future) - new Date()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.ceil(d));
}

function updateTrialUI() {
    var plan = localStorage.getItem("mv_plan") || "";
    var status = localStorage.getItem("mv_status") || "";
    var expires = localStorage.getItem("mv_expires") || "";
    var bar = document.getElementById("trial-bar");
    var info = document.getElementById("trial-info");
    var paywall = document.getElementById("paywall");
    if (!bar) return;

    // Plano pago — esconde tudo
    if (plan === "yearly" || plan === "lifetime") {
        bar.className = "trialbar hidden";
        if (paywall) paywall.classList.add("hidden");
        return;
    }

    // Trial ativo
    if (plan === "trial" || status === "trialing") {
        var days = daysBetween(expires);
        if (days === null || days <= 0) {
            // Trial vencido → paywall
            showPaywall("Seu trial expirou");
            return;
        }
        var warn = days <= 3;
        bar.className = "trialbar" + (warn ? " warn" : "");
        info.textContent = "⏰ Trial: " + days + " dia" + (days === 1 ? "" : "s") + " restante" + (days === 1 ? "" : "s");
        if (paywall) paywall.classList.add("hidden");
        return;
    }

    // Plano free/expired/canceled → paywall total
    if (plan === "free" || plan === "expired" || status === "expired" || status === "canceled" || status === "revoked") {
        showPaywall(plan === "free" ? "Sem assinatura ativa" : "Sua assinatura expirou");
        return;
    }

    // Default: esconde
    bar.className = "trialbar hidden";
}

function showPaywall(title) {
    var pw = document.getElementById("paywall");
    var bar = document.getElementById("trial-bar");
    if (!pw) return;
    var t = pw.querySelector(".paywall__title");
    if (t && title) t.textContent = title;
    pw.classList.remove("hidden");
    if (bar) bar.className = "trialbar expired";
    var info = document.getElementById("trial-info");
    if (info) info.textContent = "⚠️ " + title;
}

function bindTrialUI() {
    var btnUpgrade = document.getElementById("btn-upgrade");
    if (btnUpgrade) {
        btnUpgrade.onclick = function () {
            openInBrowser(LANDING_URL + "/#pricing");
        };
    }
    var pwCta = document.getElementById("paywall-cta");
    if (pwCta) {
        pwCta.onclick = function () {
            openInBrowser(LANDING_URL + "/#pricing");
        };
    }
    var pwLogout = document.getElementById("paywall-logout");
    if (pwLogout) {
        pwLogout.onclick = function () {
            localStorage.removeItem("mv_session");
            localStorage.removeItem("mv_license");
            localStorage.removeItem("mv_plan");
            localStorage.removeItem("mv_status");
            localStorage.removeItem("mv_expires");
            localStorage.removeItem("mv_email_verified");
            var pw = document.getElementById("paywall");
            if (pw) pw.classList.add("hidden");
            showGate("login");
        };
    }

    // Verify email bar
    var resendBtn = document.getElementById("btn-resend-verify");
    if (resendBtn) {
        resendBtn.onclick = async function () {
            resendBtn.disabled = true;
            var orig = resendBtn.textContent;
            resendBtn.textContent = "Enviando...";
            try {
                var r = await gateApi("/v1/auth/resend-verification", {});
                if (r.already_verified) {
                    localStorage.setItem("mv_email_verified", "true");
                    document.getElementById("verify-bar").classList.add("hidden");
                    toast("Seu e-mail já estava verificado", "ok");
                } else {
                    resendBtn.textContent = "✓ E-mail enviado";
                    toast("Verifique sua caixa de entrada", "ok");
                    setTimeout(function () { resendBtn.textContent = orig; resendBtn.disabled = false; }, 3000);
                }
            } catch (e) {
                resendBtn.textContent = orig;
                resendBtn.disabled = false;
                toast("Erro: " + (typeof e === "string" ? e : e.message), "err");
            }
        };
    }
    var dismissBtn = document.getElementById("btn-dismiss-verify");
    if (dismissBtn) {
        dismissBtn.onclick = function () {
            document.getElementById("verify-bar").classList.add("hidden");
            // Lembra dismiss por 24h
            localStorage.setItem("mv_verify_dismissed_until", Date.now() + 24*60*60*1000);
        };
    }

    // Banner de reconexão: abre o gate sem destruir nada (cara reentra e continua)
    var reauthBtn = document.getElementById("btn-reauth");
    if (reauthBtn) {
        reauthBtn.onclick = function () {
            var email = localStorage.getItem("mv_email") || "";
            showGate("login");
            // Pré-preenche o email pra fluxo mais rápido
            setTimeout(function () {
                var input = document.getElementById("g-email");
                if (input && email) input.value = email;
            }, 50);
        };
    }
}

// Verifica status de email_verified e mostra banner se necessário
async function checkEmailVerified() {
    var token = localStorage.getItem("mv_session");
    if (!token) return;
    try {
        var r = await gateApi("/v1/me");
        var verified = r.user && r.user.email_verified;
        localStorage.setItem("mv_email_verified", verified ? "true" : "false");
        if (r.user && r.user.name) localStorage.setItem("mv_name", r.user.name);
        updateVerifyBar();
    } catch (e) { /* offline */ }
}

function updateVerifyBar() {
    var bar = document.getElementById("verify-bar");
    if (!bar) return;
    var verified = localStorage.getItem("mv_email_verified") === "true";
    var dismissedUntil = Number(localStorage.getItem("mv_verify_dismissed_until") || 0);
    if (verified || Date.now() < dismissedUntil) {
        bar.classList.add("hidden");
    } else {
        bar.classList.remove("hidden");
    }
}

/* Periodic heartbeat: every 5 min refresh license.
 * FILOSOFIA: NUNCA deslogar usuário automaticamente. Logout só acontece quando o cliente
 *   clica explicitamente em "Sair" no paywall. Casos automáticos:
 *     - Assinatura revogada/cancelada/expirada → mostra PAYWALL (mantém logado)
 *     - Device revogado                        → mostra PAYWALL (mantém logado)
 *     - Token JWT inválido/expirado            → mostra banner de RECONEXÃO
 *       (sessão expirou no backend, mas o plugin não apaga cache; cara reconecta sem perder estado)
 *     - Offline / 500 / timeout                → mantém license cached e continua funcionando
 */
function startHeartbeat() {
    if (DEV_BYPASS) return;
    var fp = computeFingerprint();
    var tick = async function () {
        try {
            var r = await gateApi("/v1/license/heartbeat", { fingerprint: fp });
            // Heartbeat OK → esconde banner de reconexão se estava aparecendo
            hideReauthBar();
            if (r.revoked || r.subscription_inactive) {
                localStorage.setItem("mv_plan", r.plan || "free");
                localStorage.setItem("mv_status", r.status || "revoked");
                if (r.expires_at) localStorage.setItem("mv_expires", r.expires_at);
                updateTrialUI();
                return;
            }
            if (r.license) {
                localStorage.setItem("mv_license", r.license);
                localStorage.setItem("mv_plan", r.plan);
                localStorage.setItem("mv_status", r.status || "");
                localStorage.setItem("mv_expires", r.expires_at || "");
                updateTrialUI();
            }
        } catch (e) {
            var msg = (typeof e === "string" ? e : (e && e.message)) || "";
            if (msg === "invalid_token" || msg === "missing_token") {
                // Sessão expirou no servidor. NÃO apaga nada do localStorage.
                // Mostra banner pedindo pra reconectar; cara segue usando offline com license cached.
                showReauthBar();
            }
            // Outros erros (offline, 500, timeout): mantém license cached, continua usando
        }
    };
    tick();
    setInterval(tick, 5 * 60 * 1000);
}

/* Banner não-destrutivo: aparece quando o JWT expirou e mostra botão "Reconectar".
 * Clicar reconectar abre o gate POR CIMA, mas mv_session/mv_license/etc seguem intactos.
 * Se o cara fechar o plugin sem reconectar, na próxima abertura ele continua logado
 * (o gate só aparece quando mv_session realmente não existe). */
function showReauthBar() {
    var bar = document.getElementById("reauth-bar");
    if (!bar) return;
    bar.classList.remove("hidden");
}
function hideReauthBar() {
    var bar = document.getElementById("reauth-bar");
    if (bar) bar.classList.add("hidden");
}

/* Restaura sessão do cache. Plugin NUNCA pede pra logar de novo se já tem token.
 * Mesmo que license esteja expirada/inválida, mantém logado e mostra paywall via heartbeat. */
function tryRestoreSession() {
    if (DEV_BYPASS) { hideGate(); return true; }
    var t = localStorage.getItem("mv_session");
    // Só precisa do session_token pra considerar logado.
    // License pode estar expirada — vai ser renovada no heartbeat ou bloqueada pelo paywall.
    if (t) {
        hideGate();
        return true;
    }
    // Sem token → primeira vez ou clicou Sair → mostra gate
    showGate("login");
    return false;
}

// ============================================================ boot
var BUILD = "2.5.1-keep-session";

/* Diagnostic dump: alert details about the first card's computed styles.
 * Triggered by Ctrl+Shift+D. Tells us exactly what the browser sees. */
document.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        var c = document.querySelector(".card");
        var t = c && c.querySelector(".card__thumb");
        var img = c && c.querySelector("img.frame");
        if (!c) { alert("Nenhum card encontrado"); return; }
        var ccs = getComputedStyle(c);
        var tcs = getComputedStyle(t);
        var ics = img ? getComputedStyle(img) : null;
        var msg = "BUILD: " + BUILD + "\n";
        msg += "body.classList: " + document.body.className + "\n\n";
        msg += "CARD:\n  size: " + Math.round(c.offsetWidth) + " x " + Math.round(c.offsetHeight) + "\n";
        msg += "  display: " + ccs.display + "\n";
        msg += "  position: " + ccs.position + "\n\n";
        msg += "THUMB:\n  size: " + Math.round(t.offsetWidth) + " x " + Math.round(t.offsetHeight) + "\n";
        msg += "  inline style: " + (t.getAttribute("style") || "(none)").substr(0, 200) + "\n";
        msg += "  computed height: " + tcs.height + "\n";
        msg += "  computed display: " + tcs.display + "\n";
        msg += "  computed position: " + tcs.position + "\n\n";
        if (img) {
            msg += "IMG:\n  natural: " + img.naturalWidth + " x " + img.naturalHeight + "\n";
            msg += "  rendered: " + Math.round(img.offsetWidth) + " x " + Math.round(img.offsetHeight) + "\n";
            msg += "  computed position: " + ics.position + "\n";
            msg += "  computed objectFit: " + ics.objectFit + "\n";
            msg += "  src: " + img.src.substr(0, 80) + "\n";
        }
        alert(msg);
    }
});
if (loadCatalog()) {
    buildIndex();
    renderTabs();
    if (CATALOG.packs.length) selectPack(CATALOG.packs[0].id);
    $("count").textContent = CATALOG.total_items.toLocaleString("pt-BR") + " templates · " + CATALOG.packs.length + " packs · build " + BUILD;
    $("status").textContent = "Pronto · build " + BUILD;
    bindGate();
    bindTrialUI();
    tryRestoreSession();
    updateTrialUI();
    updateVerifyBar();
    checkEmailVerified();
    startHeartbeat();
    hostPing();   // confirma que host.jsx carregou e logga status
}

})();
