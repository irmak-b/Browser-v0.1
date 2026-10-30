import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let application: ElectronApplication;
let ui: Page;
let errors: string[];
test.beforeEach(async ({}, info) => {
  if (!existsSync(resolve('node_modules/electron/dist/electron.exe'))) throw new Error('Yerel runtime eksik; indirme yapılmadı.');
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string,string] => e[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  const scale = /scale=(1\.25|1\.5)/.exec(info.title)?.[1];
  application = await electron.launch({ args: [...(scale ? [`--force-device-scale-factor=${scale}`] : []), resolve('.')], env, chromiumSandbox: true });
  errors = [];
  application.process().stderr?.on('data', (chunk: Buffer) => {
    if (/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString())) errors.push(chunk.toString());
  });
  ui = await application.firstWindow();
  await expect(ui.getByText('Browser Core bağlı', { exact: true })).toBeVisible();
  // Legacy control tests explicitly open the now-optional information panel.
  await ui.getByRole('button', { name: 'Bilgi paneli', exact: true }).click();
});
test.afterEach(async () => { if (application) await application.close(); expect(errors ?? []).toEqual([]); });
async function state(): Promise<BrowserSnapshot> {
  return ui.evaluate(async () => { const r = await window.browser.getState(); if (!r.ok) throw new Error(); return r.data; });
}
async function navigate(path: string) {
  await ui.evaluate(async (path) => {
    const s = await window.browser.getState(); if (!s.ok) throw new Error();
    await window.browser.navigate(s.data.activeTabId!, new URL(path, s.data.fixtureUrl).href);
  }, path);
}
async function ready() { await expect(ui.getByTestId('page-status')).toHaveText('Hazır'); await expect(ui.getByRole('button', {name:'Yenile', exact:true})).toBeVisible(); }

test('loading regression: hash navigation from address bar returns to reload without a new document load', async () => {
  await navigate('/page/1'); await ready();
  await navigate('/page/1#fragment'); await ready();
  expect((await state()).tabs[0]!.url).toMatch(/#fragment$/);
});

test('loading regression: SPA changes URL before load completion and still becomes ready', async () => {
  await navigate('/load-hash'); await ready();
  await expect(ui.getByTestId('page-title')).toHaveText('SPA yükleme denemesi');
  expect((await state()).tabs[0]!.url).toMatch(/\/load-hash#ready$/);
});

async function historyCount(count: number) {
  await expect.poll(async () => { const s = await state(); return s.history.pendingCount === 0 ? s.history.entries.length : -1; }).toBe(count);
}

test('B25/B27: a real main-frame finish records once and late title updates keep the same eventId', async () => {
  await navigate('/late-title'); await ready(); await historyCount(1);
  const id = (await state()).history.entries[0]!.eventId;
  await expect.poll(async () => (await state()).history.entries[0]?.title).toBe('Eski sayfa başlığı');
  expect((await state()).history.entries[0]!.eventId).toBe(id);
  await application.evaluate(({webContents}) => {
    const site = webContents.getAllWebContents().find(w => w.getURL().startsWith('http://127.0.0.1:'))!;
    site.emit('did-finish-load'); site.emit('did-stop-loading');
  });
  await historyCount(1);
  expect((await state()).history.entries[0]!.developmentFixture).toBe(true);
});

test('HS-01: duplicate titles do no history work; finish-first and hash title changes keep the same visit', async () => {
  await navigate('/page/1');await ready();await historyCount(1);
  const initial=await state(),eventId=initial.history.entries[0]!.eventId;
  const duplicates=async(acrossTurns:boolean)=>application.evaluate(async({BrowserWindow,webContents},acrossTurns)=>{
    const win=BrowserWindow.getAllWindows()[0]!,ui=win.webContents;
    const site=webContents.getAllWebContents().find(w=>w!==ui&&w.getURL().startsWith('http://127.0.0.1:'))!;
    await new Promise<void>(r=>setImmediate(r));
    const original=ui.send.bind(ui);let messages=0;
    ui.send=(channel,...args)=>{if(channel==='browser:state-changed')messages++;return original(channel,...args);};
    try{
      for(let i=0;i<100;i++){site.emit('page-title-updated');if(acrossTurns)await new Promise<void>(r=>setImmediate(r));}
      await new Promise<void>(r=>setImmediate(r));await new Promise<void>(r=>setImmediate(r));
      return messages;
    }finally{ui.send=original;}
  },acrossTurns);
  const normalMessages=await duplicates(true);
  await ui.evaluate(()=>window.browser.setDevelopmentHistoryMode('offline'));
  await duplicates(false);const offline=await state();
  console.log('TITLE_HISTORY_OBSERVATION '+JSON.stringify({version:offline.appVersion,normalDuplicateEvents:100,normalStateMessages:normalMessages,offlineDuplicateEvents:100,offlinePending:offline.history.pendingCount,offlineDropped:offline.history.droppedCount,offlineStatus:offline.history.status}));
  expect(normalMessages).toBe(0);expect(offline.history.pendingCount).toBe(0);expect(offline.history.droppedCount).toBe(0);
  // Main's temporary loading title must not turn an unchanged hash navigation
  // into a metadata write. Compare against the retained real page title.
  await navigate('/page/1#unchanged');await ready();
  expect((await state()).history.pendingCount).toBe(0);
  expect((await state()).history.entries[0]!.eventId).toBe(eventId);
  await application.evaluate(async({webContents})=>{
    const site=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'))!;
    await site.executeJavaScript("document.title='Real changed title';void 0");
  });
  await expect.poll(async()=>(await state()).history.status).toBe('offline');
  expect((await state()).history.pendingCount).toBe(1);
  expect((await state()).history.entries[0]!.eventId).toBe(eventId);
  expect((await state()).history.entries[0]!.title).toBe(initial.history.entries[0]!.title);
  await duplicates(false);expect((await state()).history.pendingCount).toBe(1);expect((await state()).history.droppedCount).toBe(0);
  await ui.evaluate(()=>window.browser.setDevelopmentHistoryMode('normal'));await historyCount(1);
  expect((await state()).history.entries[0]).toMatchObject({eventId,title:'Real changed title'});
  // Real DOM change, but deliberately deliver finish before the title handler.
  // A title-only equality shortcut would lose this history update.
  await application.evaluate(async({webContents})=>{
    const site=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'))!;
    site.prependOnceListener('page-title-updated',()=>{site.emit('did-finish-load');site.emit('did-stop-loading');});
    await site.executeJavaScript("document.title='Finish first title';void 0");
  });
  await expect.poll(async()=>(await state()).history.entries[0]?.title).toBe('Finish first title');
  expect((await state()).history.entries[0]!.eventId).toBe(eventId);
  await application.evaluate(async({webContents})=>{
    const site=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'))!;
    await site.executeJavaScript("addEventListener('hashchange',()=>document.title='Hash title');void 0");
  });
  await navigate('/page/1#title');await ready();
  await expect.poll(async()=>(await state()).history.entries[0]?.title).toBe('Hash title');
  expect((await state()).history.entries).toHaveLength(1);
  expect((await state()).history.entries[0]!.eventId).toBe(eventId);
});

test('B26: redirect final and main frame count once; failure, stop, download and closed work do not count', async () => {
  expect((await state()).history.entries).toEqual([]);
  await navigate('/redirect'); await ready(); await historyCount(1);
  expect((await state()).history.entries[0]!.url).toMatch(/\/second$/);
  await navigate('/frames'); await ready(); await historyCount(2);
  expect((await state()).history.entries[0]!.url).toMatch(/\/frames$/);
  await navigate('/error'); await expect(ui.getByTestId('page-status')).toHaveText('Hata'); await historyCount(2);
  await navigate('/slow');
  await ui.getByRole('button', {name:'Durdur',exact:true}).click();
  await expect(ui.getByTestId('page-status')).toHaveText('Durduruldu'); await historyCount(2);
  await navigate('/page/1'); await ready(); await historyCount(3);
  await navigate('/download');
  await expect.poll(async () => (await state()).downloads[0]?.status).toBe('awaiting-approval');
  await ready(); await historyCount(3);
  await ui.evaluate(async () => {
    const s=await window.browser.getState(); if(!s.ok)throw new Error();
    const opened=await window.browser.openTab(new URL('/slow',s.data.fixtureUrl).href);
    if(opened.ok) await window.browser.closeTab(opened.data.tabId);
  });
  await ui.waitForTimeout(1100); await historyCount(3);
});

test('B28: SPA/hash does not add visits; back/forward/reload each record their own completed navigation', async () => {
  await navigate('/page/1?private=hidden'); await ready(); await historyCount(1);
  expect((await state()).history.entries[0]!.url).toMatch(/\/page\/1$/);
  await navigate('/page/1?private=hidden#hash'); await ready(); await historyCount(1);
  await navigate('/second'); await ready(); await historyCount(2);
  await ui.getByRole('button', {name:'Geri',exact:true}).click(); await ready(); await historyCount(3);
  expect((await state()).history.entries[0]!.source).toBe('back');
  await ui.getByRole('button', {name:'İleri',exact:true}).click(); await ready(); await historyCount(4);
  expect((await state()).history.entries[0]!.source).toBe('forward');
  await ui.getByRole('button', {name:'Yenile',exact:true}).click(); await ready(); await historyCount(5);
  expect((await state()).history.entries[0]!.source).toBe('reload');
});

test('B29/B30: failed development service never blocks navigation; retry saves each event once to memory', async () => {
  for (const mode of ['offline','timeout','unauthorized','forbidden'] as const) {
    await ui.evaluate(mode => window.browser.setDevelopmentHistoryMode(mode),mode);
    await navigate(`/page/${mode === 'offline' ? '1' : mode === 'timeout' ? '2' : mode === 'unauthorized' ? '3' : '4'}`); await ready();
    await expect.poll(async () => (await state()).history.status).toBe(mode);
    const before = await state();
    expect(before.history.pendingCount).toBeGreaterThan(0);
    await ui.evaluate(() => window.browser.setDevelopmentHistoryMode('normal'));
    await expect.poll(async () => (await state()).history.pendingCount).toBe(0);
    expect((await state()).history.entries.length).toBe(before.history.entries.length+1);
    await ui.evaluate(() => window.browser.retryHistory());
    await expect.poll(async () => (await state()).history.pendingCount).toBe(0);
    expect(new Set((await state()).history.entries.map(v=>v.eventId)).size).toBe((await state()).history.entries.length);
  }
  expect(await ui.evaluate(() => window.browser.setDevelopmentHistoryMode('invented-endpoint' as never))).toMatchObject({ok:false,errorCode:'INVALID_INPUT'});
});

test('B16/B30: pending A history is discarded on switch; B history never receives its late completion', async () => {
  await ui.evaluate(() => window.browser.setDevelopmentHistoryMode('timeout'));
  await navigate('/page/1'); await ready();
  await expect.poll(async () => (await state()).history.pendingCount).toBeGreaterThan(0);
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-b'));
  expect((await state()).history.entries).toEqual([]);
  await navigate('/page/2'); await ready(); await historyCount(1);
  await ui.waitForTimeout(1700);
  expect((await state()).history.entries[0]!.title).toBe('Sayfa 2');
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-a'));
  expect((await state()).history.entries).toEqual([]);
});

test('B23 development integration: UI reload restores main history; A/B completed lists remain separate', async () => {
  await navigate('/page/1'); await ready(); await historyCount(1);
  const id=(await state()).history.entries[0]!.eventId;
  for(let i=0;i<3;i++){await ui.reload(); await ready(); await historyCount(1);}
  expect((await state()).history.entries[0]!.eventId).toBe(id);
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-b'));
  expect((await state()).history.entries).toEqual([]);
  await navigate('/page/2'); await ready(); await historyCount(1);
  await ui.evaluate(() => window.browser.switchDevelopmentIdentity('test-a'));
  expect((await state()).history.entries.map(v=>v.eventId)).toEqual([id]);
  expect(JSON.stringify((await state()).history)).not.toContain('profileKey');
});

for (const scale of ['1.25','1.5']) test(`B24 development viewport/modal retains page and history under scale=${scale}`, async () => {
  await navigate('/page/1'); await ready(); await historyCount(1);
  const id=(await state()).history.entries[0]!.eventId;
  await ui.getByRole('button',{name:'Geliştirme bilgisi'}).click();
  expect(await application.evaluate(({BrowserWindow,WebContentsView})=>{
    const win=BrowserWindow.getAllWindows()[0]!;
    return win.contentView.children.filter(v=>v instanceof WebContentsView && v.webContents.id!==win.webContents.id).every(v=>!v.getVisible());
  })).toBe(true);
  await ui.getByRole('button',{name:'Sayfaya dön'}).click();
  await expect(ui.getByRole('button',{name:'Geliştirme bilgisi'})).toBeFocused();
  await ready(); await historyCount(1); expect((await state()).history.entries[0]!.eventId).toBe(id);
});
