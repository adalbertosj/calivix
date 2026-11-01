// Gera build/icon.icns (macOS, grade oficial da Apple) e build/icon.ico (Windows, cantos
// arredondados com borda transparente) a partir do kit de identidade em marca/svg.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marca = path.resolve(here, '../../marca/svg');
const saida = path.join(here, 'build');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calivix-icon-'));
const render = (svg, size, out) => execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), path.join(marca, svg), '-o', out]);

// macOS: iconset → icns
const set = path.join(tmp, 'icon.iconset');
fs.mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  render('icone-macos.svg', s, path.join(set, `icon_${s}x${s}.png`));
  render('icone-macos.svg', s * 2, path.join(set, `icon_${s}x${s}@2x.png`));
}
fs.mkdirSync(saida, { recursive: true });
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(saida, 'icon.icns')]);

// Lê um PNG RGBA de 8 bits (como o rsvg-convert gera) e devolve os pixels sem filtro.
function decodePng(buf) {
  let pos = 8, w = 0, h = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('PNG precisa ser RGBA 8 bits sem entrelaçamento');
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= 4 && y ? px[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { w, h, px };
}

// Imagem de ícone no formato clássico (DIB BGRA de 32 bits + máscara AND). Ao contrário do PNG
// embutido, é lida com transparência em todos os lugares do Windows (atalhos, barra de tarefas, NSIS).
function dib(png) {
  const { w, h, px } = decodePng(png);
  const maskStride = Math.ceil(w / 32) * 4;
  const out = Buffer.alloc(40 + w * h * 4 + maskStride * h);
  out.writeUInt32LE(40, 0); out.writeInt32LE(w, 4); out.writeInt32LE(h * 2, 8);
  out.writeUInt16LE(1, 12); out.writeUInt16LE(32, 14); out.writeUInt32LE(w * h * 4 + maskStride * h, 20);
  const mask = 40 + w * h * 4;
  for (let y = 0; y < h; y++) {
    const row = h - 1 - y; // DIB é de baixo para cima
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = 40 + (row * w + x) * 4;
      out[o] = px[i + 2]; out[o + 1] = px[i + 1]; out[o + 2] = px[i]; out[o + 3] = px[i + 3];
      if (px[i + 3] === 0) out[mask + row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

// Windows: ICO de 16 a 256 px (256 em PNG, os demais em DIB com transparência). icon.ico = app;
// instalador.ico = o instalador .exe, com o mesmo selo de baixar do disco do .dmg (como no Benilab).
function ico(svgName, out) {
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const images = sizes.map((s) => {
    const f = path.join(tmp, `${svgName}-${s}.png`);
    render(svgName, s, f);
    const png = fs.readFileSync(f);
    return s === 256 ? png : dib(png);
  });
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(s === 256 ? 0 : s, e); header.writeUInt8(s === 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(images[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  fs.writeFileSync(path.join(saida, out), Buffer.concat([header, ...images]));
}
ico('icone-arredondado.svg', 'icon.ico');
ico('icone-instalador.svg', 'instalador.ico');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Ícones gerados em ${path.basename(saida)}/ a partir de ${path.relative(path.resolve(here, '../..'), marca)}`);
