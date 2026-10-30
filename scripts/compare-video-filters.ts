// Bounded ABBA audit of our own packaged child processes. Only scalar public
// fixture timings/categories are exported, never headers, bodies or profiles.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import version from '../app-version.json';
import { PackagedDriver } from '../tests/packaged/driver';

const probe=String.raw`(()=>{
  if(window!==top||location.hostname!=='www.youtube.com')return;
  const a=globalThis.__filterAudit={origin:performance.timeOrigin,events:{},tasks:[],swControlled:!!navigator.serviceWorker?.controller,theme:{prefersDark:matchMedia('(prefers-color-scheme: dark)').matches}};
  const mark=n=>{if(a.events[n]!==undefined)return;a.events[n]=performance.now();try{globalThis.__filterAuditMark(JSON.stringify({origin:a.origin,event:n,time:a.events[n]}));}catch{}};
  navigator.serviceWorker?.addEventListener('controllerchange',()=>mark('serviceWorkerControllerChange'));
  let po;try{po=new PerformanceObserver(l=>{for(const e of l.getEntries())if(a.tasks.length<128)a.tasks.push({start:e.startTime,duration:e.duration});});po.observe({type:'longtask',buffered:true});}catch{}
  const bind=()=>{const v=document.querySelector('video');if(!v)return false;mark('videoElement');a.theme.darkAtVideo=!!document.documentElement?.hasAttribute('dark');v.muted=true;
    for(const n of ['loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','stalled','error'])v.addEventListener(n,()=>mark(n),{once:true});
    mark('playRequested');v.play().then(()=>mark('playResolved'),e=>{a.playRejected=e.name;});
    a.decodeSamples=[];let count=0;const frame=()=>{v.requestVideoFrameCallback((_now,m)=>{count++;mark('firstFrame');if(globalThis.__filterDeep&&a.decodeSamples.length<16&&Number.isFinite(m.processingDuration))a.decodeSamples.push(m.processingDuration*1000);const ad=!!document.getElementById('movie_player')?.classList.contains('ad-showing');if(ad)mark('adSeen');if(!ad&&m.mediaTime>0)mark('firstContentFrame');if((globalThis.__filterDeep&&count<16)||(!a.events.firstContentFrame&&count<300))frame();});};if(v.requestVideoFrameCallback)frame();
    a.read=()=>{const q=v.getVideoPlaybackQuality?.();return {time:v.currentTime,paused:v.paused,readyState:v.readyState,error:v.error?.code??0,width:v.videoWidth,height:v.videoHeight,totalFrames:q?.totalVideoFrames,droppedFrames:q?.droppedVideoFrames,decodeSamplesMs:a.decodeSamples};};return true;};
  const mo=new MutationObserver(()=>{if(bind())mo.disconnect();});if(!bind())mo.observe(document,{childList:true,subtree:true});setTimeout(()=>{mo.disconnect();po?.disconnect();},22000);
})();`;

async function main(){
  const output=process.argv[2],sequence=(process.argv[3]??'on').split(','),deep=process.argv[4]==='deep';
  if(!output||existsSync(output)||sequence.length>4||!sequence.length||sequence.some(m=>!['on','off','on-light','off-light'].includes(m)))throw Error('New output and bounded known modes required');
  const executable=resolve(`artifacts/BrowserCore_${version.display}_Windows_x64/BrowserCore.exe`);if(!existsSync(executable))throw Error('Existing package required');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const report:any={version:version.display,completed:false,sequence,observationMs:12000,method:'One fresh packaged process/session per case; same robots.txt warmup then fixed public NASA video, muted play requested as video appears. UI site preference controls whole filter. Network/body/header/cookie/URL traces excluded; only allowlisted categories, scalar media events and JS function names. No user profile. On-light emulates prefers-color-scheme light in the diagnostic site only; filter remains enabled. One case per invocation is recommended; multi-process startup failure is recorded, never retried indefinitely.',limits:'Descriptive single-machine finite samples; ads/consent can confound content timings and are labeled. Callback is not physical first screen pixel. Fresh processes still share OS/network caches. Hidden samples disqualify speed comparison, not the recorded navigation event itself. No speed percentage claim.',cases:[]};
  report.deep=deep;if(deep)report.deepMethod='12s V8 sampling profile,1ms requested interval. Raw profile never exported: only categories and bounded function-name totals. Filter stack inclusive samples may include native work that would run without a filter. Network records only document/media/playerAPI numeric timings, no headers/bodies/query strings. Media decoder property allowlist plus up to16 frame processingDuration samples. Light modes isolate the already-known theme reload; normal app theme is unchanged.';
  const save=()=>writeFileSync(output,JSON.stringify(report,null,2));
  for(const [index,mode]of sequence.entries()){
    const d=new PackagedDriver(),row:any={case:index+1,mode,complete:false,stage:'launch'};report.cases.push(row);save();
    const command=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
    try{
      await d.launch(executable,env,false,[],{mainOnly:true,visible:true});let ready=false;
      for(let i=0;i<100;i++){try{if(await d.evaluateUi("!!window.browser && document.body.innerText.includes('Browser Core bağlı')")){ready=true;break;}}catch{}await wait(50);}if(!ready)throw Error('UI readiness timeout');
      await d.evaluate(String.raw`(()=>{const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0];win.show();win.focus();win.moveTop();e.dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});
        globalThis.filterAudit={current:null,start:performance.now(),epoch:Date.now()};
        e.app.on('web-contents-created',(_event,w)=>{
          const a={w,events:[],requests:[],responses:[],marks:[],contexts:new Map(),setupMs:0,net:[],lookup:new Map(),media:[],propertyNames:new Set(),players:new Map()};globalThis.filterAudit.current=a;
          const stamp=()=>performance.now()-globalThis.filterAudit.start;
          const safeTarget=url=>{try{const u=new URL(url);return {host:['www.youtube.com','consent.youtube.com','accounts.google.com'].includes(u.hostname)?u.hostname:'other',watch:u.pathname==='/watch',samePublicVideo:u.searchParams.get('v')==='iTHUUjTA-LI'};}catch{return {host:'other',watch:false,samePublicVideo:false};}};
          const category=url=>url.includes('desktop_polymer')?'desktop_polymer':url.includes('/player/')?'player':url.startsWith('https://www.youtube.com/s/')?'youtube_static':url.startsWith('https://www.youtube.com/')?'youtube_document':'other';
          const load=w.loadURL.bind(w);w.loadURL=(url,...args)=>{if(a.events.length<80)a.events.push({name:'appLoadURL',at:stamp(),target:safeTarget(url)});return load(url,...args);};
          w.on('did-start-navigation',(_e,_u,inPlace,main)=>{if(main&&a.events.length<80)a.events.push({name:'navigation',at:stamp(),inPlace});});
          w.on('dom-ready',()=>{if(a.events.length<80)a.events.push({name:'domReady',at:stamp()});});
          const send=w.debugger.sendCommand.bind(w.debugger);a.send=send;
          w.debugger.on('message',(_e,m,p)=>{
            if(${deep}){
              if(m==='Network.requestWillBeSent'&&a.net.length<64){
                try{const u=new URL(p.request.url),kind=p.type==='Document'?'document':u.hostname.endsWith('.googlevideo.com')&&u.pathname==='/videoplayback'?'media':u.hostname==='www.youtube.com'&&u.pathname.startsWith('/youtubei/v1/player')?'playerAPI':null;
                  if(p.type==='Document'&&p.frameId===a.frameId&&a.netBase===undefined)a.netBase=p.timestamp;
                  if(kind){const r={kind,start:p.timestamp};a.lookup.set(p.requestId,r);a.net.push(r);}
                }catch{}
              }
              const r=a.lookup.get(p.requestId);
              if(r&&m==='Network.responseReceived'){r.response=p.timestamp;r.status=p.response.status;r.diskCache=!!p.response.fromDiskCache;r.serviceWorker=!!p.response.fromServiceWorker;const t=p.response.timing;if(t){r.timing={};for(const k of ['requestTime','dnsStart','dnsEnd','connectStart','connectEnd','sslStart','sslEnd','sendStart','sendEnd','receiveHeadersStart','receiveHeadersEnd'])if(Number.isFinite(t[k]))r.timing[k]=t[k];}}
              if(r&&m==='Network.dataReceived'){if(r.firstData===undefined)r.firstData=p.timestamp;r.payloadBytes=(r.payloadBytes??0)+p.dataLength;}
              if(r&&m==='Network.loadingFinished'){r.end=p.timestamp;r.encodedBytes=p.encodedDataLength;}
              if(r&&m==='Network.loadingFailed'){r.failed=true;r.cancelled=!!p.canceled;r.error=/^net::ERR_[A-Z_]+$/.test(p.errorText)?p.errorText:'other';}
              if(m==='Media.playerPropertiesChanged'){
                if(!a.players.has(p.playerId)&&a.players.size<8)a.players.set(p.playerId,a.players.size+1);
                for(const v of p.properties){if(a.propertyNames.size<64&&/^[a-zA-Z0-9_]{1,80}$/.test(v.name))a.propertyNames.add(v.name);
                  if(a.media.length<80&&['kVideoDecoderName','kIsPlatformVideoDecoder','kAudioDecoderName','kIsPlatformAudioDecoder','kResolution','kFrameSize'].includes(v.name)&&/^[a-zA-Z0-9_ .x-]{1,80}$/.test(v.value))a.media.push({at:stamp(),player:a.players.get(p.playerId),name:v.name,value:v.value});
                }
              }
            }
            if(m==='Runtime.executionContextCreated'&&p.context.name==='BrowserCoreFilterAudit')a.contexts.set(p.context.auxData?.frameId,p.context.id);
            if(m==='Runtime.executionContextsCleared')a.contexts.clear();
            if(m==='Runtime.bindingCalled'&&p.name==='__filterAuditMark'&&[...a.contexts.values()].includes(p.executionContextId)&&a.marks.length<100){try{const v=JSON.parse(p.payload);if(Number.isFinite(v.origin)&&Number.isFinite(v.time)&&['videoElement','loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','stalled','error','playRequested','playResolved','firstFrame','firstContentFrame','adSeen','serviceWorkerControllerChange'].includes(v.event))a.marks.push({origin:v.origin,event:v.event,time:v.time});}catch{}}
            if(['Page.frameRequestedNavigation','Page.frameScheduledNavigation'].includes(m)&&p.frameId===a.frameId&&a.events.length<80)a.events.push({name:m,reason:p.reason,at:stamp(),target:safeTarget(p.url)});
            if(m==='Network.requestWillBeSent'&&p.type==='Document'&&p.frameId===a.frameId&&a.requests.length<8){
              const frames=(p.initiator.stack?.callFrames??[]).slice(0,8);
              a.requests.push({at:stamp(),target:safeTarget(p.request.url),initiator:p.initiator.type,redirectStatus:p.redirectResponse?.status??null,stack:frames.map(f=>({script:category(f.url),fn:/^[a-zA-Z0-9_.$]{0,64}$/.test(f.functionName)?f.functionName:'other',line:f.lineNumber,column:f.columnNumber}))});
            }
            if(m==='Network.responseReceived'&&p.type==='Document'&&p.frameId===a.frameId&&a.responses.length<8)a.responses.push({at:stamp(),status:p.response.status,fromServiceWorker:!!p.response.fromServiceWorker});
          });
          let installed=false;w.debugger.sendCommand=async(method,params,...args)=>{
            const actual=(${deep}&&method==='Page.addScriptToEvaluateOnNewDocument'&&!params?.worldName)?{...params,source:params.source+'\n//# sourceURL=browsercore-filter-diagnostic.js'}:params;
            const result=await send(method,actual,...args);
            if(method==='Page.enable'&&!installed){installed=true;const start=performance.now();await send('Runtime.enable');a.frameId=(await send('Page.getFrameTree')).frameTree.frame.id;await send('Network.enable');if(${deep}){await send('Media.enable');await send('Profiler.enable');await send('Profiler.setSamplingInterval',{interval:1000});}if(${JSON.stringify(mode.endsWith('-light'))})await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});await send('Runtime.addBinding',{name:'__filterAuditMark',executionContextName:'BrowserCoreFilterAudit'});await send('Page.addScriptToEvaluateOnNewDocument',{source:${JSON.stringify('globalThis.__filterDeep='+deep+';'+probe+'\n//# sourceURL=browsercore-audit-diagnostic.js')},worldName:'BrowserCoreFilterAudit'});a.setupMs=performance.now()-start;}
            return result;
          };
        });})();`);
      row.stage='warmup';const opened=await command('openTab','https://www.youtube.com/robots.txt');if(!opened.ok)throw Error('Warmup open failed');
      let warmed=false;for(let i=0;i<150;i++){try{if(await d.evaluate("(()=>{const a=globalThis.filterAudit.current;return !!a?.frameId&&a.w.getURL()==='https://www.youtube.com/robots.txt'&&!a.w.isLoading();})()")){warmed=true;break;}}catch{}await wait(50);}if(!warmed)throw Error('Warmup timeout');
      const setting=await command('setAdBlocking',opened.data.tabId,!mode.startsWith('off'));if(!setting.ok)throw Error('Filter setting failed');
      await wait(100);
      await d.evaluate("(()=>{const w=require('electron').BrowserWindow.getAllWindows()[0];w.setAlwaysOnTop(true);w.show();w.focus();w.moveTop();})();");await wait(200);
      let visibleReady=false;
      for(let i=0;i<60;i++){
        if(i%10===0)await d.evaluate("(()=>{const a=globalThis.filterAudit.current,w=require('electron').BrowserWindow.getAllWindows()[0];w.focus();a.w.focus();})();");
        try{if(await d.evaluate("globalThis.filterAudit.current.w.executeJavaScript('document.visibilityState===\"visible\"')")){visibleReady=true;break;}}catch{}await wait(100);
      }
      row.visibleBeforeNavigation=visibleReady;
      await d.evaluate(`(async()=>{const g=globalThis.filterAudit,a=g.current;g.start=performance.now();g.epoch=Date.now();a.events=[];a.requests=[];a.responses=[];a.marks=[];a.net=[];a.lookup.clear();a.netBase=undefined;a.media=[];a.propertyNames.clear();a.mainCpu=process.cpuUsage();a.cpuBaseline=require('electron').app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,cpu:p.cpu.cumulativeCPUUsage}));if(${deep}){a.profileStartLowerMs=performance.now()-g.start;await a.send('Profiler.start');a.profileStartUpperMs=performance.now()-g.start;}})()`);
      row.stage='observe';const started=performance.now(),navigated=await command('navigate',opened.data.tabId,'https://www.youtube.com/watch?v=iTHUUjTA-LI');if(!navigated.ok)throw Error('Navigation failed');
      const read=String.raw`(()=>{const a=globalThis.__filterAudit;if(!a)return {probe:false,consent:location.hostname==='consent.youtube.com'};const n=performance.getEntriesByType('navigation')[0],ad=!!document.getElementById('movie_player')?.classList.contains('ad-showing');if(ad&&!a.events.adSeen){a.events.adSeen=performance.now();try{globalThis.__filterAuditMark(JSON.stringify({origin:a.origin,event:'adSeen',time:a.events.adSeen}));}catch{}}return {probe:true,origin:a.origin,events:a.events,tasks:a.tasks,video:a.read?.(),visibility:document.visibilityState,ad,swControlled:a.swControlled,swControlledNow:!!navigator.serviceWorker?.controller,theme:a.theme,darkNow:!!document.documentElement?.hasAttribute('dark'),consent:location.hostname==='consent.youtube.com',error:!!document.querySelector('.ytp-error'),navigation:n?{responseStart:n.responseStart,responseEnd:n.responseEnd,domInteractive:n.domInteractive}:null};})()`;
      row.transientEvaluations=0;row.adObserved=false;row.visibleSamples=0;row.hiddenSamples=0;row.documents=[];
      while(performance.now()-started<12000){
        await wait(200);let p:any;
        try{p=await d.evaluate(`(async()=>{const a=globalThis.filterAudit.current;if(!a||a.w.isDestroyed()||!a.w.debugger.isAttached())return {probe:false};const t=await a.send('Page.getFrameTree'),contextId=a.contexts.get(t.frameTree.frame.id);if(!contextId)return {probe:false};const r=await a.send('Runtime.evaluate',{expression:${JSON.stringify(read)},contextId,returnByValue:true});return r.result?.value??{probe:false};})()`);}catch{row.transientEvaluations++;continue;}
        row.adObserved||=!!p.ad;if(p.visibility==='visible')row.visibleSamples++;if(p.visibility==='hidden')row.hiddenSamples++;
        if(p.probe){const old=row.documents.findIndex((x:any)=>x.origin===p.origin);if(old<0)row.documents.push(p);else row.documents[old]=p;}
        if(p.consent){row.consent=true;break;}
      }
      row.observedMs=performance.now()-started;
      if(deep)row.deep=await d.evaluate(String.raw`(async()=>{const e=require('electron'),g=globalThis.filterAudit,a=g.current,{profile:p}=await a.send('Profiler.stop'),nodes=new Map(p.nodes.map(n=>[n.id,n])),parent=new Map();for(const n of p.nodes)for(const child of n.children??[])parent.set(child,n.id);
        const cat=n=>{const f=n.callFrame,u=f.url??'',fn=f.functionName;return fn==='(idle)'?'idle':fn==='(garbage collector)'?'gc':u==='browsercore-filter-diagnostic.js'?'filter':u==='browsercore-audit-diagnostic.js'?'audit':u.startsWith('https://www.youtube.com/')||u.includes('.ytimg.com/')?'site':fn==='(program)'?'program':'native-or-other';};
        const byCategoryMs={},functions=new Map();let inclusiveFilterMs=0,sampledMs=0;for(let i=0;i<(p.samples??[]).length;i++){const leaf=nodes.get(p.samples[i]);if(!leaf)continue;const ms=(p.timeDeltas?.[i]??0)/1000,c=cat(leaf);byCategoryMs[c]=(byCategoryMs[c]??0)+ms;sampledMs+=ms;
          let n=leaf,guard=0,filter=false;while(n&&guard++<100){if(cat(n)==='filter')filter=true;n=nodes.get(parent.get(n.id));}if(filter)inclusiveFilterMs+=ms;
          const raw=leaf.callFrame.functionName,fn=/^[a-zA-Z0-9_.$]{1,64}$/.test(raw)?raw:'anonymous-or-native',key=c+':'+fn;const old=functions.get(key)??{category:c,fn,ms:0};old.ms+=ms;functions.set(key,old);
        }
        const base=a.netBase,network=a.net.map(r=>{const v={...r};for(const k of ['start','response','firstData','end'])if(v[k]!==undefined)v[k]=(v[k]-base)*1000;return v;});
        const before=new Map(a.cpuBaseline.map(p=>[p.pid,p])),metrics=e.app.getAppMetrics();return {profile:{durationMs:(p.endTime-p.startTime)/1000,sampledMs,byCategoryMs,inclusiveFilterMs,topFunctions:[...functions.values()].filter(f=>f.category!=='idle').sort((x,y)=>y.ms-x.ms).slice(0,15),startLowerMs:a.profileStartLowerMs,startUpperMs:a.profileStartUpperMs},network,mediaProperties:a.media,propertyNames:[...a.propertyNames],mainCpuMicroseconds:process.cpuUsage(a.mainCpu),processCpu:metrics.map(p=>({type:p.type,seconds:p.cpu.cumulativeCPUUsage!==undefined&&before.get(p.pid)?.cpu!==undefined?p.cpu.cumulativeCPUUsage-before.get(p.pid).cpu:null,newProcess:!before.has(p.pid),privateMiB:(p.memory.privateBytes??0)/1024})),gpuFeature:e.app.getGPUFeatureStatus().video_decode};})().catch(error=>({diagnosticError:{name:error.name,reason:/^[A-Za-z0-9 .(),_'=-]{1,180}$/.test(error.message)?error.message:'redacted'}}))`);
      if(deep&&row.deep?.diagnosticError)row.deep.partial=await d.evaluate(`(()=>{const a=globalThis.filterAudit.current;return {network:a.net.map(r=>{const v={...r};for(const k of ['start','response','firstData','end'])if(v[k]!==undefined)v[k]=(v[k]-a.netBase)*1000;return v;}),mediaProperties:a.media,propertyNames:[...a.propertyNames],gpuFeature:require('electron').app.getGPUFeatureStatus().video_decode};})()`);
      row.main=await d.evaluate(`(()=>{const g=globalThis.filterAudit,a=g.current,e=require('electron'),w=e.BrowserWindow.getAllWindows()[0];return {epoch:g.epoch,events:a.events,requests:a.requests,responses:a.responses,marks:a.marks,probeSetupMs:a.setupMs,visible:w.isVisible(),alwaysOnTop:w.isAlwaysOnTop(),nativeTheme:{source:e.nativeTheme.themeSource,dark:e.nativeTheme.shouldUseDarkColors},views:w.contentView.children.map(v=>({visible:v.getVisible(),bounds:v.getBounds()}))};})()`);
      const state=await command('getState');row.adblock=state.ok?state.data.adBlocking:null;
      row.scriptReloads=row.main.events.filter((e:any)=>e.name==='Page.frameRequestedNavigation'&&e.reason==='scriptInitiated'&&e.target.watch).length;
      const content=row.main.marks.filter((m:any)=>m.event==='firstContentFrame').map((m:any)=>m.origin-row.main.epoch+m.time);row.firstObservedContentMs=content.length?Math.min(...content):null;
      const finalOrigin=Math.max(...row.documents.map((p:any)=>p.origin)),finalFrame=row.main.marks.find((m:any)=>m.origin===finalOrigin&&m.event==='firstContentFrame');
      row.finalDocumentContentMs=finalFrame?finalFrame.origin-row.main.epoch+finalFrame.time:null;
      row.timingComparable=row.visibleSamples>0&&row.hiddenSamples===0;
      row.complete=row.observedMs>=12000&&!row.consent&&row.adblock?.enabled===!mode.startsWith('off')&&row.documents.length>0&&(!deep||!!row.deep?.profile);
      row.runtimeErrorCount=d.errors.length;row.stage='finished';save();console.log(JSON.stringify({case:row.case,mode,complete:row.complete,scriptReloads:row.scriptReloads,documents:row.main.requests.length,firstContentMs:row.firstObservedContentMs,adObserved:row.adObserved,visible:row.visibleSamples,hidden:row.hiddenSamples}));
    }catch(error){row.failure=(error as Error).name;row.failureReason=['UI readiness timeout','Warmup open failed','Warmup timeout','Filter setting failed','Navigation failed','Packaged debugger not available','Packaged child could not start','Packaged child exited before ready'].find(s=>(error as Error).message.includes(s))??'evaluation-or-other';row.childExitCode=d.child?.exitCode;row.runtimeErrorCount=d.errors.length;save();process.exitCode=1;console.error('Comparison stopped at case '+row.case+' '+row.stage+' '+row.failureReason);}
    finally{await d.close();}
    if(!row.complete||row.runtimeErrorCount){process.exitCode=1;break;}
  }
  report.completed=report.cases.length===sequence.length&&report.cases.every((r:any)=>r.complete&&!r.runtimeErrorCount);save();if(!report.completed)process.exitCode=1;
}
main().catch(()=>{console.error('Comparison could not start');process.exitCode=1;});
