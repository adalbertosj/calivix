// Motor local dos apps nativos: descobre TVs na rede, confere se uma TV cadastrada está ao alcance
// (e é ela mesma) e executa tarefas direto deste aparelho, relatando tudo ao servidor.
import { nativo, transporteNativo } from '../core/transporte-nativo.js';
import { executarTarefa, conectarTv } from '../core/executor.js';
import { sondar } from '../core/tv.js';
import { api } from './api.js';

let chave = null;
async function jwk() { if (!chave) chave = (await api('GET', '/api/chave-adb')).jwk; return chave; }
let apk = null;

export const podeExecutar = () => !!nativo();

// Portas que denunciam o tipo de aparelho.
const PORTAS = { 5555: 'adb', 8008: 'cast', 8009: 'cast', 6466: 'atvremote', 8060: 'roku', 8001: 'samsung', 8002: 'samsung', 3001: 'lg', 1926: 'philips', 7000: 'airplay' };

export async function infoRede() { return nativo() ? nativo().infoRede() : null; }

// Varre a sub-rede /24 deste aparelho e devolve candidatos a TV / TV box.
export async function descobrir(aoProgredir) {
  const n = nativo(); if (!n) throw new Error('A descoberta precisa do app instalado neste aparelho');
  const rede = await n.infoRede();
  if (!rede?.ip) throw new Error('Este aparelho não está conectado a uma rede Wi-Fi ou cabeada');
  const base = rede.ip.split('.').slice(0, 3).join('.');
  const hosts = []; for (let i = 1; i < 255; i++) { const h = `${base}.${i}`; if (h !== rede.ip) hosts.push(h); }
  const achados = [];
  const portas = Object.keys(PORTAS).map(Number);
  for (let i = 0; i < hosts.length; i += 64) {
    const r = await n.sondar(hosts.slice(i, i + 64), portas, 600);
    achados.push(...r.filter((x) => x.portas.length));
    aoProgredir && aoProgredir(Math.min(1, (i + 64) / hosts.length));
  }
  const itens = [];
  for (const a of achados) {
    const tipos = [...new Set(a.portas.map((p) => PORTAS[p]))];
    if (!tipos.some((t) => ['adb', 'cast', 'atvremote', 'roku', 'samsung', 'lg', 'philips'].includes(t))) continue;
    const it = { ip: a.host, portas: a.portas, tipos, nome: '', modelo: '', castId: '', compativel: tipos.includes('adb') || tipos.includes('cast') || tipos.includes('atvremote') };
    if (tipos.includes('cast')) {
      try {
        const r = await n.httpGet(`http://${a.host}:8008/setup/eureka_info?params=name,device_info`, 2500);
        const j = JSON.parse(r.texto);
        it.nome = j.name || ''; it.castId = j.ssdp_udn || ''; it.modelo = j.device_info?.model_name || j.device_info?.manufacturer || '';
      } catch { /* aparelho Cast sem informação */ }
    }
    if (tipos.includes('roku')) it.nome ||= 'Roku';
    if (tipos.includes('samsung')) { it.nome ||= 'Samsung (Tizen)'; it.compativel = tipos.includes('adb'); }
    if (tipos.includes('lg')) { it.nome ||= 'LG (webOS)'; it.compativel = tipos.includes('adb'); }
    it.adbAberto = tipos.includes('adb');
    itens.push(it);
  }
  return { rede, itens };
}

// Por qual endereço este aparelho alcança a TV agora: o da rede de casa (preferido, mais rápido) ou o
// da Tailnet (fora de casa). null se nenhum responde. O número de série é conferido ao conectar.
export async function enderecoAoAlcance(tv) {
  const n = nativo(); if (!n) return null;
  const hosts = [tv.ip, tv.tailnetIp].filter(Boolean);
  if (!hosts.length) return null;
  const r = await n.sondar(hosts, [tv.porta || 5555], 1500).catch(() => []);
  return hosts.find((h) => r.find((x) => x.host === h)?.portas?.length) || null;
}
export async function alcance(tv) { return !!(await enderecoAoAlcance(tv)); }

// Lê uma TV nova (sondagem) para cadastrar.
export async function lerTvNova(ip, porta = 5555, aoPedirPermissao) {
  const adb = await conectarTv({ transporte: transporteNativo, jwk: await jwk(), aparelho: nativo().plataforma }, { ip, porta }, { aoPedirPermissao });
  try { return await sondar(adb); } finally { adb.fechar(); }
}

async function apkLauncher() {
  if (!apk) apk = new Uint8Array(await (await fetch('launcher/calivix-launcher.apk')).arrayBuffer());
  return apk;
}

const correndo = new Set();
// Executa uma tarefa neste aparelho. Se ela ainda não foi assumida, assume no servidor primeiro.
export async function executarAqui(tarefa, tv, aoLog) {
  if (correndo.has(tv.id)) throw new Error('Já há uma tarefa rodando nesta TV');
  correndo.add(tv.id);
  let buffer = [];
  const enviarLog = async () => { if (!buffer.length) return; const l = buffer; buffer = []; await api('POST', `/api/tarefas/${tarefa.id}/log`, { linhas: l }).catch(() => {}); };
  const timer = setInterval(enviarLog, 1200);
  try {
    if (tarefa.status === 'pendente') tarefa = await api('POST', `/api/tarefas/${tarefa.id}/assumir`);
    const { registro } = await api('GET', `/api/tvs/${tv.id}/registro`);
    const r = await executarTarefa({
      transporte: transporteNativo, jwk: await jwk(), aparelho: nativo().plataforma, registro,
      log: (l) => { buffer.push(l); aoLog && aoLog(l); },
      salvarRegistro: async (reg) => { await api('POST', `/api/tvs/${tv.id}/relato`, { registro: reg }); },
      apkLauncher, arquivo: async (nome) => new Uint8Array(await (await api('GET', `/api/arquivos/${encodeURIComponent(nome)}`, null, { bruto: true })).arrayBuffer()),
    }, { ...tv, ip: (await enderecoAoAlcance(tv)) || tv.ip }, tarefa);
    if (r.captura) r.captura = b64(r.captura);
    clearInterval(timer); await enviarLog();
    return await api('POST', `/api/tarefas/${tarefa.id}/concluir`, { resultado: r });
  } catch (e) {
    clearInterval(timer); buffer.push('✗ ' + e.message); await enviarLog();
    const devolver = /outra rede|não está alcançável|recusou a porta|Sem resposta/.test(e.message);
    await api('POST', `/api/tarefas/${tarefa.id}/concluir`, { erro: e.message, devolver }).catch(() => {});
    throw e;
  } finally { correndo.delete(tv.id); }
}

const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

// Pendentes que ESTE aparelho pode executar agora (TV ao alcance).
export async function pendentesAoAlcance(estado) {
  if (!podeExecutar()) return [];
  const porTv = new Map();
  for (const t of estado.tarefas) if (t.status === 'pendente' && t.execucao !== 'servidor') {
    if (!porTv.has(t.tvId)) porTv.set(t.tvId, []);
    porTv.get(t.tvId).push(t);
  }
  const out = [];
  for (const [tvId, tarefas] of porTv) {
    const tv = estado.tvs.find((x) => x.id === tvId);
    if (tv && await alcance(tv)) out.push({ tv, tarefas });
  }
  return out;
}
