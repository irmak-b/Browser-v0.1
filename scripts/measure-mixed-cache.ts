// Existing packaged Core, localhost-only mixed load. Instrumented hidden run:
// lifecycle/cache retention evidence, not perceived speed or real-site RAM.
import {createServer,type Server} from 'node:http';
import {resolve} from 'node:path';
import {existsSync,writeFileSync} from 'node:fs';
import {PackagedDriver} from '../tests/packaged/driver';
import version from '../app-version.json';

async function main(){
  const output=process.argv[2],rounds=Number(process.argv[3]??20);
  if(!output||existsSync(output)||!Number.isInteger(rounds)||rounds<8||rounds>30||rounds%2)throw Error('New output and even8–30rounds required');
  const executable=resolve(`artifacts/BrowserCore_${version.display}_Windows_x64/BrowserCore.exe`);
  if(!existsSync(executable))throw Error('Existing package required; no download');
  const d=new PackagedDriver(),servers:Server[]=[],origins:string[]=[],roles=['article','interactive','worker'];
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const traffic=roles.map(()=>({documents:0,assets:0,assetBytes:0,workerScripts:0}));
  const report:any={completed:false,version:version.display,requestedRounds:rounds,stage:'setup',method:'Existing normal packaged EXE under main Node inspector only; own window hidden after startup. Three localhost origins/ports, article+form/canvas/ring+serviceworker fixtures. First half reuses immutable assets, second half requests new asset keys each round. Three simultaneous native site views; identity isolation was tested separately in HC-01. No renderer automation port, forced GC, cache clearing, real profiles or external sites. Background/hidden scheduling and measurement overhead mean no real-site/foreground speed or general CPU percentage claim.',rounds:[],traffic};
  const save=()=>writeFileSync(output,JSON.stringify(report,null,2));
  const command=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
  const ready=async(id:string)=>{
    for(let i=0;i<120;i++){
      const s=await command('getState');
      if(s.ok&&s.data.tabs.some((t:any)=>t.tabId===id&&t.title==='Mixed fixture ready'&&t.status==='ready'))return;
      await wait(100);
    }
    throw Error('Fixture readiness timed out');
  };
  const sample=async(label:string)=>{
    const scalar=await d.evaluate(`(async()=>{
      const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0],ui=win.webContents,rows=e.app.getAppMetrics(),old=globalThis.mixedClosed??[],ses=globalThis.mixedSession;
      return {atMs:performance.now(),privateMiB:rows.reduce((s,p)=>s+(p.memory.privateBytes??0)/1024,0),
        mainHeapMiB:process.memoryUsage().heapUsed/1048576,processes:rows.map(p=>({pid:p.pid,type:p.type,privateMiB:(p.memory.privateBytes??0)/1024,cpuSeconds:p.cpu.cumulativeCPUUsage??null})),
        liveSiteContents:e.webContents.getAllWebContents().filter(w=>w!==ui).length,nativeViews:win.contentView.children.length,
        oldCount:old.length,oldDestroyed:old.every(w=>w.isDestroyed()),oldListeners:old.reduce((s,w)=>s+['did-start-navigation','did-finish-load','did-stop-loading','page-title-updated','before-input-event','before-mouse-event','unresponsive','responsive','destroyed'].reduce((n,k)=>n+w.listenerCount(k),0),0),
        uiInputListeners:ui.listenerCount('before-input-event'),uiDestroyedListeners:ui.listenerCount('destroyed'),
        cacheBytes:ses?await ses.getCacheSize():null,sessionMemoryOnly:ses?!ses.isPersistent()&&ses.storagePath===null:null};
    })()`);
    const r=await command('getResources'),s=await command('getState');
    return {label,...scalar,workers:r.ok?r.data.backgroundWorkers:null,identity:s.ok?s.data.developmentIdentity:null,blankTabs:s.ok?s.data.tabs.filter((t:any)=>t.status==='empty').length:null,historyEntries:s.ok?s.data.history.entries.length:null};
  };
  try{
    for(let role=0;role<roles.length;role++){
      const workerCode="let held=new Uint8Array(4*1024*1024);held.fill(3);self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>e.waitUntil(new Promise(r=>setTimeout(r,600000))));";
      const script=`(async()=>{try{window.fixtureData={role:${role},ready:false};
        ${role===1?"window.fixtureHeld=new Uint8Array(8*1024*1024);fixtureHeld.fill(7);window.fixtureRing=[];window.fixtureTicks=0;setInterval(()=>{fixtureTicks++;const v=new Uint8Array(128*1024);v.fill(9);fixtureRing.push(v);if(fixtureRing.length>4)fixtureRing.shift();},250);document.querySelector('input').value='fixture form state';const c=document.querySelector('canvas').getContext('2d');c.fillStyle='#345cbd';c.fillRect(0,0,512,256);":''}
        ${role===2?"const r=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;r.active.postMessage('hold');":''}
        fixtureData.ready=true;document.title='Mixed fixture ready';
      }catch{document.title='Mixed fixture failed';}})();\n`+'/*fixed-payload*/'.repeat(8192);
      const css='body{font:16px sans-serif}p{max-width:55em}'+'/*style*/'.repeat(2048);
      const server=createServer((req,res)=>{
        const path=new URL(req.url??'/','http://127.0.0.1');
        res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self';style-src 'self';worker-src 'self';frame-src 'self';object-src 'none'");
        if(path.pathname==='/asset.js'||path.pathname==='/asset.css'){
          const body=path.pathname.endsWith('.js')?script:css;traffic[role]!.assets++;traffic[role]!.assetBytes+=Buffer.byteLength(body);
          res.setHeader('Content-Type',path.pathname.endsWith('.js')?'text/javascript':'text/css');res.setHeader('Cache-Control','public,max-age=3600');res.end(body);
        }else if(path.pathname==='/sw.js'){
          traffic[role]!.workerScripts++;res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(workerCode);
        }else{
          traffic[role]!.documents++;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
          const key=encodeURIComponent(path.searchParams.get('asset')??'shared');
          res.end('<!doctype html><title>Mixed fixture loading</title>'+`<link rel="stylesheet" href="/asset.css?key=${key}"><h1>Local ${roles[role]} fixture</h1>`+(role===0?'<p>Fixed local article paragraph.</p>'.repeat(1500):'<input aria-label="Fixture form"><canvas width="512" height="256"></canvas>')+`<script src="/asset.js?key=${key}" defer></script>`);
        }
      });
      await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));servers.push(server);origins.push(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    }
    report.stage='launch';save();
    await d.launch(executable,env,false,[],{mainOnly:true});let initialized=false;
    for(let i=0;i<100;i++){try{if(await d.evaluateUi('!!window.browser')){initialized=true;break;}}catch{}await wait(50);}
    if(!initialized)throw Error('UI readiness timed out');
    await d.evaluate("(()=>{const w=require('electron').BrowserWindow.getAllWindows()[0];w.hide();globalThis.mixedClosed=[];})();");
    const initial=await command('getState');if(!initial.ok||initial.data.appVersion!==version.display)throw Error('Version mismatch');
    report.baseline=await sample('baseline');
    const started=Date.now();
    for(let round=1;round<=rounds;round++){
      const phase=round<=rounds/2?'reuse':'new-assets',key=phase==='reuse'?'shared':'round-'+round;
      const before=traffic.map(t=>({...t})),ids:string[]=[];
      const row:any={round,phase,warmup:round<=2,elapsedSeconds:(Date.now()-started)/1000};report.rounds.push(row);report.stage='round-'+round;save();
      for(let role=0;role<roles.length;role++){
        const opened=await command('openTab',origins[role]+'/page?asset='+key);if(!opened.ok)throw Error('Open failed');ids.push(opened.data.tabId);await ready(opened.data.tabId);
      }
      row.fixture=await d.evaluate(`Promise.all(require('electron').webContents.getAllWebContents().filter(w=>${JSON.stringify(origins)}.some(o=>w.getURL().startsWith(o+'/page'))).map(w=>w.executeJavaScript('({role:window.fixtureData.role,ready:window.fixtureData.ready,node:typeof process,bridge:typeof window.browser,form:document.querySelector("input")?.value})')))`);
      if(row.fixture.length!==3||row.fixture.some((v:any)=>!v.ready||v.node!=='undefined'||v.bridge!=='undefined')||row.fixture.find((v:any)=>v.role===1)?.form!=='fixture form state')throw Error('Mixed content invariant failed');
      await d.evaluate(`(()=>{const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0];globalThis.mixedClosed=e.webContents.getAllWebContents().filter(w=>w!==win.webContents);globalThis.mixedSession=globalThis.mixedClosed[0].session;})();`);
      await wait(500);row.loaded=await sample('loaded');
      if(row.loaded.nativeViews!==3||row.loaded.sessionMemoryOnly!==true)throw Error('View/session mismatch');
      for(const id of ids){const result=await command('closeTab',id);if(!result.ok)throw Error('Close failed');}
      let clean=false;
      for(let i=0;i<40;i++){
        await wait(100);const r=await command('getResources');
        if(r.ok&&r.data.backgroundWorkers.every((w:any)=>w.running===0)){clean=true;break;}
      }
      if(!clean)throw Error('Workers did not stop');
      await wait(1000);row.closed=await sample('closed');
      if(row.closed.liveSiteContents!==0||row.closed.nativeViews!==0||row.closed.oldCount!==3||!row.closed.oldDestroyed||row.closed.oldListeners!==0||row.closed.workers.some((w:any)=>w.running!==0))throw Error('Lifecycle residue');
      await d.evaluate('globalThis.mixedClosed=[];void 0');
      await wait(1500);row.idle=await sample('closed-idle');
      const prev=new Map(row.closed.processes.map((p:any)=>[p.pid,p.cpuSeconds]));
      row.idleCpuSeconds=row.idle.processes.reduce((sum:number,p:any)=>sum+(prev.has(p.pid)&&p.cpuSeconds!==null?(p.cpuSeconds-(prev.get(p.pid) as number)):0),0);
      row.idleWallSeconds=(row.idle.atMs-row.closed.atMs)/1000;
      row.traffic=traffic.map((t,i)=>({role:roles[i],documents:t.documents-before[i]!.documents,assets:t.assets-before[i]!.assets,assetBytes:t.assetBytes-before[i]!.assetBytes,workerScripts:t.workerScripts-before[i]!.workerScripts}));
      save();console.log(JSON.stringify({round,phase,closedMiB:row.closed.privateMiB,cacheMiB:row.closed.cacheBytes/1048576,assets:row.traffic.reduce((s:number,t:any)=>s+t.assets,0),workers:row.closed.workers.reduce((s:number,w:any)=>s+w.running,0),views:row.closed.nativeViews,oldListeners:row.closed.oldListeners,idleCpuSeconds:row.idleCpuSeconds,idleWallSeconds:row.idleWallSeconds}));
    }
    await wait(15000);report.final=await sample('final-settle');report.elapsedSeconds=(Date.now()-started)/1000;report.runtimeErrorCount=d.errors.length;
    report.completed=report.rounds.length===rounds&&report.runtimeErrorCount===0&&report.final.liveSiteContents===0&&report.final.nativeViews===0&&report.final.workers.every((w:any)=>w.running===0);
    report.stage='finished';save();if(!report.completed)process.exitCode=1;
  }catch(error){report.failureCategory=(error as Error).name;report.failureReason=(error as Error).message;save();process.exitCode=1;console.error('Mixed local audit stopped at '+report.stage);}
  finally{await d.close();for(const server of servers){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}}
}
main().catch(()=>{console.error('Mixed local audit initialization failed');process.exitCode=1;});
