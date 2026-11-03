// Executa uma tarefa (lista de ações) numa TV. É o mesmo código no servidor, no Mac/Windows e no
// celular; só muda quem fornece o transporte TCP, o APK do launcher e onde os resultados são guardados.
import { Adb, ChaveAdb } from './adb.js';
import * as tv from './tv.js';

// Descrições das ações para a interface e para o Claude (MCP).
export const ACOES = {
  sondar: 'Ler modelo, Android, firmware e rede da TV',
  inventario: 'Ler a lista de apps instalados e desativados',
  desativar: 'Desativar pacotes (com as travas de segurança do CleanYourTV) — { pacotes: [] }',
  ativar: 'Reativar pacotes — { pacotes: [] }',
  restaurar: 'Desfazer tudo pelo registro do estado anterior',
  conferir: 'Ver o que uma atualização de firmware religou',
  instalar_launcher: 'Instalar o launcher limpo e torná-lo a tela inicial — { config }',
  config_launcher: 'Mudar dock, colunas e apps ocultos do launcher — { config } (troca o config.json inteiro)',
  papel_de_parede: 'Papéis de parede do launcher — { arquivos: [] (imagens enviadas ao servidor antes), minutos: 30 (troca; 0 = fixo), ordem: "sequential" | "shuffle", substituir: false (apaga os que já estão), config: {} (outras chaves do tema) }; mantém dock e apps ocultos',
  captura: 'Tirar uma captura da tela da TV',
  tecla: 'Apertar uma tecla do controle — { tecla: "HOME" | "OK" | … }',
  abrir_app: 'Abrir um aplicativo — { pacote }',
  instalar_loja: 'Instalar um app gratuito pela Play Store da TV — { pacote } (veja a lista LOJA em core/tv.js)',
  instalar_apk: 'Instalar um APK — { arquivo } (enviado ao servidor antes)',
  dns: 'DNS privado — { servidor } (vazio desliga)',
  comando: 'Comando de shell avançado — { cmd }',
  reiniciar: 'Reiniciar a TV',
};

// ctx: { transporte, jwk, log(l), registro (estado anterior ou null), salvarRegistro(r), apkLauncher(), arquivo(nome),
//        relatar({ sondagem, inventario, captura }) }
export async function conectarTv(ctx, alvo, { aoPedirPermissao } = {}) {
  const adb = new Adb(ctx.transporte, new ChaveAdb(ctx.jwk, 'calivix@' + (ctx.aparelho || 'app')));
  await adb.conectar(alvo.ip, alvo.porta || 5555, { aoPedirPermissao, esperarPermissao: 120000 });
  return adb;
}

// Confere que o aparelho naquele endereço é mesmo a TV cadastrada (mesmo IP em outra rede é outra TV).
export async function confirmarIdentidade(adb, tvCad) {
  const serial = (await adb.shell('getprop ro.serialno')).trim();
  if (tvCad.serial && serial && serial !== tvCad.serial) {
    throw new Error(`O aparelho em ${tvCad.ip} não é a ${tvCad.nome} (número de série diferente). Você provavelmente está em outra rede.`);
  }
  return serial;
}

export async function executarTarefa(ctx, tvCad, tarefa) {
  const log = ctx.log;
  const adb = await conectarTv(ctx, tvCad, { aoPedirPermissao: () => log('Confirme na TV: "Permitir depuração USB?" (marque Sempre permitir)') });
  const resultado = {};
  try {
    await confirmarIdentidade(adb, tvCad);
    for (const a of tarefa.acoes) {
      const p = a.params || {};
      log(`▶ ${ACOES[a.tipo]?.split(' — ')[0] || a.tipo}`);
      switch (a.tipo) {
        case 'sondar': resultado.sondagem = await tv.sondar(adb); break;
        case 'inventario': resultado.inventario = await tv.inventario(adb); break;
        case 'desativar': {
          const r = await tv.desativar(adb, p.pacotes || [], log, { registro: ctx.registro, forcarSetup: !!p.forcarSetup });
          ctx.registro = r.registro; await ctx.salvarRegistro(r.registro);
          resultado.desativar = { desativados: r.desativados, pulados: r.pulados, continuam: r.continuam, ausentes: r.ausentes };
          break;
        }
        case 'ativar': resultado.ativar = await tv.ativar(adb, p.pacotes || [], log); break;
        case 'restaurar': resultado.restaurar = await tv.restaurar(adb, ctx.registro, log); break;
        case 'conferir': {
          // p.esperados: o que o perfil da TV diz que deveria estar desativado
          resultado.conferir = await tv.conferir(adb, p.esperados || []);
          log(resultado.conferir.religados.length ? '⚠ religados pela TV: ' + resultado.conferir.religados.join(', ') : '✓ tudo continua como foi deixado');
          break;
        }
        case 'instalar_launcher': {
          const apk = await ctx.apkLauncher();
          if (!ctx.registro || !(tv.LAUNCHERS_DE_FABRICA.some((l) => l in (ctx.registro.pacotes || {})))) {
            ctx.registro = await tv.registrarEstado(adb, [], ctx.registro); await ctx.salvarRegistro(ctx.registro);
          }
          resultado.launcher = await tv.instalarLauncher(adb, apk, log, { config: p.config });
          break;
        }
        case 'config_launcher': await tv.aplicarConfigLauncher(adb, p.config || {}, log); resultado.launcherConfig = p.config || {}; break;
        case 'papel_de_parede': {
          // no servidor o arquivo leva um prefixo único ("<id>-nome.jpg"); na TV fica só o nome
          const imagens = [];
          for (const a of p.arquivos || []) imagens.push({ nome: String(a).replace(/^[0-9a-f]{16}-/, ''), dados: await ctx.arquivo(a) });
          const r = await tv.enviarPapeis(adb, imagens, log, p);
          resultado.launcherConfig = r.config; resultado.papeis = r.papeis;
          break;
        }
        case 'captura': resultado.captura = await tv.captura(adb); log('✓ captura feita'); break;
        case 'tecla': await tv.tecla(adb, p.tecla); log('✓ tecla ' + p.tecla); break;
        case 'abrir_app': await tv.abrirApp(adb, p.pacote); log('✓ abriu ' + p.pacote); break;
        case 'instalar_loja': { const r = await tv.instalarDaLoja(adb, String(p.pacote || ''), log); if (r.instalado) (resultado.instalados ||= []).push(r.instalado); break; }
        case 'instalar_apk': await tv.instalarApk(adb, await ctx.arquivo(p.arquivo), log); break;
        case 'dns': await tv.dnsPrivado(adb, p.servidor || '', log); break;
        case 'comando': {
          if (!String(p.cmd || '').trim()) throw new Error('Comando vazio');
          const saida = await adb.shell(String(p.cmd), 120000);
          log(saida.trim().slice(0, 4000) || '(sem saída)');
          (resultado.comandos ||= []).push({ cmd: p.cmd, saida: saida.slice(0, 20000) });
          break;
        }
        case 'reiniciar': await adb.shell('sync; sleep 2; reboot').catch(() => {}); log('✓ TV reiniciando'); break;
        default: throw new Error('Ação desconhecida: ' + a.tipo);
      }
    }
    // Depois de mexer, sempre relata o estado novo (o servidor guarda no perfil da TV).
    if (!resultado.inventario && tarefa.acoes.some((a) => ['desativar', 'ativar', 'restaurar', 'instalar_launcher', 'instalar_apk', 'instalar_loja'].includes(a.tipo))) {
      resultado.inventario = await tv.inventario(adb);
    }
  } finally { adb.fechar(); }
  return resultado;
}
