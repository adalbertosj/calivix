// Banco em arquivo JSON único, com gravação atômica (temporário + rename) e cópias diárias.
import fs from 'node:fs';
import path from 'node:path';

export function abrirBanco(dir) {
  fs.mkdirSync(path.join(dir, 'capturas'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'arquivos'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'copias'), { recursive: true });
  const arq = path.join(dir, 'calivix.json');
  let dados = null;
  if (fs.existsSync(arq)) {
    try { dados = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) {
      const ruim = `${arq}.corrompido-${new Date().toISOString().slice(0, 10)}`;
      fs.renameSync(arq, ruim);
      console.error(`[banco] arquivo ilegível guardado como ${ruim}: ${e.message}`);
    }
  }
  dados ||= {};
  dados.versao ||= 1;
  dados.conta ||= null;
  dados.sessoes ||= {};
  dados.aparelhos ||= {};
  dados.tvs ||= {};
  dados.tarefas ||= [];
  dados.pedidos ||= [];
  dados.descobertas ||= {};
  dados.ajustes ||= { redesDoServidor: '', tokenClaude: '' };

  let timer = null;
  const gravarJa = () => {
    const tmp = arq + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados));
    fs.renameSync(tmp, arq);
    const copia = path.join(dir, 'copias', `calivix-${new Date().toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(copia)) {
      fs.copyFileSync(arq, copia);
      const velhas = fs.readdirSync(path.join(dir, 'copias')).sort().slice(0, -30);
      for (const v of velhas) fs.rmSync(path.join(dir, 'copias', v), { force: true });
    }
  };
  return {
    dados,
    dir,
    gravar() { clearTimeout(timer); timer = setTimeout(gravarJa, 150); },
    gravarJa,
  };
}
