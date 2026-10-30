import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { blocksScripts, canSleep, SLEEP_AFTER_MS, STATIC_PAGE_PROBE, STATIC_PROBE_NODE_LIMIT, STATIC_PROBE_ATTRIBUTE_LIMIT, STATIC_PROBE_CHARACTER_LIMIT, staticProbeExceededBudget } from '../../src/main/browser/resource-policy';

test('discard requires an enforced CSP blocking every script type, never report-only or an override allowing scripts', () => {
  assert.equal(blocksScripts(["default-src 'none'"]), true);
  assert.equal(blocksScripts(["default-src 'self'; SCRIPT-SRC 'none'"]), true);
  for (const headers of [[], ["default-src 'self'"], ["default-src 'none'; script-src 'self'"],
    ["script-src 'none'; script-src-elem 'unsafe-inline'"], ["script-src 'none'; script-src-attr 'self'"], ["script-src 'none' https:"]]) {
    assert.equal(blocksScripts(headers), false);
  }
});

function element(localName='p',attributes:{name:string;value:string}[]=[],shadowRoot?:object) {
  return {nodeType:1,localName,attributes,shadowRoot,hasAttribute:(name:string)=>attributes.some(attr=>attr.name===name)};
}
function probe(elements:ReturnType<typeof element>[],readyState='complete',contentType='text/html') {
  let steps=0;
  const document={readyState,contentType,createTreeWalker:()=>{let index=0;return {nextNode:()=>{steps++;return elements[index++]??null;}};},
    querySelectorAll:()=>assert.fail('Sleep probe must not materialize a whole-document node list')};
  const result=runInNewContext(STATIC_PAGE_PROBE,{document,NodeFilter:{SHOW_ALL:0xffffffff},Node:{ELEMENT_NODE:1},scrollX:17,scrollY:29});
  return {result:JSON.parse(JSON.stringify(result)),steps};
}

test('bounded static probe preserves all existing active-content guards and returns only safe/scroll metadata',()=>{
  assert.deepEqual(probe([element('html'),element('meta',[{name:'charset',value:'utf-8'}]),element()]).result,{safe:true,x:17,y:29});
  for(const tag of ['script','noscript','form','input','textarea','select','audio','video','iframe','frame','object','embed','canvas'])assert.equal(probe([element(tag)]).result,false);
  for(const node of [element('div',[{name:'contenteditable',value:''}]),element('meta',[{name:'http-equiv',value:'refresh'}]),element('my-widget'),element('div',[],{}),
    element('a',[{name:'href',value:' \tJaVaScript:alert(1)'}]),element('p',[{name:'onClick',value:''}])])assert.equal(probe([node]).result,false);
  assert.equal(probe([element()],'loading').result,false);assert.equal(probe([element()],'complete','application/xhtml+xml').result,false);
});

test('node budget accepts its boundary and rejects larger documents without walking the remainder',()=>{
  const nodes=Array.from({length:STATIC_PROBE_NODE_LIMIT+100},()=>element());
  assert.deepEqual(probe(nodes.slice(0,STATIC_PROBE_NODE_LIMIT)).result,{safe:true,x:17,y:29});
  const over=probe(nodes);assert.equal(staticProbeExceededBudget(over.result),true);assert.equal(over.steps,STATIC_PROBE_NODE_LIMIT+1);
  // Text/comments also consume the node budget, without reading their content.
  assert.deepEqual(probe([{...element(),nodeType:3}]).result,{safe:true,x:17,y:29});
  const textOver=probe(nodes.map(node=>({...node,nodeType:3})));
  assert.equal(staticProbeExceededBudget(textOver.result),true);assert.equal(textOver.steps,STATIC_PROBE_NODE_LIMIT+1);
});

test('attribute budget fails closed before iterating an oversized attribute list',()=>{
  const attrs=Array.from({length:STATIC_PROBE_ATTRIBUTE_LIMIT},(_,i)=>({name:'data-'+i,value:''}));
  assert.deepEqual(probe([element('p',attrs)]).result,{safe:true,x:17,y:29});
  assert.equal(staticProbeExceededBudget(probe([element('p',[...attrs,{name:'data-over',value:''}])]).result),true);
});

test('attribute character budget includes names and rejects oversized text before scanning its value',()=>{
  const name='data-a',value='x'.repeat(STATIC_PROBE_CHARACTER_LIMIT-name.length);
  assert.deepEqual(probe([element('p',[{name,value}])]).result,{safe:true,x:17,y:29});
  assert.equal(staticProbeExceededBudget(probe([element('p',[{name,value:value+'x'}])]).result),true);
});

test('only an explicit failed-budget result is reusable; unsafe/unknown results never become a budget cache',()=>{
  assert.equal(staticProbeExceededBudget({safe:false,budgetExceeded:true}),true);
  for(const value of [null,undefined,false,true,[],42,'budget',{safe:true,budgetExceeded:true},{safe:false},{safe:false,budgetExceeded:'true'}])assert.equal(staticProbeExceededBudget(value),false);
});
test('sleep policy protects active, interacted, pinned, busy, loading, closing and multi-entry tabs', () => {
  const candidate = { selected:false, ready:true, closing:false, interacted:false, keepAwake:false, busy:false, singleEntry:true, idleSince:1000 };
  assert.equal(canSleep(candidate, 1000+SLEEP_AFTER_MS-1), false);
  assert.equal(canSleep(candidate, 1000+SLEEP_AFTER_MS), true);
  for (const patch of [{selected:true},{ready:false},{closing:true},{interacted:true},{keepAwake:true},{busy:true},{singleEntry:false}]) {
    assert.equal(canSleep({...candidate,...patch}, 1000+SLEEP_AFTER_MS+1), false);
  }
});
