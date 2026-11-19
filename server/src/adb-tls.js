// Depuração por Wi-Fi do Android 11+ (a "Depuração sem fio" / "Depuração por Wi-Fi" das Opções do
// desenvolvedor), só no Node. Três partes:
//   1. credenciais(jwk): certificado X.509 autoassinado da chave ADB do Calivix, para o TLS 1.3 que a TV exige
//      depois de responder STLS (ver core/adb.js);
//   2. parear(): o pareamento com o código de 6 dígitos (SPAKE2 sobre Ed25519, como o BoringSSL, + AES-128-GCM),
//      que grava a chave pública do Calivix na lista de chaves confiáveis da TV;
//   3. sondarAdb() e acharPortaTls(): a porta da depuração por Wi-Fi é aleatória e muda quando ela é religada.
// Referências: packages/modules/adb (pairing_auth, pairing_connection, tls) e boringssl crypto/curve25519/spake25519.
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { ChaveAdb } from '../public/core/adb.js';

// ---------- 1. certificado ----------

const der = (tag, ...partes) => {
  const corpo = Buffer.concat(partes.map((p) => Buffer.from(p)));
  const n = corpo.length;
  const tam = n < 128 ? Buffer.from([n]) : (() => { const b = []; for (let x = n; x > 0; x >>= 8) b.unshift(x & 0xff); return Buffer.from([0x80 | b.length, ...b]); })();
  return Buffer.concat([Buffer.from([tag]), tam, corpo]);
};
const seq = (...p) => der(0x30, ...p);
const oid = (s) => {
  const n = s.split('.').map(Number);
  const out = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) { const b = [v & 0x7f]; for (let x = v >> 7; x > 0; x >>= 7) b.unshift(0x80 | (x & 0x7f)); out.push(...b); }
  return der(0x06, out);
};
const utc = (d) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const nome = (cn) => seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(cn)))));

const cacheCred = new Map();
export function credenciais(jwk, cn = 'Calivix') {
  const k = jwk.n;
  if (cacheCred.has(k)) return cacheCred.get(k);
  const priv = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const spki = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
  const alg = seq(oid('1.2.840.113549.1.1.11'), der(0x05)); // sha256WithRSAEncryption
  const tbs = seq(der(0xa0, der(0x02, [2])), der(0x02, [1]), alg, nome(cn),
    seq(utc(new Date(Date.now() - 86400e3)), utc(new Date('2049-12-31T00:00:00Z'))), nome(cn), spki);
  const assinatura = crypto.sign('sha256', tbs, priv);
  const cert = seq(tbs, alg, der(0x03, Buffer.concat([Buffer.from([0]), assinatura])));
  const pem = (rot, b) => `-----BEGIN ${rot}-----\n${b.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${rot}-----\n`;
  const r = { cert: pem('CERTIFICATE', cert), key: priv.export({ type: 'pkcs8', format: 'pem' }) };
  cacheCred.set(k, r);
  return r;
}

// ---------- 2. SPAKE2 (Ed25519) ----------

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const md = (a) => ((a % P) + P) % P;
const potP = (b, e) => { let r = 1n; b = md(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
const inv = (a) => potP(a, P - 2n);
const D = md(-121665n * inv(121666n));
const D2 = md(2n * D);
const RAIZ_M1 = potP(2n, (P - 1n) / 4n);
const leLE = (b) => { let x = 0n; for (let i = b.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[i]); return x; };
const paraLE = (x, n = 32) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) { b[i] = Number(x & 0xffn); x >>= 8n; } return b; };

// pontos em coordenadas estendidas [X, Y, Z, T]; a fórmula de soma é completa (serve para dobrar)
const ponto = (x, y) => [x, y, 1n, md(x * y)];
const NEUTRO = [0n, 1n, 1n, 0n];
function somar(p, q) {
  const a = md((p[1] - p[0]) * (q[1] - q[0])), b = md((p[1] + p[0]) * (q[1] + q[0]));
  const c = md(p[3] * D2 * q[3]), d = md(2n * p[2] * q[2]);
  const e = b - a, f = d - c, g = d + c, h = b + a;
  return [md(e * f), md(g * h), md(f * g), md(e * h)];
}
const negar = (p) => [md(-p[0]), p[1], p[2], md(-p[3])];
function multiplicar(k, p) { let r = NEUTRO; for (let i = BigInt(k.toString(2).length) - 1n; i >= 0n; i--) { r = somar(r, r); if ((k >> i) & 1n) r = somar(r, p); } return r; }
function codificar(p) {
  const zi = inv(p[2]); const x = md(p[0] * zi), y = md(p[1] * zi);
  return paraLE(y | ((x & 1n) << 255n));
}
function decodificar(b) {
  const y = leLE(b) & ((1n << 255n) - 1n), sinal = BigInt(b[31] >> 7);
  const u = md(y * y - 1n), v = md(D * y * y + 1n);
  const x2 = md(u * inv(v));
  let x = potP(x2, (P + 3n) / 8n);
  if (md(x * x - x2) !== 0n) { x = md(x * RAIZ_M1); if (md(x * x - x2) !== 0n) return null; }
  if (x === 0n && sinal) return null;
  if ((x & 1n) !== sinal) x = md(-x);
  return ponto(x, y);
}
const BASE = ponto(15112221349535400772501151409588531511454012693041857206046113283949847762202n,
  46316835694926478169428394003475163141307993866256225615783033603165251855960n);
// M e N do BoringSSL: primeira entrada de kSpakeMSmallPrecomp / kSpakeNSmallPrecomp (x e y em little-endian)
const pontoHex = (h) => ponto(leLE(Buffer.from(h.slice(0, 64), 'hex')), leLE(Buffer.from(h.slice(64), 'hex')));
export const SPAKE_M = pontoHex('c8a663c597f1ee40ab6242ee256f326c752ca7d3bd323b1e119cbd04a9786f455ada7e4bf6ddd9adb6626d32131c6b5c51a1e347a3478f53cfcf441b88eed12e');
export const SPAKE_N = pontoHex('201bc5b343177110441e73b3ae3fbf9ff544c8138fd101c28a1a6dea4d005d6e10e3df0ae37d8e7a99b5fe74b44672103dbddcbd06af680d71329a11693bc778');
export const _ed = { multiplicar, codificar, decodificar, somar, BASE };

const comPrefixo = (h, dados) => { const t = Buffer.alloc(8); t.writeBigUInt64LE(BigInt(dados.length)); h.update(t); h.update(dados); };

// Um lado do SPAKE2 do BoringSSL (alice = cliente do pareamento, bob = TV).
export class Spake2 {
  constructor(alice, meuNome, nomeDele) { this.alice = alice; this.meuNome = Buffer.from(meuNome); this.nomeDele = Buffer.from(nomeDele); }
  gerar(senha, aleatorio = crypto.randomBytes(64)) {
    this.priv = (leLE(aleatorio) % L) * 8n; // múltiplo do cofator
    this.hashSenha = crypto.createHash('sha512').update(senha).digest();
    let w = leLE(this.hashSenha) % L;
    // o "password scalar hack" do BoringSSL: soma múltiplos da ordem até w ser múltiplo de 8
    if (w & 1n) w += L; if (w & 2n) w += 2n * L; if (w & 4n) w += 4n * L;
    this.w = w;
    const msg = codificar(somar(multiplicar(this.priv, BASE), multiplicar(w, this.alice ? SPAKE_M : SPAKE_N)));
    this.minhaMsg = msg;
    return msg;
  }
  processar(msgDele) {
    if (msgDele.length !== 32) throw new Error('mensagem SPAKE2 com tamanho errado');
    const q = decodificar(msgDele);
    if (!q) throw new Error('mensagem SPAKE2 fora da curva');
    const qExt = somar(q, negar(multiplicar(this.w, this.alice ? SPAKE_N : SPAKE_M)));
    const dh = codificar(multiplicar(this.priv, qExt));
    const h = crypto.createHash('sha512');
    const [na, nb, ma, mb] = this.alice ? [this.meuNome, this.nomeDele, this.minhaMsg, msgDele] : [this.nomeDele, this.meuNome, msgDele, this.minhaMsg];
    for (const x of [na, nb, ma, mb, dh, this.hashSenha]) comPrefixo(h, x);
    return h.digest(); // 64 bytes
  }
}

// AES-128-GCM do pairing_auth: chave por HKDF-SHA256, nonce = contador de 64 bits (little-endian) + 4 zeros.
export class Cifra {
  constructor(material) { this.chave = Buffer.from(crypto.hkdfSync('sha256', material, Buffer.alloc(0), Buffer.from('adb pairing_auth aes-128-gcm key'), 16)); this.enc = 0n; this.dec = 0n; }
  _nonce(n) { const b = Buffer.alloc(12); b.writeBigUInt64LE(n); return b; }
  cifrar(dados) {
    const c = crypto.createCipheriv('aes-128-gcm', this.chave, this._nonce(this.enc++));
    return Buffer.concat([c.update(dados), c.final(), c.getAuthTag()]);
  }
  decifrar(dados) {
    const c = crypto.createDecipheriv('aes-128-gcm', this.chave, this._nonce(this.dec++));
    c.setAuthTag(dados.subarray(dados.length - 16));
    return Buffer.concat([c.update(dados.subarray(0, dados.length - 16)), c.final()]);
  }
}

// Leitor de bytes sobre um socket (TLS ou não).
function leitor(sock) {
  let buf = Buffer.alloc(0), espera = null, fim = null;
  const acordar = () => { if (espera) { const w = espera; espera = null; w(); } };
  sock.on('data', (b) => { buf = Buffer.concat([buf, b]); acordar(); });
  sock.on('close', () => { fim ||= new Error('a TV fechou a conexão'); acordar(); });
  sock.on('error', (e) => { fim = e; acordar(); });
  return async (n) => {
    while (buf.length < n) { if (fim) throw fim; await new Promise((r) => { espera = r; }); }
    const out = buf.subarray(0, n); buf = buf.subarray(n); return out;
  };
}
const comTempo = (p, ms, msg) => { let t; return Promise.race([p, new Promise((_, r) => { t = setTimeout(() => r(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); };

const NOME_CLIENTE = 'adb pair client\0', NOME_SERVIDOR = 'adb pair server\0';
const TAM_PEER_INFO = 8192;

// Pareia a chave do Calivix com a TV. host/porta: o endereço que a TV mostra em "Parear com código"
// (a porta é diferente da de conexão e só fica aberta com essa janela na tela).
export async function parear({ host, porta, codigo, jwk, nomeChave = 'calivix@servidor', tempo = 15000 }) {
  codigo = String(codigo || '').replace(/\D/g, '');
  if (codigo.length !== 6) throw new Error('O código de pareamento tem 6 dígitos');
  const { cert, key } = credenciais(jwk);
  const sock = tls.connect({ host, port: Number(porta), cert, key, rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' });
  try {
    await comTempo(new Promise((ok, falha) => { sock.once('secureConnect', ok); sock.once('error', falha); }), tempo,
      `A TV não respondeu em ${host}:${porta}. Confira se a janela "Parear com código" ainda está aberta na tela.`);
    const ler = leitor(sock);
    const escrever = (tipo, dados) => { const h = Buffer.alloc(6); h[0] = 1; h[1] = tipo; h.writeUInt32BE(dados.length, 2); sock.write(Buffer.concat([h, dados])); };
    const lerPacote = async (tipo) => {
      const h = await comTempo(ler(6), tempo, 'A TV parou de responder durante o pareamento');
      if (h[1] !== tipo) throw new Error('resposta inesperada da TV no pareamento');
      const n = h.readUInt32BE(2);
      if (!n || n > TAM_PEER_INFO * 2) throw new Error('pacote de pareamento com tamanho inválido');
      return comTempo(ler(n), tempo, 'A TV parou de responder durante o pareamento');
    };
    // a senha é o código + 64 bytes exportados do TLS (amarra o PAKE a esta conexão)
    const senha = Buffer.concat([Buffer.from(codigo), sock.exportKeyingMaterial(64, 'adb-label\0')]);
    const spake = new Spake2(true, NOME_CLIENTE, NOME_SERVIDOR);
    escrever(0, spake.gerar(senha));
    const cifra = new Cifra(spake.processar(await lerPacote(0)));
    const info = Buffer.alloc(TAM_PEER_INFO); // tipo 0 = chave RSA pública no formato do adb_keys
    info.write(new ChaveAdb(jwk, nomeChave).publicaAndroid(), 1, 'latin1');
    escrever(1, cifra.cifrar(info));
    let resposta;
    try { resposta = cifra.decifrar(await lerPacote(1)); }
    catch { throw new Error('Código de pareamento incorreto (ou a janela de pareamento fechou). Gere um código novo na TV e tente de novo.'); }
    if (resposta.length !== TAM_PEER_INFO) throw new Error('resposta de pareamento inválida');
    // tipo 1 = GUID do aparelho ("adb-<serial>-xxxx"), útil para reconhecer a TV
    const guid = resposta[0] === 1 ? resposta.subarray(1).toString('latin1').replace(/\0[\s\S]*$/, '') : '';
    return { ok: true, guid };
  } finally { sock.destroy(); }
}

// ---------- 3. porta ----------

// Fala CNXN numa porta e diz o que respondeu: 'tls' (depuração por Wi-Fi), 'adb' (ADB clássico) ou null.
export function sondarAdb(host, porta, ms = 2500) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port: porta });
    let buf = Buffer.alloc(0);
    const fim = (r) => { clearTimeout(t); s.destroy(); resolve(r); };
    const t = setTimeout(() => fim(null), ms);
    s.on('error', () => fim(null));
    s.on('connect', () => {
      const dados = Buffer.from('host::\0');
      const h = Buffer.alloc(24);
      const cmd = 0x4e584e43;
      h.writeUInt32LE(cmd, 0); h.writeUInt32LE(0x01000001, 4); h.writeUInt32LE(256 * 1024, 8); h.writeUInt32LE(dados.length, 12);
      h.writeUInt32LE(dados.reduce((a, b) => a + b, 0), 16); h.writeUInt32LE((cmd ^ 0xffffffff) >>> 0, 20);
      s.write(Buffer.concat([h, dados]));
    });
    s.on('data', (b) => {
      buf = Buffer.concat([buf, b]);
      if (buf.length < 4) return;
      const c = buf.toString('latin1', 0, 4);
      fim(c === 'STLS' ? 'tls' : c === 'CNXN' || c === 'AUTH' ? 'adb' : null);
    });
  });
}

// Procura a porta da depuração por Wi-Fi: primeiro as conhecidas, depois a faixa de portas efêmeras do Linux.
// Leva ~1 min pela Tailnet quando a porta mudou.
export async function acharPortaTls(host, conhecidas = [], { de = 30000, ate = 65535, paralelo = 400, ms = 1200 } = {}) {
  for (const p of conhecidas.filter(Boolean)) if (await sondarAdb(host, p) === 'tls') return p;
  const abertas = [];
  let prox = de;
  const abre = (p) => new Promise((r) => {
    const s = net.createConnection({ host, port: p });
    const t = setTimeout(() => { s.destroy(); r(false); }, ms);
    s.on('connect', () => { clearTimeout(t); s.destroy(); r(true); });
    s.on('error', () => { clearTimeout(t); r(false); });
  });
  await Promise.all(Array.from({ length: paralelo }, async () => { while (prox <= ate) { const p = prox++; if (await abre(p)) abertas.push(p); } }));
  for (const p of abertas.sort((a, b) => a - b)) if (await sondarAdb(host, p) === 'tls') return p;
  return null;
}
