#!/bin/bash
# Compila o Calivix e instala em TODOS os iPhones e iPads conectados a este Mac (cabo ou mesma
# rede), assinando com a conta Apple da equipe 42KWQN2RHM. Com a conta gratuita, o app precisa ser
# reinstalado a cada 7 dias: é só rodar de novo com os aparelhos conectados.
#
#   bash clients/mobile/instalar-ios.sh
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
DERIVED="$HOME/Library/Developer/Xcode/DerivedData/${NOME// /-}-device"

npm run sync >/dev/null
xattr -cr ios/App/App
echo "  compilando $NOME $(cat ../../VERSAO) para iPhone e iPad…"
# Com a conta paga, a chave do App Store Connect (fora do projeto) deixa o Xcode registrar os
# aparelhos e baixar os perfis de assinatura sozinho.
AUTH=()
if [ -f "$ENVF" ]; then
  source "$ENVF"
  AUTH=(-authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi
( cd ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
    -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" \
    -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} DEVELOPMENT_TEAM="$EQUIPE" CODE_SIGN_STYLE=Automatic build 2>&1 \
  | grep -E "error:|BUILD (SUCCEEDED|FAILED)" )
APP="$DERIVED/Build/Products/Debug-iphoneos/App.app"
[ -d "$APP" ] || { echo "  ✗ app não foi gerado"; exit 1; }
V="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist")"
echo "  ✓ app $V compilado e assinado"

# Aparelhos físicos disponíveis (o JSON do devicectl evita depender do texto da tabela)
J="$(mktemp)"; trap 'rm -f "$J"' EXIT
xcrun devicectl list devices --json-output "$J" >/dev/null 2>&1
LISTA="$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))["result"]["devices"]
for x in d:
    hw=x.get("hardwareProperties",{}); cp=x.get("connectionProperties",{})
    # (com a conexão sem fio adormecida, o sistema às vezes não informa "physical": basta não ser simulador)
    if hw.get("reality")!="simulated" and cp.get("transportType")!="sameMachine" and cp.get("pairingState")=="paired" and cp.get("tunnelState")!="unavailable":
        print(x["identifier"], "|", x["deviceProperties"]["name"])
' "$J")"
[ -n "$LISTA" ] || { echo "  ✗ nenhum iPhone/iPad disponível: conecte pelo cabo, desbloqueie a tela e rode de novo"; exit 1; }
OK=0
while IFS='|' read -r ID NOME; do
  ID="$(echo $ID)"; NOME="$(echo $NOME)"
  # Até 3 tentativas: o iPad/iPhone pode estar acordando ou reconectando pela rede.
  ERRO=""
  for TENTA in 1 2 3; do
    if SAIDA="$(xcrun devicectl device install app --device "$ID" "$APP" 2>&1)"; then ERRO=""; break; fi
    ERRO="$(echo "$SAIDA" | grep -m1 -E "^ERROR:|error" | sed 's/^ERROR: *//' | cut -c1-140)"
    sleep 5
  done
  if [ -z "$ERRO" ]; then
    echo "  ✓ instalado em: $NOME"; OK=$((OK+1))
  else
    echo "  ✗ não foi possível instalar em: $NOME — $ERRO"
    echo "    (deixe o aparelho desbloqueado, perto do Mac ou no cabo, com o Modo de Desenvolvedor ligado)"
  fi
done <<< "$LISTA"
[ "$OK" -gt 0 ]
