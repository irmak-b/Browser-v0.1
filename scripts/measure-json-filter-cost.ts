// Synthetic local JSON only, no browser, network or user data.
import vm from 'node:vm';
import { existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pageFilters } from '../src/main/browser/ad-filter-engine';
import { documentFilterSource } from '../src/main/browser/ad-scriptlets';
const output=process.argv[2];if(!output||existsSync(output))throw Error('New output required');
const scripts=pageFilters('https://www.youtube.com/').scripts.filter(s=>s.includes('function editInboundObjectFn'));
const runs:any[]=[];
for(let pair=0;pair<3;pair++)for(const filtered of pair%2?[true,false]:[false,true]){
  const context=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,EventTarget,TextDecoder,TextEncoder,setTimeout,clearTimeout});
  vm.runInContext(`self=globalThis;window=self;location={hostname:'www.youtube.com',protocol:'https:'};document={};
    var parses=0,stringifies=0,originalParse=JSON.parse,originalStringify=JSON.stringify;
    JSON.parse=function(...args){parses++;return Reflect.apply(originalParse,this,args)};
    JSON.stringify=function(...args){stringifies++;return Reflect.apply(originalStringify,this,args)};
    var value={ordinary:true,rows:Array.from({length:500},(_,i)=>({id:i,text:'x'.repeat(128),active:true}))};`,context);
  if(filtered)vm.runInContext(documentFilterSource('www.youtube.com',scripts),context);
  vm.runInContext('for(let i=0;i<5;i++)JSON.stringify(value);parses=0;stringifies=0;',context);
  const start=performance.now();
  const text=vm.runInContext('var result;for(let i=0;i<20;i++)result=JSON.stringify(value);result;',context);
  const elapsedMs=performance.now()-start,counts=vm.runInContext('({parses,stringifies})',context);
  runs.push({pair,filtered,iterations:20,elapsedMs,perIterationMs:elapsedMs/20,bytesPerResult:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),...counts});
}
if(new Set(runs.map(r=>r.sha256)).size!==1)throw Error('Synthetic ordinary output changed');
const result={completed:true,ruleCount:scripts.length,method:'Three alternating-order pairs, fresh Node VM per mode;5warmup+20timed serializations of the same synthetic500row plain object. Counts wrap both native APIs in both modes. Only JSON edit-inbound rules loaded, not full browser engine. No forced GC. VM/JIT and allocation effects vary.',limits:'Local microbenchmark, not video/browser latency, not proof of a leak, and not a measured improvement. Counts include filter cloning. A safe optimization must preserve ad filtering and serialization semantics.',runs};
writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({completed:true,ruleCount:scripts.length,calls:runs.map(r=>({filtered:r.filtered,parses:r.parses,stringifies:r.stringifies,perIterationMs:r.perIterationMs})),sameOutput:true}));
