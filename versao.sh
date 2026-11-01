#!/bin/bash
# O Calivix tem UM número de versão (arquivo VERSAO) e todas as partes dizem esse número:
# servidor, imagem Docker, app da loja do Umbrel, app de macOS/Windows e app de iPhone/iPad/Android.
#
#   bash versao.sh            mostra a versão em cada parte (e se alguma está diferente)
#   bash versao.sh 1.0.1      sobe tudo para 1.0.1
set -euo pipefail
cd "$(dirname "$0")"
ATUAL="$(tr -d ' \n\r' < VERSAO)"

mostrar() {
  printf '  %-28s %s\n' "VERSAO" "$(cat VERSAO)"
  printf '  %-28s %s\n' "servidor" "$(node -p "require('./server/package.json').version")"
  printf '  %-28s %s\n' "app macOS/Windows" "$(node -p "require('./clients/desktop/package.json').version")"
  printf '  %-28s %s\n' "app iPhone/iPad/Android" "$(node -p "require('./clients/mobile/package.json').version")"
  printf '  %-28s %s\n' "loja: Calivix" "$(sed -n 's/^version: "\(.*\)"/\1/p' umbrel/adalberto-calivix/umbrel-app.yml)"
  printf '  %-28s %s\n' "loja: imagem" "$(grep -o 'calivix-server:[0-9.]*' umbrel/adalberto-calivix/docker-compose.yml | cut -d: -f2)"
}

if [ $# -eq 0 ]; then mostrar; exit 0; fi
NOVA="$1"
[[ "$NOVA" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Versão inválida: $NOVA"; exit 1; }
echo "$NOVA" > VERSAO
for f in server/package.json clients/desktop/package.json clients/mobile/package.json; do
  node -e "const f='$f',p=require('./'+f);p.version='$NOVA';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
done
sed -i '' "s/^version: \"[0-9.]*\"/version: \"$NOVA\"/" umbrel/adalberto-calivix/umbrel-app.yml
sed -i '' -E "s/(calivix-server):[0-9.]+/\1:$NOVA/g" umbrel/adalberto-calivix/docker-compose.yml
echo "Versão $ATUAL → $NOVA"
mostrar
