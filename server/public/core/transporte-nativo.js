// Transporte TCP para a interface rodando dentro dos apps nativos. O app (Electron ou Capacitor)
// expõe window.CalivixNativo com: tcpConectar, tcpEscrever, tcpFechar, aoDados, aoFechado,
// sondar, infoRede, httpGet e plataforma.
const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const nativo = () => window.CalivixNativo || null;

let registrado = false;
const sockets = new Map();
function registrar(n) {
  if (registrado) return;
  registrado = true;
  n.aoDados((id, dados) => { const s = sockets.get(id); if (s) s.rec(deB64(dados)); });
  n.aoFechado((id, erro) => { const s = sockets.get(id); if (s) { sockets.delete(id); s.fim(new Error(erro || 'conexão encerrada pela TV')); } });
}

export const transporteNativo = {
  async conectar(host, porta, ms = 8000) {
    const n = nativo();
    if (!n) throw new Error('Este aparelho não fala com a TV diretamente (abra pelo app do Calivix)');
    registrar(n);
    const { id } = await n.tcpConectar(host, porta, ms);
    const pend = [];
    const s = { rec: (u) => pend.push(u), fim: () => {} };
    sockets.set(id, s);
    // fila de escrita: a ordem dos pacotes importa
    let fila = Promise.resolve();
    return {
      escrever: (u) => { const c = b64(u); fila = fila.then(() => n.tcpEscrever(id, c)).catch(() => {}); },
      aoReceber: (cb) => { s.rec = cb; while (pend.length) cb(pend.shift()); },
      aoFechar: (cb) => { s.fim = cb; },
      fechar: () => { sockets.delete(id); n.tcpFechar(id).catch(() => {}); },
    };
  },
};
