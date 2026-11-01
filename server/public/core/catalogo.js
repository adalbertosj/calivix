// Escolhe, entre as listas testadas do CleanYourTV, as que mais combinam com a TV sondada.
let cache = null;
export async function carregarCatalogo(base = '') {
  if (!cache) cache = await (await fetch(base + 'core/catalogo.json')).json();
  return cache;
}

export function sugerirListas(catalogo, s, max = 5) {
  if (!s) return [];
  const marca = (s.fabricante || s.marca || '').toLowerCase();
  const plat = (s.plataforma || '').toLowerCase();
  const modelo = (s.modelo || '').toLowerCase();
  const android = String(s.android || '');
  const pont = catalogo.itens.map((i) => {
    let p = 0;
    const tit = (i.titulo + ' ' + i.id + ' ' + i.cabecalho.join(' ')).toLowerCase();
    if (marca && (i.marca || '').toLowerCase() === marca) p += 3;
    if (plat && i.plataformas.some((x) => x.toLowerCase() === plat)) p += 8;
    if (plat && new RegExp(`\\b${plat.replace(/[^a-z0-9]/g, '')}\\b`).test(tit)) p += 4;
    if (modelo && tit.includes(modelo)) p += 2;
    if (android && (i.so || '').includes(android)) p += 1;
    if (s.firmware && tit.includes(s.firmware.split(' ')[0].toLowerCase())) p += 3;
    return { i, p };
  }).filter((x) => x.p >= 4).sort((a, b) => b.p - a.p);
  return pont.slice(0, max).map((x) => ({ ...x.i, pontos: x.p }));
}
