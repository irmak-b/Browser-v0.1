import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { PackagedDriver } from './driver';
import version from '../../app-version.json';

let extracted:{directory:string;executable:string;verifiedFiles:number};
let driver:PackagedDriver;
let env:NodeJS.ProcessEnv;
let secondary:ChildProcess|undefined;
test.beforeAll(()=>{
  mkdirSync(resolve('.cache'),{recursive:true});
  const destination=mkdtempSync(resolve('.cache/portable-validation-'));
  extracted=JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-File',resolve('scripts/extract-test-package.ps1'),'-Destination',destination],{encoding:'utf8'}));
  const windows=process.env.SystemRoot;
  if(!windows)throw new Error('Windows root missing');
  env={...process.env,PATH:join(windows,'System32')+';'+windows};
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;delete env.NODE_PATH;
  // This extracted copy is owned by the test. 'default' selects exactly the
  // same lock key as a normal launch with the optional scope variable absent.
  env.BROWSER_CORE_INSTANCE_SCOPE='default';
  const lookup=spawnSync(join(windows,'System32/where.exe'),['node.exe','npm.cmd'],{cwd:extracted.directory,env,windowsHide:true});
  expect(lookup.status).toBe(1); // neither external Node nor npm is in this child's search path
});
test.beforeEach(()=>{driver=new PackagedDriver();});
test.afterEach(async()=>{if(secondary?.exitCode===null)secondary.kill();await driver.close();expect(driver.errors).toEqual([]);});

test('portable: verified ZIP extracts to a new path and runs with no Node/npm on PATH',async()=>{
  const originalManifest=readFileSync(resolve('artifacts',`BrowserCore_${version.display}_Windows_x64`,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/);
  expect(extracted.verifiedFiles).toBe(originalManifest.length+1);
  expect(existsSync(resolve(extracted.directory,'resources/app/third-party-adblock/NOTICE.txt'))).toBe(true);
  await driver.launch(extracted.executable,env);
  await driver.ui.getByRole('button',{name:'Bilgi paneli',exact:true}).click();
  await expect(driver.ui.getByText(version.display,{exact:true})).toBeVisible();
  await driver.ui.getByRole('button',{name:'Test sayfasını aç',exact:true}).click();
  await expect(driver.ui.getByTestId('page-status')).toHaveText('Hazır');
  expect(await driver.evaluate("require('electron').app.isPackaged")).toBe(true);
  expect(await driver.evaluate("require('electron').app.hasSingleInstanceLock()")).toBe(true);
  const before=await driver.evaluate("(()=>{const e=require('electron');return {windows:e.BrowserWindow.getAllWindows().length,contents:e.webContents.getAllWebContents().map(w=>w.id).sort()};})()");
  secondary=spawn(extracted.executable,[],{cwd:extracted.directory,env,stdio:'pipe',windowsHide:true});
  const secondExit=await new Promise<number|null>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Packaged secondary did not exit')),8000);secondary!.once('error',error=>{clearTimeout(timer);reject(error);});secondary!.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  expect(secondExit).toBe(0);
  expect(await driver.evaluate("(()=>{const e=require('electron');return {windows:e.BrowserWindow.getAllWindows().length,contents:e.webContents.getAllWebContents().map(w=>w.id).sort()};})()")).toEqual(before);
  console.log('PACKAGED_SINGLE_INSTANCE '+JSON.stringify({defaultNamespace:true,secondaryExit:0,windows:before.windows,existingContentsPreserved:true,noExternalNode:true}));
  const exit=once(driver.child,'exit');await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].close()");await exit;
  expect(driver.child.exitCode).toBe(0);
});

test('bounded real workload: UI opens another tab while site JS is blocked and original page returns',async()=>{
  test.setTimeout(90000);
  // Keep renderer DevTools detached: attaching to the site affects its watchdog.
  await driver.launch(extracted.executable,env,false);
  // DOM reads avoid a nested UI->main invoke while a main inspector command is
  // awaiting executeJavaScript. Commands below schedule UI intent and return.
  const snapshot=()=>driver.evaluate("(()=>{const win=require('electron').BrowserWindow.getAllWindows()[0];if(!win||win.webContents.isLoadingMainFrame())return null;return win.webContents.executeJavaScript(\"({connected:document.body.innerText.includes('Browser Core bağlı'),status:document.querySelector('[data-testid=page-status]')?.textContent,error:document.querySelector('[role=alert]')?.textContent,tabs:document.querySelectorAll('[role=tab]').length})\");})()");
  await expect.poll(async()=>{try{return (await snapshot())?.connected?'ready':'loading';}catch(error){return String(error);}},{timeout:15000}).toBe('ready');
  await driver.evaluateUi(`(()=>{document.querySelector('button[aria-label="Bilgi paneli"]').click();return true;})()`);
  await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(\"Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test sayfasını aç').click();void 0\")");
  await expect.poll(async()=>(await snapshot())?.status).toBe('Hazır');
  await driver.evaluate(`(()=>{
    const win=require('electron').BrowserWindow.getAllWindows()[0];win.show();win.focus();
    const wc=require('electron').webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'));
    globalThis.__busyProbe={completed:false,result:null,error:null,unresponsive:0,responsive:0};
    wc.once('unresponsive',()=>globalThis.__busyProbe.unresponsive++);
    wc.once('responsive',()=>globalThis.__busyProbe.responsive++);
    void wc.executeJavaScript('(()=>{const start=performance.now();let turns=0;while(performance.now()-start<12000){turns++}return {elapsed:performance.now()-start,turns}})()')
      .then(result=>{globalThis.__busyProbe.completed=true;globalThis.__busyProbe.result=result;},error=>{globalThis.__busyProbe.completed=true;globalThis.__busyProbe.error=String(error.name);});
    setTimeout(()=>{
      if(wc.isDestroyed())return;
      wc.focus();
      wc.sendInputEvent({type:'keyDown',keyCode:'A'});
      wc.sendInputEvent({type:'keyUp',keyCode:'A'});
    },500);
  })()`);
  expect(await driver.evaluate('globalThis.__busyProbe.completed')).toBe(false);
  const hung=await snapshot();expect(hung.connected).toBe(true);
  await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(\"document.querySelector('button[aria-label=\\\"Yeni sekme\\\"]').click();void 0\")");
  await expect.poll(async()=>(await snapshot())?.tabs).toBe(2);
  expect(await driver.evaluate('globalThis.__busyProbe.completed')).toBe(false);
  await expect.poll(()=>driver.evaluate('globalThis.__busyProbe.completed'),{timeout:20000,intervals:[500]}).toBe(true);
  const probe=await driver.evaluate('globalThis.__busyProbe');
  expect(probe.error).toBe(null);expect(probe.result.elapsed).toBeGreaterThanOrEqual(12000);expect(probe.result.turns).toBeGreaterThan(0);
  await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(\"document.querySelector('[role=tab]').click();void 0\")");
  await expect.poll(async()=>(await snapshot())?.status).toBe('Hazır');
  const exit=once(driver.child,'exit');await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].close()");await exit;
  expect(driver.child.exitCode).toBe(0);
});
