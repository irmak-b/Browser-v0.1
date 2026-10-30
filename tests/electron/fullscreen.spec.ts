import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { BrowserSnapshot } from '../../src/shared/contracts';
import version from '../../app-version.json';
import { FULLSCREEN_HINT_TEXT, FULLSCREEN_HINT_WORLD } from '../../src/main/browser/fullscreen-hint';

let application: ElectronApplication, ui: Page, server: Server, origin: string;
const errors: string[] = [];
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/fs.js' ? 'text/javascript' : 'text/html');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src ${req.url === '/strict-video' ? "'none'" : "'unsafe-inline'"}; frame-src 'none'`);
    if (req.url === '/fs.js') res.end(`window.fsError='';window.fsClicks=0;document.getElementById('fullscreen').onclick=()=>{window.fsClicks++;document.getElementById('player').requestFullscreen().then(()=>window.fsError='granted',e=>window.fsError=e.name)};`);
    else if (req.url === '/strict-video') res.end('<!doctype html><title>Strict video fullscreen</title><video id="player"></video><button id="fullscreen">Tam ekran</button><script src="/fs.js"></script>');
    else res.end(`<!doctype html><meta charset="utf-8"><title>Fullscreen fixture</title><style>body{margin:0}#player{background:#182336;color:white;width:100%;height:200px}button{margin:20px;padding:10px}</style><div id="player"><button id="fullscreen">Tam ekran</button></div><script src="/fs.js"></script>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  application = await electron.launch({ args: [resolve('.')], cwd: resolve('.'), env, chromiumSandbox: true });
  application.process().stderr?.on('data', (chunk: Buffer) => { if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString())) errors.push(chunk.toString()); });
  ui = await application.firstWindow();
  await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
  // Legacy control tests explicitly open the now-optional information panel.
  await ui.getByRole('button', { name: 'Bilgi paneli', exact: true }).click();
});
test.afterAll(async () => {
  if (application) {
    const child = application.process();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([application.close().catch(() => {}), new Promise<void>(done => { timer = setTimeout(() => { if (child.exitCode === null) child.kill(); done(); }, 5000); })]);
    clearTimeout(timer);
  }
  if (server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  expect(errors).toEqual([]);
});
const state = () => ui.evaluate(async () => { const r = await window.browser.getState(); if (!r.ok) throw new Error(); return r.data; }) as Promise<BrowserSnapshot>;
async function page() {
  await ui.evaluate(async origin => { const r = await window.browser.getState(); if (r.ok) await window.browser.navigate(r.data.activeTabId!, origin + '/'); }, origin);
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
}
async function script(code: string) {
  return application.evaluate(({ webContents }, { origin, code }) => webContents.getAllWebContents().find(w => w.getURL().startsWith(origin))!.executeJavaScript(code), { origin, code });
}
async function hint() {
  return application.evaluate(({ webContents }, { origin, world }) => webContents.getAllWebContents().find(w => w.getURL().startsWith(origin))!.executeJavaScriptInIsolatedWorld(world, [{code:
    `(()=>{const s=globalThis.__browserCoreFullscreenHint;if(!s?.host?.isConnected)return null;const h=s.hint,r=h.getBoundingClientRect(),c=getComputedStyle(h);return {text:h.textContent,open:h.matches(':popover-open'),color:c.color,background:c.backgroundColor,pointerEvents:c.pointerEvents,x:r.x,y:r.y,width:r.width,height:r.height}})()`
  }]), {origin,world:FULLSCREEN_HINT_WORLD});
}
async function clickFullscreen() {
  await application.evaluate(async ({ webContents, BrowserWindow }, origin) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin))!;
    BrowserWindow.getAllWindows()[0]!.focus(); wc.focus();
    const r = await wc.executeJavaScript("(()=>{const r=document.getElementById('fullscreen').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...r });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...r });
  }, origin);
  await expect.poll(async () => (await state()).fullscreen).toEqual({ origin, hintVisible: true });
  expect(await script('!!document.fullscreenElement')).toBe(true);
}
async function exited() {
  await expect.poll(async () => (await state()).fullscreen).toBeNull();
  await expect.poll(async () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(false);
  await expect(ui.getByLabel('Sayfa adresi')).toBeVisible();
}

test('FS-01: floating hint never changes video/native viewport size, passes clicks through, expires and preserves Escape', async () => {
  await page();
  // Script-only request has no transient user activation.
  expect(await script("document.documentElement.requestFullscreen().then(()=>true,()=>false)")).toBe(false);
  await clickFullscreen();
  await expect(ui.locator('.fullscreen-bar')).toHaveCount(0);
  await expect.poll(hint).toMatchObject({text:FULLSCREEN_HINT_TEXT,open:true,color:'rgb(255, 255, 255)',background:'rgba(0, 0, 0, 0.65)',pointerEvents:'none'});
  const overlay=await hint();
  expect(overlay.width).toBeLessThan(600);expect(overlay.y).toBe(24);
  const viewportBefore=await script('({width:innerWidth,height:innerHeight})');
  const geometry = await application.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!, view = w.contentView.children.find(v => 'webContents' in v) as Electron.WebContentsView;
    return { fullscreen: w.isFullScreen(), page: view.getBounds(), size: w.getContentBounds() };
  });
  expect(geometry.fullscreen).toBe(true); expect(geometry.page.y).toBe(0);
  expect(geometry.page.width).toBe(geometry.size.width); expect(geometry.page.height).toBe(geometry.size.height);
  await script("window.throughClicks=0;document.addEventListener('click',()=>window.throughClicks++);void 0");
  await application.evaluate(({webContents},{origin,x,y})=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin))!;w.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});w.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x,y});},{origin,x:Math.round(overlay.x+overlay.width/2),y:Math.round(overlay.y+overlay.height/2)});
  await expect.poll(()=>script('window.throughClicks')).toBe(1);
  mkdirSync(resolve('docs/evidence'),{recursive:true});
  const screenshot=await application.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin))!.capturePage().then(img=>img.toPNG().toString('base64')),origin);
  writeFileSync(resolve(`docs/evidence/fullscreen-${version.display}-overlay.png`),Buffer.from(screenshot,'base64'));
  await expect.poll(async () => (await state()).fullscreen, { timeout: 5000 }).toEqual({ origin, hintVisible: false });
  expect(await hint()).toBeNull();
  expect(await script('({width:innerWidth,height:innerHeight})')).toEqual(viewportBefore);
  expect(await application.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!, view = w.contentView.children.find(v => 'webContents' in v) as Electron.WebContentsView;
    return { fullscreen: w.isFullScreen(), page: view.getBounds(), size: w.getContentBounds() };
  })).toMatchObject({ fullscreen: true, page: { x: 0, y: 0, width: geometry.size.width, height: geometry.size.height } });
  expect(await script('!!document.fullscreenElement')).toBe(true);
  await application.evaluate(({ webContents }, origin) => { const w = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin))!; w.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); w.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); }, origin);
  await exited(); await expect.poll(() => script('!!document.fullscreenElement')).toBe(false);
  // Leave before a second hint expires. Its cancelled timeout cannot publish a
  // stale fullscreen state after normal browsing resumes.
  await clickFullscreen(); await ui.evaluate(() => window.browser.exitFullscreen()); await exited();
});

test('FS-02: exit control, tab switch, navigation, crash and closure cannot retain fullscreen', async () => {
  await page();
  await clickFullscreen(); await ui.evaluate(()=>window.browser.exitFullscreen()); await exited();
  await clickFullscreen();
  await ui.getByRole('button', { name: 'Geliştirme bilgisi', includeHidden: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(ui.getByRole('dialog')).toBeVisible(); await exited();
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.every(v => !v.getVisible()))).toBe(true);
  await ui.getByRole('button', { name: 'Sayfaya dön' }).click();
  await clickFullscreen();
  const previous = (await state()).activeTabId!;
  await ui.evaluate(() => window.browser.openTab()); await exited();
  await ui.evaluate(id => window.browser.activateTab(id), previous);
  await clickFullscreen();
  await ui.evaluate(async origin => { const s = await window.browser.getState(); if (s.ok) await window.browser.navigate(s.data.activeTabId!, origin + '/next'); }, origin);
  await exited(); await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  await clickFullscreen();
  await application.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(w => w.getURL().startsWith(origin))!.forcefullyCrashRenderer(), origin);
  await exited();
  await page(); await clickFullscreen();
  await ui.evaluate(async () => { const s = await window.browser.getState(); if (s.ok) await window.browser.closeTab(s.data.activeTabId!); });
  await exited();
});

test('FS-04: overlay renders above a fullscreen video with strict page CSP and leaves no extra renderer or DOM hint on exit',async()=>{
  await page();
  await ui.evaluate(async url=>{const s=await window.browser.getState();if(s.ok)await window.browser.navigate(s.data.activeTabId!,url);},origin+'/strict-video');
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  await clickFullscreen();
  await expect.poll(hint).toMatchObject({text:FULLSCREEN_HINT_TEXT,open:true,background:'rgba(0, 0, 0, 0.65)'});
  expect(await script('document.fullscreenElement.tagName')).toBe('VIDEO');
  expect(await application.evaluate(({webContents})=>webContents.getAllWebContents().length)).toBe(2);
  await ui.evaluate(()=>window.browser.exitFullscreen());await exited();await expect.poll(hint).toBeNull();
  await clickFullscreen();await expect.poll(hint).toMatchObject({open:true});
  await ui.evaluate(()=>window.browser.exitFullscreen());await exited();await expect.poll(hint).toBeNull();
});

test('FS-03: context switch cleans owner/listeners; sensitive permissions and background fullscreen stay denied', async () => {
  await page(); await clickFullscreen();
  await application.evaluate(({ webContents }, origin) => { (globalThis as any).fullscreenOld = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin)); }, origin);
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-b')); await exited();
  expect(await application.evaluate(() => { const w = (globalThis as any).fullscreenOld as Electron.WebContents; return [w.isDestroyed(), w.listenerCount('enter-html-full-screen'), w.listenerCount('leave-html-full-screen')]; })).toEqual([true, 0, 0]);
  await page();
  expect(await script("Promise.all(['camera','microphone','notifications','geolocation'].map(name=>navigator.permissions.query({name}).then(p=>p.state)))")).toEqual(['denied','denied','denied','denied']);
  expect((await state()).fullscreen).toBeNull();
  await ui.evaluate(() => window.browser.openTab());
  expect(await script("document.documentElement.requestFullscreen().then(()=>true,()=>false)")).toBe(false);
});
