import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let application: ElectronApplication;
let ui: Page;
let errors: string[];
let tls: Server;
let tlsUrl: string;
test.beforeAll(async()=>{
  const pem=JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-File',resolve('scripts/create-test-certificate.ps1')],{encoding:'utf8'})) as {cert:string;key:string};
  tls=createServer(pem,(_req,res)=>{res.end('<title>Must not be trusted</title>');});
  await new Promise<void>((resolve,reject)=>{tls.once('error',reject);tls.listen(0,'127.0.0.1',()=>resolve());});
  tlsUrl=`https://127.0.0.1:${(tls.address() as AddressInfo).port}/`;
});
test.afterAll(async()=>{tls?.closeAllConnections();await new Promise<void>(resolve=>tls?tls.close(()=>resolve()):resolve());});
test.beforeEach(async()=>{
  if(!existsSync(resolve('node_modules/electron/dist/electron.exe')))throw new Error('Local runtime missing; no download');
  const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  application=await electron.launch({args:[resolve('.')],env,chromiumSandbox:true});
  errors=[];
  application.process().stderr?.on('data',(chunk:Buffer)=>{if(/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString()))errors.push(chunk.toString());});
  ui=await application.firstWindow();await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
});
test.afterEach(async()=>{if(application)await application.close();expect(errors??[]).toEqual([]);});
async function state():Promise<BrowserSnapshot>{return ui.evaluate(async()=>{const r=await window.browser.getState();if(!r.ok)throw new Error();return r.data;});}
async function navigate(path:string){await ui.evaluate(async(path)=>{const s=await window.browser.getState();if(s.ok)await window.browser.navigate(s.data.activeTabId!,new URL(path,s.data.fixtureUrl).href);},path);}
async function ready(){await expect(ui.getByTestId('page-status')).toHaveText('Hazır');}

test('B35: dropped local network response and invalid input show errors; next page still loads',async()=>{
  await navigate('/disconnect');await expect(ui.getByTestId('page-status')).toHaveText('Hata');
  await expect(ui.getByRole('alert')).toContainText('Sayfa yüklenemedi');
  const address=ui.getByRole('textbox',{name:'Sayfa adresi'});
  await address.fill('javascript:alert(1)');await ui.getByRole('button',{name:'Adrese git',exact:true}).click();
  await expect(ui.getByRole('alert')).toContainText('protokole izin verilmiyor');
  await navigate('/page/1');await ready();
});

test('B05/B35: locally generated untrusted TLS is rejected without bypass or HTTP downgrade',async()=>{
  await ui.evaluate(async(url)=>{const s=await window.browser.getState();if(s.ok)await window.browser.navigate(s.data.activeTabId!,url);},tlsUrl);
  await expect(ui.getByTestId('page-status')).toHaveText('Hata');
  const current=(await state()).tabs[0]!;
  expect(current.url).toBe(tlsUrl);expect(current.errorCode).toMatch(/NET_|LOAD_FAILED/);
  expect((await state()).history.entries).toEqual([]);
  await navigate('/page/1');await ready();
});

test('B36: a real site renderer crash leaves UI alive and allows reload/new tab recovery',async()=>{
  await navigate('/page/1');await ready();
  await application.evaluate(({webContents})=>{webContents.getAllWebContents().find(w=>w.getURL().endsWith('/page/1'))!.forcefullyCrashRenderer();});
  await expect(ui.getByRole('alert')).toContainText('RENDER_PROCESS_GONE');
  await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
  await ui.getByRole('button',{name:'Yenile',exact:true}).click();await ready();
  await ui.getByRole('button',{name:'Yeni sekme',exact:true}).click();
  expect((await state()).tabs).toHaveLength(2);
  await navigate('/page/2');await ready();
});

test('B36: unresponsive/responsive event policy preserves ownership and recovers without killing a process',async()=>{
  await navigate('/page/1');await ready();
  await application.evaluate(({webContents})=>{webContents.getAllWebContents().find(w=>w.getURL().endsWith('/page/1'))!.emit('unresponsive');});
  await expect(ui.getByRole('alert')).toContainText('Sayfa yanıt vermiyor');
  await application.evaluate(({webContents})=>{webContents.getAllWebContents().find(w=>w.getURL().endsWith('/page/1'))!.emit('responsive');});
  await ready();await expect(ui.getByTestId('policy-notice')).toContainText('yeniden yanıt veriyor');
});

test('B37: repeated own tab lifecycles return to one site view and leave no retained event listeners',async()=>{
  await navigate('/page/1');await ready();
  await application.evaluate(()=>{(globalThis as {closedSites?:Electron.WebContents[]}).closedSites=[];});
  for(let i=0;i<12;i++){
    const opened=await ui.evaluate(async()=>{const s=await window.browser.getState();if(!s.ok)throw new Error();return window.browser.openTab(new URL('/second',s.data.fixtureUrl).href);});
    if(!opened.ok)throw new Error('Open failed');
    await expect(ui.getByTestId('page-title')).toHaveText('İkinci sayfa');await ready();
    expect((await ui.evaluate(id=>window.browser.openFind(id),opened.data.tabId)).ok).toBe(true);
    expect((await ui.evaluate(id=>window.browser.findInPage(id,'sayfa','new'),opened.data.tabId)).ok).toBe(true);
    await application.evaluate(({webContents})=>{(globalThis as {closedSites?:Electron.WebContents[]}).closedSites!.push(webContents.getAllWebContents().find(w=>w.getURL().endsWith('/second'))!);});
    await ui.evaluate(id=>window.browser.closeTab(id),opened.data.tabId);
  }
  expect((await state()).tabs).toHaveLength(1);
  const counts=await application.evaluate(({BrowserWindow,WebContentsView,webContents})=>{
    const win=BrowserWindow.getAllWindows()[0]!;
    const refs=(globalThis as {closedSites?:Electron.WebContents[]}).closedSites!;
    const events=['did-start-navigation','page-title-updated','before-input-event','before-mouse-event','unresponsive','responsive','zoom-changed','found-in-page','context-menu','audio-state-changed','will-prevent-unload'];
    return {views:win.contentView.children.filter(v=>v instanceof WebContentsView&&v.webContents.id!==win.webContents.id).length,contents:webContents.getAllWebContents().length,destroyed:refs.every(w=>w.isDestroyed()),listeners:refs.reduce((sum,w)=>sum+events.reduce((n,event)=>n+w.listenerCount(event),0),0)};
  });
  expect(counts).toEqual({views:1,contents:2,destroyed:true,listeners:0});
});
