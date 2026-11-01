#!/bin/bash
# Gera a versão de distribuição e envia ao TestFlight (App Store Connect), assinando com a conta
# paga da equipe 42KWQN2RHM. A chave da API fica fora do projeto, em ~/.appstoreconnect.
#
#   bash clients/mobile/enviar-testflight.sh        
set -euo pipefail
cd "$(dirname "$0")"
# O iCloud às vezes troca o atalho ios/android (para as pastas .nosync) por uma pasta incompleta
# e renomeia o atalho para "android 2": refaz o atalho (o conteúdo é gerado pelo Capacitor).
for d in ios android; do
  if [ -d "$d.nosync" ] && [ ! -L "$d" ]; then rm -rf "$d" "$d 2"; ln -s "$d.nosync" "$d"; fi
  [ -L "$d 2" ] && rm -f "$d 2"
done
EQUIPE="${EQUIPE:-42KWQN2RHM}"
ENVF="$HOME/.appstoreconnect/calivix.env"
[ -f "$ENVF" ] || ENVF="$HOME/.appstoreconnect/omniview.env"
NOME="$(node -p "require('./capacitor.config.json').appName")"
source "$ENVF"
AUTH=(-authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
TRAB="$HOME/Library/Developer/${NOME// /-}-testflight"
rm -rf "$TRAB" && mkdir -p "$TRAB"

npm run sync >/dev/null
xattr -cr ios/App/App
# Cada envio precisa de um número de compilação maior que o anterior: data e hora (AAMMDDHHMM).
COMPILACAO="$(date +%y%m%d%H%M)"
plutil -replace CFBundleVersion -string "$COMPILACAO" ios/App/App/Info.plist
echo "  gerando $NOME $(cat ../../VERSAO) (compilação $COMPILACAO) para o TestFlight…"
( cd ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Release \
    -destination 'generic/platform=iOS' -archivePath "$TRAB/App.xcarchive" \
    -allowProvisioningUpdates "${AUTH[@]}" DEVELOPMENT_TEAM="$EQUIPE" CODE_SIGN_STYLE=Automatic archive 2>&1 \
  | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)" )
cat > "$TRAB/opcoes.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$EQUIPE</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
echo "  enviando ao App Store Connect…"
xcodebuild -exportArchive -archivePath "$TRAB/App.xcarchive" -exportOptionsPlist "$TRAB/opcoes.plist" \
  -exportPath "$TRAB/saida" -allowProvisioningUpdates "${AUTH[@]}" 2>&1 | grep -E "error|EXPORT (SUCCEEDED|FAILED)|Upload|uploaded" | tail -5
# Volta o número de compilação ao padrão (a versão única do Calivix).
node patch-native.mjs >/dev/null
echo "  ✓ $NOME enviado — a Apple processa em ~10–30 min e aparece no TestFlight"
