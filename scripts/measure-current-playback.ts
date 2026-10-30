// Two bounded attempts in one fresh app; scalar diagnostics only. No account,
// user profile, response body, cookies, tokens, or request traces are collected.
import { resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { PackagedDriver } from '../tests/packaged/driver';
async function main() {
  const output = process.argv[2]; if (!output || existsSync(output)) throw Error('A new evidence path is required');
  const d = new PackagedDriver(), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS;
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const report: any = { completed: false, method: 'Two attempts at the same public NASA video in one fresh local-runtime session, adblock on; muted play requested; 500ms sampling.',
    limits: 'Descriptive current-version check only, not an old/new comparison or proof of zero leaks. Private commit and summed working sets are different metrics. Working-set sum may double-count shared pages.', runs: [] };
  const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
  const command = (name: string, ...args: unknown[]) => d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
  const memory = () => d.evaluate(`(()=>{const e=require('electron'),rows=e.app.getAppMetrics(),ui=e.BrowserWindow.getAllWindows()[0].webContents,sites=e.webContents.getAllWebContents().filter(w=>w!==ui);return {processes:rows.length,liveSiteContents:sites.length,privateMiB:rows.reduce((n,p)=>n+(p.memory.privateBytes??0),0)/1024,workingSetMiB:rows.reduce((n,p)=>n+(p.memory.workingSetSize??0),0)/1024,byType:rows.map(p=>({type:p.type,privateMiB:(p.memory.privateBytes??0)/1024})),runningWorkers:sites.reduce((n,w)=>n+Object.keys(w.session.serviceWorkers.getAllRunning()).length,0)};})()`);
  try {
    report.stage = 'launch';
    await d.launch(resolve('node_modules/electron/dist/electron.exe'), env, false, [resolve('.')], { mainOnly: true });
    report.stage = 'UI-ready'; let ready = false;
    for (let i = 0; i < 100; i++) { try { if (await d.evaluateUi('!!window.browser')) { ready = true; break; } } catch {} await wait(50); }
    if (!ready) throw Error('UI not ready');
    await d.evaluate("require('electron').dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});void 0");
    report.baseline = await memory(); save();
    report.stage = 'warmup';
    const opened = await command('openTab', 'https://www.youtube.com/robots.txt'); if (!opened.ok) throw Error('Warmup command failed');
    await d.evaluate("(()=>{const e=require('electron'),ui=e.BrowserWindow.getAllWindows()[0].webContents;globalThis.playbackSession=e.webContents.getAllWebContents().find(w=>w!==ui).session;})();");
    for (let i = 0; i < 50; i++) { const s = await command('getState'); if (s.data.tabs.find((t: any) => t.tabId === opened.data.tabId)?.status !== 'loading') break; await wait(100); }
    for (let attempt = 0; attempt < 2; attempt++) {
      report.stage = 'video-' + (attempt + 1);
      const started = performance.now(), row: any = { samples: [] }; report.runs.push(row);
      await command('navigate', opened.data.tabId, 'https://www.youtube.com/watch?v=iTHUUjTA-LI');
      for (let i = 0; i < 40; i++) {
        await wait(500);
        const expression = `(()=>{const v=document.querySelector('video'),p=document.getElementById('movie_player');if(v){v.muted=true;if(v.paused)void v.play().catch(()=>{});}return {video:!!v,time:v?.currentTime??0,playing:v?!v.paused:false,ad:!!p?.classList.contains('ad-showing'),error:!!document.querySelector('.ytp-error'),consent:location.hostname==='consent.youtube.com'};})()`;
        let sample: any = { unavailable: true };
        try { sample = await d.evaluate(`(async()=>{const e=require('electron'),ui=e.BrowserWindow.getAllWindows()[0].webContents,w=e.webContents.getAllWebContents().find(w=>w!==ui);if(!w?.debugger.isAttached())return {unavailable:true};const r=await w.debugger.sendCommand('Runtime.evaluate',{expression:${JSON.stringify(expression)},returnByValue:true});return r.result?.value??{unavailable:true};})()`); } catch {}
        row.samples.push({ ms: performance.now() - started, ...sample }); save();
        if (sample.time > 0.5 && sample.playing && !sample.ad || sample.error || sample.consent) break;
      }
      row.firstObservedContentMs = row.samples.find((s: any) => s.time > 0.5 && s.playing && !s.ad)?.ms ?? null;
      row.adObserved = row.samples.some((s: any) => s.ad); row.memory = await memory(); save();
    }
    if (process.argv[3] === 'stop-worker-control') {
      report.stage = 'diagnostic-worker-stop'; report.diagnosticWorkerStop = true;
      report.workersAfterDiagnosticStop = await d.evaluate(`(async()=>{const e=require('electron'),ui=e.BrowserWindow.getAllWindows()[0].webContents,w=e.webContents.getAllWebContents().find(w=>w!==ui);if(!w?.debugger.isAttached())throw Error('No own target');await w.debugger.sendCommand('ServiceWorker.enable');await w.debugger.sendCommand('ServiceWorker.stopAllWorkers');return Object.keys(w.session.serviceWorkers.getAllRunning()).length;})()`);
    }
    report.stage = 'close'; await command('closeTab', opened.data.tabId); report.afterCloseSamples=[];
    for (const delay of [6000,9000,15000]) {
      await wait(delay); const sample = await memory();
      sample.runningWorkers=await d.evaluate('Object.keys(globalThis.playbackSession.serviceWorkers.getAllRunning()).length');
      const resources=await command('getResources'); sample.idleMemory=resources.ok?resources.data.idleMemory:null;
      report.afterCloseSamples.push(sample); save();
    }
    report.afterClose=report.afterCloseSamples.at(-1);
    report.completed = true; save(); console.log(JSON.stringify({ completed: true, startsMs: report.runs.map((r: any) => r.firstObservedContentMs), baseline: report.baseline, afterClose: report.afterClose }));
  } catch (error) { report.failure = (error as Error).name; save(); throw error; }
  finally { await d.close(); }
}
main().catch(() => { console.error('Bounded playback measurement did not complete; partial evidence was saved.'); process.exitCode = 1; });
