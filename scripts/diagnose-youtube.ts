// Fresh, memory-only app partition. Numeric playback/ad state only; no response,
// account, cookie, request URL or real profile dumps. Own child closes normally.
import {resolve} from 'node:path';
import {existsSync,writeFileSync} from 'node:fs';
import {PackagedDriver} from '../tests/packaged/driver';
let stage='start';
async function main(){
 const output=process.argv[2];if(!output||existsSync(output))throw Error('New report path required');
 const d=new PackagedDriver(),samples:unknown[]=[];
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 try{
  stage='launch';await d.launch(resolve('node_modules/electron/dist/electron.exe'),env,false,[resolve('.')],{visible:true});
  for(let i=0;i<100;i++){try{if(await d.evaluateUi('!!window.browser'))break;}catch{}await new Promise(r=>setTimeout(r,100));}
  stage='open';const opened=await d.evaluateUi('window.browser.openTab("https://www.youtube.com/watch?v=iTHUUjTA-LI")');
  if(!opened.ok)throw Error('Open failed');
  stage='sample';for(let i=0;i<12;i++){
   await new Promise(r=>setTimeout(r,3000));
   let sample;try{sample=await d.evaluate(`(async()=>{const e=require('electron'),ui=e.BrowserWindow.getAllWindows()[0].webContents;const wc=e.webContents.getAllWebContents().find(w=>w!==ui);if(!wc)return {missing:true};return wc.executeJavaScript(${JSON.stringify(`(()=>{const p=document.getElementById('movie_player'),v=document.querySelector('video'),r=p?.getPlayerResponse?.();if(v){v.muted=true;if(v.paused)void v.play().catch(()=>{});}return {player:!!p,video:!!v,playing:v?!v.paused:false,time:v?.currentTime??0,duration:Number.isFinite(v?.duration)?v.duration:null,adShowing:!!p?.classList.contains('ad-showing'),adFields:r?['adPlacements','adSlots','playerAds'].filter(k=>r[k]?.length>0).length:null,error:!!document.querySelector('.ytp-error'),consent:location.hostname==='consent.youtube.com'};})()`)});})()`);}catch{sample={probeUnavailable:true};}
   samples.push(sample);console.log(JSON.stringify(sample));
  }
  stage='save';writeFileSync(output,JSON.stringify({version:(await d.evaluateUi('window.browser.getState()')).data.appVersion,method:'Fresh app public NASA video, 36 seconds. No observed ad is not evidence that an ad was offered. Numeric data only.',samples,errors:d.errors},null,2));
 }finally{await d.close();}
}
main().catch(()=>{console.error('YouTube diagnostic failed at '+stage+'; no page data logged');process.exitCode=1;});
