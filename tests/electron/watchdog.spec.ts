import { test as base, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { PackagedDriver } from '../packaged/driver';

// Main-inspector-only instrumentation must not share the worker used by the
// Playwright Electron loader/CDP tests. Keep one owned app for this whole file.
const test = base.extend<{}, { mainInspectorIsolation: void }>({
  mainInspectorIsolation: [async ({}, use) => { await use(); }, { scope: 'worker', auto: true }],
});

let server: Server, origin: string, driver: PackagedDriver;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/slow.png') {
      // Keep network loading while the renderer is free to run the fixed probe.
      const timer = setTimeout(() => { if (!res.destroyed) { res.writeHead(404); res.end(); } }, 15000);
      res.once('close', () => clearTimeout(timer)); return;
    }
    res.setHeader('Content-Type', req.url === '/hang.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'self';script-src 'self';style-src 'unsafe-inline'");
    if (req.url === '/hang.js') {
      res.end("window.hangDone=false;window.hangStarted=false;document.querySelector('button').onclick=()=>{if(window.hangStarted)return;window.hangStarted=true;console.log('LOCAL_HANG_START');const end=Date.now()+12000;while(Date.now()<end){};window.hangDone=true;};");
    } else {
      res.end(`<!doctype html><meta charset="utf-8"><title>Watchdog local fixture</title><style>button{width:220px;height:70px}</style><button>Yerel sonlu donma</button><input value="kept">${req.url === '/slow' ? '<img src="/slow.png">' : ''}<script src="/hang.js"></script>`);
    }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  if (driver) await driver.close();
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
});
test.beforeAll(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS;
  driver = new PackagedDriver();
  await driver.launch(resolve('node_modules/electron/dist/electron.exe'), env, false, [resolve('.')], { mainOnly: true, visible: true });
  await expect.poll(async () => {
    if (driver.child.exitCode !== null) throw new Error(`Own Electron child exited: ${driver.child.exitCode}`);
    try { return await driver.evaluateUi("document.body.innerText.includes('Browser Core bağlı')"); } catch { return false; }
  }, { timeout: 15000 }).toBe(true);
});
test.beforeEach(async () => {
  const snapshot = await state();
  const result = await command('switchDevelopmentIdentity', snapshot.developmentIdentity === 'test-a' ? 'test-b' : 'test-a');
  expect(result.ok).toBe(true);
});
test.afterEach(async () => {
  console.log('HEALTH_TEST_FINAL '+JSON.stringify({pid:driver.child.pid,exit:driver.child.exitCode,details:await driver.evaluate("(()=>{const e=require('electron'),w=e.BrowserWindow.getAllWindows()[0];return {pid:process.pid,trace:globalThis.healthTrace,focused:w?.isFocused(),visible:w?.isVisible()};})()").catch(error=>({error:String(error).slice(0,300)}))}));
  expect(driver.errors).toEqual([]);
});
const command = (name: string, ...args: unknown[]) => driver.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
async function state() { const result = await command('getState'); if (!result.ok) throw new Error('State failed'); return result.data; }
async function open(path = '/') {
  const url = origin + path, result = await command('openTab', url); expect(result.ok).toBe(true);
  await expect.poll(async () => (await state()).tabs.find((tab: any) => tab.tabId === result.data.tabId)?.title).toBe('Watchdog local fixture');
  await driver.evaluate(`(()=>{const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0],w=e.webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(url)});win.show();win.focus();w.focus();globalThis.healthTrace={nativeUnresponsive:0,probes:0,acknowledged:0,inputs:0,started:0,frameWrapperStable:w.mainFrame===w.mainFrame};w.on('unresponsive',()=>globalThis.healthTrace.nativeUnresponsive++);w.on('before-mouse-event',()=>globalThis.healthTrace.inputs++);w.on('console-message',event=>{if(event.message==='LOCAL_HANG_START')globalThis.healthTrace.started++;});const frame=w.mainFrame,original=frame.executeJavaScript.bind(frame);frame.executeJavaScript=(code,...args)=>{if(code==='0'){globalThis.healthTrace.probes++;return original(code,...args).then(value=>{globalThis.healthTrace.acknowledged++;return value;});}return original(code,...args);};})()`);
  await expect.poll(() => driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].isVisible()")).toBe(true);
  return { id: result.data.tabId as string, url };
}
async function click(url: string) {
  const fixture = await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(url)});return w.mainFrame.executeJavaScript('(()=>{const b=document.querySelector("button"),r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),handler:typeof b.onclick,done:window.hangDone}})()');})()`);
  console.log('HEALTH_CLICK_FIXTURE '+JSON.stringify(fixture));
  expect(fixture.handler).toBe('function');
  await driver.evaluate(`(()=>{const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0],w=e.webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(url)});win.show();win.focus();w.focus();return w.mainFrame.executeJavaScript('setTimeout(()=>document.querySelector("button").click(),50);void 0').then(()=>{setTimeout(()=>{if(!w.isDestroyed()){w.sendInputEvent({type:'mouseDown',x:${fixture.x},y:${fixture.y},button:'left',clickCount:1});w.sendInputEvent({type:'mouseUp',x:${fixture.x},y:${fixture.y},button:'left',clickCount:1});w.sendInputEvent({type:'keyDown',keyCode:'A'});w.sendInputEvent({type:'keyUp',keyCode:'A'});}},200);});})()`);
}

test('HW-01: a real CPU hang with native input warns automatically and recovers its background tab without replacing the newer selection', async () => {
  test.setTimeout(35000);
  const page = await open();
  await new Promise(done => setTimeout(done, 1200));
  const before = await driver.evaluate('globalThis.healthTrace.probes');
  await new Promise(done => setTimeout(done, 800));
  expect(await driver.evaluate('globalThis.healthTrace.probes')).toBe(before); // No idle heartbeat.
  await click(page.url);
  await expect.poll(async () => (await state()).tabs.find((tab: any) => tab.tabId === page.id)?.errorCode, { timeout: 9500, intervals: [250] }).toBe('RENDER_PROCESS_UNRESPONSIVE');
  const during = await state();
  expect(during.notice).toContain('Sayfa yanıt vermiyor');
  expect(await driver.evaluateUi("document.querySelector('[role=alert]')?.textContent")).toContain('Sayfa yanıt vermiyor');
  const visible = await driver.evaluateUi("(()=>{const r=document.querySelector('[role=alert]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};})()");
  expect(visible.top).toBeGreaterThanOrEqual(0); expect(visible.bottom).toBeLessThanOrEqual(visible.height);
  const png = await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].capturePage().then(image=>[...image.toPNG()])");
  writeFileSync(test.info().outputPath('watchdog-window.png'), Buffer.from(png));
  const front = await command('openTab'); expect(front.ok).toBe(true);
  await expect.poll(async () => (await state()).tabs.find((tab: any) => tab.tabId === page.id)?.status, { timeout: 10000 }).toBe('ready');
  expect((await state()).activeTabId).toBe(front.data.tabId);
  expect((await state()).notice).not.toBe('Sayfa yeniden yanıt veriyor.');
  const content = await driver.evaluate(`require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(page.url)}).mainFrame.executeJavaScript('({done:window.hangDone,value:document.querySelector("input").value})')`);
  expect(content).toEqual({ done: true, value: 'kept' });
  expect(await driver.evaluate('globalThis.healthTrace.started')).toBe(1);
  console.log('HEALTH_REAL_HANG '+JSON.stringify({ version: (await state()).appVersion, trace: await driver.evaluate('globalThis.healthTrace'), recovered: true, newerSelectionPreserved: true }));
});

test('HW-02: slow network loading with a responsive renderer never becomes a hang warning', async () => {
  test.setTimeout(25000);
  const page = await open('/slow');
  expect(await driver.evaluate(`require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(page.url)}).isLoadingMainFrame()`)).toBe(true);
  await driver.evaluate(`(()=>{const w=require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(page.url)});for(let i=0;i<100;i++){w.sendInputEvent({type:'keyDown',keyCode:'A'});w.sendInputEvent({type:'keyUp',keyCode:'A'});}})()`);
  await expect.poll(() => driver.evaluate('globalThis.healthTrace.acknowledged'), { timeout: 4000 }).toBeGreaterThan(0);
  await new Promise(done => setTimeout(done, 7500));
  const tab = (await state()).tabs.find((tab: any) => tab.tabId === page.id);
  expect(tab.errorCode).toBeNull(); expect(tab.loading).toBe(true);
  const count = await driver.evaluate('globalThis.healthTrace.probes');
  expect(count).toBeLessThanOrEqual(2);
  console.log('HEALTH_NETWORK_WAIT '+JSON.stringify({ probes: count, inputs: 100, loading: tab.loading, error: tab.errorCode }));
  await command('closeTab', page.id);
});

test('HW-03: force close requires a current warned tab and explicit native approval, preserving other pages', async () => {
  test.setTimeout(35000);
  const initial = (await state()).activeTabId;
  const page = await open();
  const normal = await command('forceCloseUnresponsive', page.id); expect(normal.ok).toBe(false);
  const foreign = await command('forceCloseUnresponsive', 'foreign'); expect(foreign.ok).toBe(false);
  await new Promise(done => setTimeout(done, 1000)); await click(page.url);
  await expect.poll(async () => (await state()).tabs.find((tab: any) => tab.tabId === page.id)?.errorCode, { timeout: 9500, intervals: [250] }).toBe('RENDER_PROCESS_UNRESPONSIVE');
  // Test only: adapt the native user's answer, never bypass production guards.
  await driver.evaluate("(()=>{const e=require('electron');globalThis.originalHealthDialog=e.dialog.showMessageBox;e.dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});})()");
  const cancelled = await command('forceCloseUnresponsive', page.id);
  expect(cancelled.ok && cancelled.data.closed).toBe(false);
  expect((await state()).tabs.some((tab: any) => tab.tabId === page.id)).toBe(true);
  await driver.evaluate("require('electron').dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})");
  const clicked = await driver.evaluateUi("(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Yanıt vermeyen sekmeyi kapat');if(!b)return false;b.click();return true;})()");
  expect(clicked).toBe(true);
  await expect.poll(async () => (await state()).tabs.some((tab: any) => tab.tabId === page.id)).toBe(false);
  expect((await state()).tabs.map((tab: any) => tab.tabId)).toEqual([initial]);
  expect(await driver.evaluate("require('electron').webContents.getAllWebContents().filter(w=>w.getURL().startsWith('http://127.0.0.1:')).length")).toBe(0);
  await driver.evaluate("require('electron').dialog.showMessageBox=globalThis.originalHealthDialog;delete globalThis.originalHealthDialog");
});
