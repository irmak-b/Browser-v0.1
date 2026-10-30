import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { PackagedDriver } from '../packaged/driver';
import version from '../../app-version.json';

let extracted:{directory:string;executable:string;verifiedFiles:number};
let driver:PackagedDriver;
let env:NodeJS.ProcessEnv;
test.beforeAll(()=>{
  mkdirSync(resolve('.cache'),{recursive:true});
  const destination=mkdtempSync(resolve('.cache/portable-validation-'));
  extracted=JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-File',resolve('scripts/extract-test-package.ps1'),'-Destination',destination],{encoding:'utf8'}));
  const windows=process.env.SystemRoot;
  if(!windows)throw new Error('Windows root missing');
  env={...process.env,PATH:join(windows,'System32')+';'+windows};
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;delete env.NODE_PATH;
  const lookup=spawnSync(join(windows,'System32/where.exe'),['node.exe','npm.cmd'],{cwd:extracted.directory,env,windowsHide:true});
  expect(lookup.status).toBe(1); // neither external Node nor npm is in this child's search path
});
test.beforeEach(()=>{driver=new PackagedDriver();});
test.afterEach(async()=>{await driver.close();expect(driver.errors).toEqual([]);});

test('portable: verified ZIP extracts to a new path and runs with no Node/npm on PATH',async()=>{
  expect(extracted.verifiedFiles).toBe(82);
  await driver.launch(extracted.executable,env);
  await expect(driver.ui.getByText(version.display,{exact:true})).toBeVisible();
  await driver.ui.getByRole('button',{name:'Test sayfasını aç',exact:true}).click();
  await expect(driver.ui.getByTestId('page-status')).toHaveText('Hazır');
  expect(await driver.evaluate("require('electron').app.isPackaged")).toBe(true);
  const exit=once(driver.child,'exit');await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].close()");await exit;
  expect(driver.child.exitCode).toBe(0);
});

test('real hang: native watchdog reports blocked site while UI remains usable, then recovers',async()=>{
  test.setTimeout(90000);
  // Keep renderer DevTools detached: attaching to the site affects its watchdog.
  await driver.launch(extracted.executable,env,false);
  // DOM reads avoid a nested UI->main invoke while a main inspector command is
  // awaiting executeJavaScript. Commands below schedule UI intent and return.
  const snapshot=()=>driver.evaluate("(()=>{const win=require('electron').BrowserWindow.getAllWindows()[0];if(!win||win.webContents.isLoadingMainFrame())return null;return win.webContents.executeJavaScript(\"({connected:document.body.innerText.includes('Browser Core bağlı'),status:document.querySelector('[data-testid=page-status]')?.textContent,error:document.querySelector('[role=alert]')?.textContent,tabs:document.querySelectorAll('[role=tab]').length})\");})()");
  await expect.poll(async()=>{try{return (await snapshot())?.connected?'ready':'loading';}catch(error){return String(error);}},{timeout:15000}).toBe('ready');
  await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(\"Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test sayfasını aç').click();void 0\")");
  await expect.poll(async()=>(await snapshot())?.status).toBe('Hazır');
  await driver.evaluate(`(()=>{
    const win=require('electron').BrowserWindow.getAllWindows()[0];win.show();win.focus();
    const wc=require('electron').webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'));
    globalThis.__nativeHangProbe={unresponsive:0,responsive:0};
    wc.once('unresponsive',()=>globalThis.__nativeHangProbe.unresponsive++);
    wc.once('responsive',()=>globalThis.__nativeHangProbe.responsive++);
    void wc.executeJavaScript('const until=Date.now()+35000;while(Date.now()<until){};void 0').catch(()=>{});
    // The watchdog observes missing input acknowledgements; a CPU loop alone
    // need not trigger it. Send an ordinary key only after the loop has started.
    setTimeout(()=>{
      if(wc.isDestroyed())return;
      wc.focus();
      wc.sendInputEvent({type:'keyDown',keyCode:'A'});
      wc.sendInputEvent({type:'keyUp',keyCode:'A'});
    },500);
  })()`);
  await expect.poll(()=>driver.evaluate('globalThis.__nativeHangProbe.unresponsive'),{timeout:40000,intervals:[500]}).toBeGreaterThan(0);
  const hung=await snapshot();expect(hung.error).toContain('RENDER_PROCESS_UNRESPONSIVE');expect(hung.connected).toBe(true);
  await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(\"document.querySelector('button[aria-label=\\\"Yeni sekme\\\"]').click();void 0\")");
  await expect.poll(async()=>(await snapshot())?.tabs).toBe(2);
  await expect.poll(()=>driver.evaluate('globalThis.__nativeHangProbe.responsive'),{timeout:45000,intervals:[500]}).toBeGreaterThan(0);
  await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(\"document.querySelector('[role=tab]').click();void 0\")");
  await expect.poll(async()=>(await snapshot())?.status).toBe('Hazır');
  const exit=once(driver.child,'exit');await driver.evaluate("require('electron').BrowserWindow.getAllWindows()[0].close()");await exit;
  expect(driver.child.exitCode).toBe(0);
});

