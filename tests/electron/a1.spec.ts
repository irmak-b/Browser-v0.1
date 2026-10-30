import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { LAYOUT } from '../../src/shared/contracts';

let application: ElectronApplication;
let ui: Page;
let runtimeErrors: string[];

test.beforeEach(async ({}, testInfo) => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const scale = /scale=(1\.25|1\.5)/.exec(testInfo.title)?.[1];
  const executablePath = resolve('node_modules/electron/dist/electron.exe');
  if (!existsSync(executablePath)) throw new Error('Yerel Electron yok; indirme yapılmadı.');
  // check-runtime preflight validates the installed binary; use Playwright's
  // standard Node-app launch so its own Electron loader is installed as well.
  application = await electron.launch({ args: [...(scale ? [`--force-device-scale-factor=${scale}`] : []), resolve('.')], cwd: resolve('.'), env, chromiumSandbox: true });
  runtimeErrors = [];
  application.process().stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(text)) runtimeErrors.push(text);
  });
  ui = await application.firstWindow();
  await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
  // Legacy control tests explicitly open the now-optional information panel.
  await ui.getByRole('button', { name: 'Bilgi paneli', exact: true }).click();
});
test.afterEach(async () => {
  if (application) await application.close();
  expect(runtimeErrors ?? []).toEqual([]);
});

async function openFixture() {
  await ui.getByRole('button', { name: 'Test sayfasını aç', exact: true }).click();
  await expect(ui.getByTestId('page-title')).toHaveText('Browser Core — Test Sayfası');
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
}

test('B01: real page opens from React; title changes return through main', async () => {
  await openFixture();
  const isolation = await application.evaluate(async ({ webContents }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    return site.executeJavaScript('({bridge:typeof window.browser,node:typeof window.require,process:typeof window.process})');
  });
  expect(isolation).toEqual({ bridge: 'undefined', node: 'undefined', process: 'undefined' });
  await application.evaluate(async ({ webContents }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    await site.executeJavaScript("document.getElementById('change-title').click()");
  });
  await expect(ui.getByTestId('page-title')).toHaveText('Başlık güncellendi');
  await ui.screenshot({ path: 'test-results/a1-ui-title.png' });
});

test('B02: native bounds preserve toolbar/sidebar during resize and modal', async () => {
  await openFixture();
  for (const size of [{ width: 920, height: 620 }, { width: 1440, height: 960 }]) {
    await application.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0]!.setSize(next.width, next.height), size);
    await expect.poll(async () => application.evaluate(({ BrowserWindow, WebContentsView }, layout) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const view = win.contentView.children.find((child) => child instanceof WebContentsView && child.webContents.id !== win.webContents.id)!;
      const bounds = view.getBounds();
      const { width, height } = win.getContentBounds();
      return bounds.y >= layout.toolbarHeight && bounds.x + bounds.width <= width - layout.infoPanelWidth && bounds.y + bounds.height <= height;
    }, LAYOUT)).toBe(true);
  }
  await ui.getByRole('button', { name: 'Geliştirme bilgisi' }).click();
  await expect(ui.getByRole('dialog')).toBeVisible();
  expect(await application.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    return win.contentView.children.find((child) => child instanceof WebContentsView && child.webContents.id !== win.webContents.id)!.getVisible();
  })).toBe(false);
  await ui.getByRole('button', { name: 'Sayfaya dön' }).click();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(ui.getByRole('button', { name: 'Geliştirme bilgisi' })).toBeFocused();
  await expect(ui.getByTestId('page-title')).toHaveText('Browser Core — Test Sayfası');
});

test('B03/B05: site has secure preferences, no preload; popup and app navigation denied', async () => {
  await openFixture();
  const isolation = await application.evaluate(({ app, BrowserWindow, webContents }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    const site = webContents.getAllWebContents().find((wc) => wc.id !== win.webContents.id)!;
    const metrics = app.getAppMetrics();
    return {
      siteSandboxed: metrics.find((metric) => metric.pid === site.getOSProcessId())?.sandboxed,
      uiSandboxed: metrics.find((metric) => metric.pid === win.webContents.getOSProcessId())?.sandboxed,
      distinctSession: site.session !== win.webContents.session,
    };
  });
  expect(isolation).toEqual({ siteSandboxed: true, uiSandboxed: true, distinctSession: true });
  expect(await application.evaluate(async ({ webContents, BrowserWindow }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    const result = await site.executeJavaScript("window.open('/popup') === null");
    return { result, windows: BrowserWindow.getAllWindows().length };
  })).toEqual({ result: true, windows: 1 });
  await application.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript("location.href='https://example.com/'");
  });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getURL())).toBe('app://browser/index.html');
  // Playwright can keep an aborted custom-scheme navigation pending; inspect
  // the actual application's document rather than its navigation bookkeeping.
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript("document.body.innerText.includes('Browser Core bağlı')"))).toBe(true);
  expect(await application.evaluate(async ({ webContents }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    return site.executeJavaScript("navigator.permissions.query({name:'geolocation'}).then(p=>p.state)");
  })).toBe('denied');
});

test('B04: real unauthorized sender rejected; payload, ownership and viewport validated', async () => {
  const probeResult = await application.evaluate(async ({ BrowserWindow }, preloadPath) => {
    const attacker = new BrowserWindow({ show: false, webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await attacker.loadURL('about:blank');
      return await attacker.webContents.executeJavaScript('window.probe.result');
    } finally { attacker.destroy(); }
  }, resolve('tests/fixtures/ipc-probe.cjs'));
  expect(probeResult).toMatchObject({ ok: false, errorCode: 'UNAUTHORIZED' });
  const invalid = await ui.evaluate(async () => ({
    viewport: await window.browser.setViewport({ visible: true, x: -1, y: 0, width: 900, height: 600, revision: 100 }),
    tab: await window.browser.navigate('not-our-tab', 'https://example.com'),
    url: await window.browser.openTab('file:///C:/Windows/win.ini'),
  }));
  expect(invalid.viewport).toMatchObject({ ok: false, errorCode: 'INVALID_INPUT' });
  expect(invalid.tab).toMatchObject({ ok: false, errorCode: 'TAB_NOT_FOUND' });
  expect(invalid.url).toMatchObject({ ok: false, errorCode: 'POLICY_BLOCKED' });
  const bounds = await ui.evaluate((layout) => window.browser.setViewport({ visible: true, x: 0, y: 0, width: 30000, height: 30000, revision: 9999 }).then((r) => ({ r, layout })), LAYOUT);
  expect(bounds.r.ok).toBe(true);
  if (bounds.r.ok) expect(bounds.r.data.y).toBe(LAYOUT.toolbarHeight);
});

test('B05: links and redirects enforce the site boundary separately from API navigation', async () => {
  await openFixture();
  await application.evaluate(async ({ webContents }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    await site.executeJavaScript("const a=document.createElement('a');a.href='app://browser/index.html';document.body.append(a);a.click()");
  });
  await expect(ui.getByRole('alert')).toContainText('POLICY_BLOCKED');
  await ui.getByRole('button', { name: 'Test sayfasını aç', exact: true }).click();
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  await ui.evaluate(async () => {
    const state = await window.browser.getState();
    if (state.ok) await window.browser.navigate(state.data.activeTabId!, new URL('/redirect', state.data.fixtureUrl).href);
  });
  await expect(ui.getByTestId('page-title')).toHaveText('İkinci sayfa');
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  await ui.evaluate(async () => {
    const state = await window.browser.getState();
    if (state.ok) await window.browser.navigate(state.data.activeTabId!, new URL('/redirect-invalid', state.data.fixtureUrl).href);
  });
  await expect(ui.getByTestId('page-status')).toHaveText('Hata');
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('B06: HTTP errors remain visible; next navigation recovers in the same active tab', async () => {
  await openFixture();
  const ids = await ui.evaluate(async () => {
    const initial = await window.browser.getState();
    if (!initial.ok) throw new Error('Missing state');
    const id = initial.data.activeTabId!;
    await window.browser.navigate(id, new URL('/error', initial.data.fixtureUrl).href);
    return { id, fixtureUrl: initial.data.fixtureUrl };
  });
  await expect(ui.getByRole('alert')).toContainText('HTTP_503');
  await expect(ui.getByTestId('page-status')).toHaveText('Hata');
  await ui.getByRole('button', { name: 'Test sayfasını aç', exact: true }).click();
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  const finalState = await ui.evaluate(() => window.browser.getState());
  expect(finalState.ok && finalState.data.activeTabId).toBe(ids.id);
  expect(finalState.ok && finalState.data.tabs.length).toBe(1);
});

test('B06: closing own window destroys site contents and exits app', async () => {
  await openFixture();
  const processHandle = application.process();
  const destroyed = await application.evaluate(async ({ webContents, BrowserWindow }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    const win = BrowserWindow.getAllWindows()[0]!;
    // A test-only sentinel keeps the main process alive to observe asynchronous
    // WebContents destruction independently of app.quit() killing everything.
    new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Site did not close')), 3000);
      site.once('destroyed', () => { clearTimeout(timeout); resolve(); });
      win.close();
    });
    return site.isDestroyed();
  });
  expect(destroyed).toBe(true);
  await application.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.close();
  }).catch((error: Error) => {
    if (!/closed|destroyed|Target/.test(error.message)) throw error;
  });
  await expect.poll(() => processHandle.exitCode).toBe(0);
});

for (const scale of [1.25, 1.5]) {
  test(`B02: Chromium DIP geometry under scale=${scale}`, async () => {
    await openFixture();
    const geometry = await application.evaluate(({ BrowserWindow, WebContentsView }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const site = win.contentView.children.find((child) => child instanceof WebContentsView && child.webContents.id !== win.webContents.id)!;
      return { content: win.getContentBounds(), view: site.getBounds() };
    });
    const dom = await ui.evaluate(() => ({ rect: document.querySelector('.site-area')!.getBoundingClientRect().toJSON(), dpr: devicePixelRatio }));
    expect(dom.dpr).toBeCloseTo(scale, 1);
    expect(geometry.view.y).toBe(LAYOUT.toolbarHeight);
    expect(geometry.view.width).toBe(geometry.content.width - LAYOUT.infoPanelWidth);
    expect(geometry.view.height).toBe(geometry.content.height - LAYOUT.toolbarHeight);
    expect(Math.abs(dom.rect.width - geometry.view.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(dom.rect.y - geometry.view.y)).toBeLessThanOrEqual(1);
  });
}
