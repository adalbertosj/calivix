// Gera server/public/core/catalogo.json a partir de repo/examples (listas testadas pela comunidade do CleanYourTV).
import fs from 'node:fs';
import path from 'node:path';
const raiz = path.resolve(import.meta.dirname, '..');
const ex = path.join(raiz, 'repo/examples');
const itens = [];
for (const d of fs.readdirSync(ex).sort()) {
  const lista = path.join(ex, d, 'debloat.txt');
  if (!fs.existsSync(lista)) continue;
  const txt = fs.readFileSync(lista, 'utf8').replace(/\r/g, '');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(ex, d, 'tv.json'), 'utf8')); } catch {}
  let config = null;
  try { config = JSON.parse(fs.readFileSync(path.join(ex, d, 'config.json'), 'utf8')); } catch {}
  const pacotes = []; let grupo = ''; const cab = [];
  let noCab = true;
  for (const l of txt.split('\n')) {
    const t = l.trim();
    if (!t) { noCab = false; continue; }
    if (t.startsWith('#')) {
      const c = t.replace(/^#+\s?/, '');
      if (noCab) cab.push(c);
      else if (!/^[a-z][\w]*(\.[\w]+)+/.test(c) && c.length < 70 && !/[.:]$/.test(c)) grupo = c;
      continue;
    }
    noCab = false;
    const m = t.match(/^([A-Za-z_][\w]*(?:\.[\w]+)+)\s*(?:#\s*(.*))?$/);
    if (m) pacotes.push({ p: m[1], c: m[2] || '', g: grupo });
  }
  const cabTxt = cab.join(' ');
  const plat = [...cabTxt.matchAll(/\bdevice\s+([A-Za-z0-9_-]+)/gi)].map((m) => m[1]);
  itens.push({ id: d, titulo: meta.tv || d, so: meta.os || '', marca: meta.brand || '', notas: meta.notes || '', plataformas: [...new Set(plat)], cabecalho: cab.slice(0, 12), pacotes, config });
}
fs.writeFileSync(path.join(raiz, 'server/public/core/catalogo.json'), JSON.stringify({ origem: 'github.com/Gathin23/cleanyourtv', gerado: new Date().toISOString().slice(0, 10), itens }));
console.log(itens.length, 'listas;', (fs.statSync(path.join(raiz, 'server/public/core/catalogo.json')).size / 1024).toFixed(0), 'KB');
