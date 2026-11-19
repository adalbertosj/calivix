// Transporte TCP do Node (servidor e processo principal do Electron).
import net from 'node:net';
import tls from 'node:tls';

export const transporteNode = {
  conectar(host, porta, ms = 8000) {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host, port: porta });
      s.setNoDelay(true);
      const t = setTimeout(() => { s.destroy(); reject(new Error(`Sem resposta de ${host}:${porta}`)); }, ms);
      let aoRec = () => {}, aoFim = () => {};
      const pend = [];
      const receber = (b) => { const u = new Uint8Array(b.buffer, b.byteOffset, b.length); if (aoRec.real) aoRec(u); else pend.push(u); };
      s.on('data', receber);
      let fluxo = s; // depois do STLS, a conversa passa para o socket TLS por cima deste
      s.on('close', () => aoFim(new Error('conexão encerrada pela TV')));
      s.on('error', (e) => { clearTimeout(t); reject(traduzir(e, host, porta)); aoFim(traduzir(e, host, porta)); });
      s.on('connect', () => {
        clearTimeout(t);
        resolve({
          escrever: (u) => fluxo.write(u),
          // Depuração por Wi-Fi do Android 11+: TLS 1.3 com certificado do cliente; o da TV não é conferido
          // (é autoassinado), quem garante a identidade é o pareamento e o número de série.
          iniciarTls: ({ cert, key }) => new Promise((ok, falha) => {
            s.removeListener('data', receber);
            const t = tls.connect({ socket: s, cert, key, rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' });
            t.once('secureConnect', () => { fluxo = t; t.on('data', receber); t.on('error', (e) => aoFim(e)); ok(); });
            t.once('error', falha);
          }),
          aoReceber: (cb) => { aoRec = cb; aoRec.real = true; while (pend.length) cb(pend.shift()); },
          aoFechar: (cb) => { aoFim = cb; },
          fechar: () => { fluxo.destroy(); s.destroy(); },
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
