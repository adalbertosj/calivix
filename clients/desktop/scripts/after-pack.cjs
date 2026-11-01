// Windows: aplica ícone e informações de versão ao Calivix.exe sem precisar do Wine
// (o electron-builder no macOS não edita executáveis do Windows sozinho).
const fs = require('node:fs');
const path = require('node:path');

// macOS: o executável do Electron sai com o mesmo LC_UUID em todo app feito com a mesma versão
// (OmniView, EndoScope, Calivix…). A privacidade de Rede Local identifica o app também por esse UUID,
// então o Calivix herdava a decisão de outro app e o pedido "Permitir rede local" nunca aparecia.
// Cada executável ganha um UUID próprio, derivado do appId, do caminho e da arquitetura.
const crypto = require('node:crypto');
const LC_UUID = 0x1b;

function novoUuid(semente) {
  const h = crypto.createHash('sha256').update(semente).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80; // formato de UUID v5
  return h;
}

function trocarUuidFino(buf, base, semente) {
  if (buf.readUInt32LE(base) !== 0xfeedfacf) return 0; // só Mach-O de 64 bits
  const cpu = buf.readUInt32LE(base + 4), ncmds = buf.readUInt32LE(base + 16);
  let p = base + 32, trocados = 0;
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(p), tam = buf.readUInt32LE(p + 4);
    if (cmd === LC_UUID) { novoUuid(`${semente}:${cpu}`).copy(buf, p + 8); trocados++; }
    p += tam;
  }
  return trocados;
}

function trocarUuid(arquivo, semente) {
  const buf = fs.readFileSync(arquivo);
  let n = 0;
  if (buf.readUInt32BE(0) === 0xcafebabe) { // universal: uma fatia por arquitetura
    const qtd = buf.readUInt32BE(4);
    for (let i = 0; i < qtd; i++) n += trocarUuidFino(buf, buf.readUInt32BE(8 + i * 20 + 8), semente);
  } else n = trocarUuidFino(buf, 0, semente);
  if (n) fs.writeFileSync(arquivo, buf);
  return n;
}

function uuidsMac(ctx) {
  const appId = ctx.packager.appInfo.id;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  const execs = [path.join(app, 'Contents/MacOS', ctx.packager.appInfo.productFilename)];
  const fw = path.join(app, 'Contents/Frameworks');
  for (const h of fs.readdirSync(fw).filter((n) => n.endsWith('.app'))) {
    const dir = path.join(fw, h, 'Contents/MacOS');
    for (const e of fs.readdirSync(dir)) execs.push(path.join(dir, e));
  }
  let total = 0;
  for (const e of execs) total += trocarUuid(e, `${appId}:${path.relative(app, e)}`);
  console.log(`  • UUID próprio em ${execs.length} executáveis (${total} fatias)`);
}

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName === 'darwin') return uuidsMac(ctx);
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const res = R.NtExecutableResource.from(R.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true }));
  const nome = ctx.packager.appInfo.productName;
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '../build/icon.ico')));
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map((i) => i.data));
  const v = (R.Resource.VersionInfo.fromEntries(res.entries)[0]) || R.Resource.VersionInfo.createEmpty();
  const [a, b, c] = ctx.packager.appInfo.version.split('.').map(Number);
  v.setFileVersion(a, b, c, 0, 1033);
  v.setProductVersion(a, b, c, 0, 1033);
  v.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: nome, FileDescription: 'Calivix — ajuste fino para TVs', CompanyName: 'Adalberto Silva',
    LegalCopyright: 'Adalberto Silva', OriginalFilename: `${ctx.packager.appInfo.productFilename}.exe`, InternalName: nome,
  });
  v.outputToResourceEntries(res.entries);
  const out = R.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  res.outputResource(out);
  fs.writeFileSync(exe, Buffer.from(out.generate()));
  console.log(`  • ícone e versão aplicados ao ${ctx.packager.appInfo.productFilename}.exe`);
};
