/* app.js — Motion IA v3 · orquestrador
 *
 * Responsável por:
 *   - Boot do plugin (auth + license + capabilities)
 *   - Roteamento entre views (home / chat / config / features)
 *   - Chat agentic (delega pra Agent.run)
 *   - License UI (delega pra LicenseClient)
 *   - Settings UI (delega pra SettingsUI)
 *   - Status bar
 */
"use strict";
(function () {

    var BUILD = "3.0.0";
    var $ = function (id) { return document.getElementById(id); };
    var cs = (typeof CSInterface !== "undefined") ? new CSInterface() : null;
    var chatHistory = [];

    // ───────────── helpers ─────────────
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]; }); }
    function toast(text, kind, ms) {
        var t = document.createElement("div");
        t.className = "toast " + (kind || "ok");
        t.textContent = text;
        $("toast-area").appendChild(t);
        setTimeout(function () { t.remove(); }, ms || 3000);
    }
    function marked(text) {
        var s = esc(text);
        s = s.replace(/```([\s\S]+?)```/g, function (_, code) { return "<pre>" + code + "</pre>"; });
        s = s.replace(/`([^`]+?)`/g, "<code>$1</code>");
        s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
        s = s.replace(/\n/g, "<br>");
        return s;
    }
    function fmtDate(d) {
        if (!d) return "—";
        try { return new Date(d).toLocaleString("pt-BR"); } catch (e) { return "—"; }
    }

    // ───────────── ROUTING ─────────────
    function go(view) {
        var allViews = document.querySelectorAll(".view");
        Array.prototype.forEach.call(allViews, function (v) {
            v.classList.toggle("active", v.id === "view-" + view);
        });
        // Sidebar highlight
        var allItems = document.querySelectorAll(".sidebar__item");
        Array.prototype.forEach.call(allItems, function (i) {
            i.classList.toggle("active", i.dataset.view === view);
        });
        if (view === "config") {
            refreshLicenseUI();
            if (window.SettingsUI && window.SettingsUI.init) window.SettingsUI.init();
        }
        if (view === "home" && window.MIA_Features) window.MIA_Features.renderHomeGrid();
    }

    // ───────────── LICENSE UI ─────────────
    function refreshLicenseUI() {
        var info = window.LicenseCache ? window.LicenseCache.info() : { status: "not_activated" };

        var card = $("lic-card");
        var statusEl = $("lic-status");

        card.className = "license-card " + (info.status === "active" ? "" : info.status || "inactive");

        if (info.status === "not_activated") {
            statusEl.textContent = "Não ativada";
            statusEl.className = "license-card__status inactive";
            $("lic-key").textContent       = "—";
            $("lic-validated").textContent = "—";
            $("lic-product").textContent   = "—";
            $("lic-tier").textContent      = "—";
            $("lic-devices").textContent   = "—";
        } else {
            var label = (info.status || "").toUpperCase();
            statusEl.textContent = label;
            statusEl.className = "license-card__status " + info.status;
            $("lic-key").textContent       = info.masked_key || "—";
            $("lic-validated").textContent = info.last_validation ? fmtDate(info.last_validation) : "—";
            $("lic-product").textContent   = (info.products || []).join(" · ") || "—";
            $("lic-tier").textContent      = (info.tier || "—").toUpperCase();
            $("lic-devices").textContent   = info.max_devices ? ("até " + info.max_devices) : "—";
        }

        if (window.MIA_Features) {
            window.MIA_Features.updateSidebarLocks();
        }
        updateStatusBar();
    }

    function bindLicenseActions() {
        $("lic-activate").onclick = async function () {
            var key = $("lic-input").value.trim();
            if (!key) { toast("Cole sua chave de licença", "warn"); return; }
            $("lic-activate").disabled = true; $("lic-activate").textContent = "Ativando…";
            try {
                var r = await window.LicenseClient.activate(key);
                toast("✓ Licença ativada · " + r.license.tier.toUpperCase(), "ok");
                $("lic-input").value = "";
                refreshLicenseUI();
                hidePaywall();
                // FORCE refresh: sidebar locks + home grid + tier badge
                if (window.MIA_Features) {
                    window.MIA_Features.updateSidebarLocks();
                    window.MIA_Features.renderHomeGrid();
                }
                updateStatusBar();
            } catch (e) {
                toast("❌ " + (e.data && e.data.error || e.message), "err", 5000);
            } finally {
                $("lic-activate").disabled = false; $("lic-activate").textContent = "Ativar Licença";
            }
        };
        $("lic-validate").onclick = async function () {
            try {
                var r = await window.LicenseClient.validate({ silent: false });
                toast(r.active ? "✓ Licença válida" : "❌ " + (r.error || "inválida"), r.active ? "ok" : "err");
                refreshLicenseUI();
            } catch (e) { toast("❌ " + e.message, "err"); }
        };
        $("lic-deactivate").onclick = async function () {
            if (!confirm("Desativar a licença NESTE device? Você poderá reativar depois.")) return;
            try {
                await window.LicenseClient.deactivate();
                toast("Licença desativada", "ok");
                refreshLicenseUI();
                if (window.MIA_Features) {
                    window.MIA_Features.updateSidebarLocks();
                    window.MIA_Features.renderHomeGrid();
                }
            } catch (e) { toast("❌ " + e.message, "err"); }
        };

        // Settings IA — Anthropic / Gemini / Pexels keys + modelo
        $("set-save").onclick = async function () {
            var btn = $("set-save"); btn.disabled = true; btn.textContent = "Salvando…";
            var result = $("set-result");
            try {
                // Salva Gemini local
                var geminiK = $("set-gemini-key").value.trim();
                if (geminiK) {
                    if (window.GeminiClient) window.GeminiClient.setKey(geminiK);
                }
                // Salva Pexels / Pixabay / Giphy local
                var pexK = $("set-pexels-key").value.trim();
                if (pexK) localStorage.setItem("mia_pexels_key", pexK);
                var pixaK = ($("set-pixabay-key") || {}).value;
                if (pixaK && pixaK.trim()) localStorage.setItem("mia_pixabay_key", pixaK.trim());
                var giphyK = ($("set-giphy-key") || {}).value;
                if (giphyK && giphyK.trim()) localStorage.setItem("mia_giphy_key", giphyK.trim());

                // Salva Anthropic via backend (BYOK opcional)
                var anthK = $("set-anthropic-key").value.trim();
                var model = $("set-model").value;
                var maxTokens = parseInt($("set-max-tokens").value, 10) || 4096;

                var token = localStorage.getItem("mv_session") || "";
                if (token) {
                    var payload = { model: model, max_tokens: maxTokens };
                    if (anthK) payload.anthropic_key = anthK;
                    var r = await fetch((window.MV_CONFIG.apiBaseUrl || "https://motionpro.vercel.app") + "/v1/me/ai-settings", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
                        body: JSON.stringify(payload)
                    });
                    if (!r.ok) throw new Error("ai_settings_" + r.status);
                }

                // Update settings cache flag for status bar
                var cache = { anthropic_key_set: !!anthK || true, gemini_key_set: !!geminiK || (window.GeminiClient && window.GeminiClient.hasKey()), pexels_key_set: !!pexK || !!localStorage.getItem("mia_pexels_key") };
                localStorage.setItem("mia_settings_cache", JSON.stringify(cache));

                result.style.color = "var(--ok)";
                result.textContent = "✓ Configuração salva";
                $("set-anthropic-key").value = "";
                $("set-gemini-key").value = "";
                $("set-pexels-key").value = "";
                if ($("set-pixabay-key")) $("set-pixabay-key").value = "";
                if ($("set-giphy-key"))   $("set-giphy-key").value = "";
                updateStatusBar();
                toast("✓ Config salva", "ok");
            } catch (e) {
                result.style.color = "var(--err)";
                result.textContent = "❌ " + e.message;
            } finally {
                btn.disabled = false; btn.textContent = "💾 Salvar configuração";
            }
        };

        $("set-test").onclick = async function () {
            var result = $("set-result");
            result.style.color = "var(--mut)";
            result.innerHTML = "Testando…";
            var lines = [];
            // Gemini
            if (window.GeminiClient && window.GeminiClient.hasKey()) {
                var g = await window.GeminiClient.validate();
                lines.push((g.ok ? "✓" : "✗") + " Gemini: " + (g.ok ? "OK" : g.error));
            } else lines.push("○ Gemini: sem key");
            // Pexels
            var pexK = localStorage.getItem("mia_pexels_key");
            if (pexK) {
                try {
                    var r = await fetch("https://api.pexels.com/videos/search?query=test&per_page=1", { headers: { "Authorization": pexK } });
                    lines.push((r.ok ? "✓" : "✗") + " Pexels: " + (r.ok ? "OK" : "HTTP " + r.status));
                } catch (e) { lines.push("✗ Pexels: " + e.message); }
            } else lines.push("○ Pexels: sem key");
            // Pixabay
            var pixaK = localStorage.getItem("mia_pixabay_key");
            if (pixaK) {
                try {
                    var rp = await fetch("https://pixabay.com/api/videos/?key=" + encodeURIComponent(pixaK) + "&q=test&per_page=3");
                    lines.push((rp.ok ? "✓" : "✗") + " Pixabay: " + (rp.ok ? "OK" : "HTTP " + rp.status));
                } catch (e) { lines.push("✗ Pixabay: " + e.message); }
            } else lines.push("○ Pixabay: sem key");
            // Giphy
            var giphyK = localStorage.getItem("mia_giphy_key");
            if (giphyK) {
                try {
                    var rg = await fetch("https://api.giphy.com/v1/gifs/search?api_key=" + encodeURIComponent(giphyK) + "&q=test&limit=1");
                    lines.push((rg.ok ? "✓" : "✗") + " Giphy: " + (rg.ok ? "OK" : "HTTP " + rg.status));
                } catch (e) { lines.push("✗ Giphy: " + e.message); }
            } else lines.push("○ Giphy: sem key");
            // Whisper local
            if (window.BinRunner) {
                lines.push((window.BinRunner.exists("whisper-cli") ? "✓" : "✗") + " whisper-cli.exe: " + (window.BinRunner.exists("whisper-cli") ? "OK" : "não instalado"));
                lines.push((window.BinRunner.exists("ffmpeg") ? "✓" : "✗") + " ffmpeg.exe: " + (window.BinRunner.exists("ffmpeg") ? "OK" : "não instalado"));
                lines.push((window.BinRunner.exists("yt-dlp") ? "✓" : "✗") + " yt-dlp.exe: " + (window.BinRunner.exists("yt-dlp") ? "OK" : "não instalado"));
            }
            // License
            if (window.LicenseClient) {
                lines.push((window.LicenseClient.isReady() ? "✓" : "✗") + " License: " + (window.LicenseClient.isReady() ? "ativa offline" : "não ativada/expirada"));
            }
            result.innerHTML = lines.join("<br>");
            result.style.color = "var(--txt)";
        };

        // Carrega settings preenche fields
        loadSettingsIntoUI();
    }

    async function loadSettingsIntoUI() {
        try {
            var token = localStorage.getItem("mv_session") || "";
            if (!token) return;
            var r = await fetch((window.MV_CONFIG.apiBaseUrl || "https://motionpro.vercel.app") + "/v1/me/ai-settings", {
                headers: { "Authorization": "Bearer " + token }
            });
            if (r.ok) {
                var d = await r.json();
                if (d.model) $("set-model").value = d.model;
                if (d.max_tokens) $("set-max-tokens").value = d.max_tokens;
                if (d.anthropic_key_set) $("set-anthropic-key").placeholder = "Configurado · " + (d.anthropic_key_mask || "");
            }
        } catch (e) {}
        // Gemini / Pexels: locais
        if (window.GeminiClient && window.GeminiClient.hasKey()) {
            $("set-gemini-key").placeholder = "Configurada · ✓";
        }
        if (localStorage.getItem("mia_pexels_key")) {
            $("set-pexels-key").placeholder = "Configurada · ✓";
        }
    }

    // ───────────── PAYWALL ─────────────
    function showPaywall() {
        $("paywall").classList.remove("hidden");
    }
    function hidePaywall() {
        $("paywall").classList.add("hidden");
    }
    function checkPaywall() {
        // Master account (admin/lifetime) nunca vê paywall
        var meta;
        try { meta = JSON.parse(localStorage.getItem("mia_user_meta") || "{}"); } catch (_) { meta = {}; }
        if (meta.is_admin || meta.lifetime) { hidePaywall(); return; }
        var tier = window.MIA_Features ? window.MIA_Features.userTier() : "free";
        // Show paywall só quando user CLICA num feature que precisa de tier maior
        // Aqui não auto-show. Apenas valida.
        if (tier === "free") {
            // free tem só home/chat — features ficam locked
            // não força paywall no boot
        } else {
            hidePaywall();
        }
    }

    // ───────────── STATUS BAR ─────────────
    function updateStatusBar() {
        var bar = $("status-bar");
        if (!bar) return;
        bar.classList.remove("hidden");
        // Premiere
        var dPr = $("dot-premiere");
        if (cs) {
            cs.evalScript("typeof MotionProIA", function (r) {
                dPr.className = "dot " + (String(r).indexOf("object") >= 0 || String(r).indexOf("function") >= 0 ? "ok" : "warn");
            });
        }
        // License
        var dLic = $("dot-license");
        if (window.LicenseClient && window.LicenseClient.isReady()) {
            dLic.className = "dot ok";
        } else {
            dLic.className = "dot warn";
        }
        // Claude key (configurado?)
        var dCl = $("dot-claude");
        try {
            var settings = JSON.parse(localStorage.getItem("mia_settings_cache") || "{}");
            dCl.className = "dot " + (settings.anthropic_key_set ? "ok" : "warn");
        } catch (_) { dCl.className = "dot warn"; }
        // Gemini
        var dGm = $("dot-gemini");
        try {
            var s2 = JSON.parse(localStorage.getItem("mia_settings_cache") || "{}");
            dGm.className = "dot " + (s2.gemini_key_set ? "ok" : "");
        } catch (_) { dGm.className = "dot"; }
    }

    // ───────────── CHAT (Agent) ─────────────
    function addBubble(role, text, opts) {
        opts = opts || {};
        var stream = $("chat-stream");
        var wrap = document.createElement("div");
        wrap.className = "chat__msg chat__msg--" + role + (opts.tool ? " chat__msg--tool" : "");
        wrap.innerHTML = ''
            + '<div class="chat__avatar">' + (role === "user" ? "EU" : "IA") + '</div>'
            + '<div class="chat__bubble"></div>';
        wrap.querySelector(".chat__bubble").innerHTML = marked(text);
        stream.appendChild(wrap);
        stream.scrollTop = stream.scrollHeight;
        return wrap.querySelector(".chat__bubble");
    }

    async function runAgent(message) {
        if (!message) return;
        addBubble("user", message);
        var bubble = addBubble("ai", "…");
        $("chat-send").disabled = true;
        var acc = "";
        try {
            var result = await window.Agent.run({
                message: message,
                history: chatHistory,
                maxIterations: 12,
                callbacks: {
                    onText: function (t) { acc += (acc ? "\n\n" : "") + t; bubble.innerHTML = marked(acc); },
                    onToolStart: function (n, i) { addBubble("ai", "🔧 " + n + " " + JSON.stringify(i).slice(0, 100), { tool: true }); },
                    onToolResult: function (n, ok, out) {
                        var s = ok ? "✓" : "✗";
                        var summary = "";
                        if (out && typeof out === "object") {
                            if (out.count !== undefined) summary += " · " + out.count + " items";
                            if (out.silences_removed !== undefined) summary += " · " + out.silences_removed + " silêncios";
                        }
                        addBubble("ai", s + " " + n + summary, { tool: true });
                    }
                }
            });
            chatHistory = result.messages || chatHistory;
        } catch (e) {
            bubble.innerHTML = "⚠️ " + esc(e.message);
            if (e.message.indexOf("api_key") >= 0 || e.message.indexOf("Configure") >= 0) {
                go("config");
            }
        } finally {
            $("chat-send").disabled = false;
        }
    }

    function bindChat() {
        $("chat-send").onclick = function () {
            var msg = $("chat-input").value.trim();
            if (msg) { $("chat-input").value = ""; runAgent(msg); }
        };
        $("chat-input").addEventListener("keydown", function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                $("chat-send").click();
            }
        });
    }

    // ───────────── NAVIGATION ─────────────
    function bindNav() {
        var items = document.querySelectorAll(".sidebar__item");
        Array.prototype.forEach.call(items, function (item) {
            // A11y: torna navegável por teclado (Enter/Space) já que é um <div>
            if (!item.hasAttribute("role"))      item.setAttribute("role", "button");
            if (!item.hasAttribute("tabindex"))  item.setAttribute("tabindex", "0");
            if (item.classList.contains("locked")) item.setAttribute("aria-disabled", "true");

            var handle = function () {
                var view = item.dataset.view;
                var fid  = item.dataset.feature;
                if (fid) {
                    window.MIA_Features.openFeature(fid);
                } else if (view) {
                    go(view);
                }
            };
            item.addEventListener("click", handle);
            item.addEventListener("keydown", function (e) {
                if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                    e.preventDefault();
                    handle();
                }
            });
        });
    }

    // ───────────── BOOT ─────────────
    async function boot() {
        // 1. Toast area sempre disponível
        // 2. Auth check
        try {
            if (window.Auth && window.Auth.init) {
                window.Auth.init();
            }
        } catch (e) { console.error("[boot] auth fail:", e); }

        // 3. Mostra app (UI base)
        $("app").classList.remove("hidden");
        $("status-bar").classList.remove("hidden");

        // 4. Bindings
        bindNav();
        bindChat();
        bindLicenseActions();

        // 5. License auto-validate background
        if (window.LicenseClient && window.LicenseClient.startAutoValidate) {
            window.LicenseClient.startAutoValidate(24);
        }

        // 6. Features render
        if (window.MIA_Features) {
            window.MIA_Features.renderHomeGrid();
            window.MIA_Features.updateSidebarLocks();
        }

        // 7. License UI
        refreshLicenseUI();

        // 8. Sidebar email
        var email = localStorage.getItem("mv_email") || localStorage.getItem("mia_email") || "—";
        $("sb-email").textContent = email;

        // 9. Status bar
        updateStatusBar();
        setInterval(updateStatusBar, 15000);

        // 10. Bootstrap explícito do host.jsx via HostBridge.bootstrap().
        // Defesa em profundidade: setTimeout 500ms dá chance pro evento AppOnline
        // do CEP disparar primeiro (host-bridge.js também escuta esse evento).
        // Chamar cs.evalScript() cedo demais em --mixed-context corrompe o engine
        // ExtendScript permanentemente — não fazer.
        setTimeout(function () {
            if (window.HostBridge && window.HostBridge.bootstrap) {
                window.HostBridge.bootstrap().then(function (ok) {
                    if (!ok) {
                        toast("⚠ host.jsx não carregou — abra um projeto no Premiere e clique 'Revalidar' em ⚙ Config", "warn", 8000);
                    } else {
                        console.log("[boot] host.jsx OK · ExtendScript pronto");
                    }
                });
            }
        }, 500);

        // 11. Paywall logout
        $("pw-logout").onclick = function () {
            if (window.Auth && window.Auth.logout) window.Auth.logout();
            location.reload();
        };

        // 12. Onboarding tour — SÓ dispara depois do login (auth:ready event).
        // { once: true } garante que múltiplos auth:ready não criem múltiplos tours.
        document.addEventListener("auth:ready", function () {
            if (window.Tour && !window.Tour.isDone()) {
                setTimeout(function () { try { window.Tour.start(false); } catch (_) {} }, 600);
            }
        }, { once: true });
        var tourBtn = document.getElementById("set-tour-restart");
        if (tourBtn) {
            tourBtn.onclick = function () {
                if (!window.Tour) return;
                window.Tour.reset();
                window.Tour.start(true);
            };
        }

        // Botão Diagnóstico — mostra paths, host.jsx state, binários etc
        var diagBtn = document.getElementById("set-diagnostico");
        if (diagBtn) {
            diagBtn.onclick = async function () {
                var out = document.getElementById("set-diag-output");
                out.style.display = "block";
                out.textContent = "🔄 Coletando diagnóstico…";
                var lines = [];
                lines.push("═══ MOTION IA · DIAGNÓSTICO ═══");
                lines.push("BUILD: " + BUILD);
                lines.push("Premiere version: " + (navigator.userAgent || "?"));
                lines.push("");
                lines.push("── CSInterface (extension path) ──");
                try {
                    var p = cs ? cs.getSystemPath("extension") : null;
                    lines.push("getSystemPath('extension'): " + p);
                } catch (e) { lines.push("ERR: " + e.message); }
                lines.push("");
                lines.push("── BinRunner ──");
                if (window.BinRunner) {
                    try {
                        var diag = window.BinRunner.diagnose ? window.BinRunner.diagnose() : null;
                        if (diag) {
                            lines.push("extPath: " + diag.ext);
                            lines.push("bin_dir: " + diag.bin_dir);
                            lines.push("platform: " + diag.platform);
                            Object.keys(diag.bins).forEach(function (n) {
                                var b = diag.bins[n];
                                lines.push((b.exists ? "✓" : "✗") + " " + n + ": " + b.path);
                            });
                        } else {
                            lines.push("BinRunner.diagnose() não disponível");
                        }
                    } catch (e) { lines.push("ERR: " + e.message); }
                } else {
                    lines.push("✗ BinRunner não carregado");
                }
                lines.push("");
                lines.push("── HostBridge (host.jsx) ──");
                if (window.HostBridge) {
                    lines.push("isReady: " + window.HostBridge.isReady());

                    // TEST 1: ExtendScript respondendo? (sem evalFile)
                    var t1 = await new Promise(function (res) {
                        cs.evalScript("1+1", function (r) { res(r); });
                    });
                    lines.push("Test 1 (eval '1+1'): " + t1 + (t1 === "2" ? " ✓" : " ✗"));

                    // TEST 2: app object disponível?
                    var t2 = await new Promise(function (res) {
                        cs.evalScript("typeof app", function (r) { res(r); });
                    });
                    lines.push("Test 2 (typeof app): " + t2);

                    // TEST 3: app.project disponível? (precisa projeto aberto)
                    var t3 = await new Promise(function (res) {
                        cs.evalScript("(app && app.project) ? (app.project.name || 'unnamed') : 'no_project'", function (r) { res(r); });
                    });
                    lines.push("Test 3 (app.project): " + t3);

                    // TEST 4: tentar evalFile direto e ver retorno
                    var extPathStr = cs.getSystemPath("extension").replace(/\\/g, "/");
                    var jsxFullPath = extPathStr + "/jsx/host.jsx";
                    var t4 = await new Promise(function (res) {
                        var s =
                            "(function(){" +
                            "  try {" +
                            "    var f = File('" + jsxFullPath.replace(/'/g, "\\'") + "');" +
                            "    if (!f.exists) return 'file_not_found:' + f.fsName;" +
                            "    var r = $.evalFile(f);" +
                            "    var hasGlobal = ($.global.MotionProIA && typeof $.global.MotionProIA.ping === 'function');" +
                            "    var hasLocal = (typeof MotionProIA !== 'undefined' && typeof MotionProIA.ping === 'function');" +
                            "    return 'evalfile=' + r + '|global=' + hasGlobal + '|local=' + hasLocal;" +
                            "  } catch(e) { return 'exception:' + (e.message || e); }" +
                            "})()";
                        cs.evalScript(s, function (r) { res(r); });
                    });
                    lines.push("Test 4 (evalFile direto):");
                    lines.push("  path: " + jsxFullPath);
                    lines.push("  result: " + t4);

                    // TEST 5: ping após force-reload
                    try {
                        window.HostBridge.bootstrap && (window.HostBridge.bootstrap.__force = true);
                        var pingResult = await window.HostBridge.ping();
                        lines.push("Test 5 (ping()): " + JSON.stringify(pingResult));
                    } catch (e) {
                        lines.push("Test 5 (ping()) ERR: " + e.message);
                    }
                } else {
                    lines.push("✗ HostBridge não carregado");
                }
                lines.push("");
                lines.push("── License ──");
                if (window.LicenseCache) {
                    var lc = window.LicenseCache.load();
                    if (lc) {
                        lines.push("Status: " + lc.status);
                        lines.push("Tier: " + lc.tier);
                        lines.push("Products: " + JSON.stringify(lc.products));
                    } else { lines.push("Sem licença cached"); }
                }
                lines.push("");
                lines.push("── User Meta ──");
                try {
                    var meta = JSON.parse(localStorage.getItem("mia_user_meta") || "{}");
                    lines.push(JSON.stringify(meta, null, 2));
                } catch (e) {}
                out.textContent = lines.join("\n");
            };
        }

        console.log("[Motion IA v" + BUILD + "] boot completo");
    }

    // ───────────── API GLOBAL ─────────────
    window.MIA = {
        go:          go,
        toast:       toast,
        runAgent:    runAgent,
        refreshLicense: refreshLicenseUI,
        BUILD:       BUILD
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
