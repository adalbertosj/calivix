// Servidor MCP (Model Context Protocol, transporte HTTP "streamable", respostas em JSON) para o
// Claude Code ler os pedidos feitos por voz no app, consultar as TVs e criar/executar tarefas.
//   claude mcp add --transport http calivix https://<servidor>/mcp --header "Authorization: Bearer <token>"
import fs from 'node:fs';
import path from 'node:path';
import { ACOES } from '../public/core/executor.js';
import { LOJA } from '../public/core/tv.js';
import { RECURSOS } from '../public/core/tv.js';

const FERRAMENTAS = [
  { name: 'calivix_listar_tvs', description: 'Lista as TVs cadastradas no Calivix com modelo, rede, endereço, situação do launcher e tarefas pendentes.', inputSchema: { type: 'object', properties: {} } },
  { name: 'calivix_detalhes_tv', description: 'Detalhes de uma TV: sondagem (modelo, Android, firmware), apps instalados e desativados, perfil e recursos.', inputSchema: { type: 'object', properties: { tvId: { type: 'string' } }, required: ['tvId'] } },
  { name: 'calivix_listar_pedidos', description: 'Pedidos feitos por voz/texto na área "Claude" do app Calivix. Por padrão só os novos.', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['novo', 'em_andamento', 'feito', 'recusado', 'todos'] } } } },
  { name: 'calivix_atualizar_pedido', description: 'Muda a situação de um pedido e grava a resposta que o usuário verá no app.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['em_andamento', 'feito', 'recusado'] }, resposta: { type: 'string' } }, required: ['id', 'status'] } },
  { name: 'calivix_criar_tarefa', description: 'Cria uma tarefa para uma TV. O servidor executa na hora se alcançar a TV; senão ela fica pendente até um aparelho do usuário estar na mesma rede da TV. Ações: ' + Object.entries(ACOES).map(([k, v]) => `${k} (${v})`).join('; ') + '. Pacotes conhecidos para instalar_loja: ' + LOJA.map((a) => `${a.nome}=${a.pacote}`).join(', ') + ' (outros: o id da página do app na Play Store).', inputSchema: { type: 'object', properties: { tvId: { type: 'string' }, titulo: { type: 'string' }, acoes: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string', enum: Object.keys(ACOES) }, params: { type: 'object' } }, required: ['tipo'] } }, execucao: { type: 'string', enum: ['auto', 'aparelho'], description: 'auto: servidor ou aparelho; aparelho: só um aparelho na rede da TV' } }, required: ['tvId', 'acoes'] } },
  { name: 'calivix_enviar_arquivo', description: 'Guarda no servidor um arquivo para uma tarefa (imagem .jpg/.png/.webp para papel_de_parede, ou .apk para instalar_apk) e devolve o nome a usar em params.arquivos / params.arquivo. Imagens em 1920x1080 (a tela das TVs) e com o assunto longe do relógio (alto à esquerda), dos botões (alto à direita) e do dock (terço de baixo).', inputSchema: { type: 'object', properties: { nome: { type: 'string', description: 'ex.: praia.jpg' }, base64: { type: 'string', description: 'conteúdo do arquivo em base64' } }, required: ['nome', 'base64'] } },
  { name: 'calivix_ver_tarefa', description: 'Situação, registro (log) e saídas de uma tarefa.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'calivix_captura', description: 'Devolve a última captura de tela da TV (e pede uma nova ao servidor, se ele alcançar a TV).', inputSchema: { type: 'object', properties: { tvId: { type: 'string' }, nova: { type: 'boolean' } }, required: ['tvId'] } },
  { name: 'calivix_catalogo', description: 'Procura nas 407 listas testadas do CleanYourTV (por marca, modelo ou plataforma) e devolve os pacotes de uma lista.', inputSchema: { type: 'object', properties: { busca: { type: 'string' }, id: { type: 'string' } } } },
];

const texto = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });

export async function tratarMcp(req, res, ctx) {
  const { db, banco, novaTarefa, tentarNoServidor, DADOS, VERSAO, avisar, corpo, guardarArquivo } = ctx;
  const auth = req.headers.authorization || '';
  if (auth !== 'Bearer ' + db.ajustes.tokenClaude) {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ erro: 'Token do Claude inválido (Ajustes › Claude no app)' }));
  }
  if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
  const msg = await corpo(req);
  const lote = Array.isArray(msg) ? msg : [msg];
  const respostas = [];
  for (const m of lote) {
    if (m.id === undefined) continue; // notificação
    try { respostas.push({ jsonrpc: '2.0', id: m.id, result: await metodo(m) }); }
    catch (e) { respostas.push({ jsonrpc: '2.0', id: m.id, error: { code: e.code || -32000, message: e.message } }); }
  }
  if (!respostas.length) { res.writeHead(202); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(Array.isArray(msg) ? respostas : respostas[0]));

  async function metodo(m) {
    if (m.method === 'initialize') return {
      protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'calivix', version: VERSAO },
      instructions: 'Calivix ajusta TVs Android/Google TV do Adalberto (debloat, launcher limpo, recursos). Leia os pedidos novos com calivix_listar_pedidos, marque em_andamento, faça o que for pedido criando tarefas e, ao terminar, marque feito com uma resposta curta em português. Nunca desative pacotes do núcleo do Android; o executor já aplica as travas do CleanYourTV.',
    };
    if (m.method === 'ping') return {};
    if (m.method === 'tools/list') return { tools: FERRAMENTAS };
    if (m.method !== 'tools/call') throw Object.assign(new Error('Método não suportado: ' + m.method), { code: -32601 });
    const a = m.params?.arguments || {};
    switch (m.params?.name) {
      case 'calivix_listar_tvs': return texto(Object.values(db.tvs).map((t) => ({
        id: t.id, nome: t.nome, local: t.local, ip: t.ip, tailnetIp: t.tailnetIp, rede: t.rede, modelo: t.sondagem ? `${t.sondagem.fabricante} ${t.sondagem.modelo} (${t.sondagem.plataforma}), Android ${t.sondagem.android}` : null,
        launcherLimpo: !!t.perfil?.launcher?.instalado, desativados: (t.perfil?.desativados || []).length, visto: t.visto,
        pendentes: db.tarefas.filter((x) => x.tvId === t.id && x.status === 'pendente').length })));
      case 'calivix_detalhes_tv': {
        const t = db.tvs[a.tvId]; if (!t) throw new Error('TV não encontrada');
        const inv = t.inventario || {};
        const desat = new Set(inv.desativados || []);
        return texto({ ...t, registro: t.registro ? { criadoEm: t.registro.criadoEm, home: t.registro.home } : null,
          recursos: RECURSOS.filter((r) => r.pacotes.some((p) => (inv.pacotes || []).includes(p))).map((r) => ({ id: r.id, nome: r.nome, ligado: !r.pacotes.every((p) => desat.has(p)) })) });
      }
      case 'calivix_listar_pedidos': {
        const st = a.status || 'novo';
        return texto(db.pedidos.filter((p) => st === 'todos' || p.status === st).map((p) => ({ ...p, tv: p.tvId ? db.tvs[p.tvId]?.nome : null, aparelho: db.aparelhos[p.origem]?.nome })));
      }
      case 'calivix_atualizar_pedido': {
        const p = db.pedidos.find((x) => x.id === a.id); if (!p) throw new Error('Pedido não encontrado');
        p.status = a.status; if (a.resposta) p.resposta = String(a.resposta).slice(0, 4000);
        p.respondidoEm = new Date().toISOString(); banco.gravar(); avisar('pedidos');
        return texto({ ok: true });
      }
      case 'calivix_criar_tarefa': {
        const t = novaTarefa({ tvId: a.tvId, titulo: a.titulo, acoes: a.acoes, criadaPor: 'claude', execucao: a.execucao || 'auto' });
        await new Promise((r) => setTimeout(r, 200));
        let tentou = false;
        if (t.status === 'pendente') tentou = await tentarNoServidor(t);
        // espera um pouco a execução pelo servidor, para devolver o resultado já pronto
        for (let i = 0; i < 120 && t.status === 'executando'; i++) await new Promise((r) => setTimeout(r, 500));
        return texto({ id: t.id, status: t.status, executadaPeloServidor: t.assumidaPor === 'servidor' || tentou, resumo: t.resumo, erro: t.erro,
          log: t.log.slice(-40).map((l) => l.l), saidas: t.saidas,
          observacao: t.status === 'pendente' ? 'O servidor não alcança esta TV agora. A tarefa fica guardada e um aparelho do usuário a executa quando estiver na mesma rede da TV.' : undefined });
      }
      case 'calivix_enviar_arquivo': {
        const arquivo = guardarArquivo(String(a.nome || ''), String(a.base64 || '').replace(/^data:[^,]*,/, ''));
        return texto({ arquivo, bytes: fs.statSync(path.join(DADOS, 'arquivos', arquivo)).size });
      }
      case 'calivix_ver_tarefa': {
        const t = db.tarefas.find((x) => x.id === a.id); if (!t) throw new Error('Tarefa não encontrada');
        return texto({ ...t, log: t.log.map((l) => l.l) });
      }
      case 'calivix_captura': {
        const t = db.tvs[a.tvId]; if (!t) throw new Error('TV não encontrada');
        if (a.nova !== false) {
          const tar = novaTarefa({ tvId: t.id, titulo: 'Captura de tela (Claude)', acoes: [{ tipo: 'captura' }], criadaPor: 'claude', execucao: 'servidor' });
          await tentarNoServidor(tar);
          if (tar.status === 'pendente') { tar.status = 'cancelada'; banco.gravar(); }
        }
        const f = path.join(DADOS, 'capturas', t.id + '.png');
        if (!fs.existsSync(f)) return texto('Ainda não há captura desta TV (o servidor não a alcança agora).');
        return { content: [{ type: 'image', data: fs.readFileSync(f).toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `Captura de ${t.capturaEm || 'data desconhecida'}` }] };
      }
      case 'calivix_catalogo': {
        const cat = JSON.parse(fs.readFileSync(new URL('../public/core/catalogo.json', import.meta.url), 'utf8'));
        if (a.id) { const i = cat.itens.find((x) => x.id === a.id); if (!i) throw new Error('Lista não encontrada'); return texto(i); }
        const q = String(a.busca || '').toLowerCase();
        return texto(cat.itens.filter((i) => !q || (i.id + ' ' + i.titulo + ' ' + i.plataformas.join(' ')).toLowerCase().includes(q)).slice(0, 30).map((i) => ({ id: i.id, titulo: i.titulo, so: i.so, pacotes: i.pacotes.length })));
      }
      default: throw Object.assign(new Error('Ferramenta desconhecida'), { code: -32602 });
    }
  }
}
