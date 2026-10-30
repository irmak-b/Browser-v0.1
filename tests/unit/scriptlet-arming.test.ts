import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { AdScriptlets, documentFilterDigest, documentFilterSource } from '../../src/main/browser/ad-scriptlets';

test('document-start registration is reused only for identical content; opt-out, host/rule changes, crash and detach invalidate it', async () => {
  let attached = false, nextId = 0;
  const commands: string[] = [];
  const debuggerApi = Object.assign(new EventEmitter(), { isAttached: () => attached, attach: () => { attached = true; }, detach: () => { attached = false; },
    sendCommand: async (method: string) => { commands.push(method); return { identifier: String(++nextId) }; } });
  const wc = Object.assign(new EventEmitter(), { debugger: debuggerApi, isDestroyed: () => false, isDevToolsOpened: () => false }) as unknown as WebContents;
  const adapter = new AdScriptlets(), scripts = ['window.fixture=1;'];
  for (let i = 0; i < 10; i++) assert.equal(await adapter.arm(wc,'video.test',scripts,['youtube.com'],['window.guard=1']),true);
  assert.deepEqual(commands, ['Page.enable','Page.addScriptToEvaluateOnNewDocument']);
  await adapter.arm(wc,'video.test',scripts,[],[]); assert.equal(commands.filter(c => c.startsWith('Page.add')).length,2);
  await adapter.arm(wc,'other.test',scripts); assert.equal(commands.filter(c => c.startsWith('Page.add')).length,3);
  wc.emit('render-process-gone'); await adapter.arm(wc,'other.test',scripts); assert.equal(commands.filter(c => c.startsWith('Page.add')).length,4);
  await adapter.clear(wc); assert.equal(commands.at(-1),'Page.removeScriptToEvaluateOnNewDocument');
  await adapter.arm(wc,'other.test',['window.fixture=2;']); assert.equal(commands.filter(c => c.startsWith('Page.add')).length,5);
  debuggerApi.emit('detach'); attached = false;
  await adapter.arm(wc,'other.test',['window.fixture=2;']); assert.equal(commands.filter(c => c.startsWith('Page.add')).length,6);
  adapter.dispose(); assert.equal(wc.listenerCount('destroyed'),0); assert.equal(wc.listenerCount('render-process-gone'),0); assert.equal(debuggerApi.listenerCount('detach'),0);
});

test('input digest preserves host, source order, group boundaries and exact JS code units',()=>{
  const key=documentFilterDigest('video.test',['ab','c'],['fallback.test'],['guard']);
  assert.equal(key,documentFilterDigest('video.test',['ab','c'],['fallback.test'],['guard']));
  for(const changed of [
    documentFilterDigest('other.test',['ab','c'],['fallback.test'],['guard']),
    documentFilterDigest('video.test',['a','bc'],['fallback.test'],['guard']),
    documentFilterDigest('video.test',['c','ab'],['fallback.test'],['guard']),
    documentFilterDigest('video.test',['ab','c'],['other.test'],['guard']),
    documentFilterDigest('video.test',['ab','c'],['fallback.test'],['different guard']),
    documentFilterDigest('video.test',['ab','c','fallback.test'],[],['guard']),
  ])assert.notEqual(key,changed);
  assert.notEqual(documentFilterDigest('x',['\ud800']),documentFilterDigest('x',['\ud801']));
  assert.notEqual(documentFilterDigest('x',[]),documentFilterDigest('x',['']));
});

test('unchanged input skips source serialization; in-place rule edits still replace the exact registered script',async()=>{
  let attached=false;
  const sources:string[]=[];
  const debuggerApi=Object.assign(new EventEmitter(),{isAttached:()=>attached,attach:()=>{attached=true;},detach:()=>{attached=false;},
    sendCommand:async(method:string,params?:{source?:string})=>{if(method==='Page.addScriptToEvaluateOnNewDocument')sources.push(params!.source!);return {identifier:String(sources.length)};}});
  const wc=Object.assign(new EventEmitter(),{debugger:debuggerApi,isDestroyed:()=>false,isDevToolsOpened:()=>false}) as unknown as WebContents;
  const adapter=new AdScriptlets(),scripts=['window.fixture=1;'],fallback=['window.guard=1;'];
  try{
    assert.equal(await adapter.arm(wc,'video.test',scripts,['fallback.test'],fallback),true);
    const serialization=mock.method(JSON,'stringify');
    try{
      for(let i=0;i<10;i++)assert.equal(await adapter.arm(wc,'video.test',[...scripts],['fallback.test'],[...fallback]),true);
      assert.equal(serialization.mock.callCount(),0,'Identical preparation should not rebuild the document source');
    }finally{serialization.mock.restore();}
    scripts[0]='window.fixture=2;';await adapter.arm(wc,'video.test',scripts,['fallback.test'],fallback);
    assert.deepEqual(sources,[documentFilterSource('video.test',['window.fixture=1;'],['fallback.test'],fallback),documentFilterSource('video.test',scripts,['fallback.test'],fallback)]);
  }finally{adapter.dispose();}
  assert.equal(wc.listenerCount('destroyed'),0);assert.equal(debuggerApi.listenerCount('detach'),0);
});

test('a superseded pending registration cannot seed the digest fast path for newer rules',async()=>{
  let attached=false,releaseFirst!:()=>void,firstStarted!:()=>void;
  const firstReady=new Promise<void>(r=>{firstStarted=r;}),firstGate=new Promise<void>(r=>{releaseFirst=r;});
  const sources:string[]=[];
  const debuggerApi=Object.assign(new EventEmitter(),{isAttached:()=>attached,attach:()=>{attached=true;},detach:()=>{attached=false;},
    sendCommand:async(method:string,params?:{source?:string})=>{if(method==='Page.addScriptToEvaluateOnNewDocument'){sources.push(params!.source!);if(sources.length===1){firstStarted();await firstGate;}}return {identifier:String(sources.length)};}});
  const wc=Object.assign(new EventEmitter(),{debugger:debuggerApi,isDestroyed:()=>false,isDevToolsOpened:()=>false}) as unknown as WebContents;
  const adapter=new AdScriptlets();
  try{
    const first=adapter.arm(wc,'video.test',['window.version=1;']);await firstReady;
    const second=adapter.arm(wc,'video.test',['window.version=2;']);releaseFirst();
    assert.equal(await first,false);assert.equal(await second,true);
    await adapter.arm(wc,'video.test',['window.version=2;']);assert.equal(sources.length,2);
    assert.equal(sources.at(-1),documentFilterSource('video.test',['window.version=2;']));
    await adapter.arm(wc,'video.test',['window.version=1;']);assert.equal(sources.length,3);
  }finally{releaseFirst();adapter.dispose();}
});
