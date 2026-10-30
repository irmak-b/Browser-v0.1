import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { PackagedDriver } from '../packaged/driver';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let driver: PackagedDriver, server: Server, origin: string;
let oversizedParagraphs = 12000;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!path.startsWith('/dynamic')) res.setHeader('Content-Security-Policy', "default-src 'none'");
    const extra = path.startsWith('/form') ? '<input id="note" value="original">'
      : path.startsWith('/media') ? '<video></video>'
      : path.startsWith('/frame') ? '<iframe src="/static"></iframe>'
      : path.startsWith('/dynamic') ? '<script>window.liveState=42;document.currentScript.remove()</script>' : '';
    res.end(`<!doctype html><meta charset="utf-8"><title>${path}</title>${extra}<p>Static</p>${'<p>local scroll fixture</p>'.repeat(path==='/oversized'?oversizedParagraphs:1000)}`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); });
test.beforeEach(async () => {
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  driver = new PackagedDriver();
  await driver.launch(resolve('node_modules/electron/dist/electron.exe'),env,false,[resolve('.')]);
  await expect.poll(async()=>{try{return await driver.evaluateUi("document.body.innerText.includes('Browser Core bağlı')");}catch{return false;}}).toBe(true);
});
test.afterEach(async () => { await driver?.close();expect(driver.errors).toEqual([]); });
async function state(): Promise<BrowserSnapshot> { const r=await driver.evaluateUi('window.browser.getState()');if(!r.ok)throw new Error();return r.data; }
async function command(name:string,...args:unknown[]) { return driver.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`); }
async function open(path: string) {
  const r=await command('openTab',origin+path);if(!r.ok)throw new Error();
  await expect.poll(async()=> (await state()).tabs.find(t=>t.tabId===r.data.tabId)?.status).toBe('ready');
  return r.data.tabId as string;
}
async function advance() {
  // Test-only main clock acceleration; production uses five real minutes.
  await driver.evaluate('(()=>{const now=Date.now;Date.now=()=>now()+360000;})()');
  await command('activateTab',(await state()).activeTabId);
}
async function counts() { return driver.evaluate(`(()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0];return {
  views:w.contentView.children.filter(v=>v instanceof e.WebContentsView&&v.webContents.id!==w.webContents.id).length,
  contents:e.webContents.getAllWebContents().length};})()`); }
async function site(path:string,code:string){return driver.evaluate(`require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith(${JSON.stringify(path)})).executeJavaScript(${JSON.stringify(code)})`);}

test('P01: ten empty tabs allocate no site contents; navigation and last close allocate/release exactly one',async()=>{
  for(let i=1;i<10;i++)await command('openTab');
  expect((await state()).tabs).toHaveLength(10);expect(await counts()).toEqual({views:0,contents:1});
  const id=(await state()).activeTabId!;await command('navigate',id,origin+'/static');
  await expect.poll(async()=> (await state()).tabs.find(t=>t.tabId===id)?.status).toBe('ready');expect(await counts()).toEqual({views:1,contents:2});
  for(const t of (await state()).tabs)await command('closeTab',t.tabId);
  expect((await state()).tabs).toHaveLength(1);expect(await counts()).toEqual({views:0,contents:1});
});

test('P02: static GET sleeps and destroys contents; wake preserves identity/session/scroll without duplicate visit',async()=>{
  const id=await open('/static');
  expect(await driver.evaluate("require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith('/static')).isBeingCaptured()")).toBe(false);
  await site('/static',"window.scrollTo(0,600);document.cookie='sleep=kept;path=/';void 0");
  await driver.evaluate("globalThis.sleepOld=require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith('/static'));void 0");
  const before=(await state()).history.entries.length;
  await command('setTabMuted',id,true);
  await open('/static-active');await advance();
  await expect.poll(async()=> (await state()).tabs.find(t=>t.tabId===id)?.status).toBe('sleeping');
  expect(await counts()).toEqual({views:1,contents:2});expect(await driver.evaluate('globalThis.sleepOld.isDestroyed()')).toBe(true);
  await command('setTabMuted',id,false);await command('setTabMuted',id,true);
  expect(await counts()).toEqual({views:1,contents:2});
  await command('activateTab',id);await expect.poll(async()=> (await state()).tabs.find(t=>t.tabId===id)?.status).toBe('ready');
  expect(await driver.evaluate("require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith('/static')).isAudioMuted()")).toBe(true);
  expect((await state()).tabs.find(t=>t.tabId===id)?.muted).toBe(true);
  expect((await state()).activeTabId).toBe(id);
  await expect.poll(()=>site('/static','scrollY')).toBe(600);
  expect(await site('/static','({cookie:document.cookie,bridge:typeof window.browser,node:typeof require})')).toEqual({cookie:'sleep=kept',bridge:'undefined',node:'undefined'});
  expect((await state()).history.entries.length).toBe(before+1);
});

test('P03: forms/media/frames/self-removed scripts remain resident; active tab never sleeps',async()=>{
  const ids:string[]=[];for(const path of ['/form','/media','/frame','/dynamic','/static-active'])ids.push(await open(path));
  await site('/form',"document.querySelector('input').value='unsaved';void 0");
  await advance();await new Promise(r=>setTimeout(r,1800));
  expect((await state()).tabs.filter(t=>ids.includes(t.tabId)).every(t=>t.status==='ready')).toBe(true);
  // P2 may freeze a resident page without discarding its state. Resume before
  // posting script execution to its otherwise paused renderer task queue.
  await command('activateTab',ids[0]);
  expect(await site('/form',"document.querySelector('input').value")).toBe('unsaved');
  await command('activateTab',ids[3]);
  expect(await site('/dynamic','window.liveState')).toBe(42);
});

test('P04: user keep-awake and real page interaction protect state; preference IPC rejects invalid inputs',async()=>{
  const pinned=await open('/static-pinned');await command('setTabKeepAwake',pinned,true);
  const interacted=await open('/static-interacted');
  await driver.evaluate("(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith('/static-interacted'));w.focus();w.sendInputEvent({type:'mouseDown',x:10,y:10,button:'left',clickCount:1});w.sendInputEvent({type:'mouseUp',x:10,y:10,button:'left',clickCount:1});})()");
  await new Promise(r=>setTimeout(r,150));await open('/static-active');await advance();await new Promise(r=>setTimeout(r,1800));
  expect((await state()).tabs.filter(t=>[pinned,interacted].includes(t.tabId)).every(t=>t.status==='ready')).toBe(true);
  for(const args of [['foreign',true],['',true],['x','yes']])expect((await command('setTabKeepAwake',...args)).ok).toBe(false);
});

test('P11: consumed browser shortcuts and modifier keys do not permanently protect a static page from sleep',async()=>{
  const id=await open('/static-shortcuts'),front=await open('/static-front');
  await command('activateTab',id);
  await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith('/static-shortcuts'));w.focus();
    w.sendInputEvent({type:'keyDown',keyCode:'Control'});
    w.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:['control']});
    w.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:['control']});
    w.sendInputEvent({type:'keyUp',keyCode:'Control'});})()`);
  await expect.poll(()=>driver.evaluate("require('electron').webContents.getFocusedWebContents()?.getURL()")).toBe('app://browser/index.html');
  await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith('/static-shortcuts'));globalThis.shortcutSleepOld=w;w.focus();
    w.sendInputEvent({type:'keyDown',keyCode:'Control'});
    w.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['control']});
    w.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['control']});
    w.sendInputEvent({type:'keyUp',keyCode:'Control'});})()`);
  await expect.poll(async()=>(await state()).activeTabId).toBe(front);
  await advance();await new Promise(done=>setTimeout(done,700));
  const status=(await state()).tabs.find(tab=>tab.tabId===id)?.status;
  console.log('SHORTCUT_SLEEP '+JSON.stringify({status,controlLFocusedUi:true,controlTabSelectedNeighbor:true}));
  expect(status).toBe('sleeping');
  expect(await driver.evaluate('globalThis.shortcutSleepOld.isDestroyed()')).toBe(true);
});

test('P12: ordinary page keys and unconsumed control chords still protect resident state',async()=>{
  const ids:string[]=[];
  for(const [path,key,modifiers] of [['/static-typed','A',[]],['/static-select-all','A',['control']]] as const){
    const id=await open(path);ids.push(id);
    await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith(${JSON.stringify(path)}));w.focus();
      w.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(key)},modifiers:${JSON.stringify(modifiers)}});
      w.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(key)},modifiers:${JSON.stringify(modifiers)}});})()`);
  }
  await new Promise(done=>setTimeout(done,150));await open('/static-front');await advance();await new Promise(done=>setTimeout(done,700));
  const statuses=(await state()).tabs.filter(tab=>ids.includes(tab.tabId)).map(tab=>tab.status);
  console.log('PAGE_KEY_PROTECTION '+JSON.stringify({statuses,ordinaryAndControlA:true}));
  expect(statuses).toEqual(['ready','ready']);
});

test('P05: multi-entry history is protected; closing sleeping tabs never wakes them',async()=>{
  const history=await open('/static-first');await command('navigate',history,origin+'/static-second');
  await expect.poll(async()=> (await state()).tabs.find(t=>t.tabId===history)?.status).toBe('ready');
  const sleeper=await open('/static-sleeper');await open('/static-active');await advance();
  await expect.poll(async()=> (await state()).tabs.find(t=>t.tabId===sleeper)?.status).toBe('sleeping');
  expect((await state()).tabs.find(t=>t.tabId===history)?.status).toBe('ready');
  await command('closeTab',sleeper);expect((await state()).tabs.some(t=>t.tabId===sleeper)).toBe(false);expect(await counts()).toEqual({views:2,contents:3});
  expect((await state()).canRestoreClosedTab).toBe(true);
  const restored=await command('restoreClosedTab');expect(restored.ok).toBe(true);expect(restored.data.tabId).not.toBe(sleeper);
  await expect.poll(async()=>(await state()).tabs.find(t=>t.tabId===restored.data.tabId)?.status).toBe('ready');
  expect((await state()).tabs.find(t=>t.tabId===restored.data.tabId)?.url).toBe(origin+'/static-sleeper');
  expect(await counts()).toEqual({views:3,contents:4});
  console.log('RESTORE_SLEEP '+JSON.stringify({closedWithoutWake:true,restoredOnlyOnRequest:true,newContents:true}));
});

test('P09: active close restores its automatically selected sleeping neighbor and keeps scroll/session/history',async()=>{
  const id=await open('/static-auto-sleep');
  await site('/static-auto-sleep',"window.scrollTo(0,500);document.cookie='autoSleep=kept;path=/';void 0");
  const front=await open('/static-front');await advance();
  await expect.poll(async()=>(await state()).tabs.find(t=>t.tabId===id)?.status).toBe('sleeping');
  const visits=(await state()).history.entries.map(v=>v.eventId);
  expect((await command('closeTab',front)).ok).toBe(true);
  await expect.poll(async()=>{const s=await state();return {active:s.activeTabId,status:s.tabs.find(t=>t.tabId===id)?.status};}).toEqual({active:id,status:'ready'});
  await expect.poll(()=>site('/static-auto-sleep','scrollY')).toBe(500);
  expect(await site('/static-auto-sleep','document.cookie')).toContain('autoSleep=kept');
  expect((await state()).history.entries.map(v=>v.eventId)).toEqual(visits);
});

test('P06: switching profile cleans sleeping records; closed profile tab cannot be revived',async()=>{
  const id=await open('/static-sleeper');await open('/static-active');await advance();
  await expect.poll(async()=> (await state()).tabs.find(t=>t.tabId===id)?.status).toBe('sleeping');
  const old=(await state()).contextEpoch;await command('switchDevelopmentIdentity','test-b');
  expect((await state()).contextEpoch).not.toBe(old);expect((await state()).tabs).toHaveLength(1);expect(await counts()).toEqual({views:0,contents:1});
  expect((await command('activateTab',id)).ok).toBe(false);
  expect((await state()).canRestoreClosedTab).toBe(false);
});

test('P07: activation while eligibility probe is pending cancels discard and preserves the original contents',async()=>{
  const id=await open('/static-race');await open('/static-active');
  await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith('/static-race'));
    globalThis.raceOriginal=w;const original=w.executeJavaScriptInIsolatedWorld.bind(w);
    w.executeJavaScriptInIsolatedWorld=(...args)=>new Promise(resolve=>{globalThis.releaseResourceProbe=()=>{w.executeJavaScriptInIsolatedWorld=original;original(...args).then(resolve)};});})()`);
  await advance();await expect.poll(()=>driver.evaluate("typeof globalThis.releaseResourceProbe")).toBe('function');
  await command('activateTab',id);await driver.evaluate('globalThis.releaseResourceProbe();void 0');
  await new Promise(r=>setTimeout(r,300));expect((await state()).tabs.find(t=>t.tabId===id)?.status).toBe('ready');
  expect(await driver.evaluate('globalThis.raceOriginal.isDestroyed()')).toBe(false);
});

test('P08: repeated sleep/wake cycles release old contents and subscriptions without adding history visits',async()=>{
  const id=await open('/static-cycles'), active=await open('/static-active');
  const visits=(await state()).history.entries.length;
  await driver.evaluate('globalThis.sleptContents=[];void 0');
  for(let i=0;i<3;i++){
    await driver.evaluate("globalThis.sleptContents.push(require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith('/static-cycles')));void 0");
    await command('activateTab',active);await advance();
    await expect.poll(async()=> (await state()).tabs.find(t=>t.tabId===id)?.status).toBe('sleeping');
    await command('activateTab',id);await expect.poll(async()=> (await state()).tabs.find(t=>t.tabId===id)?.status).toBe('ready');
  }
  expect((await state()).history.entries.length).toBe(visits);
  expect(await driver.evaluate("globalThis.sleptContents.every(w=>w.isDestroyed()&&['did-start-navigation','page-title-updated','before-input-event','before-mouse-event','unresponsive','responsive','destroyed'].every(e=>w.listenerCount(e)===0))")).toBe(true);
});

test('P10: oversized documents are inspected once per document; a committed reload permits a new check',async()=>{
  oversizedParagraphs=12000;
  const id=await open('/oversized'),front=await open('/static-active');
  await driver.evaluate(`(()=>{
    const wc=require('electron').webContents.getAllWebContents().find(w=>w.getURL().endsWith('/oversized'));
    globalThis.boundedProbeContents=wc;
    globalThis.boundedProbeAttempts=0;
    const original=wc.executeJavaScriptInIsolatedWorld.bind(wc);
    wc.executeJavaScriptInIsolatedWorld=(world,scripts,...rest)=>{
      if(!scripts[0]?.code.includes('document.contentType'))return original(world,scripts,...rest);
      globalThis.boundedProbeAttempts++;
      const code=scripts[0].code;
      const instrumented='(()=>{const audit={fullListEntries:0,walkerSteps:0};const all=document.querySelectorAll,create=document.createTreeWalker;document.querySelectorAll=function(selector){const list=all.call(this,selector);if(selector===\"*\")audit.fullListEntries+=list.length;return list;};document.createTreeWalker=function(...args){const walker=create.apply(this,args),next=walker.nextNode.bind(walker);walker.nextNode=()=>{audit.walkerSteps++;return next();};return walker;};try{const result=('+code+');return {result,audit};}finally{document.querySelectorAll=all;document.createTreeWalker=create;}})()';
      return original(world,[{...scripts[0],code:instrumented}],...rest).then(value=>{globalThis.boundedProbeAudit={...value.audit,rejected:value.result===false||value.result?.safe===false};return value.result;});
    };
  })()`);
  await advance();await expect.poll(()=>driver.evaluate('!!globalThis.boundedProbeAudit')).toBe(true);
  const audit=await driver.evaluate('globalThis.boundedProbeAudit');console.log('STATIC_PROBE_BUDGET '+JSON.stringify(audit));
  expect(audit.fullListEntries).toBe(0);expect(audit.walkerSteps).toBeGreaterThan(0);expect(audit.walkerSteps).toBeLessThanOrEqual(5001);expect(audit.rejected).toBe(true);
  expect((await state()).tabs.find(tab=>tab.tabId===id)?.status).toBe('ready');
  expect(await driver.evaluate('globalThis.boundedProbeContents.isDestroyed()')).toBe(false);
  expect(await site('/oversized',"document.querySelectorAll('p').length")).toBe(12001);
  expect(await counts()).toEqual({views:2,contents:3});
  for(let i=0;i<3;i++){await advance();await new Promise(done=>setTimeout(done,100));}
  const attempts=await driver.evaluate('globalThis.boundedProbeAttempts');
  console.log('STATIC_PROBE_REPEATS '+JSON.stringify({attempts,extraIdlePeriods:3}));
  expect(attempts).toBe(1);
  await command('activateTab',id);
  await driver.evaluate(`(()=>{const wc=globalThis.boundedProbeContents;globalThis.probePrevented=0;wc.once('will-prevent-unload',()=>globalThis.probePrevented++);return wc.executeJavaScript('window.onbeforeunload=()=>false;void 0',true);})()`);
  const beforeCancelledReload=(await state()).history.entries.length;
  await command('reload',id);await expect.poll(()=>driver.evaluate('globalThis.probePrevented')).toBe(1);
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===id)?.status).toBe('ready');
  expect((await state()).history.entries.length).toBe(beforeCancelledReload);
  await driver.evaluate("globalThis.boundedProbeContents.executeJavaScript('window.onbeforeunload=null;void 0')");
  await command('activateTab',front);await advance();await new Promise(done=>setTimeout(done,100));
  expect(await driver.evaluate('globalThis.boundedProbeAttempts')).toBe(1);
  console.log('STATIC_PROBE_CANCELLED_RELOAD '+JSON.stringify({sameDocumentAttempts:1,cancelledReloadDidNotReset:true}));
  // Real same-URL reload, smaller response, same native history entry/WC.
  await command('activateTab',id);oversizedParagraphs=1000;
  const visits=(await state()).history.entries.length;
  await command('reload',id);await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===id)?.status).toBe('ready');
  expect(await site('/oversized',"document.querySelectorAll('p').length")).toBe(1001);
  await expect.poll(async()=>(await state()).history.entries.length).toBe(visits+1);
  await command('activateTab',front);await advance();
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===id)?.status).toBe('sleeping');
  expect(await driver.evaluate('globalThis.boundedProbeAttempts')).toBe(2);
  expect(await driver.evaluate('globalThis.boundedProbeContents.isDestroyed()')).toBe(true);
  expect((await state()).history.entries.length).toBe(visits+1);
  console.log('STATIC_PROBE_DOCUMENT_RESET '+JSON.stringify({attemptsAfterReload:2,sameUrlReload:true,newSmallDocumentSleeps:true,extraSleepVisit:0}));
});
