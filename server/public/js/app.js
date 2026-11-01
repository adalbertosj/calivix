// Interface do Calivix. A mesma página roda no navegador (servidor), no Mac/Windows (Electron) e no
// iPhone/iPad/Android (Capacitor); nos apps nativos ela também executa as tarefas direto na TV.
import { api, sessao, eventos } from './api.js';
import * as motor from './motor.js';
import { RECURSOS, NUCLEO_RE, NUCLEO_OK, nomeAmigavel, LAUNCHER, LAUNCHERS_DE_FABRICA, SETUP } from '../core/tv.js';
import { carregarCatalogo, sugerirListas } from '../core/catalogo.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raiz = $('#raiz');
let E = null;          // estado vindo do servidor
let catalogo = null;
const alcanceCache = new Map(); // tvId -> { ok, em }
const NATIVO = motor.podeExecutar();
const plataforma = window.CalivixNativo?.plataforma || 'web';
// no Mac a barra de título é embutida: os botões de janela ocupam o canto superior
if (plataforma === 'mac') document.documentElement.style.setProperty('--topo', '26px');

const I = {
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="12" rx="2.5"/><path d="M9 20h6M12 16.5V20"/></svg>',
  radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  engr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  volta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>',
  cima: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 15l6-6 6 6"/></svg>',
  baixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  esq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>',
  dir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  casa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>',
  enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12l16-8-6 16-2-7z"/></svg>',
  att: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>',
};

// ---------- utilidades de interface ----------
function toast(msg, ms = 3200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
function janela(html, aoMontar) {
  const v = document.createElement('div'); v.className = 'veu';
  v.innerHTML = `<div class="janela">${html}</div>`;
  v.addEventListener('click', (e) => { if (e.target === v && !v.dataset.preso) v.remove(); });
  document.body.append(v);
  aoMontar && aoMontar(v.firstChild, () => v.remove(), v);
  return v;
}
const confirmar = (titulo, texto, botao = 'Confirmar', perigo = false) => new Promise((res) => {
  janela(`<h2>${esc(titulo)}</h2><p class="sub">${texto}</p><div class="linha"><span class="espaco"></span><button class="bt" data-n>Cancelar</button><button class="bt ${perigo ? 'perigo' : 'pri'}" data-s>${esc(botao)}</button></div>`,
    (j, fechar) => { $('[data-n]', j).onclick = () => { fechar(); res(false); }; $('[data-s]', j).onclick = () => { fechar(); res(true); }; });
});
const quando = (iso) => {
  if (!iso) return 'nunca';
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 60) return 'agora'; if (d < 3600) return `há ${Math.round(d / 60)} min`; if (d < 86400) return `há ${Math.round(d / 3600)} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};
const nomeAparelho = (id) => id === 'servidor' ? 'servidor' : id === 'claude' ? 'Claude' : (E?.aparelhos?.[id]?.nome || 'outro aparelho');
const tvPorId = (id) => E.tvs.find((t) => t.id === id);
const STATUS = { pendente: ['av', 'Pendente'], executando: ['info', 'Executando'], concluida: ['ok', 'Concluída'], falhou: ['ruim', 'Falhou'], cancelada: ['', 'Cancelada'] };

// ---------- execução: aqui, pelo servidor ou guardada ----------
async function pedir(tv, titulo, acoes, { silencioso = false } = {}) {
  if (NATIVO && await estaAoAlcance(tv)) {
    const tarefa = await api('POST', '/api/tarefas', { tvId: tv.id, titulo, acoes, executarAgora: true, execucao: 'aparelho' });
    return executarComJanela(tarefa, tv, silencioso);
  }
  const t = await api('POST', '/api/tarefas', { tvId: tv.id, titulo, acoes });
  if (!silencioso) toast(NATIVO ? 'A TV não está nesta rede. O pedido foi guardado: o servidor ou um aparelho seu aplica quando alcançá-la.' : 'Pedido guardado. O servidor aplica agora se alcançar a TV; senão, um aparelho seu aplica quando estiver na rede dela.', 5000);
  return t;
}

function executarComJanela(tarefa, tv, silencioso) {
  return new Promise((res) => {
    const v = janela(`<h2>${esc(tarefa.titulo)}</h2><p class="sub">${esc(tv.nome)} · executando deste aparelho</p><div class="log" id="logx"></div><div class="linha" style="margin-top:14px"><span class="mini" id="st">Conectando à TV…</span><span class="espaco"></span><button class="bt" id="fx" disabled>Fechar</button></div>`,
      (j, fechar, veu) => {
        veu.dataset.preso = '1';
        const log = $('#logx', j);
        const add = (l) => { log.textContent += l + '\n'; log.scrollTop = log.scrollHeight; };
        motor.executarAqui(tarefa, tv, add).then((t) => {
          $('#st', j).innerHTML = `<span class="selo ok">${esc(t.resumo || 'Concluída')}</span>`;
          if (silencioso) setTimeout(fechar, 600);
          res(t);
        }).catch((e) => { add('✗ ' + e.message); $('#st', j).innerHTML = '<span class="selo ruim">Não concluiu</span>'; res(null); })
          .finally(() => { const b = $('#fx', j); b.disabled = false; b.onclick = () => { fechar(); atualizar(); }; delete veu.dataset.preso; });
      });
    return v;
  });
}

async function estaAoAlcance(tv, forcar = false) {
  const c = alcanceCache.get(tv.id);
  if (!forcar && c && Date.now() - c.em < 20000) return c.ok;
  const ok = await motor.alcance(tv).catch(() => false);
  alcanceCache.set(tv.id, { ok, em: Date.now() });
  return ok;
}

// ---------- pendentes ao alcance (o celular entrou no Wi-Fi da TV) ----------
const recusados = new Set();
async function vigiarPendentes() {
  if (!NATIVO || !E) return;
  const lista = await motor.pendentesAoAlcance(E).catch(() => []);
  const faixa = $('#faixa-pendentes');
  const novos = lista.filter((x) => !recusados.has(x.tv.id + ':' + x.tarefas.map((t) => t.id).join()));
  if (faixa) faixa.innerHTML = lista.map((x) => `<div class="faixa"><div class="txt"><b>${esc(x.tv.nome)} está ao alcance.</b><div class="mini">${x.tarefas.length} alteraç${x.tarefas.length > 1 ? 'ões pendentes' : 'ão pendente'}: ${esc(x.tarefas.map((t) => t.titulo).join(' · '))}</div></div><span class="espaco"></span><button class="bt grad" data-aplicar="${x.tv.id}">Aplicar agora</button></div>`).join('');
  faixa && faixa.querySelectorAll('[data-aplicar]').forEach((b) => { b.onclick = () => aplicarPendentes(lista.find((x) => x.tv.id === b.dataset.aplicar)); });
  if (novos.length && !document.querySelector('.veu')) {
    const x = novos[0];
    const chave = x.tv.id + ':' + x.tarefas.map((t) => t.id).join();
    const sim = await confirmar(`Alterações pendentes para ${x.tv.nome}`,
      `Você está na mesma rede da <b>${esc(x.tv.nome)}</b>. ${x.tarefas.length} pedido(s) feito(s) antes estão esperando: <br><br>${x.tarefas.map((t) => `• ${esc(t.titulo)} <span class="mini">(${esc(nomeAparelho(t.criadaPor))}, ${quando(t.criadaEm)})</span>`).join('<br>')}<br><br>Aplicar agora, a partir deste aparelho?`, 'Aplicar agora');
    if (sim) aplicarPendentes(x); else recusados.add(chave);
  }
}
async function aplicarPendentes(x) {
  for (const t of x.tarefas) {
    const atual = E.tarefas.find((y) => y.id === t.id);
    if (atual?.status !== 'pendente') continue;
    await executarComJanela(atual, x.tv);
  }
  atualizar();
}

// ---------- dados ----------
let atualizando = null;
async function atualizar() {
  if (atualizando) return atualizando;
  atualizando = (async () => {
    try { E = await api('GET', '/api/estado'); render(); }
    catch (e) { if (e.status === 401) { sessao.token = null; return iniciar(); } toast(e.message); }
    finally { atualizando = null; }
  })();
  return atualizando;
}

// ---------- telas de entrada ----------
async function iniciar() {
  if (NATIVO && !sessao.servidor) return telaServidor();
  let sit;
  try { sit = await api('GET', '/api/situacao', null, { semToken: true }); }
  catch (e) { return NATIVO ? telaServidor(e.message) : (raiz.innerHTML = `<div class="entrada"><div class="cartao"><h1>Sem conexão</h1><p class="sub">${esc(e.message)}</p></div></div>`); }
  if (!sit.configurado) return telaSenha(true);
  if (!sessao.token) return telaSenha(false);
  await atualizar();
  catalogo = await carregarCatalogo().catch(() => null);
  eventos((ev) => { clearTimeout(iniciar.t); iniciar.t = setTimeout(() => ev.tipo === 'log' ? logAoVivo(ev) : atualizar(), ev.tipo === 'log' ? 0 : 250); });
  setInterval(vigiarPendentes, 45000);
  setTimeout(vigiarPendentes, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { atualizar(); setTimeout(vigiarPendentes, 800); } });
  window.addEventListener('online', () => setTimeout(vigiarPendentes, 1500));
  window.CalivixNativo?.aoMudarRede?.(() => { alcanceCache.clear(); setTimeout(vigiarPendentes, 1500); });
}
function logAoVivo(ev) {
  const el = document.querySelector(`[data-log="${ev.tarefa}"]`);
  if (el) { el.textContent += ev.l + '\n'; el.scrollTop = el.scrollHeight; }
}

function telaServidor(erro) {
  raiz.innerHTML = `<div class="entrada"><div class="cartao">
    <img class="logo" src="icons/icon-512.png" alt=""><h1>Calivix</h1>
    <p class="sub">Endereço do seu servidor Calivix (no Umbrel, pela Tailnet).</p>
    ${erro ? `<p class="selo ruim" style="margin-bottom:12px">${esc(erro)}</p>` : ''}
    <div class="campo"><label>Servidor</label><input class="ent" id="srv" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://umbrel-home.tail16dbfe.ts.net:8471" value="${esc(sessao.servidor || 'https://umbrel-home.tail16dbfe.ts.net:8471')}"></div>
    <button class="bt pri" style="width:100%" id="ok">Conectar</button></div></div>`;
  $('#ok').onclick = () => { let v = $('#srv').value.trim(); if (!/^https?:\/\//.test(v)) v = 'https://' + v; sessao.servidor = v; iniciar(); };
}

function telaSenha(primeira) {
  raiz.innerHTML = `<div class="entrada"><div class="cartao">
    <img class="logo" src="icons/icon-512.png" alt=""><h1>Calivix</h1>
    <p class="sub">${primeira ? 'Primeiro acesso: crie a senha do seu Calivix. Ela vale para todos os seus aparelhos.' : 'Entre com a senha do seu Calivix.'}</p>
    <form id="f"><div class="campo"><label>Senha</label><input class="ent" type="password" id="s" autocomplete="${primeira ? 'new-password' : 'current-password'}" required minlength="6"></div>
    ${primeira ? '<div class="campo"><label>Repita a senha</label><input class="ent" type="password" id="s2" autocomplete="new-password" required></div>' : ''}
    <div class="campo"><label>Nome deste aparelho</label><input class="ent" id="n" value="${esc(nomePadrao())}"></div>
    <button class="bt pri" style="width:100%">${primeira ? 'Criar e entrar' : 'Entrar'}</button></form>
    ${NATIVO ? '<p class="mini" style="text-align:center;margin-top:14px"><a href="#" id="trocar">Trocar de servidor</a></p>' : ''}</div></div>`;
  $('#trocar') && ($('#trocar').onclick = (e) => { e.preventDefault(); sessao.servidor = ''; telaServidor(); });
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      if (primeira) {
        if ($('#s').value !== $('#s2').value) return toast('As senhas não conferem');
        await api('POST', '/api/configurar', { senha: $('#s').value }, { semToken: true });
      }
      const r = await api('POST', '/api/entrar', { senha: $('#s').value, aparelho: { id: sessao.aparelho, nome: $('#n').value, plataforma } }, { semToken: true });
      sessao.token = r.token; sessao.aparelho = r.aparelho;
      iniciar();
    } catch (er) { toast(er.message); }
  };
}
function nomePadrao() {
  const p = { mac: 'Mac', windows: 'PC Windows', ios: /iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone', android: 'Android', web: 'Navegador' };
  return p[plataforma] || 'Aparelho';
}

// ---------- casca ----------
function rota() { return (location.hash.slice(2) || '').split('/'); }
window.addEventListener('hashchange', () => render());

function render() {
  if (!E) return;
  const [tela = '', a1, a2] = rota();
  const pendentes = E.tarefas.filter((t) => t.status === 'pendente').length;
  const pedidos = E.pedidos.filter((p) => p.status === 'novo' || (p.resposta && !p.lido)).length;
  const navs = [['', 'TVs', I.tv, pendentes], ['descobrir', 'Descobrir', I.radar], ['claude', 'Claude', I.mic, 0], ['ajustes', 'Ajustes', I.engr]];
  const nav = (cls) => navs.map(([r, n, ic, num]) => `<button class="nav ${(tela === r || (r === '' && tela === 'tv')) ? 'ativo' : ''}" onclick="location.hash='#/${r}'">${ic}<span>${n}</span>${num ? `<span class="num">${num}</span>` : ''}</button>`).join('');
  if (!$('.app')) {
    raiz.innerHTML = `<div class="app"><aside class="lateral"><div class="marca"><img src="icons/icon-192.png" alt=""><b>Cali<span>vix</span></b></div><div id="nav1"></div><div class="rodape" id="rod"></div></aside><main class="conteudo" id="tela"></main></div><nav class="barra-inferior" id="nav2"></nav>`;
  }
  $('#nav1').innerHTML = nav(); $('#nav2').innerHTML = nav();
  $('#rod').innerHTML = `Calivix ${esc(E.versao)} · ${esc(nomeAparelho(E.aparelho))}`;
  const alvo = $('#tela');
  const rolagem = window.scrollY;
  const mesma = alvo.dataset.rota === location.hash;
  alvo.dataset.rota = location.hash;
  if (tela === 'tv' && tvPorId(a1)) telaTv(alvo, tvPorId(a1), a2 || 'geral');
  else if (tela === 'descobrir') telaDescobrir(alvo);
  else if (tela === 'claude') telaClaude(alvo);
  else if (tela === 'ajustes') telaAjustes(alvo);
  else telaInicio(alvo);
  if (mesma) window.scrollTo(0, rolagem); else window.scrollTo(0, 0);
}

// ---------- início ----------
function telaInicio(el) {
  el.innerHTML = `<div class="cabeca"><div><h1>Suas TVs</h1><p class="sub">${E.tvs.length ? 'Toque numa TV para ajustar. As alterações ficam guardadas no seu servidor e sincronizadas entre seus aparelhos.' : 'Nenhuma TV ainda. Procure na rede ou adicione pelo endereço.'}</p></div>
    <button class="bt pri" id="add">${I.mais} Adicionar TV</button></div>
    <div id="faixa-pendentes"></div>
    <div class="grade">${E.tvs.map(cartaoTv).join('')}</div>
    ${sugestoesHtml()}`;
  $('#add').onclick = () => adicionarTv();
  el.querySelectorAll('[data-tv]').forEach((c) => { c.onclick = () => { location.hash = '#/tv/' + c.dataset.tv; }; });
  ligarSugestoes(el);
  vigiarPendentes();
  if (NATIVO) for (const tv of E.tvs) estaAoAlcance(tv).then((ok) => { const s = el.querySelector(`[data-alc="${tv.id}"]`); if (s) s.outerHTML = ok ? '<span class="selo ok">Nesta rede</span>' : '<span class="selo">Fora desta rede</span>'; });
}
function cartaoTv(tv) {
  const pend = E.tarefas.filter((t) => t.tvId === tv.id && t.status === 'pendente').length;
  const s = tv.sondagem;
  return `<div class="cartao tv" data-tv="${tv.id}">
    <div class="tela" style="${tv.temCaptura ? `background-image:url('${capturaUrl(tv)}')` : ''}">${tv.temCaptura ? '' : I.tv}</div>
    <div class="linha"><div class="nome">${esc(tv.nome)}</div><span class="espaco"></span>${NATIVO ? `<span class="selo" data-alc="${tv.id}">…</span>` : ''}</div>
    <div class="mini">${esc([tv.local, s ? `${s.fabricante} ${s.modelo} · Android ${s.android}` : 'ainda não lida'].filter(Boolean).join(' · '))}</div>
    <div class="linha" style="margin-top:10px">${tv.perfil?.launcher?.instalado ? '<span class="selo ok">Launcher limpo</span>' : ''}${tv.perfil?.desativados?.length ? `<span class="selo info">${tv.perfil.desativados.length} desativados</span>` : ''}${pend ? `<span class="selo av">${pend} pendente${pend > 1 ? 's' : ''}</span>` : ''}</div>
    <div class="mini" style="margin-top:8px">Vista ${quando(tv.visto)}${tv.vistoPor ? ' por ' + esc(nomeAparelho(tv.vistoPor)) : ''}${tv.rede ? ' · rede ' + esc(tv.rede) : ''}</div></div>`;
}
const capturaUrl = (tv) => `${sessao.servidor}/api/tvs/${tv.id}/captura?token=${encodeURIComponent(sessao.token)}&v=${encodeURIComponent(tv.capturaEm || '')}`;

function sugestoesHtml() {
  // já cadastrada: mesmo Cast id, ou mesmo IP sem Cast id diferente (o mesmo IP em outra rede é outra TV)
  const jaTem = (i) => E.tvs.some((t) => (i.castId && t.castId === i.castId) || (t.ip === i.ip && (!t.castId || !i.castId)));
  const todas = Object.entries(E.descobertas || {}).flatMap(([ap, d]) => d.itens.map((i) => ({ ...i, ap, rede: d.rede, em: d.em })));
  const novas = todas.filter((i) => !jaTem(i));
  if (!novas.length) return '';
  return `<h2>Encontradas na rede</h2><div class="lista">${novas.map((i) => `<div class="item"><div class="txt"><div class="tit">${esc(i.nome || i.ip)}</div>
    <div class="desc">${esc([i.modelo, i.ip, i.rede && !/^[\d.]+$/.test(i.rede) && 'rede ' + i.rede, 'visto por ' + nomeAparelho(i.ap) + ' ' + quando(i.em)].filter(Boolean).join(' · '))}</div></div>
    ${i.compativel ? `<button class="bt peq pri" data-sug="${esc(i.ip)}" data-nome="${esc(i.nome)}" data-cast="${esc(i.castId)}">Adicionar</button>` : '<span class="selo">Sem ADB (não Android)</span>'}</div>`).join('')}</div>`;
}
function ligarSugestoes(el) {
  el.querySelectorAll('[data-sug]').forEach((b) => { b.onclick = () => adicionarTv({ ip: b.dataset.sug, nome: b.dataset.nome, castId: b.dataset.cast }); });
}

// ---------- adicionar TV ----------
function adicionarTv(pre = {}) {
  janela(`<h2>Adicionar TV</h2>
    <p class="sub">${NATIVO ? 'Este aparelho precisa estar na mesma rede da TV.' : 'O servidor vai ler a TV se alcançá-la (rede de casa ou Tailnet). Pelo app no celular ou no computador, a leitura é feita direto do aparelho.'}</p>
    <div class="campo"><label>Nome</label><input class="ent" id="nm" value="${esc(pre.nome || '')}" placeholder="TV da Sala"></div>
    <div class="campo"><label>Local</label><input class="ent" id="lc" placeholder="Casa, Sala, Quarto, Casa da praia…"></div>
    <div class="campo"><label>Endereço IP da TV</label><input class="ent" id="ip" inputmode="decimal" value="${esc(pre.ip || '')}" placeholder="192.168.0.43"></div>
    <details class="mini" style="margin-bottom:14px"><summary>Antes: ligue a depuração na TV</summary><p>Configurações › Sistema › Sobre › aperte OK em <b>Build</b> 7 vezes. Volte › Opções do desenvolvedor › ligue <b>Depuração USB</b> (e <b>Depuração ADB pela rede</b>, se houver). Na primeira conexão, a TV pergunta <b>"Permitir depuração USB?"</b>: marque <b>Sempre permitir</b>.</p></details>
    <div class="linha"><span class="espaco"></span><button class="bt" data-c>Cancelar</button><button class="bt pri" data-ok>Adicionar e ler a TV</button></div>
    <div class="mini" id="msg" style="margin-top:10px"></div>`, (j, fechar) => {
    $('[data-c]', j).onclick = fechar;
    $('[data-ok]', j).onclick = async () => {
      const ip = $('#ip', j).value.trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return toast('Informe o IP da TV (ex.: 192.168.0.43)');
      const msg = $('#msg', j);
      $('[data-ok]', j).disabled = true;
      try {
        let sond = null;
        if (NATIVO) {
          msg.textContent = 'Conectando à TV…';
          sond = await motor.lerTvNova(ip, 5555, () => { msg.innerHTML = '<b>Olhe a TV:</b> confirme "Permitir depuração USB?" marcando <b>Sempre permitir</b>.'; });
        }
        const tv = await api('POST', '/api/tvs', { nome: $('#nm', j).value.trim() || sond?.modelo || 'TV', local: $('#lc', j).value.trim(), ip, castId: pre.castId, serial: sond?.serial, sondagem: sond });
        fechar();
        await atualizar();
        location.hash = '#/tv/' + tv.id;
        await pedir(tvPorId(tv.id), 'Leitura inicial', [{ tipo: 'sondar' }, { tipo: 'inventario' }, { tipo: 'captura' }], { silencioso: true });
      } catch (e) { msg.innerHTML = `<span class="selo ruim">${esc(e.message)}</span>`; $('[data-ok]', j).disabled = false; }
    };
  });
}

// ---------- descobrir ----------
function telaDescobrir(el) {
  el.innerHTML = `<h1>Descobrir TVs</h1><p class="sub">${NATIVO ? 'Procura TVs e TV boxes na rede em que este aparelho está agora.' : 'A busca na rede é feita pelos apps do Calivix (Mac, Windows, iPhone, iPad e Android). Abaixo, o que eles encontraram.'}</p>
    ${NATIVO ? '<button class="bt grad" id="ir">' + I.radar + ' Procurar nesta rede</button><div class="progresso oculto" id="pg" style="margin-top:14px"><i></i></div>' : ''}
    <div id="res"></div>${sugestoesHtml() || '<p class="mini" style="margin-top:20px">Nenhuma sugestão guardada.</p>'}`;
  ligarSugestoes(el);
  if (!NATIVO) return;
  $('#ir').onclick = async () => {
    const pg = $('#pg'); pg.classList.remove('oculto');
    $('#ir').disabled = true;
    try {
      const r = await motor.descobrir((p) => { pg.firstChild.style.width = (p * 100) + '%'; });
      await api('POST', '/api/descobertas', { itens: r.itens, rede: r.rede.ssid || r.rede.ip });
      // TV cadastrada que mudou de endereço: o identificador Cast denuncia
      for (const i of r.itens) {
        const tv = E.tvs.find((t) => t.castId && t.castId === i.castId && t.ip !== i.ip);
        if (tv) { await api('PATCH', `/api/tvs/${tv.id}`, { ip: i.ip }); toast(`${tv.nome} mudou de endereço: agora ${i.ip}`); }
      }
      await atualizar();
      toast(r.itens.length ? `${r.itens.length} aparelho(s) encontrado(s)` : 'Nenhuma TV encontrada nesta rede');
    } catch (e) { toast(e.message); }
    finally { $('#ir') && ($('#ir').disabled = false); }
  };
}

// ---------- TV ----------
const ABAS = [['geral', 'Visão geral'], ['limpeza', 'Limpeza'], ['recursos', 'Recursos'], ['launcher', 'Tela inicial'], ['apps', 'Apps'], ['controle', 'Controle'], ['tarefas', 'Tarefas'], ['config', 'Ajustes da TV']];
function telaTv(el, tv, aba) {
  const pend = E.tarefas.filter((t) => t.tvId === tv.id && t.status === 'pendente').length;
  el.innerHTML = `<div class="linha" style="margin-bottom:6px"><a href="#/" class="bt peq">${I.volta} TVs</a></div>
    <div class="cabeca"><div><h1>${esc(tv.nome)}</h1><p class="sub" style="margin:0">${esc([tv.local, tv.sondagem && `${tv.sondagem.fabricante} ${tv.sondagem.modelo} (${tv.sondagem.plataforma})`, tv.ip].filter(Boolean).join(' · '))}</p></div>
    <span id="alc"></span></div>
    <div class="abas">${ABAS.map(([k, n]) => `<button class="aba ${k === aba ? 'ativa' : ''}" onclick="location.hash='#/tv/${tv.id}/${k}'">${n}${k === 'tarefas' && pend ? ` (${pend})` : ''}</button>`).join('')}</div>
    <div id="corpo"></div>`;
  if (NATIVO) estaAoAlcance(tv).then((ok) => { const a = $('#alc'); if (a) a.innerHTML = ok ? '<span class="selo ok">Nesta rede: alterações aplicadas na hora</span>' : '<span class="selo av">Fora desta rede: alterações ficam guardadas</span>'; });
  const c = $('#corpo');
  ({ geral: abaGeral, limpeza: abaLimpeza, recursos: abaRecursos, launcher: abaLauncher, apps: abaApps, controle: abaControle, tarefas: abaTarefas, config: abaConfig }[aba] || abaGeral)(c, tv);
}

function precisaLer(c, tv) {
  if (tv.inventario) return false;
  c.innerHTML = `<div class="cartao"><h3>A TV ainda não foi lida</h3><p class="sub">O Calivix precisa ler a lista de apps desta TV antes de sugerir ajustes.</p><button class="bt pri" id="ler">Ler a TV agora</button></div>`;
  $('#ler').onclick = () => pedir(tv, 'Leitura da TV', [{ tipo: 'sondar' }, { tipo: 'inventario' }, { tipo: 'captura' }]);
  return true;
}

function abaGeral(c, tv) {
  const s = tv.sondagem || {};
  const inv = tv.inventario;
  c.innerHTML = `<div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="cartao"><div class="tv"><div class="tela" style="${tv.temCaptura ? `background-image:url('${capturaUrl(tv)}')` : ''};cursor:default">${tv.temCaptura ? '' : I.tv}</div></div>
      <div class="linha"><span class="mini">Captura ${quando(tv.capturaEm)}</span><span class="espaco"></span><button class="bt peq" id="cap">${I.att} Nova captura</button></div></div>
    <div class="cartao"><h3>Sobre esta TV</h3>
      <div class="lista" style="margin-top:10px">${[['Modelo', `${s.fabricante || '—'} ${s.modelo || ''}`], ['Plataforma', s.plataforma], ['Android', s.android && `${s.android} (SDK ${s.sdk})`], ['Firmware', s.firmware], ['Rede', tv.rede], ['Endereço', tv.ip + (tv.tailnetIp ? ' · Tailnet ' + tv.tailnetIp : '')], ['Memória', s.ramMB && s.ramMB + ' MB'], ['Apps', inv && `${inv.pacotes.length} instalados · ${inv.desativados.length} desativados`], ['Tela inicial', inv?.home?.split('/')[0] && nomeAmigavel(inv.home.split('/')[0])]]
        .filter(([, v]) => v).map(([k, v]) => `<div class="item"><div class="txt"><div class="desc">${k}</div><div class="tit">${esc(v)}</div></div></div>`).join('')}</div>
      <div class="linha" style="margin-top:14px"><button class="bt" id="ler">${I.att} Ler a TV de novo</button><button class="bt" id="conf">Conferir após atualização</button></div></div></div>
    ${s.adbSeguro === '0' ? '<div class="faixa" style="margin-top:14px">Esta TV aceita ADB pela rede sem pedir permissão. Desligue a depuração quando não estiver usando.</div>' : ''}`;
  $('#cap').onclick = () => pedir(tv, 'Captura de tela', [{ tipo: 'captura' }], { silencioso: true });
  $('#ler').onclick = () => pedir(tv, 'Leitura da TV', [{ tipo: 'sondar' }, { tipo: 'inventario' }, { tipo: 'captura' }]);
  $('#conf').onclick = () => pedir(tv, 'Conferir o que o firmware religou', [{ tipo: 'conferir', params: { esperados: tv.perfil?.desativados || [] } }]);
}

function abaLimpeza(c, tv) {
  if (precisaLer(c, tv)) return;
  if (!catalogo) { c.innerHTML = '<p class="sub">Carregando as listas testadas…</p>'; carregarCatalogo().then((x) => { catalogo = x; abaLimpeza(c, tv); }); return; }
  const sug = sugerirListas(catalogo, tv.sondagem);
  const escolhida = catalogo.itens.find((i) => i.id === tv.lista) || sug[0];
  const inv = tv.inventario;
  const inst = new Set(inv.pacotes), desat = new Set(inv.desativados);
  const manter = new Set(tv.perfil?.manter || []);
  const pacotes = escolhida ? escolhida.pacotes.filter((p) => inst.has(p.p)) : [];
  const grupos = [];
  for (const p of pacotes) { let g = grupos.find((x) => x.n === p.g); if (!g) grupos.push(g = { n: p.g, itens: [] }); g.itens.push(p); }
  const grupoPt = (n) => [[/telemetry|analytics/i, 'Telemetria e análise'], [/content|ads|promo|recommend/i, 'Conteúdo, anúncios e promoções'], [/background/i, 'Serviços em segundo plano'],
    [/preload|bloat|bundled/i, 'Apps pré-instalados'], [/by choice|optional/i, 'Desligados por escolha'], [/home|launcher|setup/i, 'Tela inicial e configuração'], [/voice|assistant/i, 'Voz e assistente']]
    .find(([r]) => r.test(n || ''))?.[1] || n || 'Pacotes';
  c.innerHTML = `<div class="cartao" style="margin-bottom:14px"><div class="linha"><div class="txt" style="flex:1;min-width:220px"><h3>Lista testada</h3>
      <div class="mini">${escolhida ? `${esc(escolhida.titulo)} · ${escolhida.pacotes.length} pacotes (${pacotes.length} existem nesta TV)` : 'Nenhuma lista testada combina com esta TV. O Claude pode montar uma (área Claude).'}</div></div>
      <select class="ent" id="lst" style="max-width:320px">${(sug.length ? sug : []).map((i) => `<option value="${i.id}" ${i.id === escolhida?.id ? 'selected' : ''}>${esc(i.titulo.slice(0, 60))}</option>`).join('')}
      <option value="">Outra lista…</option></select></div>
      <p class="mini" style="margin:10px 0 0">Nada é desinstalado: os apps são <b>desativados</b> e podem voltar a qualquer momento (aba Recursos, Apps ou "Restaurar tudo"). O Calivix aplica as mesmas travas do CleanYourTV: nunca toca no núcleo do Android, nas entradas HDMI nem nas Configurações.</p></div>
    ${pacotes.length ? `<div class="linha" style="margin-bottom:10px"><button class="bt peq" id="todos">Marcar todos</button><button class="bt peq" id="nenhum">Desmarcar</button><span class="espaco"></span><span class="mini" id="cont"></span></div>
    <div class="lista">${grupos.map((g) => `<div class="grupo">${esc(grupoPt(g.n))}</div>${g.itens.map((p) => {
      const ja = desat.has(p.p);
      return `<label class="item"><input type="checkbox" class="caixa" data-p="${esc(p.p)}" ${ja ? 'checked disabled' : manter.has(p.p) ? '' : 'checked'}><div class="txt"><div class="tit">${esc(nomeAmigavel(p.p))} ${ja ? '<span class="selo ok">desativado</span>' : manter.has(p.p) ? '<span class="selo">você mantém</span>' : ''}</div><div class="desc">${esc(p.p)}${p.c ? ' — ' + esc(p.c) : ''}</div></div></label>`;
    }).join('')}`).join('')}</div>
    <div class="linha" style="margin-top:16px"><span class="espaco"></span><button class="bt grad" id="aplicar">Desativar selecionados</button></div>` : ''}`;
  $('#lst').onchange = async (e) => {
    let v = e.target.value;
    if (!v) {
      const q = prompt('Procure uma lista pelo modelo, marca ou plataforma (ex.: "tcl g10", "xiaomi"):'); if (!q) return abaLimpeza(c, tv);
      const achou = catalogo.itens.filter((i) => (i.id + ' ' + i.titulo).toLowerCase().includes(q.toLowerCase()));
      if (!achou.length) { toast('Nenhuma lista encontrada'); return abaLimpeza(c, tv); }
      v = achou[0].id; toast('Lista: ' + achou[0].titulo);
    }
    await api('PATCH', `/api/tvs/${tv.id}`, { lista: v }); atualizar();
  };
  if (!pacotes.length) return;
  const caixas = [...c.querySelectorAll('[data-p]:not(:disabled)')];
  const cont = () => { $('#cont').textContent = `${caixas.filter((x) => x.checked).length} de ${caixas.length} selecionados`; };
  caixas.forEach((x) => { x.onchange = cont; }); cont();
  $('#todos').onclick = () => { caixas.forEach((x) => { x.checked = true; }); cont(); };
  $('#nenhum').onclick = () => { caixas.forEach((x) => { x.checked = false; }); cont(); };
  $('#aplicar').onclick = async () => {
    const sel = caixas.filter((x) => x.checked).map((x) => x.dataset.p);
    const nao = caixas.filter((x) => !x.checked).map((x) => x.dataset.p);
    if (!sel.length) return toast('Nada selecionado');
    await api('PATCH', `/api/tvs/${tv.id}`, { lista: escolhida.id, perfil: { manter: [...new Set([...(tv.perfil?.manter || []).filter((p) => !sel.includes(p)), ...nao])] } });
    if (!await confirmar('Desativar ' + sel.length + ' apps?', 'Antes de mudar qualquer coisa, o Calivix guarda o estado atual da TV no seu servidor para poder desfazer tudo depois.', 'Desativar')) return;
    pedir(tv, `Limpeza: ${sel.length} apps (${escolhida.id})`, [{ tipo: 'desativar', params: { pacotes: sel } }, { tipo: 'captura' }]);
  };
}

function abaRecursos(c, tv) {
  if (precisaLer(c, tv)) return;
  const inv = tv.inventario, inst = new Set(inv.pacotes), desat = new Set(inv.desativados);
  const rec = RECURSOS.filter((r) => r.pacotes.some((p) => inst.has(p)));
  c.innerHTML = `<p class="sub">Recursos que ficam instalados e podem ser ligados quando precisar.</p><div class="lista">${rec.map((r) => {
    const ligado = !r.pacotes.filter((p) => inst.has(p)).every((p) => desat.has(p));
    return `<div class="item"><div class="txt"><div class="tit">${esc(r.nome)}</div><div class="desc">${esc(r.desc)}</div></div><label class="inter"><input type="checkbox" data-r="${r.id}" ${ligado ? 'checked' : ''}><span></span></label></div>`;
  }).join('')}</div>`;
  c.querySelectorAll('[data-r]').forEach((x) => {
    x.onchange = () => {
      const r = RECURSOS.find((y) => y.id === x.dataset.r);
      const ps = r.pacotes.filter((p) => inst.has(p));
      pedir(tv, `${x.checked ? 'Ligar' : 'Desligar'}: ${r.nome}`, [{ tipo: x.checked ? 'ativar' : 'desativar', params: { pacotes: ps } }]);
    };
  });
}

function appsDisponiveis(tv) {
  const inv = tv.inventario || { terceiros: [], pacotes: [] };
  const fixos = ['com.google.android.youtube.tv', 'com.netflix.ninja', 'com.amazon.amazonvideo.livingroom', 'com.disney.disneyplus', 'com.globo.globotv', 'com.spotify.tv.android', 'com.android.vending', 'com.google.android.youtube.tvmusic', 'com.tcl.tv'];
  return [...new Set([...inv.terceiros, ...fixos.filter((p) => inv.pacotes.includes(p))])].filter((p) => !inv.desativados.includes(p) && p !== LAUNCHER);
}

function abaLauncher(c, tv) {
  if (precisaLer(c, tv)) return;
  const inv = tv.inventario;
  const instalado = inv.home?.startsWith(LAUNCHER + '/');
  const cfg = tv.perfil?.launcher?.config || { dock_apps: appsDisponiveis(tv).slice(0, 4), hidden_apps: inv.pacotes.includes('com.tcl.tv') ? ['com.tcl.tv', 'com.tcl.suspension'] : [], columns: 4, rows_below_dock: 0, ...(inv.pacotes.includes('com.tcl.tv') ? { live_tv_package: 'com.tcl.tv' } : {}) };
  let dock = [...(cfg.dock_apps || [])];
  const desenhar = () => {
    const disp = appsDisponiveis(tv).filter((p) => !dock.includes(p));
    c.innerHTML = `<div class="cartao" style="margin-bottom:14px"><div class="linha"><div style="flex:1;min-width:220px"><h3>${instalado ? 'Launcher limpo ativo' : 'Tela inicial sem anúncios'}</h3>
      <div class="mini">${instalado ? 'A tela inicial desta TV é o launcher limpo, estilo Apple TV.' : `Hoje a tela inicial é: ${esc(nomeAmigavel((inv.home || '').split('/')[0]))}. O launcher limpo do CleanYourTV troca a tela cheia de anúncios por um dock com seus apps, relógio e entradas HDMI.`}</div></div>
      ${instalado ? '<span class="selo ok">Ativo</span>' : ''}</div></div>
      <h2>Dock (apps em destaque, da esquerda para a direita)</h2>
      <div class="dock">${dock.map((p, i) => `<span class="chip"><button data-esq="${i}" aria-label="mover para a esquerda">‹</button>${esc(nomeAmigavel(p))}<button data-dir="${i}" aria-label="mover para a direita">›</button><button data-tira="${i}" aria-label="tirar">✕</button></span>`).join('') || '<span class="mini">vazio</span>'}</div>
      <div class="linha" style="margin-top:12px"><select class="ent" id="ad" style="max-width:300px"><option value="">Adicionar app ao dock…</option>${disp.map((p) => `<option value="${esc(p)}">${esc(nomeAmigavel(p))}</option>`).join('')}</select>
      <label class="mini">Colunas <select class="ent" id="col" style="width:90px;display:inline-block">${[4, 5, 6, 7].map((n) => `<option ${n === (cfg.columns || 4) ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <div class="linha" style="margin-top:18px"><span class="espaco"></span>
      ${instalado ? '<button class="bt pri" id="salvar">Salvar dock na TV</button>' : '<button class="bt grad" id="instalar">Instalar launcher limpo</button>'}</div>
      ${instalado ? '' : `<p class="mini" style="margin-top:14px">O Calivix guarda o estado atual antes, desativa a tela do Google TV só depois de o launcher abrir, e devolve a original se a TV não aceitar. ${inv.pacotes.includes(SETUP) && !inv.desativados.includes(SETUP) ? 'Dica: faça a <b>Limpeza</b> primeiro (ela desativa o assistente de configuração, que em Google TV disputa a tela inicial).' : ''}</p>`}`;
    c.querySelectorAll('[data-esq]').forEach((b) => { b.onclick = () => { const i = +b.dataset.esq; if (i > 0) [dock[i - 1], dock[i]] = [dock[i], dock[i - 1]]; desenhar(); }; });
    c.querySelectorAll('[data-dir]').forEach((b) => { b.onclick = () => { const i = +b.dataset.dir; if (i < dock.length - 1) [dock[i + 1], dock[i]] = [dock[i], dock[i + 1]]; desenhar(); }; });
    c.querySelectorAll('[data-tira]').forEach((b) => { b.onclick = () => { dock.splice(+b.dataset.tira, 1); desenhar(); }; });
    $('#ad').onchange = (e) => { if (e.target.value && dock.length < 7) dock.push(e.target.value); else if (dock.length >= 7) toast('O dock aceita até 7 apps'); desenhar(); };
    $('#col').onchange = (e) => { cfg.columns = Number(e.target.value); };
    const novaCfg = () => ({ ...cfg, dock_apps: dock, columns: cfg.columns || 4 });
    const salvarPerfil = () => api('PATCH', `/api/tvs/${tv.id}`, { perfil: { launcher: { ...(tv.perfil?.launcher || {}), config: novaCfg() } } });
    $('#salvar') && ($('#salvar').onclick = async () => { await salvarPerfil(); pedir(tv, 'Dock do launcher', [{ tipo: 'config_launcher', params: { config: novaCfg() } }, { tipo: 'captura' }]); });
    $('#instalar') && ($('#instalar').onclick = async () => {
      if (!await confirmar('Instalar o launcher limpo?', 'A tela inicial do Google TV será desativada (não desinstalada) e o launcher limpo vira a tela inicial. Os botões Netflix/Prime/YouTube do controle deixam de abrir os apps. Dá para desfazer em Ajustes da TV › Restaurar tudo.', 'Instalar')) return;
      await salvarPerfil();
      pedir(tv, 'Instalar launcher limpo', [{ tipo: 'instalar_launcher', params: { config: novaCfg() } }, { tipo: 'captura' }]);
    });
  };
  desenhar();
}

function abaApps(c, tv) {
  if (precisaLer(c, tv)) return;
  const inv = tv.inventario, desat = new Set(inv.desativados), terc = new Set(inv.terceiros);
  let filtro = '', mostrarSistema = false;
  const desenhar = () => {
    const lista = inv.pacotes.filter((p) => (mostrarSistema || terc.has(p) || desat.has(p)) && (!filtro || (p + ' ' + nomeAmigavel(p)).toLowerCase().includes(filtro)));
    $('#lapps').innerHTML = lista.map((p) => {
      const nucleo = NUCLEO_RE.test(p) && !NUCLEO_OK.test(p);
      return `<div class="item"><div class="txt"><div class="tit">${esc(nomeAmigavel(p))} ${terc.has(p) ? '' : '<span class="selo">sistema</span>'}</div><div class="desc">${esc(p)}</div></div>
        ${!desat.has(p) && terc.has(p) ? `<button class="bt peq" data-abrir="${esc(p)}">Abrir</button>` : ''}
        <label class="inter" title="${nucleo ? 'Núcleo do Android: protegido' : ''}"><input type="checkbox" data-app="${esc(p)}" ${desat.has(p) ? '' : 'checked'} ${nucleo ? 'disabled' : ''}><span></span></label></div>`;
    }).join('') || '<div class="item mini">Nada encontrado</div>';
    c.querySelectorAll('[data-app]').forEach((x) => { x.onchange = () => pedir(tv, `${x.checked ? 'Ativar' : 'Desativar'} ${nomeAmigavel(x.dataset.app)}`, [{ tipo: x.checked ? 'ativar' : 'desativar', params: { pacotes: [x.dataset.app] } }]); });
    c.querySelectorAll('[data-abrir]').forEach((b) => { b.onclick = () => pedir(tv, `Abrir ${nomeAmigavel(b.dataset.abrir)}`, [{ tipo: 'abrir_app', params: { pacote: b.dataset.abrir } }], { silencioso: true }); });
  };
  c.innerHTML = `<div class="linha" style="margin-bottom:12px"><input class="ent" id="busca" placeholder="Procurar app…" style="max-width:320px"><label class="linha mini"><input type="checkbox" class="caixa" id="sis"> Mostrar apps do sistema</label><span class="espaco"></span><label class="bt peq">Instalar APK…<input type="file" accept=".apk" id="apk" hidden></label></div><div class="lista" id="lapps"></div>`;
  $('#busca').oninput = (e) => { filtro = e.target.value.toLowerCase(); desenhar(); };
  $('#sis').onchange = (e) => { mostrarSistema = e.target.checked; desenhar(); };
  $('#apk').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    toast('Enviando ' + f.name + '…');
    const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    const { arquivo } = await api('POST', '/api/arquivos', { nome: f.name, base64: btoa(s) });
    pedir(tv, 'Instalar ' + f.name, [{ tipo: 'instalar_apk', params: { arquivo } }]);
  };
  desenhar();
}

function abaControle(c, tv) {
  const t = (k) => pedir(tv, 'Tecla ' + k, [{ tipo: 'tecla', params: { tecla: k } }, { tipo: 'captura' }], { silencioso: true });
  c.innerHTML = `<div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="cartao"><div class="tv"><div class="tela" style="${tv.temCaptura ? `background-image:url('${capturaUrl(tv)}')` : ''};cursor:default">${tv.temCaptura ? '' : I.tv}</div></div><div class="mini">A tela é atualizada depois de cada toque. ${NATIVO ? '' : 'Pelo navegador, o servidor precisa alcançar a TV.'}</div></div>
    <div class="cartao"><div class="controle"><span></span><button class="bt" data-k="UP">${I.cima}</button><span></span>
      <button class="bt" data-k="LEFT">${I.esq}</button><button class="bt ok" data-k="OK">OK</button><button class="bt" data-k="RIGHT">${I.dir}</button>
      <span></span><button class="bt" data-k="DOWN">${I.baixo}</button><span></span>
      <button class="bt" data-k="BACK">${I.volta}</button><button class="bt" data-k="HOME">${I.casa}</button><button class="bt" data-k="SETTINGS">${I.engr}</button>
      <button class="bt" data-k="VOL_DOWN">−</button><button class="bt" data-k="MUTE">🔇</button><button class="bt" data-k="VOL_UP">+</button></div></div></div>`;
  c.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => t(b.dataset.k); });
}

function abaTarefas(c, tv) {
  const ts = E.tarefas.filter((t) => t.tvId === tv.id).slice().reverse();
  c.innerHTML = ts.length ? `<div class="lista">${ts.map((t) => {
    const [cls, nome] = STATUS[t.status] || ['', t.status];
    return `<details class="item" style="display:block"><summary class="linha" style="cursor:pointer"><div class="txt"><div class="tit">${esc(t.titulo)}</div>
      <div class="desc">${esc(nomeAparelho(t.criadaPor))} · ${quando(t.criadaEm)}${t.assumidaPor ? ' · executada por ' + esc(nomeAparelho(t.assumidaPor)) : ''}${t.resumo ? ' · ' + esc(t.resumo) : ''}${t.erro ? ' · ' + esc(t.erro) : ''}</div></div><span class="selo ${cls}">${nome}</span></summary>
      <div class="log" style="margin-top:10px" data-log="${t.id}">${esc(t.log.map((l) => l.l).join('\n'))}</div>
      ${t.status === 'pendente' ? `<div class="linha" style="margin-top:10px">${NATIVO ? `<button class="bt peq pri" data-aqui="${t.id}">Executar deste aparelho</button>` : ''}<button class="bt peq" data-srv="${t.id}">Tentar pelo servidor</button><button class="bt peq perigo" data-canc="${t.id}">Cancelar</button></div>` : ''}</details>`;
  }).join('')}</div>` : '<p class="sub">Nenhuma tarefa ainda.</p>';
  c.querySelectorAll('[data-aqui]').forEach((b) => { b.onclick = async () => { if (!await estaAoAlcance(tv, true)) return toast('A TV não está ao alcance deste aparelho agora'); executarComJanela(E.tarefas.find((t) => t.id === b.dataset.aqui), tv); }; });
  c.querySelectorAll('[data-srv]').forEach((b) => { b.onclick = async () => { const r = await api('POST', `/api/tarefas/${b.dataset.srv}/servidor`); toast(r.ok ? 'Executada pelo servidor' : 'O servidor não alcança esta TV agora'); atualizar(); }; });
  c.querySelectorAll('[data-canc]').forEach((b) => { b.onclick = async () => { await api('POST', `/api/tarefas/${b.dataset.canc}/cancelar`); atualizar(); }; });
}

function abaConfig(c, tv) {
  c.innerHTML = `<div class="cartao" style="max-width:640px"><div class="campo"><label>Nome</label><input class="ent" id="nm" value="${esc(tv.nome)}"></div>
    <div class="campo"><label>Local</label><input class="ent" id="lc" value="${esc(tv.local || '')}" placeholder="Casa, Sala, Casa da praia…"></div>
    <div class="campo"><label>Endereço na rede da TV</label><input class="ent" id="ip" value="${esc(tv.ip || '')}"></div>
    <div class="campo"><label>Endereço na Tailnet (opcional, se a TV tiver o app Tailscale)</label><input class="ent" id="ts" value="${esc(tv.tailnetIp || '')}" placeholder="100.x.y.z"></div>
    <div class="linha"><span class="espaco"></span><button class="bt pri" id="salvar">Salvar</button></div></div>
    <h2>Desfazer</h2><div class="cartao" style="max-width:640px"><p class="sub">${tv.registro ? `Estado anterior guardado em ${new Date(tv.registro.criadoEm).toLocaleString('pt-BR')} (${tv.registro.pacotes} pacotes).` : 'Ainda não há estado anterior guardado (nada foi alterado pelo Calivix).'}</p>
    <button class="bt perigo" id="rest" ${tv.registro ? '' : 'disabled'}>Restaurar tudo como estava</button></div>
    <h2>Remover</h2><div class="cartao" style="max-width:640px"><p class="sub">Tira a TV do Calivix. Nada muda na TV.</p><button class="bt perigo" id="rem">Remover esta TV</button></div>`;
  $('#salvar').onclick = async () => { await api('PATCH', `/api/tvs/${tv.id}`, { nome: $('#nm').value, local: $('#lc').value, ip: $('#ip').value.trim(), tailnetIp: $('#ts').value.trim() }); toast('Salvo'); atualizar(); };
  $('#rest').onclick = async () => { if (await confirmar('Restaurar tudo?', 'Reativa tudo o que estava ativado antes do Calivix e devolve a tela inicial original.', 'Restaurar', true)) pedir(tv, 'Restaurar tudo', [{ tipo: 'restaurar' }, { tipo: 'captura' }]); };
  $('#rem').onclick = async () => { if (await confirmar('Remover ' + tv.nome + '?', 'O perfil, as tarefas pendentes e a captura serão apagados do servidor. A TV não é alterada.', 'Remover', true)) { await api('DELETE', `/api/tvs/${tv.id}`); location.hash = '#/'; atualizar(); } };
}

// ---------- Claude ----------
function telaClaude(el) {
  const peds = E.pedidos.slice().reverse();
  const Rec = !window.CalivixNativo?.semVozWeb && (window.SpeechRecognition || window.webkitSpeechRecognition);
  el.innerHTML = `<h1>Pedir ao Claude</h1><p class="sub">Fale ou escreva o que quer na TV — um ajuste, uma dúvida ou até um app novo. O pedido vai para o seu servidor e o Claude, conectado ao Calivix, executa e responde aqui.</p>
    <div class="cartao"><button class="mic" id="mic" aria-label="Falar">${I.mic}</button>
      <div class="campo"><label>Para qual TV?</label><select class="ent" id="tvp"><option value="">Qualquer / nenhuma</option>${E.tvs.map((t) => `<option value="${t.id}">${esc(t.nome)}</option>`).join('')}</select></div>
      <div class="campo"><label>Pedido</label><textarea class="ent" id="txt" placeholder="Ex.: desliga o Chromecast da TV da Sala e coloca a Globoplay no primeiro lugar do dock"></textarea>
      <span class="mini">${Rec ? 'Toque no microfone e fale.' : plataforma === 'mac' ? 'Dica: aperte duas vezes a tecla Fn (🌐) para ditar.' : plataforma === 'windows' ? 'Dica: Windows + H abre o ditado.' : 'Dica: use o microfone do teclado para ditar.'}</span></div>
      <div class="linha">${['Deixe a TV da Sala mais rápida', 'Crie um app de relógio para a TV', 'O que dá para desativar ainda?'].map((s) => `<button class="bt peq" data-ex="${esc(s)}">${esc(s)}</button>`).join('')}<span class="espaco"></span><button class="bt grad" id="env">${I.enviar} Enviar</button></div></div>
    <h2>Pedidos</h2><div class="lista">${peds.map((p) => `<div class="item"><div class="txt pedido ${p.status}"><div class="tit">${esc(p.texto)}</div>
      <div class="desc">${esc([p.tvId && tvPorId(p.tvId)?.nome, nomeAparelho(p.origem), quando(p.criadoEm)].filter(Boolean).join(' · '))} · <b>${{ novo: 'aguardando o Claude', em_andamento: 'o Claude está trabalhando', feito: 'feito', recusado: 'não feito' }[p.status] || p.status}</b></div>
      ${p.resposta ? `<div class="resposta">${esc(p.resposta)}</div>` : ''}</div><button class="bt peq" data-del="${p.id}" aria-label="Apagar">✕</button></div>`).join('') || '<div class="item mini">Nenhum pedido ainda.</div>'}</div>
    <h2>Conectar o Claude</h2><div class="cartao" id="cc"><p class="mini">Carregando…</p></div>`;
  if (Rec) {
    let r = null;
    $('#mic').onclick = () => {
      if (r) { r.stop(); return; }
      r = new Rec(); r.lang = 'pt-BR'; r.interimResults = true; r.continuous = false;
      const base = $('#txt').value ? $('#txt').value + ' ' : '';
      r.onresult = (e) => { $('#txt').value = base + [...e.results].map((x) => x[0].transcript).join(''); };
      r.onend = () => { $('#mic').classList.remove('ouvindo'); r = null; };
      r.onerror = (e) => toast('Microfone: ' + (e.error === 'not-allowed' ? 'permissão negada' : e.error));
      $('#mic').classList.add('ouvindo'); r.start();
    };
  } else $('#mic').onclick = () => { $('#txt').focus(); toast('Use o microfone do teclado para ditar'); };
  el.querySelectorAll('[data-ex]').forEach((b) => { b.onclick = () => { $('#txt').value = b.dataset.ex; }; });
  $('#env').onclick = async () => {
    const texto = $('#txt').value.trim(); if (!texto) return toast('Escreva ou fale o pedido');
    await api('POST', '/api/pedidos', { texto, tvId: $('#tvp').value || null });
    toast('Pedido enviado ao Claude'); atualizar();
  };
  el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await api('DELETE', '/api/pedidos/' + b.dataset.del); atualizar(); }; });
  api('GET', '/api/claude').then(({ token }) => {
    const url = (sessao.servidor || location.origin) + '/mcp';
    $('#cc').innerHTML = `<p class="sub">No Claude Code (Mac), rode uma vez este comando. Depois, numa conversa, diga <b>"atenda os pedidos do Calivix"</b> — ou deixe um <b>/loop</b> verificando os pedidos novos.</p>
      <code class="bloco">claude mcp add --transport http calivix ${esc(url)} --header "Authorization: Bearer ${esc(token)}"</code>
      <div class="linha" style="margin-top:10px"><button class="bt peq" id="cp">Copiar</button><button class="bt peq perigo" id="nt">Gerar token novo</button></div>`;
    $('#cp').onclick = () => { navigator.clipboard?.writeText($('#cc code').textContent).then(() => toast('Copiado')); };
    $('#nt').onclick = async () => { if (await confirmar('Gerar token novo?', 'O comando antigo deixa de funcionar e o Claude precisa ser conectado de novo.', 'Gerar', true)) { await api('POST', '/api/claude/novo-token'); telaClaude(el); } };
  }).catch(() => {});
}

// ---------- ajustes ----------
function telaAjustes(el) {
  const ap = E.aparelhos[E.aparelho] || {};
  el.innerHTML = `<h1>Ajustes</h1><p class="sub">Calivix ${esc(E.versao)}.</p>
    <div class="cartao" style="max-width:640px"><div class="campo"><label>Nome deste aparelho</label><input class="ent" id="nm" value="${esc(ap.nome || '')}"></div>
    ${NATIVO ? `<div class="campo"><label>Servidor</label><input class="ent" value="${esc(sessao.servidor)}" disabled></div>` : ''}
    <div class="linha"><span class="espaco"></span>${NATIVO ? '<button class="bt" id="trocar">Trocar de servidor</button>' : ''}<button class="bt pri" id="salvar">Salvar</button></div></div>
    <h2>Seus aparelhos</h2><div class="lista" style="max-width:640px">${Object.values(E.aparelhos).sort((a, b) => (b.visto || '').localeCompare(a.visto || '')).map((a) => `<div class="item"><div class="txt"><div class="tit">${esc(a.nome)} ${a.id === E.aparelho ? '<span class="selo info">este</span>' : ''}</div><div class="desc">${esc(a.plataforma)} · visto ${quando(a.visto)}</div></div></div>`).join('')}</div>
    <h2>Como as alterações chegam às TVs</h2><div class="cartao" style="max-width:640px"><p class="mini" style="margin:0">Toda alteração vira uma <b>tarefa</b> guardada no servidor. Ela é aplicada por quem alcançar a TV primeiro: o <b>servidor</b>, se a TV estiver na rede de casa ou na Tailnet; ou um <b>aparelho seu</b> (celular, iPad, Mac, PC) quando estiver no mesmo Wi-Fi da TV — o app avisa e pede para aplicar. Antes de mexer, o aparelho confere o número de série da TV, para nunca aplicar na TV errada de outra rede.</p></div>
    <div class="linha" style="margin-top:20px;max-width:640px"><span class="espaco"></span><button class="bt perigo" id="sair">Sair deste aparelho</button></div>`;
  $('#salvar').onclick = async () => { await api('PATCH', `/api/aparelhos/${E.aparelho}`, { nome: $('#nm').value }); toast('Salvo'); atualizar(); };
  $('#trocar') && ($('#trocar').onclick = () => { sessao.token = null; sessao.servidor = ''; location.reload(); });
  $('#sair').onclick = async () => { await api('POST', '/api/sair').catch(() => {}); sessao.token = null; location.reload(); };
}

iniciar();
