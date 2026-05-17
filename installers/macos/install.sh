#!/usr/bin/env bash
# ============================================================
#  MotionVault — macOS installer
#  - copies the plugin to ~/Library/Application Support/Adobe/CEP/extensions
#  - enables PlayerDebugMode on every CSXS version
# ============================================================
set -e

EXT_NAME="MotionVault"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../plugin"
DST="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_NAME"

echo
echo "=== MotionVault installer (macOS) ==="
echo "Origem : $SRC"
echo "Destino: $DST"
echo

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
    echo "[ERRO] manifest.xml não encontrado em $SRC/CSXS" >&2
    exit 1
fi

if [ -d "$DST" ]; then
    echo "Removendo instalação anterior..."
    rm -rf "$DST"
fi

mkdir -p "$(dirname "$DST")"
echo "Copiando arquivos..."
cp -R "$SRC" "$DST"

echo "Habilitando PlayerDebugMode (CSXS 6..20)..."
for v in 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null || true
    defaults write "com.adobe.CSXS.$v" LogLevel 1 2>/dev/null || true
done

echo
echo "OK! Reabra o Adobe Premiere Pro e procure por:"
echo "  Window > Extensions > MotionVault"
echo
