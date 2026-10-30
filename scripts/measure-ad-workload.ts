import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {existsSync,writeFileSync} from 'node:fs';
import {PackagedDriver} from '../tests/packaged/driver';

async function main(){
 const [exeArg,outArg,mode='enabled']=process.argv.slice(2);
 if(!exeArg||!outArg||!['enabled','disabled'].includes(mode))throw new Error('Executable, new report and enabled/disabled required');
 const executable=resolve(exeArg),out=resolve(outArg);if(!existsSync(executable)||existsSync(out))throw new Error('Missing executable/existing report');
 const hosts=['doubleclick.net','googlesyndication.com','adnxs.com','criteo.net','pubmatic.com','rubiconproject.com','taboola.com','adform.net'];
 const hits={adFrames:0,adScripts:0,news:0};let port=0;
 const server=createServer((req,res)=>{
  const path=req.url?.split('?')[0];res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html');
  res.setHeader('Content-Security-Policy',"default-src 'self';script-src http:;frame-src http:;style-src 'unsafe-inline'");
  if(path==='/ad-work.js'){
   hits.adScripts++;res.setHeader('Content-Type','text/javascript');
   res.end(`window.memory=new Uint8Array(12*1024*1024);memory.fill(7);window.ticks=0;setInterval(()=>ticks++,50);
    for(let i=0;i<2;i++){const c=document.createElement('canvas');c.width=c.height=1024;c.style.width='180px';c.style.height='110px';document.body.append(c);const x=c.getContext('2d');x.fillStyle='#8d52dc';x.fillRect(0,0,1024,1024);for(let j=0;j<300;j++){x.fillStyle=j%2?'#eda2ac':'#42d1a0';x.fillRect(j*4%1000,j*7%1000,20,20)}}`);
  }else if(path==='/ad-frame'){
   hits.adFrames++;res.end('<!doctype html><title>Local ad allocation fixture</title><script src="/ad-work.js" defer></script>');
  }else if(path==='/news'){
   hits.news++;res.end('<!doctype html><title>Local news workload</title><h1>First-party article</h1><p>Own local test content.</p><div style="display:grid;grid-template-columns:repeat(4,200px)">'+hosts.map(host=>`<iframe style="width:195px;height:155px;border:0" src="http://${host}:${port}/ad-frame"></iframe>`).join('')+'</div>');
  }else res.end('<!doctype html><title>Empty local fixture</title><p>Local fixture</p>');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));port=(server.address() as {port:number}).port;
 const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 const runs:any[]=[];
 try{
  for(let repetition=1;repetition<=3;repetition++){
   const d=new PackagedDriver();
   try{
    await d.launch(executable,env,false,['--host-resolver-rules=MAP * 127.0.0.1','--no-proxy-server']);
    const command=(name:string,...args:unknown[])=>d.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
    for(let i=0;i<100;i++){try{if(await d.evaluateUi('!!window.browser'))break;}catch{}await wait(50);}
    const getState=async()=>{const r=await command('getState');if(!r.ok)throw new Error();return r.data;};
    const ready=async(ids:string[])=>{for(let i=0;i<200;i++){if((await getState()).tabs.filter((t:any)=>ids.includes(t.tabId)&&t.status==='ready').length===ids.length)return;await wait(50);}throw new Error('Local pages not ready');};
    const sample=async(label:string)=>{
     await wait(1000);await d.evaluate("require('electron').app.getAppMetrics();void 0");const samples=[];
     for(let i=0;i<5;i++){await wait(400);samples.push(await d.evaluate(`(()=>{const e=require('electron'),m=e.app.getAppMetrics();return {privateMiB:m.reduce((s,p)=>s+(p.memory.privateBytes||0),0)/1024,cpuPercent:m.reduce((s,p)=>s+p.cpu.percentCPUUsage,0),processCount:m.length,processes:m.map(p=>({type:p.type,privateMiB:(p.memory.privateBytes||0)/1024})),siteContents:e.webContents.getAllWebContents().filter(w=>w.getType()!=='window').length};})()`));}
     const state=await getState();return {label,samples,tabs:state.tabs.length,frozen:state.tabs.filter((t:any)=>t.frozen).length,serverHits:{...hits}};
    };
    for(let i=1;i<7;i++)await command('openTab');await wait(2000);
    const blank=(await getState()).activeTabId;const stages=[await sample('seven-empty')];
    hits.adFrames=0;hits.adScripts=0;hits.news=0;const ids:string[]=[];
    for(let i=0;i<3;i++){
     const r=await command('openTab',`http://news-${i}.test:${port}/empty`);if(!r.ok)throw new Error();ids.push(r.data.tabId);await ready([r.data.tabId]);
     if(mode==='disabled'){
      if(!await d.evaluateUi("typeof window.browser.setAdBlocking==='function'"))throw new Error('No ad-block toggle in disabled-mode target');
      const preference=await command('setAdBlocking',r.data.tabId,false);if(!preference.ok)throw new Error('Exception failed');
     }
     await command('navigate',r.data.tabId,`http://news-${i}.test:${port}/news`);
    }
    await ready(ids);await wait(3000);stages.push(await sample('three-news-loaded'));
    await command('activateTab',blank);await d.evaluate('(()=>{const now=Date.now;Date.now=()=>now()+180000;})()');await command('activateTab',blank);await wait(2000);
    stages.push(await sample('background-after-idle'));
    for(const id of ids)await command('closeTab',id);
    await wait(10000);stages.push(await sample('after-close-and-idle'));
    runs.push({repetition,version:(await getState()).appVersion,stages,errors:d.errors});console.log(`Ad workload ${mode} repetition ${repetition}/3 complete`);
   }finally{await d.close();}
  }
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 writeFileSync(out,JSON.stringify({recordedAt:new Date().toISOString(),executable,mode,method:'Three fresh package launches, seven empty tabs and three local first-party pages each embedding eight distinct ad-host frames. Ad frames allocate12MiB and two canvases1024x1024. All DNS is mapped to127.0.0.1 in test-child flags, proxy disabled only for test child: no real ad/news traffic or TLS bypass. Five samples/stage,400ms spacing after1s settle. Idle advances only child main Date.now3min. Main inspector only, no renderer CDP. This fixture is not a measurement of Technopat/DonanimHaber/Sozcu or a general web benchmark. CPU is Electron API percentage. Each run same order; OS cache/driver state may vary.',runs},null,2)+'\n');
 console.log('Report: '+out);
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
