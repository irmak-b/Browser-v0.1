// Descriptive real-site lifecycle audit of an unchanged packaged app. Main
// inspector only; no renderer automation port, profiler, payloads or profiles.
import { existsSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { cpus } from 'node:os';
import { resolve, sep } from 'node:path';
import version from '../app-version.json';
import { PackagedDriver } from '../tests/packaged/driver';

const wait = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const pageProbe = String.raw`(() => {
  const video=document.querySelector('video'), player=document.getElementById('movie_player');
  const quality=video?.getVideoPlaybackQuality?.();
  return {origin:performance.timeOrigin,visible:document.visibilityState==='visible',ready:document.readyState==='complete',
    bodyCharacters:document.body?.textContent?.length??0,
    interstitial:/just a moment|verify you|checking your browser|access denied|attention required/i.test(document.title),
    consent:location.hostname==='consent.youtube.com',
    pageError:!!document.querySelector('.ytp-error'),ad:!!player?.classList.contains('ad-showing'),
    video:video?{playing:!video.paused,time:video.currentTime,width:video.videoWidth,height:video.videoHeight,
      totalFrames:quality?.totalVideoFrames??null,droppedFrames:quality?.droppedVideoFrames??null,
      readyState:video.readyState,errorCode:video.error?.code??0}:null};
})()`;

interface ProcessRow { pid: number; creationTime: number; type: string; cpuSeconds: number | null; privateMiB: number; workingSetMiB: number }
interface Sample { phase: string; cycle: number; atMs: number; atUtc: string; processes: ProcessRow[]; privateMiB: number; workingSetMiB: number; [key: string]: any }
function cpuInterval(previous: Sample, current: Sample, logicalCpus: number) {
  const key=(row: ProcessRow)=>`${row.pid}:${row.creationTime}`;
  const before=new Map(previous.processes.map(row=>[key(row),row]));
  const after=new Set(current.processes.map(key));
  let seconds=0, missing=0, added=0;
  const byType: Record<string, number>={};
  for(const row of current.processes){
    const old=before.get(key(row));
    if(!old){added++;continue;}
    if(row.cpuSeconds===null||old.cpuSeconds===null){missing++;continue;}
    const delta=row.cpuSeconds-old.cpuSeconds;
    if(!Number.isFinite(delta)||delta<0){missing++;continue;}
    seconds+=delta;byType[row.type]=(byType[row.type]??0)+delta;
  }
  const exited=previous.processes.filter(row=>!after.has(key(row))).length;
  const wallSeconds=(current.atMs-previous.atMs)/1000;
  return {wallSeconds,matchedCpuSeconds:seconds,byType,added,exited,missing,
    stable:added===0&&exited===0&&missing===0,
    appHostPercentLowerBound:100*seconds/wallSeconds/logicalCpus,
    coreEquivalentsLowerBound:seconds/wallSeconds};
}

async function main(){
  const [argument,mode='live']=process.argv.slice(2);
  if(!argument||!['live','selfcheck'].includes(mode))throw Error('New report and live/selfcheck mode required');
  const output=resolve(argument),evidenceRoot=resolve('docs/evidence')+sep;
  if(!output.startsWith(evidenceRoot)||!output.endsWith('.json')||existsSync(output))throw Error('Fresh workspace evidence path required');
  const stop=output+'.stop';if(existsSync(stop))throw Error('Stale stop marker');
  const executable=resolve(`artifacts/BrowserCore_${version.display}_Windows_x64/BrowserCore.exe`);
  if(!existsSync(executable))throw Error('Existing package required; no download started');
  const selfcheck=mode==='selfcheck';
  const durations=selfcheck?{baseline:1000,news:800,video:1200,closed:6500,final:1000,interval:500,cycles:2}
    :{baseline:30000,news:60000,video:120000,closed:60000,final:90000,interval:5000,cycles:4};
  const driver=new PackagedDriver(),env={...process.env};
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  const report:any={version:version.display,mode,completed:false,stage:'setup',startedAtUtc:new Date().toISOString(),
    durations,logicalCpus:cpus().length,
    method:'One fresh packaged instance, adblock/cache and production resource policies unchanged. Fixed visible 1280x900 window in live mode, muted public video. Four cycles: three news pages/60s, alternating public NASA or Big Buck Bunny video/120s, all filled tabs closed/60s. First cycle warmup. Main inspector and periodic scalar probes add overhead. No profiler, forced GC, cache clearing, power change or renderer automation connection.',
    memoryMeaning:'Summed Electron private bytes = private commit MiB on Windows; working sets include shared pages and can double count. Neither is Task Manager private working set.',
    cpuMeaning:'Cumulative CPU seconds differenced by PID+creationTime, normalized by wall time and logical CPUs. Only matched processes contribute; churn intervals are lower bounds and explicitly marked. No app.getAppMetrics percentCPUUsage interval dependency.',
    privacy:'Only fresh test-session public pages; no account, real profile, cookie, token, response body, request URL trace, title text or history entries exported.',
    limits:'Finite descriptive run, not proof all leaks are absent or a causal before/after speedup. Network, adaptive quality, occlusion, other apps and instrumentation may affect results. No native thermal/frequency or GPU-utilization capture. Selfcheck uses local canvas stream and is not real-site evidence.',
    cycles:[],samples:[]};
  let server: Server|undefined;
  let sampleIndex=0;
  let previousHost: {idle:number;total:number}|undefined;
  let previousSample: Sample|undefined;
  const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  const checkStop=()=>{if(existsSync(stop))throw Error('operator-stop');};
  const command=(name:string,...args:unknown[])=>driver.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
  const activeProbe=()=>driver.evaluate(`globalThis.soak.active.executeJavaScriptInIsolatedWorld(1006,[{code:${JSON.stringify(pageProbe)}}])`);
  async function sample(phase:string,cycle:number,detail=false,video=false){
    checkStop();
    const scalar=await driver.evaluate(`(async()=>{
      const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0],ui=w.webContents,rows=e.app.getAppMetrics(),old=globalThis.soak.closed,session=globalThis.soak.session;
      const events=['context-menu','audio-state-changed','will-prevent-unload','enter-html-full-screen','leave-html-full-screen','did-start-navigation','will-frame-navigate','will-redirect','did-redirect-navigation','did-navigate','did-finish-load','did-stop-loading','page-title-updated','did-navigate-in-page','did-fail-load','render-process-gone','unresponsive','responsive','before-input-event','before-mouse-event','zoom-changed','destroyed','dom-ready'];
      return {atMs:performance.now(),atUtc:new Date().toISOString(),processes:rows.map(p=>({pid:p.pid,creationTime:p.creationTime,type:p.type,cpuSeconds:p.cpu.cumulativeCPUUsage??null,privateMiB:(p.memory.privateBytes??0)/1024,workingSetMiB:p.memory.workingSetSize/1024})),
        privateMiB:rows.reduce((s,p)=>s+(p.memory.privateBytes??0)/1024,0),workingSetMiB:rows.reduce((s,p)=>s+p.memory.workingSetSize/1024,0),
        mainHeapMiB:process.memoryUsage().heapUsed/1048576,mainExternalMiB:process.memoryUsage().external/1048576,
        liveSiteContents:e.webContents.getAllWebContents().filter(c=>c!==ui).length,nativeViews:w.contentView.children.length,
        oldCount:old.length,oldDestroyed:old.every(c=>c.isDestroyed()),oldListeners:old.reduce((sum,c)=>sum+events.reduce((n,event)=>n+c.listenerCount(event),0),0),
        uiInputListeners:ui.listenerCount('before-input-event'),uiDestroyedListeners:ui.listenerCount('destroyed'),
        window:{visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized(),bounds:w.getBounds()},
        onBattery:e.powerMonitor.isOnBatteryPower(),
        cacheBytes:${detail}&&session?await session.getCacheSize():null,
        sessionMemoryOnly:session?!session.isPersistent()&&session.storagePath===null:null};
    })()`);
    const host=cpus().reduce((sum,cpu)=>{const times=cpu.times;sum.idle+=times.idle;sum.total+=times.user+times.nice+times.sys+times.idle+times.irq;return sum;},{idle:0,total:0});
    const hostPercent=previousHost&&host.total>previousHost.total?100*(1-(host.idle-previousHost.idle)/(host.total-previousHost.total)):null;
    previousHost=host;
    const row:Sample={index:sampleIndex++,phase,cycle,...scalar,hostCpuPercent:hostPercent};
    if(previousSample)row.cpu=cpuInterval(previousSample,row,report.logicalCpus);
    if(detail){
      const resources=await command('getResources'),state=await command('getState');
      if(!resources.ok||!state.ok)throw Error('sample-command-failed');
      row.workers=resources.data.backgroundWorkers;row.idleMemory=resources.data.idleMemory;
      row.tabs=state.data.tabs.map((tab:any)=>({status:tab.status,loading:tab.loading,frozen:!!tab.frozen,errorCode:tab.errorCode}));
      row.historyCount=state.data.history.entries.length;row.adBlocking=state.data.adBlocking;
    }
    if(video){try{row.video=await activeProbe();}catch{row.video={probeUnavailable:true};}}
    previousSample=row;report.samples.push(row);save();
    if(!selfcheck&&phase==='video'&&row.tabs?.some((tab:any)=>tab.errorCode==='RENDER_PROCESS_UNRESPONSIVE')&&row.video?.visible===false)throw Error('video-hidden-by-core-warning');
    return row;
  }
  async function period(phase:string,cycle:number,ms:number,video=false){
    report.stage=phase+'-'+cycle;save();const started=performance.now();
    await sample(phase,cycle,true,video);
    for(let tick=1;performance.now()-started<ms;tick++){
      await wait(Math.max(0,Math.min(ms,tick*durations.interval)-(performance.now()-started)));
      await sample(phase,cycle,tick*durations.interval>=ms||tick%3===0,video&&tick%3===0);
    }
  }
  async function open(label:string,url:string){
    checkStop();const began=performance.now();
    const opened=await command('openTab',url);if(!opened.ok)throw Error('open-failed');
    await command('setTabMuted',opened.data.tabId,true);
    await driver.evaluate(`(()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0];const site=w.contentView.children.at(-1).webContents;globalThis.soak.active=site;globalThis.soak.session=site.session;globalThis.soak.contents.push({label:${JSON.stringify(label)},wc:site});})();`);
    let tab:any;
    for(let attempt=0;attempt<(selfcheck?25:120);attempt++){
      const s=await command('getState');if(!s.ok)throw Error('state-failed');
      tab=s.data.tabs.find((t:any)=>t.tabId===opened.data.tabId);
      if(!tab||['ready','error','stopped'].includes(tab.status))break;
      checkStop();await wait(selfcheck?100:500);
    }
    let content:any={probeUnavailable:true};try{content=await activeProbe();}catch{}
    return {id:opened.data.tabId,label,loadObservedMs:performance.now()-began,status:tab?.status??'missing',errorCode:tab?.errorCode??null,content};
  }
  try{
    let news=[{label:'technopat',url:'https://www.technopat.net/'},{label:'donanimhaber',url:'https://www.donanimhaber.com/'},{label:'sozcu',url:'https://www.sozcu.com.tr/'}];
    let videos=[{label:'nasa',url:'https://www.youtube.com/watch?v=iTHUUjTA-LI'},{label:'bunny',url:'https://www.youtube.com/watch?v=aqz-KE-bpKQ'}];
    if(selfcheck){
      server=createServer((req,res)=>{
        res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
        if(req.url==='/video')res.end('<!doctype html><title>Local probe</title><canvas width="64" height="64"></canvas><video autoplay muted></video><script>const c=document.querySelector("canvas"),v=document.querySelector("video");v.srcObject=c.captureStream(10);setInterval(()=>{const x=c.getContext("2d");x.fillStyle=Date.now()%2?"red":"blue";x.fillRect(0,0,64,64)},100);</script>');
        else res.end('<!doctype html><title>Local probe</title><p>Only local fixture data.</p>');
      });
      await new Promise<void>(done=>server!.listen(0,'127.0.0.1',done));
      const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
      news=news.map((site,index)=>({label:site.label,url:origin+'/page'+index}));videos=videos.map(clip=>({label:clip.label,url:origin+'/video'}));
    }
    await driver.launch(executable,env,false,[],{mainOnly:true,visible:!selfcheck});
    let ready=false;
    for(let i=0;i<100;i++){try{if(await driver.evaluateUi('!!window.browser')){ready=true;break;}}catch{}await wait(50);}
    if(!ready)throw Error('ui-not-ready');
    const initial=await command('getState');if(!initial.ok||initial.data.appVersion!==version.display)throw Error('version-mismatch');
    report.rootPid=driver.child.pid;
    await driver.evaluate(`(()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0];globalThis.soak={contents:[],closed:[],session:null,active:null};w.setSize(1280,900);w.setTitle(${JSON.stringify('Kaynak ölçümü · '+version.display)});${selfcheck?'w.hide();':'w.show();w.focus();w.moveTop();'}e.dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});})();`);
    await period('baseline',0,durations.baseline);
    for(let cycle=1;cycle<=durations.cycles;cycle++){
      const row:any={cycle,warmup:cycle===1,news:[],video:null,teardownClean:false};report.cycles.push(row);
      for(const site of news){
        const page=await open(site.label,site.url);row.news.push({...page,id:undefined});
        (row.ids??=[]).push(page.id);save();
      }
      await period('news',cycle,durations.news);
      const clip=videos[(cycle-1)%videos.length]!;
      const video=await open(clip.label,clip.url);row.ids.push(video.id);row.video={...video,id:undefined};
      const start=performance.now();let playing=false;row.video.adObserved=!!video.content.ad;
      for(let i=0;i<(selfcheck?20:60);i++){
        await driver.evaluate("globalThis.soak.active.executeJavaScriptInIsolatedWorld(1006,[{code:'(()=>{const v=document.querySelector(\"video\");if(v){v.muted=true;if(v.paused)void v.play().catch(()=>{});}return true;})()'}])").catch(()=>{});
        let probe:any;try{probe=await activeProbe();}catch{probe={probeUnavailable:true};}
        row.video.lastWarmup=probe;row.video.adObserved||=!!probe.ad;save();
        if(probe.video?.playing&&probe.video.time>0.5&&!probe.ad&&!probe.video.errorCode){playing=true;break;}
        if(probe.consent||probe.pageError)break;
        checkStop();await wait(selfcheck?100:1000);
      }
      row.video.playingObserved=playing;row.video.warmupObservedMs=performance.now()-start;
      // Preserve partial failure evidence, but do not count an error screen as playback.
      if(playing)await period('video',cycle,durations.video,true);
      await driver.evaluate('globalThis.soak.closed=globalThis.soak.contents.map(entry=>entry.wc);void 0');
      for(const id of row.ids){const closed=await command('closeTab',id);if(!closed.ok)throw Error('close-refused');}
      delete row.ids;await driver.evaluate('globalThis.soak.active=null;globalThis.soak.contents=[];void 0');
      await period('closed',cycle,durations.closed);
      const end=await sample('closed-final',cycle,true);
      row.teardownClean=end.liveSiteContents===0&&end.nativeViews===0&&end.oldCount===4&&end.oldDestroyed&&end.oldListeners===0&&end.workers?.every((worker:any)=>worker.running===0);
      row.closedSampleIndex=end.index;
      console.log('SOAK_CYCLE '+JSON.stringify({cycle,videoPlaying:playing,closedPrivateMiB:end.privateMiB,views:end.nativeViews,oldListeners:end.oldListeners,workers:end.workers,teardownClean:row.teardownClean}));
      await driver.evaluate('globalThis.soak.closed=[];void 0');save();
      if(!row.teardownClean||!playing){report.stopped=!playing?'video-not-playing':'lifecycle-residue';break;}
    }
    await period('final-idle',0,durations.final);
    report.videoSampleCount=report.samples.filter((sample:any)=>sample.phase==='video'&&!!sample.video&&!sample.video.probeUnavailable).length;
    report.foregroundVideoSamples=report.samples.filter((sample:any)=>sample.phase==='video'&&!!sample.video).map((sample:any)=>({index:sample.index,visible:sample.video.visible===true,focused:sample.window.focused===true,coreWarning:sample.tabs?.some((tab:any)=>tab.errorCode==='RENDER_PROCESS_UNRESPONSIVE')??false}));
    report.foregroundVideoValid=selfcheck?null:report.foregroundVideoSamples.length>0&&report.foregroundVideoSamples.every((sample:any)=>sample.visible&&sample.focused&&!sample.coreWarning);
    report.completed=report.cycles.length===durations.cycles&&report.cycles.every((row:any)=>row.teardownClean&&row.video.playingObserved&&row.news.every((page:any)=>page.status==='ready'&&!page.content.interstitial&&!page.content.probeUnavailable)
      &&report.samples.some((sample:any)=>sample.cycle===row.cycle&&sample.phase==='video'&&!!sample.video&&!sample.video.probeUnavailable));
    report.runtimeErrorCount=driver.errors.length;report.completed&&=report.runtimeErrorCount===0;
    if(!selfcheck)report.completed&&=report.foregroundVideoValid===true;
    report.stage='finished';report.finishedAtUtc=new Date().toISOString();save();
    console.log('SOAK_DONE '+JSON.stringify({completed:report.completed,cycles:report.cycles.length,samples:report.samples.length,runtimeErrorCount:report.runtimeErrorCount}));
    if(!report.completed)process.exitCode=1;
  }catch(error){
    report.failureCategory=(error as Error).name;
    const known=['operator-stop','sample-command-failed','open-failed','state-failed','ui-not-ready','version-mismatch','close-refused','video-hidden-by-core-warning'];
    report.failureReason=known.find(reason=>(error as Error).message===reason)??'measurement-evaluation';
    report.failedAtStage=report.stage;report.stage='failed';save();process.exitCode=1;console.error('SOAK_STOP '+report.failureReason);
  }finally{
    await driver.close();
    if(server){server.closeAllConnections();await new Promise<void>(done=>server!.close(()=>done()));}
    report.cleanup={childExited:!!driver.child&&(driver.child.exitCode!==null||driver.child.signalCode!==null),runtimeErrorCount:driver.errors.length};save();
  }
}
main().catch(()=>{console.error('Real-site audit initialization failed');process.exitCode=1;});
