import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pageFilters} from '../../src/main/browser/ad-filter-engine';
import {documentFilterSource} from '../../src/main/browser/ad-scriptlets';
import {jsonEditFastPath} from '../../src/main/browser/json-edit-fast-path';
const scripts=pageFilters('https://www.youtube.com/').scripts.filter(s=>s.includes('function editInboundObjectFn'));
const legacy=()=>`(()=>{const shared={};${scripts.map(s=>`((scriptletGlobals)=>{${s}})(shared);`).join('\n')}})()`;
function context(source:string){
 const c=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,EventTarget,TextDecoder,TextEncoder,setTimeout,clearTimeout});
 vm.runInContext(`self=globalThis;window=self;location={hostname:'www.youtube.com',protocol:'https:'};document={};var count=0;var original=JSON.stringify;JSON.stringify=function(...args){count++;return Reflect.apply(original,this,args)};`,c);
 vm.runInContext(source,c);vm.runInContext('count=0;',c);return c;
}
test('every reviewed attestation/comment edit matches the original rules without mutating input',()=>{
 const old=context(legacy()),fast=context(documentFilterSource('www.youtube.com',scripts));
 for(const agent of ['channel','lactmilli','yahi','instream','adunit','inline','eafg','ordinary'])for(const kind of ['attestationRequest','createCommentParams']){
   const expression=`(()=>{Date.now=()=>123456;const value={${kind}:{},context:{client:{userAgent:'fixture; ${agent}',clientName:'WEB'}},playbackContext:{contentPlaybackContext:{referer:'https://fixture.invalid/'}}};const before=original(value);return [JSON.stringify(value),original(value)===before];})()`;
   assert.equal(JSON.stringify(vm.runInContext(expression,fast)),JSON.stringify(vm.runInContext(expression,old)),agent+'/'+kind);
 }
 for(const value of ['null','false','0','"fixture"','[]','{}']){
   const expression=`(()=>{Date.now=()=>123456;return JSON.stringify({attestationRequest:${value},createCommentParams:${value},context:{client:{userAgent:'fixture; channel',clientName:'WEB'}},playbackContext:{contentPlaybackContext:{referer:'https://fixture.invalid/#reloadxhr'}}});})()`;
   assert.equal(vm.runInContext(expression,fast),vm.runInContext(expression,old));
 }
 assert.equal(vm.runInContext('Function.prototype.toString.call(JSON.stringify)',fast),vm.runInContext('Function.prototype.toString.call(JSON.stringify)',old));
 vm.runInContext('count=0;JSON.stringify({attestationRequest:{},context:{client:{userAgent:"channel",clientName:"WEB"}}})',fast);
 assert.equal(vm.runInContext('count',fast),2,'Relevant edits serialize one snapshot plus the edited result');
});
test('one-argument native getter/toJSON/Proxy/errors and original replacer/space behavior',()=>{
 const fast=context(documentFilterSource('www.youtube.com',scripts)),old=context(legacy());
 for(const expression of [
   `(()=>{let n=0;const out=JSON.stringify({get ordinary(){n++;return n}});return [out,n]})()`,
   `(()=>{let n=0;const out=JSON.stringify({toJSON(){n++;return {ordinary:n}}});return [out,n]})()`,
   `(()=>{let gets=0;const out=JSON.stringify(new Proxy({ordinary:true},{get(t,k,r){gets++;return Reflect.get(t,k,r)}}));return [out,gets]})()`,
   `(()=>{try{JSON.stringify({get ordinary(){throw new RangeError('fixture')}})}catch(e){return [e.name,e.message]}})()`,
   `JSON.stringify({get ordinary(){return JSON.stringify({nested:true})}})`,
   `(()=>{const v={};v.self=v;try{JSON.stringify(v)}catch(e){return e.name}})()`,
   `(()=>{try{JSON.stringify({n:1n})}catch(e){return e.name}})()`,
   `JSON.stringify({nested:{attestationRequest:{}}})`,
 ]){
   const native=context('');assert.equal(JSON.stringify(vm.runInContext(expression,fast)),JSON.stringify(vm.runInContext(expression,native)),expression);
 }
 for(const expression of [
   `JSON.stringify({attestationRequest:{},context:{client:{userAgent:'channel',clientName:'WEB'}}},null,2)`,
   `JSON.stringify({attestationRequest:{},ordinary:2},['ordinary'])`,
   `(()=>{let n=0;const text=JSON.stringify({ordinary:2},(k,v)=>{n++;return v});return [text,n]})()`,
   `JSON.stringify(undefined)`,`JSON.stringify()`,`JSON.stringify(null)`,`JSON.stringify(42)`,
 ])assert.equal(JSON.stringify(vm.runInContext(expression,fast)),JSON.stringify(vm.runInContext(expression,old)),expression);
});
test('changed/reordered/additional rules and an existing stringify hook keep the original chain',()=>{
 for(const list of [[...scripts.slice(1),scripts[0]!],[scripts[0]!+' ',...scripts.slice(1)],[...scripts,scripts[0]!]])assert.equal(jsonEditFastPath(list),list);
 const setup=[pageFilters('https://www.youtube.com/').scripts[0]!, 'JSON.stringify=new Proxy(JSON.stringify,{apply(t,self,args){return Reflect.apply(t,self,args)}});',...scripts];
 const c=context(documentFilterSource('www.youtube.com',setup));
 assert.equal(vm.runInContext('JSON.stringify({ordinary:true})',c),'{"ordinary":true}');
 assert.equal(vm.runInContext('count',c),scripts.length+1);
});
