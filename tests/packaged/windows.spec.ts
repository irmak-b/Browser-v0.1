import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { once } from 'node:events';
import version from '../../app-version.json';

const directory=resolve('artifacts',`BrowserCore_${version.display}_Windows_x64`);
const executablePath=resolve(directory,'BrowserCore.exe');
let child: ChildProcess;
let browser: Browser;
let ui: Page;
let runtimeErrors: string[];
let mainEndpoint: string;
async function mainEvaluate(expression: string): Promise<unknown> {
  const socket=new WebSocket(mainEndpoint);
  try {
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Main inspector did not respond')),5000);
      socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,includeCommandLineAPI:true,returnByValue:true}}));
      socket.onmessage=event=>{
        const message=JSON.parse(String(event.data));
        if(message.id!==1)return;
        clearTimeout(timer);
        if(message.error||message.result?.exceptionDetails)reject(new Error('Main evaluation failed'));
        else resolve(message.result?.result?.value);
      };
      socket.onerror=()=>{clearTimeout(timer);reject(new Error('Main inspector unavailable'));};
    });
  } finally { socket.close(); }
}
test.afterEach(async()=>{
  if(child&&child.exitCode===null&&mainEndpoint)await mainEvaluate("require('electron').BrowserWindow.getAllWindows().forEach(w=>w.close())").catch(()=>{});
  if(child&&child.exitCode===null){
    await Promise.race([once(child,'exit'),new Promise<void>(r=>setTimeout(r,5000))]);
    // Only the exact child created by this test; never enumerate/kill Electron apps.
    if(child.exitCode===null)child.kill();
  }
  await browser?.close().catch(()=>{});
  expect(runtimeErrors??[]).toEqual([]);
});
test('B38/B41: standalone Windows folder launches packaged app without Node modules or Vite',async()=>{
  expect(existsSync(executablePath)).toBe(true);
  expect(existsSync(resolve(directory,'node_modules'))).toBe(false);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  // Connect to the real packaged renderer. No loader/test code is installed in
  // the distribution; the debug port is used only by this test invocation.
  child=spawn(executablePath,['--inspect=0','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{cwd:directory,env,stdio:'pipe',windowsHide:true});
  runtimeErrors=[];
  const endpoint=await new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Packaged debugger endpoint not available')),15000);
    let buffer='';
    child.stderr!.on('data',(data:Buffer)=>{
      const text=data.toString();if(/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(text))runtimeErrors.push(text);
      buffer=(buffer+text).slice(-8192);
      const match=/DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(buffer);
      const node=/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(buffer);
      if(node)mainEndpoint=node[1]!;
      if(match&&mainEndpoint){clearTimeout(timer);resolve(match[1]!);}
    });
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Packaged process could not start'));});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Packaged process exited before endpoint'));});
  });
  browser=await chromium.connectOverCDP(endpoint);
  const context=browser.contexts()[0]!;
  ui=context.pages().find(p=>p.url()==='app://browser/index.html')??await context.waitForEvent('page');
  await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
  await ui.getByRole('button',{name:'Bilgi paneli',exact:true}).click();
  await expect(ui.getByText(version.display,{exact:true})).toBeVisible();
  expect(ui.url()).toBe('app://browser/index.html');
  expect(await mainEvaluate("({packaged:require('electron').app.isPackaged,version:require('electron').app.getVersion()})")).toEqual({packaged:true,version:version.package});
  await expect(ui.getByLabel('Test kullanıcısı')).toHaveCount(0);
  await expect(ui.getByLabel('Geçmiş servisi denemesi')).toHaveCount(0);
  expect(await ui.evaluate(()=>window.browser.switchDevelopmentIdentity('test-b'))).toMatchObject({ok:false,errorCode:'POLICY_BLOCKED'});
  expect(await ui.evaluate(()=>window.browser.setDevelopmentHistoryMode('offline'))).toMatchObject({ok:false,errorCode:'POLICY_BLOCKED'});
  await ui.getByRole('button',{name:'Test sayfasını aç',exact:true}).click();
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  await expect(ui.getByTestId('page-title')).toHaveText('Browser Core — Test Sayfası');
  const result=await ui.evaluate(()=>window.browser.getState());
  expect(result.ok&&result.data.developmentControls).toBe(false);
  expect(result.ok&&result.data.history.entries.length).toBe(0);
  // Review the production compact toolbar and the top of its optional panel.
  await ui.locator('#browser-info-panel').evaluate(element=>element.scrollTop=0);
  await ui.screenshot({path:'docs/evidence/p2-v1.0.14.0-packaged-shell.png'});
  const manifest=JSON.parse(readFileSync(resolve(directory,'PACKAGE_INFO.json'),'utf8').replace(/^\uFEFF/,''));
  expect(manifest.appVersion).toBe(version.display);expect(manifest.newDownloads).toBe(0);
  const exit=once(child,'exit');await mainEvaluate("require('electron').BrowserWindow.getAllWindows()[0].close()");await exit;
  expect(child.exitCode).toBe(0);
});
