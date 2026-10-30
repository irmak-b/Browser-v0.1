// One read-only probe of a known owned main-inspector endpoint. Port ownership
// must be checked against the measurement report's root PID before invocation.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const [output,reportPath,...ports]=process.argv.slice(2);
if(!output||existsSync(output)||!reportPath||!ports.length||ports.some(port=>!/^\d{4,5}$/.test(port)))throw Error('Fresh output, owned report and verified loopback ports required');
const report=JSON.parse(readFileSync(reportPath,'utf8').replace(/^\uFEFF/,''));
let endpoint;
for(const port of ports){try{const rows=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1500)})).json();endpoint=rows.find(row=>row.type==='node')?.webSocketDebuggerUrl;if(endpoint)break;}catch{}}
if(!endpoint)throw Error('Owned main inspector unavailable');
const expression=String.raw`(async()=>{
 const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0],w=globalThis.soak?.active;
 if(!w||w.isDestroyed())return {ownedPid:process.pid,ownerUnavailable:true};
 const page=await w.executeJavaScriptInIsolatedWorld(1006,[{code:
  '(()=>{const v=document.querySelector("video"),p=document.getElementById("movie_player"),text=document.querySelector(".ytp-error")?.textContent??"";return {youtube:location.hostname==="www.youtube.com",requestedClip:["iTHUUjTA-LI","aqz-KE-bpKQ"].includes(new URL(location.href).searchParams.get("v")),visible:document.visibilityState==="visible",duration:Number.isFinite(v?.duration)?v.duration:null,time:v?.currentTime??null,paused:v?.paused??null,videoError:v?.error?.code??null,playerState:typeof p?.getPlayerState==="function"?p.getPlayerState():null,errorCategories:{adblock:/ad.?block|reklam engelley/i.test(text),retry:/try again|tekrar deney|hata olu|error occur/i.test(text),unavailable:/unavailable|kullanılamıyor/i.test(text),signIn:/sign in|oturum aç|not a bot/i.test(text),network:/network|internet|ağ bağlant/i.test(text)},hasErrorText:text.trim().length>0};})()'
 }]);
 return {ownedPid:process.pid,windowFocused:win.isFocused(),windowVisible:win.isVisible(),...page};
})()`;
const socket=new WebSocket(endpoint);
try{
 const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Read timeout')),6000);socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,includeCommandLineAPI:true,awaitPromise:true,returnByValue:true}}));socket.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.id!==1)return;clearTimeout(timer);if(message.result?.exceptionDetails||message.error)reject(Error('Read failed'));else resolve(message.result.result.value);};socket.onerror=()=>{clearTimeout(timer);reject(Error('Inspector unavailable'));};});
 if(result.ownedPid!==report.rootPid)throw Error('Owned PID mismatch');
 const row={atUtc:new Date().toISOString(),method:'One read-only native/isolated scalar probe of the separately PID-verified own main inspector. Error text categorized only, not exported; no request/response URL, body, cookie or token.',...result};
 writeFileSync(output,JSON.stringify(row,null,2));console.log(JSON.stringify(row));
}catch{console.error('Owned scalar read unavailable');process.exitCode=1;}finally{socket.close();await new Promise(done=>setTimeout(done,100));}
