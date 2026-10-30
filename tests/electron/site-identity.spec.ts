import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {PackagedDriver} from '../packaged/driver';
test('Site identity: actual Chromium UA and Turkish language reach the server before both profiles load',async()=>{
 const received:{agent:string;language:string}[]=[];
 const server=createServer((req,res)=>{received.push({agent:req.headers['user-agent']??'',language:req.headers['accept-language']??''});res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Site identity fixture</title><p>Local only</p>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/identity`;
 const d=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 try{
  await d.launch(resolve('node_modules/electron/dist/electron.exe'),env,false,[resolve('.')]);
  const cmd=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
  await expect.poll(async()=>{try{return await d.evaluateUi('!!window.browser');}catch{return false;}}).toBe(true);
  const chrome=await d.evaluate('process.versions.chrome');
  const uiAgent=await d.evaluateUi('navigator.userAgent');expect(uiAgent).toContain('Electron/');
  for(const profile of ['test-a','test-b']){
   if(profile==='test-b')expect((await cmd('switchDevelopmentIdentity',profile)).ok).toBe(true);
   const opened=await cmd('openTab',url);expect(opened.ok).toBe(true);
   await expect.poll(async()=>(await cmd('getState')).data.tabs.find((t:any)=>t.tabId===opened.data.tabId)?.status).toBe('ready');
   const info=await d.evaluate(`require('electron').webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(url)}).executeJavaScript('({agent:navigator.userAgent,bridge:typeof window.browser,node:typeof process})')`);
   expect(info.agent).toContain('Chrome/'+chrome);expect(info.agent).not.toMatch(/Electron\/|BrowserCore\/|browser-core\//);
   expect(info.bridge).toBe('undefined');expect(info.node).toBe('undefined');
  }
  expect(received.length).toBeGreaterThanOrEqual(2);
  for(const request of received){expect(request.agent).toContain('Chrome/'+chrome);expect(request.agent).not.toMatch(/Electron\/|BrowserCore\/|browser-core\//);expect(request.language).toMatch(/^tr-TR(?:,|;)/);}
  expect(await d.evaluateUi('navigator.userAgent')).toBe(uiAgent);
 }finally{await d.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 expect(d.errors).toEqual([]);
});
