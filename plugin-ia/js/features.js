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
            id: "smart-clean", view: "feat-smart-clean",
            icon: "✨", title: "Smart Clean",
            sub: "1 clique: calibra áudio + corta pausas + tira muletas",
            minTier: "basic", tech: "ffmpeg-local",
            prompt: "Roda a skill smart-clean no clip selecionado — limpeza completa em 1 passada"
        },
        {
            id: "cortar-pausas", view: "feat-cortar-pausas",
            icon: "🎯", title: "Cortar Pausas",
            sub: "Remove silêncios reais (dB) · auto-calibrado · 3 níveis",
            minTier: "basic", tech: "ffmpeg-local",
            prompt: "Roda a skill cortar pausas no clip selecionado com nível normal"
        },
        {
            id: "remove-fillers", view: "feat-remove-fillers",
            icon: "🗣️", title: "Tirar Muletas",
            sub: "Remove 'é, ahn, um, uh' e hesitações da fala",
            minTier: "basic", tech: "whisper-local",
            prompt: "Roda a skill remove-fillers no clip selecionado — tira muletas de fala (é, ahn, um, tipo)"
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
        // [legendas] feature removida do menu — redundante com plugin Motion Legendas
        // (61 mogrts + Estilo Global v4.25.1). Mantida no SKILLS map pro Agente IA
        // usar via "tools", mas não aparece no sidebar/grid.
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
            id: "gerar-video", view: "feat-gerar-video",
            icon: "🎬", title: "Gerar Vídeo IA",
            sub: "Seedance: foto + prompt → vídeo gerado por IA · via fal.ai",
            minTier: "pro", tech: "fal.ai · Seedance",
            prompt: "Gera um vídeo a partir da imagem de referência e do prompt do usuário usando Seedance via fal.ai"
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
            var isDisabled = f.disabled === true;
            var cls = "feat-card" + (unlocked && !isDisabled ? "" : " locked");
            var badge = "";
            if (isDisabled) badge = '<span class="feat-card__lock" title="' + (f.disabled_reason || "Em breve") + '">⏳</span>';
            else if (!unlocked) badge = '<span class="feat-card__lock">🔒</span>';
            var subText = isDisabled && f.disabled_reason ? f.disabled_reason : f.sub;
            return ''
                + '<div class="' + cls + '" data-feature="' + f.id + '"' + (isDisabled ? ' data-disabled="1"' : '') + '>'
                +   '<div class="feat-card__ico">' + f.icon + '</div>'
                +   '<div class="feat-card__title">' + f.title + '</div>'
                +   '<div class="feat-card__sub">' + subText + '</div>'
                +   badge
                + '</div>';
        }).join("");
        el.innerHTML = html;
        // bind clicks
        Array.prototype.forEach.call(el.querySelectorAll("[data-feature]"), function (card) {
            card.addEventListener("click", function () {
                if (card.dataset.disabled === "1") {
                    global.MIA && global.MIA.toast && global.MIA.toast("⏳ " + (card.querySelector(".feat-card__sub").textContent || "Em breve"), "warn", 3000);
                    return;
                }
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
        var levelSelect = function (id) {
            return '<div class="field"><label>Agressividade</label><select id="' + id + '">'
                +   '<option value="conservador">Conservador — só pausas longas</option>'
                +   '<option value="normal" selected>Normal — equilíbrio (recomendado)</option>'
                +   '<option value="agressivo">Agressivo — ritmo TikTok</option>'
                + '</select></div>';
        };
        var previewToggle = function () {
            return '<div class="field"><label><input type="checkbox" id="feat-preview-mode" checked> 👁 Pré-visualizar antes de aplicar (recomendado)</label></div>';
        };
        if (f.id === "smart-clean") {
            customInput = ''
                + levelSelect("feat-smart-level")
                + '<div class="field"><label><input type="checkbox" id="feat-smart-fillers" checked> Também remover muletas de fala (é/ahn/um)</label></div>'
                + '<div class="field"><label><input type="checkbox" id="feat-smart-fillers-aggr"> ↳ incluir muletas contextuais (tipo/então/aí)</label></div>'
                + previewToggle()
                + '<div class="hint">Limpeza completa: calibra o volume do teu áudio, corta os silêncios reais e tira as muletas — tudo numa passada só, sem desalinhar a timeline. Backup automático.</div>';
        }
        if (f.id === "cortar-pausas") {
            customInput = ''
                + levelSelect("feat-pausas-level")
                + previewToggle()
                + '<div class="hint">Detecta silêncio pelo volume REAL (dB) do áudio e auto-calibra pelo teu microfone. Deixa um respiro nas bordas pra não cortar abrupto. Backup automático.</div>';
        }
        if (f.id === "remove-fillers") {
            customInput = ''
                + '<div class="field"><label><input type="checkbox" id="feat-fillers-aggressive"> Modo agressivo (também tira tipo/então/aí/sabe)</label></div>'
                + previewToggle()
                + '<div class="hint">Modo seguro remove só hesitações inequívocas (é, éé, ahn, um, uh, hmm). O agressivo inclui muletas contextuais — revise depois. Backup automático.</div>';
        }
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
        if (f.id === "gerar-video") {
            customInput = ''
                + '<div class="field">'
                +   '<label>📸 Foto de referência</label>'
                +   '<div id="feat-gv-drop" style="border:2px dashed var(--line);border-radius:8px;padding:24px;text-align:center;cursor:pointer;background:var(--bg);transition:border-color .2s">'
                +     '<div id="feat-gv-drop-text" style="color:var(--mut);font-size:13px">Arrasta uma imagem aqui ou clica pra escolher</div>'
                +     '<div id="feat-gv-preview" style="margin-top:10px;display:none"><img id="feat-gv-img" style="max-width:100%;max-height:180px;border-radius:6px"></div>'
                +     '<input type="file" id="feat-gv-file" accept="image/png,image/jpeg,image/webp" style="display:none">'
                +   '</div>'
                + '</div>'
                + '<div class="field"><label>✏️ Prompt (descreva o movimento/cena)</label>'
                +   '<textarea id="feat-gv-prompt" rows="3" placeholder="ex: close em rosto sorrindo, luz dourada, câmera lenta, fundo desfocado"></textarea>'
                + '</div>'
                + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'
                +   '<div class="field"><label>⏱ Duração</label><select id="feat-gv-duration">'
                +     '<option value="5">5 segundos</option>'
                +     '<option value="10">10 segundos</option>'
                +   '</select></div>'
                +   '<div class="field"><label>📐 Aspect</label><select id="feat-gv-aspect">'
                +     '<option value="16:9">16:9 (Widescreen)</option>'
                +     '<option value="9:16">9:16 (Reels/Shorts)</option>'
                +     '<option value="1:1">1:1 (Quadrado)</option>'
                +   '</select></div>'
                +   '<div class="field"><label>🤖 Modelo</label><select id="feat-gv-model">'
                +     '<option value="seedance">Seedance (ByteDance)</option>'
                +     '<option value="kling-v2">Kling v2 (Kuaishou)</option>'
                +   '</select></div>'
                + '</div>'
                + '<div class="hint" style="margin-top:6px">Custo estimado: $0.10-0.50 por vídeo · pago direto no fal.ai (BYOK).</div>';
        }
        if (f.id === "transicoes") {
            customInput = buildTransitionsPicker();
        }
        if (f.id === "multicam") {
            customInput = ''
                + '<div class="field">'
                +   '<label>📋 Vídeos do projeto · marque 2+ pra fazer multicam</label>'
                +   '<div id="feat-mc-list" style="border:1px solid var(--line);border-radius:8px;max-height:260px;overflow:auto;background:var(--bg);padding:8px;min-height:80px">'
                +     '<div style="color:var(--mut);font-size:12px;padding:8px">Carregando lista...</div>'
                +   '</div>'
                +   '<div style="display:flex;gap:8px;margin-top:8px">'
                +     '<button id="feat-mc-reload" class="btn btn--sm" type="button">↻ Recarregar lista</button>'
                +     '<button id="feat-mc-selectall" class="btn btn--sm btn--ghost" type="button">Marcar todos</button>'
                +   '</div>'
                +   '<div id="feat-mc-count" class="hint" style="margin-top:8px">0 clip(s) selecionado(s)</div>'
                + '</div>';
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
        if (f.id === "gerar-video") bindGerarVideoPicker(view);
        if (f.id === "multicam")    bindMulticamPicker(view);

        var runBtn = document.getElementById("feat-run");
        if (!runBtn) return;

        runBtn.onclick = async function () {
            var opts = {};
            if (f.id === "smart-clean") {
                opts.aggressiveness = (document.getElementById("feat-smart-level") || {}).value || "normal";
                opts.fillers = !!(document.getElementById("feat-smart-fillers") || {}).checked;
                opts.aggressiveFillers = !!(document.getElementById("feat-smart-fillers-aggr") || {}).checked;
                opts.preview = !!(document.getElementById("feat-preview-mode") || {}).checked;
            }
            if (f.id === "cortar-pausas") {
                opts.aggressiveness = (document.getElementById("feat-pausas-level") || {}).value || "normal";
                opts.preview = !!(document.getElementById("feat-preview-mode") || {}).checked;
            }
            if (f.id === "remove-fillers") {
                opts.aggressive = !!(document.getElementById("feat-fillers-aggressive") || {}).checked;
                opts.preview = !!(document.getElementById("feat-preview-mode") || {}).checked;
            }
            if (f.id === "baixar") {
                opts.url = (document.getElementById("feat-baixar-url") || {}).value;
                opts.quality = (document.getElementById("feat-baixar-quality") || {}).value;
                if (!opts.url) { global.MIA.toast("URL obrigatória", "warn"); return; }
            }
            if (f.id === "auto-crop") {
                opts.aspect = (document.getElementById("feat-crop-aspect") || {}).value;
                opts.tracking = !!(document.getElementById("feat-crop-tracking") || {}).checked;
            }
            if (f.id === "multicam") {
                var checked = view.querySelectorAll('#feat-mc-list input[type="checkbox"]:checked');
                if (checked.length < 2) {
                    global.MIA && global.MIA.toast && global.MIA.toast("Marque pelo menos 2 vídeos na lista", "warn", 3000);
                    return;
                }
                opts.clip_names = Array.prototype.map.call(checked, function (cb) { return cb.dataset.name; });
            }
            if (f.id === "gerar-video") {
                var imgPath = view._gvImagePath || null;
                if (!imgPath) { global.MIA && global.MIA.toast && global.MIA.toast("Selecione uma imagem de referência", "warn"); return; }
                var promptEl = document.getElementById("feat-gv-prompt");
                var promptVal = promptEl ? promptEl.value.trim() : "";
                if (!promptVal) { global.MIA && global.MIA.toast && global.MIA.toast("Prompt obrigatório", "warn"); return; }
                opts.imagePath   = imgPath;
                opts.prompt      = promptVal;
                opts.duration    = parseInt((document.getElementById("feat-gv-duration") || {}).value || 5, 10);
                opts.aspectRatio = (document.getElementById("feat-gv-aspect") || {}).value || "16:9";
                opts.model       = (document.getElementById("feat-gv-model")  || {}).value || "seedance";
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
                // PREVIEW MODE: mostra os cortes + botão Aplicar (não mexeu na timeline ainda)
                if (result && result.preview && Array.isArray(result.ranges)) {
                    renderPreview(result, body);
                    global.MIA && global.MIA.toast && global.MIA.toast("👁 " + (result.summary || "Prévia pronta"), "info", 4000);
                } else {
                    body.innerHTML = ''
                        + '<div style="color:var(--ok);margin-bottom:10px;font-weight:600">✓ ' + esc(result.summary || "Concluído") + '</div>'
                        + (result.stats ? renderStats(result.stats) : '')
                        + '<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--mut);font-size:11px">ver detalhes técnicos</summary>'
                        + '<pre style="background:var(--bg-2);padding:10px;border-radius:6px;font-size:11px;overflow:auto;max-height:240px">' + esc(JSON.stringify(result, null, 2)) + '</pre></details>';
                    global.MIA && global.MIA.toast && global.MIA.toast("✓ " + (result.summary || f.title), "ok");
                }
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

    function fmtT(sec) {
        sec = Math.max(0, sec || 0);
        var m = Math.floor(sec / 60), s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 10);
        return m + ":" + (s < 10 ? "0" : "") + s + "." + ms;
    }

    // Painel de estatísticas (antes/depois, % comprimido, muletas)
    function renderStats(st) {
        if (!st) return '';
        var rows = [];
        if (st.clip_duration != null && st.new_duration != null) {
            rows.push(['Duração', fmtT(st.clip_duration) + ' → ' + fmtT(st.new_duration) + 's']);
        }
        if (st.compression_pct != null) rows.push(['Comprimido', '-' + st.compression_pct + '%']);
        if (st.total_cuts != null) rows.push(['Cortes totais', String(st.total_cuts)]);
        else if (st.cuts != null) rows.push(['Cortes', String(st.cuts)]);
        if (st.pauses != null) rows.push(['Pausas', String(st.pauses)]);
        if (st.fillers != null) rows.push(['Muletas', String(st.fillers)]);
        if (st.seconds_saved != null) rows.push(['Tempo economizado', st.seconds_saved + 's']);
        if (st.threshold_db != null) rows.push(['Threshold', st.threshold_db + 'dB' + (st.calibrated ? ' (auto-calibrado)' : '')]);
        if (st.audio_mean_db != null) rows.push(['Volume médio', st.audio_mean_db + 'dB']);
        var ex = st.filler_examples || st.examples;
        if (ex && ex.length) rows.push(['Ex. muletas', ex.slice(0, 8).join(', ')]);
        if (!rows.length) return '';
        return '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;background:var(--bg-2);padding:10px 12px;border-radius:8px;font-size:12px;margin-bottom:8px">'
            + rows.map(function (r) {
                return '<div style="color:var(--mut)">' + esc(r[0]) + '</div><div style="font-weight:600;text-align:right">' + esc(r[1]) + '</div>';
            }).join('') + '</div>';
    }

    // Renderiza a prévia dos cortes + botão "Aplicar" (timeline ainda intacta)
    function renderPreview(result, body) {
        var ranges = result.ranges || [];
        var list = ranges.slice(0, 60).map(function (r, i) {
            var dur = (r[1] - r[0]).toFixed(2);
            return '<div style="display:flex;justify-content:space-between;padding:3px 8px;border-bottom:1px solid var(--line);font-size:11px;font-family:monospace">'
                + '<span style="color:var(--mut)">#' + (i + 1) + '</span>'
                + '<span>' + fmtT(r[0]) + ' → ' + fmtT(r[1]) + '</span>'
                + '<span style="color:var(--accent)">-' + dur + 's</span></div>';
        }).join('');
        var more = ranges.length > 60 ? '<div style="text-align:center;color:var(--mut);font-size:11px;padding:6px">+ ' + (ranges.length - 60) + ' cortes…</div>' : '';

        body.innerHTML = ''
            + '<div style="color:var(--accent);margin-bottom:8px;font-weight:700;font-size:14px">👁 ' + esc(result.summary || 'Prévia') + '</div>'
            + (result.stats ? renderStats(result.stats) : '')
            + '<div style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-bottom:12px">' + list + more + '</div>'
            + '<div style="display:flex;gap:8px">'
            +   '<button id="feat-apply-preview" class="btn btn--primary" style="flex:1">✓ Aplicar os ' + ranges.length + ' cortes</button>'
            +   '<button id="feat-cancel-preview" class="btn btn--ghost">Cancelar</button>'
            + '</div>'
            + '<div class="hint" style="margin-top:6px">A timeline ainda está intacta. Revise acima e clique Aplicar. Um backup da sequência é criado antes.</div>';

        var applyBtn = document.getElementById("feat-apply-preview");
        var cancelBtn = document.getElementById("feat-cancel-preview");
        if (cancelBtn) cancelBtn.onclick = function () {
            body.innerHTML = '<div style="color:var(--mut)">Prévia descartada. Timeline intacta.</div>';
        };
        if (applyBtn) applyBtn.onclick = async function () {
            applyBtn.disabled = true; applyBtn.textContent = "Aplicando…";
            try {
                var r = await global.Skills.run("apply-cuts", { ranges: ranges, backupName: "antes_cortes" }, {});
                body.innerHTML = '<div style="color:var(--ok);font-weight:600">✓ ' + esc(r.summary || "Cortes aplicados") + '</div>';
                global.MIA && global.MIA.toast && global.MIA.toast("✓ " + (r.summary || "Aplicado"), "ok");
            } catch (e) {
                body.innerHTML = '<div style="color:var(--err);font-weight:600">❌ ' + esc(e.message) + '</div>';
                global.MIA && global.MIA.toast && global.MIA.toast("❌ " + e.message, "err", 5000);
            }
        };
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

    // ── HANDLER do picker de clips do MultiCam IA ───────────────────
    // Lista TODOS os vídeos do project panel via host.listProjectItems
    // e deixa o user marcar 2+ via checkbox. Contorna o bug de
    // app.project.getSelection() do Premiere.
    function bindMulticamPicker(view) {
        var listEl  = view.querySelector("#feat-mc-list");
        var countEl = view.querySelector("#feat-mc-count");
        var reload  = view.querySelector("#feat-mc-reload");
        var selAll  = view.querySelector("#feat-mc-selectall");
        if (!listEl) return;

        function updateCount() {
            var n = view.querySelectorAll('#feat-mc-list input[type="checkbox"]:checked').length;
            if (countEl) countEl.textContent = n + " clip(s) selecionado(s)";
        }

        async function loadList() {
            listEl.innerHTML = '<div style="color:var(--mut);font-size:12px;padding:8px">Carregando lista do Project Panel…</div>';
            try {
                // hostCall via window.ClaudeTools handler ou direct CSInterface
                var items = null;
                if (global.ClaudeTools && global.ClaudeTools.execute) {
                    items = await global.ClaudeTools.execute("list_clips", {});
                }
                if (!items || !Array.isArray(items.clips)) {
                    // fallback: chama listProjectItems direto via CSInterface
                    var cs2 = (typeof CSInterface !== "undefined") ? new CSInterface() : null;
                    if (cs2) {
                        var raw = await new Promise(function (res) {
                            cs2.evalScript("JSON.stringify(MotionProIA.listProjectItems())", function (r) { res(r); });
                        });
                        try { var pj = JSON.parse(raw); items = { clips: pj.items || [] }; } catch (_) { items = { clips: [] }; }
                    }
                }
                var videos = (items.clips || []).filter(function (it) {
                    // só items com mediaPath (vídeo/áudio), pula sequências e bins
                    if (!it) return false;
                    if (it.type === "SEQUENCE" || it.type === "BIN") return false;
                    var mp = (it.mediaPath || it.path || "").toLowerCase();
                    return /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(mp);
                });
                if (videos.length === 0) {
                    listEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:8px">Nenhum vídeo encontrado no Project Panel. Importe vídeos primeiro.</div>';
                    return;
                }
                listEl.innerHTML = videos.map(function (v) {
                    var name = (v.name || "").replace(/"/g, "&quot;");
                    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px" ' +
                           'onmouseenter="this.style.background=\'var(--bg-2)\'" onmouseleave="this.style.background=\'\'">'
                         + '<input type="checkbox" data-name="' + name + '">'
                         + '<span style="font-size:12px;font-family:ui-monospace,monospace">' + name + '</span>'
                         + '</label>';
                }).join("");
                // bind change pra atualizar count
                Array.prototype.forEach.call(listEl.querySelectorAll('input[type="checkbox"]'), function (cb) {
                    cb.addEventListener("change", updateCount);
                });
                updateCount();
            } catch (e) {
                listEl.innerHTML = '<div style="color:var(--err);font-size:12px;padding:8px">Erro carregando lista: ' + e.message + '</div>';
            }
        }

        if (reload) reload.addEventListener("click", loadList);
        if (selAll) selAll.addEventListener("click", function () {
            var allCb = listEl.querySelectorAll('input[type="checkbox"]');
            var anyUnchecked = Array.prototype.some.call(allCb, function (cb) { return !cb.checked; });
            Array.prototype.forEach.call(allCb, function (cb) { cb.checked = anyUnchecked; });
            updateCount();
        });
        loadList();
    }

    // ── HANDLER de drag&drop pro picker de imagem do Gerar Vídeo IA ──
    // Guarda o filePath em view._gvImagePath pro run handler pegar.
    function bindGerarVideoPicker(view) {
        var drop  = view.querySelector("#feat-gv-drop");
        var input = view.querySelector("#feat-gv-file");
        var preview = view.querySelector("#feat-gv-preview");
        var imgEl   = view.querySelector("#feat-gv-img");
        var textEl  = view.querySelector("#feat-gv-drop-text");
        if (!drop || !input) return;

        function setImage(filePath, dataUri) {
            view._gvImagePath = filePath;
            if (imgEl && dataUri) imgEl.src = dataUri;
            if (preview) preview.style.display = "block";
            if (textEl)  textEl.textContent = filePath ? ("✓ " + filePath.split(/[\\/]/).pop()) : "Arrasta uma imagem aqui ou clica pra escolher";
        }

        function readAsDataUri(file, cb) {
            var r = new FileReader();
            r.onload = function () { cb(r.result); };
            r.readAsDataURL(file);
        }

        drop.addEventListener("click", function () { input.click(); });
        drop.addEventListener("dragover", function (e) {
            e.preventDefault();
            drop.style.borderColor = "var(--acc)";
        });
        drop.addEventListener("dragleave", function () {
            drop.style.borderColor = "var(--line)";
        });
        drop.addEventListener("drop", function (e) {
            e.preventDefault();
            drop.style.borderColor = "var(--line)";
            var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) {
                // CEP: file.path tem o caminho real no disco
                var filePath = file.path || file.name;
                readAsDataUri(file, function (dataUri) { setImage(filePath, dataUri); });
            }
        });
        input.addEventListener("change", function () {
            var file = input.files && input.files[0];
            if (file) {
                var filePath = file.path || file.name;
                readAsDataUri(file, function (dataUri) { setImage(filePath, dataUri); });
            }
        });
    }

    function buildHowItWorks(f) {
        var map = {
            "whisper-local": "Usa Whisper.cpp (local, sem internet) pra transcrever o áudio word-level → detecta muletas/silêncios → executa ripple-delete no Premiere.",
            "ffmpeg-local": "Usa ffmpeg silencedetect (local, sem internet) pra medir o volume real (dB) do áudio → acha as pausas → deixa um respiro nas bordas → ripple-delete no Premiere. Backup automático antes.",
            "gemini": "Envia o vídeo selecionado pra Google Gemini 2.5 (vê o vídeo de verdade, multimodal) → análise temporal → executa ações no Premiere.",
            "extendscript": "Executa diretamente via ExtendScript no Premiere — sem internet, sem IA externa.",
            "whisper-local + extendscript": "Whisper local + comandos ExtendScript pra sincronização.",
            "yt-dlp": "yt-dlp local baixa do YouTube/Instagram/TikTok → ffmpeg processa → importa no Project Panel.",
            "ffmpeg": "ffmpeg local faz crop com tracking de rosto → reframe → reimporta no Premiere.",
            "api": "Busca em APIs externas (Pexels, Pixabay) → baixa via aria2c → importa.",
            "fal.ai · Seedance": "Sua foto + prompt → fal.ai roda Seedance/Kling → MP4 gerado por IA (~30-90s) → importa no Premiere automaticamente.",
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
