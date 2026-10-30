// Profiling-free paired measurement of one owned packaged app. The gate lets
// computer use select/focus this exact test window before measurement begins.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PackagedDriver } from '../tests/packaged/driver';
async function main(){
 const [output,version,clip,gate]=process.argv.slice(2);
 if(!output||existsSync(output)||!version||!/^V1\.0\.6\.[23]$/.test(version)||!['nasa','bunny'].includes(clip??'')||!gate||!gate.startsWith('.cache/'))throw Error('New output, known runtime/clip and workspace gate required');
 const executable=resolve(`artifacts/BrowserCore_${version}_Windows_x64/BrowserCore.exe`);if(!existsSync(executable)||existsSync(gate))throw Error('Existing package and fresh gate required');
 const url=clip==='nasa'?'https://www.youtube.com/watch?v=iTHUUjTA-LI':'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
 const d=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 const r:any={version,clip,completed:false,stage:'launch',method:'One fresh packaged process. Exact public clip, same1280x900window. Warmup until visible muted content playing and one document stable; then reload same view and sample12s at1s. No V8/Network profiler. CDP Media allowlist only. CPU is cumulative process seconds, RAM is summed private commitMiB; working sets may double count shared pages. New/exited processes and visibility/size are recorded. Finite descriptive comparison, not a universal speed or leak guarantee.',samples:[]};
 const save=()=>writeFileSync(output,JSON.stringify(r,null,2));
 const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
 const cmd=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
 const probe=String.raw`(()=>{const v=document.querySelector('video'),ad=!!document.getElementById('movie_player')?.classList.contains('ad-showing');if(v){v.muted=true;if(v.paused)void v.play().catch(()=>{});}const q=v?.getVideoPlaybackQuality?.();return {origin:performance.timeOrigin,visible:document.visibilityState==='visible',ad,playing:!!v&&!v.paused,time:v?.currentTime??0,width:v?.videoWidth??0,height:v?.videoHeight??0,totalFrames:q?.totalVideoFrames??0,droppedFrames:q?.droppedVideoFrames??0,error:v?.error?.code??0,consent:location.hostname==='consent.youtube.com',innerWidth,innerHeight};})()`;
 const readPage=()=>d.evaluate(`globalThis.resourceOwner.executeJavaScriptInIsolatedWorld(1006,[{code:${JSON.stringify(probe)}}])`);
 const metrics=()=>d.evaluate(`(()=>{const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0],rows=e.app.getAppMetrics();return {at:performance.now(),processes:rows.map(p=>({pid:p.pid,type:p.type,cpu:p.cpu.cumulativeCPUUsage??null,privateMiB:(p.memory.privateBytes??0)/1024,workingSetMiB:(p.memory.workingSetSize??0)/1024})),window:{visible:win.isVisible(),focused:win.isFocused()}};})()`);
 try{
  await d.launch(executable,env,false,[],{visible:true,mainOnly:true});let ready=false;
  for(let i=0;i<100;i++){try{if(await d.evaluateUi("!!window.browser&&document.body.innerText.includes('Browser Core bağlı')")){ready=true;break;}}catch{}await wait(50);}if(!ready)throw Error('UI not ready');
  await d.evaluate(`(()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0];w.setSize(1280,900);w.setAlwaysOnTop(true);w.show();w.focus();w.setTitle(${JSON.stringify('Video ölçümü · '+version+' · '+clip)});e.dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});})();`);
  const opened=await cmd('openTab',url);if(!opened.ok)throw Error('Open failed');
  await d.evaluate(`(()=>{const e=require('electron'),ui=e.BrowserWindow.getAllWindows()[0].webContents;globalThis.resourceOwner=e.webContents.getAllWebContents().find(w=>w!==ui);})();`);
  r.stage='await-foreground';save();console.log('FOREGROUND_GATE_READY '+version+' '+clip);
  let gated=false;for(let i=0;i<450;i++){if(existsSync(gate)){gated=true;break;}await wait(100);}if(!gated)throw Error('Foreground gate timeout');
  await d.evaluate('globalThis.resourceOwner.focus();void 0');r.stage='warmup';save();
  let stable=0,origin=0,warmed=false;const start=performance.now();
  for(let i=0;i<25;i++){await wait(1000);const p=await readPage();r.warmup=p;if(p.origin===origin)stable++;else{stable=0;origin=p.origin;}if(performance.now()-start>=10000&&stable>=3&&p.visible&&p.playing&&p.time>1&&!p.ad&&!p.error){warmed=true;break;}if(p.consent)break;}
  if(!warmed)throw Error('Visible content warmup failed');
  await d.evaluate(`(async()=>{const a=globalThis.resourceOwner;globalThis.resourceMedia=[];a.debugger.on('message',(_e,m,p)=>{if(m!=='Media.playerPropertiesChanged')return;for(const v of p.properties)if(globalThis.resourceMedia.length<32&&['kVideoDecoderName','kIsPlatformVideoDecoder','kResolution'].includes(v.name)&&/^[a-zA-Z0-9_ .x-]{1,80}$/.test(v.value))globalThis.resourceMedia.push({name:v.name,value:v.value});});await a.debugger.sendCommand('Media.enable');})()`);
  r.stage='measure';r.baseline=await metrics();const began=performance.now();const reloaded=await cmd('reload',opened.data.tabId);if(!reloaded.ok)throw Error('Reload failed');
  for(let i=0;i<12;i++){await wait(Math.max(0,(i+1)*1000-(performance.now()-began)));const page=await readPage();r.samples.push({elapsedMs:performance.now()-began,page,...await metrics()});save();}
  r.media=await d.evaluate('globalThis.resourceMedia');const state=await cmd('getState');r.adBlocking=state.ok?state.data.adBlocking:null;r.runtimeErrors=d.errors.length;
  const last=r.samples.at(-1);r.completed=r.samples.length===12&&r.samples.every((s:any)=>s.page.visible&&!s.page.ad&&!s.page.error)&&last.page.playing&&last.page.time>1&&r.adBlocking?.enabled===true&&r.adBlocking?.scriptletStatus==='ready'&&r.runtimeErrors===0;
  const baseline=new Map(r.baseline.processes.map((p:any)=>[p.pid,p])),observed=new Map<number,any>();for(const s of r.samples)for(const p of s.processes)observed.set(p.pid,p);
  r.processSetStable=r.samples.every((s:any)=>s.processes.length===baseline.size&&s.processes.every((p:any)=>baseline.has(p.pid)));
  r.cpuSeconds=[...observed.values()].map(p=>({type:p.type,seconds:p.cpu!==null&&(baseline.get(p.pid) as any)?.cpu!==null?p.cpu-((baseline.get(p.pid) as any)?.cpu??0):null,newProcess:!baseline.has(p.pid)}));
  r.wallSeconds=(last.at-r.baseline.at)/1000;r.privateMiB=r.samples.map((s:any)=>s.processes.reduce((sum:number,p:any)=>sum+p.privateMiB,0));r.peakPrivateMiB=Math.max(...r.privateMiB);r.finalPrivateMiB=r.privateMiB.at(-1);r.stage='finished';save();
  console.log(JSON.stringify({completed:r.completed,version,clip,processSetStable:r.processSetStable,cpuSeconds:r.cpuSeconds,wallSeconds:r.wallSeconds,peakPrivateMiB:r.peakPrivateMiB,finalPrivateMiB:r.finalPrivateMiB,hidden:r.samples.filter((s:any)=>!s.page.visible).length,size:[last.page.width,last.page.height]}));if(!r.completed)process.exitCode=1;
 }catch(error){r.failure=(error as Error).name;r.failureReason=['UI not ready','Open failed','Foreground gate timeout','Visible content warmup failed','Reload failed'].find(s=>(error as Error).message.includes(s))??'measurement-evaluation';save();process.exitCode=1;console.error('Resource measurement stopped '+r.stage+' '+r.failureReason);}
 finally{await d.close();}
}
main().catch(()=>{console.error('Resource audit could not start');process.exitCode=1;});
