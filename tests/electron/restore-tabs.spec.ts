import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let app: ElectronApplication, ui: Page;
const errors:string[]=[];
test.describe.configure({mode:'serial'});
test.beforeAll(async()=>{
  const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await electron.launch({args:[resolve('.')],env,chromiumSandbox:true});
  app.process().stderr?.on('data',(chunk:Buffer)=>{if(/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString()))errors.push(chunk.toString());});
  ui=await app.firstWindow();await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
});
test.beforeEach(async()=>{
  const s=await state();
  await ui.evaluate(id=>window.browser.switchDevelopmentIdentity(id as 'test-a'|'test-b'),s.developmentIdentity==='test-a'?'test-b':'test-a');
});
test.afterEach(async()=>{
  await app.evaluate(async({webContents})=>{for(const wc of webContents.getAllWebContents())if(wc.getURL().startsWith('http://127.0.0.1:'))await wc.executeJavaScript('window.onbeforeunload=null;void 0').catch(()=>{});});
  await app.evaluate(()=>{delete (globalThis as any).__restoreOld;delete (globalThis as any).__restoreSession;});
});
test.afterAll(async()=>{if(app)await app.close();expect(errors).toEqual([]);});
async function state():Promise<BrowserSnapshot>{return ui.evaluate(async()=>{const r=await window.browser.getState();if(!r.ok)throw Error('State failed');return r.data;});}
async function ready(id:string){await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===id)?.status).toBe('ready');}
async function navigate(path:string){const s=await state(),url=new URL(path,s.fixtureUrl).href;const r=await ui.evaluate(({id,url})=>window.browser.navigate(id,url),{id:s.activeTabId!,url});expect(r.ok).toBe(true);await ready(s.activeTabId!);return {id:s.activeTabId!,url};}
async function count(){return app.evaluate(({webContents})=>webContents.getAllWebContents().filter(wc=>wc.getURL().startsWith('http://127.0.0.1:')).length);}
async function sendRestore(){await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0]!;win.focus();win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode:'T',modifiers:['control','shift']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'T',modifiers:['control','shift']});});}

test('RT-01: Ctrl+Shift+T reloads the closed address in the same session, with a new renderer and no retained form',async()=>{
  const p=await navigate('/page/1?restore=fixture#part');
  const previous=await app.evaluate(async({webContents},url)=>{const wc=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!;(globalThis as any).__restoreOld=wc;(globalThis as any).__restoreSession=wc.session;await wc.executeJavaScript("document.querySelector('#state-input').value='unsaved-fixture';window.restoreMarker=1;void 0");return wc.id;},p.url);
  expect((await ui.evaluate(id=>window.browser.closeTab(id),p.id)).ok).toBe(true);
  expect(await count()).toBe(0);
  await expect(ui.getByRole('button',{name:'Kapatılan sekmeyi aç',exact:true})).toBeEnabled();
  await sendRestore();
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.url===p.url)?.status).toBe('ready');
  const s=await state(),restored=s.tabs.find(tab=>tab.url===p.url)!;
  expect(s.activeTabId).toBe(restored.tabId);expect(restored.tabId).not.toBe(p.id);expect(s.canRestoreClosedTab).toBe(false);
  const actual=await app.evaluate(async({webContents},url)=>{
    const wc=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!;const old=(globalThis as any).__restoreOld as Electron.WebContents;
    return {id:wc.id,sameSession:wc.session===(globalThis as any).__restoreSession,oldDestroyed:old.isDestroyed(),oldListeners:old.listenerCount('context-menu'),values:await wc.executeJavaScript("({input:document.querySelector('#state-input').value,marker:typeof window.restoreMarker,bridge:typeof window.browser,node:typeof process})")};
  },p.url);
  expect(actual.id).not.toBe(previous);expect(actual.sameSession).toBe(true);expect(actual.oldDestroyed).toBe(true);expect(actual.oldListeners).toBe(0);
  expect(actual.values).toEqual({input:'',marker:'undefined',bridge:'undefined',node:'undefined'});
  const visible=await app.evaluate(async({BrowserWindow,WebContentsView},url)=>{
    const win=BrowserWindow.getAllWindows()[0]!;
    const view=win.contentView.children.find(view=>view instanceof WebContentsView&&view.webContents.getURL()===url) as Electron.WebContentsView;
    await view.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(0))))');
    return {visible:view.getVisible(),bounds:view.getBounds(),png:[...(await view.webContents.capturePage()).toPNG()]};
  },p.url);
  expect(visible.visible).toBe(true);expect(visible.bounds.width).toBeGreaterThan(0);expect(visible.bounds.height).toBeGreaterThan(0);
  writeFileSync(`docs/evidence/p2-${s.appVersion.toLowerCase()}-restored-page.png`,Buffer.from(visible.png));
  await expect(ui.getByTestId('policy-notice')).toContainText('form ve video durumu geri getirilmez');
  const png=await app.evaluate(async({BrowserWindow})=>[...(await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG()]);
  writeFileSync(`docs/evidence/p2-${s.appVersion.toLowerCase()}-restore-window.png`,Buffer.from(png));
  console.log('RESTORE_NATIVE '+JSON.stringify({version:s.appVersion,oldRendererDestroyed:true,newWebContents:true,sameSession:true,nativePages:await count(),formNotRetained:true}));
});

test('RT-02: UI button restores newest-first and empty tabs or cancelled closes never create restore entries',async()=>{
  expect((await state()).canRestoreClosedTab).toBe(false);
  expect((await ui.evaluate(id=>window.browser.closeTab(id),(await state()).activeTabId!)).ok).toBe(true);
  expect((await state()).canRestoreClosedTab).toBe(false);
  const p=await navigate('/page/1');
  await app.evaluate(async({webContents},url)=>{await webContents.getAllWebContents().find(wc=>wc.getURL()===url)!.executeJavaScript('window.onbeforeunload=()=>false;void 0',true);},p.url);
  const rejected=await ui.evaluate(id=>window.browser.closeTab(id),p.id);expect(rejected).toMatchObject({ok:false,errorCode:'OPERATION_CANCELLED'});expect((await state()).canRestoreClosedTab).toBe(false);
  await app.evaluate(async({webContents},url)=>{await webContents.getAllWebContents().find(wc=>wc.getURL()===url)!.executeJavaScript('window.onbeforeunload=null;void 0');},p.url);
  await ui.evaluate(id=>window.browser.closeTab(id),p.id);
  const second=await navigate('/page/2');await ui.evaluate(id=>window.browser.closeTab(id),second.id);
  await ui.getByRole('button',{name:'Kapatılan sekmeyi aç',exact:true}).click();
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.url===second.url)?.status).toBe('ready');
  expect((await state()).canRestoreClosedTab).toBe(true);
  await ui.getByRole('button',{name:'Kapatılan sekmeyi aç',exact:true}).click();
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.url===p.url)?.status).toBe('ready');
  const s=await state();expect(s.tabs.find(tab=>tab.tabId===s.activeTabId)?.url).toBe(p.url);expect(s.canRestoreClosedTab).toBe(false);
  await expect(ui.getByRole('button',{name:'Kapatılan sekmeyi aç',exact:true})).toBeDisabled();
  console.log('RESTORE_LIFO '+JSON.stringify({newestFirst:true,emptyTabNotSaved:true,beforeunloadNotSaved:true}));
});

test('RT-03: 32-tab limit keeps the pending address; identity switch discards it and malformed IPC cannot inject a URL',async()=>{
  const p=await navigate('/page/1');await ui.evaluate(id=>window.browser.closeTab(id),p.id);
  await ui.evaluate(async()=>{for(let i=0;i<31;i++){const r=await window.browser.openTab();if(!r.ok)throw Error('Open failed');}});
  expect((await state()).tabs.length).toBe(32);expect(await count()).toBe(0);
  expect((await state()).canRestoreClosedTab).toBe(false);
  expect(await ui.evaluate(()=>window.browser.restoreClosedTab())).toMatchObject({ok:false,errorCode:'INVALID_INPUT'});
  await ui.evaluate(id=>window.browser.closeTab(id),(await state()).activeTabId!);
  expect((await state()).canRestoreClosedTab).toBe(true);
  const restored=await ui.evaluate(()=>window.browser.restoreClosedTab());expect(restored.ok).toBe(true);if(!restored.ok)throw Error('Restore failed');await ready(restored.data.tabId);
  expect((await state()).tabs.length).toBe(32);expect(await count()).toBe(1);
  await ui.evaluate(id=>window.browser.closeTab(id),restored.data.tabId);expect((await state()).canRestoreClosedTab).toBe(true);
  const invalid=await app.evaluate(async({ipcMain,BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows()[0]!;
    const handler=(ipcMain as any)._invokeHandlers.get('browser:restore-closed-tab');
    const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
    const malformed=await handler(event,{url:'https://untrusted.example.test/',partition:'other'});
    const foreign=await handler({sender:{id:-1,isDestroyed:()=>false},senderFrame:win.webContents.mainFrame},undefined);
    return {malformed:malformed.errorCode,foreign:foreign.errorCode};
  });
  expect(invalid).toEqual({malformed:'INVALID_INPUT',foreign:'UNAUTHORIZED'});expect((await state()).canRestoreClosedTab).toBe(true);
  const identity=(await state()).developmentIdentity;
  await ui.evaluate(id=>window.browser.switchDevelopmentIdentity(id as 'test-a'|'test-b'),identity==='test-a'?'test-b':'test-a');
  expect((await state()).canRestoreClosedTab).toBe(false);
  await ui.evaluate(id=>window.browser.switchDevelopmentIdentity(id),identity);
  expect((await state()).canRestoreClosedTab).toBe(false);expect(await count()).toBe(0);
  expect(await ui.evaluate(()=>window.browser.restoreClosedTab())).toMatchObject({ok:false,errorCode:'OPERATION_CANCELLED'});
  console.log('RESTORE_BOUNDS '+JSON.stringify({tabLimit:32,blankNativePages:0,addressKeptOnLimit:true,identityCleared:true,malformed:invalid.malformed,foreign:invalid.foreign}));
});
