import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localElectronPath } from './check-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(new URL('../out/main/index.js', import.meta.url))) {
  console.error('Önce npm run build çalıştırın.');
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let executable;
try { executable = localElectronPath(); }
catch (error) { console.error(error.message); process.exit(1); }
const child = spawn(executable, [root], { cwd: root, env, stdio: 'inherit' });
child.on('error', () => { console.error('Electron başlatılamadı.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
