import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { BrowserSnapshot } from '../../src/shared/contracts';

let app:ElectronApplication,ui:Page,server:Server,origin:string;
const errors:string[]=[];
test.describe.configure({mode:'serial'});
test.beforeAll(async()=>{
  const rate=8000,samples=rate*8,wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(200*Math.sin(i*2*Math.PI*440/rate)),44+i*2);
  server=createServer((req,res)=>{
    if(req.url==='/tone.wav'){res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':wav.length});res.end(wav);return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'none'; media-src 'self'"});
    res.end('<!doctype html><title>Yerel medya</title><h1>Yalnız aynı kaynaklı medya</h1>');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await electron.launch({args:[resolve('.')],env,chromiumSandbox:true});app.process().stderr?.on('data',(chunk:Buffer)=>{if(/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(chunk.toString()))errors.push(chunk.toString());});
  ui=await app.firstWindow();await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
});
test.beforeEach(async()=>{const s=await state();await ui.evaluate(id=>window.browser.switchDevelopmentIdentity(id as 'test-a'|'test-b'),s.developmentIdentity==='test-a'?'test-b':'test-a');});
test.afterEach(async()=>{await app.evaluate(()=>{if((globalThis as any).__audioClock){Date.now=(globalThis as any).__audioClock;delete (globalThis as any).__audioClock;}});});
test.afterAll(async()=>{if(app)await app.close();server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));expect(errors).toEqual([]);});
async function state():Promise<BrowserSnapshot>{return ui.evaluate(async()=>{const r=await window.browser.getState();if(!r.ok)throw Error('State failed');return r.data;});}
async function page(path='/page/1'){const s=await state(),url=new URL(path,s.fixtureUrl).href;expect((await ui.evaluate(({id,url})=>window.browser.navigate(id,url),{id:s.activeTabId!,url})).ok).toBe(true);await ready(s.activeTabId!);return {id:s.activeTabId!,url};}
async function ready(id:string){await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===id)?.status).toBe('ready');}
async function site(url:string,code:string){return app.evaluate(async({webContents},{url,code})=>webContents.getAllWebContents().find(wc=>wc.getURL()===url)!.executeJavaScript(code,true),{url,code});}
async function native(url:string){return app.evaluate(({webContents},url)=>{const wc=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!;return {id:wc.id,muted:wc.isAudioMuted(),audible:wc.isCurrentlyAudible()};},url);}
async function count(){return app.evaluate(({webContents})=>webContents.getAllWebContents().filter(wc=>wc.getURL().startsWith('http://127.0.0.1:')).length);}

test('AU-05: quiet pages have no sound indicator even when their stored preference is muted',async()=>{
  const first=await page();
  const secondUrl=new URL('/page/2',first.url).href;
  const opened=await ui.evaluate(url=>window.browser.openTab(url),secondUrl);
  expect(opened.ok).toBe(true);if(!opened.ok)throw Error('Open failed');await ready(opened.data.tabId);
  for(const url of [first.url,secondUrl])expect(await native(url)).toMatchObject({audible:false,muted:false});
  expect((await state()).tabs.every(tab=>!tab.audible&&!tab.muted)).toBe(true);
  await expect(ui.locator('.mute-tab')).toHaveCount(0);
  const firstNative=await native(first.url),secondNative=await native(secondUrl);
  await ui.evaluate(id=>window.browser.setTabMuted(id,true),first.id);
  await expect(ui.locator('.mute-tab')).toHaveCount(0);
  expect(await native(first.url)).toEqual({...firstNative,muted:true});
  await ui.evaluate(id=>window.browser.setTabMuted(id,false),first.id);
  await expect(ui.locator('.mute-tab')).toHaveCount(0);
  expect((await state()).activeTabId).toBe(opened.data.tabId);
  expect(await native(first.url)).toEqual(firstNative);expect(await native(secondUrl)).toEqual(secondNative);
  console.log('AUDIO_QUIET_UI '+JSON.stringify({quietPages:2,unmutedQuietIndicators:0,mutedQuietIndicators:0,mutePreferencePreserved:true,selectionAndNativePagesPreserved:true}));
});

test('AU-01: real muted WebAudio emits native activity; background mute UI preserves selection and the document',async()=>{
  const blank=(await state()).activeTabId!;expect((await ui.evaluate(id=>window.browser.setTabMuted(id,true),blank)).ok).toBe(true);expect(await count()).toBe(0);
  const p=await page();expect((await native(p.url)).muted).toBe(true);
  await app.evaluate(({webContents},url)=>{const wc=webContents.getAllWebContents().find(wc=>wc.getURL()===url)!;(globalThis as any).__audioEvents=0;wc.once('audio-state-changed',()=>{(globalThis as any).__audioEvents++;});},p.url);
  expect(await site(p.url,"(async()=>{window.audioContext=new AudioContext();window.oscillator=audioContext.createOscillator();const gain=audioContext.createGain();gain.gain.value=0.01;oscillator.connect(gain).connect(audioContext.destination);await audioContext.resume();oscillator.start();window.audioMarker='kept';return audioContext.state})()")).toBe('running');
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===p.id)?.audible).toBe(true);
  expect(await app.evaluate(()=>(globalThis as any).__audioEvents)).toBe(1);
  await expect(ui.getByRole('button',{name:'Sesini aç: Sayfa 1',exact:true})).toBeVisible();
  const before=await native(p.url);const opened=await ui.evaluate(()=>window.browser.openTab());expect(opened.ok).toBe(true);const active=(await state()).activeTabId;
  // Stop the source before unmuting: no test tone is sent to the user's speakers.
  await site(p.url,'oscillator.stop();audioContext.close();void 0');
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===p.id)?.audible).toBe(false);
  await expect(ui.locator('.mute-tab')).toHaveCount(0);
  expect((await native(p.url)).muted).toBe(true);
  await ui.evaluate(id=>window.browser.setTabMuted(id,false),p.id);expect((await native(p.url)).muted).toBe(false);
  await expect(ui.locator('.mute-tab')).toHaveCount(0);
  expect((await state()).activeTabId).toBe(active);expect((await native(p.url)).id).toBe(before.id);expect(await site(p.url,'window.audioMarker')).toBe('kept');
  await ui.evaluate(id=>window.browser.setTabMuted(id,true),p.id);await expect(ui.locator('.mute-tab')).toHaveCount(0);
  // Mute preference survives silence. Resumed real audio makes its icon
  // reappear; the output remains muted for the entire source lifetime.
  await site(p.url,"(async()=>{window.audioContext=new AudioContext();window.oscillator=audioContext.createOscillator();const gain=audioContext.createGain();gain.gain.value=0.01;oscillator.connect(gain).connect(audioContext.destination);await audioContext.resume();oscillator.start();return true})()");
  await expect(ui.getByRole('button',{name:'Sesini aç: Sayfa 1',exact:true})).toHaveAttribute('aria-pressed','true');
  const png=await app.evaluate(async({BrowserWindow})=>[...(await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG()]);writeFileSync(test.info().outputPath('audio-window.png'),Buffer.from(png));
  await site(p.url,'oscillator.stop();audioContext.close();void 0');
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===p.id)?.audible).toBe(false);
  await expect(ui.locator('.mute-tab')).toHaveCount(0);
  await app.evaluate(({webContents},url)=>{(globalThis as any).__audioOld=webContents.getAllWebContents().find(wc=>wc.getURL()===url);},p.url);await ui.evaluate(id=>window.browser.closeTab(id),p.id);
  expect(await app.evaluate(()=>{const wc=(globalThis as any).__audioOld;return {destroyed:wc.isDestroyed(),listeners:wc.listenerCount('audio-state-changed')};})).toEqual({destroyed:true,listeners:0});
  console.log('AUDIO_NATIVE '+JSON.stringify({nativeAudibleEvents:1,startedMuted:true,sourceStoppedBeforeUnmute:true,quietUnmutedIndicators:0,backgroundSelectionPreserved:true,documentPreserved:true,closedAudioListeners:0}));
});

test('AU-02: mute survives reload, same-document navigation, recovery, crash and closed-tab restore',async()=>{
  const p=await page();
  await app.evaluate(({webContents},url)=>{webContents.getAllWebContents().find(wc=>wc.getURL()===url)!.emit('unresponsive');},p.url);
  await ui.evaluate(id=>window.browser.setTabMuted(id,true),p.id);
  await app.evaluate(({webContents},url)=>{webContents.getAllWebContents().find(wc=>wc.getURL()===url)!.emit('responsive');},p.url);
  expect((await state()).tabs.find(tab=>tab.tabId===p.id)?.muted).toBe(true);expect((await native(p.url)).muted).toBe(true);
  await ui.evaluate(id=>window.browser.reload(id),p.id);await ready(p.id);expect((await native(p.url)).muted).toBe(true);
  const hash=p.url+'#audio';await ui.evaluate(({id,url})=>window.browser.navigate(id,url),{id:p.id,url:hash});await ready(p.id);expect((await native(hash)).muted).toBe(true);
  await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(wc=>wc.getURL()===url)!.forcefullyCrashRenderer(),hash);
  await expect.poll(async()=>(await state()).tabs.find(tab=>tab.tabId===p.id)?.errorCode).toBe('RENDER_PROCESS_GONE');expect((await state()).tabs.find(tab=>tab.tabId===p.id)?.audible).toBe(false);
  await ui.evaluate(id=>window.browser.reload(id),p.id);await ready(p.id);expect((await native(hash)).muted).toBe(true);
  await ui.evaluate(id=>window.browser.closeTab(id),p.id);const restored=await ui.evaluate(()=>window.browser.restoreClosedTab());expect(restored.ok).toBe(true);if(!restored.ok)throw Error('Restore failed');await ready(restored.data.tabId);
  expect((await native(hash)).muted).toBe(true);expect((await state()).tabs.find(tab=>tab.tabId===restored.data.tabId)?.muted).toBe(true);
  console.log('AUDIO_LIFECYCLE '+JSON.stringify({recoveryPolicy:'synthetic native event',realCrash:true,reloadPreserved:true,hashPreserved:true,restoreMutedBeforeLoad:true}));
});

test('AU-03: mute validation is narrow, unchanged commands cause zero revisions and identity resets blank preference',async()=>{
  const id=(await state()).activeTabId!;await ui.evaluate(id=>window.browser.setTabMuted(id,true),id);const before=(await state()).revision;
  await ui.evaluate(async id=>{for(let i=0;i<100;i++)await window.browser.setTabMuted(id,true);},id);expect((await state()).revision-before).toBe(0);expect(await count()).toBe(0);
  expect(await ui.evaluate(()=>window.browser.setTabMuted('foreign',true))).toMatchObject({ok:false,errorCode:'TAB_NOT_FOUND'});
  expect(await ui.evaluate(id=>window.browser.setTabMuted(id,'bad' as unknown as boolean),id)).toMatchObject({ok:false,errorCode:'INVALID_INPUT'});
  const errors=await app.evaluate(async({BrowserWindow,ipcMain},id)=>{const win=BrowserWindow.getAllWindows()[0]!,handle=(ipcMain as any)._invokeHandlers.get('browser:tab-muted'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};return {
    extra:(await handle(event,{tabId:id,muted:true,partition:'other'})).errorCode,
    long:(await handle(event,{tabId:'x'.repeat(65),muted:true})).errorCode,
    foreign:(await handle({sender:{id:-1,isDestroyed:()=>false},senderFrame:win.webContents.mainFrame},{tabId:id,muted:true})).errorCode};},id);
  expect(errors).toEqual({extra:'INVALID_INPUT',long:'INVALID_INPUT',foreign:'UNAUTHORIZED'});
  const first=await page();const secondUrl=new URL('/page/2',first.url).href;
  const opened=await ui.evaluate(url=>window.browser.openTab(url),secondUrl);expect(opened.ok).toBe(true);if(!opened.ok)throw Error('Open failed');await ready(opened.data.tabId);
  expect((await native(first.url)).muted).toBe(true);expect((await native(secondUrl)).muted).toBe(false);
  await ui.evaluate(id=>window.browser.setTabMuted(id,false),first.id);await ui.evaluate(id=>window.browser.setTabMuted(id,true),opened.data.tabId);
  expect((await native(first.url)).muted).toBe(false);expect((await native(secondUrl)).muted).toBe(true);expect((await state()).activeTabId).toBe(opened.data.tabId);
  const identity=(await state()).developmentIdentity;await ui.evaluate(identity=>window.browser.switchDevelopmentIdentity(identity as 'test-a'|'test-b'),identity==='test-a'?'test-b':'test-a');expect((await state()).tabs[0]?.muted).toBe(false);expect(await count()).toBe(0);
  console.log('AUDIO_BOUNDS '+JSON.stringify({repeatedSameValue:100,extraRevisions:0,nativeBlankPages:0,sameOriginTabsIndependent:true,identityCleared:true,errors}));
});

test('AU-04: muted real media keeps advancing in background and is protected from freeze',async()=>{
  const p={id:(await state()).activeTabId!,url:origin+'/media'};
  expect((await ui.evaluate(({id,url})=>window.browser.navigate(id,url),p)).ok).toBe(true);await ready(p.id);
  await ui.evaluate(id=>window.browser.setTabMuted(id,true),p.id);
  const playback=await site(p.url,`(async()=>{window.player=document.createElement('audio');player.src=${JSON.stringify(origin+'/tone.wav')};player.loop=true;document.body.append(player);try{await player.play();return {ok:true,paused:player.paused}}catch(error){return {ok:false,name:error.name,message:error.message,mediaError:player.error?.code}}})()`);
  console.log('AUDIO_PLAYBACK '+JSON.stringify(playback));expect(playback.ok).toBe(true);
  const before=await native(p.url);await ui.evaluate(()=>window.browser.openTab());
  await app.evaluate(()=>{(globalThis as any).__audioClock=Date.now;Date.now=()=> (globalThis as any).__audioClock()+125000;});
  await ui.evaluate(id=>window.browser.activateTab(id),(await state()).activeTabId!);
  await expect.poll(async()=>site(p.url,'player.currentTime')).toBeGreaterThan(1);
  const s=await state();expect(s.tabs.find(tab=>tab.tabId===p.id)?.frozen).not.toBe(true);expect(await site(p.url,'player.paused')).toBe(false);expect((await native(p.url)).id).toBe(before.id);expect((await native(p.url)).muted).toBe(true);
  await site(p.url,'player.pause();void 0');
  console.log('AUDIO_MEDIA '+JSON.stringify({realWav:true,muted:true,timeAdvanced:true,backgroundNotFrozen:true,mainClockAccelerated:true}));
});
