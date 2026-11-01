// Servidor do Calivix: guarda as TVs, perfis, tarefas pendentes e pedidos ao Claude, e executa
// tarefas nas TVs que ele mesmo alcança (rede de casa ou Tailnet). Node puro, sem dependências.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { abrirBanco } from './db.js';
import { transporteNode, sondarPorta } from './transporte-node.js';
import { gerarChave } from '../public/core/adb.js';
import { executarTarefa, ACOES } from '../public/core/executor.js';
import { tratarMcp } from './mcp.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.resolve(AQUI, '../public');
const VERSAO = JSON.parse(fs.readFileSync(path.resolve(AQUI, '../package.json'), 'utf8')).version;
const PORTA = Number(process.env.PORT || 8795);
const DADOS = process.env.DATA_DIR || path.resolve(AQUI, '../dados');
const APK_LAUNCHER = process.env.LAUNCHER_APK || path.resolve(PUBLICO, 'launcher/calivix-launcher.apk');

const banco = abrirBanco(DADOS);
const db = banco.dados;
// A chave ADB é uma só para todos os aparelhos do usuário: a TV pergunta "Permitir depuração?" uma vez.
// CHAVE_ADB_ARQUIVO traz uma chave já aprovada nas TVs (ex.: de uma instalação anterior): se o arquivo
// existe, ele manda, mesmo que o servidor já tenha gerado uma chave própria.
if (process.env.CHAVE_ADB_ARQUIVO && fs.existsSync(process.env.CHAVE_ADB_ARQUIVO)) {
  const k = JSON.parse(fs.readFileSync(process.env.CHAVE_ADB_ARQUIVO, 'utf8'));
  if (k?.n && JSON.stringify(k) !== JSON.stringify(db.chaveAdb)) { db.chaveAdb = k; banco.gravarJa(); console.log('Chave ADB importada de ' + process.env.CHAVE_ADB_ARQUIVO); }
}
if (!db.chaveAdb) { db.chaveAdb = await gerarChave(); banco.gravarJa(); }
if (!db.ajustes.tokenClaude) { db.ajustes.tokenClaude = crypto.randomBytes(24).toString('base64url'); banco.gravar(); }

const id = () => crypto.randomBytes(8).toString('hex');
const agora = () => new Date().toISOString();

// ---------- senha e sessões ----------
const hashSenha = (senha, sal) => crypto.pbkdf2Sync(senha, sal, 210000, 32, 'sha256').toString('hex');
const tentativas = new Map();

function sessaoDe(req) {
  const h = req.headers.authorization || '';
  const url = new URL(req.url, 'http://x');
  const tok = h.startsWith('Bearer ') ? h.slice(7) : (url.searchParams.get('token') || '');
  const s = tok && db.sessoes[tok];
  if (!s) return null;
  s.visto = agora();
  const ap = db.aparelhos[s.aparelho];
  if (ap) ap.visto = s.visto;
  return { token: tok, ...s };
}

// ---------- eventos em tempo real (SSE) ----------
const ouvintes = new Set();
function avisar(tipo, extra = {}) {
  const msg = `data: ${JSON.stringify({ tipo, ...extra })}\n\n`;
  for (const r of ouvintes) r.write(msg);
}
setInterval(() => { for (const r of ouvintes) r.write(': pulso\n\n'); }, 25000);

// ---------- estado público para os apps ----------
function estado(sessao) {
  const tvs = Object.values(db.tvs).map((t) => ({ ...t, registro: t.registro ? { criadoEm: t.registro.criadoEm, pacotes: Object.keys(t.registro.pacotes).length } : null,
    temCaptura: fs.existsSync(path.join(DADOS, 'capturas', t.id + '.png')) }));
  return {
    versao: VERSAO, aparelho: sessao.aparelho, aparelhos: db.aparelhos, tvs,
    tarefas: db.tarefas.slice(-300), pedidos: db.pedidos.slice(-200), descobertas: db.descobertas,
    ajustes: { redesDoServidor: db.ajustes.redesDoServidor }, acoes: ACOES,
  };
}

// ---------- tarefas ----------
function novaTarefa({ tvId, titulo, acoes, criadaPor, execucao = 'auto', status = 'pendente' }) {
  if (!db.tvs[tvId]) throw erro(404, 'TV não encontrada');
  if (!Array.isArray(acoes) || !acoes.length) throw erro(400, 'A tarefa precisa de pelo menos uma ação');
  for (const a of acoes) if (!ACOES[a.tipo]) throw erro(400, 'Ação desconhecida: ' + a.tipo);
  const t = { id: id(), tvId, titulo: String(titulo || acoes.map((a) => a.tipo).join(', ')).slice(0, 200), acoes, status, execucao,
    criadaPor, criadaEm: agora(), assumidaPor: status === 'executando' ? criadaPor : null, inicio: status === 'executando' ? agora() : null, fim: null, log: [], erro: null, resumo: null };
  db.tarefas.push(t);
  if (db.tarefas.length > 1000) db.tarefas.splice(0, db.tarefas.length - 1000);
  banco.gravar(); avisar('tarefas', { tvId });
  if (status === 'pendente') setTimeout(() => tentarNoServidor(t).catch(() => {}), 50);
  return t;
}

function resumir(r) {
  const p = [];
  if (r.desativar) p.push(`${r.desativar.desativados.length} desativados` + (r.desativar.pulados.length ? `, ${r.desativar.pulados.length} mantidos pelas travas` : ''));
  if (r.ativar) p.push(`${r.ativar.ativados.length} reativados`);
  if (r.restaurar) p.push('restaurada ao estado anterior');
  if (r.launcher) p.push('launcher limpo instalado');
  if (r.conferir) p.push(r.conferir.religados.length ? `${r.conferir.religados.length} religados pelo firmware` : 'nada religado');
  if (r.captura) p.push('captura de tela');
  return p.join(' · ') || 'concluída';
}

// Aplica o relato de um executor (servidor ou aparelho) ao perfil da TV.
function aplicarRelato(tvId, r, quem) {
  const t = db.tvs[tvId];
  if (!t || !r) return;
  if (r.sondagem) { t.sondagem = r.sondagem; t.serial ||= r.sondagem.serial; if (r.sondagem.rede) t.rede = r.sondagem.rede; }
  if (r.inventario) t.inventario = r.inventario;
  if (r.registro) t.registro = r.registro;
  if (r.captura) {
    const b = typeof r.captura === 'string' ? Buffer.from(r.captura, 'base64') : Buffer.from(r.captura);
    fs.writeFileSync(path.join(DADOS, 'capturas', tvId + '.png'), b);
    t.capturaEm = agora();
  }
  if (r.launcher) { t.perfil.launcher = { ...(t.perfil.launcher || {}), instalado: true }; }
  if (r.desativar) t.perfil.desativados = [...new Set([...(t.perfil.desativados || []), ...r.desativar.desativados])];
  if (r.ativar) t.perfil.desativados = (t.perfil.desativados || []).filter((p) => !r.ativar.ativados.includes(p));
  if (r.restaurar) { t.perfil.desativados = []; t.perfil.launcher = { ...(t.perfil.launcher || {}), instalado: false }; }
  t.visto = agora(); t.vistoPor = quem;
  banco.gravar(); avisar('tvs', { tvId });
}

let ocupado = new Set();
async function tentarNoServidor(tarefa) {
  if (tarefa.status !== 'pendente' || !['auto', 'servidor'].includes(tarefa.execucao)) return false;
  const t = db.tvs[tarefa.tvId];
  if (!t || ocupado.has(t.id)) return false;
  // TV com Tailscale (endereço 100.x) vem primeiro; senão, o endereço da rede local dela.
  let alvo = null;
  for (const ip of [t.tailnetIp, t.ip].filter(Boolean)) if (await sondarPorta(ip, t.porta || 5555, 1500)) { alvo = ip; break; }
  if (!alvo || tarefa.status !== 'pendente') return false;
  ocupado.add(t.id);
  tarefa.status = 'executando'; tarefa.assumidaPor = 'servidor'; tarefa.inicio = agora();
  avisar('tarefas', { tvId: t.id });
  const log = (l) => { tarefa.log.push({ em: agora(), l }); avisar('log', { tarefa: tarefa.id, l }); };
  try {
    const r = await executarTarefa({
      transporte: transporteNode, jwk: db.chaveAdb, aparelho: 'servidor', log, registro: t.registro || null,
      salvarRegistro: async (reg) => { t.registro = reg; banco.gravar(); },
      apkLauncher: async () => new Uint8Array(fs.readFileSync(APK_LAUNCHER)),
      arquivo: async (nome) => new Uint8Array(fs.readFileSync(path.join(DADOS, 'arquivos', path.basename(nome)))),
    }, { ...t, ip: alvo }, tarefa);
    aplicarRelato(t.id, r, 'servidor');
    tarefa.status = 'concluida'; tarefa.erro = null; tarefa.resumo = resumir(r);
    if (r.comandos) tarefa.saidas = r.comandos;
  } catch (e) {
    tarefa.status = /outra rede|não está alcançável|recusou a porta/.test(e.message) ? 'pendente' : 'falhou';
    tarefa.erro = e.message; log('✗ ' + e.message);
    if (tarefa.status === 'pendente') { tarefa.assumidaPor = null; tarefa.inicio = null; }
  } finally {
    ocupado.delete(t.id);
    tarefa.fim = tarefa.status === 'pendente' ? null : agora();
    banco.gravar(); avisar('tarefas', { tvId: t.id });
  }
  return tarefa.status === 'concluida';
}
// De minuto em minuto, o servidor tenta as pendentes das TVs que ele alcança.
setInterval(() => { for (const t of db.tarefas.filter((x) => x.status === 'pendente')) tentarNoServidor(t).catch(() => {}); }, 60000);
// Tarefa presa em "executando" por um aparelho que sumiu volta para a fila depois de 15 min.
setInterval(() => {
  const lim = Date.now() - 15 * 60000;
  for (const t of db.tarefas) if (t.status === 'executando' && t.assumidaPor !== 'servidor' && Date.parse(t.inicio) < lim) {
    t.status = 'pendente'; t.assumidaPor = null; t.log.push({ em: agora(), l: '↺ o aparelho não terminou; tarefa voltou para a fila' });
  }
}, 60000);

// ---------- HTTP ----------
const erro = (s, m) => Object.assign(new Error(m), { status: s });
const json = (res, s, o) => { res.writeHead(s, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
async function corpo(req, max = 40e6) {
  const partes = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw erro(413, 'Envio grande demais'); partes.push(c); }
  const b = Buffer.concat(partes);
  if (!b.length) return {};
  try { return JSON.parse(b); } catch { throw erro(400, 'JSON inválido'); }
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.apk': 'application/vnd.android.package-archive', '.woff2': 'font/woff2' };

function estatico(req, res, p) {
  let arq = path.normalize(path.join(PUBLICO, decodeURIComponent(p)));
  if (!arq.startsWith(PUBLICO)) return json(res, 403, { erro: 'proibido' });
  if (fs.existsSync(arq) && fs.statSync(arq).isDirectory()) arq = path.join(arq, 'index.html');
  if (!fs.existsSync(arq)) arq = path.join(PUBLICO, 'index.html');
  res.writeHead(200, { 'content-type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'cache-control': arq.endsWith('index.html') || arq.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' });
  fs.createReadStream(arq).pipe(res);
}

const rotas = [];
const rota = (metodo, padrao, fn, publica = false) => rotas.push({ metodo, re: new RegExp('^' + padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, publica });

rota('GET', '/api/situacao', (req) => ({ versao: VERSAO, configurado: !!db.conta, nome: 'Calivix' }), true);
rota('POST', '/api/configurar', async (req) => {
  if (db.conta) throw erro(409, 'A senha já foi criada');
  const { senha } = await corpo(req);
  if (!senha || String(senha).length < 6) throw erro(400, 'A senha precisa de pelo menos 6 caracteres');
  const sal = crypto.randomBytes(16).toString('hex');
  db.conta = { sal, hash: hashSenha(String(senha), sal), criada: agora() };
  banco.gravarJa();
  return { ok: true };
}, true);
rota('POST', '/api/entrar', async (req) => {
  const ip = req.socket.remoteAddress;
  const t = tentativas.get(ip) || { n: 0, ate: 0 };
  if (t.ate > Date.now()) throw erro(429, 'Muitas tentativas. Espere um minuto.');
  const { senha, aparelho = {} } = await corpo(req);
  if (!db.conta) throw erro(409, 'Crie a senha primeiro');
  const ok = crypto.timingSafeEqual(Buffer.from(hashSenha(String(senha || ''), db.conta.sal), 'hex'), Buffer.from(db.conta.hash, 'hex'));
  if (!ok) { t.n++; if (t.n >= 5) { t.ate = Date.now() + 60000; t.n = 0; } tentativas.set(ip, t); throw erro(401, 'Senha incorreta'); }
  tentativas.delete(ip);
  const apId = aparelho.id && /^[a-f0-9]{16}$/.test(aparelho.id) ? aparelho.id : id();
  db.aparelhos[apId] = { id: apId, nome: String(aparelho.nome || 'Aparelho').slice(0, 60), plataforma: String(aparelho.plataforma || 'web').slice(0, 20), visto: agora() };
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessoes[token] = { aparelho: apId, criada: agora(), visto: agora() };
  banco.gravar();
  return { token, aparelho: apId };
}, true);
rota('POST', '/api/sair', (req, s) => { delete db.sessoes[s.token]; banco.gravar(); return { ok: true }; });
rota('GET', '/api/estado', (req, s) => estado(s));
rota('GET', '/api/chave-adb', () => ({ jwk: db.chaveAdb }));
rota('GET', '/api/claude', () => ({ token: db.ajustes.tokenClaude }));
rota('POST', '/api/claude/novo-token', () => { db.ajustes.tokenClaude = crypto.randomBytes(24).toString('base64url'); banco.gravar(); return { token: db.ajustes.tokenClaude }; });
rota('PATCH', '/api/ajustes', async (req) => {
  const b = await corpo(req);
  if (typeof b.redesDoServidor === 'string') db.ajustes.redesDoServidor = b.redesDoServidor.slice(0, 300);
  banco.gravar(); return { ok: true };
});
rota('PATCH', '/api/aparelhos/:id', async (req, s, { id: a }) => {
  const b = await corpo(req);
  if (!db.aparelhos[a]) throw erro(404, 'Aparelho não encontrado');
  if (b.nome) db.aparelhos[a].nome = String(b.nome).slice(0, 60);
  if (b.rede !== undefined) db.aparelhos[a].rede = String(b.rede).slice(0, 80);
  banco.gravar(); avisar('aparelhos'); return db.aparelhos[a];
});

// TVs
rota('POST', '/api/tvs', async (req, s) => {
  const b = await corpo(req);
  // mesma TV (pelo número de série) não é cadastrada duas vezes
  const existente = b.serial && Object.values(db.tvs).find((t) => t.serial === b.serial);
  const t = existente || { id: id(), criadaEm: agora(), perfil: { desativados: [], recursos: {}, launcher: { instalado: false, config: null } } };
  Object.assign(t, {
    nome: String(b.nome || t.nome || 'TV').slice(0, 60), local: String(b.local ?? t.local ?? '').slice(0, 60),
    ip: b.ip || t.ip, porta: Number(b.porta || t.porta || 5555), serial: b.serial || t.serial || '', castId: b.castId || t.castId || '',
    tailnetIp: b.tailnetIp ?? t.tailnetIp ?? '', sondagem: b.sondagem || t.sondagem || null, rede: b.rede || t.rede || b.sondagem?.rede || '',
    lista: b.lista ?? t.lista ?? null,
  });
  db.tvs[t.id] = t; banco.gravar(); avisar('tvs', { tvId: t.id });
  return t;
});
rota('PATCH', '/api/tvs/:id', async (req, s, { id: tvId }) => {
  const t = db.tvs[tvId]; if (!t) throw erro(404, 'TV não encontrada');
  const b = await corpo(req);
  for (const k of ['nome', 'local', 'ip', 'porta', 'tailnetIp', 'lista']) if (b[k] !== undefined) t[k] = b[k];
  if (b.perfil) t.perfil = { ...t.perfil, ...b.perfil };
  banco.gravar(); avisar('tvs', { tvId }); return t;
});
rota('DELETE', '/api/tvs/:id', (req, s, { id: tvId }) => {
  delete db.tvs[tvId]; db.tarefas = db.tarefas.filter((t) => t.tvId !== tvId || t.status !== 'pendente');
  fs.rmSync(path.join(DADOS, 'capturas', tvId + '.png'), { force: true });
  banco.gravar(); avisar('tvs'); return { ok: true };
});
rota('POST', '/api/tvs/:id/relato', async (req, s, { id: tvId }) => { aplicarRelato(tvId, await corpo(req), s.aparelho); return { ok: true }; });
rota('GET', '/api/tvs/:id/registro', (req, s, { id: tvId }) => ({ registro: db.tvs[tvId]?.registro || null }));
rota('GET', '/api/tvs/:id/captura', (req, s, { id: tvId }, res) => {
  const f = path.join(DADOS, 'capturas', path.basename(tvId) + '.png');
  if (!fs.existsSync(f)) throw erro(404, 'Sem captura');
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res); return undefined;
});
rota('POST', '/api/tvs/:id/alcance', async (req, s, { id: tvId }) => {
  const t = db.tvs[tvId]; if (!t) throw erro(404, 'TV não encontrada');
  return { alcanca: await sondarPorta(t.ip, t.porta || 5555, 1500) };
});

// Tarefas
rota('POST', '/api/tarefas', async (req, s) => {
  const b = await corpo(req);
  return novaTarefa({ ...b, criadaPor: s.aparelho, status: b.executarAgora ? 'executando' : 'pendente' });
});
rota('POST', '/api/tarefas/:id/assumir', (req, s, { id: tid }) => {
  const t = db.tarefas.find((x) => x.id === tid); if (!t) throw erro(404, 'Tarefa não encontrada');
  if (t.status !== 'pendente') throw erro(409, t.status === 'executando' ? 'Outro aparelho já está executando esta tarefa' : 'A tarefa não está pendente');
  t.status = 'executando'; t.assumidaPor = s.aparelho; t.inicio = agora(); banco.gravar(); avisar('tarefas', { tvId: t.tvId });
  return t;
});
rota('POST', '/api/tarefas/:id/log', async (req, s, { id: tid }) => {
  const t = db.tarefas.find((x) => x.id === tid); if (!t) throw erro(404, 'Tarefa não encontrada');
  const { linhas = [] } = await corpo(req);
  for (const l of linhas.slice(0, 200)) { t.log.push({ em: agora(), l: String(l).slice(0, 4000) }); avisar('log', { tarefa: tid, l }); }
  banco.gravar(); return { ok: true };
});
rota('POST', '/api/tarefas/:id/concluir', async (req, s, { id: tid }) => {
  const t = db.tarefas.find((x) => x.id === tid); if (!t) throw erro(404, 'Tarefa não encontrada');
  const b = await corpo(req);
  if (b.resultado) aplicarRelato(t.tvId, b.resultado, s.aparelho);
  if (b.devolver) { t.status = 'pendente'; t.assumidaPor = null; t.inicio = null; t.erro = b.erro || null; }
  else { t.status = b.erro ? 'falhou' : 'concluida'; t.erro = b.erro || null; t.fim = agora(); t.resumo = b.erro ? null : resumir(b.resultado || {}); if (b.resultado?.comandos) t.saidas = b.resultado.comandos; }
  banco.gravar(); avisar('tarefas', { tvId: t.tvId }); return t;
});
rota('POST', '/api/tarefas/:id/cancelar', (req, s, { id: tid }) => {
  const t = db.tarefas.find((x) => x.id === tid); if (!t) throw erro(404, 'Tarefa não encontrada');
  if (t.status === 'executando') throw erro(409, 'A tarefa já está sendo executada');
  t.status = 'cancelada'; t.fim = agora(); banco.gravar(); avisar('tarefas', { tvId: t.tvId }); return t;
});
rota('POST', '/api/tarefas/:id/servidor', async (req, s, { id: tid }) => {
  const t = db.tarefas.find((x) => x.id === tid); if (!t) throw erro(404, 'Tarefa não encontrada');
  if (t.execucao === 'aparelho') t.execucao = 'auto';
  const ok = await tentarNoServidor(t);
  return { ok, tarefa: t };
});

// Arquivos (APKs enviados para instalar)
rota('POST', '/api/arquivos', async (req) => {
  const { nome, base64 } = await corpo(req, 200e6);
  if (!/\.apk$/i.test(nome || '')) throw erro(400, 'Só arquivos .apk');
  const n = id() + '-' + path.basename(nome).replace(/[^\w.-]/g, '_');
  fs.writeFileSync(path.join(DADOS, 'arquivos', n), Buffer.from(base64, 'base64'));
  return { arquivo: n };
});
rota('GET', '/api/arquivos/:nome', (req, s, { nome }, res) => {
  const f = path.join(DADOS, 'arquivos', path.basename(nome));
  if (!fs.existsSync(f)) throw erro(404, 'Arquivo não encontrado');
  res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive' }); fs.createReadStream(f).pipe(res); return undefined;
});

// Descobertas (sugestões de TVs e TV boxes vistas por cada aparelho)
rota('POST', '/api/descobertas', async (req, s) => {
  const { itens = [], rede = '' } = await corpo(req);
  db.descobertas[s.aparelho] = { em: agora(), rede: String(rede).slice(0, 80), itens: itens.slice(0, 100) };
  banco.gravar(); avisar('descobertas'); return { ok: true };
});

// Pedidos ao Claude (área de voz)
rota('POST', '/api/pedidos', async (req, s) => {
  const { texto, tvId } = await corpo(req);
  if (!texto || !String(texto).trim()) throw erro(400, 'Pedido vazio');
  const p = { id: id(), texto: String(texto).slice(0, 4000), tvId: tvId || null, origem: s.aparelho, criadoEm: agora(), status: 'novo', resposta: null };
  db.pedidos.push(p); banco.gravar(); avisar('pedidos');
  return p;
});
rota('DELETE', '/api/pedidos/:id', (req, s, { id: pid }) => { db.pedidos = db.pedidos.filter((p) => p.id !== pid); banco.gravar(); avisar('pedidos'); return { ok: true }; });

rota('GET', '/api/eventos', (req, s, p, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  ouvintes.add(res); req.on('close', () => ouvintes.delete(res));
  return undefined;
});

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, mcp-session-id, mcp-protocol-version');
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (url.pathname === '/mcp') return await tratarMcp(req, res, { db, banco, novaTarefa, tentarNoServidor, DADOS, VERSAO, avisar, corpo });
    if (url.pathname === '/launcher.apk' && fs.existsSync(APK_LAUNCHER)) { res.writeHead(200, { 'content-type': TIPOS['.apk'] }); return fs.createReadStream(APK_LAUNCHER).pipe(res); }
    if (!url.pathname.startsWith('/api/')) return estatico(req, res, url.pathname);
    for (const r of rotas) {
      if (r.metodo !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const s = r.publica ? null : sessaoDe(req);
      if (!r.publica && !s) throw erro(401, 'Entre com a senha');
      const out = await r.fn(req, s, m.groups || {}, res);
      if (out !== undefined) json(res, 200, out);
      return;
    }
    throw erro(404, 'Rota não encontrada');
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { erro: e.message });
    if (!e.status) console.error(e);
  }
});
servidor.listen(PORTA, '0.0.0.0', () => console.log(`Calivix ${VERSAO} em http://0.0.0.0:${PORTA} (dados em ${DADOS})`));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { banco.gravarJa(); process.exit(0); });
