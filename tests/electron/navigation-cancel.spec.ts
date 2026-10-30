import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let app: ElectronApplication, ui: Page;
const errors: string[] = [];
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  app = await electron.launch({ args: [resolve('.')], env, chromiumSandbox: true });
  app.process().stderr?.on('data', (chunk: Buffer) => { if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString())) errors.push(chunk.toString()); });
  ui = await app.firstWindow(); await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
});
test.beforeEach(async () => {
  const s = await state();
  await ui.evaluate(id => window.browser.switchDevelopmentIdentity(id as 'test-a' | 'test-b'), s.developmentIdentity === 'test-a' ? 'test-b' : 'test-a');
});
test.afterEach(async () => {
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) if (wc.getURL().startsWith('http://127.0.0.1:')) {
      await wc.executeJavaScript('window.onbeforeunload=null;void 0').catch(() => {});
    }
  });
});
test.afterAll(async () => { if (app) await app.close(); expect(errors).toEqual([]); });
async function state(): Promise<BrowserSnapshot> {
  return ui.evaluate(async () => { const r = await window.browser.getState(); if (!r.ok) throw Error('State failed'); return r.data; });
}
async function ready(id: string) { await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === id)?.status).toBe('ready'); }
async function navigate(path: string) {
  const s = await state(), url = new URL(path, s.fixtureUrl).href, id = s.activeTabId!;
  expect((await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id, url })).ok).toBe(true);
  await ready(id); return { id, url };
}
async function guard(url: string) {
  return app.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL() === url)!;
    (globalThis as any).__navPrevented = 0;
    wc.once('will-prevent-unload', () => { (globalThis as any).__navPrevented++; });
    await wc.executeJavaScript("document.querySelector('#state-input').value='unsaved-fixture';window.navMarker=42;window.onbeforeunload=()=>false;void 0", true);
    return wc.id;
  }, url);
}

test('NC-01: cancelled address navigation restores the retained page and its form without a visit or reload', async () => {
  const p = await navigate('/page/1'); const nativeId = await guard(p.url);
  expect((await ui.evaluate(id => window.browser.setAdBlocking(id, false), p.id)).ok).toBe(true);
  const visits = (await state()).history.entries.map(entry => entry.eventId);
  const targetUrl = new URL('/page/2', p.url); targetUrl.hostname = 'localhost'; const target = targetUrl.href;
  expect((await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id: p.id, url: target })).ok).toBe(true);
  await expect.poll(() => app.evaluate(() => (globalThis as any).__navPrevented)).toBe(1);
  console.log('NAV_CANCEL_STATE ' + JSON.stringify({ tab: (await state()).tabs.find(tab => tab.tabId === p.id), native: await app.evaluate(({ webContents }, id) => { const wc = webContents.fromId(id)!; return { url: wc.getURL(), loading: wc.isLoadingMainFrame() }; }, nativeId) }));
  await ready(p.id);
  const s = await state(); expect(s.tabs.find(tab => tab.tabId === p.id)).toMatchObject({ url: p.url, title: 'Sayfa 1', loading: false, errorCode: null });
  expect(s.history.entries.map(entry => entry.eventId)).toEqual(visits);
  expect(s.adBlocking?.enabled).toBe(false);
  expect(await app.evaluate(async ({ webContents }, id) => { const wc = webContents.fromId(id)!; return { id: wc.id, ...(await wc.executeJavaScript("({form:document.querySelector('#state-input').value,marker:window.navMarker})")) }; }, nativeId)).toEqual({ id: nativeId, form: 'unsaved-fixture', marker: 42 });
  await expect(ui.getByRole('button', { name: 'Yenile', exact: true })).toBeVisible();
  await expect(ui.getByRole('textbox', { name: 'Sayfa adresi', exact: true })).toHaveValue(p.url);
  await expect(ui.getByRole('button', { name: 'Bu sitede reklam engelle', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(ui.getByTestId('page-title')).toHaveText('Sayfa 1');
  expect(await app.evaluate(({ BrowserWindow, WebContentsView }, id) => BrowserWindow.getAllWindows()[0]!.contentView.children.some(view => view instanceof WebContentsView && view.webContents.id === id && view.getVisible()), nativeId)).toBe(true);
  const png = await app.evaluate(async ({ BrowserWindow }) => [...(await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG()]);
  writeFileSync(`docs/evidence/p2-${s.appVersion.toLowerCase()}-navigation-cancel.png`, Buffer.from(png));
  await app.evaluate(async ({ webContents }, id) => { await webContents.fromId(id)!.executeJavaScript("document.title='Korunan form';void 0"); }, nativeId);
  await expect.poll(async () => (await state()).history.entries.find(entry => entry.eventId === visits[0])?.title).toBe('Korunan form');
  await app.evaluate(async ({ webContents }, id) => { await webContents.fromId(id)!.executeJavaScript('window.onbeforeunload=null;void 0'); }, nativeId);
  await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id: p.id, url: target }); await ready(p.id);
  expect((await state()).tabs.find(tab => tab.tabId === p.id)?.url).toBe(target);
  expect((await state()).adBlocking?.enabled).toBe(true);
  console.log('NAV_CANCEL_ADDRESS ' + JSON.stringify({ sameDocumentAndForm:true,historyIdsPreserved:true,metadataStillUpdates:true,siteFilterRestored:true,nextNavigationWorks:true }));
});

test('NC-02: a refused reload keeps the title, form, mute and keep-awake preferences', async () => {
  const p = await navigate('/page/1'), nativeId = await guard(p.url);
  await ui.evaluate(async id => { await window.browser.setTabMuted(id, true); await window.browser.setTabKeepAwake(id, true); }, p.id);
  const visits = (await state()).history.entries.map(entry => entry.eventId);
  expect((await ui.evaluate(id => window.browser.reload(id), p.id)).ok).toBe(true);
  await expect.poll(() => app.evaluate(() => (globalThis as any).__navPrevented)).toBe(1);
  await ready(p.id);
  expect((await state()).tabs.find(tab => tab.tabId === p.id)).toMatchObject({ url:p.url,title:'Sayfa 1',loading:false,errorCode:null,muted:true,keepAwake:true });
  expect((await state()).history.entries.map(entry => entry.eventId)).toEqual(visits);
  expect(await app.evaluate(async ({ webContents }, id) => { const wc=webContents.fromId(id)!;return { muted:wc.isAudioMuted(),...(await wc.executeJavaScript("({marker:window.navMarker,form:document.querySelector('#state-input').value})")) }; }, nativeId)).toEqual({ muted:true,marker:42,form:'unsaved-fixture' });
  console.log('NAV_CANCEL_RELOAD ' + JSON.stringify({ sameDocumentAndForm:true,mutePreserved:true,keepAwakePreserved:true,noExtraVisit:true }));
});

test('NC-03: rejected back and forward preserve the native history position and a later allowed navigation works', async () => {
  await navigate('/page/1'); await navigate('/page/2'); const p = await navigate('/page/3');
  await ui.evaluate(id => window.browser.goBack(id), p.id); await ready(p.id);
  const url = new URL('/page/2', p.url).href;
  const visits = (await state()).history.entries.map(entry => entry.eventId);
  for (const direction of ['back','forward'] as const) {
    const nativeId = await guard(url);
    expect((await ui.evaluate(({ id,direction }) => direction==='back'?window.browser.goBack(id):window.browser.goForward(id), { id:p.id,direction })).ok).toBe(true);
    await expect.poll(() => app.evaluate(() => (globalThis as any).__navPrevented)).toBe(1);
    await ready(p.id);
    expect((await state()).tabs.find(tab => tab.tabId === p.id)).toMatchObject({ url,title:'Sayfa 2',loading:false,errorCode:null,canGoBack:true,canGoForward:true });
    expect((await state()).history.entries.map(entry => entry.eventId)).toEqual(visits);
    expect(await app.evaluate(async ({ webContents }, id) => { const wc=webContents.fromId(id)!;return { index:wc.navigationHistory.getActiveIndex(),length:wc.navigationHistory.length(),...(await wc.executeJavaScript("({marker:window.navMarker,form:document.querySelector('#state-input').value})")) }; }, nativeId)).toEqual({ index:1,length:3,marker:42,form:'unsaved-fixture' });
  }
  await app.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(wc=>wc.getURL()===url)!.executeJavaScript('window.onbeforeunload=null;void 0'); }, url);
  await ui.evaluate(id => window.browser.goForward(id),p.id); await ready(p.id);
  expect((await state()).tabs.find(tab => tab.tabId===p.id)).toMatchObject({ url:p.url,title:'Sayfa 3',canGoForward:false });
  console.log('NAV_CANCEL_HISTORY ' + JSON.stringify({ refusedBackAndForward:true,sameNativeHistoryIndex:1,sameHistoryLength:3,formKept:true,nextForwardWorks:true }));
});
