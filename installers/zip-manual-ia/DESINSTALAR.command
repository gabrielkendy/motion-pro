#!/bin/bash
# Motion IA · Desinstalador macOS

EXT_ID="com.motionpro.ia"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"
CEP_CACHE="$HOME/Library/Caches/CSXS"

clear
echo ""
echo "  ============================================================"
echo "           MotionPro IA — Desinstalador"
echo "  ============================================================"
echo ""

if [ ! -d "$DEST" ]; then
    echo "  Plugin não instalado."
    read -n1 -r -p "  Pressione qualquer tecla para sair..."
    exit 0
fi

echo "  Removendo: $DEST"
rm -rf "$DEST"
rm -rf "$CEP_CACHE" 2>/dev/null || true

echo ""
echo "  ✓ MotionPro IA desinstalado."
echo "  Sua conta e licença continuam intactas — pode reinstalar a qualquer momento."
echo ""
read -n1 -r -p "  Pressione qualquer tecla para sair..."
exit 0
