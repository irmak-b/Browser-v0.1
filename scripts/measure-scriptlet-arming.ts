// Local adapter benchmark. The debugger is a serializer-only fake: this measures
// command/payload work, not real video time, network, GPU, or renderer execution.
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import type { WebContents } from 'electron';
import { AdScriptlets } from '../src/main/browser/ad-scriptlets';
import { pageFilters } from '../src/main/browser/ad-filter-engine';
import early from '../src/main/browser/filter-data/youtube-early.json';

async function main() {
const output = process.argv[2];
if (!output || existsSync(output)) throw new Error('A new evidence path is required');
const scripts = pageFilters('https://www.youtube.com/watch?v=fixture').scripts;
const rows = [];
for (let sample = 0; sample < 5; sample++) {
  let attached = false, commands = 0, bytes = 0, adds = 0;
  const debuggerApi = Object.assign(new EventEmitter(), {
    isAttached: () => attached, attach: () => { attached = true; }, detach: () => { attached = false; },
    sendCommand: async (method: string, params?: object) => {
      commands++; bytes += Buffer.byteLength(JSON.stringify({ method, params }));
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(++adds) };
      return {};
    },
  });
  const wc = Object.assign(new EventEmitter(), { debugger: debuggerApi, isDestroyed: () => false, isDevToolsOpened: () => false }) as unknown as WebContents;
  const adapter = new AdScriptlets(); const cpu = process.cpuUsage(), started = performance.now();
  for (let i = 0; i < 50; i++) await adapter.arm(wc, 'www.youtube.com', scripts, ['youtube.com','www.youtube.com'], early);
  const elapsedMs = performance.now() - started, usage = process.cpuUsage(cpu);
  rows.push({ arms: 50, commands, adds, serializedBytes: bytes, elapsedMs, cpuMs: (usage.user + usage.system) / 1000 });
  adapter.dispose();
  if (wc.listenerCount('destroyed') || debuggerApi.listenerCount('detach')) throw new Error('Adapter listeners retained');
}
const report = { method: 'Five samples of 50 identical preparations with actual bundled YouTube rules; fake CDP serializes commands only.', scripts: scripts.length, rows,
  limits: 'Payload/command/cpu microbenchmark only. No real Electron renderer, site loading, RAM/GPU or first video frame measured.' };
writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
