# Mudanças locais no launcher do CleanYourTV

O launcher (`repo/launcher`, upstream Gathin23/cleanyourtv) é compilado aqui e copiado para
`server/public/launcher/calivix-launcher.apk`. Estas mudanças são só do Calivix, não vão para o upstream
(o AGENTS.md de lá não aceita vídeo no launcher).

- `papel-animado.patch` (launcher 3.3-calivix.2, versionCode 14): um `.mp4` na coleção `wallpapers/` vira papel
  animado — toca em laço, sem som, num TextureView atrás da tela inicial, a partir do meio do laço; o quadro desse
  ponto aparece na hora (e no protetor de tela do relógio). Pausa quando a tela inicial sai e solta o decodificador
  quando o Android pede memória. Só existe a camada de vídeo quando a coleção tem vídeo.
  Atenção: o launcher só lê a coleção com `wallpaper_rotation_minutes` > 0.

Aplicar sobre o commit em `BASE`:

```bash
cd repo && git apply ../launcher-patches/papel-animado.patch
cd launcher && ./gradlew --no-daemon clean testReleaseUnitTest lintRelease assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../../server/public/launcher/calivix-launcher.apk
```
