// Sets the icon, version info and an admin manifest on the packaged Purgo.exe (pure JS, no Wine needed).
const fs = require('fs');
const path = require('path');
module.exports = async function (context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const PELibrary = await import('pe-library');
  const R = ResEdit.default || ResEdit, PL = PELibrary.default || PELibrary;
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  const exeData = PL.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = PL.NtExecutableResource.from(exeData);
  // icon
  const iconFile = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const lang = groups.length ? groups[0].lang : 1033, id = groups.length ? groups[0].id : 1;
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, iconFile.icons.map(i => i.data));
  // version info
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0] || R.Resource.VersionInfo.createEmpty();
  const v = context.packager.appInfo.version.split('.').map(Number);
  vi.setFileVersion(v[0], v[1], v[2], 0, 1033); vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'Purgo', FileDescription: 'Purgo Uninstaller', CompanyName: 'Vasili Zaitev', LegalCopyright: 'Copyright © 2026 Vasili Zaitev (GPL-3.0)', OriginalFilename: 'Purgo.exe', InternalName: 'Purgo' });
  vi.outputToResourceEntries(res.entries);
  // manifest: require administrator
  const manifest = res.entries.find(e => e.type === 24);
  if (manifest) {
    let xml = Buffer.from(manifest.bin).toString('utf8');
    xml = xml.replace(/level="asInvoker"/, 'level="requireAdministrator"');
    manifest.bin = new Uint8Array(Buffer.from(xml, 'utf8')).buffer;
  }
  res.outputResource(exeData);
  fs.writeFileSync(exe, Buffer.from(exeData.generate()));
  console.log('  • afterPack: icon, version info and admin manifest set on', path.basename(exe));
};
