// Interactive own-app investigation. Operator receives numeric metadata only;
// user chooses/loads/closes pages. No automatic external navigation or dump.
import {resolve} from 'node:path';
import {existsSync,writeFileSync} from 'node:fs';
import {PackagedDriver} from '../tests/packaged/driver';
import {gpuCacheCounters} from './gpu-cache-counters';

async function main(){
 const [exeArg,outArg]=process.argv.slice(2);if(!exeArg||!outArg)throw new Error('Executable and new report required');
 const executable=resolve(exeArg),out=resolve(outArg);if(!existsSync(executable)||existsSync(out))throw new Error('Missing executable/existing report');
 const d=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));const samples:any[]=[];const started=Date.now();
 let completed=false;let gpuCounters:unknown=null;
 const save=()=>writeFileSync(out,JSON.stringify({recordedAt:new Date().toISOString(),executable,childPid:d.child?.pid,completed,method:'Visible own package window. User loads/closes public pages. No automatic external navigation. Numeric resource metadata, main heap size, HTTP cache byte count, site-content count and window bounds; optional filtered GPU cache/allocator byte counters only after all site contents closed. No URLs, content, cookie values, profile, heap snapshot, raw trace or environment dump. Production moderate notification observed; fixed critical experiment only after no site contents. No cache/storage deletion, forced heap GC, GPU kill or hardware setting changes. No universal leak-free claim.',samples,gpuCounters},null,2)+'\n');
 const resources=async()=>{const r=await d.evaluateUi('window.browser.getResources()');if(!r.ok)throw new Error('Resource API unavailable');return r.data;};
 const sample=async(label:string)=>{
  const resource=await resources();
  const internals=await d.evaluate(`(async()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0],sites=e.webContents.getAllWebContents().filter(c=>c.id!==w.webContents.id);
    if(sites.length&&!globalThis.__diagnosticSession)globalThis.__diagnosticSession=sites[0].session;
    return {mainHeapMiB:require('node:v8').getHeapStatistics().used_heap_size/1048576,httpCacheBytes:globalThis.__diagnosticSession?await globalThis.__diagnosticSession.getCacheSize():null,siteContents:sites.length,windowVisible:w.isVisible(),windowMinimized:w.isMinimized(),windowBounds:w.getContentBounds()};})()`);
  samples.push({label,seconds:(Date.now()-started)/1000,resources:resource,...internals});
  save();
  console.log(label,JSON.stringify({privateMiB:resource.privateMiB,processes:resource.processCount,processMemory:resource.processes,mainHeapMiB:internals.mainHeapMiB,httpCacheBytes:internals.httpCacheBytes,siteContents:internals.siteContents,windowVisible:internals.windowVisible,idle:resource.idleMemory}));
 };
 try{
  await d.launch(executable,env,false,[],{visible:true});
  for(let i=0;i<100;i++){try{if(await d.evaluateUi('!!window.browser'))break;}catch{}await sleep(50);}
  const version=await d.evaluateUi('window.browser.getState()');if(!version.ok)throw new Error('Version unavailable');
  const shown=await d.evaluate(`(()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0],area=e.screen.getPrimaryDisplay().workArea;
    w.setTitle(${JSON.stringify('Browser Core · Bellek tanısı · '+version.data.appVersion)});w.setBounds({x:area.x+20,y:area.y+20,width:Math.min(1200,area.width-40),height:Math.min(820,area.height-40)});
    if(w.isMinimized())w.restore();w.show();w.focus();return {visible:w.isVisible(),minimized:w.isMinimized()};})()`);
  if(!shown.visible||shown.minimized)throw new Error('Diagnostic window did not become visible');
  console.log('OWN_VISIBLE_DIAGNOSTIC_PID '+d.child.pid);
  await sleep(2000);await sample('fresh-window');
  console.log('READY_FOR_USER_THREE_SITES');
  let loaded=false;
  for(let i=0;i<240;i++){
   if((await resources()).tabs.filter((t:any)=>t.frameCount>0).length>=3){loaded=true;break;}await sleep(2000);
  }
  if(!loaded)throw new Error('User site stage not observed within eight minutes');
  await sample('three-live-site-contents');console.log('THREE_LIVE_CONTENTS_OBSERVED_WAITING_FOR_USER_CLOSE');
  let closed=false;
  for(let i=0;i<240;i++){
   if((await resources()).tabs.every((t:any)=>t.frameCount===0)){closed=true;break;}await sleep(2000);
  }
  if(!closed)throw new Error('User close stage not observed within eight minutes');
  await sample('just-closed');await sleep(7000);await sample('after-production-idle-notification');await sleep(13000);await sample('closed-control-20s');
  const action=await d.evaluate(`(async()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0];
   if(e.webContents.getAllWebContents().some(c=>c.id!==w.webContents.id))return 'skipped-live-contents';
   if(w.webContents.debugger.isAttached())return 'skipped-debugger';
   w.webContents.debugger.attach('1.3');try{await w.webContents.debugger.sendCommand('Memory.simulatePressureNotification',{level:'critical'});return 'critical-notification-accepted';}catch{return 'unsupported';}finally{if(!w.webContents.isDestroyed()&&w.webContents.debugger.isAttached())w.webContents.debugger.detach();}})()`);
  await sleep(5000);await sample('critical-experiment:'+action);await sleep(10000);await sample('critical-settle-15s');
  if((await resources()).tabs.every((t:any)=>t.frameCount===0))gpuCounters=await gpuCacheCounters(d);
  console.log('CLOSED_GPU_COUNTERS '+JSON.stringify(gpuCounters));
  completed=true;save();
  console.log('REPORT_COMPLETE '+out);
 }finally{await d.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
