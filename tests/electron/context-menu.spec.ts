import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let app: ElectronApplication, ui: Page;
const errors: string[] = [];
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  app = await electron.launch({ args: [resolve('.')], env, chromiumSandbox: true });
  app.process().stderr?.on('data', (chunk: Buffer) => { if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString())) errors.push(chunk.toString()); });
  ui = await app.firstWindow(); await expect(ui.getByText('Browser Core bağlı', {exact:true})).toBeVisible();
  await app.evaluate(({ Menu, clipboard, BrowserWindow }) => {
    const state = { count:0, shown:0, closed:0, choice:'', real:true, menu:null as Electron.Menu|null, params:null as Electron.ContextMenuParams|null,
      items:[] as {id:string;enabled:boolean}[], copies:[] as string[], actions:[] as string[], originalPopup:Menu.prototype.popup, originalCopy:clipboard.writeText };
    (globalThis as any).__contextTest=state;
    // Do not inspect or alter the user's real clipboard. Link copies are captured.
    clipboard.writeText = async text => { state.copies.push(text); };
    Menu.prototype.popup = function(options) {
      state.count++; state.menu=this; state.items=this.items.map(item => ({id:item.id,enabled:item.enabled}));
      this.once('menu-will-show',()=>{state.shown++;}); this.once('menu-will-close',()=>{state.closed++;});
      const choose=state.choice;
      if(state.real) {
        setTimeout(()=>{ const item=choose?this.getMenuItemById(choose):null; if(item?.enabled)item.click();else this.closePopup(BrowserWindow.getAllWindows()[0]); },150);
        state.originalPopup.call(this,options);
      }
    };
  });
});
test.beforeEach(async () => {
  const s=await state();
  await ui.evaluate(id => window.browser.switchDevelopmentIdentity(id as 'test-a'|'test-b'),s.developmentIdentity==='test-a'?'test-b':'test-a');
  await app.evaluate(()=>{ const s=(globalThis as any).__contextTest;s.choice='';s.real=true;s.items=[];s.copies=[];s.actions=[]; });
});
test.afterAll(async () => { if(app)await app.close(); expect(errors).toEqual([]); });
async function state(): Promise<BrowserSnapshot> { return ui.evaluate(async()=>{const r=await window.browser.getState();if(!r.ok)throw Error('State failed');return r.data;}); }
async function page() {
  const s=await state(), url=new URL('/page/1',s.fixtureUrl).href;
  expect((await ui.evaluate(({id,url})=>window.browser.navigate(id,url),{id:s.activeTabId!,url})).ok).toBe(true);
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===s.activeTabId)?.status).toBe('ready');
  await app.evaluate(async({webContents},url)=>{
    const wc=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!;
    await wc.executeJavaScript("document.body.innerHTML='<a id=link style=\"display:block;width:350px;height:50px\" href=\"/page/2\">fixture link</a><input id=edit style=\"display:block;width:350px;height:50px\" value=fixture><input id=password type=password style=\"display:block;width:350px;height:50px\" value=fixture-password><p id=text>fixture selection</p>';void 0");
    (globalThis as any).__contextTest.wc=wc;
    wc.on('context-menu',(_event,params)=>{(globalThis as any).__contextTest.params=params;});
  },url);
  return {id:s.activeTabId!,url};
}
async function click(selector:string,choice='',real=true) {
  const before=await app.evaluate(()=> (globalThis as any).__contextTest.count);
  await app.evaluate(async({BrowserWindow},{selector,choice,real})=>{
    const s=(globalThis as any).__contextTest,wc=s.wc as Electron.WebContents;
    s.choice=choice;s.real=real;s.menu=null;
    const point=await wc.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    const win=BrowserWindow.getAllWindows()[0]!;win.show();win.focus();wc.focus();
    wc.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});
    wc.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point});
  },{selector,choice,real});
  await expect.poll(async()=>app.evaluate(()=>(globalThis as any).__contextTest.count)).toBe(before+1);
}

test('CM-01: real native right click opens a background tab and copies only the explicit HTTP link',async()=>{
  const p=await page();
  await click('#link','open-link');
  await expect.poll(async()=>(await state()).tabs.length).toBe(2);
  let s=await state();expect(s.activeTabId).toBe(p.id);
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId!==p.id)?.status).toBe('ready');
  expect(s.tabs.find(tab=>tab.tabId!==p.id)?.url).toBe(new URL('/page/2',p.url).href);
  await click('#link','copy-link');
  await expect.poll(async()=>app.evaluate(()=>(globalThis as any).__contextTest.copies.length)).toBe(1);
  const observations=await app.evaluate(()=>{const s=(globalThis as any).__contextTest;return {shown:s.shown,closed:s.closed,copies:s.copies,items:s.items};});
  expect(observations.shown).toBeGreaterThanOrEqual(2);expect(observations.closed).toBeGreaterThanOrEqual(2);
  expect(observations.copies).toEqual([new URL('/page/2',p.url).href]);
  await app.evaluate(async()=>{await (globalThis as any).__contextTest.wc.executeJavaScript("document.querySelector('#link').href='javascript:alert(1)';void 0");});
  await click('#link');
  expect(await app.evaluate(()=>(globalThis as any).__contextTest.items.some((i:any)=>i.id==='open-link'||i.id==='copy-link'))).toBe(false);
  console.log('CONTEXT_LINK '+JSON.stringify({backgroundSelectionPreserved:true,nativePopupShown:observations.shown,unsafeLinkAbsent:true,clipboardCaptured:true}));
});

test('CM-02: native edit context uses flags, selects actual input and protects passwords without reading clipboard',async()=>{
  await page();
  await click('#edit','select-all');
  await expect.poll(async()=>app.evaluate(async()=> (globalThis as any).__contextTest.wc.executeJavaScript("document.querySelector('#edit').selectionEnd-document.querySelector('#edit').selectionStart"))).toBe(7);
  await app.evaluate(()=>{const s=(globalThis as any).__contextTest;s.wc.copy=()=>{s.actions.push('copy');};s.wc.paste=()=>{s.actions.push('paste');};});
  await click('#edit','copy');
  await expect.poll(async()=>app.evaluate(()=>(globalThis as any).__contextTest.actions)).toEqual(['copy']);
  await app.evaluate(async()=>{await (globalThis as any).__contextTest.wc.insertText('edited');});
  await click('#edit','undo');
  await expect.poll(async()=>app.evaluate(async()=>(globalThis as any).__contextTest.wc.executeJavaScript("document.querySelector('#edit').value"))).toBe('fixture');
  await click('#edit','redo');
  await expect.poll(async()=>app.evaluate(async()=>(globalThis as any).__contextTest.wc.executeJavaScript("document.querySelector('#edit').value"))).toBe('edited');
  await click('#password');
  const flags=await app.evaluate(()=>{const s=(globalThis as any).__contextTest;return {password:s.params.formControlType,items:s.items};});
  expect(flags.password).toBe('input-password');
  for(const id of ['cut','copy'])expect(flags.items.find((item:any)=>item.id===id)?.enabled).toBe(false);
  console.log('CONTEXT_EDIT '+JSON.stringify({nativeSelectAll:7,undoRedo:true,passwordCopyCutDisabled:true,clipboardRead:false}));
});

test('CM-04: a same-URL child-frame reload cancels the original native menu and releases temporary listeners',async()=>{
  await page();
  await app.evaluate(async()=>{
    const s=(globalThis as any).__contextTest;
    await s.wc.executeJavaScript("document.body.innerHTML='<iframe id=child src=\"/page/2\" style=\"width:500px;height:200px;border:0\"></iframe>';void 0");
  });
  await expect.poll(async()=>app.evaluate(()=> (globalThis as any).__contextTest.wc.mainFrame.frames.some((frame:Electron.WebFrameMain)=>frame.url.endsWith('/page/2')))).toBe(true);
  await app.evaluate(async({BrowserWindow})=>{
    const s=(globalThis as any).__contextTest,wc=s.wc as Electron.WebContents;
    s.child=wc.mainFrame.frames.find(frame=>frame.url.endsWith('/page/2'));
    await s.child.executeJavaScript("document.body.innerHTML='<a href=\"/page/3\" style=\"display:block;width:300px;height:80px\">child link</a>';void 0");
    const point=await wc.executeJavaScript("(()=>{const r=document.querySelector('#child').getBoundingClientRect();return {x:Math.round(r.x+60),y:Math.round(r.y+30)}})()");
    s.real=false;s.menu=null;
    BrowserWindow.getAllWindows()[0]!.focus();wc.focus();
    wc.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});wc.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point});
  });
  await expect.poll(async()=>app.evaluate(()=>!!(globalThis as any).__contextTest.menu)).toBe(true);
  const during=await app.evaluate(()=>{const s=(globalThis as any).__contextTest;s.retained=s.menu.getMenuItemById('open-link');return {child:s.params.frame===s.child,listeners:s.wc.listenerCount('did-start-navigation')};});
  expect(during.child).toBe(true);
  await app.evaluate(()=>{void (globalThis as any).__contextTest.child.executeJavaScript('location.reload();void 0').catch(()=>{});});
  await expect.poll(async()=>app.evaluate(()=>(globalThis as any).__contextTest.wc.listenerCount('did-start-navigation'))).toBe(during.listeners-1);
  await app.evaluate(()=>{(globalThis as any).__contextTest.retained.click();});
  expect((await state()).tabs.length).toBe(1);
  console.log('CONTEXT_FRAME '+JSON.stringify({sameUrlChildReloadInvalidated:true,temporaryListenersRemoved:true,staleOpenRejected:true}));
});

test('CM-03: stale menus cannot affect a newer selection or document and context listener is removed on close',async()=>{
  const p=await page();
  await click('#link','',false);
  await app.evaluate(()=>{const s=(globalThis as any).__contextTest;s.retained=s.menu.getMenuItemById('open-link');});
  await ui.evaluate(()=>window.browser.openTab());
  await app.evaluate(()=>{(globalThis as any).__contextTest.retained.click();});
  expect((await state()).tabs.length).toBe(2);
  const count=await app.evaluate(()=>{const s=(globalThis as any).__contextTest;const before=s.count;s.wc.emit('context-menu',{},s.params);return {before,after:s.count};});
  expect(count.after).toBe(count.before);
  await ui.evaluate(id=>window.browser.activateTab(id),p.id);
  await click('#link','',false);
  await app.evaluate(()=>{const s=(globalThis as any).__contextTest;s.retained=s.menu.getMenuItemById('copy-link');});
  const next=new URL('/page/3',p.url).href;
  await ui.evaluate(({id,url})=>window.browser.navigate(id,url),{id:p.id,url:next});
  await app.evaluate(()=>{(globalThis as any).__contextTest.retained.click();});
  expect(await app.evaluate(()=>(globalThis as any).__contextTest.copies.length)).toBe(0);
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===p.id)?.status).toBe('ready');
  const result=await ui.evaluate(id=>window.browser.closeTab(id),p.id);expect(result.ok).toBe(true);
  const listeners=await app.evaluate(()=> (globalThis as any).__contextTest.wc.listenerCount('context-menu'));
  // The one extra listener belongs to this test's native-params observer.
  expect(listeners).toBe(1);
  await app.evaluate(()=>{(globalThis as any).__contextTest.wc.removeAllListeners('context-menu');});
  console.log('CONTEXT_STALE '+JSON.stringify({backgroundRejected:true,oldDocumentRejected:true,productionListenersAfterClose:listeners-1}));
});
