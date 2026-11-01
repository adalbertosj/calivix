// Cliente ADB em JavaScript puro, sem dependências. Roda no Node (servidor e Electron) e no WebView
// do celular: quem abre o socket TCP é o "transporte", passado de fora (ver core/transportes.js).
//
// Protocolo (system/core/adb/protocol.txt): mensagens com cabeçalho de 24 bytes
//   comando, arg0, arg1, tamanho, soma dos bytes, comando ^ 0xffffffff
// e autenticação por RSA: a TV manda um token de 20 bytes, nós assinamos com a chave privada
// (PKCS#1 v1.5 com o prefixo SHA-1, o token já é o "resumo"); se ela não conhece a chave,
// mandamos a pública no formato do Android e a TV mostra "Permitir depuração USB?".

const CMD = { SYNC: 0x434e5953, CNXN: 0x4e584e43, AUTH: 0x48545541, OPEN: 0x4e45504f, OKAY: 0x59414b4f, CLSE: 0x45534c43, WRTE: 0x45545257, STLS: 0x534c5453 };
const VERSAO = 0x01000001;
const MAXDATA = 256 * 1024;
const AUTH_TOKEN = 1, AUTH_ASSINATURA = 2, AUTH_CHAVE = 3;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- RSA com BigInt ----------

const b64url = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};
const bytesParaBig = (b) => { let x = 0n; for (const v of b) x = (x << 8n) | BigInt(v); return x; };
const bigParaBytes = (x, n) => { const out = new Uint8Array(n); for (let i = n - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; } return out; };
function potmod(base, exp, mod) {
  let r = 1n; base %= mod;
  while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; exp >>= 1n; base = (base * base) % mod; }
  return r;
}
const bytesParaB64 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

// Gera um par RSA-2048 com WebCrypto (Node 20+ e navegadores) e devolve em JWK.
export async function gerarChave() {
  const par = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' }, true, ['sign', 'verify']);
  return crypto.subtle.exportKey('jwk', par.privateKey);
}

const PREFIXO_SHA1 = Uint8Array.from([0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14]);

export class ChaveAdb {
  constructor(jwk, nome = 'calivix') {
    this.n = bytesParaBig(b64url(jwk.n));
    this.d = bytesParaBig(b64url(jwk.d));
    this.e = bytesParaBig(b64url(jwk.e));
    this.p = jwk.p ? bytesParaBig(b64url(jwk.p)) : null;
    this.q = jwk.q ? bytesParaBig(b64url(jwk.q)) : null;
    this.dp = jwk.dp ? bytesParaBig(b64url(jwk.dp)) : null;
    this.dq = jwk.dq ? bytesParaBig(b64url(jwk.dq)) : null;
    this.qi = jwk.qi ? bytesParaBig(b64url(jwk.qi)) : null;
    this.tam = b64url(jwk.n).length;
    this.nome = nome;
  }
  // Assinatura PKCS#1 v1.5 do token (já tratado como resumo SHA-1).
  assinar(token) {
    const t = this.tam;
    const em = new Uint8Array(t);
    em[0] = 0; em[1] = 1;
    const corpo = PREFIXO_SHA1.length + token.length;
    em.fill(0xff, 2, t - corpo - 1);
    em[t - corpo - 1] = 0;
    em.set(PREFIXO_SHA1, t - corpo);
    em.set(token, t - token.length);
    const m = bytesParaBig(em);
    let s;
    if (this.p && this.q) { // CRT: ~4x mais rápido, importa no celular
      const m1 = potmod(m, this.dp, this.p), m2 = potmod(m, this.dq, this.q);
      let h = (this.qi * ((m1 - m2) % this.p + this.p)) % this.p;
      s = m2 + h * this.q;
    } else s = potmod(m, this.d, this.n);
    return bigParaBytes(s, t);
  }
  // Chave pública no formato RSAPublicKey do Android (mincrypt), em base64, com o nome no fim.
  publicaAndroid() {
    const palavras = this.tam / 4;
    const buf = new Uint8Array(4 + 4 + this.tam * 2 + 4);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, palavras, true);
    const b32 = 1n << 32n;
    const n0 = this.n % b32;
    // n0inv = -1 / n[0] mod 2^32
    let inv = 1n;
    for (let i = 0; i < 32; i++) inv = (inv * (2n - n0 * inv)) % b32;
    dv.setUint32(4, Number((b32 - inv) % b32), true);
    let n = this.n;
    for (let i = 0; i < palavras; i++) { dv.setUint32(8 + i * 4, Number(n % b32), true); n /= b32; }
    let rr = potmod(2n, BigInt(this.tam * 8 * 2), this.n);
    for (let i = 0; i < palavras; i++) { dv.setUint32(8 + this.tam + i * 4, Number(rr % b32), true); rr /= b32; }
    dv.setUint32(8 + this.tam * 2, Number(this.e), true);
    return bytesParaB64(buf) + ' ' + this.nome;
  }
}

// ---------- fila de bytes ----------

class Fila {
  constructor() { this.partes = []; this.total = 0; this.espera = null; this.fim = null; }
  empurrar(b) { this.partes.push(b); this.total += b.length; this._acordar(); }
  encerrar(erro) { this.fim = erro || new Error('conexão encerrada pela TV'); this._acordar(); }
  _acordar() { if (this.espera) { const w = this.espera; this.espera = null; w(); } }
  async ler(n) {
    while (this.total < n) {
      if (this.fim) throw this.fim;
      await new Promise((r) => { this.espera = r; });
    }
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const p = this.partes[0];
      const k = Math.min(p.length, n - o);
      out.set(p.subarray(0, k), o);
      o += k;
      if (k === p.length) this.partes.shift(); else this.partes[0] = p.subarray(k);
    }
    this.total -= n;
    return out;
  }
}

const comTempo = (p, ms, msg) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
};

// ---------- conexão ----------

export class Adb {
  // transporte: { conectar(host, porta, ms) -> { escrever(Uint8Array), aoReceber(cb), aoFechar(cb), fechar() } }
  constructor(transporte, chave) { this.transporte = transporte; this.chave = chave; this.proximoId = 1; this.fluxos = new Map(); }

  async conectar(host, porta = 5555, { tempo = 8000, esperarPermissao = 60000, aoPedirPermissao } = {}) {
    this.host = host; this.porta = porta;
    this.sock = await this.transporte.conectar(host, porta, tempo);
    this.fila = new Fila();
    this.sock.aoReceber((b) => this.fila.empurrar(b));
    this.sock.aoFechar((e) => { this.fila.encerrar(e); for (const f of this.fluxos.values()) f.fila.encerrar(e); });
    this._enviar(CMD.CNXN, VERSAO, MAXDATA, enc.encode('host::features=shell_v2,cmd,stat_v2\0'));
    let assinou = false;
    for (;;) {
      const m = await comTempo(this._lerMensagem(), assinou === 'chave' ? esperarPermissao : tempo,
        assinou === 'chave' ? 'A TV não confirmou a permissão de depuração a tempo' : 'A TV não respondeu ao ADB');
      if (m.cmd === CMD.CNXN) {
        this.banner = dec.decode(m.dados);
        this.maxdata = Math.min(m.arg1 || MAXDATA, MAXDATA);
        break;
      }
      if (m.cmd === CMD.STLS) throw new Error('Esta TV só aceita depuração sem fio criptografada (Wireless debugging com pareamento). Ative a depuração pela rede na porta 5555.');
      if (m.cmd !== CMD.AUTH || m.arg0 !== AUTH_TOKEN) continue;
      if (!assinou) {
        this._enviar(CMD.AUTH, AUTH_ASSINATURA, 0, this.chave.assinar(m.dados));
        assinou = true;
      } else if (assinou === true) {
        // a TV não conhece esta chave: mandamos a pública e ela pergunta na tela
        aoPedirPermissao && aoPedirPermissao();
        this._enviar(CMD.AUTH, AUTH_CHAVE, 0, enc.encode(this.chave.publicaAndroid() + '\0'));
        assinou = 'chave';
      }
    }
    this._bombear();
    return this.banner;
  }

  _enviar(cmd, a0, a1, dados = new Uint8Array(0)) {
    const h = new Uint8Array(24 + dados.length);
    const dv = new DataView(h.buffer);
    let soma = 0; for (const b of dados) soma += b;
    dv.setUint32(0, cmd, true); dv.setUint32(4, a0, true); dv.setUint32(8, a1, true);
    dv.setUint32(12, dados.length, true); dv.setUint32(16, soma >>> 0, true); dv.setUint32(20, (cmd ^ 0xffffffff) >>> 0, true);
    h.set(dados, 24);
    this.sock.escrever(h);
  }

  async _lerMensagem() {
    const h = await this.fila.ler(24);
    const dv = new DataView(h.buffer, h.byteOffset, 24);
    const m = { cmd: dv.getUint32(0, true), arg0: dv.getUint32(4, true), arg1: dv.getUint32(8, true) };
    const tam = dv.getUint32(12, true);
    m.dados = tam ? await this.fila.ler(tam) : new Uint8Array(0);
    return m;
  }

  // Distribui as mensagens para os fluxos abertos.
  async _bombear() {
    try {
      for (;;) {
        const m = await this._lerMensagem();
        const f = this.fluxos.get(m.arg1);
        if (!f) { if (m.cmd === CMD.WRTE) this._enviar(CMD.CLSE, 0, m.arg0); continue; }
        if (m.cmd === CMD.OKAY) { f.remoto = m.arg0; f.liberado(); }
        else if (m.cmd === CMD.WRTE) { this._enviar(CMD.OKAY, f.local, m.arg0); f.fila.empurrar(m.dados); }
        else if (m.cmd === CMD.CLSE) { this.fluxos.delete(f.local); f.fila.encerrar(FIM); f.liberado(); }
      }
    } catch (e) { for (const f of this.fluxos.values()) { f.fila.encerrar(e); f.liberado(); } }
  }

  async abrir(servico) {
    const local = this.proximoId++;
    const f = { local, remoto: 0, fila: new Fila(), liberado: null };
    let pronto = new Promise((r) => { f.liberado = r; });
    f.esperarOkay = () => pronto;
    f.rearmar = () => { pronto = new Promise((r) => { f.liberado = r; }); };
    this.fluxos.set(local, f);
    this._enviar(CMD.OPEN, local, 0, enc.encode(servico + '\0'));
    await comTempo(pronto, 15000, 'A TV não abriu o serviço ' + servico.split(':')[0]);
    if (!f.remoto) throw new Error('A TV recusou o serviço ' + servico.split(':')[0]);
    f.rearmar();
    f.escrever = async (dados) => {
      for (let o = 0; o < dados.length; o += this.maxdata) {
        this._enviar(CMD.WRTE, local, f.remoto, dados.subarray(o, o + this.maxdata));
        await comTempo(f.esperarOkay(), 30000, 'A TV parou de receber dados');
        f.rearmar();
      }
    };
    f.fechar = () => { if (this.fluxos.has(local)) { this._enviar(CMD.CLSE, local, f.remoto); this.fluxos.delete(local); } };
    return f;
  }

  async _lerTudo(f, ms) {
    const partes = [];
    let total = 0;
    const ler = async () => {
      for (;;) {
        try {
          const b = await f.fila.ler(1);
          partes.push(b);
          if (f.fila.total) { const r = await f.fila.ler(f.fila.total); partes.push(r); total += r.length; }
          total += 1;
        } catch (e) { if (e === FIM) break; throw e; }
      }
    };
    await comTempo(ler(), ms, 'A TV demorou demais para responder');
    const out = new Uint8Array(total);
    let o = 0; for (const p of partes) { out.set(p, o); o += p.length; }
    return out;
  }

  // Executa um comando no shell da TV e devolve a saída como texto.
  async shell(cmd, ms = 60000) {
    const f = await this.abrir('shell:' + cmd);
    return dec.decode(await this._lerTudo(f, ms));
  }

  // Saída binária, sem o terminal mexer nos bytes (ex.: screencap -p).
  async exec(cmd, ms = 60000) {
    const f = await this.abrir('exec:' + cmd);
    return this._lerTudo(f, ms);
  }

  // Envia um arquivo pelo protocolo sync (SEND/DATA/DONE).
  async enviarArquivo(dados, caminho, modo = 0o644, aoProgredir) {
    const f = await this.abrir('sync:');
    const pedido = (id, carga) => {
      const b = new Uint8Array(8 + carga.length);
      const dv = new DataView(b.buffer);
      b.set(enc.encode(id), 0); dv.setUint32(4, carga.length, true); b.set(carga, 8);
      return b;
    };
    const nome = enc.encode(`${caminho},${modo}`);
    await f.escrever(pedido('SEND', nome));
    const BLOCO = 64 * 1024;
    for (let o = 0; o < dados.length; o += BLOCO) {
      await f.escrever(pedido('DATA', dados.subarray(o, o + BLOCO)));
      aoProgredir && aoProgredir(Math.min(1, (o + BLOCO) / dados.length));
    }
    const fim = new Uint8Array(8);
    fim.set(enc.encode('DONE'), 0);
    new DataView(fim.buffer).setUint32(4, Math.floor(Date.now() / 1000), true);
    await f.escrever(fim);
    const r = await comTempo(f.fila.ler(8), 60000, 'A TV não confirmou o envio do arquivo');
    const id = dec.decode(r.subarray(0, 4));
    if (id !== 'OKAY') {
      const tam = new DataView(r.buffer, r.byteOffset).getUint32(4, true);
      const msg = tam ? dec.decode(await f.fila.ler(tam)) : '';
      f.fechar();
      throw new Error('A TV recusou o arquivo: ' + (msg || id));
    }
    f.fechar();
  }

  fechar() { try { this.sock && this.sock.fechar(); } catch { /* já fechado */ } }
}

const FIM = new Error('fim do fluxo');
