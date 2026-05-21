#!/bin/bash
# download-bin-motion-ia-mac.sh
# Baixa binários macOS pra Motion IA: ffmpeg, ffprobe, whisper-cli, yt-dlp, aria2c
# Coloca em plugin-ia/bin/mac/
# Rode no terminal mac:  bash tools/download-bin-motion-ia-mac.sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/plugin-ia/bin/mac"
mkdir -p "$BIN_DIR"

echo "[motion-ia] target dir: $BIN_DIR"

# Detecta arquitetura (intel vs arm64/M1)
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    FFMPEG_URL="https://www.osxexperts.net/ffmpeg71arm.zip"
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    ARIA2_URL="https://github.com/aria2/aria2/releases/download/release-1.36.0/aria2-1.36.0-osx-darwin.tar.bz2"
    WHISPER_URL="https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-bin-Darwin-arm64.zip"
else
    FFMPEG_URL="https://www.osxexperts.net/ffmpeg71intel.zip"
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    ARIA2_URL="https://github.com/aria2/aria2/releases/download/release-1.36.0/aria2-1.36.0-osx-darwin.tar.bz2"
    WHISPER_URL="https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-bin-Darwin-x86_64.zip"
fi

cd "$BIN_DIR"

# 1) ffmpeg + ffprobe
echo "[1/4] ffmpeg + ffprobe ($ARCH)..."
curl -fL -o ffmpeg.zip "$FFMPEG_URL"
unzip -o ffmpeg.zip && rm ffmpeg.zip
[ -f ffmpeg ] && chmod +x ffmpeg
# ffprobe vem junto em algumas builds, senão baixa separado
if [ ! -f ffprobe ]; then
    if [[ "$ARCH" == "arm64" ]]; then
        curl -fL -o ffprobe.zip "https://www.osxexperts.net/ffprobe71arm.zip"
    else
        curl -fL -o ffprobe.zip "https://www.osxexperts.net/ffprobe71intel.zip"
    fi
    unzip -o ffprobe.zip && rm ffprobe.zip
    chmod +x ffprobe
fi

# 2) yt-dlp
echo "[2/4] yt-dlp..."
curl -fL -o yt-dlp "$YTDLP_URL"
chmod +x yt-dlp

# 3) aria2c
echo "[3/4] aria2c..."
curl -fL -o aria2.tar.bz2 "$ARIA2_URL"
tar -xjf aria2.tar.bz2
cp aria2-*-osx-darwin/bin/aria2c .
rm -rf aria2-*-osx-darwin aria2.tar.bz2
chmod +x aria2c

# 4) whisper-cli (se a release tiver pré-built; caso contrário usuário compila)
echo "[4/4] whisper-cli..."
if curl -fL -o whisper.zip "$WHISPER_URL" 2>/dev/null; then
    unzip -o whisper.zip && rm whisper.zip
    [ -f main ] && mv main whisper-cli
    [ -f bin/main ] && mv bin/main whisper-cli && rm -rf bin
    chmod +x whisper-cli
else
    echo "[warn] whisper-cli pre-built indisponível pro seu arch. Compile manualmente:"
    echo "       git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp && make && cp main $BIN_DIR/whisper-cli"
fi

echo ""
echo "[motion-ia] binários instalados:"
ls -lh "$BIN_DIR"
echo ""
echo "[OK] tudo pronto. Pode rodar tools/build-zip-ia-mac.js"
