// Transporte TCP do Node (servidor e processo principal do Electron).
import net from 'node:net';

export const transporteNode = {
  conectar(host, porta, ms = 8000) {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host, port: porta });
      s.setNoDelay(true);
      const t = setTimeout(() => { s.destroy(); reject(new Error(`Sem resposta de ${host}:${porta}`)); }, ms);
      let aoRec = () => {}, aoFim = () => {};
      const pend = [];
      s.on('data', (b) => { const u = new Uint8Array(b.buffer, b.byteOffset, b.length); if (aoRec.real) aoRec(u); else pend.push(u); });
      s.on('close', () => aoFim(new Error('conexão encerrada pela TV')));
      s.on('error', (e) => { clearTimeout(t); reject(traduzir(e, host, porta)); aoFim(traduzir(e, host, porta)); });
      s.on('connect', () => {
        clearTimeout(t);
        resolve({
          escrever: (u) => s.write(u),
          aoReceber: (cb) => { aoRec = cb; aoRec.real = true; while (pend.length) cb(pend.shift()); },
          aoFechar: (cb) => { aoFim = cb; },
          fechar: () => s.destroy(),
        });
      });
    });
  },
};

function traduzir(e, host, porta) {
  if (e.code === 'ECONNREFUSED') return new Error(`${host} recusou a porta ${porta}: a depuração pela rede está desligada na TV`);
  if (e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH') return new Error(`${host} não está alcançável desta rede`);
  return e;
}

// Testa portas rapidamente (descoberta de aparelhos).
export function sondarPorta(host, porta, ms = 700) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port: porta });
    const fim = (ok) => { clearTimeout(t); s.destroy(); resolve(ok); };
    const t = setTimeout(() => fim(false), ms);
    s.on('connect', () => fim(true));
    s.on('error', () => fim(false));
  });
}
