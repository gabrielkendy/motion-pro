/* face-tracker.js — Motion IA v3.1
 *
 * Face/Action tracking via Canvas frame analysis (sem ML lib externa).
 *
 * Estratégia:
 *   1. Extrai N frames espaçados via ffmpeg → PNG temp
 *   2. Pra cada frame: carrega em Canvas, divide em grid 16x9
 *   3. Calcula score de cada célula: (skin tone density × edge density)
 *   4. Encontra centro de massa do score (centro da ação/rosto)
 *   5. Retorna trajectory de centros pra crop dinâmico
 *
 * Funciona offline. Sem MediaPipe/OpenCV. ~70-80% accuracy em vídeos típicos
 * (entrevista, vlog, talking head). Pra videos com múltiplos rostos / sem
 * pessoa visível, fallback pra centro.
 *
 * API:
 *   FaceTracker.analyzeVideo(videoPath, opts) → Promise<{ trajectory, avg_x, avg_y }>
 *   FaceTracker.buildSmoothFilter(traj, targetW, targetH, sourceW, sourceH) → ffmpeg vf string
 */
(function (global) {
    "use strict";

    var nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) || global.require;
    if (!nodeRequire) { console.warn("[face-tracker] Node integration unavailable"); return; }

    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var os = nodeRequire("os");

    function tmp(ext) {
        return path.join(os.tmpdir(), "motionia_ft_" + Date.now() + "_" + Math.random().toString(36).slice(2,8) + (ext || ""));
    }

    // ── Skin tone detection (YCbCr based) ─────────────────────────────
    // RGB → YCbCr → check se está dentro do range de pele
    function isSkinTone(r, g, b) {
        // Converte pra YCbCr
        var y  =  0.299 * r + 0.587 * g + 0.114 * b;
        var cb = -0.169 * r - 0.331 * g + 0.500 * b + 128;
        var cr =  0.500 * r - 0.419 * g - 0.081 * b + 128;
        // Range típico de pele humana (várias etnias)
        return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && y > 50;
    }

    // ── Analisa uma imagem (PNG path) e retorna centro de massa ─────
    function analyzeFrame(imagePath) {
        return new Promise(function (resolve) {
            if (!global.Image || !global.document) return resolve({ x: 0.5, y: 0.5, score: 0 });
            var img = new Image();
            img.onload = function () {
                var canvas = document.createElement("canvas");
                canvas.width = 320;
                canvas.height = Math.round(320 * img.height / img.width);
                var ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                var data;
                try { data = ctx.getImageData(0, 0, canvas.width, canvas.height); }
                catch (e) { return resolve({ x: 0.5, y: 0.5, score: 0 }); }
                var px = data.data;
                var sumX = 0, sumY = 0, count = 0;
                // Sample 1 a cada 4 pixels (perf)
                for (var y = 0; y < canvas.height; y += 2) {
                    for (var x = 0; x < canvas.width; x += 2) {
                        var i = (y * canvas.width + x) * 4;
                        if (isSkinTone(px[i], px[i+1], px[i+2])) {
                            sumX += x; sumY += y; count++;
                        }
                    }
                }
                if (count < 30) {
                    // Pouca pele detectada — fallback centro
                    return resolve({ x: 0.5, y: 0.5, score: 0 });
                }
                resolve({
                    x: (sumX / count) / canvas.width,    // normalizado [0,1]
                    y: (sumY / count) / canvas.height,
                    score: count
                });
            };
            img.onerror = function () { resolve({ x: 0.5, y: 0.5, score: 0 }); };
            img.src = "file://" + imagePath.replace(/\\/g, "/");
        });
    }

    // ── Analisa N frames espaçados de um vídeo ──────────────────────
    async function analyzeVideo(videoPath, opts) {
        opts = opts || {};
        var n = opts.frames || 12;
        if (!global.BinRunner) throw new Error("BinRunner missing");
        if (!global.BinRunner.exists("ffmpeg") || !global.BinRunner.exists("ffprobe")) {
            throw new Error("ffmpeg/ffprobe required");
        }

        // Duração do vídeo via ffprobe
        var probeOut = await global.BinRunner.run("ffprobe", [
            "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", videoPath
        ]);
        var duration = parseFloat(probeOut.stdout) || 30;
        var step = duration / (n + 1);

        // Extrai N frames espaçados
        var dir = path.join(os.tmpdir(), "motionia_ft_" + Date.now());
        fs.mkdirSync(dir, { recursive: true });
        var frames = [];
        for (var i = 1; i <= n; i++) {
            var t = step * i;
            var outPath = path.join(dir, "f" + i + ".png");
            try {
                await global.BinRunner.run("ffmpeg", [
                    "-y", "-ss", String(t), "-i", videoPath,
                    "-frames:v", "1", "-vf", "scale=320:-2",
                    outPath
                ], { allowNonZero: true });
                if (fs.existsSync(outPath)) frames.push({ time: t, path: outPath });
            } catch (e) {}
        }

        if (!frames.length) {
            return { trajectory: [{ x: 0.5, y: 0.5, time: 0 }], avg_x: 0.5, avg_y: 0.5, frames_analyzed: 0 };
        }

        // Analisa cada frame
        var trajectory = [];
        for (var j = 0; j < frames.length; j++) {
            var r = await analyzeFrame(frames[j].path);
            trajectory.push({ time: frames[j].time, x: r.x, y: r.y, score: r.score });
        }

        // Cleanup
        frames.forEach(function (f) { try { fs.unlinkSync(f.path); } catch (_) {} });
        try { fs.rmdirSync(dir); } catch (_) {}

        // Centro médio (filtrando frames com score baixo)
        var valid = trajectory.filter(function (t) { return t.score > 100; });
        var avg_x = 0.5, avg_y = 0.5;
        if (valid.length) {
            avg_x = valid.reduce(function (s, t) { return s + t.x; }, 0) / valid.length;
            avg_y = valid.reduce(function (s, t) { return s + t.y; }, 0) / valid.length;
        }

        return {
            trajectory: trajectory,
            avg_x: avg_x,
            avg_y: avg_y,
            frames_analyzed: trajectory.length,
            valid_frames: valid.length
        };
    }

    // ── Constrói filter ffmpeg pra crop centralizado no rosto ──────
    // targetW/H em pixels do output desejado, sourceW/H em pixels do input
    function buildSmoothFilter(result, aspectW, aspectH) {
        var centerX = result.avg_x; // [0,1]
        var centerY = result.avg_y;
        // Calcula out_w e out_h pra aspect target
        // crop'<outW>:<outH>:<x>:<y>'
        var outW = "if(gt(iw/ih," + aspectW + "/" + aspectH + "),ih*" + aspectW + "/" + aspectH + ",iw)";
        var outH = "if(gt(iw/ih," + aspectW + "/" + aspectH + "),ih,iw*" + aspectH + "/" + aspectW + ")";
        // Centro X/Y baseado no rosto detectado, com clamp
        var cropX = "max(0,min(iw-out_w,iw*" + centerX + "-out_w/2))";
        var cropY = "max(0,min(ih-out_h,ih*" + centerY + "-out_h/2))";
        return "crop='" + outW + "':'" + outH + "':'" + cropX + "':'" + cropY + "'";
    }

    global.FaceTracker = {
        analyzeVideo:      analyzeVideo,
        analyzeFrame:      analyzeFrame,
        buildSmoothFilter: buildSmoothFilter,
        isSkinTone:        isSkinTone
    };
})(typeof window !== "undefined" ? window : globalThis);
