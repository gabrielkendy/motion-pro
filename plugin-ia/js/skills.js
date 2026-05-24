/* skills.js — Motion IA v3
 *
 * 12 SKILLS (handlers compostas) — cada feature do sidebar dispara uma skill.
 * Skills usam BinRunner (ffmpeg/whisper local) + GeminiClient + HostBridge.
 *
 * Cada skill retorna Promise<{ ok, summary, details }> e emite eventos via callback.
 *
 * API:
 *   Skills.run(skillId, opts, callbacks) → Promise<result>
 *   Skills.list() → lista de skill ids
 */
(function (global) {
    "use strict";

    var nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) || global.require;
    var fs   = nodeRequire ? nodeRequire("fs")   : null;
    var path = nodeRequire ? nodeRequire("path") : null;
    var os   = nodeRequire ? nodeRequire("os")   : null;

    // ───────── HELPERS ─────────
    function tmp(name) {
        return path.join(os.tmpdir(), "motionia_" + Date.now() + "_" + name);
    }

    async function hostCall(fn, args) {
        if (!global.HostBridge) throw new Error("host_bridge_unavailable");
        // Usa a função do host-bridge.js
        var bridge = global.HostBridge;
        if (bridge[fn]) return await bridge[fn].apply(null, args || []);
        // fallback: chama via evalJsx genérico
        if (bridge.evalJsx) {
            var argsStr = (args || []).map(function (a) { return JSON.stringify(a); }).join(",");
            return await bridge.evalJsx("MotionProIA." + fn + "(" + argsStr + ");");
        }
        throw new Error("hostCall_no_method");
    }

    async function getSelectedClipPath() {
        var r = await hostCall("getSelectedMediaPath");
        if (!r.path) throw new Error("Selecione um clip na timeline primeiro");
        return r.path;
    }

    function emit(cb, ev, data) {
        if (cb && cb[ev]) cb[ev](data);
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 1 — CORTAR PAUSAS (Whisper local)
    // ═══════════════════════════════════════════════════════════════
    // Níveis de agressividade pra deteccao de silencio.
    // noise = limiar em dB (mais negativo = só corta silencio MAIS fundo).
    // dur   = duracao minima do silencio pra contar (segundos).
    var SILENCE_LEVELS = {
        conservador: { noise: -38, dur: 0.7 },   // só pausas longas e bem silenciosas
        normal:      { noise: -32, dur: 0.45 },  // equilibrio (default)
        agressivo:   { noise: -26, dur: 0.28 }   // corta tudo, ritmo TikTok
    };

    async function cortarPausas(opts, cb) {
        emit(cb, "onProgress", { step: "validate", msg: "Validando pré-requisitos…" });
        if (!global.BinRunner) throw new Error("bin_runner_missing");
        if (!global.BinRunner.exists("ffmpeg")) throw new Error("ffmpeg.exe não instalado. Rode tools/download-bin-motion-ia.ps1");

        emit(cb, "onProgress", { step: "get_clip", msg: "Pegando clip selecionado…" });
        var videoPath = await getSelectedClipPath();

        // Resolve nivel de agressividade (ou valores custom)
        var lvl     = SILENCE_LEVELS[opts.aggressiveness] || SILENCE_LEVELS.normal;
        var noiseDb = (opts.noiseDb != null) ? opts.noiseDb : lvl.noise;
        var minSil  = (opts.minSilenceSec != null) ? opts.minSilenceSec : lvl.dur;
        // Margin assimétrico (técnica do auto-editor): deixa um respiro de silêncio
        // nas bordas pra não cortar abrupto. marginPost (antes da próxima fala) é
        // maior porque cortar o ATAQUE de consoante soa pior que cortar respiração.
        var marginPre  = (opts.marginPreMs  != null ? opts.marginPreMs  : 60)  / 1000;
        var marginPost = (opts.marginPostMs != null ? opts.marginPostMs : 120) / 1000;
        // Min do range final a deletar — evita microcortes que estragam o ritmo.
        var minDelete  = (opts.minDeleteSec != null ? opts.minDeleteSec : 0.15);

        // 1. ffmpeg silencedetect — mede dB REAL do audio (muito mais preciso que
        //    gaps de transcrição, que o Whisper "estica" cobrindo as pausas).
        emit(cb, "onProgress", { step: "detect", msg: "Analisando áudio (silencedetect " + noiseDb + "dB / " + minSil + "s)…" });
        var res = await global.BinRunner.run("ffmpeg", [
            "-hide_banner", "-i", videoPath,
            "-af", "silencedetect=noise=" + noiseDb + "dB:d=" + minSil,
            "-f", "null", "-"
        ], { allowNonZero: true, timeoutMs: 5 * 60 * 1000 });

        // 2. Parse stderr: pares silence_start / silence_end
        var text = (res.stderr || "") + (res.stdout || "");
        var rawSilences = parseSilenceDetect(text);

        // 3. Aplica margin assimétrico (encolhe range). Descarta microcortes.
        var silences = [];
        rawSilences.forEach(function (r) {
            var s = r[0] + marginPre;
            var e = r[1] - marginPost;
            if (e - s >= minDelete) silences.push([s, e]);
        });

        emit(cb, "onProgress", { step: "found", msg: silences.length + " silêncios detectados (de " + rawSilences.length + " brutos)" });

        if (silences.length === 0) {
            var hint = rawSilences.length > 0
                ? "Achei " + rawSilences.length + " pausas mas todas curtas demais pós-margin. Tente nível 'agressivo'."
                : "Nenhuma pausa detectada (nível " + (opts.aggressiveness || "normal") + " · " + noiseDb + "dB). Áudio pode ter ruído de fundo alto — tente 'agressivo' ou ajuste o dB.";
            return { ok: true, summary: hint, silences: 0 };
        }

        // 4. Backup
        emit(cb, "onProgress", { step: "backup", msg: "Duplicando sequência (backup)…" });
        try { await hostCall("duplicateActiveSequence", ["antes_cortar_pausas"]); } catch (_) {}

        // 5. Ripple delete (do fim pro começo pra não desalinhar offsets)
        emit(cb, "onProgress", { step: "execute", msg: "Removendo " + silences.length + " silêncios…" });
        var ordered = silences.slice().sort(function (a, b) { return b[0] - a[0]; });
        await hostCall("deleteRanges", [ordered]);

        var totalSaved = silences.reduce(function (s, r) { return s + (r[1] - r[0]); }, 0);

        return {
            ok: true,
            summary: silences.length + " pausas removidas · " + totalSaved.toFixed(1) + "s economizados (nível " + (opts.aggressiveness || "normal") + ")",
            silences_removed: silences.length,
            total_seconds_saved: totalSaved,
            level: opts.aggressiveness || "normal"
        };
    }

    // Parseia o stderr do ffmpeg silencedetect em pares [start, end].
    // Formato:
    //   [silencedetect @ ..] silence_start: 12.345
    //   [silencedetect @ ..] silence_end: 13.567 | silence_duration: 1.222
    function parseSilenceDetect(text) {
        var lines = text.split(/\r?\n/);
        var out = [];
        var openStart = null;
        lines.forEach(function (ln) {
            var ms = ln.match(/silence_start:\s*(-?[\d.]+)/);
            if (ms) { openStart = Math.max(0, parseFloat(ms[1])); return; }
            var me = ln.match(/silence_end:\s*(-?[\d.]+)/);
            if (me && openStart != null) {
                var end = parseFloat(me[1]);
                if (end > openStart) out.push([openStart, end]);
                openStart = null;
            }
        });
        return out;
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL — REMOVE FILLERS (hesitações "é/ahn/um/uh" via Whisper word-level)
    // Estilo Descript/OpusClip: remove muletas de fala mantendo o ritmo.
    // ═══════════════════════════════════════════════════════════════
    // STRONG = quase sempre muleta (alongamentos + grunhidos). Removidos por padrão.
    var FILLERS_STRONG = /^(é{2,}|e{2,}|a+h+n+|ã+h*|h+m+|hum+|u+h+m?|u+m+|e+r+|e+h+|h+ã+|ahn+|ahm+|mm+|né+m?)$/;
    // SOFT = muletas contextuais (podem ser legítimas). Só no modo agressivo.
    var FILLERS_SOFT = /^(tipo|então|aí|assim|sabe|cara|tá|olha|ó|enfim|bom|beleza|like|so|basically|actually|literally|yeah|okay|ok)$/;

    function normalizeWord(w) {
        return String(w || "")
            .toLowerCase()
            .replace(/[.,!?;:"'…\-–—\s]/g, "")  // tira pontuação + espaço
            .trim();
    }

    async function removeFillers(opts, cb) {
        emit(cb, "onProgress", { step: "validate", msg: "Validando pré-requisitos…" });
        if (!global.BinRunner) throw new Error("bin_runner_missing");
        if (!global.BinRunner.exists("ffmpeg")) throw new Error("ffmpeg.exe não instalado");
        if (!global.BinRunner.exists("whisper-cli")) throw new Error("whisper-cli.exe não instalado");

        var model = opts.model || "ggml-base.bin";
        if (!global.BinRunner.models.exists(model)) {
            emit(cb, "onProgress", { step: "download_model", msg: "Baixando modelo " + model + "…" });
            await global.BinRunner.models.download(model, function (pct) {
                emit(cb, "onProgress", { step: "download_model", percent: pct });
            });
        }

        emit(cb, "onProgress", { step: "get_clip", msg: "Pegando clip…" });
        var videoPath = await getSelectedClipPath();

        // 1. Áudio mono 16kHz
        emit(cb, "onProgress", { step: "extract_audio", msg: "Extraindo áudio…" });
        var wavPath = tmp("fillers.wav");
        await global.BinRunner.run("ffmpeg", [
            "-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", wavPath
        ]);

        // 2. Whisper WORD-LEVEL (--max-len 1 → cada segment ~1 palavra c/ timestamp)
        emit(cb, "onProgress", { step: "transcribe", msg: "Transcrevendo word-level (Whisper)…" });
        var outBase = wavPath.replace(/\.wav$/, "");
        await global.BinRunner.run("whisper-cli", [
            "-m", global.BinRunner.models.path(model),
            "-f", wavPath, "-of", outBase,
            "--output-json", "--max-len", "1",
            "-l", opts.lang || "auto", "--no-prints"
        ], { timeoutMs: 10 * 60 * 1000 });

        var jsonPath = outBase + ".json";
        if (!fs.existsSync(jsonPath)) throw new Error("whisper_no_output");
        var transcript = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        var segments = transcript.transcription || transcript.segments || [];

        // 3. Detecta palavras-muleta
        var aggressive = opts.aggressive === true || opts.aggressiveness === "agressivo";
        var marginMs = (opts.marginMs != null ? opts.marginMs : 30) / 1000;
        var hits = [];
        segments.forEach(function (seg) {
            var raw = seg.text || (seg.tokens && seg.tokens[0] && seg.tokens[0].text) || "";
            var w = normalizeWord(raw);
            if (!w) return;
            var isFiller = FILLERS_STRONG.test(w) || (aggressive && FILLERS_SOFT.test(w));
            if (!isFiller) return;
            var s = parseTimestamp(seg.timestamps && seg.timestamps.from || seg.start) || 0;
            var e = parseTimestamp(seg.timestamps && seg.timestamps.to   || seg.end)   || 0;
            if (e > s) hits.push({ start: s, end: e, word: w });
        });

        emit(cb, "onProgress", { step: "found", msg: hits.length + " muletas detectadas" });

        if (hits.length === 0) {
            cleanup([wavPath, jsonPath]);
            return { ok: true, summary: "Nenhuma muleta detectada" + (aggressive ? "" : " (modo seguro · ative 'agressivo' p/ pegar tipo/então/aí)"), fillers: 0 };
        }

        // 4. Merge muletas adjacentes (ex "é é é") + aplica margin
        hits.sort(function (a, b) { return a.start - b.start; });
        var ranges = [];
        var cur = null;
        hits.forEach(function (h) {
            if (cur && h.start - cur.end <= 0.35) {
                cur.end = h.end; cur.words.push(h.word);
            } else {
                if (cur) ranges.push(cur);
                cur = { start: h.start, end: h.end, words: [h.word] };
            }
        });
        if (cur) ranges.push(cur);

        var deleteRanges = ranges.map(function (r) {
            return [Math.max(0, r.start - marginMs), r.end + marginMs];
        });

        // 5. Backup
        emit(cb, "onProgress", { step: "backup", msg: "Duplicando sequência (backup)…" });
        try { await hostCall("duplicateActiveSequence", ["antes_remove_fillers"]); } catch (_) {}

        // 6. Ripple delete (do fim pro começo)
        emit(cb, "onProgress", { step: "execute", msg: "Removendo " + deleteRanges.length + " muletas…" });
        var ordered = deleteRanges.slice().sort(function (a, b) { return b[0] - a[0]; });
        await hostCall("deleteRanges", [ordered]);

        var totalSaved = deleteRanges.reduce(function (s, r) { return s + (r[1] - r[0]); }, 0);
        var wordList = ranges.map(function (r) { return r.words.join(" "); }).slice(0, 12);
        cleanup([wavPath, jsonPath]);

        return {
            ok: true,
            summary: deleteRanges.length + " muletas removidas · " + totalSaved.toFixed(1) + "s · ex: " + wordList.slice(0, 6).join(", "),
            fillers_removed: deleteRanges.length,
            total_seconds_saved: totalSaved,
            examples: wordList,
            aggressive: aggressive
        };
    }

    function parseTimestamp(ts) {
        if (typeof ts === "number") return ts;
        if (!ts || typeof ts !== "string") return 0;
        // Formato "00:00:12,345"
        var m = ts.match(/^(\d+):(\d+):(\d+)[.,](\d+)$/);
        if (m) return Number(m[1])*3600 + Number(m[2])*60 + Number(m[3]) + Number("0." + m[4]);
        return parseFloat(ts) || 0;
    }
    function cleanup(paths) {
        if (!fs) return;
        paths.forEach(function (p) { try { fs.unlinkSync(p); } catch (_) {} });
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 2 — CORTAR ERROS (Gemini)
    // ═══════════════════════════════════════════════════════════════
    async function cortarErros(opts, cb) {
        if (!global.GeminiClient || !global.GeminiClient.hasKey()) {
            throw new Error("Configure sua Google Gemini API key em ⚙ Config primeiro");
        }
        emit(cb, "onProgress", { step: "get_clip", msg: "Pegando clip…" });
        var videoPath = await getSelectedClipPath();

        emit(cb, "onProgress", { step: "gemini", msg: "Gemini analisando vídeo (pode demorar 30s-2min)…" });
        var prompt = [
            "Você é um editor profissional de vídeo talking-head (YouTube/cursos/podcasts) com 10 anos de experiência em cortar takes ruins.",
            "Sua tarefa: assistir o vídeo e marcar TODOS os trechos que um editor humano cortaria numa edição limpa.",
            "",
            "CORTE (marque como bad_take) quando houver:",
            "1. RETAKE — a pessoa erra a frase e começa de novo. → corte a tentativa ERRADA, mantenha a BOA (geralmente a última).",
            "2. GAGUEIRA/TRAVADA — repete palavra (‘o-o-o vídeo’), trava no meio, perde a linha de raciocínio.",
            "3. FALSO COMEÇO — começa uma frase, para, e recomeça diferente.",
            "4. AUTOCORREÇÃO — ‘...na terça, quer dizer, na quarta’ → corte o erro ‘na terça, quer dizer,’.",
            "5. INSTRUÇÃO DE BASTIDOR — ‘deixa eu repetir’, ‘corta isso’, ‘pera’, ‘peraí’, conversa com a câmera/editor.",
            "6. SILÊNCIO MORTO longo (>2s) sem ação visual relevante.",
            "7. DIVAGAÇÃO claramente fora do tópico que não agrega.",
            "",
            "NÃO corte: pausas dramáticas curtas intencionais, ênfase, respiração natural entre frases, conteúdo válido mesmo que informal.",
            "",
            "PROCESSO: para cada problema, pense no timestamp exato de início e fim em SEGUNDOS (decimais ok, ex 12.4). Quando for retake, prefira cortar a versão pior e deixar a melhor intacta.",
            "Seja PRECISO nos cortes (não corte sílabas da fala boa). É melhor marcar 15 cortes reais do que ser tímido — o usuário revisa antes de aplicar.",
            "No campo reason, diga o tipo (retake/gagueira/falso começo/etc) + a frase envolvida."
        ].join("\n");
        var schema = {
            type: "object",
            properties: {
                bad_takes: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            start:  { type: "number", description: "início em segundos (decimal)" },
                            end:    { type: "number", description: "fim em segundos (decimal)" },
                            kind:   { type: "string", description: "retake|gagueira|falso_comeco|autocorrecao|bastidor|silencio|divagacao" },
                            reason: { type: "string", description: "frase/contexto do que é ruim" }
                        },
                        required: ["start", "end", "reason"]
                    }
                }
            },
            required: ["bad_takes"]
        };
        var resp = await global.GeminiClient.analyzeVideo({
            videoPath: videoPath, prompt: prompt, responseSchema: schema,
            model: opts.model || "gemini-2.5-flash",
            temperature: 0.25
        });
        var ranges = (resp.json && resp.json.bad_takes) || [];
        if (!ranges.length) return { ok: true, summary: "Nenhum take ruim detectado", bad_takes: 0 };

        emit(cb, "onProgress", { step: "backup", msg: "Backup da sequência…" });
        try { await hostCall("duplicateActiveSequence", ["antes_cortar_erros"]); } catch (_) {}

        emit(cb, "onProgress", { step: "execute", msg: "Removendo " + ranges.length + " takes ruins…" });
        var pairs = ranges.map(function (r) { return [r.start, r.end]; });
        await hostCall("deleteRanges", [pairs]);

        return {
            ok: true,
            summary: ranges.length + " takes ruins removidos",
            bad_takes_removed: ranges.length,
            details: ranges
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 3 — CAÇA-TRECHOS (Gemini highlights)
    // ═══════════════════════════════════════════════════════════════
    async function cacaTrechos(opts, cb) {
        if (!global.GeminiClient || !global.GeminiClient.hasKey()) {
            throw new Error("Configure sua Google Gemini API key");
        }
        emit(cb, "onProgress", { step: "gemini", msg: "Gemini caçando highlights…" });
        var videoPath = await getSelectedClipPath();

        var n = opts.count || 5;
        var vertical = opts.vertical !== false; // default vertical (Reels)
        var prompt = [
            "Você é um clipador viral de elite (estilo OpusClip/equipe do MrBeast). Já fez milhões de views cortando lives e podcasts em Shorts.",
            "Sua tarefa: assistir o vídeo e extrair os " + n + " MELHORES clipes com MAIOR potencial de viralizar como Reel/Short/TikTok.",
            "",
            "O QUE FAZ UM CLIPE VIRAL (priorize trechos com o máximo destes):",
            "• HOOK nos primeiros 3s — abre com tensão, pergunta, número chocante, afirmação polêmica ou promessa. Se o trecho começa devagar, ajuste o start pro momento que o hook realmente bate.",
            "• PAYOFF — entrega uma virada, revelação, punchline ou conclusão satisfatória antes de acabar.",
            "• EMOÇÃO — engraçado, chocante, inspirador, polêmico ou ‘aha!’. Conteúdo morno não viraliza.",
            "• AUTOCONTIDO — faz sentido sozinho, sem precisar do resto do vídeo.",
            "• DENSIDADE — sem gordura. Corte respiros e enrolação dentro do próprio clipe.",
            "",
            "DURAÇÃO: 15-50s é o ideal pro algoritmo. Pode chegar a 60s só se o conteúdo segurar.",
            "TÍTULO: escreva como legenda de Reel que para o scroll — curiosidade/tensão, NÃO descritivo. Ex ruim: ‘Falando sobre marketing’. Ex bom: ‘O erro de marketing que quebrou minha empresa’.",
            "",
            "PROCESSO: identifique os momentos-pico do vídeo, escolha os " + n + " mais fortes, ajuste start/end pro clipe ficar redondo (começa no hook, termina no payoff). Timestamps em SEGUNDOS decimais.",
            "Ranqueie do mais viral pro menos. No campo reason explique o hook + por que prende.",
            "Inclua um campo viral_score de 0-100 (honesto — nem tudo é 90)."
        ].join("\n");
        var schema = {
            type: "object",
            properties: {
                highlights: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            start:       { type: "number", description: "início em segundos (no hook)" },
                            end:         { type: "number", description: "fim em segundos (no payoff)" },
                            title:       { type: "string", description: "legenda que para o scroll" },
                            hook:        { type: "string", description: "a primeira frase/gancho do clipe" },
                            viral_score: { type: "number", description: "0-100 potencial de viralizar" },
                            reason:      { type: "string", description: "por que prende a atenção" }
                        },
                        required: ["start", "end", "title", "reason"]
                    }
                }
            },
            required: ["highlights"]
        };
        var resp = await global.GeminiClient.analyzeVideo({
            videoPath: videoPath, prompt: prompt, responseSchema: schema,
            model: opts.model || "gemini-2.5-flash",
            temperature: 0.5
        });
        // Ordena por viral_score desc se o modelo retornou
        if (resp.json && Array.isArray(resp.json.highlights)) {
            resp.json.highlights.sort(function (a, b) { return (b.viral_score || 0) - (a.viral_score || 0); });
        }
        var highlights = (resp.json && resp.json.highlights) || [];
        if (!highlights.length) return { ok: true, summary: "Nenhum highlight identificado", highlights: [] };

        // CRIA SEQUÊNCIAS REAIS de cada highlight
        emit(cb, "onProgress", { step: "execute", msg: "Criando " + highlights.length + " sequências de short…" });
        var r = await hostCall("createShortsFromHighlights", [highlights, videoPath, vertical]);

        return {
            ok: true,
            summary: (r.created || 0) + " shorts criados (" + (r.failed || 0) + " falhas) · vertical=" + vertical,
            highlights: highlights,
            shorts_created: r.created || 0,
            shorts_failed: r.failed || 0,
            errors: r.errors
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 4 — CAPÍTULOS IA (Gemini chapters)
    // ═══════════════════════════════════════════════════════════════
    async function capitulosIA(opts, cb) {
        if (!global.GeminiClient || !global.GeminiClient.hasKey()) {
            throw new Error("Configure sua Google Gemini API key");
        }
        emit(cb, "onProgress", { step: "gemini", msg: "Gemini criando capítulos…" });
        var videoPath = await getSelectedClipPath();

        var prompt = [
            "Você é especialista em retenção no YouTube. Crie os capítulos (timestamps) deste vídeo pra maximizar navegação e watch-time.",
            "",
            "REGRAS:",
            "• O 1º capítulo SEMPRE começa em 0 e se chama tipo ‘Introdução’ ou o gancho inicial (requisito do YouTube).",
            "• Marque uma quebra a cada MUDANÇA REAL de tópico/seção — não corte no meio de um raciocínio.",
            "• Título: 2-5 palavras, concreto e clicável. Use o BENEFÍCIO/assunto, não ‘Parte 2’. Ex bom: ‘Configurando o ambiente’. Ex ruim: ‘Continuação’.",
            "• Ritmo: capítulo nem curto demais (<30s) nem longo demais. Vídeo de 10min ≈ 4-7 capítulos.",
            "• Mín 3, Máx 12 capítulos. Timestamps em SEGUNDOS (start de cada seção).",
            "Pense no arco do vídeo (intro → desenvolvimento → clímax → fechamento) e nomeie cada bloco."
        ].join("\n");
        var schema = {
            type: "object",
            properties: {
                chapters: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            start: { type: "number", description: "início em segundos" },
                            title: { type: "string", description: "2-5 palavras clicáveis" }
                        },
                        required: ["start", "title"]
                    }
                }
            },
            required: ["chapters"]
        };
        var resp = await global.GeminiClient.analyzeVideo({
            videoPath: videoPath, prompt: prompt, responseSchema: schema,
            temperature: 0.3
        });
        var chapters = (resp.json && resp.json.chapters) || [];

        emit(cb, "onProgress", { step: "execute", msg: "Adicionando " + chapters.length + " marcadores no Premiere…" });
        var added = await hostCall("addMarkersBatch", [chapters]);
        return {
            ok: true,
            summary: (added.added || 0) + " capítulos criados na timeline",
            chapters: chapters,
            markers_added: added.added || 0
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 5 — LEGENDAS IA (delega pra plugin Motion Legendas)
    // ═══════════════════════════════════════════════════════════════
    async function legendasIA(opts, cb) {
        if (!global.BinRunner || !global.BinRunner.exists("whisper-cli")) {
            throw new Error("whisper-cli.exe não instalado");
        }
        if (!global.BinRunner.exists("ffmpeg")) {
            throw new Error("ffmpeg.exe não instalado");
        }
        var model = opts.model || "ggml-base.bin";
        if (!global.BinRunner.models.exists(model)) {
            emit(cb, "onProgress", { step: "download_model", msg: "Baixando modelo " + model + "…" });
            await global.BinRunner.models.download(model);
        }

        var videoPath = await getSelectedClipPath();
        var style = opts.style || "viral"; // "viral" | "classic" | "minimal"
        var wavPath = tmp("audio.wav");

        emit(cb, "onProgress", { step: "extract", msg: "Extraindo áudio…" });
        await global.BinRunner.run("ffmpeg", ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath]);

        emit(cb, "onProgress", { step: "transcribe", msg: "Transcrevendo word-level…" });
        var outBase = wavPath.replace(/\.wav$/, "");
        await global.BinRunner.run("whisper-cli", [
            "-m", global.BinRunner.models.path(model),
            "-f", wavPath,
            "-of", outBase,
            "--output-json",
            "--max-len", "1",
            "-l", opts.lang || "auto"
        ], { timeoutMs: 10 * 60 * 1000 });
        var transcript = JSON.parse(fs.readFileSync(outBase + ".json", "utf8"));
        var segments = transcript.transcription || transcript.segments || [];

        // 1. Gera SRT pra inbox compartilhada (compat Motion Legendas)
        var appdata = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        var inboxDir = path.join(appdata, "PacotesFX", "shared-srt-inbox");
        try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (_) {}
        var srtPath = path.join(inboxDir, "MotionIA_" + Date.now() + ".srt");
        fs.writeFileSync(srtPath, buildSRT(segments), "utf8");
        var latestPath = path.join(inboxDir, "latest.json");
        fs.writeFileSync(latestPath, JSON.stringify({
            srt_path: srtPath, created_at: new Date().toISOString(),
            source: "Motion IA", clip_path: videoPath, word_level: true
        }, null, 2), "utf8");

        // 2. RENDER MOGRT INLINE — gera ASS + queima legenda no vídeo via ffmpeg
        var outDir = path.join(os.homedir(), "Documents", "MotionIA-Legendas");
        try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
        var base = path.basename(videoPath, path.extname(videoPath));
        var outVideo = path.join(outDir, base + "_legendado.mp4");
        var assPath = path.join(outDir, base + ".ass");
        fs.writeFileSync(assPath, buildASS(segments, style), "utf8");

        emit(cb, "onProgress", { step: "render", msg: "Renderizando legenda no vídeo (pode demorar)…" });
        // ffmpeg subtitles filter — escapa path Windows
        var assEscaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
        await global.BinRunner.run("ffmpeg", [
            "-y", "-i", videoPath,
            "-vf", "ass='" + assEscaped + "'",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-c:a", "copy",
            outVideo
        ], { timeoutMs: 30 * 60 * 1000 });

        // Importa no Premiere
        try { await hostCall("importFile", [outVideo]); } catch (_) {}

        cleanup([wavPath, outBase + ".json"]);

        return {
            ok: true,
            summary: "Vídeo com legendas " + style + " renderizado + importado · " + segments.length + " palavras",
            words: segments.length,
            srt_path: srtPath,
            video_path: outVideo,
            style: style
        };
    }

    // ASS WORD-BY-WORD ANIMADO (estilo CapCut/Submagic)
    // Cada palavra ganha pop+highlight quando é falada (karaoke)
    function buildASS(segments, style) {
        var styles = {
            viral: {
                // Estilo Submagic — texto branco GRANDE com outline preto + highlight amarelo na palavra ativa
                font: "Impact", size: 90, primary: "&H00FFFFFF", outline: "&H00000000",
                thickness: 5, shadow: 3, alignment: 2, marginV: 220,
                karaoke: "&H0000FFFF" // amarelo pra palavra ativa
            },
            tiktok: {
                font: "Arial Black", size: 80, primary: "&H00FFFFFF", outline: "&H00000000",
                thickness: 4, shadow: 2, alignment: 2, marginV: 200,
                karaoke: "&H0000FF00" // verde
            },
            reels: {
                font: "Montserrat", size: 75, primary: "&H00FFFFFF", outline: "&H00000000",
                thickness: 4, shadow: 2, alignment: 2, marginV: 200,
                karaoke: "&H00FF00FF" // magenta
            },
            classic: {
                font: "Arial", size: 36, primary: "&H00FFFFFF", outline: "&H00000000",
                thickness: 2, shadow: 1, alignment: 2, marginV: 60,
                karaoke: "&H00FFAA00" // laranja
            },
            minimal: {
                font: "Helvetica", size: 30, primary: "&H00FFFFFF", outline: "&H80000000",
                thickness: 1, shadow: 0, alignment: 2, marginV: 60,
                karaoke: null
            }
        };
        var s = styles[style] || styles.viral;
        var wordLevel = style !== "minimal"; // só minimal usa segmento inteiro

        var header = ""
            + "[Script Info]\n"
            + "Title: Motion IA Legendas - " + style + "\n"
            + "ScriptType: v4.00+\n"
            + "WrapStyle: 0\n"
            + "PlayResX: 1080\n"
            + "PlayResY: 1920\n"
            + "ScaledBorderAndShadow: yes\n\n"
            + "[V4+ Styles]\n"
            + "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            + "Style: Default," + s.font + "," + s.size + "," + s.primary + ",&H000000FF," + s.outline + ",&H00000000,1,0,0,0,100,100,0,0,1," + s.thickness + "," + s.shadow + "," + s.alignment + ",60,60," + s.marginV + ",1\n\n"
            + "[Events]\n"
            + "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";

        var events = [];

        if (!wordLevel) {
            // Modo segment normal — frases inteiras
            segments.forEach(function (seg) {
                var start = parseTimestamp(seg.timestamps && seg.timestamps.from || seg.start);
                var end   = parseTimestamp(seg.timestamps && seg.timestamps.to   || seg.end);
                var text = (seg.text || "").trim().replace(/\n/g, " ").replace(/[{}]/g, "");
                events.push("Dialogue: 0," + toAssTime(start) + "," + toAssTime(end) + ",Default,,0,0,0,," + text);
            });
        } else {
            // Modo WORD-BY-WORD karaoke + pop animation
            // Agrupa palavras em frases de 3-5 (lookable em vertical)
            var groupSize = 3;
            var groups = groupWordsForKaraoke(segments, groupSize);

            groups.forEach(function (group) {
                if (!group.words.length) return;
                var groupStart = group.words[0].start;
                var groupEnd   = group.words[group.words.length - 1].end;

                // Pra cada palavra do grupo: gera um Dialogue com bounce animation
                group.words.forEach(function (w, idx) {
                    var text = (w.text || "").trim();
                    if (!text) return;
                    // Constrói linha completa do grupo, destacando palavra ativa
                    var lineText = group.words.map(function (gw, gi) {
                        var t = (gw.text || "").trim();
                        if (gi === idx) {
                            // Palavra ativa: cor karaoke + scale up + bounce
                            return "{\\c" + s.karaoke + "\\fscx115\\fscy115}" + t + "{\\c" + s.primary + "\\fscx100\\fscy100}";
                        }
                        return t;
                    }).join(" ");
                    // Bounce in (\\t time-based scale)
                    var fxIn = "{\\fad(80,40)\\t(0,80,\\fscx" + 100 + "\\fscy" + 100 + ")}";
                    events.push("Dialogue: 0," + toAssTime(w.start) + "," + toAssTime(w.end) + ",Default,,0,0,0,," + fxIn + lineText);
                });
            });
        }

        return header + events.join("\n") + "\n";
    }

    // Agrupa words flat em "chunks" de N palavras (linhas legíveis)
    function groupWordsForKaraoke(segments, groupSize) {
        // Achata todos words/segments num array unificado
        var all = [];
        segments.forEach(function (seg) {
            var start = parseTimestamp(seg.timestamps && seg.timestamps.from || seg.start) || 0;
            var end   = parseTimestamp(seg.timestamps && seg.timestamps.to   || seg.end)   || 0;
            var text = (seg.text || "").trim();
            if (text) all.push({ start: start, end: end, text: text });
        });

        // Agrupa de N em N
        var groups = [];
        for (var i = 0; i < all.length; i += groupSize) {
            groups.push({ words: all.slice(i, i + groupSize) });
        }
        return groups;
    }
    function toAssTime(s) {
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        return h + ":" + pad(m, 2) + ":" + pad(sec.toFixed(2), 5);
    }

    function buildSRT(segments) {
        var lines = [];
        segments.forEach(function (seg, i) {
            var start = parseTimestamp(seg.timestamps && seg.timestamps.from || seg.start);
            var end   = parseTimestamp(seg.timestamps && seg.timestamps.to   || seg.end);
            lines.push(String(i + 1));
            lines.push(toSrtTime(start) + " --> " + toSrtTime(end));
            lines.push((seg.text || "").trim());
            lines.push("");
        });
        return lines.join("\n");
    }
    function toSrtTime(s) {
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = Math.floor(s % 60);
        var ms = Math.round((s - Math.floor(s)) * 1000);
        return pad(h,2) + ":" + pad(m,2) + ":" + pad(sec,2) + "," + pad(ms,3);
    }
    function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }

    // ═══════════════════════════════════════════════════════════════
    // DISPATCHER
    // ═══════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════
    // SKILL 6 — COPIAR SEQUÊNCIA (clipboard via ExtendScript)
    // ═══════════════════════════════════════════════════════════════
    async function copiarSequencia(opts, cb) {
        var mode = opts.mode || "duplicate"; // "duplicate" | "xml"
        if (mode === "xml") {
            // Exporta como FCP XML pra abrir em OUTRO projeto
            var outPath = opts.outPath || path.join(os.tmpdir(), "motionia_seq_" + Date.now() + ".xml");
            emit(cb, "onProgress", { msg: "Exportando sequência como FCP XML…" });
            var r = await hostCall("exportActiveSequenceXML", [outPath]);
            if (r.error) throw new Error(r.error);
            return {
                ok: true,
                summary: "Sequência exportada como XML · " + outPath,
                xml_path: outPath,
                next: "Abra OUTRO projeto Premiere → Arquivo → Importar → escolha esse XML."
            };
        }
        emit(cb, "onProgress", { msg: "Duplicando sequência…" });
        var r = await hostCall("duplicateActiveSequence", [opts.name || "copia_" + Date.now()]);
        if (r.error) throw new Error(r.error);
        return { ok: true, summary: "Sequência duplicada · " + (r.name || ""), id: r.id };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 7 — TRANSIÇÕES IA — catálogo + aplicação
    // ═══════════════════════════════════════════════════════════════
    // Catálogo das transições nativas do Premiere — nomes EXATOS conforme
    // aparecem na Effects panel. Cada entry tem demo-class pra preview no UI.
    var TRANSITIONS_CATALOG = [
        { id: "cross-dissolve", name: "Cross Dissolve",      premiereName: "Cross Dissolve",      demo: "dissolve", desc: "Fade clássico — universal e suave" },
        { id: "dip-to-black",   name: "Dip to Black",        premiereName: "Dip to Black",        demo: "fade",     desc: "Escurece → próximo. Cinematográfico" },
        { id: "dip-to-white",   name: "Dip to White",        premiereName: "Dip to White",        demo: "fade",     desc: "Clareia → próximo. Sonhos / flashback" },
        { id: "additive",       name: "Additive Dissolve",   premiereName: "Additive Dissolve",   demo: "dissolve", desc: "Soma luminância — efeito retrô" },
        { id: "film-dissolve",  name: "Film Dissolve",       premiereName: "Film Dissolve",       demo: "dissolve", desc: "Linear preservando gamma" },
        { id: "push",           name: "Push",                premiereName: "Push",                demo: "push",     desc: "Empurra um clip pelo outro" },
        { id: "slide",          name: "Slide",               premiereName: "Slide",               demo: "slide",    desc: "Desliza por cima" },
        { id: "wipe",           name: "Wipe",                premiereName: "Wipe",                demo: "wipe",     desc: "Limpa em linha reta" },
        { id: "iris-cross",     name: "Iris Cross",          premiereName: "Iris Cross",          demo: "wipe",     desc: "Abre como cruz expansiva" },
        { id: "split",          name: "Split",               premiereName: "Split",               demo: "wipe",     desc: "Divide ao meio + abre" },
        { id: "zoom-trails",    name: "Zoom Trails",         premiereName: "Zoom Trails",         demo: "zoom",     desc: "Zoom com motion blur (vintage)" },
        { id: "morph-cut",      name: "Morph Cut",           premiereName: "Morph Cut",           demo: "dissolve", desc: "IA: corte invisível em talking-head" }
    ];

    async function transicoesIA(opts, cb) {
        var duration = opts.duration_sec || 1;
        var transId = opts.transition || "cross-dissolve";
        // Aceita tanto id quanto premiereName direto
        var spec = TRANSITIONS_CATALOG.find(function (t) { return t.id === transId || t.premiereName === transId || t.name === transId; });
        var transName = spec ? spec.premiereName : (opts.transition || "Cross Dissolve");
        emit(cb, "onProgress", { msg: "Aplicando " + transName + " (" + duration + "s) em todos os cortes…" });
        var r = await hostCall("applyTransitionsAllCuts", [duration, transName]);
        return {
            ok: true,
            summary: (r.applied || 0) + " transições aplicadas (" + (r.failed || 0) + " falhas)",
            applied: r.applied || 0,
            failed: r.failed || 0,
            transition: transName,
            transition_id: spec ? spec.id : null
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 8 — ORGANIZAR BINS (Project Panel)
    // ═══════════════════════════════════════════════════════════════
    async function organizarBins(opts, cb) {
        emit(cb, "onProgress", { msg: "Criando bins + movendo items por tipo…" });
        var r = await hostCall("organizeAllByType");
        var moved = r.moved || {};
        var total = (moved.video || 0) + (moved.audio || 0) + (moved.image || 0) + (moved.sequence || 0);
        return {
            ok: true,
            summary: total + " items organizados · Vídeos:" + (moved.video || 0) + " · Áudios:" + (moved.audio || 0) + " · Imagens:" + (moved.image || 0) + " · Sequências:" + (moved.sequence || 0),
            moved: moved
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 9 — BAIXAR VÍDEO (yt-dlp local)
    // ═══════════════════════════════════════════════════════════════
    async function baixarVideo(opts, cb) {
        if (!global.BinRunner || !global.BinRunner.exists("yt-dlp")) {
            throw new Error("yt-dlp.exe não instalado. Rode tools/download-bin-motion-ia.ps1");
        }
        if (!opts.url) throw new Error("URL obrigatória");
        if (!/^https?:\/\//i.test(opts.url)) throw new Error("URL inválida (precisa começar com http:// ou https://)");

        var outDir = opts.outDir || path.join(os.homedir(), "Downloads", "MotionIA");
        try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
        var outTemplate = path.join(outDir, "%(title)s.%(ext)s");

        var quality = opts.quality || "best";
        var args = [
            opts.url,
            "-o", outTemplate,
            "--no-playlist",                 // se for playlist, baixa só o vídeo
            "--retries", "3",                // 3 retries por fragmento (não infinito)
            "--socket-timeout", "20",        // 20s socket timeout
            "--no-continue",                 // não continua download parcial corrompido
            "--no-part",                     // sem .part (escreve direto)
            "--max-filesize", "2G",          // safety: nada acima de 2GB
            "--no-warnings"
        ];

        if (quality === "audio") args.push("-x", "--audio-format", "mp3");
        else args.push("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best");

        emit(cb, "onProgress", { msg: "Baixando via yt-dlp (timeout 10min)…" });

        // Detecta progresso por inatividade: se nada acontece em 60s, aborta
        var lastProgressTs = Date.now();
        var stallCheck = null;

        var resultPromise = global.BinRunner.runStreaming("yt-dlp", args, {
            onStdout: function (chunk) {
                lastProgressTs = Date.now();
                var m = chunk.match(/\[download\]\s+([\d.]+)%/);
                if (m) emit(cb, "onProgress", { percent: parseFloat(m[1]) / 100, msg: "Baixando: " + m[1] + "%" });
            },
            onStderr: function (chunk) {
                lastProgressTs = Date.now();
                // yt-dlp usa stderr pra mensagens informativas também
            },
            timeoutMs: 10 * 60 * 1000  // hard timeout 10 min
        });

        // Stall detector: se nada acontecer por 90s, considera travado
        var stallPromise = new Promise(function (_, rej) {
            stallCheck = setInterval(function () {
                if (Date.now() - lastProgressTs > 90 * 1000) {
                    clearInterval(stallCheck);
                    rej(new Error("Download travado (nenhum progresso em 90s) — verifique URL ou conexão"));
                }
            }, 15 * 1000);
        });

        var result;
        try {
            result = await Promise.race([resultPromise, stallPromise]);
        } finally {
            if (stallCheck) clearInterval(stallCheck);
        }

        // Detecta o arquivo baixado no output
        var match = (result.stdout || "").match(/\[download\]\s+Destination:\s+(.+)/);
        var filePath = match ? match[1].trim() : null;

        return { ok: true, summary: "Vídeo baixado em " + outDir, out_dir: outDir, file_path: filePath };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 10 — AUTO CROP (ffmpeg crop center pra 9:16/1:1)
    // ═══════════════════════════════════════════════════════════════
    async function autoCrop(opts, cb) {
        if (!global.BinRunner || !global.BinRunner.exists("ffmpeg")) {
            throw new Error("ffmpeg.exe não instalado");
        }
        if (!global.BinRunner.exists("ffprobe")) {
            throw new Error("ffprobe.exe não instalado (precisa pra detectar resolução do vídeo)");
        }
        var videoPath = await getSelectedClipPath();
        if (!videoPath || !fs.existsSync(videoPath)) {
            throw new Error("Selecione um vídeo válido no Premiere antes de executar");
        }

        // Safety: rejeita arquivos > 3GB (evita travar PC com 4K longo)
        try {
            var st = fs.statSync(videoPath);
            if (st.size > 3 * 1024 * 1024 * 1024) {
                throw new Error("Vídeo muito grande (" + Math.round(st.size/1024/1024/1024) + "GB · máx 3GB). Use proxy antes.");
            }
        } catch (eStat) {
            if (eStat.message.indexOf("muito grande") >= 0) throw eStat;
        }

        var aspect = opts.aspect || "9:16";
        var tracking = opts.tracking !== false;
        var outDir = path.join(os.homedir(), "Documents", "MotionIA-AutoCrop");
        try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
        var base = path.basename(videoPath, path.extname(videoPath));
        var outPath = path.join(outDir, base + "_" + aspect.replace(":", "x") + ".mp4");

        var aspectMap = {
            "9:16": { w: 9, h: 16 },
            "1:1":  { w: 1, h: 1 },
            "4:5":  { w: 4, h: 5 }
        };
        var target = aspectMap[aspect] || aspectMap["9:16"];

        // ── STEP 1: ffprobe pra pegar dimensões reais do vídeo ──────
        emit(cb, "onProgress", { msg: "Lendo dimensões via ffprobe…" });
        var probe;
        try {
            probe = await global.BinRunner.run("ffprobe", [
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,duration",
                "-of", "json",
                videoPath
            ], { timeoutMs: 30 * 1000 });
        } catch (eProbe) {
            throw new Error("ffprobe falhou: " + eProbe.message);
        }
        var meta;
        try {
            var pj = JSON.parse(probe.stdout || "{}");
            meta = (pj.streams && pj.streams[0]) || {};
        } catch (eP) { meta = {}; }
        var srcW = parseInt(meta.width, 10) || 0;
        var srcH = parseInt(meta.height, 10) || 0;
        if (srcW <= 0 || srcH <= 0) {
            throw new Error("Não consegui detectar resolução do vídeo (ffprobe retornou vazio)");
        }
        // Safety: limita res máxima pra prevenir OOM/crash
        if (srcW > 8000 || srcH > 8000) {
            throw new Error("Resolução fora do range seguro (" + srcW + "x" + srcH + "). Use proxy.");
        }

        // ── STEP 2: calcula dimensões de saída em INTEIROS ──────────
        // mantem o lado menor do vídeo, calcula o outro pro aspect alvo
        var srcRatio = srcW / srcH;
        var dstRatio = target.w / target.h;
        var outW, outH;
        if (srcRatio > dstRatio) {
            // vídeo mais largo que alvo → mantém altura, corta largura
            outH = srcH;
            outW = Math.floor(srcH * dstRatio);
        } else {
            outW = srcW;
            outH = Math.floor(srcW / dstRatio);
        }
        // garante par (ffmpeg/libx264 odeia dimensão ímpar)
        outW = outW - (outW % 2);
        outH = outH - (outH % 2);
        if (outW < 2 || outH < 2) {
            throw new Error("Dimensões de saída inválidas: " + outW + "x" + outH);
        }

        // ── STEP 3: face tracking (opcional, fallback pra centro) ───
        var cropCenterX = Math.floor(srcW / 2);
        var cropCenterY = Math.floor(srcH / 2);
        var trackingUsed = "center";

        if (tracking && global.FaceTracker) {
            emit(cb, "onProgress", { msg: "Analisando rostos (Canvas YCbCr · 12 frames)…" });
            try {
                var faceRes = await Promise.race([
                    global.FaceTracker.analyzeVideo(videoPath, { frames: 12 }),
                    new Promise(function (_, rej) { setTimeout(function () { rej(new Error("face_tracker_timeout")); }, 45 * 1000); })
                ]);
                if (faceRes && faceRes.valid_frames > 2) {
                    cropCenterX = Math.floor(srcW * faceRes.avg_x);
                    cropCenterY = Math.floor(srcH * faceRes.avg_y);
                    trackingUsed = "face";
                    emit(cb, "onProgress", {
                        msg: "Rosto em " + faceRes.valid_frames + "/" + faceRes.frames_analyzed +
                             " frames · centro " + Math.round(faceRes.avg_x*100) + "%/" + Math.round(faceRes.avg_y*100) + "%"
                    });
                } else {
                    emit(cb, "onProgress", { msg: "Sem rosto detectado · centralizando crop" });
                }
            } catch (eF) {
                emit(cb, "onProgress", { msg: "Face tracking falhou (" + eF.message + ") · usando crop central" });
            }
        }

        // calcula cropX/cropY top-left clampado dentro dos limites
        var cropX = Math.max(0, Math.min(srcW - outW, cropCenterX - Math.floor(outW / 2)));
        var cropY = Math.max(0, Math.min(srcH - outH, cropCenterY - Math.floor(outH / 2)));

        // ── STEP 4: ffmpeg com filter de inteiros + retry com fallbacks
        var filter = "crop=" + outW + ":" + outH + ":" + cropX + ":" + cropY;
        emit(cb, "onProgress", { msg: "ffmpeg encoding " + aspect + " (" + outW + "x" + outH + ", offset " + cropX + "," + cropY + ")…" });

        var err1 = null, err2 = null;
        // Tentativa 1: preset fast + AAC audio (qualidade boa)
        try {
            await global.BinRunner.run("ffmpeg", [
                "-y", "-i", videoPath,
                "-vf", filter,
                "-c:v", "libx264", "-preset", "fast", "-crf", "22",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart",
                outPath
            ], { timeoutMs: 20 * 60 * 1000 });
        } catch (e1) {
            err1 = e1.message;
            try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
            emit(cb, "onProgress", { msg: "Tentativa 1 falhou (" + e1.message.slice(0, 60) + "), tentando modo simplificado..." });

            // Tentativa 2: ultrafast + sem audio (descarta se audio travar)
            try {
                await global.BinRunner.run("ffmpeg", [
                    "-y", "-i", videoPath,
                    "-vf", filter,
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
                    "-pix_fmt", "yuv420p",
                    "-an",
                    outPath
                ], { timeoutMs: 15 * 60 * 1000 });
                emit(cb, "onProgress", { msg: "✓ Encoded em modo simplificado (sem áudio)" });
            } catch (e2) {
                err2 = e2.message;
                try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
                throw new Error(
                    "Auto Crop falhou em 2 tentativas. Provável: ffmpeg.exe v8.1.1 incompatível com este vídeo OU input corrompido. " +
                    "Tente vídeo MP4/H.264 simples ou avise pra trocar ffmpeg.exe bundlado. " +
                    "Erro 1: " + err1.slice(0, 100) + " | Erro 2: " + err2.slice(0, 100)
                );
            }
        }

        // valida output
        if (!fs.existsSync(outPath)) throw new Error("ffmpeg terminou mas não criou o arquivo");
        var outSt = fs.statSync(outPath);
        if (outSt.size < 1024) {
            try { fs.unlinkSync(outPath); } catch (_) {}
            throw new Error("Arquivo de saída suspeito (apenas " + outSt.size + " bytes)");
        }

        // Importa no Premiere
        try { await hostCall("importFile", [outPath]); } catch (_) {}

        return {
            ok: true,
            summary: "Crop " + aspect + " (" + trackingUsed + ") · " + outW + "x" + outH + " · " + Math.round(outSt.size/1024/1024) + "MB",
            out_path: outPath,
            aspect: aspect,
            tracking_used: trackingUsed,
            src_size: srcW + "x" + srcH,
            out_size: outW + "x" + outH,
            crop_offset: { x: cropX, y: cropY }
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 11 — MULTICAM IA (placeholder)
    // ═══════════════════════════════════════════════════════════════
    async function multicamIA(opts, cb) {
        // v4.0.1 — UI manda clip_names diretamente (do picker no plugin), NÃO depende
        // do bugado app.project.getSelection() do Premiere.
        var clipNames = opts.clip_names || opts.clipNames;
        if (!clipNames || !clipNames.length || clipNames.length < 2) {
            throw new Error("Escolha 2+ clips na lista do plugin antes de executar (clip_names obrigatório)");
        }

        // Estratégia 1: tenta multicam Auto-Sync por áudio
        emit(cb, "onProgress", { msg: "Tentando MultiCam Auto-Sync por áudio…" });
        var r2 = await hostCall("createMulticamAutoSync", [clipNames]);
        if (!r2.error) {
            return {
                ok: true,
                summary: "MultiCam Auto-Sync: " + r2.sequence + " · " + r2.clips + " clips sincronizados por áudio",
                sequence: r2.sequence,
                clips: r2.clips,
                sync_method: "audio_waveform"
            };
        }

        // Estratégia 2: cria multicam básica (sem auto-sync) com nomes passados
        emit(cb, "onProgress", { msg: "Auto-sync falhou (" + r2.error + ") — criando multicam básica…" });
        var r = await hostCall("createMulticamFromSelected", [JSON.stringify(clipNames)]);
        if (r.error) throw new Error(r.error);
        return {
            ok: true,
            summary: "MultiCam criada: " + r.sequence + " · " + r.clips + " clips (" + (r.method || "manual") + ")",
            sequence: r.sequence,
            clips: r.clips,
            method: r.method,
            note: r.note || "Sync por áudio: Project Panel → click direito no multicam → Sincronizar (já configurado pra audio)."
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 12 — BIBLIOTECA STOCK (Pexels + Pixabay + Giphy)
    // ═══════════════════════════════════════════════════════════════
    async function bibliotecaStock(opts, cb) {
        var query = (opts.query || "").trim();
        if (!query) throw new Error("Digite um termo de busca");

        var source = opts.source || "pexels"; // "pexels" | "pixabay" | "giphy" | "all"
        var perPage = opts.per_page || 15;

        var results = [];
        if (source === "pexels" || source === "all") {
            try {
                emit(cb, "onProgress", { msg: "Buscando '" + query + "' no Pexels…" });
                var px = await fetchPexels(query, perPage, opts.orientation);
                results = results.concat(px);
            } catch (e) {
                if (source === "pexels") throw e;
                emit(cb, "onProgress", { msg: "Pexels falhou (" + e.message + "), seguindo…" });
            }
        }
        if (source === "pixabay" || source === "all") {
            try {
                emit(cb, "onProgress", { msg: "Buscando '" + query + "' no Pixabay…" });
                var pb = await fetchPixabay(query, perPage);
                results = results.concat(pb);
            } catch (e) {
                if (source === "pixabay") throw e;
                emit(cb, "onProgress", { msg: "Pixabay falhou (" + e.message + "), seguindo…" });
            }
        }
        if (source === "giphy" || source === "all") {
            try {
                emit(cb, "onProgress", { msg: "Buscando GIFs '" + query + "' no Giphy…" });
                var gf = await fetchGiphy(query, perPage);
                results = results.concat(gf);
            } catch (e) {
                if (source === "giphy") throw e;
                emit(cb, "onProgress", { msg: "Giphy falhou (" + e.message + "), seguindo…" });
            }
        }

        // Auto-download primeiro resultado se opts.autoDownload
        if (opts.autoDownload && results[0] && results[0].download_url) {
            emit(cb, "onProgress", { msg: "Baixando primeiro resultado (" + results[0].source + ")…" });
            var ext = results[0].source === "giphy" ? ".mp4" : ".mp4";
            var outDir = path.join(os.homedir(), "Documents", "MotionIA-Stock");
            try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
            var outPath = path.join(outDir, results[0].source + "_" + results[0].id + ext);
            await downloadFile(results[0].download_url, outPath);
            try { await hostCall("importAndInsert", [outPath, { insert: false }]); } catch (_) {}
            return { ok: true, summary: "1 vídeo baixado e importado · " + results.length + " encontrados", videos: results, downloaded: outPath };
        }

        return { ok: true, summary: results.length + " resultados (" + source + ")", videos: results };
    }

    async function fetchPexels(query, perPage, orientation) {
        var apiKey = (typeof localStorage !== "undefined" && localStorage.getItem("mia_pexels_key")) || "";
        if (!apiKey) throw new Error("Pexels API key não configurada (⚙ Config)");
        var url = "https://api.pexels.com/videos/search?query=" + encodeURIComponent(query)
                + "&per_page=" + perPage + "&orientation=" + (orientation || "any");
        var res = await fetch(url, { headers: { "Authorization": apiKey } });
        if (!res.ok) throw new Error("pexels_" + res.status);
        var data = await res.json();
        return (data.videos || []).map(function (v) {
            var hdFile = (v.video_files || []).find(function (f) { return f.quality === "hd" && f.file_type === "video/mp4"; }) ||
                         (v.video_files || []).find(function (f) { return f.file_type === "video/mp4"; });
            return {
                source: "pexels",
                id: v.id,
                duration: v.duration,
                width: v.width,
                height: v.height,
                user: v.user && v.user.name,
                preview: v.image,
                download_url: hdFile ? hdFile.link : null
            };
        });
    }

    async function fetchPixabay(query, perPage) {
        var apiKey = (typeof localStorage !== "undefined" && localStorage.getItem("mia_pixabay_key")) || "";
        if (!apiKey) throw new Error("Pixabay API key não configurada (⚙ Config)");
        var url = "https://pixabay.com/api/videos/?key=" + encodeURIComponent(apiKey)
                + "&q=" + encodeURIComponent(query) + "&per_page=" + perPage;
        var res = await fetch(url);
        if (!res.ok) throw new Error("pixabay_" + res.status);
        var data = await res.json();
        return (data.hits || []).map(function (v) {
            var vid = v.videos || {};
            var best = vid.large || vid.medium || vid.small || vid.tiny || {};
            return {
                source: "pixabay",
                id: v.id,
                duration: v.duration,
                width: best.width,
                height: best.height,
                user: v.user,
                preview: v.picture_id ? ("https://i.vimeocdn.com/video/" + v.picture_id + "_640x360.jpg") : null,
                download_url: best.url || null
            };
        });
    }

    async function fetchGiphy(query, perPage) {
        var apiKey = (typeof localStorage !== "undefined" && localStorage.getItem("mia_giphy_key")) || "";
        if (!apiKey) throw new Error("Giphy API key não configurada (⚙ Config)");
        var url = "https://api.giphy.com/v1/gifs/search?api_key=" + encodeURIComponent(apiKey)
                + "&q=" + encodeURIComponent(query) + "&limit=" + perPage + "&rating=pg-13";
        var res = await fetch(url);
        if (!res.ok) throw new Error("giphy_" + res.status);
        var data = await res.json();
        return (data.data || []).map(function (g) {
            var images = g.images || {};
            var mp4 = (images.original_mp4 && images.original_mp4.mp4) ||
                      (images.looping && images.looping.mp4) ||
                      (images.fixed_height && images.fixed_height.mp4);
            var preview = (images.fixed_height_small && images.fixed_height_small.url) ||
                          (images.preview_gif && images.preview_gif.url) ||
                          (images.original && images.original.url);
            return {
                source: "giphy",
                id: g.id,
                duration: null,
                width: parseInt((images.original || {}).width || 0, 10) || null,
                height: parseInt((images.original || {}).height || 0, 10) || null,
                user: g.username || (g.user && g.user.display_name),
                preview: preview,
                download_url: mp4 || null,
                title: g.title
            };
        });
    }

    function downloadFile(url, outPath) {
        return new Promise(function (resolve, reject) {
            var https = nodeRequire("https");
            var http  = nodeRequire("http");
            var mod = url.indexOf("https:") === 0 ? https : http;
            var file = fs.createWriteStream(outPath);
            mod.get(url, function (res) {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    file.close(); fs.unlinkSync(outPath);
                    return downloadFile(res.headers.location, outPath).then(resolve, reject);
                }
                if (res.statusCode !== 200) {
                    file.close(); try { fs.unlinkSync(outPath); } catch (_) {}
                    return reject(new Error("http_" + res.statusCode));
                }
                res.pipe(file);
                file.on("finish", function () { file.close(function () { resolve(outPath); }); });
            }).on("error", function (err) {
                try { fs.unlinkSync(outPath); } catch (_) {}
                reject(err);
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 13 — CASPER (orquestrador de regras customizáveis)
    // ═══════════════════════════════════════════════════════════════
    // Casper executa uma lista de "rules" em sequência. Cada rule é
    // { skill: "<skill-id>", opts: {...}, enabled: bool }.
    // Default rules ficam em localStorage("mia_casper_rules").
    var CASPER_DEFAULT_RULES = [
        { skill: "cortar-pausas", opts: { aggressiveness: "normal" },              enabled: true,  label: "Cortar pausas (nível normal)" },
        { skill: "remove-fillers", opts: { aggressive: false },                    enabled: true,  label: "Tirar muletas (é/ahn/um)" },
        { skill: "bins",          opts: {},                                        enabled: true,  label: "Organizar Project Panel" },
        { skill: "transicoes",    opts: { transition: "cross-dissolve", duration_sec: 0.5 }, enabled: false, label: "Cross Dissolve 0.5s" },
        { skill: "capitulos",     opts: {},                                        enabled: false, label: "Capítulos IA (Gemini)" }
    ];

    function getCasperRules() {
        try {
            var raw = localStorage.getItem("mia_casper_rules");
            if (raw) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (_) {}
        return CASPER_DEFAULT_RULES.slice();
    }

    function setCasperRules(rules) {
        try { localStorage.setItem("mia_casper_rules", JSON.stringify(rules || [])); }
        catch (_) {}
    }

    async function casper(opts, cb) {
        var rules = (opts && opts.rules) || getCasperRules();
        var enabled = rules.filter(function (r) { return r.enabled !== false; });
        if (!enabled.length) {
            return { ok: true, summary: "Nenhuma regra ativa", results: [] };
        }
        emit(cb, "onProgress", { msg: "Casper iniciando · " + enabled.length + " regra(s)…" });
        var results = [];
        var success = 0, failed = 0;
        for (var i = 0; i < enabled.length; i++) {
            var rule = enabled[i];
            emit(cb, "onProgress", {
                msg: "[" + (i+1) + "/" + enabled.length + "] " + (rule.label || rule.skill),
                percent: i / enabled.length
            });
            var fn = SKILLS[rule.skill];
            if (!fn) {
                results.push({ rule: rule, ok: false, error: "skill_unknown" });
                failed++;
                continue;
            }
            try {
                var r = await fn(rule.opts || {}, {
                    onProgress: function (ev) {
                        emit(cb, "onProgress", { msg: "  ↳ " + (ev.msg || ""), percent: ev.percent });
                    }
                });
                results.push({ rule: rule, ok: true, result: r });
                success++;
            } catch (e) {
                results.push({ rule: rule, ok: false, error: e.message });
                failed++;
                if (rule.stop_on_error) break;
            }
        }
        return {
            ok: failed === 0,
            summary: "Casper · " + success + " OK · " + failed + " falha(s)",
            results: results,
            success_count: success,
            failed_count: failed
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILL 14 — GERAR VÍDEO IA (Seedance via fal.ai · v4)
    // ═══════════════════════════════════════════════════════════════
    // Substitui "Biblioteca Stock" (Pexels/Pixabay/Giphy) — em vez de buscar
    // vídeos pré-existentes, GERA vídeos novos a partir de imagem + prompt.
    async function gerarVideoIA(opts, cb) {
        if (!global.FalClient) {
            throw new Error("FalClient nao carregado");
        }
        if (!global.FalClient.hasKey()) {
            throw new Error("fal.ai API key nao configurada. Configure em Licenca & Config (campo fal.ai)");
        }
        var imagePath = opts.imagePath || opts.image_path;
        var prompt    = opts.prompt;
        var duration  = parseInt(opts.duration || 5, 10);
        var aspect    = opts.aspectRatio || opts.aspect_ratio || "16:9";
        var model     = opts.model || "seedance";

        if (!imagePath) throw new Error("imagePath obrigatorio (foto de referencia pro Seedance)");
        if (!prompt) throw new Error("prompt obrigatorio (descreva o movimento/cena desejado)");

        emit(cb, "onProgress", { msg: "Iniciando geracao via " + model + "..." });
        var result = await global.FalClient.generateVideoFromImage({
            imagePath: imagePath,
            prompt: prompt,
            duration: duration,
            aspectRatio: aspect,
            model: model,
            onProgress: function (st) {
                emit(cb, "onProgress", { msg: st.msg, stage: st.stage });
            }
        });

        // Importa no Premiere
        try { await hostCall("importFile", [result.out_path]); }
        catch (e) { emit(cb, "onProgress", { msg: "Aviso: import no Premiere falhou (" + e.message + "), mas o video foi salvo em " + result.out_path }); }

        return {
            ok: true,
            summary: "Video gerado (" + duration + "s · " + aspect + ") + importado no Premiere",
            out_path: result.out_path,
            duration: result.duration,
            aspect_ratio: result.aspect_ratio,
            model: result.model,
            request_id: result.request_id
        };
    }

    var SKILLS = {
        "cortar-pausas":  cortarPausas,
        "remove-fillers": removeFillers,
        "cortar-erros":   cortarErros,
        "caca-trechos":   cacaTrechos,
        "capitulos":      capitulosIA,
        "legendas":       legendasIA,
        "copiar-seq":     copiarSequencia,
        "transicoes":     transicoesIA,
        "bins":           organizarBins,
        "baixar":         baixarVideo,
        "auto-crop":      autoCrop,
        "multicam":       multicamIA,
        "stock":          bibliotecaStock,
        "gerar-video":    gerarVideoIA,
        "generate-video": gerarVideoIA,
        "casper":         casper
    };

    async function run(skillId, opts, callbacks) {
        var fn = SKILLS[skillId];
        if (!fn) throw new Error("skill_unknown: " + skillId);
        return await fn(opts || {}, callbacks || {});
    }

    global.Skills = {
        run:  run,
        list: function () { return Object.keys(SKILLS); },
        transitions:    TRANSITIONS_CATALOG,
        casperDefaults: CASPER_DEFAULT_RULES,
        getCasperRules: getCasperRules,
        setCasperRules: setCasperRules
    };
})(typeof window !== "undefined" ? window : globalThis);
