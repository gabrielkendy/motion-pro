/* catalog.js — loads the unified catalog.json, organizes it, exposes search.
 *
 * Catalog can come from:
 *   - Backend (encrypted JSON, AES-GCM key inside the user's JWT license)
 *   - Local file (./catalog/catalog.json) for offline / dev mode
 *
 * Schema (see tools/catalog-builder.js):
 *   {
 *     version: "2026.05.16",
 *     packs: [
 *       { id, name, badge, color, count, categories: [ { name, children: [...] | items: [...] } ] }
 *     ]
 *   }
 *   item = { id, name, mogrt, preview, w, h, duration, tags[] }
 */
const Catalog = (function () {
    let data = null;
    let flatIndex = [];

    function extPath() {
        const cs = new CSInterface();
        const root = cs.getSystemPath(CSInterface.SystemPath.EXTENSION);
        return root || ".";
    }

    function readLocalCatalogFs() {
        try {
            const fs = (typeof require === "function") ? require("fs") : null;
            if (!fs) return null;
            const raw = fs.readFileSync(extPath() + "/catalog/catalog.json", "utf8");
            return JSON.parse(raw);
        } catch (e) {
            console.warn("readLocalCatalogFs failed:", e.message);
            return null;
        }
    }

    async function readLocalCatalogFetch() {
        try {
            const r = await fetch("catalog/catalog.json", { cache: "no-store" });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            console.warn("readLocalCatalogFetch failed:", e.message);
            return null;
        }
    }

    async function load() {
        // 1) prefer the inline <script> bundle (sempre funciona em CEP)
        let cat = (typeof window !== "undefined" && window.MV_CATALOG) ? window.MV_CATALOG : null;
        // 2) fallback node fs (caso o catalog.js não tenha sido carregado)
        if (!cat) cat = readLocalCatalogFs();
        // 3) fallback fetch
        if (!cat) cat = await readLocalCatalogFetch();
        // 4) server (apenas se devMode=false)
        if (!cat && (!window.MV_CONFIG || !window.MV_CONFIG.devMode)) {
            try { cat = await API.catalog("latest"); } catch (e) {}
        }
        if (!cat) throw new Error("Catálogo não encontrado");
        data = cat;
        buildIndex();
        return data;
    }

    function buildIndex() {
        flatIndex = [];
        if (!data || !data.packs) return;
        for (const pack of data.packs) {
            walk(pack.categories || [], pack, []);
        }
    }
    function walk(nodes, pack, breadcrumb) {
        for (const n of nodes) {
            if (n.items) {
                for (const it of n.items) {
                    flatIndex.push({
                        packId: pack.id, packName: pack.name,
                        cat: breadcrumb.concat(n.name).join(" › "),
                        item: it
                    });
                }
            }
            if (n.children) walk(n.children, pack, breadcrumb.concat(n.name));
        }
    }

    function getPacks() { return (data && data.packs) || []; }
    function getPack(id) { return getPacks().find(p => p.id === id); }

    function getCategoriesFor(packId) {
        const p = getPack(packId);
        return p ? (p.categories || []) : [];
    }

    function getItemsForCategory(packId, categoryPath) {
        // categoryPath = array of names ["01. Typography", "Big Typo"]
        let cur = getCategoriesFor(packId);
        for (const part of categoryPath) {
            const found = (cur || []).find(c => c.name === part);
            if (!found) return [];
            if (found.children) { cur = found.children; continue; }
            if (found.items) return found.items;
            return [];
        }
        // if path ends on a category that has items
        const last = categoryPath[categoryPath.length - 1];
        const found = (cur || []).find(c => c.name === last);
        return (found && found.items) || [];
    }

    function search(query, limit) {
        const q = (query || "").trim().toLowerCase();
        if (!q) return [];
        const out = [];
        for (const r of flatIndex) {
            const hay = (r.item.name + " " + r.cat + " " + r.packName).toLowerCase();
            if (hay.indexOf(q) >= 0) {
                out.push(r);
                if (out.length >= (limit || 200)) break;
            }
        }
        return out;
    }

    function totalCount() {
        return flatIndex.length;
    }

    return {
        load, getPacks, getPack, getCategoriesFor, getItemsForCategory, search, totalCount,
        data: () => data
    };
})();
