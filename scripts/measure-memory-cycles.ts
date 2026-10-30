// Bounded leak audit in one fresh packaged app. Only scalar counters and our
// own listener counts are recorded. No user profile, account, URL/body trace,
// cookie, token, or physical capture device is inspected.
import { resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import version from '../app-version.json';
import { PackagedDriver } from '../tests/packaged/driver';

async function main() {
  const output = process.argv[2], cycles = Number(process.argv[3] ?? 6);
  if (!output || existsSync(output) || !Number.isInteger(cycles) || cycles < 3 || cycles > 10) throw Error('New output path and 3–10 cycles required');
  const executable = resolve(`artifacts/BrowserCore_${version.display}_Windows_x64/BrowserCore.exe`);
  if (!existsSync(executable)) throw Error('Existing packaged runtime required; no download started');
  const d = new PackagedDriver(), env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS;
  const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
  const report: any = { version: version.display, completed: false, stage: 'launch', requestedCycles: cycles,
    method: 'One fresh packaged process, same public NASA video. Each cycle creates a new site view, observes muted content playing, waits 2s, closes it, then samples at 6s and 15s. Final sample at 30s. No forced GC beyond existing production policy.',
    limits: 'Finite descriptive audit, not proof that every leak is absent. Private commit is not Task Manager private working set; summed working sets can count shared pages twice. First two cycles are warmup. Main inspector/measurement activity and intentional history/session caches contribute.', cycles: [] };
  const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
  const command = (name: string, ...args: unknown[]) => d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
  const sample = async () => {
    const counters = await d.evaluate(`(()=>{const e=require('electron'),rows=e.app.getAppMetrics(),windows=e.BrowserWindow.getAllWindows(),ui=windows[0].webContents,all=e.webContents.getAllWebContents(),heap=process.memoryUsage(),old=globalThis.cycleOwner;return {processes:rows.length,liveSiteContents:all.filter(w=>w!==ui).length,nativeViews:windows[0].contentView.children.length,privateMiB:rows.reduce((s,p)=>s+(p.memory.privateBytes??0),0)/1024,workingSetMiB:rows.reduce((s,p)=>s+(p.memory.workingSetSize??0),0)/1024,byType:rows.map(p=>({type:p.type,privateMiB:(p.memory.privateBytes??0)/1024})),mainHeapMiB:heap.heapUsed/1048576,mainExternalMiB:heap.external/1048576,oldDestroyed:old?old.isDestroyed():null,oldListeners:old?{title:old.listenerCount('page-title-updated'),input:old.listenerCount('before-input-event'),fullscreen:old.listenerCount('enter-html-full-screen')}:null,uiListeners:{input:ui.listenerCount('before-input-event'),destroyed:ui.listenerCount('destroyed')}};})()`);
    const resources = await command('getResources'), state = await command('getState');
    counters.workers = resources.ok ? resources.data.backgroundWorkers : null;
    counters.idleMemory = resources.ok ? resources.data.idleMemory : null;
    counters.historyEntries = state.ok ? state.data.history.entries.length : null;
    counters.blankTabs = state.ok ? state.data.tabs.filter((t: any) => t.status === 'empty').length : null;
    return counters;
  };
  try {
    await d.launch(executable, env, false, [], {mainOnly:true});
    report.stage='ready'; let ready=false;
    for (let i=0;i<100;i++) { try { if (await d.evaluateUi("!!window.browser && document.body.innerText.includes('Browser Core bağlı')")) {ready=true;break;} } catch {} await wait(50); }
    if (!ready) throw Error('UI readiness timeout');
    await d.evaluate("require('electron').dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});void 0");
    await wait(2000); report.baseline=await sample(); save();
    for (let cycle=1;cycle<=cycles;cycle++) {
      report.stage='cycle-'+cycle;
      const row: any={cycle,warmup:cycle<=2,firstObservedContentMs:null,adObserved:false,closed:[]}; report.cycles.push(row); save();
      const start=performance.now(), opened=await command('openTab','https://www.youtube.com/watch?v=iTHUUjTA-LI');
      if (!opened.ok) throw Error('Open failed');
      await d.evaluate("(()=>{const e=require('electron'),ui=e.BrowserWindow.getAllWindows()[0].webContents;globalThis.cycleOwner=e.webContents.getAllWebContents().find(w=>w!==ui);})();");
      for (let i=0;i<40;i++) {
        await wait(500);
        const expression="(()=>{const v=document.querySelector('video'),p=document.getElementById('movie_player');if(v){v.muted=true;if(v.paused)void v.play().catch(()=>{});}return {time:v?.currentTime??0,playing:v?!v.paused:false,ad:!!p?.classList.contains('ad-showing'),error:!!document.querySelector('.ytp-error'),consent:location.hostname==='consent.youtube.com'};})()";
        let observed: any={unavailable:true};
        try { observed=await d.evaluate(`(async()=>{const w=globalThis.cycleOwner;if(!w||w.isDestroyed()||!w.debugger.isAttached())return {unavailable:true};const r=await w.debugger.sendCommand('Runtime.evaluate',{expression:${JSON.stringify(expression)},returnByValue:true});return r.result?.value??{unavailable:true};})()`); } catch {}
        row.adObserved ||= !!observed.ad;
        if (observed.time>0.5 && observed.playing && !observed.ad) {row.firstObservedContentMs=performance.now()-start;break;}
        if (observed.error || observed.consent) {row.pageError=!!observed.error;row.consent=!!observed.consent;break;}
      }
      if (row.firstObservedContentMs!==null) await wait(2000);
      row.loaded=await sample(); save();
      await command('closeTab',opened.data.tabId);
      for (const [delay,elapsedMs] of [[6000,6000],[9000,15000]]) {await wait(delay!);row.closed.push({elapsedMs,...await sample()});save();}
      const end=row.closed.at(-1);
      row.teardownClean=end.liveSiteContents===0 && end.nativeViews===0 && end.oldDestroyed===true && Object.values(end.oldListeners).every(n=>n===0) && end.workers.every((w:any)=>w.running===0);
      console.log(JSON.stringify({cycle,firstObservedContentMs:row.firstObservedContentMs,privateMiB:end.privateMiB,mainHeapMiB:end.mainHeapMiB,teardownClean:row.teardownClean}));
      if (row.firstObservedContentMs===null) {report.stopped='Video did not reach content playback; do not bypass consent/error';save();break;}
    }
    await wait(15000); report.final30s=await sample();
    report.completed=report.cycles.length===cycles && report.cycles.every((r:any)=>r.firstObservedContentMs!==null && r.teardownClean);
    const steady=report.cycles.filter((r:any)=>!r.warmup).map((r:any)=>r.closed.at(-1).privateMiB);
    if (steady.length>=2) {const n=steady.length,meanX=(n-1)/2,meanY=steady.reduce((s:number,v:number)=>s+v,0)/n;
      const numerator=steady.reduce((s:number,v:number,i:number)=>s+(i-meanX)*(v-meanY),0),denominator=steady.reduce((s:number,_v:number,i:number)=>s+(i-meanX)**2,0);
      report.steady={samples:n,privateMiB:steady,minMiB:Math.min(...steady),maxMiB:Math.max(...steady),slopeMiBPerCycle:numerator/denominator};}
    report.stage='finished';save();console.log(JSON.stringify({completed:report.completed,steady:report.steady,finalPrivateMiB:report.final30s.privateMiB}));
    if (!report.completed) process.exitCode=1;
  } catch (error) {report.failure=(error as Error).name;save();process.exitCode=1;console.error('Bounded cycle audit stopped at '+report.stage);}
  finally {await d.close();}
}
main().catch(()=>{console.error('Cycle audit could not start');process.exitCode=1;});
