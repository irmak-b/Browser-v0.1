import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let app:ElectronApplication,ui:Page;
const children:ChildProcess[]=[],errors:string[]=[];
const executable=resolve('node_modules/electron/dist/electron.exe');
function env(){const value=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete value.ELECTRON_RUN_AS_NODE;delete value.ELECTRON_RENDERER_URL;return value;}
async function launch(){app=await electron.launch({args:[resolve('.')],env:env(),chromiumSandbox:true});app.process().stderr?.on('data',(data:Buffer)=>{if(/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(data.toString()))errors.push(data.toString());});ui=await app.firstWindow();await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();}
test.beforeEach(launch);
test.afterEach(async()=>{for(const child of children.splice(0))if(child.exitCode===null)child.kill();if(app)await app.close();expect(errors).toEqual([]);});
async function state():Promise<BrowserSnapshot>{return ui.evaluate(async()=>{const r=await window.browser.getState();if(!r.ok)throw Error('State failed');return r.data;});}
async function duplicate(){
  const child=spawn(executable,[resolve('.'),'https://untrusted.example.test/ignored'],{cwd:resolve('.'),env:env(),stdio:'pipe',windowsHide:true});children.push(child);
  const output:string[]=[];child.stderr?.on('data',(chunk:Buffer)=>{if(/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString()))output.push('runtime error');});
  const code=await new Promise<number|null>((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Secondary did not exit'));},8000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  expect(code).toBe(0);expect(output).toEqual([]);return child.pid;
}

test('SI-01: repeated launches exit without new pages, restore the minimized first window and ignore command-line URLs',async()=>{
  const s=await state(),url=new URL('/page/1',s.fixtureUrl).href;
  await ui.evaluate(({id,url})=>window.browser.navigate(id,url),{id:s.activeTabId!,url});await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===s.activeTabId)?.status).toBe('ready');
  const original=await app.evaluate(async({app,BrowserWindow,webContents},url)=>{const wc=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!;await wc.executeJavaScript("document.querySelector('#state-input').value='instance-kept';void 0");BrowserWindow.getAllWindows()[0]!.minimize();return {pid:process.pid,id:wc.id,lock:app.hasSingleInstanceLock(),runtime:app.getPath('userData').endsWith('BrowserCore-'+process.pid)};},url);
  expect(original.lock).toBe(true);expect(original.runtime).toBe(true);
  const secondary:number[]=[];for(let i=0;i<3;i++)secondary.push((await duplicate())!);
  await expect.poll(async()=>app.evaluate(({BrowserWindow})=>{const wins=BrowserWindow.getAllWindows();return {count:wins.length,minimized:wins[0]!.isMinimized(),visible:wins[0]!.isVisible(),focused:wins[0]!.isFocused()};})).toEqual({count:1,minimized:false,visible:true,focused:true});
  const after=await app.evaluate(async({webContents})=>{const sites=webContents.getAllWebContents().filter(wc=>wc.getURL().startsWith('http://127.0.0.1:'));return {count:sites.length,id:sites[0]!.id,url:sites[0]!.getURL(),value:await sites[0]!.executeJavaScript("document.querySelector('#state-input').value")};});
  expect(after).toEqual({count:1,id:original.id,url,value:'instance-kept'});expect((await state()).activeTabId).toBe(s.activeTabId);
  console.log('INSTANCE_REUSE '+JSON.stringify({primaryLock:true,secondaryExits:3,windowCount:1,nativePages:1,documentPreserved:true,argvUrlIgnored:true,restoredAndFocused:true}));
});

test('SI-02: normal exit releases the native lock and the next launch starts a fresh owned session',async()=>{
  const pid=await app.evaluate(()=>process.pid);expect(await app.evaluate(({app})=>app.hasSingleInstanceLock())).toBe(true);
  await app.close();await launch();
  expect(await app.evaluate(()=>process.pid)).not.toBe(pid);expect(await app.evaluate(({app})=>app.hasSingleInstanceLock())).toBe(true);
  expect((await state()).tabs).toHaveLength(1);expect((await state()).tabs[0]?.status).toBe('empty');await duplicate();
  console.log('INSTANCE_RELEASE '+JSON.stringify({normalExitReleased:true,relaunchOwnsLock:true,freshSession:true,secondaryExit:0}));
});
