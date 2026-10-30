import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { PackagedDriver } from '../tests/packaged/driver';

async function main() {
 const [exeArg,outArg]=process.argv.slice(2);if(!exeArg||!outArg)throw new Error('Executable and new report required');
 const executable=resolve(exeArg),out=resolve(outArg);if(!existsSync(executable)||existsSync(out))throw new Error('Invalid path or existing report');
 const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/work.js'){
   res.setHeader('Content-Type','text/javascript');
   res.end(`window.buffers=[new Uint8Array(24*1024*1024)];buffers[0].fill(7);
    for(let i=0;i<4;i++){const c=document.createElement('canvas');c.width=c.height=1536;document.body.append(c);const x=c.getContext('2d');x.fillStyle='#a357cd';x.fillRect(0,0,1536,1536);x.fillStyle='#42d19a';for(let j=0;j<400;j++)x.fillRect(j*4%1500,j*7%1500,50,50);}
    document.title='Local graphics ready';`);
  }else{
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local graphics loading</title><script src="/work.js" defer></script>');
  }
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const driver=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));const samples:any[]=[];const started=Date.now();
 const command=(name:string,...args:unknown[])=>driver.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
 const sample=async(label:string)=>{const v=await driver.evaluate(`(()=>{const e=require('electron'),m=e.app.getAppMetrics();return {privateMiB:m.reduce((s,p)=>s+(p.memory.privateBytes||0),0)/1024,processes:m.map(p=>({pid:p.pid,type:p.type,privateMiB:(p.memory.privateBytes||0)/1024})),contents:e.webContents.getAllWebContents().length};})()`);samples.push({label,seconds:(Date.now()-started)/1000,...v});console.log(label,JSON.stringify(v));};
 try{
  await driver.launch(executable,env,false);for(let i=0;i<100;i++){try{if(await driver.evaluateUi('!!window.browser'))break;}catch{}await sleep(50);}
  await sample('baseline');const ids:string[]=[];
  for(let i=0;i<3;i++){const r=await command('openTab',origin+'/page'+i);if(!r.ok)throw new Error();ids.push(r.data.tabId);}
  for(let i=0;i<100;i++){const r=await command('getState');if(r.ok&&r.data.tabs.filter((t:any)=>t.title==='Local graphics ready'&&t.status==='ready').length===3)break;await sleep(100);}
  await sleep(5000);await sample('loaded');for(const id of ids)await command('closeTab',id);
  await sleep(5000);await sample('closed-5s');await sleep(15000);await sample('closed-control-20s');
  for(const level of ['moderate','critical']){
   const result=await driver.evaluate(`(async()=>{const wc=require('electron').BrowserWindow.getAllWindows()[0].webContents;if(wc.debugger.isAttached())return 'already-attached';wc.debugger.attach('1.3');try{await wc.debugger.sendCommand('Memory.simulatePressureNotification',{level:${JSON.stringify(level)}});return 'command-accepted';}catch{return 'unsupported';}finally{wc.debugger.detach();}})()`);
   await sleep(5000);await sample('after-'+level+':'+result);
  }
  writeFileSync(out,JSON.stringify({recordedAt:new Date().toISOString(),executable,method:'Own package and only local scripted canvas fixtures; natural closed control, then fixed internal moderate/critical Memory.simulatePressureNotification on trusted UI target, no site debugger attached, no forced OOM purge/GC, no cookie/storage deletion. Isolated experiment, not production behavior or real-site root-cause proof.',samples,errors:driver.errors},null,2)+'\n');
 }finally{await driver.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
