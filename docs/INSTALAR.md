# Instalar o Calivix 1.0.0

## 1. Servidor (Umbrel)

O app da loja fica em `umbrel/adalberto-calivix/`. Para publicar:

1. Criar o repositório `adalbertosj/calivix`, enviar o projeto e criar a tag `v1.0.0`
   (o GitHub Actions gera `ghcr.io/adalbertosj/calivix-server:1.0.0` e deixe o pacote público).
2. Copiar `umbrel/adalberto-calivix/` para o repositório `benilab-umbrel-store` e enviar.
3. No Umbrel: Loja › Benilab › **Calivix** › Instalar.
4. Levar a chave ADB que a TV da Sala já aprovou (assim ela não pergunta de novo):

   ```bash
   scp ~/Library/Developer/Calivix/chave-adb.json umbrel@100.67.135.90:/tmp/
   ssh umbrel@100.67.135.90 'docker cp /tmp/chave-adb.json adalberto-calivix_server_1:/data/ && docker restart adalberto-calivix_server_1 && rm /tmp/chave-adb.json'
   ```

   (Enquanto o arquivo estiver lá, é a chave dele que o servidor usa.)
5. Publicar na Tailnet:

   ```bash
   ssh umbrel@100.67.135.90 'docker exec tailscale_web_1 tailscale serve --bg --https=8471 http://127.0.0.1:8797'
   ```

   Endereço dos apps: `https://umbrel-home.tail16dbfe.ts.net:8471`

## 2. Apps

| Aparelho | Arquivo | Observação |
|---|---|---|
| Mac | `INSTALADORES/Mac/Calivix-1.0.0.dmg` | assinado e notarizado: abre sem aviso |
| Windows | `INSTALADORES/Windows/Calivix-Instalador-1.0.0.exe` | sem certificado: na tela azul do SmartScreen, *Mais informações › Executar assim mesmo* |
| Android, TVs e TV boxes | `INSTALADORES/Android/Calivix-1.0.0.apk` | permitir "instalar apps desconhecidos" |
| iPhone / iPad | `bash clients/mobile/instalar-ios.sh` (aparelhos ligados ao Mac) | TestFlight: `enviar-testflight.sh`, depois de criar o app `app.calivix.app` no App Store Connect |

Na primeira abertura: endereço do servidor → senha (a primeira vez cria a senha) → nome do aparelho.
No iPhone/iPad, aceite **Rede local** quando o sistema perguntar (sem ela o app não acha as TVs).

## 3. Claude

Ajustes › Claude mostra o comando pronto, no formato:

```bash
claude mcp add --transport http calivix https://umbrel-home.tail16dbfe.ts.net:8471/mcp --header "Authorization: Bearer <token>"
```

## 4. TV nova

Configurações › Sistema › Sobre › aperte OK em *Build* 7 vezes › Opções do desenvolvedor › ligue
**Depuração USB** (e **ADB pela rede**, se houver). No app: Descobrir › Adicionar. Na TV, marque
**Sempre permitir**.
