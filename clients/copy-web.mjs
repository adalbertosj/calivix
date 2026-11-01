// Copia a interface web do servidor (server/public) para um app nativo.
//   node ../copy-web.mjs <destino> <plataforma>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../server/public');
const dest = path.resolve(process.argv[2] || 'www');
const platform = process.argv[3] || 'native';

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
fs.rmSync(path.join(dest, 'sw.js'), { force: true });
let shell = `window.CALIVIX_SHELL = { platform: ${JSON.stringify(platform)} };\n`;
// No iPhone/iPad/Android, o plugin nativo CalivixRede vira window.CalivixNativo (o mesmo contrato do app de computador).
// O runtime JS do Capacitor (registerPlugin) vem antes: a interface não passa por empacotador.
if (platform === 'mobile') shell += fs.readFileSync(path.resolve('node_modules/@capacitor/core/dist/capacitor.js'), 'utf8') + `\n(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.registerPlugin('CalivixRede');
  window.CalivixNativo = {
    plataforma: C.getPlatform(),
    semVozWeb: true, // o WebView não tem reconhecimento de voz: o microfone do teclado dita
    tcpConectar: function (host, porta, ms) { return P.tcpConectar({ host: host, porta: porta, ms: ms || 8000 }); },
    tcpEscrever: function (id, dados) { return P.tcpEscrever({ id: id, dados: dados }); },
    tcpFechar: function (id) { return P.tcpFechar({ id: id }); },
    aoDados: function (cb) { P.addListener('dados', function (e) { cb(e.id, e.dados); }); },
    aoFechado: function (cb) { P.addListener('fechado', function (e) { cb(e.id, e.erro || null); }); },
    aoMudarRede: function (cb) { P.addListener('rede', function () { cb(); }); },
    sondar: function (hosts, portas, ms) { return P.sondar({ hosts: hosts, portas: portas, ms: ms || 600 }).then(function (r) { return r.itens; }); },
    infoRede: function () { return P.infoRede(); },
    httpGet: function (url, ms) { return P.httpGet({ url: url, ms: ms || 3000 }); },
    abrirExterno: function (url) { return P.abrir({ url: url }); },
  };
})();
`;
fs.writeFileSync(path.join(dest, 'shell.js'), shell);
if (!fs.existsSync(path.join(dest, 'launcher/calivix-launcher.apk'))) {
  console.error('Aviso: server/public/launcher/calivix-launcher.apk não existe (rode scripts/launcher.sh)');
}
console.log(`Interface copiada para ${dest} (${platform})`);
