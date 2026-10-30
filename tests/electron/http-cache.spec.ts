import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import {resolve} from 'node:path';

let application:ElectronApplication|undefined,ui:Page,server:Server,origin:string;
let assetRequests=0;
const runtimeErrors:string[]=[];
test.beforeAll(async()=>{
  server=createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self';object-src 'none'");
    if(req.url==='/asset.js'){
      assetRequests++;
      res.setHeader('Content-Type','text/javascript');
      res.setHeader('Cache-Control','public,max-age=3600');
      res.end('window.cacheFixtureReady=true;\n'+'/*fixed-cache-resource*/'.repeat(4096));
    }else{
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('Cache-Control','no-store');
      res.end('<!doctype html><title>HTTP cache fixture</title><script src="/asset.js"></script><h1>Fixed content</h1>');
    }
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async()=>{
  if(application)await application.close();
  if(server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
  expect(runtimeErrors).toEqual([]);
});
async function launch(){
  const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  application=await electron.launch({args:[resolve('.')],cwd:resolve('.'),env,chromiumSandbox:true});
  application.process().stderr?.on('data',(data:Buffer)=>{if(/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(data.toString()))runtimeErrors.push('runtime-error');});
  ui=await application.firstWindow();
  await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
  // Legacy control tests explicitly open the now-optional information panel.
  await ui.getByRole('button', { name: 'Bilgi paneli', exact: true }).click();
}
async function open(){
  const result=await ui.evaluate(url=>window.browser.openTab(url),origin+'/page');
  if(!result.ok)throw Error('Open failed');
  await expect.poll(()=>ui.evaluate(async id=>{const s=await window.browser.getState();return s.ok?s.data.tabs.find(t=>t.tabId===id)?.status:null;},result.data.tabId)).toBe('ready');
  expect(await application!.evaluate(async({webContents},origin)=>{
    const wc=webContents.getAllWebContents().find(w=>w.getURL()===origin+'/page')!;
    return wc.executeJavaScript('({ready:window.cacheFixtureReady,bridge:typeof window.browser,node:typeof process})');
  },origin)).toEqual({ready:true,bridge:'undefined',node:'undefined'});
  return result.data.tabId;
}
async function metadata(){return application!.evaluate(async({webContents},origin)=>{
  const ses=webContents.getAllWebContents().find(w=>w.getURL()===origin+'/page')!.session;
  return {persistent:ses.isPersistent(),storagePathAbsent:ses.storagePath===null,cacheBytes:await ses.getCacheSize()};
},origin);}
test('HC-01: HTTP resources survive view close, stay identity-isolated, and disappear with app restart',async()=>{
  await launch();
  const first=await open();expect(assetRequests).toBe(1);
  expect(await metadata()).toMatchObject({persistent:false,storagePathAbsent:true});
  expect((await metadata()).cacheBytes).toBeGreaterThan(0);
  await ui.evaluate(id=>window.browser.closeTab(id),first);
  await expect.poll(()=>application!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(0);
  await open();expect(assetRequests).toBe(1); // actual server hit count, fresh view
  await ui.getByLabel('Test kullanıcısı').selectOption('test-b');
  await open();expect(assetRequests).toBe(2); // B cannot reuse A's cached response
  expect(await metadata()).toMatchObject({persistent:false,storagePathAbsent:true});
  await ui.getByLabel('Test kullanıcısı').selectOption('test-a');
  await open();expect(assetRequests).toBe(2); // A's own session remains intact
  await application!.close();application=undefined;
  await launch();
  await open();expect(assetRequests).toBe(3); // no HTTP cache persisted on disk
  expect(await metadata()).toMatchObject({persistent:false,storagePathAbsent:true});
});
