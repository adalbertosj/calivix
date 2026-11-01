// Copia o instalador do Windows para INSTALADORES/Windows, com a versão no nome.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(here, 'dist.nosync');
const versao = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version;
const exe = `Calivix-Instalador-${versao}.exe`;
const destino = path.resolve(here, '../../INSTALADORES/Windows');
fs.mkdirSync(destino, { recursive: true });
// Nome com a versão: dá para conferir que o arquivo novo chegou (ex.: pelo iCloud) antes de instalar.
for (const f of fs.readdirSync(destino)) if (/^Calivix-Instalador.*\.exe$/.test(f)) fs.rmSync(path.join(destino, f));
fs.copyFileSync(path.join(dist, exe), path.join(destino, exe));
console.log(`Pronto: INSTALADORES/Windows/${exe} (${(fs.statSync(path.join(destino, exe)).size / 1e6).toFixed(0)} MB)`);
