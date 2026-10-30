import { test as base, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PackagedDriver } from '../packaged/driver';

// Keep main-inspector-only children out of the worker that loaded Playwright's
// Electron/CDP adapter, as in the existing watchdog correctness tests.
const test=base.extend<{}, {navigationInspectorIsolation:void}>({
 navigationInspectorIsolation:[async({},use)=>{await use();},{scope:'worker',auto:true}],
});

let driver:PackagedDriver,url:string,requests=0,delayedResponse=false;
const server=createServer((req,res)=>{
 if(req.url!=='/'){res.writeHead(404);res.end();return;}
 requests++;res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
 const finish=()=>res.end('<!doctype html><title>Healthy local document</title><input value="new document">');
 if(delayedResponse&&requests===2){const timer=setTimeout(finish,6500);res.once('close',()=>clearTimeout(timer));}else finish();
});
const command=(name:string,...args:unknown[])=>driver.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
const state=async()=>{const r=await command('getState');if(!r.ok)throw Error('state');return r.data;};
test.describe.configure({mode:'serial'});
test.beforeAll(async()=>{
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
 driver=new PackagedDriver();const env:NodeJS.ProcessEnv={...process.env,BROWSER_CORE_INSTANCE_SCOPE:randomUUID()};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  await driver.launch(resolve('node_modules/electron/dist/electron.exe'),env,false,[resolve('.')],{mainOnly:true});
  await expect.poll(async()=>{try{return await driver.evaluateUi('!!window.browser');}catch{return false;}},{timeout:15000}).toBe(true);
  // Test-only virtual focus permits a hidden correctness test while the user
  // works. No visible-performance or native OS focus claim is made.
  await driver.evaluate(`(()=>{const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0];win.hide();win.isFocused=()=>true;win.isVisible=()=>true;win.isMinimized=()=>false;
   globalThis.commitProbe={calls:0,replies:0,commits:0};const proto=Object.getPrototypeOf(win.webContents.mainFrame),original=proto.executeJavaScript;
   proto.executeJavaScript=function(code,...args){if(code!=='0')return original.call(this,code,...args);const a=globalThis.commitProbe;a.calls++;if(a.calls===1)return new Promise(resolve=>{a.releaseOld=()=>resolve(0);});return original.call(this,code,...args).then(value=>{a.replies++;return value;});};
   e.app.on('web-contents-created',(_event,w)=>{globalThis.commitProbe.owner=w;w.on('did-navigate',()=>globalThis.commitProbe.commits++);});})();`);
});
test.afterAll(async()=>{await driver?.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));});
test.beforeEach(async()=>{
 const snapshot=await state();expect((await command('switchDevelopmentIdentity',snapshot.developmentIdentity==='test-a'?'test-b':'test-a')).ok).toBe(true);
 requests=0;await driver.evaluate('globalThis.commitProbe={calls:0,replies:0,commits:0};void 0');
});
test.afterEach(async()=>{await driver.evaluate('globalThis.commitProbe?.releaseOld?.();void 0').catch(()=>{});expect(driver.errors).toEqual([]);});
for(const delayed of [false,true])test(`${delayed?'HW-05':'HW-04'}: a lost reply ${delayed?'warned before commit':'from the old document'} cannot hide a healthy committed reload`,async()=>{
 test.setTimeout(35000);delayedResponse=delayed;
  const opened=await command('openTab',url);expect(opened.ok).toBe(true);
  await expect.poll(async()=>(await state()).tabs.find((tab:any)=>tab.tabId===opened.data.tabId)?.status).toBe('ready');
  await expect.poll(()=>driver.evaluate('globalThis.commitProbe.calls')).toBe(1);
  const before=await driver.evaluate('({commits:globalThis.commitProbe.commits,contentsId:globalThis.commitProbe.owner.id})');
  expect((await command('reload',opened.data.tabId)).ok).toBe(true);
  if(delayed){
   await expect.poll(async()=>(await state()).tabs.find((tab:any)=>tab.tabId===opened.data.tabId)?.errorCode,{timeout:6000,intervals:[100]}).toBe('RENDER_PROCESS_UNRESPONSIVE');
  }
  await expect.poll(()=>driver.evaluate('globalThis.commitProbe.commits')).toBeGreaterThan(before.commits);
  await expect.poll(async()=>(await state()).tabs.find((tab:any)=>tab.tabId===opened.data.tabId)?.status).toBe('ready');
  await new Promise(done=>setTimeout(done,6000));
  const tab=(await state()).tabs.find((tab:any)=>tab.tabId===opened.data.tabId);
  const audit=await driver.evaluate('({calls:globalThis.commitProbe.calls,replies:globalThis.commitProbe.replies,commits:globalThis.commitProbe.commits,contentsId:globalThis.commitProbe.owner.id})');
  console.log('HEALTH_COMMITTED_DOCUMENT '+JSON.stringify({audit,status:tab.status,errorCode:tab.errorCode,sameContents:audit.contentsId===before.contentsId}));
  expect(tab.errorCode).toBeNull();expect(audit.calls).toBeGreaterThanOrEqual(2);expect(audit.replies).toBeGreaterThanOrEqual(1);
  await driver.evaluate('globalThis.commitProbe.releaseOld();void 0');await new Promise(done=>setTimeout(done,100));
  expect((await state()).tabs.find((t:any)=>t.tabId===opened.data.tabId)?.errorCode).toBeNull();
});
