import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
let application: ElectronApplication, ui: Page, server: Server, origin: string;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url?.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'self';script-src 'self';worker-src 'self'");
    if (req.url === '/sw.js') res.end("self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>e.waitUntil(new Promise(()=>{}))); ");
    else if (req.url === '/page.js') res.end("window.fixtureReady=navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(async reg=>{reg.active.postMessage('hold');await caches.open('fixture-kept');localStorage.setItem('fixture','kept');document.cookie='fixture=kept;path=/';return true});");
    else res.end('<!doctype html><title>Worker fixture</title><h1>Worker fixture</h1><script src="/page.js"></script>');
  });
  await new Promise<void>(done => server.listen(0,'127.0.0.1',done)); origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string,string] => e[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  application = await electron.launch({ args:[resolve('.')], cwd:resolve('.'), env, chromiumSandbox:true });
  ui=await application.firstWindow(); await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
});
test.afterAll(async()=>{ if(application)await application.close(); if(server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));} });
const resources=()=>ui.evaluate(async()=>{const r=await window.browser.getResources();if(!r.ok)throw Error();return r.data;});
async function open(){
  const r=await ui.evaluate(origin=>window.browser.openTab(origin),origin);if(!r.ok)throw Error();
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  await application.evaluate(async({webContents},origin)=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin))!;(globalThis as any).workerSession=w.session;await w.executeJavaScript('window.fixtureReady');},origin);
  await expect.poll(async()=>(await resources()).backgroundWorkers?.at(-1)?.running).toBe(1);
  return r.data.tabId;
}
const close=(id:string)=>ui.evaluate(id=>window.browser.closeTab(id),id);

test('IW-01: idle workers stop without unregistering/data loss; reopen cancels cleanup; explicit notification grant preserves background execution until reset',async()=>{
  let id=await open();await close(id);
  await expect.poll(async()=>(await resources()).backgroundWorkers?.[0],{timeout:10000}).toEqual({status:'stopped',running:0});
  expect(await application.evaluate(({webContents,BrowserWindow})=>({sites:webContents.getAllWebContents().filter(w=>w!==BrowserWindow.getAllWindows()[0]!.webContents).length,views:BrowserWindow.getAllWindows()[0]!.contentView.children.length}))).toEqual({sites:0,views:0});
  id=await open();
  expect(await application.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin))!.executeJavaScript("Promise.all([navigator.serviceWorker.getRegistrations().then(v=>v.length),caches.has('fixture-kept'),Promise.resolve(localStorage.getItem('fixture')),Promise.resolve(document.cookie.includes('fixture=kept'))])"),origin)).toEqual([1,true,'kept',true]);
  await application.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin))!.executeJavaScript('window.onbeforeunload=()=>false;void 0'),origin);
  try { expect(await close(id)).toMatchObject({ok:false,errorCode:'OPERATION_CANCELLED'}); expect((await resources()).backgroundWorkers?.[0]?.running).toBe(1); }
  finally { await application.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin))!.executeJavaScript('window.onbeforeunload=null;void 0'),origin); }
  await close(id);id=await open(); // cancel the scheduled job before it starts
  await new Promise(done=>setTimeout(done,1500));expect((await resources()).backgroundWorkers?.[0]?.running).toBe(1);
  await application.evaluate(({dialog,BrowserWindow})=>{BrowserWindow.getAllWindows()[0]!.focus();dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  expect(await application.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin))!.executeJavaScript('Notification.requestPermission()'),origin)).toBe('granted');
  await close(id);
  await expect.poll(async()=>(await resources()).backgroundWorkers?.[0]).toEqual({status:'kept-permission',running:1});
  id=await open();await ui.evaluate(id=>window.browser.resetSitePermissions(id),id);await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  await close(id);
  await expect.poll(async()=>(await resources()).backgroundWorkers?.[0],{timeout:10000}).toEqual({status:'stopped',running:0});
  // A grant that kept an already-closed page alive must also be revoked when
  // switching user with no live site view (there is no new close transition).
  id=await open();
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.focus());
  expect(await application.evaluate(async({webContents},origin)=>webContents.getAllWebContents().find(w=>w.getURL().startsWith(origin))!.executeJavaScript('Notification.requestPermission()'),origin)).toBe('granted');
  await close(id); await expect.poll(async()=>(await resources()).backgroundWorkers?.[0]?.status).toBe('kept-permission');
  await ui.evaluate(()=>window.browser.switchDevelopmentIdentity('test-b'));
  id=await open();
  await expect.poll(async()=>(await resources()).backgroundWorkers?.[0]?.running,{timeout:10000}).toBe(0);
  expect((await resources()).backgroundWorkers?.[1]?.running).toBe(1); // A cleanup must not stop B's worker
  await close(id);
  await expect.poll(async()=>(await resources()).backgroundWorkers?.reduce((sum,w)=>sum+w.running,0),{timeout:10000}).toBe(0);
});
