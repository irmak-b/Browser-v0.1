import test from 'node:test';
import assert from 'node:assert/strict';
import { ClosedTabs, CLOSED_TAB_LIMIT } from '../../src/main/browser/closed-tabs';

test('only bounded safe addresses are remembered; the newest ten survive, with no live-page references', () => {
  const tabs=new ClosedTabs();
  for(const url of ['', 'about:blank', 'file:///C:/private', 'javascript:alert(1)', 'https://user:pass@example.test/', 'https://example.test/\npath', 'https://example.test/'+'x'.repeat(8192)])tabs.remember(url);
  assert.equal(tabs.size,0);
  for(let i=0;i<15;i++)tabs.remember('https://example.test/'+i);
  assert.equal(tabs.size,CLOSED_TAB_LIMIT);
  const restored:string[]=[];while(tabs.size)tabs.restore(url=>restored.push(url));
  assert.deepEqual(restored,Array.from({length:10},(_,i)=>'https://example.test/'+(14-i)));
  assert.throws(()=>tabs.restore(()=>{}),/kapalı sekme yok/);
});

test('failed opens preserve the next address; successful opens consume exactly one including query/fragment', () => {
  const tabs=new ClosedTabs();tabs.remember('https://example.test/watch?v=fixture#part');
  assert.throws(()=>tabs.restore(()=>{throw Error('tab limit');}),/tab limit/);assert.equal(tabs.size,1);
  const result=tabs.restore(url=>({url,tabId:'new'}));
  assert.deepEqual(result,{url:'https://example.test/watch?v=fixture#part',tabId:'new'});assert.equal(tabs.size,0);
});

test('context disposal clears every address and one context cannot restore another context', () => {
  const first=new ClosedTabs(),second=new ClosedTabs();first.remember('https://example.test/a');
  assert.equal(second.size,0);first.clear();assert.equal(first.size,0);assert.throws(()=>first.restore(()=>{}));
  second.remember('https://example.test/b');assert.equal(first.size,0);assert.equal(second.restore(url=>url),'https://example.test/b');
});

test('a muted closed address stays muted on restore, without inheriting another tab preference', () => {
  const tabs=new ClosedTabs();tabs.remember('https://example.test/a',true);tabs.remember('https://example.test/b');
  assert.deepEqual(tabs.restore((url,muted)=>({url,muted})),{url:'https://example.test/b',muted:false});
  assert.deepEqual(tabs.restore((url,muted)=>({url,muted})),{url:'https://example.test/a',muted:true});
});
