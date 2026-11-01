// Ajusta os projetos nativos gerados pelo Capacitor (idempotente — pode rodar várias vezes):
// plugin de rede (ADB, descoberta), permissões de rede local, HTTP na Tailnet, ícones e versão única.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const VERSAO = fs.readFileSync(new URL('../../VERSAO', import.meta.url), 'utf8').trim();
const { appId, appName } = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));

const plist = 'ios/App/App/Info.plist';
if (fs.existsSync(plist)) {
  const set = (key, type, value) => {
    try { execFileSync('plutil', ['-remove', key, plist], { stdio: 'ignore' }); } catch {}
    execFileSync('plutil', ['-insert', key, `-${type}`, value, plist]);
  };
  set('CFBundleDisplayName', 'string', appName);
  set('NSLocalNetworkUsageDescription', 'string', 'Encontrar e ajustar as TVs da sua rede Wi-Fi.');
  // a descoberta também lê os aparelhos Cast (Google TV) e de depuração Android pela rede
  set('NSBonjourServices', 'json', '["_googlecast._tcp","_adb-tls-connect._tcp","_androidtvremote2._tcp"]');
  // o servidor na Tailnet pode ser http://100.x.x.x e as TVs respondem em http na rede local
  set('NSAppTransportSecurity', 'json', '{"NSAllowsArbitraryLoads":true,"NSAllowsLocalNetworking":true}');
  set('UIRequiredDeviceCapabilities', 'json', '["arm64"]');
  set('UIApplicationSupportsIndirectInputEvents', 'bool', 'true');
  set('ITSAppUsesNonExemptEncryption', 'bool', 'false');
  set('CFBundleShortVersionString', 'string', VERSAO);
  set('CFBundleVersion', 'string', VERSAO);

  // Plugin de rede: acrescentado ao AppDelegate.swift (não precisa mexer no projeto do Xcode)
  const app = 'ios/App/App/AppDelegate.swift';
  const marca = '// ==== Calivix: CalivixRede ====';
  let swift = fs.readFileSync(app, 'utf8');
  if (swift.includes(marca)) swift = swift.slice(0, swift.indexOf(marca)).trimEnd() + '\n';
  fs.writeFileSync(app, swift + '\n' + fs.readFileSync('native/ios/CalivixRede.swift', 'utf8'));
  // O Capacitor carrega (com os cabeçalhos que a interface consulta) as classes listadas em packageClassList
  const cfg = 'ios/App/App/capacitor.config.json';
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  c.packageClassList = [...new Set([...(c.packageClassList || []), 'CalivixRedePlugin'])];
  fs.writeFileSync(cfg, JSON.stringify(c, null, '\t') + '\n');
  // (versões de teste usavam um CalivixViewController próprio para registrar o plugin)
  const sb = 'ios/App/App/Base.lproj/Main.storyboard';
  fs.writeFileSync(sb, fs.readFileSync(sb, 'utf8').replace('customClass="CalivixViewController" customModule="App" customModuleProvider="target"', 'customClass="CAPBridgeViewController" customModule="Capacitor"'));

  // Ícone: imagem única de 1024 px (o Xcode gera os demais tamanhos)
  const ic = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
  if (fs.existsSync(ic) && fs.existsSync('assets/icon-only.svg')) {
    for (const f of fs.readdirSync(ic)) if (f.endsWith('.png')) fs.rmSync(`${ic}/${f}`);
    execFileSync('rsvg-convert', ['-w', '1024', '-h', '1024', '-b', '#1e1b4b', 'assets/icon-only.svg', '-o', `${ic}/AppIcon-1024.png`]);
    fs.writeFileSync(`${ic}/Contents.json`, JSON.stringify({ images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2));
  }
  console.log('iOS: Info.plist, plugin e ícone ajustados');
}

const manifest = 'android/app/src/main/AndroidManifest.xml';
if (fs.existsSync(manifest)) {
  let xml = fs.readFileSync(manifest, 'utf8');
  for (const p of ['INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE', 'CHANGE_WIFI_MULTICAST_STATE']) {
    const tag = `<uses-permission android:name="android.permission.${p}" />`;
    if (!xml.includes(tag)) xml = xml.replace('</manifest>', `    ${tag}\n</manifest>`);
  }
  if (!xml.includes('usesCleartextTraffic')) xml = xml.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
  // Também roda em TVs e TV boxes Android (ajustando outras TVs da casa)
  for (const f of ['android.hardware.touchscreen', 'android.software.leanback']) {
    const tag = `<uses-feature android:name="${f}" android:required="false" />`;
    if (!xml.includes(tag)) xml = xml.replace('</manifest>', `    ${tag}\n</manifest>`);
  }
  if (!xml.includes('LEANBACK_LAUNCHER')) xml = xml.replace('<category android:name="android.intent.category.LAUNCHER" />', '<category android:name="android.intent.category.LAUNCHER" />\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />');
  if (!xml.includes('android:banner')) xml = xml.replace('<application', '<application\n        android:banner="@drawable/banner_tv"');
  fs.writeFileSync(manifest, xml);

  const gradle = 'android/app/build.gradle';
  if (fs.existsSync(gradle)) {
    const [a1, b1, c1] = VERSAO.split('.').map(Number);
    let g = fs.readFileSync(gradle, 'utf8');
    g = g.replace(/versionName "[^"]*"/, `versionName "${VERSAO}"`).replace(/versionCode \d+/, `versionCode ${a1 * 10000 + b1 * 100 + c1}`);
    fs.writeFileSync(gradle, g);
  }

  // Plugin de rede, registrado antes do WebView carregar
  const pkg = `android/app/src/main/java/${appId.replace(/\./g, '/')}`;
  fs.copyFileSync('native/android/CalivixRedePlugin.java', `${pkg}/CalivixRedePlugin.java`);
  fs.writeFileSync(`${pkg}/MainActivity.java`, `package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CalivixRedePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

  // Ícone adaptável em alta resolução, das camadas vetoriais (assets/*.svg, geradas por marca/gerar.py)
  const res = 'android/app/src/main/res';
  const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  const svg = (n) => `assets/${n}.svg`;
  if (fs.existsSync(svg('icon-foreground'))) {
    const desenha = (src, px, out) => execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), src, '-o', out]);
    for (const [d, k] of Object.entries(DENS)) {
      const dir = `${res}/mipmap-${d}`;
      fs.mkdirSync(dir, { recursive: true });
      desenha(svg('icon-foreground'), Math.round(108 * k), `${dir}/ic_launcher_foreground.png`);
      desenha(svg('icon-background'), Math.round(108 * k), `${dir}/ic_launcher_background.png`);
      desenha(svg('icon-only'), Math.round(48 * k), `${dir}/ic_launcher.png`);
      desenha(svg('icon-only'), Math.round(48 * k), `${dir}/ic_launcher_round.png`);
    }
    const adaptavel = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n';
    fs.mkdirSync(`${res}/mipmap-anydpi-v26`, { recursive: true });
    fs.writeFileSync(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, adaptavel);
    fs.writeFileSync(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptavel);
  }
  fs.mkdirSync(`${res}/drawable`, { recursive: true });
  fs.copyFileSync('native/android/banner_tv.png', `${res}/drawable/banner_tv.png`);
  console.log('Android: manifesto, plugin e ícones ajustados');
}
