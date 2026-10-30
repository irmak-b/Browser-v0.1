import {test,expect} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import {createHash} from 'node:crypto';
import type {Duplex} from 'node:stream';
import {resolve} from 'node:path';
import {PackagedDriver} from '../packaged/driver';

let driver:PackagedDriver,server:Server,port:number;
const hits=new Map<string,number>(),sockets=new Set<Duplex>();
test.beforeAll(async()=>{
 server=createServer((req,res)=>{
  const path=req.url?.split('?')[0]??'/';hits.set(path,(hits.get(path)??0)+1);
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self' http:;frame-src http:;connect-src ws:");
  if(path==='/race-download'){
   res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment; filename="freeze-race-fixture.bin"');res.setHeader('Content-Length','4096');res.end(Buffer.alloc(4096));
  }else if(path==='/youtube-fixture.js'){
   res.setHeader('Content-Type','text/javascript');res.end(`window.ytInitialPlayerResponse={playerAds:[{ad:1}],adPlacements:[{ad:2}],adSlots:[{ad:3}],videoDetails:{title:'ordinary-content'}};window.initialAdFields=[ytInitialPlayerResponse.playerAds,ytInitialPlayerResponse.adPlacements,ytInitialPlayerResponse.adSlots].filter(Boolean).length;`);
  }else if(path==='/youtube-fixture'){
   res.end('<!doctype html><title>YouTube filter fixture</title><script src="/youtube-fixture.js"></script><p>Ordinary video content</p>');
  }else if(path==='/turkish-ads'){
   res.end(`<!doctype html><title>Turkish ad fixture</title><style>.top-ad-bar-container,.dh-inline-ad{height:200px}</style><div class="top-ad-bar-container">banner</div><div class="dh-inline-ad">empty ad slot</div><article id="content">ordinary news</article><script src="http://ad.donanimhaber.com:${port}/ads/banner.js"></script>`);
  }else if(path==='/ads/banner.js'){
   res.setHeader('Content-Type','text/javascript');res.end('window.sameSiteAdLoaded=true;');
  }else if(path==='/tick.js'){
   res.setHeader('Content-Type','text/javascript');res.end("window.probe={ticks:0,value:42};setInterval(()=>probe.ticks++,40);document.querySelector('input').value='kept';if(location.pathname==='/socket')window.socket=new WebSocket('ws://'+location.host+'/ws');");
  }else if(path==='/site.js'||path==='/ad.js'){
   res.setHeader('Content-Type','text/javascript');res.end('window.firstPartyScript=true;');
  }else if(path==='/ads'){
   res.end(`<!doctype html><title>Ads fixture</title><script src="/site.js"></script><script src="http://securepubads.g.doubleclick.net:${port}/ad.js"></script><iframe src="http://adnxs.com:${port}/ad-frame"></iframe><p>First-party content</p>`);
  }else if(['/tick','/socket','/video'].includes(path)){
   res.end(`<!doctype html><title>${path}</title><input value="original">${path==='/video'?'<video></video>':''}<script src="/tick.js"></script>`);
  }else res.end('<!doctype html><title>Plain fixture</title><p>Local only</p>');
 });
 server.on('upgrade',(req,socket)=>{
  sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
  const accept=createHash('sha1').update(String(req.headers['sec-websocket-key'])+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));port=(server.address() as {port:number}).port;
});

test('P2-10: Turkish first-party ads and reserved banner gaps disappear; preference restores layout',async()=>{
 const tab=await open('/turkish-ads','www.donanimhaber.com');
 const boxes=()=>site(tab.url,`({ad:document.querySelector('.top-ad-bar-container').getBoundingClientRect().height,gap:document.querySelector('.dh-inline-ad').getBoundingClientRect().height,content:document.querySelector('#content').getBoundingClientRect().height,script:!!window.sameSiteAdLoaded,bridge:typeof window.browser})`);
 await expect.poll(async()=>(await boxes()).ad).toBe(0);
 expect((await boxes()).gap).toBe(0);expect((await boxes()).content).toBeGreaterThan(0);expect((await boxes()).bridge).toBe('undefined');
 expect((await boxes()).script).toBe(false);expect(hits.get('/ads/banner.js')??0).toBe(0);
 await command('setAdBlocking',tab.id,false);
 await expect.poll(async()=>(await boxes()).ad).toBeGreaterThan(0);
 await command('reload',tab.id);await expect.poll(()=>hits.get('/ads/banner.js')??0).toBeGreaterThan(0);
});

test('P2-11: YouTube scriptlets run before the first page script; opt-out, navigation and debugger cleanup work',async()=>{
 // Own test partition: serve deterministic HTTPS responses in memory. No real
 // YouTube traffic, certificates, TLS bypass, account or production protocol change.
 await driver.evaluate(`(()=>{const configured=new WeakSet();require('electron').app.on('web-contents-created',(_e,w)=>{if(configured.has(w.session))return;configured.add(w.session);void w.session.protocol.handle('https',request=>{
   const u=new URL(request.url);if(u.hostname!=='www.youtube.com')return new Response('',{status:404});
   if(u.pathname.endsWith('.js'))return new Response("window.ytInitialPlayerResponse={playerAds:[1],adPlacements:[2],adSlots:[3],videoDetails:{title:'ordinary-content'}};window.initialAdFields=[ytInitialPlayerResponse.playerAds,ytInitialPlayerResponse.adPlacements,ytInitialPlayerResponse.adSlots].filter(Boolean).length;",{headers:{'Content-Type':'text/javascript'}});
   return new Response('<!doctype html><title>YouTube filter fixture</title><script src="/youtube-fixture.js"></script><p>Ordinary content</p>',{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'"}});
 });});})();`);
 const tab=await open('/youtube-fixture','www.youtube.com','https');
 const probe=()=>site(tab.url,`({ads:window.initialAdFields,title:ytInitialPlayerResponse.videoDetails.title,bridge:typeof window.browser,node:typeof process})`);
 await expect.poll(async()=>(await probe()).ads).toBe(0);
 expect(await probe()).toEqual({ads:0,title:'ordinary-content',bridge:'undefined',node:'undefined'});
 const attached=()=>driver.evaluate(`require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)}).debugger.isAttached()`);
 await expect.poll(attached).toBe(true);
 await command('setAdBlocking',tab.id,false);await command('reload',tab.id);
 await expect.poll(async()=>(await probe()).ads).toBe(3);
 await command('setAdBlocking',tab.id,true);await command('reload',tab.id);
 await expect.poll(async()=>(await state()).tabs.find((t:any)=>t.tabId===tab.id)?.status).toBe('ready');
 await expect.poll(async()=>(await probe()).ads).toBe(0);
 await site(tab.url,'window.filterTicks=0;setInterval(()=>filterTicks++,40);void 0');
 const front=await open('/plain','front.test');await advance();
 await expect.poll(async()=>(await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(true);
 const ticks=()=>driver.evaluate(`(async()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)});return (await w.debugger.sendCommand('Runtime.evaluate',{expression:'filterTicks',returnByValue:true})).result.value;})()`);
 const paused=await ticks();await new Promise(r=>setTimeout(r,250));expect(await ticks()).toBe(paused);
 await command('activateTab',tab.id);await expect.poll(ticks).toBeGreaterThan(paused);
 await command('closeTab',tab.id);
 await command('closeTab',front.id);
 expect(await driver.evaluate("require('electron').webContents.getAllWebContents().filter(w=>w.id!==require('electron').BrowserWindow.getAllWindows()[0].webContents.id).length")).toBe(0);
});
test.afterAll(async()=>{for(const s of sockets)s.destroy();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
test.beforeEach(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 driver=new PackagedDriver();
 // Test child only: even disabled-filter ad-host fixtures resolve to loopback.
 await driver.launch(resolve('node_modules/electron/dist/electron.exe'),env,false,['--host-resolver-rules=MAP * 127.0.0.1','--no-proxy-server',resolve('.')]);
 await expect.poll(async()=>{try{return await driver.evaluateUi("document.body.innerText.includes('Browser Core bağlı')");}catch{return false;}}).toBe(true);
 hits.clear();
});
test.afterEach(async()=>{await driver.close();expect(driver.errors).toEqual([]);});
const command=(name:string,...args:unknown[])=>driver.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
async function state(){const r=await command('getState');if(!r.ok)throw new Error();return r.data;}
async function open(path:string,host='page.test',scheme='http'){
 const url=`${scheme}://${host}:${port}${path}`,r=await command('openTab',url);if(!r.ok)throw new Error('Open failed');
 await expect.poll(async()=> (await state()).tabs.find((t:any)=>t.tabId===r.data.tabId)?.status).toBe('ready');return {id:r.data.tabId as string,url};
}
async function advance(){await driver.evaluate('(()=>{const now=Date.now;Date.now=()=>now()+180000;})()');await command('activateTab',(await state()).activeTabId);}
function site(url:string,code:string){return driver.evaluate(`require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(url)}).executeJavaScript(${JSON.stringify(code)})`);}

test('P2-01: blocked ad scripts/frames never reach the local server; first-party content remains; site exception works',async()=>{
 const tab=await open('/ads');await expect.poll(async()=> (await state()).adBlocking.blockedRequests).toBeGreaterThanOrEqual(2);
 expect(hits.get('/ad.js')??0).toBe(0);expect(hits.get('/ad-frame')??0).toBe(0);
 expect(await site(tab.url,'window.firstPartyScript')).toBe(true);
 await command('setAdBlocking',tab.id,false);await command('reload',tab.id);
 await expect.poll(()=>hits.get('/ad.js')??0).toBeGreaterThan(0);await expect.poll(()=>hits.get('/ad-frame')??0).toBeGreaterThan(0);
 expect((await state()).adBlocking.enabled).toBe(false);
 await open('/ads','other.test');await expect.poll(async()=> (await state()).adBlocking.blockedRequests).toBeGreaterThanOrEqual(2);
 expect((await state()).adBlocking.enabled).toBe(true);
});

test('P2-02: real lifecycle freeze stops background timers; reactivation preserves DOM, JS, renderer and visit identity',async()=>{
 const tab=await open('/tick');const before=await command('getResources');
 const pid=before.data.tabs.find((t:any)=>t.tabId===tab.id).processIds[0];
 await open('/plain','front.test');const visits=(await state()).history.entries.length;await advance();
 await expect.poll(async()=> (await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(true);
 const ticks=()=>driver.evaluate(`(async()=>{const wc=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)});const r=await wc.debugger.sendCommand('Runtime.evaluate',{expression:'window.probe.ticks',returnByValue:true});return r.result.value;})()`);
 const frozenTicks=await ticks();await new Promise(r=>setTimeout(r,600));expect(await ticks()).toBe(frozenTicks);
 await command('activateTab',tab.id);expect((await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(false);
 expect(await site(tab.url,"({value:probe.value,input:document.querySelector('input').value})")).toEqual({value:42,input:'kept'});
 await expect.poll(()=>site(tab.url,'probe.ticks')).toBeGreaterThan(frozenTicks);
 expect((await command('getResources')).data.tabs.find((t:any)=>t.tabId===tab.id).processIds[0]).toBe(pid);
 expect((await state()).history.entries.length).toBe(visits);
});

test('P2-16: native control-tab permits background freeze without losing form, JS or visit identity',async()=>{
 const tab=await open('/tick'),front=await open('/plain','front.test');
 const visits=(await state()).history.entries.map((entry:any)=>entry.eventId);
 await command('activateTab',tab.id);
 await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)});globalThis.shortcutFreezeOld=w;w.focus();
  w.sendInputEvent({type:'keyDown',keyCode:'Control'});
  w.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['control']});
  w.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['control']});
  w.sendInputEvent({type:'keyUp',keyCode:'Control'});})()`);
 await expect.poll(async()=>(await state()).activeTabId).toBe(front.id);
 await advance();await new Promise(done=>setTimeout(done,700));
 const frozen=(await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen===true;
 console.log('SHORTCUT_FREEZE '+JSON.stringify({frozen,controlTabSelectedNeighbor:true}));expect(frozen).toBe(true);
 const ticks=()=>driver.evaluate("globalThis.shortcutFreezeOld.debugger.sendCommand('Runtime.evaluate',{expression:'probe.ticks',returnByValue:true}).then(result=>result.result.value)");
 const paused=await ticks();await new Promise(done=>setTimeout(done,250));expect(await ticks()).toBe(paused);
 await command('activateTab',tab.id);await expect.poll(()=>site(tab.url,'probe.ticks')).toBeGreaterThan(paused);
 expect(await site(tab.url,"({value:probe.value,input:document.querySelector('input').value})")).toEqual({value:42,input:'kept'});
 expect(await driver.evaluate(`globalThis.shortcutFreezeOld===require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)})`)).toBe(true);
 expect((await state()).history.entries.map((entry:any)=>entry.eventId)).toEqual(visits);
 console.log('SHORTCUT_FREEZE_RESTORE '+JSON.stringify({sameContents:true,formAndJsPreserved:true,extraVisits:0}));
});

test('P2-12: auto-selection reconciles frozen state and can refreeze later without reload or data loss',async()=>{
 const tab=await open('/tick');
 const pid=(await command('getResources')).data.tabs.find((t:any)=>t.tabId===tab.id).processIds[0];
 const background=await open('/plain','background.test');
 const front=await open('/plain','front.test');await advance();
 await expect.poll(async()=>(await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(true);
 expect((await command('closeTab',background.id)).ok).toBe(true);
 expect((await state()).activeTabId).toBe(front.id);
 expect((await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(true);
 const ticks=()=>driver.evaluate(`(async()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)});return (await w.debugger.sendCommand('Runtime.evaluate',{expression:'probe.ticks',returnByValue:true})).result.value;})()`);
 const paused=await ticks(),visits=(await state()).history.entries.map((v:any)=>v.eventId),requests=hits.get('/tick');
 const closed=await command('closeTab',front.id);expect(closed.ok).toBe(true);
 await new Promise(r=>setTimeout(r,300));
 const observed=await state();
 console.log('AUTO_THAW_OBSERVATION '+JSON.stringify({version:observed.appVersion,autoSelected:observed.activeTabId===tab.id,frozen:observed.tabs.find((t:any)=>t.tabId===tab.id)?.frozen,ticksBeforeClose:paused,ticksAfterClose:await ticks(),tickDocumentRequests:hits.get('/tick')}));
 await expect.poll(async()=>{const s=await state();return {active:s.activeTabId,frozen:s.tabs.find((t:any)=>t.tabId===tab.id)?.frozen};}).toEqual({active:tab.id,frozen:false});
 await expect.poll(()=>site(tab.url,'probe.ticks')).toBeGreaterThan(paused);
 expect(await site(tab.url,"({value:probe.value,input:document.querySelector('input').value})")).toEqual({value:42,input:'kept'});
 expect((await command('getResources')).data.tabs.find((t:any)=>t.tabId===tab.id).processIds[0]).toBe(pid);
 expect((await state()).history.entries.map((v:any)=>v.eventId)).toEqual(visits);
 expect(hits.get('/tick')).toBe(requests);
 const again=await open('/plain','again.test');await advance();
 await expect.poll(async()=>(await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(true);
 const refrozen=await ticks();await new Promise(r=>setTimeout(r,300));expect(await ticks()).toBe(refrozen);
 console.log('AUTO_REFREEZE_OBSERVATION '+JSON.stringify({frozen:true,ticksBefore:refrozen,ticksAfter:await ticks(),tickDocumentRequests:hits.get('/tick')}));
 expect((await command('closeTab',again.id)).ok).toBe(true);
 await expect.poll(async()=>{const s=await state();return {active:s.activeTabId,frozen:s.tabs.find((t:any)=>t.tabId===tab.id)?.frozen};}).toEqual({active:tab.id,frozen:false});
 expect(await site(tab.url,"({value:probe.value,input:document.querySelector('input').value})")).toEqual({value:42,input:'kept'});
 expect(hits.get('/tick')).toBe(requests);
 expect((await command('getResources')).data.tabs.find((t:any)=>t.tabId===tab.id).processIds[0]).toBe(pid);
 expect((await state()).history.entries.filter((v:any)=>v.url===tab.url).map((v:any)=>v.eventId)).toHaveLength(1);
});

test('P2-13: a late automatic resume keeps the newer selection and schedules the background page again',async()=>{
 const blank=(await state()).activeTabId;
 const tab=await open('/tick'),front=await open('/plain','front.test');await advance();
 await expect.poll(async()=>(await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(true);
 await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)}),original=w.debugger.sendCommand.bind(w.debugger);w.debugger.sendCommand=(method,params)=>{if(method==='Page.setWebLifecycleState'&&params?.state==='active'){w.debugger.sendCommand=original;return new Promise((resolve,reject)=>{globalThis.releaseAutoResume=()=>original(method,params).then(resolve,reject);});}return original(method,params);};})()`);
 try{
  expect((await command('closeTab',front.id)).ok).toBe(true);
  await expect.poll(()=>driver.evaluate('typeof globalThis.releaseAutoResume')).toBe('function');
  expect((await command('activateTab',blank)).ok).toBe(true);
  // Advance only the test clock while resume is held. No tab action after
  // release: the late completion itself must restore background scheduling.
  await driver.evaluate('(()=>{const now=Date.now;Date.now=()=>now()+180000;globalThis.releaseAutoResume();delete globalThis.releaseAutoResume;})()');
  await expect.poll(async()=>{const s=await state();return {active:s.activeTabId,frozen:s.tabs.find((t:any)=>t.tabId===tab.id)?.frozen};}).toEqual({active:blank,frozen:true});
  expect((await state()).notice??'').not.toContain('otomatik etkinleştirilemedi');
  expect((await command('activateTab',tab.id)).ok).toBe(true);
  expect(await site(tab.url,'probe.value')).toBe(42);
  expect(hits.get('/tick')).toBe(1);
 }finally{await driver.evaluate('if(globalThis.releaseAutoResume){globalThis.releaseAutoResume();delete globalThis.releaseAutoResume;}').catch(()=>{});}
});

test('KB-03: delayed keyboard thaw keeps a newer address focus and does not reload the frozen page',async()=>{
 const tab=await open('/tick'),front=await open('/plain','front.test');await advance();
 await expect.poll(async()=>(await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(true);
 await driver.evaluate(`(()=>{const e=require('electron'),w=e.webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)}),original=w.debugger.sendCommand.bind(w.debugger);w.debugger.sendCommand=(method,params)=>{if(method==='Page.setWebLifecycleState'&&params?.state==='active'){w.debugger.sendCommand=original;return new Promise((resolve,reject)=>{globalThis.releaseKeyboardResume=()=>original(method,params).then(resolve,reject);});}return original(method,params);};e.BrowserWindow.getAllWindows()[0].focus();e.webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(front.url)}).focus();})()`);
 const focused=()=>driver.evaluate("require('electron').webContents.getFocusedWebContents()?.getURL()");
 const send=(key:string,modifiers:string[])=>driver.evaluate(`(()=>{const w=require('electron').webContents.getFocusedWebContents();if(!w)throw new Error('No focused WebContents');w.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(key)},modifiers:${JSON.stringify(modifiers)}});w.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(key)},modifiers:${JSON.stringify(modifiers)}});})()`);
 const address=()=>driver.evaluateUi("document.activeElement?.getAttribute('aria-label')");
 try{
  await expect.poll(focused).toBe(front.url);
  await send('Tab',['control','shift']);
  await expect.poll(()=>driver.evaluate('typeof globalThis.releaseKeyboardResume')).toBe('function');
  expect((await state()).activeTabId).toBe(tab.id);
  // Do not force focus to the UI: Ctrl+L must work on the old visible page
  // while the selected page's actual lifecycle command is deliberately held.
  await send('L',['control']);
  await expect.poll(address).toBe('Sayfa adresi');
  await driver.evaluate('globalThis.releaseKeyboardResume();delete globalThis.releaseKeyboardResume;');
  await expect.poll(async()=>(await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(false);
  await expect.poll(address).toBe('Sayfa adresi');
  expect(await focused()).toBe('app://browser/index.html');
  expect(hits.get('/tick')).toBe(1);
  expect(await site(tab.url,"({value:probe.value,input:document.querySelector('input').value})")).toEqual({value:42,input:'kept'});
  console.log('KEYBOARD_LATE_FOCUS '+JSON.stringify({version:(await state()).appVersion,active:(await state()).activeTabId===tab.id,frozen:false,addressFocus:true,requests:hits.get('/tick')}));
 }finally{await driver.evaluate('if(globalThis.releaseKeyboardResume){globalThis.releaseKeyboardResume();delete globalThis.releaseKeyboardResume;}').catch(()=>{});}
});

test('P2-03: keep-awake, media and WebSocket activity protect background pages',async()=>{
 const pin=await open('/tick','pin.test');await command('setTabKeepAwake',pin.id,true);
 const media=await open('/video','media.test'),socket=await open('/socket','socket.test');
 await expect.poll(()=>site(socket.url,'window.socket.readyState')).toBe(1);
 await open('/plain','front.test');await advance();await new Promise(r=>setTimeout(r,800));
 for(const id of [pin.id,media.id,socket.id])expect((await state()).tabs.find((t:any)=>t.tabId===id)?.frozen).not.toBe(true);
});

for(const activity of ['websocket','download'] as const)test(`P2-${activity==='websocket'?'14':'15'}: new ${activity} activity during a pending freeze keeps the page running without reloading`,async()=>{
 const tab=await open('/tick');const front=await open('/plain','front.test');
 const identity=await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)});return {id:w.id,debuggerAttached:w.debugger.isAttached()};})()`);
 const visits=(await state()).history.entries.map((entry:any)=>entry.eventId);
 await driver.evaluate(`(()=>{
  const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)}),original=w.debugger.sendCommand.bind(w.debugger);
  globalThis.freezeRace={frozenReplies:0,activeReplies:0};
  w.debugger.sendCommand=(method,params)=>{
   if(method==='Page.setWebLifecycleState'&&params?.state==='frozen')return new Promise((resolve,reject)=>{globalThis.releaseFreezeRace=()=>{delete globalThis.releaseFreezeRace;original(method,params).then(result=>{globalThis.freezeRace.frozenReplies++;resolve(result);},reject);};});
   if(method==='Page.setWebLifecycleState'&&params?.state==='active')return original(method,params).then(result=>{globalThis.freezeRace.activeReplies++;return result;});
   return original(method,params);
  };
 })()`);
 try{
  await advance();await expect.poll(()=>driver.evaluate('typeof globalThis.releaseFreezeRace')).toBe('function');
  if(activity==='websocket'){
   await site(tab.url,"window.raceSocket=new WebSocket('ws://'+location.host+'/ws');void 0");
   await expect.poll(()=>site(tab.url,'raceSocket.readyState')).toBe(1);
  }else{
   await driver.evaluate(`require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)}).downloadURL(${JSON.stringify(`http://page.test:${port}/race-download`)});void 0`);
   await expect.poll(async()=>(await state()).downloads.some((job:any)=>job.status==='awaiting-approval')).toBe(true);
  }
  const ticks=await site(tab.url,'probe.ticks');
  await driver.evaluate('globalThis.releaseFreezeRace();');
  await expect.poll(()=>driver.evaluate('globalThis.freezeRace.frozenReplies')).toBe(1);
  console.log('FREEZE_RACE_REPLY '+JSON.stringify({version:(await state()).appVersion,activity,trace:await driver.evaluate('globalThis.freezeRace'),frozen:(await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen??false}));
  await expect.poll(()=>driver.evaluate('globalThis.freezeRace.activeReplies')).toBe(1);
  const snapshot=await state();expect(snapshot.activeTabId).toBe(front.id);expect(snapshot.tabs.find((t:any)=>t.tabId===tab.id)?.frozen).not.toBe(true);
  await expect.poll(()=>site(tab.url,'probe.ticks')).toBeGreaterThan(ticks);
  expect(await site(tab.url,"({value:probe.value,input:document.querySelector('input').value})")).toEqual({value:42,input:'kept'});
  expect(await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)});return {id:w.id,debuggerAttached:w.debugger.isAttached()};})()`)).toEqual(identity);
  expect((await state()).history.entries.map((entry:any)=>entry.eventId)).toEqual(visits);expect(hits.get('/tick')).toBe(1);
  console.log('FREEZE_RACE '+JSON.stringify({version:snapshot.appVersion,activity,frozenReplies:1,activeReplies:1,backgroundKeptRunning:true,sameWebContents:true,formPreserved:true,visitsPreserved:true,requests:hits.get('/tick')}));
 }finally{
  await driver.evaluate(`(()=>{if(globalThis.releaseFreezeRace)globalThis.releaseFreezeRace();const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)});if(w&&!w.isDestroyed()&&w.debugger.isAttached())void w.debugger.sendCommand('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});})()`).catch(()=>{});
  const current=await state().catch(()=>undefined);
  for(const job of current?.downloads??[])if(job.status==='awaiting-approval')await command('cancelDownload',job.downloadId).catch(()=>{});
 }
});

test('P2-04: frozen page can be navigated and closed; no debugger/contents residue remains',async()=>{
 const tab=await open('/tick');await open('/plain','front.test');await advance();
 await expect.poll(async()=> (await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(true);
 const newUrl=`http://page.test:${port}/plain`;await command('navigate',tab.id,newUrl);
 await expect.poll(async()=> (await state()).tabs.find((t:any)=>t.tabId===tab.id)?.url).toBe(newUrl);
 await command('closeTab',tab.id);
 expect((await state()).tabs.some((t:any)=>t.tabId===tab.id)).toBe(false);
});

test('P2-05: final live site close schedules one moderate idle reclaim; storage and trusted bridge survive',async()=>{
 const tab=await open('/plain');await site(tab.url,"localStorage.setItem('fixture','kept');document.cookie='fixture=kept;path=/';void 0");
 await command('closeTab',tab.id);
 await expect.poll(async()=> (await command('getResources')).data.idleMemory.status,{timeout:10000}).toBe('released');
 expect(await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].webContents.debugger.isAttached()")).toBe(false);
 const again=await open('/plain');expect(await site(again.url,"({value:localStorage.getItem('fixture'),cookie:document.cookie,bridge:typeof window.browser})")).toEqual({value:'kept',cookie:'fixture=kept',bridge:'undefined'});
});

test('P2-06: ad preferences are profile-isolated and malformed/foreign commands are denied',async()=>{
 const tab=await open('/ads');await command('setAdBlocking',tab.id,false);await command('switchDevelopmentIdentity','test-b');
 await open('/ads');expect((await state()).adBlocking.enabled).toBe(true);
 expect((await command('setAdBlocking',tab.id,true)).ok).toBe(false);
 expect((await command('setAdBlocking','x','yes')).ok).toBe(false);
 const resource=await command('getResources');expect(resource.ok).toBe(true);
 expect(resource.data.processes.every((p:any)=>typeof p.type==='string'&&typeof p.pid==='number')).toBe(true);
 expect(JSON.stringify(resource.data)).not.toContain('http:');
});

test('P2-07: a frozen page is thawed before beforeunload and can still refuse closure',async()=>{
 const tab=await open('/tick');
 await driver.evaluate(`require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(tab.url)}).executeJavaScript("window.onbeforeunload=()=>'';void 0",true)`);
 await open('/plain','front.test');await advance();
 await expect.poll(async()=> (await state()).tabs.find((t:any)=>t.tabId===tab.id)?.frozen).toBe(true);
 const result=await command('closeTab',tab.id);expect(result.ok).toBe(false);expect(result.errorCode).toBe('OPERATION_CANCELLED');
 expect((await state()).tabs.some((t:any)=>t.tabId===tab.id)).toBe(true);
 await site(tab.url,'window.onbeforeunload=null;void 0');
});

test('P2-08: a new live page cancels a pending idle reclaim',async()=>{
 const tab=await open('/plain');await command('closeTab',tab.id);await open('/plain','new.test');
 await new Promise(r=>setTimeout(r,5500));expect((await command('getResources')).data.idleMemory.status).toBe('idle');
});

test('P2-09: bounded GPU cache keeps hardware acceleration, Canvas/WebGL pixels and clean view teardown',async()=>{
 expect(await driver.evaluate("require('electron').app.isHardwareAccelerationEnabled()")).toBe(true);
 const gpuPids=()=>driver.evaluate("require('electron').app.getAppMetrics().filter(p=>p.type==='GPU').map(p=>p.pid)");
 const before=await gpuPids();expect(before.length).toBeGreaterThan(0);
 const tab=await open('/plain');
 const pixels=await site(tab.url,`(()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=8;document.body.append(canvas);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#3d7ac4';ctx.fillRect(0,0,8,8);
  const twoD=[...ctx.getImageData(0,0,1,1).data];
  const other=document.createElement('canvas');other.width=other.height=8;document.body.append(other);
  const gl=other.getContext('webgl2')||other.getContext('webgl');if(!gl)return {twoD,webgl:null};
  gl.clearColor(0.25,0.5,0.75,1);gl.clear(gl.COLOR_BUFFER_BIT);const rgba=new Uint8Array(4);
  gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  return {twoD,webgl:[...rgba],error:gl.getError(),lost:gl.isContextLost()};
 })()`);
 expect(pixels.twoD).toEqual([61,122,196,255]);expect(pixels.webgl).not.toBeNull();
 // UNORM8 conversion may round half values differently across GPU drivers.
 for(const [index,value] of [64,128,191].entries())expect(Math.abs(pixels.webgl[index]-value)).toBeLessThanOrEqual(1);
 expect(pixels.webgl[3]).toBe(255);
 expect(pixels.error).toBe(0);expect(pixels.lost).toBe(false);
 expect((await command('closeTab',tab.id)).ok).toBe(true);
 expect(await driver.evaluate("(()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0];return e.webContents.getAllWebContents().filter(c=>c.id!==w.webContents.id).length;})()")).toBe(0);
 expect(await gpuPids()).toEqual(before);expect((await command('getState')).ok).toBe(true);
});
