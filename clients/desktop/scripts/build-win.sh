#!/bin/bash
# Gera o instalador do Windows (NSIS, 64 bits) a partir do macOS.
# O NSIS que o electron-builder baixa é só para Intel; em Macs sem Rosetta usamos o makensis
# nativo do Homebrew (brew install makensis) montado numa pasta no formato que ele espera.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v brew >/dev/null && brew --prefix makensis >/dev/null 2>&1; then
  N="$HOME/Library/Developer/Calivix-nsis"
  if [ ! -x "$N/mac/makensis" ] || [ ! -f "$N/elevate.exe" ]; then
    rm -rf "$N" && mkdir -p "$N/mac"
    SH="$(brew --prefix makensis)/share/nsis"
    ln -s "$(brew --prefix makensis)/bin/makensis" "$N/mac/makensis"
    for d in "$SH"/*; do ln -s "$d" "$N/$(basename "$d")"; done
    npx electron-builder --win --x64 >/dev/null 2>&1 || true   # baixa o pacote padrão (contém elevate.exe)
    cp "$(find "$HOME/Library/Caches/electron-builder" -name elevate.exe | head -1)" "$N/elevate.exe"
  fi
  export ELECTRON_BUILDER_NSIS_DIR="$N"
fi

npx electron-builder --win --x64
node scripts/collect-win.mjs
