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

test('middle click keeps the result in a background tab', async () => {
  const before = await state();
  await script(`document.body.innerHTML='<a id="result">Search result</a>';document.getElementById('result').href=${JSON.stringify(cross('/second'))};void 0`);
  await click('#result', 'middle');
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  expect((await state()).activeTabId).toBe(before.activeTabId);
});

test('a real button click may open a cross-origin scripted result', async () => {
  await script(`document.body.innerHTML='<button id="result">Search</button>';document.getElementById('result').onclick=()=>{window.open(${JSON.stringify(cross('/second'))},'_blank')};void 0`);
  await click('#result');
  await expect.poll(async () => (await state()).tabs.some(t => t.url === cross('/second') && t.status === 'ready')).toBe(true);
  expect((await state()).tabs).toHaveLength(2);
});

test('automatic popups, unsafe schemes and a second popup per gesture remain blocked', async () => {
  await script(`window.open(${JSON.stringify(cross('/second'))});void 0`);
  await expect.poll(async () => (await state()).notice).toContain('Popup engellendi');
  expect((await state()).tabs).toHaveLength(1);
  await script(`document.body.innerHTML='<button id="burst">Open</button>';document.getElementById('burst').onclick=()=>{window.open(${JSON.stringify(cross('/second'))});window.open(${JSON.stringify(cross('/popup'))})};void 0`);
  await click('#burst');
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  await expect.poll(async () => (await state()).notice).toContain('Popup');
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
