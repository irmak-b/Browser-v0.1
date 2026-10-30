import {resolve} from 'node:path';
import {existsSync,writeFileSync} from 'node:fs';
import {PackagedDriver} from '../tests/packaged/driver';
async function main(){
 const output=process.argv[2];if(!output||existsSync(output))throw Error('New report required');const runs:any[]=[];
 const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 for(const mode of (process.argv[3]==='final-controls'?['native-default','cache-enabled','permission-check-default']:process.argv[3]==='variants'?['reduced','chromium-client']:process.argv[3]==='context'?['region','unpersonalized']:process.argv[3]==='hints'?['hints','chrome-hints']:process.argv[3]==='source'?['chrome-source','plain-engine','chrome-source']:['plain-engine','browser-core','plain-engine'])){
  const d=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  try{
   await d.launch(resolve(mode!=='browser-core'?'node_modules/electron/dist/electron.exe':'artifacts/BrowserCore_V1.0.5.8_Windows_x64/BrowserCore.exe'),env,false,mode!=='browser-core'?[resolve('tests/fixtures/google-control.cjs'),...(mode!=='plain-engine'?['--control-variant='+mode]:[])]:[],{mainOnly:true});
   if(mode==='browser-core'){
    for(let i=0;i<100;i++){try{if(await d.evaluateUi('!!window.browser'))break;}catch{}await wait(50);}
    await d.evaluateUi('window.browser.openTab("youtube")');
   }
   let sample:any;for(let i=0;i<50;i++){
    await wait(400);
    try{sample=await d.evaluate(`(()=>{const e=require('electron'),w=e.webContents.getAllWebContents().find(c=>c.getURL().startsWith('https://www.google.com/'));if(!w)return null;return w.executeJavaScript(${JSON.stringify(`(()=>{const rows=[...document.querySelectorAll('#search a:has(h3)')].map(a=>({title:a.querySelector('h3').textContent?.slice(0,100),visible:!!a.getClientRects().length}));return {rows,webdriver:navigator.webdriver,language:navigator.language,chromium:navigator.userAgent.split('Chrome/')[1]?.split(' ')[0],challenge:location.pathname.startsWith('/sorry'),ready:document.readyState};})()`)});})()`);}catch{sample={probeUnavailable:true};}
    if(sample?.challenge||sample?.rows?.length&&sample.ready==='complete')break;
   }
   const run={mode,...sample,errors:d.errors};runs.push(run);console.log(JSON.stringify(run));
   writeFileSync(output,JSON.stringify({method:'Three fresh sessions in plain-engine/Core/plain-engine order; same Electron/Chromium, public fixed query, Turkish HTTP preference, memory session, cache false. Plain engine has no Browser Core browser logic/preload/filter. Node inspector only, no renderer automation port. Public result titles/visibility only, no user profiles/requests/cookies/full page dumps. Google context varies across sessions, not an identical-response proof.',runs},null,2));
   if(sample?.challenge)break;
   if(!sample?.rows)throw Error('Comparison probe did not complete');
  }finally{await d.close();}
 }
}
main().catch(()=>{console.error('Google engine comparison incomplete; no private data logged');process.exitCode=1;});
