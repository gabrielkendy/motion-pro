/* onboarding-tour.js — Motion IA v3.1
 *
 * Tour interativo na primeira execução. Mostra os passos críticos:
 *   1. Boas-vindas / o que é Motion IA
 *   2. Sidebar com 13 features
 *   3. Como ativar licença (config)
 *   4. Casper · Auto-edit (a feature mais poderosa)
 *   5. Chat IA (modo livre)
 *
 * Estado salvo em localStorage("mia_tour_done") — só roda 1x.
 * Pode ser re-disparado via Tour.start(true).
 */
(function (global) {
    "use strict";

    var STEPS = [
        {
            target: null,
            title: "Bem-vindo ao Motion IA 👋",
            body: 'Sou seu editor IA dentro do Premiere Pro. Vou te mostrar em 30 segundos onde tudo está.',
            place: "center"
        },
        {
            target: ".sidebar__section + .sidebar__item, [data-feature]",
            title: "Sidebar de Features",
            body: "Aqui ficam as 13 ferramentas: Cortar Pausas, Caça-Trechos, Legendas IA, Auto Crop, Casper… Cada uma usa IA ou processamento local.",
            place: "right"
        },
        {
            target: '[data-feature="casper"]',
            title: "👻 Casper · Auto-edit",
            body: "A feature mais poderosa: encadeia regras (cortar pausas + bins + transições…) e executa tudo num click. Personaliza as regras como quiser.",
            place: "right"
        },
        {
            target: '[data-view="chat"]',
            title: "💬 Modo Chat",
            body: 'Quer algo customizado? Conversa direto com o agente: <i>"corta os silêncios > 0.5s e aplica cross dissolve"</i>.',
            place: "right"
        },
        {
            target: '[data-view="config"]',
            title: "⚙️ Licença & API Keys",
            body: "Pra usar tudo, ative sua licença (chave MIA-XXXX) e configure sua key Google Gemini (obrigatória, gratuita em aistudio.google.com) + fal.ai opcional (pra gerar vídeos via Seedance). Whisper roda offline.",
            place: "right"
        },
        {
            target: null,
            title: "Pronto! 🚀",
            body: "Você pode reabrir esse tour a qualquer momento em Config → Ajuda → Refazer tour. Boa edição!",
            place: "center"
        }
    ];

    var current = 0;
    var backdrop = null;
    var card = null;
    var highlight = null;

    function done() {
        try { localStorage.setItem("mia_tour_done", "1"); } catch (_) {}
        isRunning = false;
        cleanup();
    }

    function isDone() {
        try { return localStorage.getItem("mia_tour_done") === "1"; }
        catch (_) { return false; }
    }

    function cleanup() {
        // Defensive: remove TODOS os elementos do tour que possam ter ficado órfãos
        // (caso start() tenha sido chamado 2x ou o card.remove() falhou silenciosamente)
        var orphans = document.querySelectorAll(".onboard-backdrop, .tour-highlight, .onboard-card");
        Array.prototype.forEach.call(orphans, function (e) { e.remove(); });
        backdrop = null;
        highlight = null;
        card = null;
    }

    function ensureLayer() {
        if (backdrop) return;
        backdrop = document.createElement("div");
        backdrop.className = "onboard-backdrop";
        document.body.appendChild(backdrop);

        highlight = document.createElement("div");
        highlight.className = "tour-highlight";
        document.body.appendChild(highlight);
    }

    function findTarget(sel) {
        if (!sel) return null;
        try { return document.querySelector(sel); }
        catch (_) { return null; }
    }

    function positionCard(card, target, place) {
        if (!target || place === "center") {
            card.style.position = "fixed";
            card.style.left = "50%";
            card.style.top = "50%";
            card.style.transform = "translate(-50%,-50%)";
            return;
        }
        var rect = target.getBoundingClientRect();
        card.style.position = "fixed";
        card.style.transform = "none";
        if (place === "right") {
            card.style.left = Math.min(window.innerWidth - 360, rect.right + 16) + "px";
            card.style.top  = Math.max(16, Math.min(window.innerHeight - 220, rect.top)) + "px";
        } else if (place === "left") {
            card.style.left = Math.max(16, rect.left - 360) + "px";
            card.style.top  = Math.max(16, rect.top) + "px";
        } else if (place === "bottom") {
            card.style.left = Math.max(16, Math.min(window.innerWidth - 360, rect.left)) + "px";
            card.style.top  = Math.min(window.innerHeight - 220, rect.bottom + 12) + "px";
        } else {
            card.style.left = "50%"; card.style.top = "50%";
            card.style.transform = "translate(-50%,-50%)";
        }
    }

    function highlightTarget(target) {
        if (!highlight) return;
        if (!target) { highlight.style.display = "none"; return; }
        var rect = target.getBoundingClientRect();
        highlight.style.display = "block";
        highlight.style.left   = (rect.left - 6) + "px";
        highlight.style.top    = (rect.top  - 6) + "px";
        highlight.style.width  = (rect.width  + 12) + "px";
        highlight.style.height = (rect.height + 12) + "px";
    }

    function render() {
        ensureLayer();
        var step = STEPS[current];
        if (!step) { done(); return; }

        var target = findTarget(step.target);
        highlightTarget(target);

        // Defensive: remove TODOS .onboard-card existentes (não confia na var card)
        var stale = document.querySelectorAll(".onboard-card");
        Array.prototype.forEach.call(stale, function (e) { e.remove(); });
        card = document.createElement("div");
        card.className = "onboard-card";

        var dots = STEPS.map(function (_, i) {
            return '<span class="onboard-card__dot' + (i === current ? " active" : "") + '"></span>';
        }).join("");

        var prevBtn = current > 0 ? '<button class="btn" data-act="prev">‹ Voltar</button>' : '';
        var nextLabel = current === STEPS.length - 1 ? "Concluir ✓" : "Próximo ›";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-labelledby", "onb-title");
        card.setAttribute("aria-describedby", "onb-body");
        card.innerHTML = ''
            + '<div id="onb-title" class="onboard-card__title">' + step.title + '</div>'
            + '<div id="onb-body" class="onboard-card__body">' + step.body + '</div>'
            + '<div class="onboard-card__dots">' + dots + '</div>'
            + '<div class="onboard-card__actions">'
            +   '<button class="btn btn--ghost" data-act="skip">Pular</button>'
            +   prevBtn
            +   '<button class="btn btn--primary" data-act="next" autofocus>' + nextLabel + '</button>'
            + '</div>';
        document.body.appendChild(card);
        positionCard(card, target, step.place);

        card.querySelectorAll("[data-act]").forEach(function (b) {
            b.onclick = function () {
                var a = b.dataset.act;
                if (a === "skip") return done();
                if (a === "prev") { current = Math.max(0, current - 1); render(); return; }
                if (a === "next") {
                    if (current === STEPS.length - 1) return done();
                    current++; render();
                }
            };
        });
    }

    var isRunning = false;
    function start(force) {
        if (isRunning) return false; // já tem um tour rodando — ignora segunda chamada
        if (!force && isDone()) return false;
        cleanup(); // garante limpeza de estados anteriores
        isRunning = true;
        current = 0;
        render();
        return true;
    }

    // Re-render no resize
    if (typeof window !== "undefined") {
        window.addEventListener("resize", function () {
            if (card) {
                var step = STEPS[current];
                var target = findTarget(step && step.target);
                positionCard(card, target, step && step.place);
                highlightTarget(target);
            }
        });
    }

    global.Tour = {
        start:  start,
        isDone: isDone,
        reset:  function () { try { localStorage.removeItem("mia_tour_done"); } catch (_) {} },
        STEPS:  STEPS
    };
})(typeof window !== "undefined" ? window : globalThis);
