// Bounded, localhost-only comparison of Chromium's discardable GPU image cache.
// Flags affect only the spawned diagnostic child; application defaults are unchanged.
import {createServer} from 'node:http';
import {deflateSync} from 'node:zlib';
import {resolve} from 'node:path';
import {existsSync,writeFileSync} from 'node:fs';
import {PackagedDriver} from '../tests/packaged/driver';
import {gpuCacheCounters} from './gpu-cache-counters';

const crcTable=Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type:string,data:Buffer){
 const tag=Buffer.from(type),body=Buffer.concat([tag,data]);let crc=0xffffffff;
 for(const byte of body)crc=crcTable[(crc^byte)&255]!^(crc>>>8);
 const header=Buffer.alloc(4),footer=Buffer.alloc(4);header.writeUInt32BE(data.length);footer.writeUInt32BE((crc^0xffffffff)>>>0);
 return Buffer.concat([header,body,footer]);
}
function image(seed:number){
 const side=1024,stride=1+side*4,pixels=Buffer.alloc(stride*side);
 for(let y=0;y<side;y++)for(let x=0;x<side;x++){
  const at=y*stride+1+x*4;pixels[at]=(x+seed*17)&255;pixels[at+1]=(y+seed*29)&255;pixels[at+2]=((x^y)+seed*47)&255;pixels[at+3]=255;
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(side,0);header.writeUInt32BE(side,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels,{level:1})),chunk('IEND',Buffer.alloc(0))]);
}
async function main(){
 const [exeArg,outArg,mode='baseline',detail='metrics',cyclesArg='3',visibility='foreground']=process.argv.slice(2);
 const background=visibility==='background';
 const cycles=Number(cyclesArg);
 if(!Number.isInteger(cycles)||cycles<3||cycles>20)throw new Error('Cycles must be an integer between 3 and 20');
 if(!exeArg||!outArg||!['baseline','discardable64'].includes(mode)||!['metrics','counters'].includes(detail)||!['foreground','background'].includes(visibility))throw new Error('Executable, new report and supported modes required');
 const executable=resolve(exeArg),out=resolve(outArg);if(!existsSync(executable)||existsSync(out))throw new Error('Missing executable/existing report');
 const pngs=Array.from({length:24},(_,i)=>image(i));let imageRequests=0;
 const server=createServer((req,res)=>{
  const route=new URL(req.url??'/','http://127.0.0.1');res.setHeader('Cache-Control','no-store');
  if(route.pathname==='/image'){
   imageRequests++;res.setHeader('Content-Type','image/png');res.end(pngs[Number(route.searchParams.get('id'))%pngs.length]);
  }else if(route.pathname==='/work.js'){
   res.setHeader('Content-Type','text/javascript');res.end(`(async()=>{try{
    const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');window.fixtureImages=[];window.fixtureDraws=0;
    const started=performance.now();
    for(let i=0;i<24;i++){
     window.fixtureStep='load-'+i;const img=new Image();window.fixturePending=img;
     await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Local PNG load failed'));img.src='/image?id='+i+'&page='+encodeURIComponent(location.search)});fixtureImages.push(img);
     ctx.drawImage(img,(i%2)*1024,((i>>1)%2)*1024);fixtureDraws++;
    }
    window.fixtureLoadMs=performance.now()-started;document.title='GPU fixture ready';
   }catch(error){window.fixtureFailure=error.name+': '+error.message;document.title='GPU fixture failed'}})();`);
  }else{
   res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self';style-src 'unsafe-inline'");
   res.end('<!doctype html><title>GPU fixture loading</title><h1>Local graphics diagnostic</h1><canvas width="2048" height="2048" style="width:700px;height:700px"></canvas><script src="/work.js" defer></script>');
  }
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const d=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 const samples:any[]=[],checks:any[]=[],wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));const started=Date.now();
 const flags=['--host-resolver-rules=MAP * 127.0.0.1','--no-proxy-server',...(mode==='discardable64'?['--force-gpu-mem-discardable-limit-mb=64']:[])];
 let completed=false;let launchInfo:unknown=null;
 const save=()=>writeFileSync(out,JSON.stringify({recordedAt:new Date().toISOString(),completed,executable,mode,cycles,flags,visibility,launchInfo,method:'Own existing package; bounded repeated cycles of three local pages, each loading24 images1024x1024 and painting a canvas2048x2048. All requests loopback only. No external downloads, profile/cache contents, forced heap GC, GPU termination or cache clearing. Background mode uses main inspector only and one fixed pixel readback per fixture; it is not foreground compositor or speed evidence. Optional fixed cache flag affects diagnostic child only; bundled app defaults are recorded in launchInfo. Numeric metrics and own-fixture draw/load/pixel checks. No real-site or universal leak-free claim.',samples,checks,imageRequests,errors:d.errors},null,2)+'\n');
 const command=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
 const sample=async(label:string,cycle:number)=>{
  const result=await d.evaluate(`(async()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0],m=e.app.getAppMetrics(),session=globalThis.gpuFixtureSession;return {gpuFeatures:e.app.getGPUFeatureStatus(),hardwareAcceleration:e.app.isHardwareAccelerationEnabled(),privateMiB:m.reduce((s,p)=>s+(p.memory.privateBytes??0),0)/1024,processes:m.map(p=>({pid:p.pid,creationTime:p.creationTime,type:p.type,privateMiB:(p.memory.privateBytes??0)/1024})),mainHeapMiB:require('node:v8').getHeapStatistics().used_heap_size/1048576,mainExternalMiB:process.memoryUsage().external/1048576,cacheBytes:session?await session.getCacheSize():null,siteContents:e.webContents.getAllWebContents().filter(c=>c.id!==w.webContents.id).length,siteViews:w.contentView.children.filter(v=>v instanceof e.WebContentsView&&v.webContents.id!==w.webContents.id).length};})()`);
  const counters=detail==='counters'&&(label==='empty-baseline'||label==='final-closed-30s'||label==='final-closed-60s'||label==='closed-10s'&&(cycle===1||cycle%4===0))?await gpuCacheCounters(d):undefined;
  samples.push({label,cycle,seconds:(Date.now()-started)/1000,...result,counters});save();console.log(JSON.stringify({mode,label,cycle,privateMiB:result.privateMiB,gpuMiB:result.processes.filter((p:any)=>p.type==='GPU').reduce((s:number,p:any)=>s+p.privateMiB,0),siteContents:result.siteContents,siteViews:result.siteViews,counters}));
  if(label!=='loaded'&&(result.siteContents!==0||result.siteViews!==0))throw new Error('Closed site contents/views retained');
 };
 try{
  await d.launch(executable,env,false,flags,background?{visible:false,mainOnly:true}:{visible:true});
  for(let i=0;i<100;i++){try{if(await d.evaluateUi('!!window.browser'))break;}catch{}await wait(50);}
  const state=await command('getState');if(!state.ok)throw new Error('State unavailable');
  launchInfo={version:state.data.appVersion,gpuStatusTiming:'Startup snapshot can precede gpu-info-update and is not authoritative. Compare post-initialization feature status in samples.',...await d.evaluate("({electron:process.versions.electron,chrome:process.versions.chrome,discardableGpuCacheMiB:require('electron').app.commandLine.getSwitchValue('force-gpu-mem-discardable-limit-mb'),hardwareAcceleration:require('electron').app.isHardwareAccelerationEnabled(),gpuFeatures:require('electron').app.getGPUFeatureStatus()})")};
  await d.evaluate(`(()=>{const w=require('electron').BrowserWindow.getAllWindows()[0];w.setTitle('Browser Core · Yerel GPU tanısı');${background?'w.hide();':'if(w.isMinimized())w.restore();w.show();w.focus();'}})()`);
  await wait(2000);await sample('empty-baseline',0);
  for(let cycle=1;cycle<=cycles;cycle++){
   const ids:string[]=[];
   for(let page=0;page<3;page++){
    const r=await command('openTab',`${origin}/page?cycle=${cycle}&page=${page}`);if(!r.ok)throw new Error('Open failed');ids.push(r.data.tabId);
    // Finish each foreground fixture before backgrounding it. Background timer
    // throttling must not turn fixture generation into a readiness timeout.
    let ready=false;for(let i=0;i<100;i++){
     if(i===20){const progress=await d.evaluate(`Promise.all(require('electron').webContents.getAllWebContents().filter(c=>c.id!==require('electron').BrowserWindow.getAllWindows()[0].webContents.id).map(c=>c.executeJavaScript('({title:document.title,step:window.fixtureStep,failure:window.fixtureFailure,draws:window.fixtureDraws,images:window.fixtureImages?.length,pendingComplete:window.fixturePending?.complete,pendingWidth:window.fixturePending?.naturalWidth})')))`);console.log('LOCAL_FIXTURE_PROGRESS '+JSON.stringify(progress));}
     const state=await command('getState');if(state.ok&&state.data.tabs.some((t:any)=>t.tabId===r.data.tabId&&t.title==='GPU fixture failed')){
      const failure=await d.evaluate(`Promise.all(require('electron').webContents.getAllWebContents().filter(c=>c.id!==require('electron').BrowserWindow.getAllWindows()[0].webContents.id).map(c=>c.executeJavaScript('({step:window.fixtureStep,failure:window.fixtureFailure})')))`);console.log('LOCAL_FIXTURE_FAILURE '+JSON.stringify(failure));save();throw new Error('Local fixture script failed');
     }
     if(state.ok&&state.data.tabs.some((t:any)=>t.tabId===r.data.tabId&&t.title==='GPU fixture ready'&&t.status==='ready')){ready=true;break;}await wait(100);
    }
    if(!ready){save();throw new Error('Local image page not ready; imageRequests='+imageRequests);}
   }
   const fixture=await d.evaluate(`Promise.all(require('electron').webContents.getAllWebContents().filter(c=>c.id!==require('electron').BrowserWindow.getAllWindows()[0].webContents.id).map(c=>{globalThis.gpuFixtureSession=c.session;return c.executeJavaScript('({draws:window.fixtureDraws,images:window.fixtureImages.length,loadMs:window.fixtureLoadMs,pixel:${background?"[...document.querySelector(\"canvas\").getContext(\"2d\").getImageData(0,0,1,1).data]":"null"}})')}))`);
   if(fixture.length!==3||fixture.some((v:any)=>v.draws!==24||v.images!==24||background&&v.pixel.some((value:number,index:number)=>Math.abs(value-[84,68,172,255][index]!)>1)))throw new Error('Local drawing check failed');checks.push({cycle,fixture});
   await wait(2000);await sample('loaded',cycle);
   for(const id of ids){const r=await command('closeTab',id);if(!r.ok)throw new Error('Close failed');}
   await wait(10000);await sample('closed-10s',cycle);
  }
  await wait(20000);await sample('final-closed-30s',cycles);
  if(cycles>3){await wait(30000);await sample('final-closed-60s',cycles);}
  if(d.errors.length)throw new Error('Diagnostic child errors');completed=true;save();
 }finally{await d.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
