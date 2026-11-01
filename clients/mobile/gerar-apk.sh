#!/bin/bash
# Gera o instalador Android único (Calivix-<versão>.apk) para celulares, tablets, TVs e TV boxes Android.
# A chave de assinatura fica FORA do projeto (~/Library/Developer/Calivix-android): guarde uma cópia;
# as próximas versões precisam ser assinadas com a mesma chave para atualizar o app instalado.
#
#   bash clients/mobile/gerar-apk.sh
set -euo pipefail
cd "$(dirname "$0")"
# O iCloud às vezes troca o atalho ios/android (para as pastas .nosync) por uma pasta incompleta
# e renomeia o atalho para "android 2": refaz o atalho (o conteúdo é gerado pelo Capacitor).
for d in ios android; do
  if [ -d "$d.nosync" ] && [ ! -L "$d" ]; then rm -rf "$d" "$d 2"; ln -s "$d.nosync" "$d"; fi
  [ -L "$d 2" ] && rm -f "$d 2"
done
RAIZ="$(cd ../.. && pwd)"
NOME="$(node -p "require('./capacitor.config.json').appName")"
ARQ="${NOME// /-}"
CHAVES="$HOME/Library/Developer/Calivix-android"
# O Gradle do projeto precisa do Java 17–21 (o Java do Android Studio pode ser mais novo).
export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21 2>/dev/null || /usr/libexec/java_home -v 17 2>/dev/null || echo "/Applications/Android Studio.app/Contents/jbr/Contents/Home")}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
mkdir -p "$CHAVES"
if [ ! -f "$CHAVES/calivix.keystore" ]; then
  openssl rand -hex 16 > "$CHAVES/senha"
  chmod 600 "$CHAVES/senha"
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$CHAVES/calivix.keystore" -alias calivix -keyalg RSA -keysize 4096 \
    -validity 36500 -storepass "$(cat "$CHAVES/senha")" -keypass "$(cat "$CHAVES/senha")" -dname "CN=Calivix, O=Adalberto Silva" >/dev/null 2>&1
  echo "  ✓ chave de assinatura criada em $CHAVES (faça uma cópia de segurança)"
fi
SENHA="$(cat "$CHAVES/senha")"
npm run sync >/dev/null
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
echo "  compilando $NOME $(cat "$RAIZ/VERSAO") para Android…"
LOG="$(mktemp)"
if ! ( cd android && ./gradlew -q assembleRelease \
    -Pandroid.injected.signing.store.file="$CHAVES/calivix.keystore" \
    -Pandroid.injected.signing.store.password="$SENHA" \
    -Pandroid.injected.signing.key.alias=calivix \
    -Pandroid.injected.signing.key.password="$SENHA" ) > "$LOG" 2>&1; then
  grep -vE "^(w:|warning:|Note:)" "$LOG" | tail -25; rm -f "$LOG"; echo "  ✗ falha ao compilar o Android"; exit 1
fi
rm -f "$LOG"
APK="android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "  ✗ o .apk não foi gerado"; exit 1; }
mkdir -p "$RAIZ/INSTALADORES/Android"
# Nome com a versão: dá para conferir que o arquivo novo chegou antes de instalar.
V="$(node -p "require('./package.json').version")"
rm -f "$RAIZ/INSTALADORES/Android"/"$ARQ"-[0-9]*.apk
cp "$APK" "$RAIZ/INSTALADORES/Android/$ARQ-$V.apk"
echo "  ✓ INSTALADORES/Android/$ARQ-$V.apk ($(du -h "$APK" | cut -f1))"
