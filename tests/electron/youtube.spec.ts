import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {PackagedDriver} from '../packaged/driver';
let d:PackagedDriver;
const command=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
const probe=(code:string)=>d.evaluate(`require('electron').webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://www.youtube.com/watch')).executeJavaScript(${JSON.stringify(code)})`);
test.beforeEach(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 d=new PackagedDriver();await d.launch(resolve('node_modules/electron/dist/electron.exe'),env,false,['--host-resolver-rules=MAP * 127.0.0.1',resolve('.')]);
 await expect.poll(async()=>{try{return await d.evaluateUi('!!window.browser');}catch{return false;}}).toBe(true);
 await d.evaluate(`(()=>{const seen=new WeakSet();require('electron').app.on('web-contents-created',(_e,w)=>{if(seen.has(w.session))return;seen.add(w.session);void w.session.protocol.handle('https',request=>{
 const u=new URL(request.url);
 if(['start.test','www.google.com'].includes(u.hostname))return new Response('<!doctype html><title>Navigation fixture</title><a href="https://www.youtube.com/watch?v=fixture">Video</a>',{headers:{'Content-Type':'text/html'}});
 if(u.hostname!=='www.youtube.com')return new Response('',{status:404});
 if(u.pathname==='/initial.js')return new Response('window.ytInitialPlayerResponse={playerAds:[1],adPlacements:[2],adSlots:[3],videoDetails:{title:"normal"}};window.initialAds=[ytInitialPlayerResponse.playerAds,ytInitialPlayerResponse.adPlacements,ytInitialPlayerResponse.adSlots].filter(Boolean).length;',{headers:{'Content-Type':'text/javascript'}});
 if(u.pathname==='/watch')return new Response('<!doctype html><title>Video API fixture</title><script src="/initial.js"></script><p>Normal video</p>',{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self';script-src 'self';connect-src 'self'"}});
 return new Response(JSON.stringify({adPlacements:[1],adSlots:[2],playerAds:[3],videoDetails:{title:'ordinary video'},streamingData:{formats:[{itag:18}]}}),{headers:{'Content-Type':'application/json'}});
 });});})();`);
});
test.afterEach(async()=>{await d.close();expect(d.errors).toEqual([]);});
test('YT-01: player API fetch/Request/URL and XHR responses lose ads but keep video; site opt-out restores them',async()=>{
 const result=await command('openTab','https://www.youtube.com/watch?v=fixture');expect(result.ok).toBe(true);const id=result.data.tabId;
 const ready=()=>expect.poll(async()=>(await command('getState')).data.tabs.find((t:any)=>t.tabId===id)?.status).toBe('ready');await ready();
 const exercise=()=>probe(`(async()=>{const rows=[];const check=o=>({ads:['adPlacements','adSlots','playerAds'].filter(k=>Array.isArray(o[k])&&o[k].length).length,title:o.videoDetails?.title,formats:o.streamingData?.formats?.length});
 for(const input of ['/youtubei/v1/player?prettyPrint=false',new Request('https://www.youtube.com/youtubei/v1/player',{method:'POST',body:'{}'}),new URL('https://www.youtube.com/youtubei/v1/player?key=fixture')]){const response=await fetch(input);rows.push(check(await response.json()));}
 for(const type of ['','json']){const value=await new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('POST','/youtubei/v1/player?prettyPrint=false');x.responseType=type;x.onload=()=>resolve(type==='json'?x.response:JSON.parse(x.responseText));x.onerror=reject;x.send('{}');});rows.push(check(value));}
 return rows;})()`);
 expect(await exercise()).toEqual(Array(5).fill({ads:0,title:'ordinary video',formats:1}));
 // The full real scriptlet set keeps request edits, while ordinary getters run
 // once as in native JSON, rather than once for every defensive JSON clone.
 expect(await probe(`(()=>{let calls=0;const ordinary=JSON.stringify({get value(){calls++;return 'ordinary'}});const edited=JSON.parse(JSON.stringify({attestationRequest:{},context:{client:{userAgent:'fixture; channel',clientName:'WEB'}}}));return {ordinary,calls,screen:edited.context.client.clientScreen};})()`)).toEqual({ordinary:'{"value":"ordinary"}',calls:1,screen:'CHANNEL'});
 // Same-source cached registration must still run on each fresh document.
 await command('navigate',id,'https://www.youtube.com/watch?v=second-document');await ready();
 expect(await exercise()).toEqual(Array(5).fill({ads:0,title:'ordinary video',formats:1}));
 expect(await probe("fetch('/ordinary-content').then(r=>r.json()).then(o=>['adPlacements','adSlots','playerAds'].filter(k=>o[k]?.length).length)")).toBe(3);
 await command('setAdBlocking',id,false);await command('reload',id);await ready();
 expect(await exercise()).toEqual(Array(5).fill({ads:3,title:'ordinary video',formats:1}));
 await command('setAdBlocking',id,true);await command('reload',id);await ready();
 expect(await exercise()).toEqual(Array(5).fill({ads:0,title:'ordinary video',formats:1}));
 expect(await probe("({bridge:typeof window.browser,node:typeof process})")).toEqual({bridge:'undefined',node:'undefined'});
});

test('YT-02: cross-site link gets early filtering; existing-tab guard respects site opt-out',async()=>{
 const start=await command('openTab','https://start.test/');const id=start.data.tabId;
 const startReady=()=>expect.poll(async()=>(await command('getState')).data.tabs.find((t:any)=>t.tabId===id)?.status).toBe('ready');await startReady();
 const follow=()=>d.evaluate("require('electron').webContents.getAllWebContents().find(w=>w.getURL()==='https://start.test/').executeJavaScript(\"document.querySelector('a').click();void 0\")");
 await follow();await expect.poll(async()=>{try{return await probe('window.initialAds');}catch{return -1;}}).toBe(0);
 expect(await probe("fetch('/youtubei/v1/player').then(r=>r.json()).then(o=>['adPlacements','adSlots','playerAds'].filter(k=>o[k]?.length).length)")).toBe(0);
 await command('setAdBlocking',id,false);await command('navigate',id,'https://start.test/');await startReady();await follow();
 await expect.poll(async()=>{try{return await probe('window.initialAds');}catch{return -1;}}).toBe(3);
});

test('UI-01: lightweight Google start/search, home action and accessible shield toggle',async()=>{
 expect(await d.evaluateUi("document.querySelector('[aria-label=\"Google ile ara\"]')!==null")).toBe(true);
 expect(await d.evaluate("require('electron').webContents.getAllWebContents().length")).toBe(1);
 await command('navigate',(await command('getState')).data.activeTabId,'browser core');
 await expect.poll(async()=>(await command('getState')).data.tabs[0]?.url).toBe('https://www.google.com/search?q=browser%20core&hl=tr');
 const shield=()=>d.evaluateUi("(()=>{const b=document.querySelector('[aria-label=\"Bu sitede reklam engelle\"]');b.click();return true;})()");
 await shield();await expect.poll(async()=>(await command('getState')).data.adBlocking.enabled).toBe(false);
 expect(await d.evaluateUi("document.querySelector('[aria-label=\"Bu sitede reklam engelle\"]').getAttribute('aria-pressed')")).toBe('false');
 await shield();await expect.poll(async()=>(await command('getState')).data.adBlocking.enabled).toBe(true);
 await d.evaluateUi("(()=>{document.querySelector('[aria-label=\"Google ana sayfa\"]').click();return true;})()");
 await expect.poll(async()=>(await command('getState')).data.tabs[0]?.url).toBe('https://www.google.com/');
 const version=(await command('getState')).data.appVersion;
 expect(version).toMatch(/^V\d+\.\d+\.\d+\.\d+$/);
 await d.evaluate(`(()=>{const fs=require('node:fs');return require('electron').BrowserWindow.getAllWindows()[0].webContents.capturePage().then(image=>fs.writeFileSync(${JSON.stringify(resolve('docs/evidence',`p2-${version.toLowerCase()}-toolbar.png`))},image.toPNG()));})()`);
});
