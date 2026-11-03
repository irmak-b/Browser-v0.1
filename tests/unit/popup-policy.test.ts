import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WebContents } from 'electron';
import { inspectPopupIntent, isTabDisposition } from '../../src/main/browser/popup-policy';

test('a renderer that never answers the intent probe cannot keep admission pending indefinitely', {timeout:2000}, async () => {
  const wc={executeJavaScriptInIsolatedWorld:()=>new Promise(()=>{})} as unknown as WebContents;
  assert.equal(await inspectPopupIntent(wc,{at:Date.now(),kind:'keyboard'},'https://example.com/'),'unavailable');
});

test('only foreground/background tab dispositions qualify for the bounded unavailable-probe fallback',()=>{
  assert.equal(isTabDisposition('foreground-tab'),true);assert.equal(isTabDisposition('background-tab'),true);
  for(const disposition of ['default','new-window','other',''])assert.equal(isTabDisposition(disposition),false);
});

test('unavailable and concrete negative intent are distinct; malformed responses never grant intent',async()=>{
  assert.equal(await inspectPopupIntent({executeJavaScriptInIsolatedWorld:()=>Promise.reject(Error('frame gone'))} as unknown as WebContents,{at:Date.now(),kind:'keyboard'},'https://example.com/'),'unavailable');
  for(const executeJavaScriptInIsolatedWorld of [()=>Promise.resolve(false),()=>Promise.resolve('true'),()=>Promise.resolve({allowed:true})]){
    assert.equal(await inspectPopupIntent({executeJavaScriptInIsolatedWorld} as unknown as WebContents,{at:Date.now(),kind:'keyboard'},'https://example.com/'),'block');
  }
});
