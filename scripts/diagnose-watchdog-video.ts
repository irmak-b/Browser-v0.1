// Owned fresh test instance. Hidden window and virtual focus are deliberate:
// this is native probe correctness diagnosis, never foreground performance.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PackagedDriver } from '../tests/packaged/driver';

async function main(){
 const output=process.argv[2],version=process.argv[3]??'V1.0.13.4';if(!output||existsSync(output)||!/^V1\.0\.13\.[45]$/.test(version))throw Error('New report and known package required');
 const driver=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 const report:any={version,completed:false,method:'Existing package, fresh session, only public NASA clip. Hidden window with focus/visibility guards virtualized for native correctness diagnosis while user can work. Prototype wrapper records only fixed 0 probe start/settle/types, no scripts/payloads/URLs. Not performance evidence.',samples:[]};
 const save=()=>writeFileSync(output,JSON.stringify(report,null,2));
 const cmd=(name:string,...args:unknown[])=>driver.evaluateUi(`window.browser.${name}(...${JSON.stringify(args)})`);
 try{
  await driver.launch(resolve(`artifacts/BrowserCore_${version}_Windows_x64/BrowserCore.exe`),env,false,[],{mainOnly:true});
  for(let i=0;i<100;i++){try{if(await driver.evaluateUi('!!window.browser'))break;}catch{}await new Promise(r=>setTimeout(r,50));}
  await driver.evaluate(`(()=>{const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0];win.hide();win.isFocused=()=>true;win.isVisible=()=>true;win.isMinimized=()=>false;
   globalThis.probeDiag={started:performance.now(),calls:[],navigation:[],frames:new WeakMap(),nextFrame:0,nativeUnresponsive:0,nativeResponsive:0,manual:[]};
   const proto=Object.getPrototypeOf(win.webContents.mainFrame),original=proto.executeJavaScript;
   proto.executeJavaScript=function(code,...args){if(code!=='0')return original.call(this,code,...args);const a=globalThis.probeDiag;if(!a.frames.has(this))a.frames.set(this,++a.nextFrame);const row={at:performance.now()-a.started,frameObject:a.frames.get(this),frameToken:this.frameToken,settled:false};a.calls.push(row);return original.call(this,code,...args).then(value=>{Object.assign(row,{settled:true,elapsed:performance.now()-a.started-row.at,type:typeof value,isZero:value===0});return value;},error=>{Object.assign(row,{settled:true,rejected:true,errorName:error.name});throw error;});};
   e.app.on('web-contents-created',(_event,w)=>{globalThis.probeDiag.owner=w;w.on('unresponsive',()=>globalThis.probeDiag.nativeUnresponsive++);w.on('responsive',()=>globalThis.probeDiag.nativeResponsive++);w.on('did-start-navigation',event=>{if(event.isMainFrame)globalThis.probeDiag.navigation.push({event:'start',sameDocument:event.isSameDocument,at:performance.now()-globalThis.probeDiag.started});});w.on('did-navigate',()=>globalThis.probeDiag.navigation.push({event:'commit',at:performance.now()-globalThis.probeDiag.started,frameToken:w.mainFrame.frameToken}));});e.dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});})();`);
  const opened=await cmd('openTab','https://www.youtube.com/watch?v=iTHUUjTA-LI');if(!opened.ok)throw Error('Open failed');
  await cmd('setTabMuted',opened.data.tabId,true);
  for(let tick=0;tick<20;tick++){
   await new Promise(r=>setTimeout(r,2000));
   const state=await cmd('getState');
   const row:any={tick,tab:state.data.tabs.filter((t:any)=>t.tabId===opened.data.tabId).map((t:any)=>({status:t.status,errorCode:t.errorCode,loading:t.loading})),trace:await driver.evaluate('globalThis.probeDiag?({calls:globalThis.probeDiag.calls,navigation:globalThis.probeDiag.navigation,nativeUnresponsive:globalThis.probeDiag.nativeUnresponsive,nativeResponsive:globalThis.probeDiag.nativeResponsive,manual:globalThis.probeDiag.manual}):null')};
   row.isolated=await driver.evaluate(`globalThis.probeDiag.owner.executeJavaScriptInIsolatedWorld(1006,[{code:'(()=>{const v=document.querySelector("video");if(v){v.muted=true;if(v.paused)void v.play().catch(()=>{});}return {zero:0,ready:document.readyState,time:v?.currentTime??0,visible:document.visibilityState==="visible"};})()'}])`).catch(()=>({unavailable:true}));
   if(tick===7)await driver.evaluate(`(()=>{const a=globalThis.probeDiag,w=a.owner;const start=performance.now();for(const [name,operation] of [['frame',()=>w.mainFrame.executeJavaScript('0')],['contents',()=>w.executeJavaScript('0')],['cdp',()=>w.debugger.sendCommand('Runtime.evaluate',{expression:'0',returnByValue:true})]]){const row={name,settled:false};a.manual.push(row);void operation().then(v=>Object.assign(row,{settled:true,elapsed:performance.now()-start,isZero:name==='cdp'?v.result?.value===0:v===0}),()=>Object.assign(row,{settled:true,rejected:true}));}})()`);
   report.samples.push(row);save();
  }
  report.completed=true;report.runtimeErrorCount=driver.errors.length;save();console.log('PROBE_DIAG '+JSON.stringify(report.samples.at(-1)));
 }finally{await driver.close();report.childExited=driver.child.exitCode!==null||driver.child.signalCode!==null;save();}
}
main().catch(error=>{console.error('Probe diagnosis failed: '+error.name);process.exitCode=1;});
