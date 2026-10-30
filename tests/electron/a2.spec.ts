import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let application: ElectronApplication;
let ui: Page;
let runtimeErrors: string[];
test.beforeEach(async () => {
  const executablePath = resolve('node_modules/electron/dist/electron.exe');
  if (!existsSync(executablePath)) throw new Error('Yerel Electron eksik; indirme yapılmadı.');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  application = await electron.launch({ args: [resolve('.')], cwd: resolve('.'), env, chromiumSandbox: true });
  runtimeErrors = [];
  application.process().stderr?.on('data', (chunk: Buffer) => {
    if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString())) runtimeErrors.push(chunk.toString());
  });
  ui = await application.firstWindow();
  await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
  // Legacy control tests explicitly open the now-optional information panel.
  await ui.getByRole('button', { name: 'Bilgi paneli', exact: true }).click();
});
test.afterEach(async () => {
  if (application) {
    // Release only test-installed unload guards so failed assertions cannot
    // strand the test runner. Production close behavior is asserted beforehand.
    await application.evaluate(async ({ webContents }) => {
      for (const wc of webContents.getAllWebContents()) {
        if (wc.getURL().startsWith('http://127.0.0.1:')) await wc.executeJavaScript('window.onbeforeunload=null;void 0').catch(() => {});
      }
    }).catch(() => {});
    await application.close();
  }
  expect(runtimeErrors ?? []).toEqual([]);
});

async function state(): Promise<BrowserSnapshot> {
  return ui.evaluate(async () => { const response = await window.browser.getState(); if (!response.ok) throw new Error('State failed'); return response.data; });
}
async function navigate(path: string) {
  return ui.evaluate(async (path) => {
    const response = await window.browser.getState();
    if (!response.ok) throw new Error('State failed');
    return window.browser.navigate(response.data.activeTabId!, new URL(path, response.data.fixtureUrl).href);
  }, path);
}
async function ready(title: string) {
  await expect(ui.getByTestId('page-title')).toHaveText(title);
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
}

test('B08: five actual WebContents retain independent DOM state on tab switches', async () => {
  const ids = await ui.evaluate(async () => {
    const response = await window.browser.getState(); if (!response.ok) throw new Error('State failed');
    const first = response.data.activeTabId!;
    await window.browser.navigate(first, new URL('/page/1', response.data.fixtureUrl).href);
    const ids = [first];
    for (let index = 2; index <= 5; index++) {
      const result = await window.browser.openTab(new URL(`/page/${index}`, response.data.fixtureUrl).href);
      if (!result.ok) throw new Error('Open failed'); ids.push(result.data.tabId);
    }
    return ids;
  });
  await ready('Sayfa 5');
  await expect.poll(async () => (await state()).tabs.filter((tab) => tab.status === 'ready').length).toBe(5);
  const count = await application.evaluate(async ({ webContents }) => {
    const sites = webContents.getAllWebContents().filter((wc) => /\/page\/[1-5]$/.test(wc.getURL()));
    for (const site of sites) await site.executeJavaScript(`document.querySelector('input').value=${JSON.stringify('kept-' + site.getURL().slice(-1))}`);
    return new Set(sites.map((wc) => wc.id)).size;
  });
  expect(count).toBe(5);
  for (const [index, id] of ids.entries()) {
    await ui.evaluate((id) => window.browser.activateTab(id), id);
    await ready(`Sayfa ${index + 1}`);
    await expect(ui.getByRole('textbox', { name: 'Sayfa adresi' })).toHaveValue(new RegExp(`/page/${index + 1}$`));
  }
  const retained = await application.evaluate(async ({ webContents }) => {
    return Promise.all(webContents.getAllWebContents().filter((wc) => /\/page\/[1-5]$/.test(wc.getURL())).map(async (wc) => ({
      url: wc.getURL(), value: await wc.executeJavaScript("document.querySelector('input').value"),
    })));
  });
  expect(retained.every((item) => item.value === 'kept-' + item.url.slice(-1))).toBe(true);
});

test('B09: background title and address changes never replace active address or edit', async () => {
  await navigate('/page/1'); await ready('Sayfa 1');
  const backgroundId = (await state()).activeTabId!;
  await ui.evaluate(async () => { const s = await window.browser.getState(); if(s.ok) await window.browser.openTab(new URL('/page/2', s.data.fixtureUrl).href); });
  await ready('Sayfa 2');
  const activeAddress = (await state()).tabs.find((tab) => tab.title === 'Sayfa 2')!.url;
  await ui.getByRole('textbox', { name: 'Sayfa adresi' }).fill('henüz gönderilmemiş arama');
  await application.evaluate(async ({ webContents }) => {
    const background = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'))!;
    await background.executeJavaScript("document.title='Arka plan değişti';history.pushState({},'', '/page/1#background')");
  });
  await expect.poll(async () => (await state()).tabs.find((tab) => tab.tabId === backgroundId)?.title).toBe('Arka plan değişti');
  await expect(ui.getByTestId('page-title')).toHaveText('Sayfa 2');
  await expect(ui.getByRole('textbox', { name: 'Sayfa adresi' })).toHaveValue('henüz gönderilmemiş arama');
  expect((await state()).tabs.find((tab) => tab.title === 'Sayfa 2')!.url).toBe(activeAddress);
});

test('B10: back, forward and reload follow the active tab real navigation history', async () => {
  await navigate('/page/1'); await ready('Sayfa 1');
  await navigate('/second'); await ready('İkinci sayfa');
  await expect(ui.getByRole('button', { name: 'Geri', exact: true })).toBeEnabled();
  await ui.getByRole('button', { name: 'Geri', exact: true }).click(); await ready('Sayfa 1');
  await expect(ui.getByRole('button', { name: 'İleri', exact: true })).toBeEnabled();
  await ui.getByRole('button', { name: 'İleri', exact: true }).click(); await ready('İkinci sayfa');
  await ui.getByRole('button', { name: 'Geri', exact: true }).click(); await ready('Sayfa 1');
  const before = await application.evaluate(({ webContents }) => webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'))!.executeJavaScript("document.getElementById('load-count').textContent"));
  await ui.getByRole('button', { name: 'Yenile', exact: true }).click(); await ready('Sayfa 1');
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'))!.executeJavaScript("document.getElementById('load-count').textContent"))).not.toBe(before);
});

test('B10/B11: stop and a rapid new navigation do not accept old completion', async () => {
  await navigate('/page/1'); await ready('Sayfa 1');
  await navigate('/slow');
  await expect(ui.getByRole('button', { name: 'Durdur', exact: true })).toBeVisible();
  await ui.getByRole('button', { name: 'Durdur', exact: true }).click();
  await expect(ui.getByTestId('page-status')).toHaveText('Durduruldu');
  await navigate('/slow');
  await navigate('/page/2'); await ready('Sayfa 2');
  await ui.waitForTimeout(1100); // Wait past the deliberately delayed old fixture response.
  await ready('Sayfa 2');
  await expect(ui.getByRole('textbox', { name: 'Sayfa adresi' })).toHaveValue(/\/page\/2$/);
});

test('B11/B12: closing loading/background tabs destroys their contents and ignores old events', async () => {
  await navigate('/page/1'); await ready('Sayfa 1');
  const survivor = (await state()).activeTabId!;
  await ui.evaluate(async () => { const s = await window.browser.getState(); if(s.ok) await window.browser.openTab(new URL('/slow', s.data.fixtureUrl).href); });
  const closingId = (await state()).activeTabId!;
  const closed = await ui.evaluate((id) => window.browser.closeTab(id), closingId);
  expect(closed.ok).toBe(true);
  await ready('Sayfa 1');
  await ui.waitForTimeout(1100);
  expect((await state()).tabs.map((tab) => tab.tabId)).toEqual([survivor]);
  const stale = await ui.evaluate((id) => window.browser.reload(id), closingId);
  expect(stale).toMatchObject({ ok: false, errorCode: 'TAB_CLOSED' });
  await ui.evaluate(async () => { const s = await window.browser.getState(); if(s.ok) await window.browser.openTab(new URL('/page/2', s.data.fixtureUrl).href); });
  await ready('Sayfa 2');
  const result = await ui.evaluate((id) => window.browser.closeTab(id), survivor);
  expect(result.ok).toBe(true);
  await ready('Sayfa 2');
  expect((await state()).tabs).toHaveLength(1);
});

test('B12: last tab becomes one new blank tab; UI remount does not duplicate tabs/views', async () => {
  await navigate('/page/1'); await ready('Sayfa 1');
  const before = (await state()).activeTabId!;
  await ui.evaluate((id) => window.browser.closeTab(id), before);
  await expect.poll(async () => (await state()).tabs.length).toBe(1);
  const blank = await state();
  expect(blank.activeTabId).not.toBe(before);
  expect(blank.tabs[0]!.status).toBe('empty');
  await navigate('/page/2'); await ready('Sayfa 2');
  const id = (await state()).activeTabId;
  for (let index = 0; index < 3; index++) {
    await ui.reload();
    await ready('Sayfa 2');
    expect((await state()).tabs.map((tab) => tab.tabId)).toEqual([id]);
    const views = await application.evaluate(({ BrowserWindow, WebContentsView }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      return win.contentView.children.filter((view) => view instanceof WebContentsView && view.webContents.id !== win.webContents.id).length;
    });
    expect(views).toBe(1);
  }
});

test('B13: Ctrl+L/T/W and F5 work while the native site owns focus', async () => {
  await navigate('/page/1'); await ready('Sayfa 1');
  async function send(keyCode: string, control = false) {
    await application.evaluate(({ BrowserWindow, webContents }, request) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const site = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'))!;
      win.focus(); site.focus();
      site.sendInputEvent({ type: 'keyDown', keyCode: request.keyCode, modifiers: request.control ? ['control'] : [] });
      site.sendInputEvent({ type: 'keyUp', keyCode: request.keyCode, modifiers: request.control ? ['control'] : [] });
    }, { keyCode, control });
  }
  await send('L', true);
  await expect(ui.getByRole('textbox', { name: 'Sayfa adresi' })).toBeFocused();
  await send('T', true);
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  await expect(ui.getByRole('textbox', { name: 'Sayfa adresi' })).toBeFocused();
  const first = (await state()).tabs.find((tab) => tab.url.endsWith('/page/1'))!.tabId;
  await ui.evaluate((id) => window.browser.activateTab(id), first); await ready('Sayfa 1');
  const count = await application.evaluate(({ webContents }) => webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'))!.executeJavaScript("document.getElementById('load-count').textContent"));
  await send('F5');
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'))!.executeJavaScript("document.getElementById('load-count').textContent"))).not.toBe(count);
  await ready('Sayfa 1');
  await send('W', true);
  await expect.poll(async () => (await state()).tabs.length).toBe(1);
  expect((await state()).tabs[0]!.status).toBe('empty');
});

test('scripted popup remains denied with a visible policy explanation', async () => {
  await ui.getByRole('button', { name: 'Test sayfasını aç', exact: true }).click();
  await ready('Browser Core — Test Sayfası');
  await application.evaluate(async ({ webContents }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    await site.executeJavaScript("window.open('/popup')");
  });
  await expect(ui.getByTestId('policy-notice')).toContainText('Popup engellendi');
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('B10: unavailable, foreign and malformed tab commands return defined errors', async () => {
  const result = await ui.evaluate(async () => {
    const snapshot = await window.browser.getState(); if (!snapshot.ok) throw new Error('State failed');
    const id = snapshot.data.activeTabId!;
    return {
      back: await window.browser.goBack(id), forward: await window.browser.goForward(id),
      reload: await window.browser.reload(id), stop: await window.browser.stop(id),
      close: await window.browser.closeTab('foreign-tab'), activate: await window.browser.activateTab('foreign-tab'),
      malformed: await window.browser.activateTab(42 as never),
    };
  });
  for (const key of ['back', 'forward', 'reload'] as const) expect(result[key]).toMatchObject({ ok: false, errorCode: 'OPERATION_CANCELLED' });
  expect(result.stop).toMatchObject({ ok: true });
  expect(result.close).toMatchObject({ ok: false, errorCode: 'TAB_NOT_FOUND' });
  expect(result.activate).toMatchObject({ ok: false, errorCode: 'TAB_NOT_FOUND' });
  expect(result.malformed).toMatchObject({ ok: false, errorCode: 'INVALID_INPUT' });
});

test('B11: old document title while a newer page loads cannot replace its state', async () => {
  await navigate('/late-title'); await ready('Browser Core — Test Sayfası');
  await navigate('/slow');
  await ui.waitForTimeout(500); // Old document changes its title at 400ms; new response arrives at 900ms.
  await expect(ui.getByTestId('page-title')).not.toHaveText('Eski sayfa başlığı');
  await ready('Yavaş sayfa');
});

test('B12: beforeunload preserves a tab and window; closed tab listeners are removed', async () => {
  await navigate('/page/1'); await ready('Sayfa 1');
  const id = (await state()).activeTabId!;
  await application.evaluate(async ({ webContents }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'))!;
    await site.executeJavaScript('window.onbeforeunload=()=>false;void 0', true);
  });
  try {
    const result = await ui.evaluate((id) => window.browser.closeTab(id), id);
    expect(result).toMatchObject({ ok: false, errorCode: 'OPERATION_CANCELLED' });
    expect((await state()).activeTabId).toBe(id);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect(ui.getByTestId('policy-notice')).toContainText('Pencere kapatılmadı');
    await application.evaluate(async ({ webContents }) => {
      const site = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'))!;
      await site.executeJavaScript("document.title='Korunan sekme'");
    });
    await ready('Korunan sekme');
  } finally {
    await application.evaluate(async ({ webContents }) => {
      const site = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'));
      if (site) await site.executeJavaScript('window.onbeforeunload=null');
    });
  }
  await application.evaluate(({ webContents }) => {
    (globalThis as { a2ClosedProbe?: Electron.WebContents }).a2ClosedProbe = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/page/1'))!;
  });
  await ui.evaluate((id) => window.browser.closeTab(id), id);
  const count = await application.evaluate(() => {
    const scope = globalThis as { a2ClosedProbe?: Electron.WebContents };
    const site = scope.a2ClosedProbe!;
    const count = site.listenerCount('page-title-updated');
    site.emit('page-title-updated', {}, 'Hayalet başlık', true);
    delete scope.a2ClosedProbe;
    return count;
  });
  expect(count).toBe(0);
  await expect(ui.getByTestId('page-title')).toHaveText('Yeni sekme');
});
