#!/bin/bash
# Motion IA · Instalador macOS
# Usuário dá duplo-clique. Para Premiere Pro 2020+.

set -e

EXT_ID="com.motionpro.ia"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC="$SCRIPT_DIR/MotionPro-IA"
CEP_CACHE="$HOME/Library/Caches/CSXS"

clear
cat <<'BANNER'

  ============================================================

              M O T I O N   P R O   ·   I A

           Agente de Edição IA para Premiere Pro
                      by PacotesFX

  ============================================================

BANNER

if [ ! -d "$SRC" ]; then
    echo "  [ERRO] Pasta MotionPro-IA não encontrada em: $SRC"
    echo "         Verifique se você extraiu o .zip antes de rodar."
    read -n1 -r -p "  Pressione qualquer tecla para sair..."
    exit 1
fi

# Avisa se Premiere está aberto
if pgrep -x "Adobe Premiere Pro" > /dev/null 2>&1; then
    echo "  [AVISO] Premiere Pro está aberto."
    read -n1 -r -p "         Feche e pressione qualquer tecla para continuar..."
    echo ""
fi

echo "  [1/5] Habilitando CEP PlayerDebugMode..."
for ver in 9 10 11 12; do
    defaults write "com.adobe.CSXS.${ver}" PlayerDebugMode 1 2>/dev/null || true
done
echo "        OK"

echo "  [2/5] Limpando cache CEP..."
rm -rf "$CEP_CACHE" 2>/dev/null || true
echo "        OK"

echo "  [3/5] Removendo versão anterior..."
rm -rf "$DEST" 2>/dev/null || true
mkdir -p "$(dirname "$DEST")"
echo "        OK"

echo "  [4/5] Copiando arquivos..."
cp -R "$SRC" "$DEST"
if [ $? -ne 0 ]; then
    echo "  [ERRO] Falha ao copiar. Verifique permissões."
    read -n1 -r -p "  Pressione qualquer tecla para sair..."
    exit 1
fi
echo "        OK"

echo "  [5/6] Marcando binários como executáveis + removendo quarentena..."
chmod +x "$DEST/bin/mac/"* 2>/dev/null || true
# Remove macOS quarantine attribute (evita Gatekeeper bloqueando os binários)
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
echo "        OK"

echo "  [6/6] Verificando binários macOS..."
MAC_BIN="$DEST/bin/mac"
NEEDS_DL=0
for b in ffmpeg ffprobe yt-dlp aria2c whisper-cli; do
    if [ ! -f "$MAC_BIN/$b" ]; then NEEDS_DL=1; fi
done
if [ $NEEDS_DL -eq 1 ]; then
    echo "        Baixando binários macOS (~100 MB · primeira vez)..."
    ARCH=$(uname -m)
    if [[ "$ARCH" == "arm64" ]]; then
        FFMPEG_URL="https://www.osxexperts.net/ffmpeg71arm.zip"
        FFPROBE_URL="https://www.osxexperts.net/ffprobe71arm.zip"
    else
        FFMPEG_URL="https://www.osxexperts.net/ffmpeg71intel.zip"
        FFPROBE_URL="https://www.osxexperts.net/ffprobe71intel.zip"
    fi
    mkdir -p "$MAC_BIN" && cd "$MAC_BIN"
    [ ! -f ffmpeg ]   && curl -fL --progress-bar -o ffmpeg.zip   "$FFMPEG_URL"   && unzip -oq ffmpeg.zip   && rm ffmpeg.zip   && chmod +x ffmpeg
    [ ! -f ffprobe ]  && curl -fL --progress-bar -o ffprobe.zip  "$FFPROBE_URL"  && unzip -oq ffprobe.zip  && rm ffprobe.zip  && chmod +x ffprobe
    [ ! -f yt-dlp ]   && curl -fL --progress-bar -o yt-dlp       "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" && chmod +x yt-dlp
    [ ! -f aria2c ]   && curl -fL --progress-bar -o aria2.tar.bz2 "https://github.com/aria2/aria2/releases/download/release-1.36.0/aria2-1.36.0-osx-darwin.tar.bz2" && tar -xjf aria2.tar.bz2 && cp aria2-*-osx-darwin/bin/aria2c . && rm -rf aria2-*-osx-darwin aria2.tar.bz2 && chmod +x aria2c
    # whisper-cli — opcional. Sem ele, features Whisper desabilitam mas o resto roda.
    if [ ! -f whisper-cli ]; then
        echo "        [aviso] whisper-cli não shippado pra mac. Features Whisper local ficam desabilitadas."
        echo "        Pra ativar: git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp && make && cp main $MAC_BIN/whisper-cli"
    fi
    xattr -dr com.apple.quarantine "$MAC_BIN" 2>/dev/null || true
    cd "$SCRIPT_DIR"
    echo "        ✓ binários instalados"
else
    echo "        OK"
fi

cat <<'DONE'

  ============================================================
       ✓  M O T I O N   P R O   I A   I N S T A L A D O
  ============================================================

    1. Abra o Adobe Premiere Pro
    2. Menu Janela > Extensões > MotionPro IA
    3. Faça login (mesma conta dos outros plugins)
    4. Comece falando com a IA via aba CHAT

    Exemplos do que pedir:
      - "Corta todos os silêncios maiores que 0.7s"
      - "Lista os clips da timeline"
      - "Adiciona corte aos 12s, 28s e 45s"

  Suporte: suporte@pacotesfx.com
  ============================================================

DONE

read -n1 -r -p "  Abrir Premiere agora? (s/n) " choice
echo ""
if [[ "$choice" =~ ^[Ss]$ ]]; then
    for year in 2026 2025 2024 2023; do
        APP_PATH="/Applications/Adobe Premiere Pro ${year}/Adobe Premiere Pro ${year}.app"
        if [ -d "$APP_PATH" ]; then
            open "$APP_PATH"
            break
        fi
    done
fi

exit 0
