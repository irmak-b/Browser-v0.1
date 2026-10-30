import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let application: ElectronApplication, ui: Page;
let runtimeErrors: string[];
test.beforeEach(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  runtimeErrors = [];
  application = await electron.launch({ args: [resolve('.')], env, chromiumSandbox: true });
  application.process().stderr?.on('data', (chunk: Buffer) => {
    if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString())) runtimeErrors.push(chunk.toString());
  });
  ui = await application.firstWindow();
  await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!; win.focus(); win.webContents.focus();
  });
  await expect.poll(focusedUrl).toBe('app://browser/index.html');
});
test.afterEach(async () => {
  if (application) await application.close();
  expect(runtimeErrors).toEqual([]);
});
async function state(): Promise<BrowserSnapshot> {
  return ui.evaluate(async () => {
    const reply = await window.browser.getState();
    if (!reply.ok) throw new Error('State failed');
    return reply.data;
  });
}
async function navigate(path: string) {
  const snapshot = await state();
  const url = new URL(path, snapshot.fixtureUrl).href;
  const reply = await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id: snapshot.activeTabId!, url });
  expect(reply.ok).toBe(true);
  await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === snapshot.activeTabId)?.status).toBe('ready');
  return url;
}
async function send(keyCode: string, modifiers: ('control' | 'shift' | 'alt')[] = []) {
  // Only the initial setup focuses a surface. Every subsequent shortcut goes
  // to the actual focused WebContents, so wrong tab/address focus fails here.
  await application.evaluate(({ webContents }, { keyCode, modifiers }) => {
    const focused = webContents.getFocusedWebContents();
    if (!focused) throw new Error('No focused WebContents');
    focused.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    focused.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, { keyCode, modifiers });
}
async function focusedUrl() {
  return application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL());
}
async function nativeCount() {
  return application.evaluate(({ webContents }) => webContents.getAllWebContents().filter(wc => wc.getURL().startsWith('http://127.0.0.1:')).length);
}

test('KB-01: native tab cycling, wrapping and numbered selection keep empty tabs light and page state intact', async () => {
  const first = (await state()).activeTabId!;
  const url = await navigate('/page/1');
  const initial = await application.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL() === url)!;
    await wc.executeJavaScript("document.querySelector('#state-input').value='kept';void 0");
    wc.focus();
    return { id: wc.id, load: await wc.executeJavaScript("document.querySelector('#load-count').textContent") };
  }, url);
  const ids = [first];
  for (let index = 0; index < 9; index++) {
    await send('T', ['control']);
    await expect.poll(async () => (await state()).tabs.length).toBe(index + 2);
    await expect(ui.getByRole('textbox', { name: 'Sayfa adresi' })).toBeFocused();
    ids.push((await state()).activeTabId!);
  }
  expect(await nativeCount()).toBe(1);
  for (const [key, expected] of [['1', first], ['8', ids[7]!], ['9', ids[9]!]] as const) {
    await send(key, ['control']);
    await expect.poll(async () => (await state()).activeTabId).toBe(expected);
    if (expected === first) await expect.poll(focusedUrl).toBe(url);
    else await expect(ui.getByRole('textbox', { name: 'Sayfa adresi' })).toBeFocused();
  }
  await send('Tab', ['control']);
  await expect.poll(async () => (await state()).activeTabId).toBe(first);
  await expect.poll(focusedUrl).toBe(url);
  await send('Tab', ['control', 'shift']);
  await expect.poll(async () => (await state()).activeTabId).toBe(ids[9]);
  await expect(ui.getByRole('textbox', { name: 'Sayfa adresi' })).toBeFocused();
  await send('Tab', ['control', 'shift']);
  await expect.poll(async () => (await state()).activeTabId).toBe(ids[8]);
  await send('1', ['control']);
  await expect.poll(focusedUrl).toBe(url);
  const result = await application.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL() === url)!;
    return { id: wc.id, value: await wc.executeJavaScript("document.querySelector('#state-input').value"), load: await wc.executeJavaScript("document.querySelector('#load-count').textContent") };
  }, url);
  expect(result).toEqual({ ...initial, value: 'kept' });
  expect(await nativeCount()).toBe(1);
  console.log('KEYBOARD_TABS ' + JSON.stringify({ version: (await state()).appVersion, tabs: 10, nativePages: 1, preserved: result }));
});

test('KB-02: history and reload shortcuts work with native focus; unavailable commands are harmless', async () => {
  const id = (await state()).activeTabId!;
  await send('R', ['control']); // Empty tab: no renderer and no policy error.
  await send('8', ['control']); // Missing tab: keep the current selection.
  expect((await state()).activeTabId).toBe(id);
  expect(await nativeCount()).toBe(0);
  const first = await navigate('/page/1');
  const second = await navigate('/page/2');
  await application.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.focus(), second);
  await send('Left', ['alt']);
  await expect.poll(async () => (await state()).tabs[0]?.url).toBe(first);
  await expect.poll(async () => (await state()).tabs[0]?.status).toBe('ready');
  await send('Left', ['alt']); // No earlier history entry.
  expect((await state()).tabs[0]?.url).toBe(first);
  await send('Right', ['alt']);
  await expect.poll(async () => (await state()).tabs[0]?.url).toBe(second);
  await expect.poll(async () => (await state()).tabs[0]?.status).toBe('ready');
  const loadCount = () => application.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.executeJavaScript("document.querySelector('#load-count').textContent"), second);
  for (const [key, modifiers] of [['R', ['control']], ['F5', []]] as const) {
    const before = await loadCount();
    await send(key, [...modifiers]);
    await expect.poll(loadCount).not.toBe(before);
    await expect.poll(async () => (await state()).tabs[0]?.status).toBe('ready');
  }
  await send('L', ['control']);
  await expect(ui.getByRole('textbox', { name: 'Sayfa adresi' })).toBeFocused();
  await send('T', ['control']);
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  await send('W', ['control']);
  await expect.poll(async () => (await state()).activeTabId).toBe(id);
  await expect.poll(focusedUrl).toBe(second);
  expect((await state()).notice).toBeNull();
});
