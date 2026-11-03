import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let app: ElectronApplication;
let ui: Page;
let sourceId: number;
let fixture: string;
const errors: string[] = [];

test.beforeEach(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  app = await electron.launch({ args: [resolve('.')], cwd: resolve('.'), env, chromiumSandbox: true });
  errors.length = 0;
  app.process().stderr?.on('data', (chunk: Buffer) => {
    if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString())) errors.push(chunk.toString());
  });
  ui = await app.firstWindow();
  await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
  const initial = await state(); fixture = initial.fixtureUrl;
  await ui.evaluate(async (url) => { const s = await window.browser.getState(); if (s.ok) await window.browser.navigate(s.data.activeTabId!, url); }, fixture);
  await expect.poll(async () => (await state()).tabs[0]?.status).toBe('ready');
  sourceId = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL() === url)!.id, fixture);
});
test.afterEach(async () => { if (app) await app.close(); expect(errors).toEqual([]); });

async function state(): Promise<BrowserSnapshot> {
  return ui.evaluate(async () => { const r = await window.browser.getState(); if (!r.ok) throw Error(r.message); return r.data; });
}
async function script(code: string) {
  return app.evaluate(({ webContents }, { id, code }) => webContents.fromId(id)!.executeJavaScript(code), { id: sourceId, code });
}
function cross(path: string) { const url = new URL(path, fixture); url.hostname = 'localhost'; return url.href; }
async function click(selector: string, button: 'left' | 'middle' = 'left') {
  await app.evaluate(async ({ webContents, BrowserWindow }, { id, selector, button }) => {
    const wc = webContents.fromId(id)!;
    const point = await wc.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView();const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    BrowserWindow.getAllWindows()[0]!.focus(); wc.focus();
    wc.sendInputEvent({ type: 'mouseDown', button, clickCount: 1, ...point });
    wc.sendInputEvent({ type: 'mouseUp', button, clickCount: 1, ...point });
  }, { id: sourceId, selector, button });
}

test('cross-origin search result opens a secure tab and follows its redirect', async () => {
  const target = cross('/redirect');
  await script(`document.body.innerHTML='<a id="result" target="_blank" rel="noopener">Search result</a>';document.getElementById('result').href=${JSON.stringify(target)};void 0`);
  await click('#result');
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  await expect.poll(async () => { const s = await state(); return s.tabs.find(t => t.tabId === s.activeTabId)?.url; }).toBe(cross('/second'));
  const secure = await app.evaluate(async ({ app, webContents, BrowserWindow }, target) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL() === target)!;
    return { windows: BrowserWindow.getAllWindows().length,
      sandbox: app.getAppMetrics().find(m => m.pid === wc.getOSProcessId())?.sandboxed,
      separateUiSession: wc.session !== BrowserWindow.getAllWindows()[0]!.webContents.session,
      page: await wc.executeJavaScript('[typeof window.browser,typeof require,window.opener===null]') };
  }, cross('/second'));
  expect(secure).toEqual({ windows: 1, sandbox: true, separateUiSession: true, page: ['undefined', 'undefined', true] });
});

test('Enter submits a cross-origin target blank GET search form', async () => {
  await script(`document.body.innerHTML='<form target="_blank" method="get"><input name="q" value="browser"><button>Search</button></form>';document.querySelector('form').action=${JSON.stringify(cross('/second'))};void 0`);
  await click('input');
  await app.evaluate(({ webContents }, id) => { const wc=webContents.fromId(id)!;wc.sendInputEvent({type:'keyDown',keyCode:'Return'});wc.sendInputEvent({type:'char',keyCode:'\r'});wc.sendInputEvent({type:'keyUp',keyCode:'Return'}); }, sourceId);
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  await expect.poll(async () => (await state()).tabs.some(t => t.url === cross('/second?q=browser') && t.status === 'ready')).toBe(true);
});

test('an actionless search control may launch its search service without a site permission',async()=>{
  await script(`document.body.innerHTML='<form role="search"><input type="search" id="launcher" placeholder="Search the web"></form>';document.querySelector('form').onsubmit=e=>e.preventDefault();document.getElementById('launcher').onclick=()=>window.open(${JSON.stringify(cross('/second'))},'_blank');void 0`);
  await click('#launcher');
  await expect.poll(async()=>(await state()).tabs.length).toBe(2);
  await expect.poll(async()=>(await state()).tabs.some(t=>t.url===cross('/second')&&t.status==='ready')).toBe(true);
  expect((await state()).popups?.clickAllowed).toBe(false);
});

test('actionless search submission works with Enter and a submit button while ad destinations stay blocked',async()=>{
  const original=(await state()).activeTabId!;
  await script(`document.body.innerHTML='<form role="search"><input type="search" id="query"><button>Search</button></form>';document.querySelector('form').onsubmit=e=>{e.preventDefault();window.open(${JSON.stringify(cross('/second?q=browser'))},'_blank')};void 0`);
  await click('#query');
  await app.evaluate(({webContents},id)=>{const wc=webContents.fromId(id)!;wc.sendInputEvent({type:'keyDown',keyCode:'Return'});wc.sendInputEvent({type:'char',keyCode:'\r'});wc.sendInputEvent({type:'keyUp',keyCode:'Return'});},sourceId);
  await expect.poll(async()=>(await state()).tabs.length).toBe(2);
  await ui.evaluate(id=>window.browser.activateTab(id),original);
  await click('button');
  await expect.poll(async()=>(await state()).tabs.length).toBe(3);
  await ui.evaluate(id=>window.browser.activateTab(id),original);
  await script(`document.querySelector('form').onsubmit=e=>{e.preventDefault();window.open('https://popads.net/search?q=browser','_blank')};void 0`);
  await click('button');
  await expect.poll(async()=>(await state()).popups?.pending?.reason).toBe('advertising');
  expect((await state()).tabs).toHaveLength(3);
});

test('a search role does not bypass an explicit different action or grant an ordinary text form',async()=>{
  await script(`document.body.innerHTML='<form role="search"><input type="search" id="query"></form>';document.querySelector('form').action=${JSON.stringify(new URL('/second',fixture).href)};document.getElementById('query').onclick=()=>window.open(${JSON.stringify(cross('/second'))},'_blank');void 0`);
  await click('#query');
  await expect.poll(async()=>(await state()).popups?.pending?.reason).toBe('unrelated');
  expect((await state()).tabs).toHaveLength(1);
  await script(`document.body.innerHTML='<form><input type="text" id="query"></form>';document.getElementById('query').onclick=()=>window.open(${JSON.stringify(cross('/second'))},'_blank');void 0`);
  await click('#query');
  await expect.poll(async()=>(await state()).popups?.blockedCount).toBe(2);
  expect((await state()).tabs).toHaveLength(1);
  await script(`document.body.innerHTML='<form role="search" method="post"><input type="search" id="query"></form>';document.getElementById('query').onclick=()=>window.open(${JSON.stringify(cross('/second'))},'_blank');void 0`);
  await click('#query');
  await expect.poll(async()=>(await state()).popups?.blockedCount).toBe(3);
  expect((await state()).tabs).toHaveLength(1);
});

test('middle click keeps the result in a background tab', async () => {
  const before = await state();
  await script(`document.body.innerHTML='<a id="result">Search result</a>';document.getElementById('result').href=${JSON.stringify(cross('/second'))};void 0`);
  await click('#result', 'middle');
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  expect((await state()).activeTabId).toBe(before.activeTabId);
});

test('unrelated blank-area popup is held and can be opened once from trusted UI', async () => {
  await script(`document.body.innerHTML='<div id="result">Ordinary page area</div>';document.getElementById('result').onclick=()=>{window.open(${JSON.stringify(cross('/second'))},'_blank')};void 0`);
  await click('#result');
  await expect.poll(async () => (await state()).popups?.pending?.reason).toBe('unrelated');
  expect((await state()).tabs).toHaveLength(1);
  await ui.getByRole('button',{name:'Popup ayarları',exact:true}).click();
  await expect(ui.getByTestId('blocked-popup')).toContainText('localhost');
  await ui.getByRole('button',{name:'Bir kez aç',exact:true}).click();
  await expect.poll(async () => (await state()).tabs.some(t => t.url === cross('/second') && t.status === 'ready')).toBe(true);
  expect((await state()).tabs).toHaveLength(2);
});

test('automatic popups, unsafe schemes and a second popup per gesture remain blocked', async () => {
  await script(`window.open(${JSON.stringify(cross('/second'))});void 0`);
  await expect.poll(async () => (await state()).notice).toContain('Popup engellendi');
  expect((await state()).tabs).toHaveLength(1);
  await script(`document.body.innerHTML='<a id="burst" href=${JSON.stringify(cross('/second'))}>Open</a>';document.getElementById('burst').onclick=e=>{e.preventDefault();window.open(${JSON.stringify(cross('/second'))});window.open(${JSON.stringify(cross('/popup'))})};void 0`);
  await click('#burst');
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  const sourceAfterBurst=(await state()).tabs[0]!.tabId;
  await ui.evaluate(id=>window.browser.activateTab(id),sourceAfterBurst);
  await expect.poll(async () => (await state()).popups?.blockedCount).toBeGreaterThanOrEqual(2);
  await script(`window.open('app://browser/index.html');window.open('file:///C:/popup-test');void 0`);
  expect((await state()).tabs).toHaveLength(2);
  const original = (await state()).tabs[0]!.tabId;
  await ui.evaluate(id => window.browser.activateTab(id), original);
  await script(`document.getElementById('burst').onclick=()=>{window.open('app://browser/index.html')};void 0`);
  await click('#burst');
  expect((await state()).tabs).toHaveLength(2);
  // A POST must never silently become a GET while replaying a popup URL.
  await script(`document.body.innerHTML='<form target="_blank" method="post"><input name="q" value="test"><button>Search</button></form>';document.querySelector('form').action=${JSON.stringify(cross('/second'))};void 0`);
  await click('button');
  await expect.poll(async () => (await state()).notice).toContain('Popup engellendi');
  expect((await state()).tabs).toHaveLength(2);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('ad popup targets are blocked before view creation and on HTTP redirect', async () => {
  const target='https://popads.net/core-popup-test';
  await script(`document.body.innerHTML='<a id="result" target="_blank">Ad target</a>';document.getElementById('result').href=${JSON.stringify(target)};void 0`);
  await click('#result');
  await expect.poll(async () => (await state()).popups?.pending?.reason).toBe('advertising');
  expect((await state()).tabs).toHaveLength(1);
  expect(await app.evaluate(({webContents})=>webContents.getAllWebContents().length)).toBe(2);
  const s=await state();
  const denied=await ui.evaluate(({id,requestId})=>window.browser.resolvePopup(id,requestId,'open-once'),{id:s.activeTabId!,requestId:s.popups!.pending!.requestId});
  expect(denied).toMatchObject({ok:false,errorCode:'POLICY_BLOCKED'});
  await script(`document.getElementById('result').href=${JSON.stringify(new URL('/popup-ad-redirect',fixture).href)};void 0`);
  await click('#result');
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  await expect.poll(async () => (await state()).tabs.some(t=>t.errorCode==='POPUP_AD_BLOCKED')).toBe(true);
  expect(await app.evaluate(({webContents})=>webContents.getAllWebContents().some(w=>w.getURL().startsWith('https://popads.net/')))).toBe(false);
});

test('site click permission is scoped, revocable and cannot replay stale requests', async () => {
  const original=(await state()).activeTabId!;
  await script(`document.body.innerHTML='<div id="result">Ordinary area</div>';document.getElementById('result').onclick=()=>window.open(${JSON.stringify(cross('/second'))});void 0`);
  await click('#result');
  await expect.poll(async () => (await state()).popups?.pending?.reason).toBe('unrelated');
  const requestId=(await state()).popups!.pending!.requestId;
  await ui.getByRole('button',{name:'Popup ayarları',exact:true}).click();
  await ui.getByRole('button',{name:'Bu sitede tıklamayla açılışa izin ver',exact:true}).click();
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  await expect.poll(async () => (await state()).popups?.clickAllowed).toBe(false); // localhost differs from 127.0.0.1
  await ui.evaluate(id=>window.browser.activateTab(id),original);
  await expect.poll(async () => (await state()).popups?.clickAllowed).toBe(true);
  expect(await ui.evaluate(({id,requestId})=>window.browser.resolvePopup(id,requestId,'open-once'),{id:original,requestId})).toMatchObject({ok:false,errorCode:'OPERATION_CANCELLED'});
  await click('#result');
  await expect.poll(async () => (await state()).tabs.length).toBe(3);
  await ui.evaluate(id=>window.browser.activateTab(id),original);
  await ui.getByRole('button',{name:'Site popup iznini kaldır',exact:true}).click();
  await click('#result');
  await expect.poll(async () => (await state()).popups?.pending?.reason).toBe('unrelated');
  expect((await state()).tabs).toHaveLength(3);
  const stale=(await state()).popups!.pending!.requestId;
  await ui.evaluate(async id=>{const s=await window.browser.getState();if(s.ok)await window.browser.navigate(id,new URL('/second',s.data.fixtureUrl).href);},original);
  expect(await ui.evaluate(({id,requestId})=>window.browser.resolvePopup(id,requestId,'allow-site'),{id:original,requestId:stale})).toMatchObject({ok:false,errorCode:'OPERATION_CANCELLED'});
});

test('startup direct links and GET forms work even when the DOM probe cannot answer', async()=>{
  await app.evaluate(({webContents},id)=>{webContents.fromId(id)!.executeJavaScriptInIsolatedWorld=()=>Promise.reject(Error('Busy startup document'));},sourceId);
  const original=(await state()).activeTabId!;
  await script(`document.body.innerHTML='<a id="result" target="_blank">Result</a>';document.getElementById('result').href=${JSON.stringify(cross('/second'))};void 0`);
  await click('#result');
  await expect.poll(async()=>(await state()).tabs.length).toBe(2);
  await ui.evaluate(id=>window.browser.activateTab(id),original);
  await script(`document.body.innerHTML='<form target="_blank" method="get"><input name="q" value="browser"><button>Search</button></form>';document.querySelector('form').action=${JSON.stringify(cross('/second'))};void 0`);
  await click('input');
  await app.evaluate(({webContents},id)=>{const wc=webContents.fromId(id)!;wc.sendInputEvent({type:'keyDown',keyCode:'Return'});wc.sendInputEvent({type:'char',keyCode:'\r'});wc.sendInputEvent({type:'keyUp',keyCode:'Return'});},sourceId);
  await expect.poll(async()=>(await state()).tabs.length).toBe(3);
  await ui.evaluate(id=>window.browser.activateTab(id),original);
  await app.evaluate(({webContents},id)=>{
    const wc=webContents.fromId(id)!;
    // During a real startup re-render, the clicked form can disappear before
    // the asynchronous probe. Loading is a distinct compatibility condition.
    wc.executeJavaScriptInIsolatedWorld=()=>Promise.resolve(false);wc.isLoading=()=>true;
  },sourceId);
  await click('input');
  await app.evaluate(({webContents},id)=>{const wc=webContents.fromId(id)!;wc.sendInputEvent({type:'keyDown',keyCode:'Return'});wc.sendInputEvent({type:'char',keyCode:'\r'});wc.sendInputEvent({type:'keyUp',keyCode:'Return'});},sourceId);
  await expect.poll(async()=>(await state()).tabs.length).toBe(4);
});

test('real script buttons tolerate a small pointer movement and shadow DOM controls',async()=>{
  const original=(await state()).activeTabId!;
  await script(`document.body.innerHTML='<button id="result" style="width:250px;height:80px">Open result</button>';document.getElementById('result').onclick=()=>window.open(${JSON.stringify(cross('/second'))});void 0`);
  await app.evaluate(async({webContents,BrowserWindow},id)=>{
    const wc=webContents.fromId(id)!;const p=await wc.executeJavaScript(`(()=>{const r=document.querySelector('button').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    BrowserWindow.getAllWindows()[0]!.focus();wc.focus();wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});
    wc.sendInputEvent({type:'mouseMove',modifiers:['leftbuttondown'],x:p.x+2,y:p.y+1});wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:p.x+2,y:p.y+1});
  },sourceId);
  await expect.poll(async()=>(await state()).tabs.length).toBe(2);
  await ui.evaluate(id=>window.browser.activateTab(id),original);
  await script(`document.body.innerHTML='<div id="host" style="width:200px;height:80px"></div>';const root=document.getElementById('host').attachShadow({mode:'open'});root.innerHTML='<span role="button" tabindex="0" style="display:block;width:200px;height:80px">Open</span>';root.querySelector('span').onclick=()=>window.open(${JSON.stringify(cross('/popup'))});void 0`);
  await click('#host');
  await expect.poll(async()=>(await state()).tabs.length).toBe(3);
});

test('typing, hover, delayed timers and background pages cannot borrow a generic gesture', async () => {
  await script(`document.body.innerHTML='<input id="typing"><div id="blank">Ordinary page area</div>';document.getElementById('blank').onclick=()=>setTimeout(()=>window.open(${JSON.stringify(cross('/second'))}),10);void 0`);
  await click('#blank');
  await expect.poll(async () => (await state()).popups?.blockedCount).toBe(1);
  expect((await state()).tabs).toHaveLength(1);
  await click('#typing');
  await app.evaluate(({webContents},id)=>{const wc=webContents.fromId(id)!;wc.sendInputEvent({type:'keyDown',keyCode:'A'});wc.sendInputEvent({type:'keyUp',keyCode:'A'});},sourceId);
  await script(`window.open(${JSON.stringify(cross('/second'))});void 0`);
  await expect.poll(async () => (await state()).popups?.blockedCount).toBe(2);
  await script(`document.getElementById('blank').onmouseover=()=>window.open(${JSON.stringify(cross('/second'))});void 0`);
  await app.evaluate(({webContents},id)=>{webContents.fromId(id)!.sendInputEvent({type:'mouseMove',x:10,y:10});},sourceId);
  await script(`window.open(${JSON.stringify(cross('/second'))});void 0`);
  await expect.poll(async () => (await state()).popups?.blockedCount).toBeGreaterThanOrEqual(3);
  const original=(await state()).activeTabId!;
  await ui.evaluate(()=>window.browser.openTab());
  await script(`window.open(${JSON.stringify(cross('/second'))});void 0`);
  expect((await state()).tabs).toHaveLength(2);
  await ui.evaluate(id=>window.browser.activateTab(id),original);
  const pending=(await state()).popups!.pending!;
  expect(await ui.evaluate(({id,requestId})=>window.browser.resolvePopup(id,requestId,'invalid' as never),{id:original,requestId:pending.requestId})).toMatchObject({ok:false,errorCode:'INVALID_INPUT'});
});

test('popup floods retain one opaque review ticket, cap counters and never expose full destinations',async()=>{
  await script(`window.open('https://popads.net/first?privateQuery=should-not-reach-ui');void 0`);
  await expect.poll(async()=>(await state()).popups?.blockedCount).toBe(1);
  const requestId=(await state()).popups!.pending!.requestId;
  await script(`for(let i=0;i<1005;i++)window.open('https://popads.net/flood?privateQuery='+i);void 0`);
  await expect.poll(async()=>(await state()).popups?.blockedCount).toBe(999);
  const s=await state();expect(s.popups!.pending!.requestId).toBe(requestId);
  expect(JSON.stringify(s.popups)).not.toContain('privateQuery');
  expect(s.tabs).toHaveLength(1);
  expect(await app.evaluate(({webContents})=>webContents.getAllWebContents().length)).toBe(2);
  await ui.evaluate(async id=>{await window.browser.setAdBlocking(id,false);},s.activeTabId!);
  await expect.poll(async()=>(await state()).popups?.pending?.recoverable).toBe(true);
  await ui.evaluate(({id,requestId})=>window.browser.resolvePopup(id,requestId,'dismiss'),{id:s.activeTabId!,requestId});
  await expect.poll(async()=>(await state()).popups?.pending).toBe(null);
});
