import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let app: ElectronApplication, ui: Page, server: Server, origin: string;
let assetVersion = 1, assetRequests = 0, otherRequests = 0, documentRequests = 0;
const errors: string[] = [];
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url!.split('?')[0]!;
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'");
    if (path === '/asset.js' || path === '/other.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Cache-Control', 'public,max-age=3600');
      if (path === '/asset.js') { assetRequests++; res.end(`window.assetRevision=${assetVersion};`); }
      else { otherRequests++; res.end('window.otherFixture=42;'); }
      return;
    }
    documentRequests++;
    const reply = () => {
      if (res.destroyed) return;
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      res.end(`<!doctype html><title>Cache ${path}</title><script src="${path.startsWith('/other') ? '/other.js' : '/asset.js'}"></script><h1>Yerel cache denemesi</h1><input id="note" value="initial">`);
    };
    if (path === '/pending') { const timer = setTimeout(reply, 1800); res.once('close', () => clearTimeout(timer)); }
    else reply();
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  app = await electron.launch({ args: [resolve('.')], env, chromiumSandbox: true });
  app.process().stderr?.on('data', (chunk: Buffer) => { if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString())) errors.push(chunk.toString()); });
  ui = await app.firstWindow(); await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
});
test.beforeEach(async () => { const s = await state(); await ui.evaluate(id => window.browser.switchDevelopmentIdentity(id as 'test-a' | 'test-b'), s.developmentIdentity === 'test-a' ? 'test-b' : 'test-a'); });
test.afterEach(async () => { await app.evaluate(async ({ webContents }) => { for (const wc of webContents.getAllWebContents()) if (wc.getURL().startsWith('http://127.0.0.1:')) await wc.executeJavaScript('window.onbeforeunload=null;void 0').catch(() => {}); }); });
test.afterAll(async () => { if (app) await app.close(); server?.closeAllConnections(); if (server) await new Promise<void>(done => server.close(() => done())); expect(errors).toEqual([]); });
async function state(): Promise<BrowserSnapshot> { return ui.evaluate(async () => { const r = await window.browser.getState(); if (!r.ok) throw Error('State failed'); return r.data; }); }
async function ready(id: string) { await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === id)?.status).toBe('ready'); }
async function open(path: string) {
  const r = await ui.evaluate(url => window.browser.openTab(url), origin + path); if (!r.ok) throw Error('Open failed');
  await ready(r.data.tabId);
  const wcId = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.id, origin + path);
  return { id: r.data.tabId, wcId, url: origin + path };
}
async function site(id: number, code: string) { return app.evaluate(({ webContents }, { id, code }) => webContents.fromId(id)!.executeJavaScript(code, true), { id, code }); }
async function send(keyCode: string, modifiers: ('control' | 'shift')[], id?: number) {
  await app.evaluate(({ BrowserWindow, webContents }, { keyCode, modifiers, id }) => {
    const win = BrowserWindow.getAllWindows()[0]!, wc = id === undefined ? win.webContents : webContents.fromId(id)!;
    win.show(); win.focus(); wc.focus(); wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, { keyCode, modifiers, id });
}

test('HR-01: native and trusted-UI hard reload fetch fresh assets without clearing unrelated cache or site data', async () => {
  const first = await open('/first'); expect(assetRequests).toBe(1);
  await site(first.wcId, "document.cookie='hardFixture=ok;SameSite=Lax;Path=/';localStorage.setItem('hardFixture','ok');void 0");
  await ui.evaluate(async id => { await window.browser.setTabMuted(id, true); await window.browser.setTabKeepAwake(id, true); }, first.id);
  const background = await open('/other-one'); expect(otherRequests).toBe(1);
  await site(background.wcId, "window.backgroundMarker=42;document.querySelector('#note').value='background-kept';void 0");
  await open('/warm'); expect(assetRequests).toBe(1);
  await ui.evaluate(id => window.browser.activateTab(id), first.id);
  const historyBefore = await app.evaluate(({ webContents }, id) => { const wc = webContents.fromId(id)!; return { index: wc.navigationHistory.getActiveIndex(), length: wc.navigationHistory.length() }; }, first.wcId);
  for (const [key, modifiers, nativeFocus, version] of [
    ['F5', ['control'], true, 2], ['R', ['control', 'shift'], false, 3],
  ] as const) {
    assetVersion = version; const requestsBefore = assetRequests, documentsBefore = documentRequests;
    const visits = (await state()).history.entries.length;
    await send(key, [...modifiers], nativeFocus ? first.wcId : undefined);
    await expect.poll(() => assetRequests).toBe(requestsBefore + 1);
    await ready(first.id); expect(await site(first.wcId, 'window.assetRevision')).toBe(version);
    expect(documentRequests).toBe(documentsBefore + 1);
    await expect.poll(async () => (await state()).history.entries.length).toBe(visits + 1);
    expect((await state()).history.entries[0]?.source).toBe('reload');
  }
  expect(await site(first.wcId, "({cookie:document.cookie.includes('hardFixture=ok'),stored:localStorage.getItem('hardFixture')})")).toEqual({ cookie: true, stored: 'ok' });
  expect((await state()).tabs.find(tab => tab.tabId === first.id)).toMatchObject({ muted: true, keepAwake: true });
  expect(await app.evaluate(({ webContents }, id) => { const wc = webContents.fromId(id)!; return { muted: wc.isAudioMuted(), index: wc.navigationHistory.getActiveIndex(), length: wc.navigationHistory.length() }; }, first.wcId)).toEqual({ muted: true, ...historyBefore });
  expect(await site(background.wcId, "({marker:window.backgroundMarker,form:document.querySelector('#note').value})")).toEqual({ marker: 42, form: 'background-kept' });
  const cached = await open('/after-hard'); expect(await site(cached.wcId, 'window.assetRevision')).toBe(3); expect(assetRequests).toBe(3);
  await open('/other-two'); expect(otherRequests).toBe(1);
  console.log('HARD_RELOAD_CACHE ' + JSON.stringify({ nativeCtrlF5: true, trustedUiCtrlShiftR: true, assetRequests, assetRevisions: [1, 2, 3], unrelatedAssetRequests: otherRequests, cacheRemainsEnabled: true, siteDataAndPreferencesKept: true, sameNativePageAndHistory: true, backgroundFormKept: true }));
});

test('HR-02: beforeunload can refuse hard reload without losing the form or recording a visit', async () => {
  const p = await open('/guard'), visits = (await state()).history.entries.map(entry => entry.eventId), before = documentRequests;
  await site(p.wcId, "document.querySelector('#note').value='unsaved-fixture';window.onbeforeunload=()=>false;void 0");
  await app.evaluate(({ webContents }, id) => { (globalThis as any).__hardPrevented = 0; webContents.fromId(id)!.once('will-prevent-unload', () => { (globalThis as any).__hardPrevented++; }); }, p.wcId);
  await send('F5', ['control'], p.wcId);
  await expect.poll(() => app.evaluate(() => (globalThis as any).__hardPrevented)).toBe(1);
  await ready(p.id);
  expect((await state()).history.entries.map(entry => entry.eventId)).toEqual(visits);
  expect(await site(p.wcId, "document.querySelector('#note').value")).toBe('unsaved-fixture');
  expect(documentRequests).toBe(before);
  expect((await state()).tabs.find(tab => tab.tabId === p.id)?.url).toBe(p.url);
  console.log('HARD_RELOAD_GUARD ' + JSON.stringify({ nativeBeforeUnloadRespected: true, documentRequestsAdded: 0, newVisits: 0, formKept: true }));
});

test('HR-03: empty-tab chords allocate no page; an unopened target loads normally before explicit hard reload', async () => {
  await send('F5', ['control']); await send('R', ['control', 'shift']);
  expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(wc => wc.getURL().startsWith('http:') || wc.getURL() === 'about:blank').length)).toBe(0);
  assetVersion = 3;
  const warm = await open('/fallback-warm'), warmRequests = assetRequests;
  await send('F5', ['control'], warm.wcId);
  await expect.poll(() => assetRequests).toBe(warmRequests + 1);
  await expect.poll(() => site(warm.wcId, 'window.assetRevision')).toBe(3);
  await ready(warm.id); await ui.evaluate(id => window.browser.closeTab(id), warm.id);
  const id = (await state()).activeTabId!;
  assetVersion = 4;
  await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id, url: origin + '/pending' });
  const wcId = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getURL() === 'about:blank')!.id);
  await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isLoadingMainFrame(), wcId)).toBe(true);
  await ui.evaluate(id => window.browser.stop(id), id);
  await send('R', ['control', 'shift']);
  await ready(id);
  expect((await state()).tabs.find(tab => tab.tabId === id)?.url).toBe(origin + '/pending');
  expect((await state()).notice).toContain('sayfa açıldıktan sonra');
  expect(await site(wcId, 'window.assetRevision')).toBe(3);
  const requestsBefore = assetRequests;
  await send('F5', ['control'], wcId);
  await expect.poll(() => assetRequests).toBe(requestsBefore + 1); await ready(id);
  expect(await site(wcId, 'window.assetRevision')).toBe(4);
  expect((await state()).notice).toBeNull();
  console.log('HARD_RELOAD_FIRST ' + JSON.stringify({ blankNativePages: 0, intendedTargetLoaded: true, initialNavigationUsesNormalCache: true, fallbackExplained: true, subsequentHardReloadAssetRevision: 4 }));
});
