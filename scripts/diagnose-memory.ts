// Bounded leak investigation of the existing package; localhost fixtures only.
// No application source changes, external sites, real profiles or forced GC.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { PackagedDriver } from '../tests/packaged/driver';

async function main() {
  const [exeArg, reportArg, cyclesArg='20', retentionArg='retain'] = process.argv.slice(2);
  if (!exeArg || !reportArg) throw new Error('Expected local executable and new report path');
  if(!['20','100'].includes(cyclesArg)||!['retain','release'].includes(retentionArg))throw new Error('Unsupported diagnostic mode');
  const cycles=Number(cyclesArg), retain=retentionArg==='retain';
  const executable = resolve(exeArg), report = resolve(reportArg);
  if (!existsSync(executable) || existsSync(report)) throw new Error('Missing executable or existing report');
  const wait = (ms:number) => new Promise(r=>setTimeout(r,ms));
  const server = createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; frame-src 'self'; style-src 'none'");
    if (req.url?.startsWith('/work.js')) {
      res.setHeader('Content-Type','text/javascript');
      res.end("window.fixtureMemory=new Uint8Array(24*1024*1024);fixtureMemory.fill(7);window.fixtureRing=[];setInterval(()=>{const b=new Uint8Array(2*1024*1024);b.fill(9);fixtureRing.push(b);if(fixtureRing.length>8)fixtureRing.shift();},900);");
    } else if (req.url?.startsWith('/frame')) {
      res.end('<!doctype html><title>Local frame</title><script src="/work.js"></script><p>Local child frame</p>');
    } else {
      res.end('<!doctype html><title>Local scripted memory fixture</title><script src="/work.js"></script><iframe src="/frame" title="local child"></iframe>'+'<p>Local DOM allocation fixture</p>'.repeat(1200));
    }
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  const driver=new PackagedDriver();
  const samples:any[]=[];
  const command=(method:string,...args:unknown[])=>driver.evaluateUi(`window.browser.${method}(...${JSON.stringify(args)})`);
  const state=async()=>{const r=await command('getState');if(!r.ok)throw new Error('State unavailable');return r.data;};
  const sample=async(label:string,cycle:number)=>{
    const metric=await driver.evaluate(`(()=>{const e=require('electron'),v8=require('node:v8'),w=e.BrowserWindow.getAllWindows()[0],m=e.app.getAppMetrics();
      return {privateMiB:m.reduce((s,p)=>s+(p.memory.privateBytes||0),0)/1024,workingSetMiB:m.reduce((s,p)=>s+p.memory.workingSetSize,0)/1024,
        mainHeapMiB:v8.getHeapStatistics().used_heap_size/1048576,contents:e.webContents.getAllWebContents().length,
        siteViews:w.contentView.children.filter(v=>v instanceof e.WebContentsView&&v.webContents.id!==w.webContents.id).length,
        processes:m.map(p=>({pid:p.pid,type:p.type,privateMiB:(p.memory.privateBytes||0)/1024,workingSetMiB:p.memory.workingSetSize/1024})),
        tracked:globalThis.__closedSites.length,destroyed:globalThis.__closedSites.every(c=>c.isDestroyed()),
        remainingListeners:globalThis.__closedSites.reduce((s,c)=>s+['did-start-navigation','did-finish-load','did-stop-loading','page-title-updated','before-input-event','before-mouse-event','unresponsive','responsive','destroyed'].reduce((n,k)=>n+c.listenerCount(k),0),0)};})()`);
    const s=await state();samples.push({label,cycle,elapsedSeconds:(Date.now()-started)/1000,tabs:s.tabs.length,...metric});
    return metric;
  };
  const started=Date.now();
  try {
    await driver.launch(executable,env,false);
    for(let i=0;i<100;i++){try{if(await driver.evaluateUi('!!window.browser'))break;}catch{}await wait(50);}
    const version=(await state()).appVersion;
    if(version!=='V1.0.4.0')throw new Error('Unexpected app version');
    await driver.evaluate('globalThis.__closedSites=[];void 0');
    for(let i=1;i<7;i++)await command('openTab');
    await wait(1500);await sample('seven-empty-baseline',0);
    for(let cycle=1;cycle<=cycles;cycle++){
      const ids:string[]=[];
      for(let i=0;i<3;i++){const r=await command('openTab',`${origin}/page-${i}`);if(!r.ok)throw new Error('Open failed');ids.push(r.data.tabId);}
      for(let i=0;i<200;i++){if((await state()).tabs.filter((t:any)=>ids.includes(t.tabId)&&t.status==='ready').length===3)break;await wait(50);}
      if((await state()).tabs.filter((t:any)=>ids.includes(t.tabId)&&t.status==='ready').length!==3)throw new Error('Local pages did not finish');
      if(cycle===1&&cycles===20){
        for(let second=0;second<=60;second+=5){if(second)await wait(5000);await sample('three-scripted-seven-empty-soak',cycle);}
        console.log('60-second scripted-page soak complete');
      }else await wait(750);
      await sample('loaded',cycle);
      await driver.evaluate("globalThis.__closedSites.push(...require('electron').webContents.getAllWebContents().filter(w=>w.getURL().startsWith('http://127.0.0.1:')));void 0");
      for(const id of ids){const r=await command('closeTab',id);if(!r.ok)throw new Error('Close failed');}
      await wait(1200);
      const closed=await sample('after-close',cycle);
      if(closed.contents!==1||closed.siteViews!==0||!closed.destroyed||closed.remainingListeners!==0)throw new Error('Owned contents or subscriptions retained');
      if(!retain)await driver.evaluate('globalThis.__closedSites=[];void 0');
      if(cycle%5===0||cycle===1)console.log(`Cycle ${cycle}/${cycles}: closed private=${closed.privateMiB.toFixed(1)} MiB; views=0, contents=1, old destroyed, own listeners=0`);
    }
    for(let second=5;second<=30;second+=5){await wait(5000);await sample('final-empty-settle',cycles);}
    writeFileSync(report,JSON.stringify({recordedAt:new Date().toISOString(),version,executable,cycles,retainDestroyedWrappers:retain,firstLoadedSoakSeconds:cycles===20?60:0,
      method:'Existing Windows package; only local self-hosted fixtures, 3 scripted main pages each with a scripted same-origin frame; 7 empty tabs. Cycle count/retention/soak recorded separately; 30s final settle. Each document explicitly allocates 24MiB plus a bounded eight-slot 2MiB ring. Main inspector only; no renderer CDP or forced GC. All metrics cover this own application. Destroyed WebContents wrappers are retained for lifecycle inspection only in retain mode, otherwise cleared after each cycle. Counts prove bounded owned lifecycle cleanup in this scenario, not universal absence of a leak or performance on real sites.',
      samples,errors:driver.errors},null,2)+'\n');
    console.log('Report: '+report);
  } finally {await driver.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
