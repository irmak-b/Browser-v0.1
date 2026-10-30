import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
let app: ElectronApplication, ui: Page;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  // Synthetic devices only; do not use fake-ui (that would bypass permission).
  app = await electron.launch({ args: [resolve('tests/fixtures/permission-control.cjs'), '--use-fake-device-for-media-stream'], cwd: resolve('.'), env, chromiumSandbox: true });
  ui = await app.firstWindow(); await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
});
test.afterAll(async () => { if (app) await app.close(); });
const state = () => ui.evaluate(async () => { const r = await window.browser.getState(); if (!r.ok) throw Error(); return r.data; });
async function page(path = '/session') {
  await ui.evaluate(async path => { const s = await window.browser.getState(); if (s.ok) await window.browser.navigate(s.data.activeTabId!, new URL(path, s.data.fixtureUrl).href); }, path);
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
}
async function prepare(deferred = false, response = 0) {
  await app.evaluate(({ dialog, BrowserWindow }, { deferred, response }) => {
    const g = globalThis as any; g.permissionBoxes = []; g.permissionResult = undefined;
    BrowserWindow.getAllWindows()[0]!.focus();
    dialog.showMessageBox = async (parentOrOptions: Electron.BaseWindow|Electron.MessageBoxOptions, supplied?: Electron.MessageBoxOptions) => {
      const options = supplied ?? parentOrOptions as Electron.MessageBoxOptions;
      g.permissionBoxes.push(options);
      return deferred ? await new Promise<Electron.MessageBoxReturnValue>(done => { g.permissionAnswer = done; }) : { response, checkboxChecked: false };
    };
  }, { deferred, response });
}
async function request(permission = 'media', types = ['video'], isMainFrame = true) {
  await app.evaluate(({ webContents, BrowserWindow }, { permission, types, isMainFrame }) => {
    const g = globalThis as any, w = webContents.getAllWebContents().find(w => w.getURL().startsWith('http://127.0.0.1:'))!;
    BrowserWindow.getAllWindows()[0]!.focus(); w.focus(); g.permissionOwner = w;
    g.permissionTestHandlers.get(w.session).Request(w, permission, (allowed: boolean) => { g.permissionResult = allowed; },
      { isMainFrame, requestingUrl: w.getURL(), mediaTypes: types, securityOrigin: new URL(w.getURL()).origin });
  }, { permission, types, isMainFrame });
}
const result = () => app.evaluate(() => (globalThis as any).permissionResult);
const answer = (response: number) => app.evaluate((_electron,response) => { (globalThis as any).permissionAnswer({ response, checkboxChecked: false }); }, response);

test('PI-01: no grant before user choice; exact camera approval, microphone denial and reset/reload use real app routing without devices', async () => {
  await page('/session?must-not-appear=1'); await prepare(true); await request();
  expect(await result()).toBeUndefined(); expect((await state()).sitePermissions?.decisions).toEqual([]);
  const box = await app.evaluate(({ BrowserWindow }) => { const o = (globalThis as any).permissionBoxes[0]; return { message: o.message, buttons: o.buttons, defaultId: o.defaultId,
    hidden: BrowserWindow.getAllWindows()[0]!.contentView.children.every(v => !v.getVisible()) }; });
  expect(box.buttons).toEqual(['Engelle','İzin ver']); expect(box.defaultId).toBe(0); expect(box.hidden).toBe(true); expect(box.message).not.toContain('must-not-appear');
  await answer(1); await expect.poll(result).toBe(true);
  expect((await state()).sitePermissions?.decisions).toEqual([{ permission: 'camera', state: 'allowed' }]);
  expect(await app.evaluate(() => { const g = globalThis as any, w = g.permissionOwner, h = g.permissionTestHandlers.get(w.session).Check, origin = new URL(w.getURL()).origin;
    return ['video','audio'].map(mediaType => h(w,'media',origin,{isMainFrame:true,requestingUrl:w.getURL(),mediaType})); })).toEqual([true,false]);
  await prepare(false,0); await request('media',['audio']); await expect.poll(result).toBe(false);
  await expect(ui.getByRole('region', { name: 'Site izinleri' })).toContainText('Mikrofon: Engellendi');
  await ui.getByRole('button', { name: 'İzinleri sıfırla ve yenile' }).click();
  await expect.poll(async () => (await state()).sitePermissions?.decisions.length).toBe(0); await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
});

test('PI-02: navigation/context change abort native prompt; late approval cannot grant; inactive session/null-notification check cannot borrow new user grant', async () => {
  await page(); await prepare(true); await request('notifications',[]);
  await app.evaluate(() => { const g = globalThis as any; g.oldPermissionCheck = g.permissionTestHandlers.get(g.permissionOwner.session).Check; });
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-b'));
  await expect.poll(result).toBe(false); await answer(1);
  expect((await state()).sitePermissions).toBeNull();
  await page(); await prepare(false,1); await request('notifications',[]); await expect.poll(result).toBe(true);
  expect(await app.evaluate(() => { const g = globalThis as any, w = g.permissionOwner; return g.oldPermissionCheck(null,'notifications',new URL(w.getURL()).origin,{}); })).toBe(false);
  await prepare(true); await request('media',['audio']); await page('/session?new-document=1');
  await expect.poll(result).toBe(false); await answer(1);
  expect((await state()).sitePermissions?.decisions.some(d => d.permission === 'microphone')).toBe(false);
});

test('PI-03: real geolocation/notification APIs respect user denial; iframe/background/unknown permissions never prompt', async () => {
  await page(); await ui.evaluate(async () => { const s = await window.browser.getState(); if (s.ok) await window.browser.resetSitePermissions(s.data.activeTabId!); });
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır'); await prepare(false,0);
  expect(await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().startsWith('http://127.0.0.1:'))!.executeJavaScript("new Promise(done=>navigator.geolocation.getCurrentPosition(()=>done(0),e=>done(e.code)))"))).toBe(1);
  await expect.poll(async () => (await state()).sitePermissions?.decisions).toContainEqual({ permission: 'location', state: 'blocked' });
  expect(await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().startsWith('http://127.0.0.1:'))!.executeJavaScript('Notification.requestPermission()'))).toBe('denied');
  await prepare(); await request('media',['video'],false); expect(await result()).toBe(false);
  expect(await app.evaluate(() => (globalThis as any).permissionBoxes.length)).toBe(0);
  await request('usb'); expect(await result()).toBe(false);
  await ui.evaluate(() => window.browser.openTab()); await prepare(); await request(); expect(await result()).toBe(false);
  expect(await app.evaluate(() => (globalThis as any).permissionBoxes.length)).toBe(0);
});

test('PI-04: real getUserMedia uses only synthetic camera/microphone; explicit user choice is required for each type', async () => {
  await page(); await ui.evaluate(async () => { const s = await window.browser.getState(); if (s.ok) await window.browser.resetSitePermissions(s.data.activeTabId!); });
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır'); await prepare(false,1);
  const capture = async (kind: 'video'|'audio') => app.evaluate(async ({ webContents }, kind) => {
    const w = webContents.getAllWebContents().find(w => w.getURL().startsWith('http://127.0.0.1:'))!;
    return w.executeJavaScript(`navigator.mediaDevices.getUserMedia({${kind}:true}).then(stream=>{const result=stream.getTracks().map(track=>track.kind);stream.getTracks().forEach(track=>track.stop());return result}).catch(e=>[e.name])`);
  }, kind);
  expect(await capture('video')).toEqual(['video']); expect(await app.evaluate(() => (globalThis as any).permissionBoxes.length)).toBe(1);
  expect(await capture('audio')).toEqual(['audio']); expect(await app.evaluate(() => (globalThis as any).permissionBoxes.length)).toBe(2);
  expect(await capture('video')).toEqual(['video']); expect(await app.evaluate(() => (globalThis as any).permissionBoxes.length)).toBe(2);
  await ui.getByRole('button', { name: 'İzinleri sıfırla ve yenile' }).click();
  await expect.poll(async () => (await state()).sitePermissions?.decisions.length).toBe(0);
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır'); await prepare(false,0);
  expect(await capture('video')).toEqual(['NotAllowedError']);
  expect(await app.evaluate(() => (globalThis as any).permissionBoxes.length)).toBe(1);
});
