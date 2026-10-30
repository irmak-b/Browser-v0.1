// One owned temporary packaged instance; bounded scalar timing only. No network
// payloads, headers, cookies, accounts, real profiles or URLs are exported.
import { resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import version from '../app-version.json';
import { PackagedDriver } from '../tests/packaged/driver';

const probe = String.raw`(()=>{
  if(window!==top||location.hostname!=='www.youtube.com')return;
  const a=globalThis.__videoTiming={origin:performance.timeOrigin,events:{},longTasks:[],adObserved:false,frames:0};
  const mark=n=>{if(a.events[n]===undefined){a.events[n]=performance.now();try{globalThis.__browserCoreTimingMark(JSON.stringify({origin:a.origin,event:n,time:a.events[n]}));}catch{}}};
  let observer;try{observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(a.longTasks.length<64)a.longTasks.push({start:e.startTime,duration:e.duration});});observer.observe({type:'longtask',buffered:true});}catch{}
  const bind=()=>{const v=document.querySelector('video');if(!v)return false;
    mark('videoElement');a.initialReadyState=v.readyState;
    for(const name of ['loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','stalled','error'])v.addEventListener(name,()=>mark(name),{once:true});
    v.muted=true;mark('playRequested');v.play().then(()=>mark('playResolved'),e=>{a.playRejected=e.name;});
    const frame=()=>{v.requestVideoFrameCallback((now,meta)=>{a.frames++;mark('firstObservedFrame');
      const ad=!!document.getElementById('movie_player')?.classList.contains('ad-showing');a.adObserved||=ad;
      if(!ad&&meta.mediaTime>0){mark('firstObservedContentFrame');a.contentMediaTime=meta.mediaTime;observer?.disconnect();}
      else if(a.frames<300)frame();});};if(v.requestVideoFrameCallback)frame();
    a.read=()=>({currentTime:v.currentTime,paused:v.paused,readyState:v.readyState,errorCode:v.error?.code??0});return true;};
  const mo=new MutationObserver(()=>{if(bind())mo.disconnect();});if(!bind())mo.observe(document,{childList:true,subtree:true});
  setTimeout(()=>{mo.disconnect();observer?.disconnect();},25000);
})();`;

async function main(){
  const output=process.argv[2],runCount=Number(process.argv[3]??3);if(!output||existsSync(output)||!Number.isInteger(runCount)||runCount<1||runCount>3)throw Error('New output and 1–3 runs required');
  const executable=resolve(`artifacts/BrowserCore_${version.display}_Windows_x64/BrowserCore.exe`);
  if(!existsSync(executable))throw Error('Existing packaged runtime required');
  const d=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const report:any={version:version.display,completed:false,requestedRuns:runCount,stage:'launch',method:'New site views in one fresh packaged app; adblock enabled. Document-start isolated-world probe, native media events; completion requires playing and advancing video time without ad class. Compositor callback is optional and not physical screen latency. Scalar navigation/resource timings only. First run cold; subsequent runs reuse session caches.',limits:'Small descriptive sample; instrumentation and public network vary. No off/on speed comparison. Cross-origin resource phase visibility may be restricted. No response/body/header/URL logging. Compositor callbacks can be absent; no first-frame claim in that case.',runs:[]};
  const save=()=>writeFileSync(output,JSON.stringify(report,null,2));
  const command=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
  try{
    await d.launch(executable,env,false,[],{mainOnly:true,visible:true});let ready=false;
    for(let i=0;i<100;i++){try{if(await d.evaluateUi("!!window.browser && document.body.innerText.includes('Browser Core bağlı')")){ready=true;break;}}catch{}await wait(50);}
    if(!ready)throw Error('UI readiness timeout');
    await d.evaluate("(()=>{const w=require('electron').BrowserWindow.getAllWindows()[0];w.show();w.focus();w.moveTop();})();");await wait(300);
    await d.evaluate(`(()=>{const e=require('electron');e.dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});
      globalThis.videoAudit={current:null,start:0};
      e.app.on('web-contents-created',(_event,w)=>{
        const a={w,events:[],documentRequests:[],documentMarks:[],commands:[],contexts:new Map(),setupMs:null};globalThis.videoAudit.current=a;
        const stamp=()=>performance.now()-globalThis.videoAudit.start;
        for(const n of ['dom-ready','did-finish-load'])w.on(n,()=>a.events.push({name:n,at:stamp()}));
        w.on('did-start-navigation',(_e,_url,inPlace,main)=>{if(main)a.events.push({name:'navigation',inPlace,at:stamp()});});
        const load=w.loadURL.bind(w);w.loadURL=(url,...args)=>{a.events.push({name:url==='about:blank'?'bootstrapLoad':'siteLoad',at:stamp()});return load(url,...args);};
        const send=w.debugger.sendCommand.bind(w.debugger);a.send=send;
        w.debugger.on('message',(_e,m,p)=>{
          if(m==='Runtime.executionContextCreated'&&p.context.name==='BrowserCoreVideoTiming')a.contexts.set(p.context.auxData?.frameId,p.context.id);
          if(m==='Runtime.executionContextsCleared')a.contexts.clear();
          if(m==='Runtime.bindingCalled'&&p.name==='__browserCoreTimingMark'&&[...a.contexts.values()].includes(p.executionContextId)&&a.documentMarks.length<100){try{const v=JSON.parse(p.payload);if(Number.isFinite(v.origin)&&Number.isFinite(v.time)&&['videoElement','playRequested','playResolved','loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','stalled','error','firstObservedFrame','firstObservedContentFrame'].includes(v.event))a.documentMarks.push({origin:v.origin,event:v.event,time:v.time});}catch{}}
          if(['Page.frameRequestedNavigation','Page.frameScheduledNavigation'].includes(m)&&p.frameId===a.frameId&&a.events.length<100)a.events.push({name:m,reason:p.reason,at:stamp()});
          if(m==='Network.requestWillBeSent'&&p.type==='Document'&&p.frameId===a.frameId&&a.documentRequests.length<8){
            const u=new URL(p.request.url),knownHosts=['www.youtube.com','consent.youtube.com','accounts.google.com'];
            a.documentRequests.push({at:stamp(),host:knownHosts.includes(u.hostname)?u.hostname:'other',path:['/watch','/signin','/sorry/index'].includes(u.pathname)?u.pathname:'other',requestedPublicVideo:u.searchParams.get('v')==='iTHUUjTA-LI',consentBailoutFlag:u.searchParams.has('ucbcb'),initiatorType:p.initiator.type,stack:(p.initiator.stack?.callFrames??[]).slice(0,5).map(f=>({script:f.url.includes('desktop_polymer')?'desktop_polymer':f.url.includes('/player/')?'youtube_player':f.url.includes('tceq_')?'tceq':f.url.startsWith('https://www.youtube.com/')?'youtube_other':'other',line:f.lineNumber,column:f.columnNumber})),redirectStatus:p.redirectResponse?.status??null});
          }
        });
        let installed=false;w.debugger.sendCommand=async(method,...args)=>{
          const start=stamp(),result=await send(method,...args);
          if(method.startsWith('Page.')&&a.commands.length<20)a.commands.push({method,start,end:stamp()});
          if(method==='Page.enable'&&!installed){installed=true;const setup=performance.now();await send('Runtime.enable');a.frameId=(await send('Page.getFrameTree')).frameTree.frame.id;await send('Network.enable');await send('Runtime.addBinding',{name:'__browserCoreTimingMark',executionContextName:'BrowserCoreVideoTiming'});await send('Page.addScriptToEvaluateOnNewDocument',{source:${JSON.stringify(probe)},worldName:'BrowserCoreVideoTiming'});a.setupMs=performance.now()-setup;}
          return result;
        };
      });})();`);
    for(let run=1;run<=runCount;run++){
      report.stage='run-'+run;const row:any={run,cold:run===1};report.runs.push(row);save();
      await d.evaluate('globalThis.videoAudit.start=performance.now();globalThis.videoAudit.startEpoch=Date.now();void 0');
      const opened=await command('openTab','https://www.youtube.com/watch?v=iTHUUjTA-LI');if(!opened.ok)throw Error('Open failed');
      const read=String.raw`(()=>{const a=globalThis.__videoTiming;if(!a)return {probe:false,consent:location.hostname==='consent.youtube.com'};
        const n=performance.getEntriesByType('navigation')[0],keys=['domainLookupStart','domainLookupEnd','connectStart','secureConnectionStart','connectEnd','requestStart','responseStart','responseEnd','domInteractive','domContentLoadedEventEnd','loadEventEnd'];
        const nav={};if(n)for(const k of keys)nav[k]=n[k];
        const resources=[];for(const r of performance.getEntriesByType('resource')){let u;try{u=new URL(r.name);}catch{continue;}let category;if(u.hostname.endsWith('.googlevideo.com')&&u.pathname==='/videoplayback')category='media';else if(u.hostname==='www.youtube.com'&&u.pathname.startsWith('/youtubei/v1/player'))category='playerAPI';else continue;if(resources.length<24)resources.push({category,start:r.startTime,end:r.responseEnd,duration:r.duration,requestStart:r.requestStart,responseStart:r.responseStart,transferSize:r.transferSize});}
        return {probe:true,origin:a.origin,events:a.events,initialReadyState:a.initialReadyState,adObserved:a.adObserved,frames:a.frames,contentMediaTime:a.contentMediaTime,playRejected:a.playRejected,video:a.read?.(),longTasks:a.longTasks,navigation:nav,resources,visibility:document.visibilityState,pageError:!!document.querySelector('.ytp-error'),adNow:!!document.getElementById('movie_player')?.classList.contains('ad-showing')};})()`;
      row.transientEvaluationFailures=0;
      for(let i=0;i<100;i++){
        await wait(200);
        let result:any;
        try{result=await d.evaluate(`(async()=>{const a=globalThis.videoAudit.current;if(!a||a.w.isDestroyed()||!a.w.debugger.isAttached())return {probe:false};const tree=await a.send('Page.getFrameTree');const contextId=a.contexts.get(tree.frameTree.frame.id);if(!contextId)return {probe:false};const r=await a.send('Runtime.evaluate',{expression:${JSON.stringify(read)},contextId,returnByValue:true});return r.result?.value??{probe:false};})()`);}
        catch{row.transientEvaluationFailures++;continue;}
        row.page=result;
        if(result.events?.playing!==undefined&&result.video?.currentTime>0.1&&!result.video.paused&&!result.adNow||result.consent||result.pageError)break;
      }
      row.main=await d.evaluate(`(()=>{const a=globalThis.videoAudit.current,w=require('electron').BrowserWindow.getAllWindows()[0];return {startEpoch:globalThis.videoAudit.startEpoch,probeSetupMs:a.setupMs,events:a.events,documentRequests:a.documentRequests,documentMarks:a.documentMarks,commands:a.commands,window:{visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),views:w.contentView.children.map(v=>({visible:v.getVisible(),bounds:v.getBounds()}))}};})()`);
      const state=await command('getState');row.adblock=state.ok?state.data.adBlocking:null;
      row.complete=row.page?.events?.playing!==undefined&&row.page.video?.currentTime>0.1&&!row.page.video.paused&&!row.page.adNow&&!row.page.adObserved&&!row.page.video?.errorCode&&row.adblock?.enabled===true&&row.adblock?.scriptletStatus==='ready'&&row.page.visibility==='visible';
      save();console.log(JSON.stringify({run,complete:row.complete,events:row.page?.events,navigation:row.page?.navigation,probeSetupMs:row.main.probeSetupMs}));
      await command('closeTab',opened.data.tabId);await wait(1200);
      if(!row.complete)break;
    }
    report.completed=report.runs.length===runCount&&report.runs.every((r:any)=>r.complete);report.runtimeErrorCount=d.errors.length;report.stage='finished';save();if(!report.completed||d.errors.length)process.exitCode=1;
  }catch(error){report.failure=(error as Error).name;save();process.exitCode=1;console.error('Video timing audit stopped at '+report.stage);}
  finally{await d.close();}
}
main().catch(()=>{console.error('Video timing audit could not start');process.exitCode=1;});
