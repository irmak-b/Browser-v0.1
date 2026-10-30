// Temporary control window: same Electron/Chromium, no Browser Core controller,
// ad filters, preload, scriptlets or URL rewriting. Fixed public query only.
const {app,BrowserWindow,session}=require('electron');
const {join}=require('node:path');const {randomUUID}=require('node:crypto');
app.setPath('userData',join(app.getPath('temp'),'BrowserCore-control-'+randomUUID()));
app.whenReady().then(async()=>{
 const variant=app.commandLine.getSwitchValue('control-variant');
 const ses=session.fromPartition('google-control-'+randomUUID(),{cache:variant==='cache-enabled'});
 let agent=ses.getUserAgent().replace(/\b(?:Electron|BrowserCore|browser-core)\/[\w.-]+\s*/g,'');
 if(variant==='reduced')agent=agent.replace(/Chrome\/(\d+)\.[\d.]+/,'Chrome/$1.0.0.0');
 if(variant!=='native-default')ses.setUserAgent(agent,'tr-TR,tr,en-US,en');
 ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false));if(variant!=='permission-check-default')ses.setPermissionCheckHandler(()=>false);
 const win=new BrowserWindow({show:false,width:1200,height:820,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 if(variant==='hints'||variant==='chrome-hints'){
  await win.loadURL('about:blank');win.webContents.debugger.attach('1.3');
  const major=process.versions.chrome.split('.')[0];
  const brands=[{brand:'Chromium',version:major},...(variant==='chrome-hints'?[{brand:'Google Chrome',version:major}]:[])];
  await win.webContents.debugger.sendCommand('Emulation.setUserAgentOverride',{userAgent:agent.replace(/Chrome\/(\d+)\.[\d.]+/,'Chrome/$1.0.0.0'),acceptLanguage:'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',userAgentMetadata:{brands,fullVersionList:brands.map(b=>({...b,version:process.versions.chrome})),platform:'Windows',platformVersion:'',architecture:'x86',bitness:'64',model:'',mobile:false}});
 }
 const extra=variant==='chromium-client'?'&client=chromium&ie=UTF-8':variant==='chrome-source'?'&source=chrome&sourceid=chrome&ie=UTF-8':variant==='region'?'&gl=tr':variant==='unpersonalized'?'&pws=0':'';
 void win.loadURL(app.commandLine.getSwitchValue('control-origin')||'https://www.google.com/search?q=youtube&hl=tr'+extra).catch(()=>{});
});
app.on('window-all-closed',()=>app.quit());
