import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdBlocker,isAdHost,AD_DOMAINS} from '../../src/main/browser/ad-blocker';
import type {WebContents} from 'electron';
import {EventEmitter} from 'node:events';

test('ad host matching respects complete domain labels and never matches lookalikes',()=>{
 for(const host of ['doubleclick.net','securepubads.g.doubleclick.net','PAGEAD2.GOOGLESYNDICATION.COM.','foo.admatic.com.tr'])assert.equal(isAdHost(host),true);
 for(const host of ['notdoubleclick.net','doubleclick.net.safe.example','example.com','googlevideo.com','googletagmanager.com',''])assert.equal(isAdHost(host),false);
 assert.ok(AD_DOMAINS.length<100);
});
test('network filter preserves content and main documents, isolates counters and supports site exception',()=>{
 const a={} as WebContents,b={} as WebContents,filter=new AdBlocker(()=>{});
 filter.navigation(a,'https://news.example/article');filter.navigation(b,'https://other.example/');
 assert.equal(filter.block(a,'https://securepubads.g.doubleclick.net/tag','mainFrame'),false);
 assert.equal(filter.block(a,'https://news.example/content/script.js','script'),false);
 assert.equal(filter.block(a,'https://securepubads.g.doubleclick.net/tag','script'),true);
 assert.equal(filter.snapshot(a).blockedRequests,1);assert.equal(filter.snapshot(b).blockedRequests,0);
 assert.equal(filter.setEnabled(a,false),true);
 assert.equal(filter.block(a,'https://securepubads.g.doubleclick.net/tag','script'),false);
 assert.equal(filter.block(b,'https://securepubads.g.doubleclick.net/tag','subFrame'),true);
 filter.navigation(a,'https://news.example/next');assert.equal(filter.snapshot(a).enabled,false);
 filter.navigation(a,'https://new.example/');assert.equal(filter.snapshot(a).enabled,true);
 assert.equal(filter.block(undefined,'https://doubleclick.net/a','script'),false);
 filter.dispose();
});

test('bundled Turkish rules block same-site ad paths without blocking editorial assets or normal video',()=>{
 const wc={} as WebContents,filter=new AdBlocker(()=>{});
 filter.navigation(wc,'https://www.donanimhaber.com/article');
 assert.equal(filter.block(wc,'https://www.donanimhaber.com/ads/banner.js','script'),true);
 assert.equal(filter.block(wc,'https://ad.donanimhaber.com/banner','image'),true);
 assert.equal(filter.block(wc,'https://www.donanimhaber.com/static/article.js','script'),false);
 filter.setEnabled(wc,false);
 assert.equal(filter.block(wc,'https://www.donanimhaber.com/ads/banner.js','script'),false);
 filter.navigation(wc,'https://www.youtube.com/watch?v=fixture');
 assert.equal(filter.block(wc,'https://rr1.googlevideo.com/videoplayback?fixture=1','media'),false);
 assert.ok(filter.snapshot(wc).ruleCount>100000);filter.dispose();
});

test('cancelled navigation restores the live site filter and counter; a committed navigation discards the old filter',async()=>{
 const wc=Object.assign(new EventEmitter(),{url:'https://news.example/article',getURL(){return this.url;},isDestroyed:()=>false,debugger:{isAttached:()=>true},isDevToolsOpened:()=>false}) as unknown as WebContents;
 const filter=new AdBlocker(()=>{});
 filter.navigation(wc,wc.getURL());wc.emit('did-navigate');
 assert.equal(filter.block(wc,'https://doubleclick.net/ad','script'),true);
 filter.setEnabled(wc,false);
 const before=filter.snapshot(wc);
 for(let i=0;i<10;i++){
  filter.navigation(wc,'https://other.example/'+i);
  assert.equal(filter.snapshot(wc).enabled,true);
  wc.emit('will-prevent-unload',{});
  assert.deepEqual(filter.snapshot(wc),before);
 }
 filter.navigation(wc,'https://other.example/committed');
 (wc as unknown as {url:string}).url='https://other.example/committed';wc.emit('did-navigate');
 wc.emit('will-prevent-unload',{});
 assert.equal(filter.snapshot(wc).enabled,true);assert.equal(filter.snapshot(wc).blockedRequests,0);
 wc.emit('destroyed');
 for(const event of ['dom-ready','did-navigate','will-prevent-unload','destroyed'])assert.equal(wc.listenerCount(event),0);
 await Promise.resolve();filter.dispose();
});
