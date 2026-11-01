// Ponte entre a interface (www) e o processo principal: o mesmo contrato que o plugin nativo do
// iPhone/Android oferece (window.CalivixNativo), para a interface ser uma só.
const { contextBridge, ipcRenderer } = require('electron');

const ouvintesDados = [], ouvintesFim = [], ouvintesRede = [];
ipcRenderer.on('tcp:dados', (_e, id, b64) => ouvintesDados.forEach((cb) => cb(id, b64)));
ipcRenderer.on('tcp:fechado', (_e, id, erro) => ouvintesFim.forEach((cb) => cb(id, erro)));
ipcRenderer.on('rede:mudou', () => ouvintesRede.forEach((cb) => cb()));

contextBridge.exposeInMainWorld('CalivixNativo', {
  plataforma: process.platform === 'win32' ? 'windows' : 'mac',
  semVozWeb: true, // o reconhecimento de voz do Chromium não funciona dentro do Electron
  tcpConectar: (host, porta, ms) => ipcRenderer.invoke('tcp:conectar', host, porta, ms),
  tcpEscrever: (id, b64) => ipcRenderer.invoke('tcp:escrever', id, b64),
  tcpFechar: (id) => ipcRenderer.invoke('tcp:fechar', id),
  aoDados: (cb) => ouvintesDados.push(cb),
  aoFechado: (cb) => ouvintesFim.push(cb),
  aoMudarRede: (cb) => ouvintesRede.push(cb),
  sondar: (hosts, portas, ms) => ipcRenderer.invoke('sondar', hosts, portas, ms),
  infoRede: () => ipcRenderer.invoke('rede:info'),
  httpGet: (url, ms) => ipcRenderer.invoke('http:get', url, ms),
  abrirExterno: (url) => ipcRenderer.invoke('abrir', url),
});
