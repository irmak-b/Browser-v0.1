// Fresh owned sessions; categorical playback, process and visibility scalars.
// No site debugger: never occupy or detach the production filter connection.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpus } from 'node:os';
import version from '../app-version.json';
import { PackagedDriver } from '../tests/packaged/driver';

const wait=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));
function summarizeRun(row:any,logicalCpus:number,foreground:boolean){
 const key=(p:any)=>`${p.pid}:${p.creationTime}`;
 const eligible=(s:any)=>s.page.expectedClip&&s.page.visible&&s.window.visible&&s.window.focused&&
  s.window.bounds.width===1280&&s.window.bounds.height===900&&s.page.video?.playing&&
  s.page.video.time>1&&!s.page.ad&&!s.page.error?.displayed&&!s.page.video.errorCode&&
  (row.mode==='off'?s.adBlocking?.enabled===false:s.adBlocking?.enabled&&s.adBlocking.scriptletStatus==='ready');
 const intervals=[];
 for(let i=1;i<row.samples.length;i++){
  const a=row.samples[i-1],b=row.samples[i],before=new Map(a.processes.map((p:any)=>[key(p),p])),after=new Set(b.processes.map(key));
  let seconds=0,added=0,missing=0;const byType:Record<string,number>={};
  for(const p of b.processes){const old:any=before.get(key(p));if(!old){added++;continue;}
   if(p.cpuSeconds===null||old.cpuSeconds===null||p.cpuSeconds<old.cpuSeconds){missing++;continue;}
   const delta=p.cpuSeconds-old.cpuSeconds;seconds+=delta;byType[p.type]=(byType[p.type]??0)+delta;
  }
  const exited=a.processes.filter((p:any)=>!after.has(key(p))).length,wall=(b.atMs-a.atMs)/1000;
  const sameSize=a.page.video?.width===b.page.video?.width&&a.page.video?.height===b.page.video?.height;
  const qualified=foreground&&a.elapsedMs>=20000&&eligible(a)&&eligible(b)&&sameSize&&a.page.origin===b.page.origin&&b.page.video.time>a.page.video.time&&added===0&&exited===0&&missing===0;
  intervals.push({from:a.elapsedMs,to:b.elapsedMs,wallSeconds:wall,matchedCpuSeconds:seconds,byType,added,exited,missing,qualified,
   appHostPercentLowerBound:100*seconds/wall/logicalCpus,hostPercent:100*(1-(b.host.idle-a.host.idle)/(b.host.total-a.host.total)),
   size:[b.page.video?.width??0,b.page.video?.height??0],privateMiB:b.processes.reduce((sum:number,p:any)=>sum+p.privateMiB,0),
   totalFrameDelta:(b.page.video?.totalFrames??0)-(a.page.video?.totalFrames??0),droppedFrameDelta:(b.page.video?.droppedFrames??0)-(a.page.video?.droppedFrames??0)});
 }
 const qualified=intervals.filter(s=>s.qualified),wall=qualified.reduce((s,r)=>s+r.wallSeconds,0),cpu=qualified.reduce((s,r)=>s+r.matchedCpuSeconds,0);
 return {intervals,qualifiedSeconds:wall,qualifiedCpuSeconds:cpu,qualifiedHostPercent:wall?100*cpu/wall/logicalCpus:null,foregroundValid:foreground&&wall>=30,
  displayedErrorSamples:row.samples.filter((s:any)=>s.page.error?.displayed).length,
  targetContentSamples:row.samples.filter((s:any)=>s.page.expectedClip&&!s.page.ad&&s.page.video?.time>1).length,
  automaticNextSamples:row.samples.filter((s:any)=>s.page.youtube&&!s.page.expectedClip).length};
}
const read=String.raw`(()=>{
 const v=document.querySelector('video'),error=document.querySelector('.ytp-error');
 const text=error?.textContent??'',style=error?getComputedStyle(error):null,rect=error?.getBoundingClientRect();
 const quality=v?.getVideoPlaybackQuality?.();
 return {origin:performance.timeOrigin,expectedClip:new URL(location.href).searchParams.get('v')==='iTHUUjTA-LI',
  youtube:location.hostname==='www.youtube.com',consent:location.hostname==='consent.youtube.com',
  visible:document.visibilityState==='visible',
  video:v?{time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,playing:!v.paused,
   ended:v.ended,width:v.videoWidth,height:v.videoHeight,readyState:v.readyState,networkState:v.networkState,
   errorCode:v.error?.code??0,totalFrames:quality?.totalVideoFrames??null,droppedFrames:quality?.droppedVideoFrames??null}:null,
  error:{present:!!error,displayed:!!error&&style.display!=='none'&&style.visibility!=='hidden'&&!!rect.width&&!!rect.height,
   hasText:text.trim().length>0,adblock:/ad.?block|reklam engelley/i.test(text),retry:/try again|tekrar deney|hata olu|error occur/i.test(text),
   unavailable:/unavailable|kullanılamıyor/i.test(text),signIn:/sign in|oturum aç|not a bot/i.test(text),network:/network|internet|ağ bağlant/i.test(text)},
  ad:!!document.getElementById('movie_player')?.classList.contains('ad-showing')};
})()`;
async function main(){
 const output=process.argv[2],modes=(process.argv[3]??'on,off').split(','),seconds=Number(process.argv[4]??100),visibility=process.argv[5]??'background';
 const foreground=visibility==='foreground';
 if(!output||existsSync(output)||modes.some(mode=>!['on','off'].includes(mode))||modes.length>4||!['foreground','background'].includes(visibility)||!Number.isInteger(seconds)||seconds<30||seconds>180)throw Error('Fresh output, on/off modes, visibility and 30–180s required');
 const report:any={version:version.display,completed:false,visibility,logicalCpus:cpus().length,method:'One fresh packaged app per condition, same public 83.3s NASA starting link, native mute before navigation. Foreground requests one fixed1280x900 window, focused once per run; no always-on-top or focus stealing during sampling. DOM/video and cumulative process CPU/RAM scalars only. No site debugger attachment or Network domain, so the diagnostic cannot occupy the filter connection. CPU uses PID+creationTime cumulative seconds; churn intervals are lower bounds. Private commit MiB differs from Task Manager private working set. Host CPU is aggregate os.cpus counter delta, not an attribution to another application. No response bodies/headers, request URL trace, title text, account, real profile or tokens. Adaptive quality/network and finite samples mean no universal leak or causal speed claim; background runs are not foreground performance evidence.',requestedModes:modes,seconds,runs:[]};
 const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 for(const mode of modes){
  const driver=new PackagedDriver(),env:NodeJS.ProcessEnv={...process.env,BROWSER_CORE_INSTANCE_SCOPE:randomUUID()};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  const row:any={mode,completed:false,samples:[]};report.runs.push(row);save();
  const command=(name:string,...args:unknown[])=>driver.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
  try{
   await driver.launch(resolve(`artifacts/BrowserCore_${version.display}_Windows_x64/BrowserCore.exe`),env,false,[],{mainOnly:true,visible:foreground});
   let ready=false;for(let i=0;i<100;i++){try{if(await driver.evaluateUi('!!window.browser')){ready=true;break;}}catch{}await wait(50);}if(!ready)throw Error('UI readiness');
   await driver.evaluate(`(()=>{const w=require('electron').BrowserWindow.getAllWindows()[0];${foreground?"w.setSize(1280,900);w.setTitle('Browser Core · Kontrollü video ölçümü');w.show();w.focus();":"w.hide();"}})()`);
   const opened=await command('openTab','https://www.youtube.com/robots.txt');if(!opened.ok)throw Error('Open');
   await command('setTabMuted',opened.data.tabId,true);
   await command('setAdBlocking',opened.data.tabId,mode==='on');
   await driver.evaluate("globalThis.playerDiag={owner:require('electron').BrowserWindow.getAllWindows()[0].contentView.children.at(-1).webContents};void 0");
   // A toggle re-arms future document rules asynchronously. Let that settle
   // before explicitly preparing the measured navigation in the same contents.
   await wait(2000);
   const began=performance.now();await command('navigate',opened.data.tabId,'https://www.youtube.com/watch?v=iTHUUjTA-LI');
   if(foreground)await driver.evaluate('globalThis.playerDiag.owner.focus();void 0');
   let playRequested=false;
   for(let tick=0;performance.now()-began<seconds*1000;tick++){
    await wait(1000);
    if(!playRequested){
     const started=await driver.evaluate(`globalThis.playerDiag.owner.executeJavaScriptInIsolatedWorld(1006,[{code:'(()=>{const v=document.querySelector("video");if(!v)return false;v.muted=true;void v.play().catch(()=>{});return true;})()'}])`).catch(()=>false);
     playRequested=started;
    }
    if(tick%5===0){
     let page:any;try{page=await driver.evaluate(`globalThis.playerDiag.owner.executeJavaScriptInIsolatedWorld(1006,[{code:${JSON.stringify(read)}}])`);}catch{page={unavailable:true};}
     const state=await command('getState');
     const scalar=await driver.evaluate("(()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0];return {atMs:performance.now(),gpuFeatures:e.app.getGPUFeatureStatus(),window:{visible:w.isVisible(),focused:w.isFocused(),bounds:w.getBounds()},processes:e.app.getAppMetrics().map(p=>({pid:p.pid,creationTime:p.creationTime,type:p.type,cpuSeconds:p.cpu.cumulativeCPUUsage??null,privateMiB:(p.memory.privateBytes??0)/1024,workingSetMiB:p.memory.workingSetSize/1024}))};})()");
     const host=cpus().reduce((sum,cpu)=>({idle:sum.idle+cpu.times.idle,total:sum.total+Object.values(cpu.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});
     row.samples.push({elapsedMs:performance.now()-began,page,...scalar,host,adBlocking:state.ok?state.data.adBlocking:null,
      tabErrors:state.ok?state.data.tabs.map((tab:any)=>tab.errorCode).filter(Boolean):[]});save();
     if(page.consent){row.stopped='consent';break;}
    }
   }
   row.runtimeErrors=driver.errors.length;row.completed=!row.stopped&&row.samples.some((sample:any)=>sample.page.expectedClip&&sample.page.video?.time>1&&!sample.page.ad&&!sample.page.error?.displayed)&&row.samples.every((sample:any)=>!sample.page.error?.displayed&&!sample.page.video?.errorCode&&sample.tabErrors.length===0)&&row.runtimeErrors===0;
   row.summary=summarizeRun(row,report.logicalCpus,foreground);
   if(foreground&&!row.summary.foregroundValid)row.completed=false;
   console.log('PLAYER_ERROR_DIAG '+JSON.stringify({mode,completed:row.completed,samples:row.samples.length,last:row.samples.at(-1)}));
  }catch(error){row.failure=(error as Error).name;row.completed=false;process.exitCode=1;}
  finally{
   await driver.evaluate('delete globalThis.playerDiag;void 0').catch(()=>{});
   await driver.close();row.childExited=!!driver.child&&(driver.child.exitCode!==null||driver.child.signalCode!==null);save();
  }
 }
 report.completed=report.runs.length===modes.length&&report.runs.every((row:any)=>row.completed&&row.childExited);save();if(!report.completed)process.exitCode=1;
}
main().catch(()=>{console.error('Player error diagnosis could not start');process.exitCode=1;});
