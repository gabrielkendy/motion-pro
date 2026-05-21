/* features.js — Motion IA v3
 *
 * Catálogo das 12 features + gate de tier + render de cada feature view.
 *
 * Tier hierarchy: free < basic < pro < lifetime
 * (lifetime libera tudo. pro libera tudo exceto features futuras "enterprise")
 */
(function (global) {
    "use strict";

    var TIER_RANK = { free: 0, basic: 1, pro: 2, lifetime: 3 };

    var FEATURES = [
        {
            id: "cortar-pausas", view: "feat-cortar-pausas",
            icon: "🎯", title: "Cortar Pausas",
            sub: "Remove silêncios automaticamente via Whisper",
            minTier: "basic", tech: "whisper-local",
            prompt: "Roda a skill cortar pausas no clip selecionado"
        },
        {
            id: "cortar-erros", view: "feat-cortar-erros",
            icon: "🎬", title: "Cortar Erros",
            sub: "IA detecta takes ruins / duplicados e remove",
            minTier: "pro", tech: "gemini",
            prompt: "Analisa o vídeo selecionado com Gemini, identifica takes ruins ou duplicados (a pessoa errou e falou de novo) e me dá uma lista de timestamps pra cortar"
        },
        {
            id: "caca-trechos", view: "feat-caca-trechos",
            icon: "⚡", title: "Caça-Trechos",
            sub: "Acha os 3-5 melhores momentos pra shorts/reels",
            minTier: "pro", tech: "gemini",
            prompt: "Analisa o vídeo selecionado e identifica 3-5 trechos virais pra fazer shorts. Me dá os timestamps de cada um (start/end) e por que cada trecho é forte"
        },
        {
            id: "capitulos", view: "feat-capitulos",
            icon: "📖", title: "Capítulos IA",
            sub: "Marcadores de capítulo automáticos no Premiere",
            minTier: "pro", tech: "gemini",
            prompt: "Analisa o vídeo e cria marcadores de capítulo no Premiere. Cada capítulo deve ter título curto e timestamp de início"
        },
        {
            id: "legendas", view: "feat-legendas",
            icon: "💬", title: "Legendas IA",
            sub: "Integra com Motion Legendas pra captionar word-level",
            minTier: "basic", tech: "whisper-local + motion-legendas",
            prompt: "Transcreve o clip selecionado word-level e gera legenda animada via Motion Legendas"
        },
        {
            id: "copiar-seq", view: "feat-copiar-seq",
            icon: "✂️", title: "Copiar Sequência",
            sub: "Copia sequência completa entre projetos com 1 click",
            minTier: "basic", tech: "extendscript",
            prompt: "Copia a sequência ativa pro clipboard pra colar em outro projeto"
        },
        {
            id: "transicoes", view: "feat-transicoes",
            icon: "🎞️", title: "Transições IA",
            sub: "Aplica transições inteligentes entre cortes",
            minTier: "basic", tech: "extendscript",
            prompt: "Aplica transições suaves (cross dissolve) entre todos os cortes da sequência ativa"
        },
        {
            id: "bins", view: "feat-bins",
            icon: "📁", title: "Organizar Bins",
            sub: "Reorganiza Project Panel por tipo/data automático",
            minTier: "basic", tech: "extendscript",
            prompt: "Reorganiza o Project Panel criando bins automáticos por tipo (Vídeos, Áudios, Imagens, Sequências)"
        },
        {
            id: "multicam", view: "feat-multicam",
            icon: "📹", title: "MultiCam IA",
            sub: "Sincroniza multicam automático via áudio Whisper",
            minTier: "pro", tech: "whisper-local + extendscript",
            prompt: "Sincroniza os clips selecionados num multicam usando análise de áudio"
        },
        {
            id: "baixar", view: "feat-baixar",
            icon: "⬇️", title: "Baixar Vídeo",
            sub: "Download de YouTube/Insta/TikTok via yt-dlp local",
            minTier: "basic", tech: "yt-dlp",
            prompt: null // tem UI própria
        },
        {
            id: "auto-crop", view: "feat-auto-crop",
            icon: "📐", title: "Auto Crop",
            sub: "Reframe automático 9:16 / 1:1 com face tracking",
            minTier: "pro", tech: "ffmpeg",
            prompt: "Faz auto crop 9:16 do clip selecionado com tracking de rosto"
        },
        {
            id: "stock", view: "feat-stock",
            icon: "📚", title: "Biblioteca Stock",
            sub: "Pexels + Pixabay + Giphy direto no plugin · import 1 click",
            minTier: "basic", tech: "api",
            prompt: null // tem UI própria (busca)
        },
        {
            id: "casper", view: "feat-casper",
            icon: "👻", title: "Casper · Auto-edit",
            sub: "Roda regras encadeadas (pausas + bins + transições + …) num click",
            minTier: "pro", tech: "extendscript",
            prompt: null // UI dedicada
        }
    ];

    // ── helpers ─────────────────────────────────────────────────────
    function getById(id) { return FEATURES.find(function (f) { return f.id === id; }); }
    function getByView(view) { return FEATURES.find(function (f) { return f.view === view; }); }

    function tierAtLeast(currentTier, requiredTier) {
        if (!currentTier) return false;
        return (TIER_RANK[currentTier] || 0) >= (TIER_RANK[requiredTier] || 0);
    }

    function userTier() {
        // 1. Cache offline (license key ativada). LicenseCache é AES-GCM
        // criptografado e fingerprint-bound, então é a fonte de verdade.
        var lc = global.LicenseCache ? global.LicenseCache.load() : null;
        if (lc && lc.tier && lc.status === "active") return lc.tier;
        // 2. Admin verificado via backend (/v1/me retornou is_admin=true).
        // Esse valor é setado APÓS verificação via JWT contra backend, não
        // é apenas localStorage manual editável via DevTools. Token JWT é
        // validado por /v1/me toda sessão, então admin fake não passa.
        try {
            var meta = JSON.parse(localStorage.getItem("mia_user_meta") || "{}");
            if (meta.is_admin_verified) return "lifetime";
        } catch (_) {}
        // 3. Default: free.
        return "free";
    }

    function isUnlocked(featureId) {
        var f = getById(featureId);
        if (!f) return false;
        return tierAtLeast(userTier(), f.minTier);
    }

    // ── HOME GRID — renderiza atalhos ───────────────────────────────
    function renderHomeGrid() {
        var el = document.getElementById("home-grid");
        if (!el) return;
        var tier = userTier();
        var html = FEATURES.map(function (f) {
            var unlocked = tierAtLeast(tier, f.minTier);
            var cls = "feat-card" + (unlocked ? "" : " locked");
            var badge = unlocked
                ? ""
                : '<span class="feat-card__lock">🔒</span>';
            return ''
                + '<div class="' + cls + '" data-feature="' + f.id + '">'
                +   '<div class="feat-card__ico">' + f.icon + '</div>'
                +   '<div class="feat-card__title">' + f.title + '</div>'
                +   '<div class="feat-card__sub">' + f.sub + '</div>'
                +   badge
                + '</div>';
        }).join("");
        el.innerHTML = html;
        // bind clicks
        Array.prototype.forEach.call(el.querySelectorAll("[data-feature]"), function (card) {
            card.addEventListener("click", function () {
                var fid = card.dataset.feature;
                openFeature(fid);
            });
        });
    }

    // ── SIDEBAR — atualiza lock icons baseado no tier ───────────────
    function updateSidebarLocks() {
        var tier = userTier();
        var items = document.querySelectorAll(".sidebar__item[data-feature]");
        Array.prototype.forEach.call(items, function (item) {
            var fid = item.dataset.feature;
            var f = getById(fid);
            if (!f) return;
            var unlocked = tierAtLeast(tier, f.minTier);
            item.classList.toggle("locked", !unlocked);
            var lockEl = item.querySelector(".lock");
            if (lockEl) lockEl.textContent = unlocked ? "" : "🔒";
        });
        // Tier badge no rodapé
        var sbTier = document.getElementById("sb-tier");
        if (sbTier) {
            sbTier.textContent = (tier || "FREE").toUpperCase();
            sbTier.className = "tier-badge" + (tier === "free" ? " free" : "");
        }
    }

    // ── ABRIR FEATURE ────────────────────────────────────────────────
    function openFeature(featureId) {
        var f = getById(featureId);
        if (!f) return;
        var unlocked = isUnlocked(featureId);
        if (!unlocked) {
            global.MIA && global.MIA.toast && global.MIA.toast(
                "🔒 " + f.title + " requer plano " + f.minTier.toUpperCase() + ". Ative uma licença em ⚙ Config.", "warn", 4500);
            global.MIA && global.MIA.go && global.MIA.go("config");
            return;
        }
        // Renderiza a view feature dedicada
        renderFeatureView(f);
        global.MIA && global.MIA.go && global.MIA.go("feature");
    }

    function renderFeatureView(f) {
        var view = document.getElementById("view-feature");
        if (!view) return;

        // UI especial pra features com input customizado
        var customInput = "";
        if (f.id === "baixar") {
            customInput = ''
                + '<div class="field"><label>URL do vídeo</label><input id="feat-baixar-url" placeholder="https://youtube.com/watch?v=…"></div>'
                + '<div class="field"><label>Qualidade</label><select id="feat-baixar-quality"><option value="best">Melhor (1080p)</option><option value="audio">Só áudio (MP3)</option></select></div>';
        }
        if (f.id === "auto-crop") {
            customInput = ''
                + '<div class="field"><label>Formato</label><select id="feat-crop-aspect">'
                +   '<option value="9:16">9:16 (Reels/Shorts)</option>'
                +   '<option value="1:1">1:1 (Instagram)</option>'
                +   '<option value="4:5">4:5 (Feed)</option>'
                + '</select></div>'
                + '<div class="field"><label><input type="checkbox" id="feat-crop-tracking" checked> Face tracking inteligente (recomendado)</label></div>';
        }
        if (f.id === "stock") {
            customInput = ''
                + '<div class="field"><label>Buscar</label><input id="feat-stock-query" placeholder="ex: oceano, cidade, pessoa correndo"></div>'
                + '<div class="field"><label>Fonte</label><select id="feat-stock-source">'
                +   '<option value="pexels">Pexels (vídeos HD)</option>'
                +   '<option value="pixabay">Pixabay (vídeos HD)</option>'
                +   '<option value="giphy">Giphy (GIFs animados)</option>'
                +   '<option value="all">Todas (mais resultados)</option>'
                + '</select></div>';
        }
        if (f.id === "transicoes") {
            customInput = buildTransitionsPicker();
        }
        if (f.id === "legendas") {
            customInput = ''
                + '<div class="field"><label>Estilo da legenda</label><select id="feat-legendas-style">'
                +   '<option value="viral">Viral — Impact gigante + highlight amarelo</option>'
                +   '<option value="tiktok">TikTok — Arial Black + verde</option>'
                +   '<option value="reels">Reels — Montserrat + magenta</option>'
                +   '<option value="classic">Clássico — Arial branco/laranja</option>'
                +   '<option value="minimal">Minimalista — sem cor</option>'
                + '</select></div>';
        }
        if (f.id === "casper") {
            // Casper tem UI completamente customizada — rendereriza e retorna
            return renderCasperView(f, view);
        }

        var ctaBlock = '<button id="feat-run" class="btn btn--primary">▶ Executar agora</button>';

        view.innerHTML = ''
            + '<div class="main__header">'
            +   '<div>'
            +     '<h1>' + f.icon + ' ' + f.title + '</h1>'
            +     '<div class="sub">' + f.sub + '</div>'
            +   '</div>'
            +   '<div><span class="badge badge--ok">' + f.minTier.toUpperCase() + '</span></div>'
            + '</div>'
            + '<div class="main__body">'
            +   '<div class="card">'
            +     '<div class="card__head"><div class="card__title">Como funciona</div></div>'
            +     '<p style="margin-bottom:14px">' + buildHowItWorks(f) + '</p>'
            +     customInput
            +     ctaBlock
            +   '</div>'
            +   '<div class="card" id="feat-result-card" style="display:none">'
            +     '<div class="card__head"><div class="card__title">Progresso & Resultado</div></div>'
            +     '<div id="feat-progress" style="font-family:monospace;font-size:12px;color:var(--mut);min-height:20px;margin-bottom:10px"></div>'
            +     '<div id="feat-result-body"></div>'
            +   '</div>'
            + '</div>';

        // Bind click handlers para pickers visuais
        if (f.id === "transicoes") bindTransitionsPicker(view);

        var runBtn = document.getElementById("feat-run");
        if (!runBtn) return;

        runBtn.onclick = async function () {
            var opts = {};
            if (f.id === "baixar") {
                opts.url = (document.getElementById("feat-baixar-url") || {}).value;
                opts.quality = (document.getElementById("feat-baixar-quality") || {}).value;
                if (!opts.url) { global.MIA.toast("URL obrigatória", "warn"); return; }
            }
            if (f.id === "auto-crop") {
                opts.aspect = (document.getElementById("feat-crop-aspect") || {}).value;
                opts.tracking = !!(document.getElementById("feat-crop-tracking") || {}).checked;
            }
            if (f.id === "stock") {
                opts.query = (document.getElementById("feat-stock-query") || {}).value;
                opts.source = (document.getElementById("feat-stock-source") || {}).value || "pexels";
                if (!opts.query) { global.MIA.toast("Termo obrigatório", "warn"); return; }
            }
            if (f.id === "transicoes") {
                var pick = view.querySelector(".trans-item.is-selected");
                opts.transition = pick ? pick.dataset.transition : "cross-dissolve";
                opts.duration_sec = parseFloat((document.getElementById("feat-trans-duration") || {}).value) || 1;
            }
            if (f.id === "legendas") {
                opts.style = (document.getElementById("feat-legendas-style") || {}).value || "viral";
            }

            document.getElementById("feat-result-card").style.display = "block";
            var prog = document.getElementById("feat-progress");
            var body = document.getElementById("feat-result-body");
            prog.textContent = "Iniciando…"; body.innerHTML = "";
            runBtn.disabled = true; runBtn.classList.add("loading"); runBtn.textContent = "Executando…";

            try {
                if (!global.Skills) throw new Error("Skills runtime não carregada");
                var result = await global.Skills.run(f.id, opts, {
                    onProgress: function (ev) {
                        var line = "[" + (ev.step || "...") + "] " + (ev.msg || "");
                        if (ev.percent != null) line += " · " + Math.round(ev.percent * 100) + "%";
                        prog.innerHTML += line + "<br>";
                        prog.scrollTop = prog.scrollHeight;
                    }
                });
                body.innerHTML = ''
                    + '<div style="color:var(--ok);margin-bottom:10px;font-weight:600">✓ ' + (result.summary || "Concluído") + '</div>'
                    + '<pre style="background:var(--bg-2);padding:10px;border-radius:6px;font-size:11px;overflow:auto;max-height:300px">' + esc(JSON.stringify(result, null, 2)) + '</pre>';
                global.MIA && global.MIA.toast && global.MIA.toast("✓ " + (result.summary || f.title), "ok");
            } catch (e) {
                body.innerHTML = '<div style="color:var(--err);font-weight:600">❌ ' + esc(e.message) + '</div>';
                global.MIA && global.MIA.toast && global.MIA.toast("❌ " + e.message, "err", 5000);
            } finally {
                runBtn.disabled = false; runBtn.classList.remove("loading"); runBtn.textContent = "▶ Executar agora";
            }
        };
    }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c];
        });
    }

    // ── PICKER de Transições ──────────────────────────────────────
    function buildTransitionsPicker() {
        var cat = (global.Skills && global.Skills.transitions) || [];
        if (!cat.length) {
            return '<div class="field"><div style="color:var(--mut)">Catálogo de transições não carregado.</div></div>';
        }
        var items = cat.map(function (t, idx) {
            var sel = idx === 0 ? " is-selected" : "";
            return ''
                + '<div class="trans-item' + sel + '" data-transition="' + t.id + '" title="' + esc(t.desc) + '" role="button" tabindex="0">'
                +   '<div class="trans-item__demo trans-item__demo--' + t.demo + '"></div>'
                +   '<div class="trans-item__name">' + esc(t.name) + '</div>'
                +   '<div class="trans-item__sub">' + esc(t.desc) + '</div>'
                + '</div>';
        }).join("");
        return ''
            + '<div class="field"><label>Escolha a transição</label>'
            +   '<div class="trans-grid">' + items + '</div>'
            + '</div>'
            + '<div class="field"><label>Duração (segundos)</label>'
            +   '<input type="number" id="feat-trans-duration" value="1" min="0.1" max="5" step="0.1">'
            + '</div>';
    }

    // ── CASPER · Editor de Regras ─────────────────────────────────
    function renderCasperView(f, view) {
        var rules = (global.Skills && global.Skills.getCasperRules) ? global.Skills.getCasperRules() : [];

        view.innerHTML = ''
            + '<div class="main__header">'
            +   '<div>'
            +     '<h1>' + f.icon + ' ' + f.title + '</h1>'
            +     '<div class="sub">' + f.sub + '</div>'
            +   '</div>'
            +   '<div><span class="badge badge--ok">' + f.minTier.toUpperCase() + '</span></div>'
            + '</div>'
            + '<div class="main__body">'
            +   '<div class="card">'
            +     '<div class="card__head">'
            +       '<div class="card__title">Regras encadeadas</div>'
            +       '<button id="casper-add" class="btn">+ Adicionar regra</button>'
            +     '</div>'
            +     '<div id="casper-rules"></div>'
            +     '<div style="display:flex;gap:8px;margin-top:14px">'
            +       '<button id="casper-run" class="btn btn--primary">▶ Rodar Casper</button>'
            +       '<button id="casper-save" class="btn">💾 Salvar regras</button>'
            +       '<button id="casper-reset" class="btn">↺ Restaurar padrão</button>'
            +     '</div>'
            +   '</div>'
            +   '<div class="card" id="casper-result-card" style="display:none">'
            +     '<div class="card__head"><div class="card__title">Progresso</div></div>'
            +     '<div id="casper-progress" style="font-family:monospace;font-size:12px;color:var(--mut);min-height:30px;margin-bottom:10px"></div>'
            +     '<div id="casper-result-body"></div>'
            +   '</div>'
            + '</div>';

        function renderRules() {
            var box = document.getElementById("casper-rules");
            if (!box) return;
            var skills = global.Skills ? global.Skills.list() : [];
            box.innerHTML = rules.map(function (r, idx) {
                var skillOpts = skills.map(function (s) {
                    return '<option value="' + s + '"' + (s === r.skill ? " selected" : "") + '>' + s + '</option>';
                }).join("");
                return ''
                    + '<div class="rule-row" data-idx="' + idx + '">'
                    +   '<label><input type="checkbox" data-field="enabled"' + (r.enabled !== false ? " checked" : "") + '> ativa</label>'
                    +   '<select data-field="skill">' + skillOpts + '</select>'
                    +   '<input type="text" data-field="label" value="' + esc(r.label || "") + '" placeholder="rótulo">'
                    +   '<button data-action="del" class="btn" title="Remover">✕</button>'
                    + '</div>';
            }).join("");

            Array.prototype.forEach.call(box.querySelectorAll(".rule-row"), function (row) {
                var idx = parseInt(row.dataset.idx, 10);
                row.querySelector('[data-field="enabled"]').onchange = function (e) { rules[idx].enabled = e.target.checked; };
                row.querySelector('[data-field="skill"]').onchange   = function (e) { rules[idx].skill = e.target.value; };
                row.querySelector('[data-field="label"]').oninput    = function (e) { rules[idx].label = e.target.value; };
                row.querySelector('[data-action="del"]').onclick     = function () { rules.splice(idx, 1); renderRules(); };
            });
        }
        renderRules();

        document.getElementById("casper-add").onclick = function () {
            rules.push({ skill: "cortar-pausas", opts: {}, enabled: true, label: "Nova regra" });
            renderRules();
        };
        document.getElementById("casper-save").onclick = function () {
            if (global.Skills && global.Skills.setCasperRules) global.Skills.setCasperRules(rules);
            global.MIA && global.MIA.toast && global.MIA.toast("Regras salvas", "ok");
        };
        document.getElementById("casper-reset").onclick = function () {
            rules = (global.Skills && global.Skills.casperDefaults) ? global.Skills.casperDefaults.slice() : [];
            renderRules();
            global.MIA && global.MIA.toast && global.MIA.toast("Regras restauradas", "ok");
        };
        document.getElementById("casper-run").onclick = async function () {
            var btn = this;
            btn.disabled = true; btn.textContent = "⏳ Rodando…";
            document.getElementById("casper-result-card").style.display = "block";
            var prog = document.getElementById("casper-progress");
            var body = document.getElementById("casper-result-body");
            prog.textContent = ""; body.innerHTML = "";
            try {
                if (!global.Skills) throw new Error("Skills runtime não carregada");
                var result = await global.Skills.run("casper", { rules: rules }, {
                    onProgress: function (ev) {
                        var line = (ev.msg || "");
                        if (ev.percent != null) line += " · " + Math.round(ev.percent * 100) + "%";
                        prog.innerHTML += line + "<br>";
                        prog.scrollTop = prog.scrollHeight;
                    }
                });
                body.innerHTML = ''
                    + '<div style="color:var(--ok);margin-bottom:10px;font-weight:600">✓ ' + esc(result.summary) + '</div>'
                    + '<pre style="background:var(--bg-2);padding:10px;border-radius:6px;font-size:11px;overflow:auto;max-height:300px">' + esc(JSON.stringify(result, null, 2)) + '</pre>';
                global.MIA && global.MIA.toast && global.MIA.toast(result.summary, result.ok ? "ok" : "warn");
            } catch (e) {
                body.innerHTML = '<div style="color:var(--err);font-weight:600">❌ ' + esc(e.message) + '</div>';
                global.MIA && global.MIA.toast && global.MIA.toast("❌ " + e.message, "err", 5000);
            } finally {
                btn.disabled = false; btn.textContent = "▶ Rodar Casper";
            }
        };
    }

    // ── HANDLER de click no preview de transição ────────────────
    function bindTransitionsPicker(view) {
        var grid = view.querySelector(".trans-grid");
        if (!grid) return;
        grid.addEventListener("click", function (e) {
            var item = e.target.closest && e.target.closest(".trans-item");
            if (!item) return;
            Array.prototype.forEach.call(grid.querySelectorAll(".trans-item"), function (n) { n.classList.remove("is-selected"); });
            item.classList.add("is-selected");
        });
    }

    function buildHowItWorks(f) {
        var map = {
            "whisper-local": "Usa Whisper.cpp (local, sem internet) pra transcrever o áudio word-level → analisa silêncios → executa ripple-delete no Premiere.",
            "gemini": "Envia o vídeo selecionado pra Google Gemini 2.5 (vê o vídeo de verdade, multimodal) → análise temporal → executa ações no Premiere.",
            "extendscript": "Executa diretamente via ExtendScript no Premiere — sem internet, sem IA externa.",
            "whisper-local + extendscript": "Whisper local + comandos ExtendScript pra sincronização.",
            "yt-dlp": "yt-dlp local baixa do YouTube/Instagram/TikTok → ffmpeg processa → importa no Project Panel.",
            "ffmpeg": "ffmpeg local faz crop com tracking de rosto → reframe → reimporta no Premiere.",
            "api": "Busca em APIs externas (Pexels, Pixabay) → baixa via aria2c → importa.",
            "whisper-local + motion-legendas": "Whisper transcreve word-level → envia pro plugin Motion Legendas que renderiza MOGRT animado."
        };
        return map[f.tech] || "Feature do Motion IA.";
    }

    global.MIA_Features = {
        list:           FEATURES,
        getById:        getById,
        getByView:      getByView,
        userTier:       userTier,
        tierAtLeast:    tierAtLeast,
        isUnlocked:     isUnlocked,
        openFeature:    openFeature,
        renderHomeGrid: renderHomeGrid,
        updateSidebarLocks: updateSidebarLocks
    };
})(typeof window !== "undefined" ? window : globalThis);
