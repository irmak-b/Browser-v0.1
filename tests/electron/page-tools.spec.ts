import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let application: ElectronApplication, ui: Page;
let errors: string[];
test.beforeEach(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  application = await electron.launch({ args: [resolve('.')], env, chromiumSandbox: true });
  errors = [];
  application.process().stderr?.on('data', (chunk: Buffer) => {
    if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString())) errors.push(chunk.toString());
  });
  ui = await application.firstWindow();
  await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
  // Legacy control tests explicitly open the now-optional information panel.
  await ui.getByRole('button', { name: 'Bilgi paneli', exact: true }).click();
});
test.afterEach(async () => { if (application) await application.close(); expect(errors).toEqual([]); });
async function state(): Promise<BrowserSnapshot> {
  return ui.evaluate(async () => { const reply = await window.browser.getState(); if (!reply.ok) throw new Error(); return reply.data; });
}
async function navigate(path = '/page/1') {
  const snapshot = await state();
  const url = new URL(path, snapshot.fixtureUrl).href;
  const reply = await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id: snapshot.activeTabId!, url });
  expect(reply.ok).toBe(true);
  await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === snapshot.activeTabId)?.status).toBe('ready');
  return url;
}
async function focusPage(url: string) {
  await application.evaluate(({ BrowserWindow, webContents }, url) => {
    BrowserWindow.getAllWindows()[0]!.focus();
    webContents.getAllWebContents().find(wc => wc.getURL() === url)!.focus();
  }, url);
}
async function send(keyCode: string, modifiers: ('control' | 'shift')[] = []) {
  await application.evaluate(({ webContents }, input) => {
    const wc = webContents.getFocusedWebContents(); if (!wc) throw new Error('No focused WebContents');
    wc.sendInputEvent({ type: 'keyDown', ...input }); wc.sendInputEvent({ type: 'keyUp', ...input });
  }, { keyCode, modifiers });
}
async function listeners(url: string) {
  return application.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)?.listenerCount('found-in-page') ?? -1, url);
}

test('PT-01: native Ctrl+F, debounced literal search, next/previous and ESC work without reloading the page', async () => {
  const url = await navigate();
  await application.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.executeJavaScript("document.body.innerHTML='<p>nebulatest first nebulatest second nebulatest</p>';void 0"), url);
  await focusPage(url); await send('F', ['control']);
  const field = ui.getByRole('textbox', { name: 'Sayfada ara', exact: true });
  await expect(field).toBeFocused();
  await field.fill('nebulatest');
  await expect(ui.getByTestId('find-count')).toHaveText('1/3');
  const png = await application.evaluate(async ({ BrowserWindow }) => [...(await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG()]);
  writeFileSync(`docs/evidence/p2-${(await state()).appVersion.toLowerCase()}-page-tools.png`, Buffer.from(png));
  await field.press('Enter');
  await expect(ui.getByTestId('find-count')).toHaveText('2/3');
  await send('F3'); await expect(ui.getByTestId('find-count')).toHaveText('3/3');
  await send('F3', ['shift']); await expect(ui.getByTestId('find-count')).toHaveText('2/3');
  await field.fill('nothing-matches-this');
  await expect(ui.getByTestId('find-count')).toHaveText('Eşleşme yok');
  await field.fill(''); await expect(ui.getByTestId('find-count')).toHaveText('Metin girin');
  await send('Escape'); await expect(field).toHaveCount(0);
  expect((await state()).find).toBeNull(); expect(await listeners(url)).toBe(0);
  expect(await application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url);
  const pageState = await application.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.executeJavaScript("({text:document.body.textContent,bridge:typeof window.browser,node:typeof process})"), url);
  expect(pageState.text).toContain('nebulatest first'); expect(pageState.bridge).toBe('undefined'); expect(pageState.node).toBe('undefined');
  console.log('PAGE_FIND_NATIVE '+JSON.stringify({version:(await state()).appVersion,matches:3,next:2,forward:3,backward:2,emptyCleared:true,closedListeners:0}));
});

test('PT-02: find is cleared on selection, navigation, identity and crash; malformed or foreign IPC does not affect the active page', async () => {
  const url = await navigate(); const first = (await state()).activeTabId!;
  expect((await ui.evaluate(id => window.browser.openFind(id), first)).ok).toBe(true);
  const invalid = await ui.evaluate(async id => {
    const results = [await window.browser.findInPage(id, 'x'.repeat(257), 'new'), await window.browser.openFind('foreign'), await window.browser.zoom('foreign', 'in'), await window.browser.zoom(id, 'invalid' as 'in')];
    return results.map(result => result.ok ? 'unexpected success' : result.errorCode);
  }, first);
  expect(invalid).toEqual(['INVALID_INPUT', 'OPERATION_CANCELLED', 'OPERATION_CANCELLED', 'INVALID_INPUT']);
  await ui.evaluate(id => window.browser.findInPage(id, 'Sayfa', 'new'), first);
  await expect.poll(async () => (await state()).find?.pending).toBe(false);
  const opened = await ui.evaluate(() => window.browser.openTab()); expect(opened.ok).toBe(true);
  await expect.poll(async () => (await state()).find).toBeNull(); expect(await listeners(url)).toBe(0);
  await ui.evaluate(id => window.browser.activateTab(id), first);
  await ui.evaluate(id => window.browser.openFind(id), first); expect(await listeners(url)).toBe(1);
  const second = await navigate('/page/2'); expect((await state()).find).toBeNull(); expect(await listeners(second)).toBe(0);
  await ui.evaluate(id => window.browser.openFind(id), first);
  await application.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.forcefullyCrashRenderer(), second);
  await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === first)?.errorCode).toBe('RENDER_PROCESS_GONE');
  expect((await state()).find).toBeNull(); expect(await listeners(second)).toBe(0);
  const crashedFind = await ui.evaluate(id => window.browser.openFind(id), first);
  expect(crashedFind.ok).toBe(false);
  await ui.evaluate(id => window.browser.reload(id), first);
  await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === first)?.status).toBe('ready');
  await ui.evaluate(id => window.browser.openFind(id), first);
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-b'));
  expect((await state()).find).toBeNull();
});

test('PT-03: native zoom keys and controls resize only the site, preserve its document and keep blank tabs light', async () => {
  const url = await navigate(); const first = (await state()).activeTabId!;
  const probe = () => application.evaluate(async ({ webContents, BrowserWindow }, url) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL() === url)!;
    return { id: wc.id, zoom: wc.getZoomFactor(), uiZoom: BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(), document: await wc.executeJavaScript("document.querySelector('#load-count').textContent") };
  }, url);
  const before = await probe();
  await focusPage(url); await send('=', ['control']);
  await expect.poll(async () => Math.round((await probe()).zoom * 100)).toBe(110);
  await expect(ui.getByRole('button', { name: 'Yakınlaştırmayı sıfırla' })).toHaveText('%110');
  await send('+', ['control', 'shift']);
  await expect.poll(async () => Math.round((await probe()).zoom * 100)).toBe(125);
  await send('-', ['control']); await expect.poll(async () => Math.round((await probe()).zoom * 100)).toBe(110);
  await send('0', ['control']); await expect.poll(async () => (await probe()).zoom).toBe(1);
  await application.evaluate(({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL() === url)!;
    const events: { direction: string; percent: number }[] = [];
    (globalThis as { toolWheelEvents?: typeof events }).toolWheelEvents = events;
    wc.on('zoom-changed', (_event, direction) => events.push({ direction, percent: Math.round(wc.getZoomFactor() * 100) }));
    wc.sendInputEvent({ type: 'mouseWheel', x: 50, y: 50, deltaX: 0, deltaY: -120, wheelTicksY: -1, canScroll: true, modifiers: ['control'] });
  }, url);
  // Electron's injector forwards began + synthetic-ended with the same tick.
  // Count the native requests instead of calling this a physical wheel notch.
  await expect.poll(async () => Math.round((await probe()).zoom * 100)).toBe(80);
  const wheel = await application.evaluate(() => (globalThis as { toolWheelEvents?: unknown }).toolWheelEvents);
  expect(wheel).toEqual([{ direction: 'out', percent: 90 }, { direction: 'out', percent: 80 }]);
  console.log('PAGE_WHEEL_REQUESTS '+JSON.stringify(wheel));
  await send('0', ['control']); await expect.poll(async () => (await probe()).zoom).toBe(1);
  await ui.getByRole('button', { name: 'Yakınlaştır', exact: true }).click();
  await expect.poll(async () => Math.round((await probe()).zoom * 100)).toBe(110);
  await ui.getByRole('button', { name: 'Yakınlaştırmayı sıfırla' }).click();
  await expect.poll(async () => (await probe()).zoom).toBe(1);
  expect(await probe()).toEqual(before);
  await ui.evaluate(() => window.browser.openTab());
  expect((await state()).zoomFactor).toBe(1);
  expect(await application.evaluate(({ webContents }) => webContents.getAllWebContents().filter(wc => wc.getURL().startsWith('http://127.0.0.1:')).length)).toBe(1);
  await ui.evaluate(id => window.browser.activateTab(id), first);
  console.log('PAGE_ZOOM_NATIVE '+JSON.stringify({version:(await state()).appVersion,preserved:await probe(),emptyNativePages:1}));
});
