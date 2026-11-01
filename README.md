# Calivix — ajuste fino para suas TVs

Calivix faz o que o [CleanYourTV](https://github.com/Gathin23/cleanyourtv) faz (limpar TVs Android/Google TV
pela depuração ADB, com as mesmas travas de segurança, e trocar a tela inicial por um launcher limpo), em apps
para **macOS, Windows, iPhone, iPad e Android**, com um **servidor no Umbrel** que guarda os perfis das TVs.

Versão atual: veja `VERSAO` (uma só para todas as partes; `bash versao.sh 1.0.1` sobe tudo).

## Como funciona

```
 iPhone / iPad / Android / Mac / Windows            Umbrel (Tailnet)
 ┌───────────────────────────────┐   HTTPS   ┌──────────────────────────────┐
 │ interface (server/public)     │◀────────▶│ servidor Calivix (Node 22+)  │
 │ + plugin nativo (TCP / rede)  │  pedidos  │ perfis, fila, MCP p/ Claude  │
 └───────────┬───────────────────┘           └──────────────┬───────────────┘
             │ ADB (porta 5555) na rede da TV                │ ADB quando alcança a TV
             ▼                                                ▼
                         TVs Android / Google TV
```

- **Um núcleo só** (`server/public/core/`): cliente ADB em JavaScript puro (RSA, sync, shell), as travas do
  `disable.sh` (núcleo do sistema, dono do Wi-Fi, entrada de TV, tela inicial, canais), registro do estado
  anterior para restaurar, instalação do launcher com volta automática se algo falhar, e o catálogo das 407
  listas testadas do CleanYourTV (`scripts/gerar-catalogo.mjs`).
- **Quem executa**: o servidor, se alcançar a TV (rede de casa ou IP da Tailnet); senão o pedido fica guardado
  e o primeiro aparelho seu que entrar no Wi-Fi daquela TV aplica (o app confere o número de série antes, para
  não mexer em outra TV com o mesmo IP).
- **Uma chave ADB para todos os aparelhos** (distribuída pelo servidor): cada TV pergunta "Permitir
  depuração?" uma vez só.
- **Claude**: o servidor expõe MCP em `/mcp` (token em Ajustes › Claude). Pela tela *Claude* do app você dita
  o pedido; ele vira um item da lista que o Claude lê e executa com as ferramentas `calivix_*`.

## Partes

| Pasta | O quê |
|---|---|
| `server/` | servidor (sem dependências), interface web em `public/`, `Dockerfile` |
| `clients/desktop/` | app Electron (macOS universal, Windows x64); `npm run dist:mac` / `dist:win` |
| `clients/mobile/` | app Capacitor (iOS/iPadOS/Android) com o plugin `CalivixRede` (`native/`) |
| `umbrel/adalberto-calivix/` | app da loja do Umbrel (porta 8797) |
| `marca/` | identidade visual (`python3 marca/gerar.py` gera tudo, inclusive ícones dos apps e o fundo do .dmg) |
| `INSTALADORES/` | Mac `.dmg`, Windows `.exe`, Android `.apk` |

## Desenvolvimento

```bash
cd server && DATA_DIR=/tmp/calivix-dados node src/index.js      # http://127.0.0.1:8795
cd clients/desktop && npm install && npm start                   # app de computador
cd clients/mobile && npm install && npm run sync                 # projetos iOS/Android
bash clients/mobile/gerar-apk.sh                                 # INSTALADORES/Android/Calivix-<v>.apk
bash clients/mobile/instalar-ios.sh                              # instala nos iPhones/iPads conectados
```

Portas: servidor `8795` (só dentro do contêiner) · loja do Umbrel `8797` · HTTPS na Tailnet `8471`
(`tailscale serve --bg --https=8471 http://127.0.0.1:8797`). O launcher vem de `repo/launcher`
(`./gradlew assembleRelease`) e é copiado para `server/public/launcher/calivix-launcher.apk`.

## Créditos

O catálogo de listas (`server/public/core/catalogo.json`), as travas de segurança e o launcher
(`server/public/launcher/calivix-launcher.apk`) vêm do [CleanYourTV](https://github.com/Gathin23/cleanyourtv),
de Gathin, sob licença MIT (`licencas/CleanYourTV-LICENSE.txt`).
