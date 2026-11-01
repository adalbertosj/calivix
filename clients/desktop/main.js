// Calivix para macOS e Windows. A interface é a mesma do servidor (www/, copiada de server/public);
// este processo dá a ela o que o navegador não tem: sockets TCP para falar ADB com as TVs,
// varredura da rede local e leitura das informações de rede do computador.
const { app, BrowserWindow, ipcMain, protocol, net: enet, shell, Menu } = require('electron');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();
let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1240, height: 820, minWidth: 380, minHeight: 560, title: 'Calivix', backgroundColor: '#070a1a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  janela.loadURL('app://calivix/index.html');
  // links externos abrem no navegador
  janela.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  janela.on('closed', () => { janela = null; for (const s of sockets.values()) s.destroy(); sockets.clear(); });
}

// ---------- sockets TCP (ADB) ----------
const sockets = new Map();
let proximo = 1;
ipcMain.handle('tcp:conectar', (ev, host, porta, ms = 8000) => new Promise((resolve, reject) => {
  const s = net.createConnection({ host, port: porta });
  s.setNoDelay(true);
  const id = proximo++;
  const t = setTimeout(() => { s.destroy(); reject(new Error(`Sem resposta de ${host}:${porta}`)); }, ms);
  s.on('connect', () => { clearTimeout(t); sockets.set(id, s); resolve({ id }); });
  s.on('data', (b) => { if (!ev.sender.isDestroyed()) ev.sender.send('tcp:dados', id, b.toString('base64')); });
  s.on('error', (e) => {
    clearTimeout(t);
    const msg = e.code === 'ECONNREFUSED' ? `${host} recusou a porta ${porta}: a depuração pela rede está desligada na TV`
      : (e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH') ? `${host} não está alcançável desta rede` : e.message;
    if (!sockets.has(id)) reject(new Error(msg));
    else if (!ev.sender.isDestroyed()) ev.sender.send('tcp:fechado', id, msg);
  });
  s.on('close', () => { if (sockets.delete(id) && !ev.sender.isDestroyed()) ev.sender.send('tcp:fechado', id, null); });
}));
ipcMain.handle('tcp:escrever', (ev, id, b64) => new Promise((resolve, reject) => {
  const s = sockets.get(id);
  if (!s) return reject(new Error('conexão fechada'));
  s.write(Buffer.from(b64, 'base64'), (e) => (e ? reject(e) : resolve()));
}));
ipcMain.handle('tcp:fechar', (ev, id) => { const s = sockets.get(id); if (s) { sockets.delete(id); s.destroy(); } });

// ---------- descoberta ----------
function porta(host, p, ms) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port: p });
    const fim = (ok) => { clearTimeout(t); s.destroy(); resolve(ok); };
    const t = setTimeout(() => fim(false), ms);
    s.on('connect', () => fim(true));
    s.on('error', () => fim(false));
  });
}
ipcMain.handle('sondar', async (ev, hosts, portas, ms = 600) =>
  Promise.all(hosts.map(async (host) => ({ host, portas: (await Promise.all(portas.map(async (p) => ((await porta(host, p, ms)) ? p : null)))).filter(Boolean) }))));

function infoRede() {
  // a interface de rede local de verdade: IPv4 privado, fora da Tailnet (100.64.0.0/10)
  for (const [nome, lista] of Object.entries(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const [a, b] = i.address.split('.').map(Number);
      if (a === 100 && b >= 64 && b < 128) continue;
      if (a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168)) return { ip: i.address, mascara: i.netmask, interface: nome };
    }
  }
  return { ip: null };
}
ipcMain.handle('rede:info', () => infoRede());

ipcMain.handle('http:get', (ev, url, ms = 3000) => new Promise((resolve, reject) => {
  if (!/^http:\/\/(10|172|192)\.[\d.]+:\d+\//.test(url)) return reject(new Error('Só endereços da rede local'));
  const r = http.get(url, { timeout: ms }, (res) => {
    let d = ''; res.setEncoding('utf8');
    res.on('data', (c) => { d += c; if (d.length > 2e6) r.destroy(); });
    res.on('end', () => resolve({ status: res.statusCode, texto: d }));
  });
  r.on('timeout', () => r.destroy(new Error('tempo esgotado')));
  r.on('error', reject);
}));
ipcMain.handle('abrir', (ev, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

// avisa a interface quando o computador troca de rede (para conferir as tarefas pendentes)
let redeAtual = JSON.stringify(infoRede());
setInterval(() => {
  const r = JSON.stringify(infoRede());
  if (r !== redeAtual) { redeAtual = r; janela?.webContents.send('rede:mudou'); }
}, 8000);

app.whenReady().then(() => {
  const www = path.join(__dirname, 'www');
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let arq = path.normalize(path.join(www, decodeURIComponent(u.pathname)));
    if (!arq.startsWith(www)) return new Response('proibido', { status: 403 });
    return enet.fetch(pathToFileURL(arq).toString());
  });
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu', label: 'Calivix' }, { role: 'editMenu', label: 'Editar' }, { role: 'viewMenu', label: 'Visualizar' }, { role: 'windowMenu', label: 'Janela' },
    ]));
  }
  criarJanela();
  app.on('activate', () => { if (!janela) criarJanela(); });
});
app.on('second-instance', () => { if (janela) { if (janela.isMinimized()) janela.restore(); janela.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
