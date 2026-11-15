// Presets: um conjunto de ajustes guardado com nome (apps para instalar, launcher limpo, papéis de parede,
// pacotes para desativar, DNS) que vira uma tarefa comum em qualquer TV. Mesmo código no servidor e nos apps.
import { LOJA } from './tv.js';

const PACOTE = /^[a-zA-Z][\w]*(\.[\w]+)+$/;
const ARQ = /^[\w.-]+\.(apk|jpe?g|png|webp|mp4)$/i;
const lista = (v, re) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter((x) => re.test(x)))];

// Deixa o preset no formato esperado, descartando o que não for válido.
export function normalizarPreset(b = {}) {
  const p = {
    nome: String(b.nome || '').trim().slice(0, 80),
    descricao: String(b.descricao || '').trim().slice(0, 400),
    apps: lista(b.apps, PACOTE),                   // pela Play Store da TV
    apks: lista(b.apks, ARQ).filter((a) => /\.apk$/i.test(a)),   // enviados ao servidor
    desativar: lista(b.desativar, PACOTE),
    launcher: null,
    papeis: null,
    dns: b.dns == null ? null : String(b.dns).trim().slice(0, 120),
  };
  if (b.launcher) {
    const c = b.launcher.config && typeof b.launcher.config === 'object' && !Array.isArray(b.launcher.config) ? b.launcher.config : {};
    p.launcher = { config: c };
  }
  if (b.papeis) {
    const arquivos = lista(b.papeis.arquivos, ARQ).filter((a) => !/\.apk$/i.test(a));
    if (arquivos.length) {
      p.papeis = { arquivos, minutos: Math.max(0, Math.min(1440, Math.round(Number(b.papeis.minutos) || 0))),
        ordem: b.papeis.ordem === 'shuffle' ? 'shuffle' : 'sequential', substituir: b.papeis.substituir !== false };
    }
  }
  if (!p.nome) throw Object.assign(new Error('Dê um nome ao preset'), { status: 400 });
  return p;
}

// O que o preset faz, em palavras curtas (para listas e confirmações).
export function descreverPreset(p) {
  const d = [];
  if (p.apps?.length || p.apks?.length) d.push(`${(p.apps?.length || 0) + (p.apks?.length || 0)} app(s)`);
  if (p.desativar?.length) d.push(`desativa ${p.desativar.length}`);
  if (p.launcher) d.push('launcher limpo');
  if (p.papeis) d.push(`${p.papeis.arquivos.length} papel(éis) de parede`);
  if (p.dns != null) d.push(p.dns ? 'DNS ' + p.dns : 'DNS padrão');
  return d.join(' · ') || 'vazio';
}

// A lista de ações da tarefa. Apps primeiro (a Play Store precisa da tela), depois limpeza, launcher e
// papéis. Um app que falhar (pago, indisponível nesta TV) não interrompe o resto: a ação é "opcional".
// opcoes: { apps, apks, desativar, launcher, papeis, dns } (false pula a parte) e apps: [] para escolher só alguns.
export function acoesDoPreset(p, opcoes = {}) {
  const usa = (k) => opcoes[k] !== false;
  const acoes = [];
  const apps = Array.isArray(opcoes.apps) ? p.apps.filter((a) => opcoes.apps.includes(a)) : usa('apps') ? p.apps : [];
  for (const pacote of apps) acoes.push({ tipo: 'instalar_loja', params: { pacote }, opcional: true });
  if (usa('apks')) for (const arquivo of p.apks || []) acoes.push({ tipo: 'instalar_apk', params: { arquivo }, opcional: true });
  if (usa('desativar') && p.desativar?.length) acoes.push({ tipo: 'desativar', params: { pacotes: p.desativar } });
  if (usa('launcher') && p.launcher) acoes.push({ tipo: 'instalar_launcher', params: { config: p.launcher.config, mesclar: true } });
  if (usa('papeis') && p.papeis) acoes.push({ tipo: 'papel_de_parede', params: { ...p.papeis } });
  if (usa('dns') && p.dns != null) acoes.push({ tipo: 'dns', params: { servidor: p.dns } });
  if (!acoes.length) return acoes;
  acoes.push({ tipo: 'tecla', params: { tecla: 'HOME' }, opcional: true }, { tipo: 'captura', opcional: true });
  return acoes;
}

// Monta um preset a partir do que a TV tem hoje: launcher e dock, papéis (procurados entre os arquivos do
// servidor pelo nome), apps da lista LOJA instalados e os pacotes que o Calivix desativou nela.
export function presetDaTv(tv, arquivos = []) {
  const l = tv.perfil?.launcher || {};
  const instalados = new Set((tv.inventario?.pacotes || tv.inventario?.apps || []).map((x) => (typeof x === 'string' ? x : x.pacote)));
  const papeis = [];
  for (const nome of l.papeis || []) {
    const achado = arquivos.filter((a) => a.replace(/^[0-9a-f]{16}-/, '') === nome).pop();
    if (achado) papeis.push(achado);
  }
  const cfg = { ...(l.config || {}) };
  const rot = cfg.wallpaper_rotation_minutes, ordem = cfg.wallpaper_order;
  for (const k of Object.keys(cfg)) if (/^wallpaper/.test(k)) delete cfg[k];
  return {
    nome: 'Como na ' + tv.nome,
    descricao: '',
    apps: LOJA.filter((a) => instalados.has(a.pacote)).map((a) => a.pacote),
    apks: [],
    desativar: tv.perfil?.desativados || [],
    launcher: l.instalado || l.config ? { config: cfg } : null,
    papeis: papeis.length ? { arquivos: papeis, minutos: rot >= 1440 ? 0 : rot || 30, ordem: ordem === 'shuffle' ? 'shuffle' : 'sequential', substituir: true } : null,
    dns: null,
  };
}
