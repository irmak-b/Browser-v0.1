// Fixed public query in a fresh own package session. Only public result
// host/path categories, titles and visibility; no user history/cookies/URLs.
import {resolve} from 'node:path';
import {existsSync,writeFileSync} from 'node:fs';
import {PackagedDriver} from '../tests/packaged/driver';
async function main(){
 const output=process.argv[2];if(!output||existsSync(output))throw Error('New report required');
 const d=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms)),results:any[]=[];
 try{
  await d.launch(resolve(process.argv[3]??'artifacts/BrowserCore_V1.0.5.7_Windows_x64/BrowserCore.exe'),env,false,[],{mainOnly:true});
  const cmd=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
  for(let i=0;i<100;i++){try{if(await d.evaluateUi('!!window.browser'))break;}catch{}await wait(50);}
  const opened=await cmd('openTab','youtube');if(!opened.ok)throw Error('Open failed');const id=opened.data.tabId;
  const ready=async()=>{for(let i=0;i<120;i++){if((await cmd('getState')).data.tabs.find((t:any)=>t.tabId===id)?.status==='ready')break;await wait(100);}await wait(2000);};
  const probe=async(label:string)=>{
   const expression=`(()=>{const entries=[...document.querySelectorAll('#search a:has(h3)')].map(a=>{let u;try{u=new URL(a.href);}catch{return null;}const h=a.querySelector('h3');let hidden=false;for(let p=h;p;p=p.parentElement){if(getComputedStyle(p).display==='none'||getComputedStyle(p).visibility==='hidden'){hidden=true;break;}}return {host:u.hostname,pathCategory:u.pathname.split('/').filter(Boolean).slice(0,1).join('/'),title:h?.textContent?.slice(0,100),hidden};}).filter(Boolean);return {host:location.hostname,title:document.title,language:navigator.language,languages:navigator.languages,userAgent:navigator.userAgent,entries,blockedPage:location.pathname.startsWith('/sorry'),consent:location.hostname.startsWith('consent.')};})()`;
   const sample=await d.evaluate(`(()=>{const e=require('electron'),ui=e.BrowserWindow.getAllWindows()[0].webContents;return e.webContents.getAllWebContents().find(w=>w!==ui).executeJavaScript(${JSON.stringify(expression)});})()`);
   if(sample.title?.startsWith('http'))sample.title='Google access challenge';
   results.push({label,...sample});writeFileSync(output,JSON.stringify({method:'Same fresh app session, fixed public youtube Google query. Enabled, disabled without reload, disabled after reload; Google-side variants can change across reloads. Does not read the user session.',results,errors:d.errors},null,2));console.log(JSON.stringify({label,...sample}));return sample.blockedPage||sample.consent;
  };
  await ready();if(await probe('enabled'))return;
  await cmd('setAdBlocking',id,false);await wait(500);await probe('disabled-no-reload');
  await cmd('reload',id);await ready();await probe('disabled-reloaded');
 }finally{await d.close();}
}
main().catch(()=>{console.error('Google diagnostic failed; no user data logged');process.exitCode=1;});
