#!/usr/bin/env node
/**
 * generate-motionia-demo.js
 *
 * Gera um vídeo demo MP4 do Motion IA (6 cenas) usando ffmpeg + lavfi.
 * Output: landing/img/motionia-demo.mp4 + motionia-poster.jpg
 * Uso: node tools/generate-motionia-demo.js
 */
"use strict";
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO, "landing", "img");
const OUT = path.join(OUT_DIR, "motionia-demo.mp4");
const TMP = path.join(os.tmpdir(), "mia-demo-" + Date.now());
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

let FF = path.join(REPO, "plugin-ia", "bin", "win", "ffmpeg.exe");
if (!fs.existsSync(FF)) FF = "ffmpeg";

const W = 1280, H = 720, FPS = 24, SCENE_SEC = 3.5;
const BG    = "0x0a0c12";
const BG2   = "0x11141d";
const ACC   = "0x2563eb";
const TXT   = "0xe7e9ee";
const MUT   = "0x8590a8";
const OK    = "0x10b981";
const ERR   = "0xef4444";

// Escapa string pra drawtext (escapa : e ')
function esc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%");
}

function ff(args) {
    const cmd = [`"${FF}"`].concat(args.map(a => {
        // Quote args com espaço ou caractere especial pro shell
        if (/[ "&|<>]/.test(a)) return `"${a.replace(/"/g, '\\"')}"`;
        return a;
    })).join(" ");
    execSync(cmd, { stdio: "inherit" });
}

// Cada cena gera mp4 curto via lavfi
function genScene(idx, title, subtitle, badge, line1, line2, extras) {
    const out = path.join(TMP, `scene${idx}.mp4`);
    let chain = `color=c=${BG}:s=${W}x${H}:r=${FPS}:d=${SCENE_SEC}`;
    // Header bar
    chain += `,drawbox=x=0:y=0:w=${W}:h=80:color=${BG2}:t=fill`;
    chain += `,drawbox=x=0:y=80:w=${W}:h=2:color=${ACC}:t=fill`;
    // Brand
    chain += `,drawtext=text='${esc("Motion IA v3.1")}':fontcolor=${TXT}:fontsize=22:x=40:y=30`;
    // Tier badge (top-right)
    chain += `,drawbox=x=${W-160}:y=24:w=120:h=32:color=${ACC}:t=fill`;
    chain += `,drawtext=text='${esc(badge)}':fontcolor=white:fontsize=14:x=${W-140}:y=34`;
    // Main title
    chain += `,drawtext=text='${esc(title)}':fontcolor=${TXT}:fontsize=68:x=(w-text_w)/2:y=180`;
    // Subtitle
    chain += `,drawtext=text='${esc(subtitle)}':fontcolor=${MUT}:fontsize=24:x=(w-text_w)/2:y=280`;
    // Body lines
    if (line1) chain += `,drawtext=text='${esc(line1)}':fontcolor=${TXT}:fontsize=22:x=(w-text_w)/2:y=360`;
    if (line2) chain += `,drawtext=text='${esc(line2)}':fontcolor=${TXT}:fontsize=22:x=(w-text_w)/2:y=400`;
    // Extra draws (boxes/blocks per scene)
    if (extras) chain += "," + extras;
    // Footer dot
    chain += `,drawtext=text='${esc("[ " + idx + "/6 ]")}':fontcolor=${MUT}:fontsize=14:x=40:y=${H-30}`;
    // Fade in/out
    chain += `,fade=t=in:st=0:d=0.3,fade=t=out:st=${SCENE_SEC - 0.3}:d=0.3`;

    ff([
        "-y",
        "-f", "lavfi",
        "-i", chain,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-r", String(FPS),
        out
    ]);
    return out;
}

console.log("Gerando 6 cenas do demo Motion IA...");

const scenes = [
    {
        idx: 1,
        title: "Motion IA",
        subtitle: "13 features de edicao IA no Premiere Pro",
        badge: "v3.1.0",
        line1: "Whisper local + Gemini visao + Claude agentic",
        line2: "Nada vai pro cloud por padrao",
        extras: ""
    },
    {
        idx: 2,
        title: "Cortar Pausas",
        subtitle: "Whisper local detecta silencios",
        badge: "FEATURE 01",
        line1: "12 pausas removidas - 8.4s economizados",
        line2: "Ripple delete automatico",
        extras: `drawbox=x=200:y=480:w=880:h=80:color=${BG2}:t=fill,` +
                `drawbox=x=300:y=495:w=60:h=50:color=${ERR}@0.7:t=fill,` +
                `drawbox=x=460:y=495:w=80:h=50:color=${ERR}@0.7:t=fill,` +
                `drawbox=x=620:y=495:w=70:h=50:color=${ERR}@0.7:t=fill,` +
                `drawbox=x=820:y=495:w=90:h=50:color=${ERR}@0.7:t=fill`
    },
    {
        idx: 3,
        title: "Caca-Trechos",
        subtitle: "Gemini acha os 5 melhores momentos virais",
        badge: "FEATURE 03",
        line1: "Gera Shorts verticais 9 por 16 automaticamente",
        line2: "",
        extras: `drawbox=x=380:y=470:w=80:h=140:color=${ACC}:t=fill,` +
                `drawbox=x=480:y=470:w=80:h=140:color=${ACC}:t=fill,` +
                `drawbox=x=580:y=470:w=80:h=140:color=${ACC}:t=fill,` +
                `drawbox=x=680:y=470:w=80:h=140:color=${ACC}:t=fill,` +
                `drawbox=x=780:y=470:w=80:h=140:color=${ACC}:t=fill`
    },
    {
        idx: 4,
        title: "Auto Crop Face Track",
        subtitle: "Detecta rosto via Canvas YCbCr e segue",
        badge: "FEATURE 11",
        line1: "Reframe 9x16  -  1x1  -  4x5",
        line2: "Zero cliques apos o setup",
        extras: `drawbox=x=440:y=440:w=400:h=200:color=${BG2}:t=fill,` +
                `drawbox=x=438:y=438:w=404:h=204:color=${MUT}:t=2,` +
                `drawbox=x=560:y=470:w=140:h=160:color=${ACC}:t=4`
    },
    {
        idx: 5,
        title: "Casper Auto-edit",
        subtitle: "Pipeline customizavel com regras encadeadas",
        badge: "FEATURE 13",
        line1: "1. Cortar pausas - 2. Organizar bins",
        line2: "3. Aplicar transicoes - 4. Legendas viral",
        extras: `drawbox=x=300:y=480:w=680:h=44:color=${BG2}:t=fill,` +
                `drawtext=text='${esc("OK Cortar pausas")}':fontcolor=${OK}:fontsize=20:x=320:y=494,` +
                `drawbox=x=300:y=530:w=680:h=44:color=${BG2}:t=fill,` +
                `drawtext=text='${esc("OK Organizar bins")}':fontcolor=${OK}:fontsize=20:x=320:y=544,` +
                `drawbox=x=300:y=580:w=680:h=44:color=${BG2}:t=fill,` +
                `drawtext=text='${esc("OK Aplicar transicoes")}':fontcolor=${OK}:fontsize=20:x=320:y=594`
    },
    {
        idx: 6,
        title: "Baixe agora",
        subtitle: "Windows + macOS - Premiere 2020+",
        badge: "GRATIS",
        line1: "motionpro-lp.vercel.app/ia",
        line2: "Plano Free com 5 features liberadas",
        extras: `drawbox=x=440:y=480:w=400:h=80:color=${ACC}:t=fill,` +
                `drawtext=text='${esc("Download v3.1.0")}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=508`
    }
];

const sceneFiles = scenes.map(s => genScene(s.idx, s.title, s.subtitle, s.badge, s.line1, s.line2, s.extras));

const concatList = path.join(TMP, "concat.txt");
fs.writeFileSync(concatList, sceneFiles.map(f => `file '${f.replace(/\\/g, "/")}'`).join("\n"));

console.log("Concatenando...");
ff(["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", OUT]);

// Cleanup
sceneFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
try { fs.unlinkSync(concatList); } catch (_) {}
try { fs.rmdirSync(TMP); } catch (_) {}

const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`\n[OK] Demo: ${OUT} (${sizeMB} MB)`);
console.log(`     ${scenes.length} cenas x ${SCENE_SEC}s = ${(scenes.length * SCENE_SEC).toFixed(1)}s`);

// Poster
const POSTER = path.join(OUT_DIR, "motionia-poster.jpg");
console.log("Gerando poster...");
ff(["-y", "-i", OUT, "-vframes", "1", "-q:v", "3", POSTER]);
console.log(`[OK] Poster: ${POSTER}`);
