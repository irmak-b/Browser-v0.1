// Diagnostic bootstrap over the immutable V1.0.6.4 bundled Core. Only the
// newly created in-memory site session's HTTP-cache option is varied.
const e=require('electron');
const {resolve,join,sep}=require('node:path');
const {existsSync,writeFileSync}=require('node:fs');
const {createServer}=require('node:http');
const root=resolve(__dirname,'../..');
const output=e.app.commandLine.getSwitchValue('audit-output');
const mode=e.app.commandLine.getSwitchValue('audit-mode');
const enabled=e.app.commandLine.getSwitchValue('audit-cache')==='on';
const gate=e.app.commandLine.getSwitchValue('audit-gate');
if(!['local','video'].includes(mode)||!output||!resolve(output).startsWith(join(root,'docs','evidence')+sep)||existsSync(output))throw Error('New evidence path and known workload required');
if(mode==='video'&&(!gate||!resolve(gate).startsWith(join(root,'.cache')+sep)||existsSync(gate)))throw Error('New workspace foreground gate required');
const report={completed:false,mode,cacheEnabled:enabled,stage:'bootstrap',runtime:process.versions.electron,chromium:process.versions.chrome,packaged:false,method:'Immutable6.4 bundled Core loaded in installed Electron diagnostic bootstrap; not normal packaged EXE. Cache option overridden only for new opaque site partitions. No real profiles or persistent site session. Local workload hidden/counts are not perceived rendering time; video requires foreground gate. Main scalar memory/CPU and own-server counters or aggregate CDP network bytes only. No raw URLs/headers/bodies/cookies/profile contents exported.',runs:[]};
e.app.on('window-all-closed',()=>e.app.exit(report.completed?0:1));
const save=()=>writeFileSync(output,JSON.stringify(report,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let target,win,server,serverBytes=0,serverRequests=0;
const original=e.session.fromPartition.bind(e.session);
e.session.fromPartition=(partition,options)=>{
 if(partition.startsWith('browser-core-development-')){
   target=original(partition,{...options,cache:enabled});
   report.siteSession={persistent:target.isPersistent(),storagePathAbsent:target.storagePath===null};
   if(report.siteSession.persistent||!report.siteSession.storagePathAbsent)throw Error('Only temporary memory session allowed');
   return target;
 }
 return original(partition,options);
};
// A hidden local fixture avoids flashing windows; no foreground/paint claims.
if(mode==='local')e.BrowserWindow.prototype.show=function(){};
let current;
e.app.on('web-contents-created',(_event,w)=>{
 if(w.getLastWebPreferences().preload)return;
 const net={requests:0,finished:0,failed:0,cacheHits:0,encodedBytes:0,inflight:new Map()};
 const send=w.debugger.sendCommand.bind(w.debugger);let installed=false;
 w.debugger.on('message',(_ev,m,p)=>{
   if(current?.owner!==w)return;
   if(m==='Network.requestWillBeSent'){net.requests++;if(net.inflight.size<4096)net.inflight.set(p.requestId,{cached:false});}
   if(m==='Network.requestServedFromCache'){const row=net.inflight.get(p.requestId);if(row)row.cached=true;}
   if(m==='Network.responseReceived'){const row=net.inflight.get(p.requestId);if(row)row.cached||=!!p.response.fromDiskCache||!!p.response.fromPrefetchCache;}
   if(m==='Network.loadingFinished'){const row=net.inflight.get(p.requestId);if(row){net.finished++;net.cacheHits+=Number(row.cached);net.encodedBytes+=Math.max(0,p.encodedDataLength||0);net.inflight.delete(p.requestId);}}
   if(m==='Network.loadingFailed'){net.failed++;net.inflight.delete(p.requestId);}
 });
 // Reuse the production ad-filter debugger. Do not attach before it, which
 // would prevent the production document-start scriptlets from arming.
 w.debugger.sendCommand=async(method,...args)=>{
   const result=await send(method,...args);
   if(mode==='video'&&method==='Page.enable'&&!installed){installed=true;await send('Network.enable');}
   return result;
 };
 w.__cacheAuditNet=net;
});
function metrics(){const rows=e.app.getAppMetrics();return {privateMiB:rows.reduce((s,p)=>s+(p.memory.privateBytes||0)/1024,0),cpu:rows.map(p=>({pid:p.pid,type:p.type,seconds:p.cpu.cumulativeCPUUsage??null})),processes:rows.length};}
async function main(){
 for(let i=0;i<200;i++){win=e.BrowserWindow.getAllWindows()[0];if(win){try{if(await win.webContents.executeJavaScript('!!window.browser'))break;}catch{}}await wait(50);}
 if(!win||!target)throw Error('Core startup unavailable');
 const command=(name,...args)=>win.webContents.executeJavaScript(`window.browser.${name}(...${JSON.stringify(args)})`);
 report.actualPackaged=e.app.isPackaged;report.initial=metrics();
 let url;
 if(mode==='local'){
   const script='window.fixtureValue=42;\n'+'//cache-fixture\n'.repeat(65536);
   const css='body{font:16px sans-serif}\n'+'/*cache-fixture*/\n'.repeat(32768);
   server=createServer((req,res)=>{
     serverRequests++;
     let body,type;
     if(req.url==='/page'){body='<!doctype html><meta charset="utf-8"><title>Cache fixture</title><link rel="stylesheet" href="/style.css"><script src="/code.js" defer></script><h1>Fixed local cache fixture</h1>';type='text/html; charset=utf-8';}
     else if(req.url==='/code.js'){body=script;type='text/javascript';}
     else if(req.url==='/style.css'){body=css;type='text/css';}
     else{body='';type='text/plain';}
     res.setHeader('Content-Type',type);res.setHeader('Content-Length',Buffer.byteLength(body));
     res.setHeader('Cache-Control',req.url==='/page'?'no-store':'public, max-age=3600');
     res.setHeader('Content-Security-Policy',"default-src 'self'; object-src 'none'");
     setTimeout(()=>{serverBytes+=Buffer.byteLength(body);res.end(body);},100);
   });
   await new Promise(r=>server.listen(0,'127.0.0.1',r));
   url=`http://127.0.0.1:${server.address().port}/page`;
 }else{
   win.setTitle('Cache tanısı · '+(enabled?'Açık':'Kapalı')+' · V1.0.6.4');win.setSize(1280,1000);win.show();
   report.stage='foreground-gate';save();console.log('CACHE_FOREGROUND_GATE_READY');
   const deadline=Date.now()+90000;while(!existsSync(gate)){if(Date.now()>deadline)throw Error('Foreground gate timed out');await wait(100);}
   win.focus();url='https://www.youtube.com/watch?v=iTHUUjTA-LI';
 }
 const match=mode==='video'?"location.origin==='https://www.youtube.com'&&location.pathname==='/watch'&&new URLSearchParams(location.search).get('v')==='iTHUUjTA-LI'":`location.href===${JSON.stringify(url)}`;
 const isolatedRead=`(()=>{const expected=${match},n=performance.getEntriesByType('navigation')[0],v=document.querySelector('video'),ad=!!document.getElementById('movie_player')?.classList.contains('ad-showing');if(expected&&v){v.muted=true;if(v.paused)void v.play().catch(()=>{});}return {expected,visibility:document.visibilityState,domMs:n?.domContentLoadedEventEnd??0,loadMs:n?.loadEventEnd??0,playing:!!v&&!v.paused,time:v?.currentTime??0,ad,error:v?.error?.code??0,width:v?.videoWidth??0,height:v?.videoHeight??0};})()`;
 for(let round=0;round<3;round++){
   report.stage='load-'+round;const before=metrics(),bytesBefore=serverBytes,requestsBefore=serverRequests;
   const start=performance.now();const opened=await command('openTab',url);if(!opened.ok)throw Error('Core open failed');
   const owner=win.contentView.children.map(v=>v.webContents).find(w=>w&&w!==win.webContents&&!w.isDestroyed());
   if(!owner)throw Error('Owned view unavailable');current={owner};
   const row={round,cold:round===0,complete:false,adObserved:false};report.runs.push(row);save();
   const deadline=Date.now()+(mode==='video'?30000:10000);let page;
   while(Date.now()<deadline){
     try{page=await owner.executeJavaScriptInIsolatedWorld(1008,[{code:isolatedRead}]);}catch{}
     row.adObserved||=page?.ad===true;
     if(mode==='local'&&page?.expected&&page.loadMs>0)break;
     if(mode==='video'&&page?.expected&&page.playing&&page.time>0.5&&!page.ad&&!page.error)break;
     await wait(100);
   }
   row.observedReadyMs=performance.now()-start;row.page=page;
   row.complete=page?.expected&&(mode==='local'?page.loadMs>0:page.visibility==='visible'&&page.playing&&page.time>0.5&&!page.ad&&!page.error);
   if(mode==='local')row.fixtureValid=await owner.executeJavaScript('window.fixtureValue===42');
   await wait(mode==='video'?5000:500);
   if(mode==='video'){
     try{row.settled=await owner.executeJavaScriptInIsolatedWorld(1008,[{code:isolatedRead}]);row.adObserved||=row.settled.ad;row.complete&&=row.settled.expected&&row.settled.visibility==='visible'&&row.settled.playing&&row.settled.time>0.5&&!row.settled.ad&&!row.settled.error;}catch{row.complete=false;}
   }
   row.loaded=metrics();row.server={requests:serverRequests-requestsBefore,payloadBytes:serverBytes-bytesBefore};row.cacheBytes=await target.getCacheSize();
   const net=owner.__cacheAuditNet;row.network=net?{requests:net.requests,finished:net.finished,failed:net.failed,cacheHits:net.cacheHits,encodedBytes:net.encodedBytes,inflight:net.inflight.size}:null;
   const state=await command('getState');row.adBlocking=state.ok?state.data.adBlocking:null;
   row.cpuSeconds=before.cpu.every(p=>p.seconds!==null)?row.loaded.cpu.reduce((sum,p)=>sum+(p.seconds??0)-(before.cpu.find(b=>b.pid===p.pid)?.seconds??0),0):null;
   await command('closeTab',opened.data.tabId);current=null;await wait(mode==='video'?3000:1200);
   row.closed=metrics();row.closed.siteViews=win.contentView.children.length;row.closed.cacheBytes=await target.getCacheSize();
   save();console.log(JSON.stringify({round,complete:row.complete,readyMs:row.observedReadyMs,server:row.server,cacheBytes:row.cacheBytes,closedMiB:row.closed.privateMiB}));
   if(!row.complete||row.fixtureValid===false)break;
 }
 report.completed=report.runs.length===3&&report.runs.every(r=>r.complete&&r.fixtureValid!==false);report.stage='finished';save();
 if(!report.completed)process.exitCode=1;
}
e.app.on('browser-window-created',(_event,w)=>{w.webContents.once('did-finish-load',()=>{setTimeout(()=>main().catch(error=>{report.failureCategory=error.name;report.stageFailed=report.stage;save();process.exitCode=1;}).finally(async()=>{server?.closeAllConnections();server?.close();if(!w.isDestroyed())w.close();}),100);});});
require(resolve(root,'artifacts/BrowserCore_V1.0.6.4_Windows_x64/resources/app/out/main/index.js'));
