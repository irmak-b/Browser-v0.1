import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pageFilters} from '../../src/main/browser/ad-filter-engine';
import {documentFilterSource} from '../../src/main/browser/ad-scriptlets';

test('reviewed YouTube edit rules serialize ordinary JSON once without leaking shared state',()=>{
 const scripts=pageFilters('https://www.youtube.com/').scripts.filter(s=>s.includes('function editInboundObjectFn'));
 assert.ok(scripts.length>=6,'Real bundled YouTube rules must exercise multiple stringify wrappers');
 const context=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,EventTarget,TextDecoder,TextEncoder,setTimeout,clearTimeout});
 vm.runInContext(`self=globalThis;window=self;location={hostname:'www.youtube.com',protocol:'https:'};document={};var nativeCalls=0;var originalStringify=JSON.stringify;JSON.stringify=function(...args){nativeCalls++;return Reflect.apply(originalStringify,this,args)};`,context);
 vm.runInContext(documentFilterSource('www.youtube.com',scripts),context);
 vm.runInContext(`nativeCalls=0;JSON.stringify({ordinary:true});`,context);
 const calls=vm.runInContext('nativeCalls',context);
 assert.equal(calls,1,`${scripts.length} filters made ${calls} native stringify calls; expected one`);
 assert.equal(vm.runInContext(`JSON.stringify({ordinary:true})`,context),'\u007b"ordinary":true\u007d');
 assert.equal(vm.runInContext(`typeof self.scriptletGlobals`,context),'undefined');
});
