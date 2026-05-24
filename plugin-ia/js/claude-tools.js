/* claude-tools.js — Motion IA v2.0
 *
 * Catálogo de tools expostas pra Claude (Anthropic tool use API).
 * Cada tool tem:
 *   - definition: schema JSON enviado ao Claude
 *   - handler: função async que executa e retorna string/objeto (resultado pro Claude)
 *
 * Categorias:
 *   1. CONTEXT   — IA "vê" o estado da timeline
 *   2. VISION    — IA "vê" o vídeo (frames, transcrição)
 *   3. TIMELINE  — IA edita (cortar, remover, mover)
 *   4. MOGRT/FX  — aplicar templates e efeitos
 *   5. EXPORT    — render/preview
 *
 * Helpers:
 *   - hostCall(name, args) → wrapper sobre CSInterface.evalScript pro host.jsx
 *   - motorCall(path, body) → wrapper sobre fetch pro motor local (VIDEO-PRO-IA)
 */
(function (global) {
    "use strict";

    // ───────────────────────────── helpers ─────────────────────────────
    var cs = (typeof CSInterface !== "undefined") ? new CSInterface() : null;

    // Node integration (CEP --enable-nodejs --mixed-context)
    var nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) || global.require;
    var nfs = nodeRequire ? nodeRequire("fs") : null;
    var npath = nodeRequire ? nodeRequire("path") : null;
    var nos = nodeRequire ? nodeRequire("os") : null;

    function tmpDir() {
        if (!nos || !npath) return null;
        var dir = npath.join(nos.tmpdir(), "motionia_frames");
        try { nfs.mkdirSync(dir, { recursive: true }); } catch (_) {}
        return dir;
    }
    function readFileBase64(filePath) {
        if (!nfs) return null;
        try {
            var buf = nfs.readFileSync(filePath);
            return buf.toString("base64");
        } catch (e) { return null; }
    }

    function hostCall(fn, argsArr) {
        return new Promise(function (resolve, reject) {
            if (!cs) return reject(new Error("CSInterface_unavailable"));
            // Args: cada valor vira literal JSON. Arrays/objects passam como nativos no ES script.
            var argsStr = (argsArr || []).map(function (a) {
                if (a === null || a === undefined) return "null";
                return JSON.stringify(a);
            }).join(", ");
            var code = "MotionProIA." + fn + "(" + argsStr + ");";
            cs.evalScript(code, function (raw) {
                if (raw === "EvalScript error." || raw == null) {
                    return reject(new Error("ExtendScript falhou (host.jsx não carregou — abra um projeto no Premiere)"));
                }
                if (raw === "undefined") return reject(new Error("Função " + fn + " não encontrada no host.jsx"));
                try {
                    var trimmed = typeof raw === "string" ? raw.trim() : raw;
                    var first = typeof trimmed === "string" ? trimmed.charAt(0) : "";
                    var parsed = (first === "{" || first === "[") ? JSON.parse(trimmed) : { raw: raw };
                    if (parsed && parsed.error) reject(new Error(parsed.error));
                    else resolve(parsed);
                } catch (e) { reject(new Error("parse_failed: " + String(raw).slice(0, 100))); }
            });
        });
    }

    function motorBase() {
        return (global.MV_CONFIG && global.MV_CONFIG.videoEditorUrl) || "http://localhost:3333";
    }
    async function motorCall(path, body) {
        var res = await fetch(motorBase() + path, {
            method: body ? "POST" : "GET",
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(60000)
        });
        if (!res.ok) throw new Error("motor_" + res.status);
        return res.json();
    }
    async function motorAvailable() {
        try {
            var r = await fetch(motorBase() + "/api/status", { signal: AbortSignal.timeout(2000) });
            return r.ok;
        } catch (e) { return false; }
    }

    // ───────────────────────────── tools ─────────────────────────────
    var TOOLS = [
        // ═══════════ CONTEXT ═══════════
        {
            definition: {
                name: "get_context",
                description: "Pega snapshot do estado atual do Premiere: sequência ativa, clips, CTI, clips selecionados, path do projeto. SEMPRE chame isso PRIMEIRO antes de qualquer edição.",
                input_schema: { type: "object", properties: {}, required: [] }
            },
            handler: async function () {
                return await hostCall("getContextSnapshot");
            }
        },
        {
            definition: {
                name: "list_clips",
                description: "Lista todos os clips na timeline (vídeo + áudio) com nomes, tracks, tempos, media paths e flags de seleção.",
                input_schema: { type: "object", properties: {}, required: [] }
            },
            handler: async function () { return await hostCall("listTimelineClips"); }
        },
        {
            definition: {
                name: "list_project_items",
                description: "Lista itens do Project Panel (mídias, bins). Use pra encontrar arquivos disponíveis no projeto.",
                input_schema: { type: "object", properties: {}, required: [] }
            },
            handler: async function () { return await hostCall("listProjectItems"); }
        },
        {
            definition: {
                name: "get_capabilities",
                description: "Retorna o que esta versão do Premiere suporta (QE DOM, exportFrame, etc).",
                input_schema: { type: "object", properties: {}, required: [] }
            },
            handler: async function () { return await hostCall("capabilities"); }
        },
        {
            definition: {
                name: "get_selected_media_path",
                description: "Path absoluto do clip selecionado (ou primeiro da timeline se nada selecionado).",
                input_schema: { type: "object", properties: {}, required: [] }
            },
            handler: async function () { return await hostCall("getSelectedMediaPath"); }
        },

        // ═══════════ VISION ═══════════
        {
            definition: {
                name: "export_frame_at",
                description: "Exporta um frame do vídeo no tempo X (segundos) pra um arquivo PNG. Use pra 'ver' visualmente um momento específico antes de decidir editar.",
                input_schema: {
                    type: "object",
                    properties: {
                        time_seconds: { type: "number", description: "Tempo na sequência (em segundos)" },
                        out_path: { type: "string", description: "Path absoluto pro PNG. Use %TEMP%/motionia_frame_<n>.png" }
                    },
                    required: ["time_seconds", "out_path"]
                }
            },
            handler: async function (args) {
                return await hostCall("exportFrame", [args.time_seconds, args.out_path]);
            }
        },
        {
            definition: {
                name: "export_frames",
                description: "Exporta múltiplos frames em batch (1 por timestamp). Útil pra 'scan' rápido do vídeo.",
                input_schema: {
                    type: "object",
                    properties: {
                        timestamps_seconds: { type: "array", items: { type: "number" }, description: "Lista de segundos" },
                        out_dir: { type: "string", description: "Diretório pra salvar PNGs" },
                        prefix: { type: "string", description: "Prefixo do nome (opcional)" }
                    },
                    required: ["timestamps_seconds", "out_dir"]
                }
            },
            handler: async function (args) {
                return await hostCall("exportFramesAt", [args.timestamps_seconds, args.out_dir, args.prefix || "frame_"]);
            }
        },
        {
            definition: {
                name: "transcribe_audio",
                description: "Transcreve áudio de um arquivo de vídeo usando Whisper (precisa do motor local rodando). Retorna texto + segmentos word-level com timestamps. Use pra entender o conteúdo falado e achar silêncios.",
                input_schema: {
                    type: "object",
                    properties: {
                        media_path: { type: "string", description: "Path absoluto do vídeo/áudio" },
                        language: { type: "string", description: "Código ISO (pt, en, es...). Auto se omitido." }
                    },
                    required: ["media_path"]
                }
            },
            handler: async function (args) {
                if (!await motorAvailable()) throw new Error("motor_offline — sem motor local, transcrição indisponível. Configure motor URL em Settings.");
                return await motorCall("/api/transcribe", { media_path: args.media_path, language: args.language });
            }
        },
        {
            definition: {
                name: "detect_silences",
                description: "Detecta segmentos silenciosos no áudio (RMS abaixo de threshold por X segundos). Retorna lista de [start, end] em segundos. Base pra 'cortar silêncios'.",
                input_schema: {
                    type: "object",
                    properties: {
                        media_path: { type: "string" },
                        threshold_db: { type: "number", description: "Limite em dB. Default -35", default: -35 },
                        min_silence_sec: { type: "number", description: "Duração mínima do silêncio. Default 0.5", default: 0.5 }
                    },
                    required: ["media_path"]
                }
            },
            handler: async function (args) {
                if (!await motorAvailable()) throw new Error("motor_offline");
                return await motorCall("/api/detect-silences", args);
            }
        },
        {
            definition: {
                name: "detect_scenes",
                description: "Detecta cortes de cena no vídeo via FFmpeg scenedetect. Retorna timestamps dos boundaries.",
                input_schema: {
                    type: "object",
                    properties: {
                        media_path: { type: "string" },
                        threshold: { type: "number", description: "0.0–1.0. Default 0.4", default: 0.4 }
                    },
                    required: ["media_path"]
                }
            },
            handler: async function (args) {
                if (!await motorAvailable()) throw new Error("motor_offline");
                return await motorCall("/api/detect-scenes", args);
            }
        },

        // ═══════════ TIMELINE EDITING ═══════════
        {
            definition: {
                name: "add_cuts_at",
                description: "Adiciona razor cuts em todas as tracks nos timestamps dados. CRIA os cortes, não remove nada.",
                input_schema: {
                    type: "object",
                    properties: { seconds: { type: "array", items: { type: "number" }, description: "Timestamps em segundos" } },
                    required: ["seconds"]
                }
            },
            handler: async function (args) { return await hostCall("addCutsAtSeconds", [args.seconds]); }
        },
        {
            definition: {
                name: "delete_ranges",
                description: "Ripple-delete múltiplos ranges sincronizados em todas as tracks. Cada range é [start_sec, end_sec]. O delete RIPPLE — clips posteriores deslizam pra esquerda.",
                input_schema: {
                    type: "object",
                    properties: {
                        ranges: {
                            type: "array",
                            items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                            description: "Array de pares [start, end] em segundos"
                        }
                    },
                    required: ["ranges"]
                }
            },
            handler: async function (args) { return await hostCall("deleteRanges", [args.ranges]); }
        },
        {
            definition: {
                name: "mute_audio_ranges",
                description: "Silencia (sem cortar) ranges de áudio. Útil pra ruído curto sem precisar ripple.",
                input_schema: {
                    type: "object",
                    properties: { ranges: { type: "array", items: { type: "array", items: { type: "number" } } } },
                    required: ["ranges"]
                }
            },
            handler: async function (args) { return await hostCall("muteAudioRanges", [args.ranges]); }
        },
        {
            definition: {
                name: "set_cti",
                description: "Move o cursor (CTI) pra um tempo específico.",
                input_schema: {
                    type: "object",
                    properties: { seconds: { type: "number" } },
                    required: ["seconds"]
                }
            },
            handler: async function (args) { return await hostCall("setCti", [args.seconds]); }
        },
        {
            definition: {
                name: "set_in_out",
                description: "Marca In/Out na sequência. Útil pra delimitar área de trabalho antes de export.",
                input_schema: {
                    type: "object",
                    properties: {
                        in_seconds: { type: "number" },
                        out_seconds: { type: "number" }
                    }
                }
            },
            handler: async function (args) { return await hostCall("setInOut", [args.in_seconds, args.out_seconds]); }
        },
        {
            definition: {
                name: "select_clips_by_name",
                description: "Seleciona clips na timeline cujo nome contém a substring dada.",
                input_schema: {
                    type: "object",
                    properties: { needle: { type: "string" } },
                    required: ["needle"]
                }
            },
            handler: async function (args) { return await hostCall("selectClipsByName", [args.needle]); }
        },
        {
            definition: {
                name: "set_clip_enabled",
                description: "Habilita/desabilita clips por nome (substring). Útil pra mostrar/esconder mídia sem deletar.",
                input_schema: {
                    type: "object",
                    properties: {
                        needle: { type: "string" },
                        enabled: { type: "boolean" }
                    },
                    required: ["needle", "enabled"]
                }
            },
            handler: async function (args) { return await hostCall("setClipEnabled", [args.needle, args.enabled]); }
        },
        {
            definition: {
                name: "duplicate_sequence",
                description: "Duplica a sequência ativa antes de operação destrutiva. Use ANTES de muitos cortes.",
                input_schema: {
                    type: "object",
                    properties: { new_name: { type: "string", description: "Nome da nova sequência" } }
                }
            },
            handler: async function (args) { return await hostCall("duplicateActiveSequence", [args.new_name || ""]); }
        },
        {
            definition: {
                name: "find_clip_boundaries",
                description: "Lista todos os boundaries (início/fim) dos clips de vídeo. Útil pra entender estrutura da timeline.",
                input_schema: { type: "object", properties: {}, required: [] }
            },
            handler: async function () { return await hostCall("findClipBoundaries"); }
        },

        // ═══════════ MEDIA / IMPORT ═══════════
        {
            definition: {
                name: "import_media",
                description: "Importa arquivo (vídeo/áudio/imagem) no Project Panel e opcionalmente insere na timeline.",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Path absoluto do arquivo" },
                        insert: { type: "boolean", description: "true = também insere na timeline no CTI", default: false }
                    },
                    required: ["path"]
                }
            },
            handler: async function (args) {
                return await hostCall("importAndInsert", [args.path, { insert: !!args.insert }]);
            }
        },
        {
            definition: {
                name: "apply_mogrt_at_cti",
                description: "Insere um MOGRT (Motion Graphics Template) no CTI atual. Use pra adicionar lower thirds, legendas, títulos.",
                input_schema: {
                    type: "object",
                    properties: {
                        mogrt_path: { type: "string", description: "Path absoluto do .mogrt" },
                        track_index: { type: "integer", description: "Track de vídeo (0-based)", default: 1 },
                        duration_sec: { type: "number", description: "Duração em segundos", default: 5 }
                    },
                    required: ["mogrt_path"]
                }
            },
            handler: async function (args) {
                return await hostCall("applyMogrtAtCti", [args.mogrt_path, args.track_index || 1, args.duration_sec || 5]);
            }
        },
        {
            definition: {
                name: "focus_lumetri",
                description: "Seleciona clip e abre painel Lumetri Color. NÃO aplica color grade — só abre pra usuário fazer manual.",
                input_schema: {
                    type: "object",
                    properties: { clip_name: { type: "string", description: "Substring do nome do clip" } },
                    required: ["clip_name"]
                }
            },
            handler: async function (args) { return await hostCall("focusLumetri", [args.clip_name]); }
        },

        // ═══════════ SKILL: UNDERSTAND VIDEO (editorial mode) ═══════════
        {
            definition: {
                name: "skill_understand_video",
                description: "WORKFLOW EDITORIAL — pega o clip selecionado e te dá: (1) transcript word-level do áudio, (2) N frames espaçados pra você VER o que tá acontecendo, (3) info do clip. SEMPRE USE ISSO antes de propor edições. Retorna frames como imagens que você consegue VER (multimodal).",
                input_schema: {
                    type: "object",
                    properties: {
                        num_frames: { type: "integer", description: "Quantos frames extrair (3–10). Default 6.", default: 6 },
                        with_transcript: { type: "boolean", description: "Tentar transcrever (requer motor). Default true.", default: true }
                    }
                }
            },
            handler: async function (args) {
                var numFrames = Math.max(3, Math.min(10, args.num_frames || 6));
                var withTranscript = args.with_transcript !== false;
                var BR = global.BinRunner;

                // 1. Pega clip selecionado + timing (in/out point no arquivo)
                var sel = await hostCall("getSelectedMediaPath");
                if (!sel.path) throw new Error("selecione_um_clip_primeiro");
                var videoPath = sel.path;

                var inPoint = 0, fileDur = 0;
                try {
                    var tm = await hostCall("getSelectedClipTiming");
                    if (tm && typeof tm.inPoint === "number") {
                        inPoint = tm.inPoint;
                        fileDur = (tm.outPoint != null && tm.outPoint > inPoint) ? (tm.outPoint - inPoint) : (tm.clipDuration || 0);
                    }
                } catch (eTm) {}

                // descobre duração real do arquivo via ffprobe se não veio do timing
                if ((!fileDur || fileDur < 0.2) && BR && BR.exists("ffprobe")) {
                    try {
                        var pr = await BR.run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", videoPath], { timeoutMs: 30000 });
                        var d = parseFloat((pr.stdout || "").trim());
                        if (isFinite(d) && d > 0) fileDur = d;
                    } catch (eP) {}
                }
                if (!fileDur || fileDur < 0.2) fileDur = 30;

                // 2. Timestamps espaçados (tempo do ARQUIVO), pulando 5% das bordas
                var pad = fileDur * 0.05;
                var span = Math.max(0.1, fileDur - 2 * pad);
                var step = numFrames > 1 ? span / (numFrames - 1) : 0;
                var timestamps = [];
                for (var i = 0; i < numFrames; i++) timestamps.push(inPoint + pad + step * i);

                var dir = tmpDir();
                if (!dir) throw new Error("sem_acesso_tmpdir");
                var images = [];
                var frameMethod = "none";

                // 3. FRAMES via ffmpeg do ARQUIVO (confiável; independe do QE DOM).
                if (BR && BR.exists("ffmpeg")) {
                    frameMethod = "ffmpeg";
                    for (var j = 0; j < timestamps.length; j++) {
                        var t = timestamps[j];
                        var outPath = npath.join(dir, "uf_" + Date.now() + "_" + j + ".jpg");
                        try {
                            // -ss antes do -i = seek rápido; escala pra largura 768 (suficiente p/ visão, leve)
                            await BR.run("ffmpeg", ["-y", "-ss", String(t), "-i", videoPath, "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "3", outPath], { timeoutMs: 60000 });
                            if (nfs && nfs.existsSync(outPath)) {
                                var b64 = readFileBase64(outPath);
                                if (b64) images.push({ time: Math.round((t - inPoint) * 10) / 10, base64: b64, media_type: "image/jpeg" });
                                try { nfs.unlinkSync(outPath); } catch (_) {}
                            }
                        } catch (eF) {}
                    }
                }
                // Fallback: QE exportFrame (host) se ffmpeg não rolou
                if (images.length === 0) {
                    frameMethod = "qe_fallback";
                    for (var k = 0; k < timestamps.length; k++) {
                        var pth = dir + "/frame_" + Date.now() + "_" + k + ".png";
                        try {
                            var fr = await hostCall("exportFrame", [timestamps[k], pth]);
                            if (fr.path) { var bb = readFileBase64(fr.path); if (bb) images.push({ time: timestamps[k], base64: bb, media_type: "image/png" }); try { nfs.unlinkSync(fr.path); } catch (_) {} }
                        } catch (eQ) {}
                    }
                }

                // 4. TRANSCRIÇÃO via Whisper LOCAL (não depende de motor externo)
                var transcript = null, transcriptText = null;
                if (withTranscript && BR && BR.exists("ffmpeg") && BR.exists("whisper-cli")) {
                    try {
                        var model = "ggml-base.bin";
                        if (!BR.models.exists(model)) { try { await BR.models.download(model); } catch (eD) {} }
                        if (BR.models.exists(model)) {
                            var tmpAud = npath.join(dir, "uf_audio_" + Date.now() + ".wav");
                            await BR.run("ffmpeg", ["-y", "-ss", String(inPoint), "-t", String(fileDur), "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmpAud], { timeoutMs: 3 * 60 * 1000 });
                            var ob = tmpAud.replace(/\.wav$/, "");
                            await BR.run("whisper-cli", ["-m", BR.models.path(model), "-f", tmpAud, "-of", ob, "--output-json", "-l", "auto", "--no-prints"], { timeoutMs: 8 * 60 * 1000 });
                            if (nfs.existsSync(ob + ".json")) {
                                var tj = JSON.parse(nfs.readFileSync(ob + ".json", "utf8"));
                                var segs = tj.transcription || tj.segments || [];
                                transcriptText = segs.map(function (s) { return (s.text || "").trim(); }).join(" ").trim();
                                transcript = { text: transcriptText, segments_count: segs.length, source: "whisper-local" };
                                try { nfs.unlinkSync(ob + ".json"); } catch (_) {}
                            }
                            try { nfs.unlinkSync(tmpAud); } catch (_) {}
                        }
                    } catch (eT) { transcript = { error: eT.message }; }
                }

                return {
                    clip: { path: videoPath, name: sel.basename, in_point: inPoint, duration_seconds: Math.round(fileDur * 10) / 10 },
                    frames_count: images.length,
                    frame_method: frameMethod,
                    images: images,
                    transcript: transcript,
                    transcript_text: transcriptText,
                    note: images.length === 0 ? "frames_falharam — ffmpeg e QE indisponíveis" : null
                };
            }
        },

        // ═══════════ SKILL: CUT SILENCES (composta) ═══════════
        {
            definition: {
                name: "skill_cut_silences",
                description: "SKILL COMPLETA: pega clip selecionado → detecta silêncios por volume REAL (ffmpeg silencedetect, local, sem motor) → ripple-delete. Deixa respiro nas bordas. Backup automático. Tudo em 1 chamada.",
                input_schema: {
                    type: "object",
                    properties: {
                        aggressiveness: { type: "string", description: "conservador | normal | agressivo. Default normal. Use agressivo pra ritmo TikTok.", "enum": ["conservador", "normal", "agressivo"] },
                        noise_db: { type: "number", description: "Opcional: limiar dB custom (ex -32). Sobrescreve o nível." },
                        min_silence_sec: { type: "number", description: "Opcional: duração mínima de silêncio em s." }
                    }
                }
            },
            handler: async function (args) {
                if (!global.Skills) throw new Error("skills_runtime_missing");
                return await global.Skills.run("cortar-pausas", {
                    aggressiveness: args.aggressiveness || "normal",
                    noiseDb: args.noise_db,
                    minSilenceSec: args.min_silence_sec
                });
            }
        },
        {
            definition: {
                name: "skill_remove_fillers",
                description: "SKILL COMPLETA: pega clip selecionado → transcreve word-level (Whisper local) → detecta e remove muletas de fala (é, éé, ahn, um, uh, hmm; e no modo agressivo também tipo/então/aí/sabe). Ripple-delete + backup automático. Estilo Descript.",
                input_schema: {
                    type: "object",
                    properties: {
                        aggressive: { type: "boolean", description: "true = também remove muletas contextuais (tipo/então/aí/sabe). Default false (só hesitações inequívocas)." }
                    }
                }
            },
            handler: async function (args) {
                if (!global.Skills) throw new Error("skills_runtime_missing");
                return await global.Skills.run("remove-fillers", { aggressive: !!args.aggressive });
            }
        },
        {
            definition: {
                name: "skill_smart_clean",
                description: "SKILL COMBO (a melhor pra limpar talking-head): em 1 passada calibra o volume do áudio, detecta silêncios por dB real E muletas de fala (Whisper), funde tudo e aplica de uma vez sem desalinhar a timeline. Backup automático. Retorna stats ricos (antes/depois, % comprimido). Prefira esta pra pedidos genéricos de 'limpar/cortar gordura do vídeo'.",
                input_schema: {
                    type: "object",
                    properties: {
                        aggressiveness: { type: "string", description: "conservador|normal|agressivo. Default normal.", "enum": ["conservador", "normal", "agressivo"] },
                        fillers: { type: "boolean", description: "Remover muletas também. Default true." },
                        aggressiveFillers: { type: "boolean", description: "Incluir muletas contextuais (tipo/então/aí). Default false." }
                    }
                }
            },
            handler: async function (args) {
                if (!global.Skills) throw new Error("skills_runtime_missing");
                return await global.Skills.run("smart-clean", {
                    aggressiveness: args.aggressiveness || "normal",
                    fillers: args.fillers !== false,
                    aggressiveFillers: !!args.aggressiveFillers
                });
            }
        },
        {
            definition: {
                name: "skill_viral_clips",
                description: "SKILL KILLER (estilo OpusClip): pega o vídeo selecionado, usa Gemini pra achar os N melhores momentos virais (com viral_score), e pra cada um gera um SHORT VERTICAL 9:16 completo — corte + reframe no rosto + legenda animada queimada — importado no Premiere. Use quando o user pedir 'clipes/cortes virais', 'shorts automáticos', 'fazer reels desse vídeo', 'igual opus clip'.",
                input_schema: {
                    type: "object",
                    properties: {
                        count: { type: "integer", description: "Quantos shorts gerar (2-5). Default 3." },
                        aspect: { type: "string", description: "9:16 | 1:1 | 4:5. Default 9:16.", "enum": ["9:16", "1:1", "4:5"] },
                        style: { type: "string", description: "Estilo da legenda: viral|tiktok|reels|classic. Default viral.", "enum": ["viral", "tiktok", "reels", "classic"] },
                        subtitles: { type: "boolean", description: "Queimar legenda animada. Default true." },
                        faceTracking: { type: "boolean", description: "Reframe seguindo o rosto. Default true." }
                    }
                }
            },
            handler: async function (args) {
                if (!global.Skills) throw new Error("skills_runtime_missing");
                return await global.Skills.run("viral-clips", {
                    count: args.count || 3,
                    aspect: args.aspect || "9:16",
                    style: args.style || "viral",
                    subtitles: args.subtitles !== false,
                    faceTracking: args.faceTracking !== false
                });
            }
        }
    ];

    // Lista pra Claude tool use
    function getToolDefinitions() {
        return TOOLS.map(function (t) { return t.definition; });
    }
    // Executa tool por nome
    async function executeTool(name, input) {
        var tool = TOOLS.find(function (t) { return t.definition.name === name; });
        if (!tool) throw new Error("tool_unknown: " + name);
        return await tool.handler(input || {});
    }

    global.ClaudeTools = {
        getDefinitions: getToolDefinitions,
        execute: executeTool,
        count: function () { return TOOLS.length; },
        listNames: function () { return TOOLS.map(function (t) { return t.definition.name; }); }
    };
})(typeof window !== "undefined" ? window : globalThis);
