// Operações na TV: o que tools/disable.sh, restore.sh, recovery.py, check.py, theme.sh e
// launcher/build-and-install.sh fazem no repositório CleanYourTV, portado para JavaScript com as
// MESMAS travas de segurança (pacotes do núcleo, rede Wi-Fi do setupwraith, dono da tela inicial,
// drivers das entradas HDMI, quem abre Entradas e Configurações, leitura de volta).
//
// Cada operação recebe uma sessão Adb já conectada e um "log" (função que recebe uma linha).

export const PACOTE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
export const NUCLEO_RE = /^(android|android\.ext\.(services|shared)|com\.android\.sdksandbox|com\.android\.location\.fused|com\.android\.systemui|com\.android\.shell|com\.android\.phone|com\.android\.settings|com\.android\.tv\.settings|com\.(google\.)?android\.(permissioncontroller|packageinstaller|ext\.services|ext\.shared|modulemetadata)|com\.google\.android\.overlay\.modules.*|com\.android\.providers\..*|com\.cltv\.mal|com\.mediatek\.(tis|tv\.service|tv\.agent))$/;
export const NUCLEO_OK = /^com\.android\.providers\.(calendar|contacts|userdictionary|blockednumber)$/;
export const SETUP = 'com.google.android.tungsten.setupwraith';
export const LAUNCHER = 'com.gathin.tvhome';
export const LAUNCHERS_DE_FABRICA = ['com.google.android.tvlauncher', 'com.google.android.apps.tv.launcherx', 'com.google.android.leanbacklauncher', 'com.mitv.tvhome'];
const NAO_LAUNCHERS = new Set([SETUP, 'com.android.tv.settings', 'com.android.settings', 'com.android.provision']);
const Q_HOME = 'cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME';
const Q_CLAIMS = 'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME';

// Recursos que o usuário liga e desliga por um interruptor, em vez de procurar o pacote.
export const RECURSOS = [
  { id: 'chromecast', nome: 'Chromecast integrado', desc: 'Transmitir do celular para a TV (YouTube, Spotify Connect…)', pacotes: ['com.google.android.apps.mediashell'] },
  { id: 'controle', nome: 'Controle pelo celular e microfone do controle', desc: 'App Google TV no celular; também leva a voz do controle remoto físico', pacotes: ['com.google.android.tv.remote.service'] },
  { id: 'midia_usb', nome: 'Player de mídia USB', desc: 'Fotos e vídeos de pendrive', pacotes: ['com.tcl.ui_mediaCenter'] },
  { id: 'alexa', nome: 'Alexa', desc: 'Cliente Alexa da TCL', pacotes: ['com.tcl.smartalexa'] },
  { id: 'assistente', nome: 'Google Assistente', desc: 'Busca por voz do Google', pacotes: ['com.google.android.katniss'] },
  { id: 'miracast', nome: 'Espelhamento (Miracast)', desc: 'Espelhar a tela de um celular Android', pacotes: ['com.tcl.miracast'] },
  { id: 'jogos', nome: 'Barra de jogos', desc: 'Sobreposição do modo jogo para consoles', pacotes: ['com.tcl.gamebar'] },
  { id: 'protetor', nome: 'Protetor de tela Ambiente (Google)', desc: 'O launcher limpo traz um relógio no lugar', pacotes: ['com.google.android.apps.tv.dreamx'] },
];

export const pacotesDoTexto = (t) => [...String(t).matchAll(/^package:(\S+?)(?:=\S+)?$/gm)].map((m) => m[1].replace(/^.*\.apk=/, ''));
const limpar = (t) => String(t).replace(/\r/g, '');

// Lê uma lista no formato do repositório (um pacote por linha, # comentários).
export function lerLista(texto) {
  const pacotes = [], ruins = [];
  for (let linha of limpar(texto).replace(/^﻿/, '').split('\n')) {
    linha = linha.replace(/\s+#.*$/, '').trim();
    if (!linha || linha.startsWith('#')) continue;
    const p = linha.split(/\s+/)[0];
    (PACOTE_RE.test(p) ? pacotes : ruins).push(p);
  }
  return { pacotes: [...new Set(pacotes)], ruins };
}

export async function sondar(adb) {
  const props = ['ro.product.model', 'ro.product.manufacturer', 'ro.product.brand', 'ro.product.device', 'ro.product.name', 'ro.build.version.release',
    'ro.build.version.sdk', 'ro.build.display.id', 'ro.serialno', 'ro.adb.secure', 'persist.sys.locale', 'ro.product.cpu.abi'];
  const saida = limpar(await adb.shell(props.map((p) => `echo "${p}=$(getprop ${p})"`).join('; ')));
  const v = {};
  for (const l of saida.split('\n')) { const i = l.indexOf('='); if (i > 0) v[l.slice(0, i)] = l.slice(i + 1).trim(); }
  const extra = limpar(await adb.shell("wm size | tail -n 1; cat /proc/meminfo | head -n 1; dumpsys wifi | grep -m1 -o 'mWifiInfo SSID: [^,]*'; ip -o -4 addr show wlan0 eth0 2>/dev/null | head -n 2; cat /sys/class/net/wlan0/address 2>/dev/null"));
  const ssid = (extra.match(/SSID: "?([^",]*)"?/) || [])[1] || '';
  const ram = Number((extra.match(/MemTotal:\s+(\d+)/) || [])[1] || 0);
  const mac = (extra.match(/^([0-9a-f]{2}(:[0-9a-f]{2}){5})$/m) || [])[1] || '';
  const tela = (extra.match(/size: (\d+x\d+)/) || [])[1] || '';
  return {
    modelo: v['ro.product.model'], fabricante: v['ro.product.manufacturer'], marca: v['ro.product.brand'], plataforma: v['ro.product.device'],
    produto: v['ro.product.name'], android: v['ro.build.version.release'], sdk: Number(v['ro.build.version.sdk'] || 0), firmware: v['ro.build.display.id'],
    serial: v['ro.serialno'], adbSeguro: v['ro.adb.secure'], idioma: v['persist.sys.locale'], abi: v['ro.product.cpu.abi'],
    rede: ssid, ramMB: Math.round(ram / 1024), mac, tela,
  };
}

export async function inventario(adb) {
  const [todos, desativados, terceiros, home] = await Promise.all([
    adb.shell('pm list packages --user 0'), adb.shell('pm list packages -d --user 0'), adb.shell('pm list packages -3 --user 0'), adb.shell(Q_HOME),
  ]);
  return {
    pacotes: pacotesDoTexto(todos).sort(), desativados: pacotesDoTexto(desativados).sort(), terceiros: pacotesDoTexto(terceiros).sort(),
    home: limpar(home).trim().split('\n').pop() || '', em: new Date().toISOString(),
  };
}

// Nomes legíveis dos apps (rótulos) — pede ao sistema via dumpsys quando possível; senão, deriva do pacote.
export function nomeAmigavel(p) {
  const conhecidos = {
    'com.google.android.youtube.tv': 'YouTube', 'com.netflix.ninja': 'Netflix', 'com.amazon.amazonvideo.livingroom': 'Prime Video',
    'com.globo.globotv': 'Globoplay', 'com.disney.disneyplus': 'Disney+', 'com.wbd.stream': 'Max', 'com.spotify.tv.android': 'Spotify',
    'com.apple.atve.androidtv.appletv': 'Apple TV', 'org.jellyfin.androidtv': 'Jellyfin', 'com.cbs.ca': 'Paramount+', 'com.mercadolibre.android.mplay_tv': 'Mercado Play',
    'com.brasilparalelo.athena': 'Brasil Paralelo', 'com.tvwebbrowser.v22': 'TV Web Browser', 'io.github.visnkmr.wirelessexplorer': 'Wireless Explorer',
    'com.google.android.youtube.tvmusic': 'YouTube Music', 'com.google.android.videos': 'Google TV (loja)', 'com.android.vending': 'Play Store',
    'com.tcl.tv': 'TV ao vivo (TCL)', 'com.google.android.apps.tv.launcherx': 'Tela inicial do Google TV', [LAUNCHER]: 'Launcher limpo (Calivix)',
  };
  if (conhecidos[p]) return conhecidos[p];
  for (const r of RECURSOS) if (r.pacotes.includes(p)) return r.nome;
  const partes = p.split('.');
  const ult = partes[partes.length - 1];
  return ult.charAt(0).toUpperCase() + ult.slice(1);
}

async function donosDaHome(adb) {
  const raw = limpar(await adb.shell(Q_CLAIMS));
  return [...new Set([...raw.matchAll(/^ *([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/gm)].map((m) => m[1]))];
}
const launchersEm = (claims) => [...new Set(claims.filter((c) => !/\/\S*FallbackHome$/.test(c)).map((c) => c.split('/')[0]))]
  .filter((p) => !/factorytest|factory_test|factorymode/i.test(p) && !NAO_LAUNCHERS.has(p));

async function donoDaHome(adb) {
  let dono = limpar(await adb.shell(Q_HOME)).trim().split('\n').pop().split('/')[0];
  if (dono === 'android') return { dono: '', seletor: true };
  if (!PACOTE_RE.test(dono)) {
    const d = limpar(await adb.shell('dumpsys activity | grep -m1 mHomeProcess'));
    dono = (d.match(/[: ]([A-Za-z0-9_.]+)\/[A-Za-z0-9_.]+/) || [])[1] || '';
  }
  return { dono: PACOTE_RE.test(dono) ? dono : '', seletor: false };
}

// Aplica as travas de disable.sh. Devolve { pacotes, pulados:[{pacote, motivo}], avisos:[] }.
export async function filtrarComTravas(adb, lista, { forcarSetup = false, forcarHome = false, sdk = 0 } = {}) {
  let pacotes = [...new Set(lista)];
  const pulados = [], avisos = [];
  const pular = (p, motivo) => { if (pacotes.includes(p)) { pacotes = pacotes.filter((x) => x !== p); pulados.push({ pacote: p, motivo }); } };

  const ruins = pacotes.filter((p) => !PACOTE_RE.test(p));
  if (ruins.length) throw new Error('Nomes inválidos na lista: ' + ruins.join(', '));
  const nucleo = pacotes.filter((p) => NUCLEO_RE.test(p) && !NUCLEO_OK.test(p));
  if (nucleo.length) throw new Error('A lista desativa pacotes do núcleo do Android ou do middleware da TV, e sem eles a TV pode não ligar mais: ' + nucleo.join(', ') + '. Nada foi alterado.');

  if (pacotes.includes(SETUP) && !forcarSetup) {
    const wifi = limpar(await adb.shell('dumpsys wifi').catch(() => ''));
    const donos = [...wifi.matchAll(/cname=[^ ]*/g)].map((m) => m[0]);
    if (!donos.length) pular(SETUP, 'não deu para conferir de quem é a rede Wi-Fi salva; desativá-lo poderia tirar a TV do Wi-Fi');
    else if (donos.some((d) => d.includes('setupwraith'))) pular(SETUP, 'a rede Wi-Fi salva pertence ao assistente de configuração; desativá-lo apagaria a rede e tiraria a TV do Wi-Fi. Esqueça a rede na TV e conecte de novo em Configurações › Rede, depois repita');
  }

  if (!forcarHome && pacotes.length) {
    const { dono, seletor } = await donoDaHome(adb);
    if (dono) {
      if (pacotes.includes(dono)) {
        const claims = await donosDaHome(adb).catch(() => []);
        const outros = launchersEm(claims).filter((p) => p !== dono && !pacotes.includes(p));
        const setupResponde = claims.some((c) => c.startsWith(SETUP + '/')) && !pacotes.includes(SETUP);
        if (!outros.length) pular(dono, 'é a tela inicial atual e nenhum outro launcher ficaria para assumir; instale o launcher limpo primeiro');
        else if (setupResponde) pular(dono, 'é a tela inicial e o assistente de configuração assumiria a Home (tela preta); desative-o junto ou instale o launcher primeiro');
      }
    } else {
      const ls = launchersEm(await donosDaHome(adb).catch(() => []));
      if (ls.length) {
        const listados = ls.filter((p) => pacotes.includes(p));
        if (listados.length && !ls.some((p) => !pacotes.includes(p))) for (const p of listados) pular(p, 'a tela inicial não tem padrão e nenhum outro launcher sobraria');
      } else for (const p of LAUNCHERS_DE_FABRICA) pular(p, 'não deu para perguntar à TV quem responde à tela inicial');
      avisos.push(seletor ? 'A tela inicial não tem padrão nesta TV (seletor do Android).' : 'Não deu para saber qual app é a tela inicial; a trava foi feita pelos apps que respondem à Home.');
    }
  }

  // Drivers das entradas HDMI/AV/antena (TV_INPUT_HARDWARE): desativados, as entradas ficam "Sem sinal" para sempre.
  if (pacotes.length) {
    const nomes = pacotes.join(' ');
    const r = limpar(await adb.shell(`s=$(getprop ro.build.version.sdk); for p in ${nomes}; do d=$(dumpsys package $p 2>/dev/null); case $d in *'requested permissions:'*) printf '%s\\n' "$d" | sed -n -E '/requested permissions:/,/(install|runtime) permissions:|User [0-9]+:/p' | grep -q TV_INPUT_HARDWARE && echo $p;; *'Unable to find'*) :;; *'hung system process'*) echo "HUNG $p";; *"Package [$p]"*) [ "\${s:-0}" -ge 23 ] 2>/dev/null || echo "NOCHK $p";; *) echo "NOCHK $p";; esac; done; true`, 120000).catch(() => null));
    if (r === null) avisos.push('Não deu para conferir quais pacotes controlam as entradas HDMI. Teste cada entrada depois.');
    else for (const l of r.split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (l.startsWith('HUNG ')) pular(l.slice(5), 'o sistema desligou os relatórios (dumpsys) por travamento; reinicie a TV e repita');
      else if (l.startsWith('NOCHK ')) pular(l.slice(6), 'não deu para ler as permissões deste pacote nesta versão do Android');
      else pular(l, 'controla as entradas HDMI/AV/antena (TV_INPUT_HARDWARE); desativado, as entradas ficariam sem sinal');
    }
  }

  // Quem abre os canais/entradas e quem abre as Configurações tem de ficar.
  if (pacotes.length) {
    const q = 'cmd package query-activities --brief';
    const h = limpar(await adb.shell(`${q} -a android.intent.action.VIEW -t vnd.android.cursor.item/channel 2>/dev/null; echo ==; ${q} -a android.settings.SETTINGS 2>/dev/null; true`).catch(() => null));
    if (h === null) avisos.push('Não deu para conferir quem abre as entradas e as Configurações.');
    else {
      const [a, b = ''] = h.split('\n==\n');
      const nomes = (t) => [...new Set([...t.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\//gm)].map((m) => m[1]))];
      for (const p of nomes(a)) pular(p, 'a TV abre as entradas HDMI e os canais com ele');
      for (const p of nomes(b)) pular(p, 'a TV abre as Configurações com ele (e por elas se volta às Opções do desenvolvedor)');
      if (!nomes(b).length) avisos.push('A consulta de quem abre as Configurações voltou vazia; abra uma entrada HDMI e as Configurações depois.');
    }
  }
  if (sdk && sdk < 23) avisos.push('Android antigo: as travas leem menos informações nesta versão.');
  return { pacotes, pulados, avisos };
}

// Registro do estado antes da mudança (o equivalente ao recovery.py --save): o primeiro vence.
export async function registrarEstado(adb, pacotes, registroAnterior = null) {
  const habil = new Set(pacotesDoTexto(await adb.shell('pm list packages -e --user 0')));
  const todos = new Set(pacotesDoTexto(await adb.shell('pm list packages --user 0')));
  const reg = registroAnterior ? structuredClone(registroAnterior) : { criadoEm: new Date().toISOString(), pacotes: {}, home: '', escalas: {} };
  for (const p of [...pacotes, ...LAUNCHERS_DE_FABRICA]) {
    if (p in reg.pacotes) continue;
    if (todos.has(p)) reg.pacotes[p] = habil.has(p) ? 'ativado' : 'desativado';
  }
  if (!reg.home) reg.home = limpar(await adb.shell(Q_HOME)).trim().split('\n').pop();
  if (!Object.keys(reg.escalas).length) {
    for (const s of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'])
      reg.escalas[s] = limpar(await adb.shell(`settings get global ${s}`)).trim();
  }
  return reg;
}

export async function desativar(adb, lista, log, opcoes = {}) {
  const instalados = new Set(pacotesDoTexto(await adb.shell('pm list packages --user 0')));
  const ausentes = lista.filter((p) => !instalados.has(p));
  for (const p of ausentes) log(`• ${p}: não existe nesta TV`);
  const filtro = await filtrarComTravas(adb, lista.filter((p) => instalados.has(p)), opcoes);
  const { pacotes } = filtro;
  const { pulados, avisos } = filtro;
  for (const p of pulados) log(`↷ mantido ${p.pacote}: ${p.motivo}`);
  for (const a of avisos) log('⚠ ' + a);
  const registro = await registrarEstado(adb, pacotes, opcoes.registro);
  const LOTE = 6;
  for (let i = 0; i < pacotes.length; i += LOTE) {
    for (const p of pacotes.slice(i, i + LOTE)) {
      const r = limpar(await adb.shell(`pm disable-user --user 0 ${p}`)).trim();
      const motivo = (r.split('\n').find((l) => /exception|error|denied/i.test(l)) || r.split('\n').pop() || 'sem resposta').trim();
      log((/disabled-user|new state: disabled/i.test(r) ? '✓ desativado ' : '• ') + p + (/disabled/i.test(r) ? '' : ` (${motivo})`));
    }
  }
  const habil = new Set(pacotesDoTexto(await adb.shell('pm list packages -e --user 0')));
  const continuam = pacotes.filter((p) => habil.has(p));
  if (continuam.length) log('✗ continuam ativados (a TV não aceitou): ' + continuam.join(', '));
  await adb.shell('sync');
  const secure = limpar(await adb.shell('getprop ro.adb.secure')).trim();
  if (secure === '0' || secure === '') log('⚠ Esta TV aceita ADB pela rede sem perguntar (ro.adb.secure=0). Desligue a depuração quando terminar.');
  return { desativados: pacotes.filter((p) => !habil.has(p)), pulados, continuam, ausentes, registro };
}

export async function ativar(adb, lista, log) {
  const ok = [];
  for (const p of lista) {
    if (!PACOTE_RE.test(p)) continue;
    const r = limpar(await adb.shell(`pm enable --user 0 ${p}`)).trim();
    const certo = /new state: enabled/i.test(r);
    log((certo ? '✓ ativado ' : '• ') + p + (certo ? '' : ` (${r || 'sem resposta'})`));
    if (certo) ok.push(p);
  }
  return { ativados: ok };
}

// Desfaz pelo registro: reativa o que estava ativado, devolve a tela inicial e as escalas de animação.
export async function restaurar(adb, registro, log) {
  if (!registro) throw new Error('Não há registro do estado anterior desta TV para restaurar.');
  const ativos = Object.entries(registro.pacotes).filter(([, e]) => e === 'ativado').map(([p]) => p);
  // primeiro o launcher de fábrica, só depois o assistente de configuração (ordem do restore.sh)
  const ordem = ativos.sort((a, b) => (a === SETUP) - (b === SETUP) || LAUNCHERS_DE_FABRICA.includes(b) - LAUNCHERS_DE_FABRICA.includes(a));
  await ativar(adb, ordem, log);
  let home = registro.home || '';
  if (home.startsWith(LAUNCHER + '/') && ativos.some((p) => LAUNCHERS_DE_FABRICA.includes(p))) home = '';
  if (!/^[A-Za-z_][\w.]*\/[\w.$]+$/.test(home)) {
    const est = ativos.find((p) => LAUNCHERS_DE_FABRICA.includes(p));
    if (est) home = limpar(await adb.shell(`${Q_HOME} ${est}`)).trim().split('\n').pop();
  }
  if (/^[A-Za-z_][\w.]*\/[\w.$]+$/.test(home)) {
    await adb.shell(`cmd package set-home-activity --user 0 ${home}`);
    log('✓ tela inicial devolvida para ' + home.split('/')[0]);
  }
  for (const [s, v] of Object.entries(registro.escalas || {})) if (/^-?\d+(\.\d+)?$/.test(v)) await adb.shell(`settings put global ${s} ${v}`);
  return { reativados: ativos };
}

// Compara a TV com o que foi aplicado (check.py): o que uma atualização de firmware religou.
export async function conferir(adb, desativadosEsperados) {
  const habil = new Set(pacotesDoTexto(await adb.shell('pm list packages -e --user 0')));
  return { religados: desativadosEsperados.filter((p) => habil.has(p)) };
}

// Instala o launcher limpo e o torna a tela inicial (build-and-install.sh, sem os ajudantes de teclas).
export async function instalarLauncher(adb, apk, log, { config } = {}) {
  const sdk = Number(limpar(await adb.shell('getprop ro.build.version.sdk')).trim());
  if (sdk && sdk < 26) throw new Error(`Esta TV roda o SDK ${sdk}; o launcher precisa do Android 8.0 (SDK 26) ou mais novo.`);
  let { dono } = await donoDaHome(adb);
  let estoque = '';
  if (LAUNCHERS_DE_FABRICA.includes(dono)) estoque = dono;
  else if (dono === LAUNCHER) log('A tela inicial já é o launcher limpo; nada de fábrica será desativado.');
  else if (!dono) {
    const ls = launchersEm(await donosDaHome(adb)).filter((p) => LAUNCHERS_DE_FABRICA.includes(p));
    if (ls.length === 1) estoque = ls[0];
    else throw new Error('A tela inicial está no seletor do Android e não deu para saber qual é a de fábrica. Escolha uma tela inicial padrão na TV e repita.');
  } else throw new Error(`A tela inicial atual é ${dono}, que não é um launcher de fábrica conhecido.`);
  log('Enviando o launcher (' + Math.round(apk.length / 1024) + ' KB)…');
  await adb.enviarArquivo(apk, '/data/local/tmp/calivix-launcher.apk', 0o644);
  const inst = limpar(await adb.shell('pm install -r /data/local/tmp/calivix-launcher.apk; rm -f /data/local/tmp/calivix-launcher.apk', 180000));
  if (!/Success/.test(inst)) throw new Error('A TV recusou a instalação: ' + inst.trim().split('\n').pop());
  log('✓ launcher instalado');
  if (config) await aplicarConfigLauncher(adb, config, log, { reiniciar: false });
  const ini = limpar(await adb.shell(`am start -W -a android.intent.action.MAIN -c android.intent.category.HOME -n ${LAUNCHER}/.MainActivity`));
  if (!/Status: ok/.test(ini)) throw new Error('O launcher não abriu: ' + ini.trim().split('\n').pop());
  await adb.shell(`cmd package compile -m speed -f ${LAUNCHER}`, 180000).catch(() => {});
  if (estoque) { await adb.shell(`pm disable-user --user 0 ${estoque}`); log('✓ tela inicial de fábrica desativada (' + estoque + ')'); }
  await adb.shell(`cmd package set-home-activity --user 0 ${LAUNCHER}/.MainActivity`);
  const agora = limpar(await adb.shell(Q_HOME)).trim().split('\n').pop();
  if (!agora.startsWith(LAUNCHER + '/')) {
    if (estoque) {
      await adb.shell(`pm enable --user 0 ${estoque}`);
      const volta = limpar(await adb.shell(`${Q_HOME} ${estoque}`)).trim().split('\n').pop();
      if (/\//.test(volta)) await adb.shell(`cmd package set-home-activity --user 0 ${volta}`);
    }
    throw new Error(`A TV não aceitou o launcher como tela inicial (responde: ${agora || 'nada'}). A tela de fábrica foi devolvida.`);
  }
  // o protetor Ambiente sai junto com a lista; o relógio do launcher entra no lugar
  await adb.shell(`settings put secure screensaver_components ${LAUNCHER}/.ClockDream`);
  log('✓ launcher limpo é a tela inicial');
  return { estoque };
}

// Envia o config.json do launcher (dock, colunas, apps ocultos) — mesma via do theme.sh.
export async function aplicarConfigLauncher(adb, config, log, { reiniciar = true } = {}) {
  const DIR = `/sdcard/Android/data/${LAUNCHER}/files`;
  const URI = `content://${LAUNCHER}.theme`;
  const json = new TextEncoder().encode(JSON.stringify(config, null, 2));
  const rev = new TextEncoder().encode(Date.now().toString(36) + Math.random().toString(36).slice(2));
  const por = async (nome, dados) => {
    const tmp = `/data/local/tmp/calivix-${nome}`;
    await adb.enviarArquivo(dados, tmp);
    await adb.shell(`rm -f ${DIR}/${nome} 2>/dev/null; { o=$(content write --uri ${URI}/${nome} < ${tmp} 2>&1) && case "$o" in *'Unsupported operation'*|*'Error while accessing provider'*) false ;; esac; } || { mkdir -p ${DIR} 2>/dev/null; cp ${tmp} ${DIR}/${nome} 2>/dev/null; }; rm -f ${tmp}`);
  };
  await por('config.json', json);
  await por('theme_revision', rev);
  if (reiniciar) {
    await adb.shell(`am force-stop ${LAUNCHER}; am start -a android.intent.action.MAIN -c android.intent.category.HOME`);
  }
  log('✓ configuração do launcher aplicada');
}

export async function captura(adb) { return adb.exec('screencap -p', 30000); }

export const TECLAS = { HOME: 3, BACK: 4, UP: 19, DOWN: 20, LEFT: 21, RIGHT: 22, OK: 23, VOL_UP: 24, VOL_DOWN: 25, POWER: 26, MENU: 82, MUTE: 164, PLAY_PAUSE: 85, SETTINGS: 176 };
export async function tecla(adb, nome) {
  const k = TECLAS[nome] ?? Number(nome);
  if (!Number.isInteger(k)) throw new Error('Tecla desconhecida: ' + nome);
  await adb.shell(`input keyevent ${k}`);
}

export async function abrirApp(adb, pacote) {
  if (!PACOTE_RE.test(pacote)) throw new Error('pacote inválido');
  await adb.shell(`monkey -p ${pacote} -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1 || monkey -p ${pacote} -c android.intent.category.LAUNCHER 1`);
}

export async function instalarApk(adb, dados, log) {
  await adb.enviarArquivo(dados, '/data/local/tmp/calivix-app.apk');
  const r = limpar(await adb.shell('pm install -r /data/local/tmp/calivix-app.apk; rm -f /data/local/tmp/calivix-app.apk', 300000)).trim();
  if (!/Success/.test(r)) throw new Error('A TV recusou o APK: ' + r.split('\n').pop());
  log('✓ aplicativo instalado');
}

export async function dnsPrivado(adb, servidor, log) {
  if (servidor) {
    if (!/^[a-z0-9.-]+$/i.test(servidor)) throw new Error('endereço de DNS inválido');
    await adb.shell(`settings put global private_dns_specifier ${servidor}; settings put global private_dns_mode hostname`);
    log('✓ DNS privado: ' + servidor);
  } else {
    await adb.shell('settings put global private_dns_mode opportunistic');
    log('✓ DNS privado desligado (automático)');
  }
}
