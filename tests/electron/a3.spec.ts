import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let application: ElectronApplication;
let ui: Page;
let runtimeErrors: string[];
let target: string;
test.beforeEach(async ({}, info) => {
  if (!existsSync(resolve('node_modules/electron/dist/electron.exe'))) throw new Error('Yerel Electron eksik; indirme yapılmadı.');
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
  const directory = resolve('.cache/a3-downloads'); mkdirSync(directory, { recursive: true });
  target = resolve(directory, `${info.testId.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.txt`);
});
test.afterEach(async () => {
  if (application) {
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
  return ui.evaluate(async () => { const r = await window.browser.getState(); if (!r.ok) throw new Error('State failed'); return r.data; });
}
async function navigate(path: string) {
  await ui.evaluate(async (path) => {
    const r = await window.browser.getState(); if (!r.ok) throw new Error('State failed');
    await window.browser.navigate(r.data.activeTabId!, new URL(path, r.data.fixtureUrl).href);
  }, path);
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
}
async function siteScript(script: string) {
  return application.evaluate(async ({ webContents }, script) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    return site.executeJavaScript(script);
  }, script);
}
async function download(path: string) {
  await application.evaluate(({ webContents }, path) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    site.downloadURL(new URL(path, site.getURL()).href);
  }, path);
}
async function stubDialog(canceled = false) {
  await application.evaluate(({ dialog }, request) => {
    dialog.showSaveDialog = async () => ({ canceled: request.canceled, filePath: request.target });
  }, { canceled, target });
}
async function approveFirst() {
  await expect.poll(async () => (await state()).downloads[0]?.status).toBe('awaiting-approval');
  return ui.evaluate(async () => { const s = await window.browser.getState(); if (!s.ok) throw new Error(); return window.browser.approveDownload(s.data.downloads[0]!.downloadId); });
}

test('B14/B15/B22: A shares site data across tabs; B cannot see it; A returns with same memory session', async () => {
  await navigate('/session');
  await siteScript("document.getElementById('save-session').click();void 0");
  const first = await application.evaluate(({ webContents }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/session'))!;
    (globalThis as { a3Old?: Electron.WebContents }).a3Old = site;
    (globalThis as { a3Session?: Electron.Session }).a3Session = site.session;
    return site.id;
  });
  await ui.evaluate(async () => { const s = await window.browser.getState(); if (s.ok) await window.browser.openTab(new URL('/session', s.data.fixtureUrl).href); });
  await expect.poll(async () => (await state()).tabs.filter((tab) => tab.status === 'ready').length).toBe(2);
  expect(await application.evaluate(async ({ webContents }, first) => {
    const sites = webContents.getAllWebContents().filter((wc) => wc.getURL().endsWith('/session'));
    return { same: sites[0]!.session === sites[1]!.session, value: await sites.find((wc) => wc.id !== first)!.executeJavaScript("[document.cookie,localStorage.getItem('fixture')]") };
  }, first)).toEqual({ same: true, value: ['fixture=sample', 'sample'] });
  const epoch = (await state()).contextEpoch;
  await ui.getByLabel('Test kullanıcısı').selectOption('test-b');
  await expect.poll(async () => (await state()).developmentIdentity).toBe('test-b');
  expect((await state()).contextEpoch).not.toBe(epoch);
  expect(await application.evaluate(() => {
    const old = (globalThis as { a3Old?: Electron.WebContents }).a3Old!;
    return { destroyed: old.isDestroyed(), title: old.listenerCount('page-title-updated'), mouse: old.listenerCount('before-mouse-event') };
  })).toEqual({ destroyed: true, title: 0, mouse: 0 });
  await navigate('/session');
  expect(await siteScript("[document.cookie,localStorage.getItem('fixture')]")).toEqual(['', null]);
  await ui.getByLabel('Test kullanıcısı').selectOption('test-a');
  await expect.poll(async () => (await state()).developmentIdentity).toBe('test-a');
  await navigate('/session');
  expect(await siteScript("[document.cookie,localStorage.getItem('fixture')]")).toEqual(['fixture=sample', 'sample']);
  expect(await application.evaluate(({ webContents }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/session'))!;
    const same = site.session === (globalThis as { a3Session?: Electron.Session }).a3Session;
    return { same, downloadListeners: site.session.listenerCount('will-download') };
  })).toEqual({ same: true, downloadListeners: 1 });
});

test('B16: context switch rejects arbitrary identities and stale tab commands, ignores delayed loads', async () => {
  await navigate('/session'); const before = await state();
  const invalid = await ui.evaluate(() => window.browser.switchDevelopmentIdentity('persist:foreign' as never));
  expect(invalid).toMatchObject({ ok: false, errorCode: 'INVALID_INPUT' });
  await ui.evaluate(async () => { const s = await window.browser.getState(); if (s.ok) await window.browser.navigate(s.data.activeTabId!, new URL('/slow', s.data.fixtureUrl).href); });
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-b'));
  const after = await state(); expect(after.contextEpoch).not.toBe(before.contextEpoch);
  expect(after.tabs).toHaveLength(1); expect(after.tabs[0]!.status).toBe('empty');
  expect(await ui.evaluate((id) => window.browser.reload(id), before.activeTabId!)).toMatchObject({ ok: false, errorCode: 'TAB_NOT_FOUND' });
  await ui.waitForTimeout(1100);
  expect((await state()).tabs[0]!.status).toBe('empty');
});

test('B16: beforeunload can cancel identity switch without changing session or epoch', async () => {
  await navigate('/session'); const before = await state();
  await siteScript('window.onbeforeunload=()=>false;void 0');
  expect(await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-b'))).toMatchObject({ ok: false, errorCode: 'OPERATION_CANCELLED' });
  expect((await state()).contextEpoch).toBe(before.contextEpoch);
  expect((await state()).developmentIdentity).toBe('test-a');
  expect((await state()).activeTabId).toBe(before.activeTabId);
});

test('B17: DevShell theme changes preserve WebContents, session and DOM without reload', async () => {
  await navigate('/session');
  await siteScript("document.getElementById('save-session').click();window.themeProbe='preserved';void 0");
  const before = await application.evaluate(({ webContents }) => webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/session'))!.id);
  await ui.getByRole('button', { name: 'Tema: Açık' }).click();
  await expect(ui.locator('.shell')).toHaveAttribute('data-theme', 'dark');
  expect(await application.evaluate(async ({ webContents }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/session'))!;
    return { id: site.id, state: await site.executeJavaScript("[window.themeProbe,document.cookie,localStorage.getItem('fixture')]") };
  })).toEqual({ id: before, state: ['preserved', 'fixture=sample', 'sample'] });
});

test('B18: undecided checks do not grant; user denial is respected; display capture has no sources', async () => {
  await navigate('/session');
  await application.evaluate(({ dialog, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.focus();
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  const result = await siteScript(`Promise.all([
    navigator.permissions.query({name:'geolocation'}).then(p=>p.state),
    new Promise(r=>navigator.geolocation.getCurrentPosition(()=>r('allowed'),e=>r(e.code))),
    navigator.mediaDevices.getUserMedia({video:true,audio:true}).then(()=> 'allowed',e=>e.name),
    navigator.mediaDevices.getDisplayMedia({video:true}).then(()=> 'allowed',e=>e.name)
  ])`);
  expect(result[0]).toBe('denied'); expect(result[1]).toBe(1);
  expect(result[2]).not.toBe('allowed'); expect(result[3]).not.toBe('allowed');
  expect(await siteScript("Promise.all(['camera','microphone','notifications'].map(name=>navigator.permissions.query({name}).then(p=>p.state)))")).toEqual(['denied', 'denied', 'denied']);
});

test('B19: a native same-origin popup click opens one controlled tab without a new window', async () => {
  await navigate('/');
  await application.evaluate(async ({ webContents, BrowserWindow }) => {
    const site = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1:'))!;
    const rect = await site.executeJavaScript("(()=>{const a=document.getElementById('popup-link');a.scrollIntoView();const r=a.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    BrowserWindow.getAllWindows()[0]!.focus(); site.focus();
    site.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect });
    site.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect });
  });
  await expect.poll(async () => (await state()).tabs.length).toBe(2);
  await expect.poll(async () => { const s = await state(); return s.tabs.find((tab) => tab.tabId === s.activeTabId)?.url; }).toMatch(/\/popup$/);
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect(await siteScript("window.open('mailto:local@example.invalid')===null")).toBe(true);
  await expect(ui.getByTestId('policy-notice')).toContainText('Popup engellendi');
});

test('B20: no save before size approval; approved local download completes at chosen target', async () => {
  await navigate('/'); await stubDialog();
  await siteScript(`document.querySelector('a[href="/download"]').click();void 0`);
  await expect.poll(async () => (await state()).downloads[0]?.status).toBe('awaiting-approval');
  expect((await state()).downloads[0]!.totalBytes).toBe(4096); expect(existsSync(target)).toBe(false);
  await approveFirst();
  await expect.poll(async () => (await state()).downloads[0]?.status).toBe('completed');
  expect(statSync(target).size).toBe(4096); expect(readFileSync(target).every((byte) => byte === 65)).toBe(true);
  const exposed = JSON.stringify(await state()); expect(exposed).not.toContain(target); expect(exposed).not.toContain('savePath');
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  await expect(ui.getByTestId('page-title')).toHaveText('Browser Core — Test Sayfası');
  await ui.evaluate(async () => {
    const s = await window.browser.getState(); if (s.ok) await window.browser.navigate(s.data.activeTabId!, new URL('/download', s.data.fixtureUrl).href);
  });
  await expect.poll(async () => (await state()).downloads[1]?.status).toBe('awaiting-approval');
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
});

test('DL-04: timed-out retry ticket cannot swallow the next request to the same URL',async()=>{
  await navigate('/');await stubDialog();await download('/download');
  await expect.poll(async()=>(await state()).downloads[0]?.status).toBe('awaiting-approval');
  await application.evaluate(({webContents})=>{
    const site=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'))!;
    (globalThis as any).restoreDownloadProbe=()=>{globalThis.setTimeout=(globalThis as any).downloadOriginalTimeout;site.downloadURL=(globalThis as any).downloadOriginalUrl;};
    (globalThis as any).downloadOriginalTimeout=globalThis.setTimeout;
    (globalThis as any).downloadOriginalUrl=site.downloadURL.bind(site);
    globalThis.setTimeout=((handler: (...args:any[])=>void,ms?:number,...args:any[])=>
      (globalThis as any).downloadOriginalTimeout(handler,ms===15000?40:ms,...args)) as typeof setTimeout;
    site.downloadURL=()=>{}; // Own fixture only: deliberately never deliver retry.
  });
  try{
    await approveFirst();await expect.poll(async()=>(await state()).downloads[0]?.status).toBe('failed');
  }finally{
    await application.evaluate(()=>{(globalThis as any).restoreDownloadProbe();delete (globalThis as any).restoreDownloadProbe;delete (globalThis as any).downloadOriginalTimeout;delete (globalThis as any).downloadOriginalUrl;});
  }
  expect(existsSync(target)).toBe(false);
  await download('/download');
  await expect.poll(async()=>(await state()).downloads.length).toBe(2);
  const result=await state();
  console.log('DOWNLOAD_RETRY_OBSERVATION '+JSON.stringify({version:result.appVersion,rows:result.downloads.length,statuses:result.downloads.map(d=>d.status),fileCreated:existsSync(target)}));
  expect((await state()).downloads.map(d=>d.status)).toEqual(['failed','awaiting-approval']);
});

test('B20: progress and cancellation work on a 128KiB loopback download; cancelled dialog creates no file', async () => {
  await navigate('/'); await stubDialog(true); await download('/download');
  await approveFirst(); await expect.poll(async () => (await state()).downloads[0]?.status).toBe('cancelled');
  expect(existsSync(target)).toBe(false);
  await stubDialog(); await download('/download-slow');
  await expect.poll(async () => (await state()).downloads[1]?.status).toBe('awaiting-approval');
  await ui.evaluate(async () => { const s = await window.browser.getState(); if (s.ok) await window.browser.approveDownload(s.data.downloads[1]!.downloadId); });
  await expect.poll(async () => (await state()).downloads[1]?.receivedBytes ?? 0).toBeGreaterThan(0);
  expect((await state()).downloads[1]!.status).toBe('downloading');
  await ui.evaluate(async () => { const s = await window.browser.getState(); if (s.ok) await window.browser.cancelDownload(s.data.downloads[1]!.downloadId); });
  await expect.poll(async () => (await state()).downloads[1]?.status).toBe('cancelled');
});

test('B16/B20: a pending native destination result cannot start a download in a new context', async () => {
  await navigate('/');
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () => new Promise((resolve) => { (globalThis as { a3Dialog?: (result: Electron.SaveDialogReturnValue) => void }).a3Dialog = resolve; });
  });
  await download('/download');
  await expect.poll(async () => (await state()).downloads[0]?.status).toBe('awaiting-approval');
  await ui.evaluate(async () => {
    const s = await window.browser.getState(); if (!s.ok) throw new Error();
    (window as unknown as { a3Pending: Promise<unknown> }).a3Pending = window.browser.approveDownload(s.data.downloads[0]!.downloadId);
  });
  await expect.poll(async () => (await state()).downloads[0]?.status).toBe('choosing-target');
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-b'));
  await application.evaluate((_electron, target) => {
    (globalThis as { a3Dialog?: (result: Electron.SaveDialogReturnValue) => void }).a3Dialog!({ canceled: false, filePath: target });
  }, target);
  expect(await ui.evaluate(() => (window as unknown as { a3Pending: Promise<unknown> }).a3Pending)).toMatchObject({ ok: false, errorCode: 'OPERATION_CANCELLED' });
  expect((await state()).downloads).toEqual([]); expect(existsSync(target)).toBe(false);
});

test('B20/B22: unknown size is denied; owner closure cancels pending download and session listener stays single', async () => {
  await navigate('/'); await download('/download-unknown');
  await expect(ui.getByTestId('policy-notice')).toContainText('Boyutu bilinmeyen');
  expect((await state()).downloads).toEqual([]);
  await download('/download');
  await expect.poll(async () => (await state()).downloads[0]?.status).toBe('awaiting-approval');
  await application.evaluate(({webContents})=>{
    (globalThis as {downloadSession?:Electron.Session}).downloadSession=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'))!.session;
  });
  await ui.evaluate(async () => { const s = await window.browser.getState(); if (s.ok) await window.browser.closeTab(s.data.activeTabId!); });
  expect((await state()).downloads[0]!.status).toBe('cancelled');
  expect(await application.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    const views = win.contentView.children.filter((view) => view instanceof WebContentsView && view.webContents.id !== win.webContents.id) as Electron.WebContentsView[];
    return { count: views.length, listeners: (globalThis as {downloadSession?:Electron.Session}).downloadSession!.listenerCount('will-download') };
  })).toEqual({ count: 0, listeners: 1 });
  // A lightweight empty tab has no view; navigating it must reuse the session
  // without installing another will-download listener.
  await navigate('/');
  expect(await application.evaluate(({webContents})=>webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'))!.session.listenerCount('will-download'))).toBe(1);
});

test('B16/B20: switching context cancels an active transfer and late progress cannot refill the new list', async () => {
  await navigate('/'); await stubDialog(); await download('/download-slow'); await approveFirst();
  await expect.poll(async () => (await state()).downloads[0]?.receivedBytes ?? 0).toBeGreaterThan(0);
  const old = (await state()).downloads[0]!.downloadId;
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-b'));
  expect((await state()).downloads).toEqual([]);
  expect(await ui.evaluate((id) => window.browser.cancelDownload(id), old)).toMatchObject({ ok: false, errorCode: 'INVALID_INPUT' });
  await ui.waitForTimeout(600);
  expect((await state()).downloads).toEqual([]);
  expect((await state()).developmentIdentity).toBe('test-b');
});
