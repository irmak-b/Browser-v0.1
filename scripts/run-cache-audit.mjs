import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
const [mode,cache,output,gate]=process.argv.slice(2);
if(!['local','video'].includes(mode)||!['on','off'].includes(cache)||!output||existsSync(output))throw Error('Known mode/cache and fresh output required');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
const args=[resolve('tests/fixtures/cache-audit.cjs'),'--audit-mode='+mode,'--audit-cache='+cache,'--audit-output='+resolve(output),...(gate?['--audit-gate='+resolve(gate)]:[])];
const child=spawn(resolve('node_modules/electron/dist/electron.exe'),args,{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
child.stdout.on('data',d=>process.stdout.write(d));
// Never forward Chromium logs, which can contain page or environment data.
child.stderr.resume();child.on('error',()=>{console.error('Cache diagnostic launch failed');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
