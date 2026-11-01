#!/bin/bash
# Gera o Calivix.app (Apple Silicon e Intel), assina com o certificado Apple Development e cria
# o instalador Calivix-<versão>.dmg — mesmo padrão do Klean e do Benilab: janela com a arte da marca
# (marca/dmg/fundo.png), ícones grandes, seta para Aplicativos e ícone próprio do disco.
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(cd ../.. && pwd)"
VERSAO="$(node -p "require('./package.json').version")"
NOME="Calivix"; ARQ="Calivix"; CONFIG=(); DIST="dist.nosync"; MARCA_DMG="$RAIZ/marca/dmg"

npx electron-builder --mac ${CONFIG[@]+"${CONFIG[@]}"}
APP_ORIG="$DIST/mac-universal/$NOME.app"
[ -d "$APP_ORIG" ] || APP_ORIG="$(ls -d "$DIST"/mac*/"$NOME.app" | head -1)"

# Developer ID (conta paga): abre em qualquer Mac sem aviso, depois de notarizado pela Apple.
# Sem ele, Apple Development (só nos Macs da equipe) ou assinatura local.
# (pela impressão digital: o nome tem acento e o "security" o devolve com a codificação trocada)
TIPO="Developer ID"
IDENTITY="$(security find-identity -v -p codesigning | awk '/"Developer ID Application:/{print $2; exit}')"
[ -n "$IDENTITY" ] || { TIPO="Apple Development"; IDENTITY="$(security find-identity -v -p codesigning | awk '/"Apple Development:/{print $2; exit}')"; }
[ -n "$IDENTITY" ] || TIPO="assinatura local (ad-hoc)"
# Assina uma cópia fora do iCloud: dentro dele o sistema volta a anexar metadados aos arquivos,
# o que invalida a assinatura ("resource fork, Finder information, or similar detritus").
WORK="$HOME/Library/Developer/$ARQ-desktop-build"
rm -rf "$WORK" && mkdir -p "$WORK/palco"
APP="$WORK/palco/$NOME.app"
ditto --norsrc --noextattr --noqtn "$APP_ORIG" "$APP"
if [ "$TIPO" = "Developer ID" ]; then
  # De dentro para fora (o --deep não alcança todas as bibliotecas do Electron, e a notarização
  # exige assinatura com carimbo de tempo em cada binário): binários soltos, frameworks,
  # apps auxiliares e, por último, o próprio app.
  ASSINA=(codesign --force --options runtime --timestamp --sign "$IDENTITY")
  while IFS= read -r -d '' f; do
    # (o binário principal de um framework falha aqui e é assinado junto com o framework, logo abaixo)
    if [[ "$(file -b "$f")" == *Mach-O* ]]; then "${ASSINA[@]}" "$f" >/dev/null 2>&1 || true; fi
  done < <(find "$APP/Contents/Frameworks" -type f -print0 | sort -rz)
  for f in "$APP"/Contents/Frameworks/*.framework; do "${ASSINA[@]}" "$f" >/dev/null; done
  for f in "$APP"/Contents/Frameworks/*.app; do "${ASSINA[@]}" --entitlements entitlements.mac.plist "$f" >/dev/null; done
  "${ASSINA[@]}" --entitlements entitlements.mac.plist "$APP"
else
  codesign --force --deep --sign "${IDENTITY:--}" "$APP"
fi
codesign --verify --deep --strict "$APP"
echo "Assinado com: $TIPO"

# ---- janela do instalador
ln -s /Applications "$WORK/palco/Aplicativos"
mkdir -p "$WORK/palco/.background"
tiffutil -cathidpicheck "$MARCA_DMG/fundo.png" "$MARCA_DMG/fundo@2x.png" -out "$WORK/palco/.background/fundo.tiff" 2>/dev/null

# ícone do disco (marca/dmg/icone-instalador.png; sem ele, o ícone do app)
ICONE_DISCO="$MARCA_DMG/icone-instalador.png"
[ -f "$ICONE_DISCO" ] || ICONE_DISCO="$RAIZ/marca/png/icone-macos-1024.png"
CONJ="$WORK/disco.iconset"; mkdir -p "$CONJ"
for t in 16 32 128 256 512; do
  sips -z $t $t "$ICONE_DISCO" --out "$CONJ/icon_${t}x${t}.png" >/dev/null
  sips -z $((t*2)) $((t*2)) "$ICONE_DISCO" --out "$CONJ/icon_${t}x${t}@2x.png" >/dev/null
done
iconutil -c icns "$CONJ" -o "$WORK/volume.icns"

OUT="$RAIZ/INSTALADORES/Mac"; mkdir -p "$OUT"
# Nome com a versão: dá para conferir que o arquivo novo chegou (ex.: pelo iCloud) antes de instalar.
DMG="$OUT/$ARQ-$VERSAO.dmg"
VOLUME="$NOME $VERSAO"
[ -d "/Volumes/$VOLUME" ] && { echo "Já há um disco \"$VOLUME\" aberto; ejete-o e rode de novo"; exit 1; }
MB=$(( $(du -sm "$WORK/palco" | cut -f1) + 60 ))
hdiutil create -quiet -volname "$VOLUME" -srcfolder "$WORK/palco" -fs HFS+ -format UDRW -megabytes $MB -ov "$WORK/rascunho.dmg"
hdiutil attach -quiet -readwrite -noverify -noautoopen "$WORK/rascunho.dmg"
# O Finder grava a arrumação no .DS_Store do disco (precisa da permissão de Automação para o Finder).
osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$VOLUME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set pathbar visible of container window to false
    set the bounds of container window to {200, 120, 840, 548}
    set opcoes to the icon view options of container window
    set arrangement of opcoes to not arranged
    set icon size of opcoes to 144
    set text size of opcoes to 14
    set background picture of opcoes to file ".background:fundo.tiff"
    set position of item "$NOME.app" of container window to {150, 204}
    set position of item "Aplicativos" of container window to {490, 204}
    update without registering applications
    delay 1
    close
  end tell
end tell
APPLESCRIPT
# O ícone do disco entra depois da arrumação (antes disso o Finder o descarta).
cp "$WORK/volume.icns" "/Volumes/$VOLUME/.VolumeIcon.icns"
SetFile -a C "/Volumes/$VOLUME"
rm -rf "/Volumes/$VOLUME/.fseventsd"
sync
[ -f "/Volumes/$VOLUME/.DS_Store" ] || { hdiutil detach -quiet "/Volumes/$VOLUME"; echo "A arrumação da janela não foi gravada"; exit 1; }
hdiutil detach -quiet "/Volumes/$VOLUME"
FINAL="$WORK/final.dmg"
hdiutil convert -quiet "$WORK/rascunho.dmg" -format UDZO -imagekey zlib-level=9 -o "$FINAL"
codesign --force --timestamp --sign "${IDENTITY:--}" "$FINAL"
codesign --verify "$FINAL"

# Notarização (Apple confere o app e "carimba" o instalador). A chave da API fica fora do projeto,
# em ~/.appstoreconnect (calivix.env ou omniview.env com os IDs e private_keys/AuthKey_<id>.p8).
ENVF="$HOME/.appstoreconnect/calivix.env"
[ -f "$ENVF" ] || ENVF="$HOME/.appstoreconnect/omniview.env"
if [ "$TIPO" = "Developer ID" ] && [ -f "$ENVF" ]; then
  source "$ENVF"
  echo "Enviando para a notarização da Apple (alguns minutos)…"
  SAIDA="$(xcrun notarytool submit "$FINAL" --key "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" --wait 2>&1)"
  if ! grep -q "status: Accepted" <<< "$SAIDA"; then
    echo "$SAIDA" | tail -5
    ID="$(sed -n 's/^ *id: \(.*\)$/\1/p' <<< "$SAIDA" | head -1)"
    [ -n "$ID" ] && xcrun notarytool log "$ID" --key "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" 2>&1 | head -40
    echo "Notarização recusada"; exit 1
  fi
  xcrun stapler staple -q "$FINAL"
  spctl -a -t open --context context:primary-signature "$FINAL" && echo "Notarizado: abre em qualquer Mac sem aviso"
fi
rm -f "$OUT"/"$ARQ"-[0-9]*.dmg
mv "$FINAL" "$DMG"
rm -rf "$WORK"
echo "Pronto: INSTALADORES/Mac/$ARQ-$VERSAO.dmg ($(du -h "$DMG" | cut -f1 | tr -d ' '))"
