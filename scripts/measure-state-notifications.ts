// Main-only instrumentation of the actual package. Counts state IPC messages,
// not user-perceived speed or host CPU/RAM. All page traffic is loopback.
import {createServer} from 'node:http';
import {existsSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {PackagedDriver} from '../tests/packaged/driver';

async function main(){
  const executable=resolve(process.argv[2]??''),output=resolve(process.argv[3]??'');
  const outputRelative=relative(resolve('.'),output);
  if(!process.argv[2]||!process.argv[3]||!existsSync(executable)||existsSync(output)||isAbsolute(outputRelative)||outputRelative.startsWith('..'))throw Error('Existing EXE and new workspace output required');
  const driver=new PackagedDriver(),wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const report:any={completed:false,method:'Normal package under main inspector only, own window hidden. Count state-channel sends and JSON UTF-8 payload bytes in a test wrapper; size is not actual wire bytes. Eight real blank opens/closes, five real localhost navigations, then 50 synthetic unresponsive/responsive pairs in one main turn. No renderer port, profiler, forced GC, flags or real profiles. Counts demonstrate notification work only; no general CPU/RAM/speed claim.',phases:[]};
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'");res.end('<!doctype html><title>State fixture</title><p>Local state notification fixture</p>');});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  const command=(name:string,...args:unknown[])=>driver.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
  const state=async()=>{const r=await command('getState');if(!r.ok)throw Error('Snapshot failed');return r.data;};
  const reset=()=>driver.evaluate('globalThis.stateAudit={messages:0,jsonBytes:0,revisions:[],last:null};void 0');
  const capture=async(name:string)=>{
    await wait(400);const current=await state();
    const counters=await driver.evaluate('globalThis.stateAudit');
    if(counters.last&&(counters.last.revision!==current.revision||counters.last.activeTabId!==current.activeTabId||counters.last.contextEpoch!==current.contextEpoch))throw Error('Last notification differs from current snapshot');
    report.phases.push({name,...counters,current:{revision:current.revision,contextEpoch:current.contextEpoch,activeTabId:current.activeTabId,tabs:current.tabs.length,title:current.tabs.find((t:any)=>t.tabId===current.activeTabId)?.title}});
    writeFileSync(output,JSON.stringify(report,null,2));
  };
  try{
    await driver.launch(executable,env,false,[],{mainOnly:true});report.mainPid=driver.child.pid;
    let initialized=false;
    for(let i=0;i<100;i++){try{if(await driver.evaluateUi('!!window.browser')){initialized=true;break;}}catch{}await wait(50);}
    if(!initialized)throw Error('UI readiness timed out');
    await driver.evaluate(`(()=>{const win=require('electron').BrowserWindow.getAllWindows()[0];win.hide();const ui=win.webContents,send=ui.send.bind(ui);globalThis.stateAudit={messages:0,jsonBytes:0,revisions:[],last:null};ui.send=(channel,...args)=>{if(channel==='browser:state-changed'){const a=globalThis.stateAudit,s=args[0];a.messages++;a.jsonBytes+=Buffer.byteLength(JSON.stringify(s));a.revisions.push(s.revision);a.last={revision:s.revision,activeTabId:s.activeTabId,contextEpoch:s.contextEpoch};}return send(channel,...args);};})();`);
    report.version=(await state()).appVersion;
    const opened:string[]=[];await reset();
    for(let i=0;i<8;i++){const r=await command('openTab');if(!r.ok)throw Error('Blank open failed');opened.push(r.data.tabId);}
    await capture('blank-open-8');await reset();
    for(const id of opened){const r=await command('closeTab',id);if(!r.ok)throw Error('Blank close failed');}
    await capture('blank-close-8');await reset();
    const id=(await state()).activeTabId;
    for(let i=0;i<5;i++){
      const r=await command('navigate',id,origin+'/page/'+i);if(!r.ok)throw Error('Navigate failed');
      let ready=false;for(let n=0;n<100;n++){const t=(await state()).tabs.find((t:any)=>t.tabId===id);if(t?.status==='ready'&&t.url===origin+'/page/'+i){ready=true;break;}await wait(25);}
      if(!ready)throw Error('Local navigation did not finish');
    }
    await capture('local-navigate-5');await reset();
    report.burst=await driver.evaluate(`(()=>{const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0],wc=e.webContents.getAllWebContents().find(w=>w!==win.webContents&&w.getURL().startsWith(${JSON.stringify(origin)})),view=win.contentView.children.find(v=>v.webContents===wc);if(!wc||!view)throw Error('No fixture contents');let hiddenOnEveryError=true;for(let i=0;i<50;i++){wc.emit('unresponsive');hiddenOnEveryError&&=!view.getVisible();wc.emit('responsive');}return {syntheticEvents:100,immediateMessages:globalThis.stateAudit.messages,hiddenOnEveryError};})()`);
    await capture('synthetic-health-100');
    const last=await state();if(last.tabs.find((t:any)=>t.tabId===id)?.status!=='ready'||!report.burst.hiddenOnEveryError)throw Error('Health state or native hide lost');
    report.runtimeErrorCount=driver.errors.length;if(report.runtimeErrorCount)throw Error('Child runtime error');
    report.completed=true;writeFileSync(output,JSON.stringify(report,null,2));
    process.stdout.write(JSON.stringify({completed:true,version:report.version,phases:report.phases.map((p:any)=>({name:p.name,messages:p.messages,jsonBytes:p.jsonBytes})),burst:report.burst})+'\n');
  }catch(error){report.error=error instanceof Error?error.message:'Unknown failure';writeFileSync(output,JSON.stringify(report,null,2));throw error;}
  finally{await driver.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
void main().catch(()=>{process.stderr.write('State notification audit failed; inspect sanitized output.\n');process.exitCode=1;});
