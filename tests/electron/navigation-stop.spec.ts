import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let app: ElectronApplication, ui: Page, server: Server, origin: string;
const errors: string[] = [];
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'none'" };
    if (req.url?.startsWith('/pending')) {
      const timer = setTimeout(() => { if (!res.destroyed) { res.writeHead(200, headers); res.end('<!doctype html><title>Yavaş hedef</title><p>Tamamlandı</p>'); } }, 3000);
      res.once('close', () => clearTimeout(timer));
    } else if (req.url?.startsWith('/stream')) {
      res.writeHead(200, headers);
      res.write('<!doctype html><html><head><title>Kısmi sayfa</title></head><body><input id="note" value="partial-fixture"><p id="partial">İlk bölüm</p>');
      const timer = setTimeout(() => res.end('</body></html>'), 20000);
      res.once('close', () => clearTimeout(timer));
    } else { res.writeHead(200, headers); res.end('<!doctype html><title>Tamamlanan hedef</title><p>Hazır</p>'); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
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
test.afterAll(async () => { if (app) await app.close(); server?.closeAllConnections(); if (server) await new Promise<void>(done => server.close(() => done())); expect(errors).toEqual([]); });
async function state(): Promise<BrowserSnapshot> {
  return ui.evaluate(async () => { const r = await window.browser.getState(); if (!r.ok) throw Error('State failed'); return r.data; });
}
async function ready(id: string) { await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === id)?.status).toBe('ready'); }
async function nativeId(url: string) { return app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.id, url); }
async function frame(id: number, code: string) { return app.evaluate(({ webContents }, { id, code }) => webContents.fromId(id)!.mainFrame.executeJavaScript(code), { id, code }); }

test('NS-01: stopping before commit restores the old page, metadata, form and original site filter', async () => {
  const s = await state(), id = s.activeTabId!, url = new URL('/page/1', s.fixtureUrl).href;
  await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id, url }); await ready(id);
  const wcId = await nativeId(url);
  await frame(wcId, "document.querySelector('#state-input').value='kept-fixture';window.stopMarker=42;void 0");
  await ui.evaluate(id => window.browser.setAdBlocking(id, false), id);
  const visits = (await state()).history.entries.map(entry => entry.eventId);
  const target = origin.replace('127.0.0.1', 'localhost') + '/pending';
  await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id, url: target });
  await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isLoadingMainFrame(), wcId)).toBe(true);
  expect((await state()).tabs.find(tab => tab.tabId === id)?.url).toBe(target);
  await ui.evaluate(id => window.browser.stop(id), id);
  console.log('STOP_BEFORE_COMMIT ' + JSON.stringify((await state()).tabs.find(tab => tab.tabId === id)));
  expect((await state()).tabs.find(tab => tab.tabId === id)).toMatchObject({ url, title: 'Sayfa 1', status: 'stopped', loading: false, errorCode: null });
  expect((await state()).adBlocking?.enabled).toBe(false);
  expect((await state()).history.entries.map(entry => entry.eventId)).toEqual(visits);
  expect(await frame(wcId, "({marker:window.stopMarker,form:document.querySelector('#state-input').value})")).toEqual({ marker: 42, form: 'kept-fixture' });
  await frame(wcId, "document.title='Durdurma sonrası başlık';void 0");
  await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === id)?.title).toBe('Durdurma sonrası başlık');
  await expect.poll(async () => (await state()).history.entries.find(entry => entry.eventId === visits[0])?.title).toBe('Durdurma sonrası başlık');
  await frame(wcId, "location.hash='still-live';void 0");
  await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === id)?.url).toBe(url + '#still-live');
  expect((await state()).history.entries.map(entry => entry.eventId)).toEqual(visits);
  console.log('STOP_RETAINED ' + JSON.stringify({ sameWebContents: true, formKept: true, metadataAndHashLive: true, siteFilterRestored: true, noExtraVisit: true }));
});

test('NS-02: stopping a first navigation leaves it stopped and reload can complete normally', async () => {
  const id = (await state()).activeTabId!, target = origin + '/pending?first';
  const visits = (await state()).history.entries.map(entry => entry.eventId);
  await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id, url: target });
  const wcId = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getURL() === 'about:blank')!.id);
  await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isLoadingMainFrame(), wcId)).toBe(true);
  await ui.evaluate(id => window.browser.stop(id), id);
  expect((await state()).tabs.find(tab => tab.tabId === id)).toMatchObject({ url: target, status: 'stopped', loading: false, errorCode: null });
  expect((await state()).history.entries.map(entry => entry.eventId)).toEqual(visits);
  await ui.evaluate(id => window.browser.reload(id), id); await ready(id);
  expect((await state()).tabs.find(tab => tab.tabId === id)?.title).toBe('Yavaş hedef');
  expect((await state()).history.entries).toHaveLength(visits.length + 1);
  console.log('STOP_FIRST ' + JSON.stringify({ firstStayedStopped: true, reloadWorks: true, completedVisits: 1 }));
});

test('NS-03: stopping after commit keeps the partial document live without counting an unfinished visit', async () => {
  const id = (await state()).activeTabId!, target = origin + '/stream';
  const visits = (await state()).history.entries.map(entry => entry.eventId);
  await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id, url: target });
  await expect.poll(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(wc => wc.getURL() === url && wc.isLoadingMainFrame()), target)).toBe(true);
  const wcId = await nativeId(target);
  await expect.poll(() => frame(wcId, "document.querySelector('#note')?.value")).toBe('partial-fixture');
  await ui.evaluate(id => window.browser.stop(id), id);
  expect((await state()).tabs.find(tab => tab.tabId === id)).toMatchObject({ url: target, status: 'stopped', loading: false, errorCode: null });
  expect((await state()).history.entries.map(entry => entry.eventId)).toEqual(visits);
  await frame(wcId, "document.title='Kısmi sayfa canlı';window.stopMarker=7;void 0");
  await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === id)?.title).toBe('Kısmi sayfa canlı');
  await frame(wcId, "location.hash='partial';void 0");
  await expect.poll(async () => (await state()).tabs.find(tab => tab.tabId === id)?.url).toBe(target + '#partial');
  expect((await state()).history.entries.map(entry => entry.eventId)).toEqual(visits);
  expect(await frame(wcId, "({marker:window.stopMarker,form:document.querySelector('#note').value})")).toEqual({ marker: 7, form: 'partial-fixture' });
  await ui.evaluate(({ id, url }) => window.browser.navigate(id, url), { id, url: origin + '/complete' }); await ready(id);
  expect((await state()).history.entries).toHaveLength(visits.length + 1);
  console.log('STOP_PARTIAL ' + JSON.stringify({ sameWebContents: true, partialFormKept: true, metadataAndHashLive: true, incompleteVisits: 0, nextNavigationWorks: true }));
});
