// Own fresh package sessions; no account/profile/response/URL dumps. Public
// NASA video only. ABBA order reduces simple order bias; no universal claim.
import {resolve} from 'node:path';
import {existsSync,writeFileSync} from 'node:fs';
import {PackagedDriver} from '../tests/packaged/driver';
let stage='start';
async function main(){
 const output=process.argv[2];if(!output||existsSync(output))throw Error('New output required');
 const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms)),runs:any[]=[];
 const compare=process.argv[3]==='compare';
 const cases=compare?(process.argv[4]==='short'?[{version:'V1.0.5.9',enabled:true},{version:'V1.0.5.8',enabled:true}]:[{version:'V1.0.5.8',enabled:true},{version:'V1.0.5.9',enabled:true},{version:'V1.0.5.9',enabled:true},{version:'V1.0.5.8',enabled:true}]):[true,false,false,true].map(enabled=>({version:'V1.0.5.7',enabled}));
 for(const {enabled,version} of cases){
  const exe=resolve(`artifacts/BrowserCore_${version}_Windows_x64/BrowserCore.exe`);
  const d=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  try{
   stage='launch '+version;await d.launch(exe,env,false,[],{visible:true,mainOnly:compare});
   const command=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
   for(let i=0;i<100;i++){try{if(await d.evaluateUi('!!window.browser'))break;}catch{}await wait(50);}
   stage='warmup '+version;const r=await command('openTab','https://www.youtube.com/robots.txt');if(!r.ok)throw Error('Warmup failed');
   for(let i=0;i<80;i++){const s=await command('getState');if(s.data.tabs.find((t:any)=>t.tabId===r.data.tabId)?.status!=='loading')break;await wait(100);}
   stage='preference '+version;await command('setAdBlocking',r.data.tabId,enabled);
   const samples:any[]=[],started=performance.now();
   stage='navigate '+version;await command('navigate',r.data.tabId,'https://www.youtube.com/watch?v=iTHUUjTA-LI');
   stage='sample '+version;for(let i=0;i<40;i++){
    await wait(500);
    const expression=`(()=>{const v=document.querySelector('video'),p=document.getElementById('movie_player');if(v){v.muted=true;if(v.paused)void v.play().catch(()=>{});}return {video:!!v,time:v?.currentTime??0,playing:v?!v.paused:false,ready:v?.readyState??0,ad:!!p?.classList.contains('ad-showing'),error:!!document.querySelector('.ytp-error'),consent:location.hostname==='consent.youtube.com'};})()`;
    let sample:any={unavailable:true};
    try{sample=await d.evaluate(`(async()=>{const e=require('electron'),ui=e.BrowserWindow.getAllWindows()[0].webContents,w=e.webContents.getAllWebContents().find(c=>c!==ui);if(!w||!w.debugger.isAttached())return {unavailable:true};const r=await w.debugger.sendCommand('Runtime.evaluate',{expression:${JSON.stringify(expression)},returnByValue:true});return r.result?.value??{unavailable:true};})()`);}catch{}
    samples.push({ms:performance.now()-started,...sample});
    if(sample.time>0.5&&sample.playing&&!sample.ad||sample.error||sample.consent)break;
   }
   stage='save '+version;const state=(await command('getState')).data;
   const first=samples.find(s=>s.time>0.5&&s.playing&&!s.ad);
   runs.push({version,enabled,firstObservedContentMs:first?.ms??null,adObserved:samples.some(s=>s.ad),blockedRequests:state.adBlocking.blockedRequests,samples,errors:d.errors});
   console.log(JSON.stringify({run:runs.length,version,enabled,firstObservedContentMs:first?.ms??null,adObserved:samples.some(s=>s.ad)}));
   writeFileSync(output,JSON.stringify({completed:runs.length===cases.length,method:compare?'Version comparison in listed run order. Same public NASA video. Node inspector only; no renderer automation port.':'ABBA four fresh5.7 sessions:enabled/disabled/disabled/enabled. Node inspector for measurement; launcher includes renderer debugging port0.',limits:'Both modes warm origin via robots.txt. Muted play requested.500ms sampling; network/DNS/player/ad variability remains. First currentTime>0.5s is not precise first rendered frame. No private profiles, raw requests/responses, user URLs or accounts.',runs},null,2));
  }finally{await d.close();}
 }
}
main().catch(error=>{console.error('Bounded YouTube startup test failed at '+stage+' ('+error.name+'); no page data logged');process.exitCode=1;});
