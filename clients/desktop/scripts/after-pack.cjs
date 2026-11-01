// Windows: aplica ícone e informações de versão ao Calivix.exe sem precisar do Wine
// (o electron-builder no macOS não edita executáveis do Windows sozinho).
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(ctx) {
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
