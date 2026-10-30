import vm from 'node:vm';
import {existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pageFilters} from '../src/main/browser/ad-filter-engine';
import {documentFilterSource} from '../src/main/browser/ad-scriptlets';
const output=process.argv[2];if(!output||existsSync(output))throw Error('New output required');
const scripts=pageFilters('https://www.youtube.com/').scripts.filter(s=>s.includes('function editInboundObjectFn'));
const old=`(()=>{const shared={};${scripts.map(s=>`((scriptletGlobals)=>{${s}})(shared);`).join('\n')}})()`;
const runs:any[]=[];
for(const fixture of ['ordinary','attestation'])for(let pair=0;pair<3;pair++)for(const mode of pair%2?['new','old']:['old','new']){
 const c=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,EventTarget,TextDecoder,TextEncoder,setTimeout,clearTimeout});
 vm.runInContext(`self=globalThis;window=self;location={hostname:'www.youtube.com',protocol:'https:'};document={};Date.now=()=>123456;var parses=0,stringifies=0,p=JSON.parse,s=JSON.stringify;JSON.parse=function(...a){parses++;return Reflect.apply(p,this,a)};JSON.stringify=function(...a){stringifies++;return Reflect.apply(s,this,a)};var value={ordinary:true,rows:Array.from({length:500},(_,id)=>({id,text:'x'.repeat(128)}))};${fixture==='attestation'?`value.attestationRequest={};value.context={client:{userAgent:'fixture; channel',clientName:'WEB'}};value.playbackContext={contentPlaybackContext:{referer:'https://fixture.invalid/'}};`:''}`,c);
 vm.runInContext(mode==='old'?old:documentFilterSource('www.youtube.com',scripts),c);
 vm.runInContext('for(let i=0;i<5;i++)JSON.stringify(value);parses=0;stringifies=0;',c);
 const began=performance.now(),result=vm.runInContext('var result;for(let i=0;i<20;i++)result=JSON.stringify(value);result;',c),elapsedMs=performance.now()-began;
 runs.push({fixture,pair,mode,iterations:20,elapsedMs,perIterationMs:elapsedMs/20,sha256:createHash('sha256').update(result).digest('hex'),...vm.runInContext('({parses,stringifies})',c)});
}
for(const fixture of ['ordinary','attestation'])if(new Set(runs.filter(r=>r.fixture===fixture).map(r=>r.sha256)).size!==1)throw Error('Rule output changed');
writeFileSync(output,JSON.stringify({completed:true,ruleCount:scripts.length,method:'Three alternating old/new pairs per synthetic500row fixture,5warmup+20serializations. Same safeSelf snapshot in both. Old is the exact previous separate-rule wrapper, new is current production source. Date.now fixed. No browser/network/user data. Local VM timings do not imply real-site speed percentages.',runs},null,2));
console.log(JSON.stringify({completed:true,counts:runs.map(r=>({fixture:r.fixture,mode:r.mode,stringifies:r.stringifies,parses:r.parses,ms:r.perIterationMs}))}));
