import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function localElectronPath() {
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve('electron/package.json');
    const folder = dirname(packagePath);
    const version = JSON.parse(readFileSync(packagePath, 'utf8')).version;
    const relativePath = readFileSync(join(folder, 'path.txt'), 'utf8').trim();
    const expectedPath = process.platform === 'win32' ? 'electron.exe'
      : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
    const executable = join(folder, 'dist', expectedPath);
    if (relativePath !== expectedPath || !existsSync(executable)
      || readFileSync(join(folder, 'dist/version'), 'utf8').trim().replace(/^v/, '') !== version) throw new Error();
    return executable;
  } catch { throw new Error('Yerel Electron çalışma dosyaları eksik. Otomatik indirme başlatılmadı; indirme için önce boyut ve kullanıcı onayı gerekir.'); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { localElectronPath(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
