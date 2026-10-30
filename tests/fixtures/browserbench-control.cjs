// Temporary diagnostic control, not a second browser product. Same installed
// Electron, security, cache, GPU budget and DevShell view rectangle; no Core
// controller, React UI, history, adblock, preload, timer or benchmark injection.
const {app,BrowserWindow,WebContentsView,session,screen}=require('electron');
const {join,resolve}=require('node:path');
const {existsSync,writeFileSync}=require('node:fs');
const {randomUUID}=require('node:crypto');
const output=app.commandLine.getSwitchValue('bench-record');
const root=resolve(__dirname,'../..');
if(!output||!resolve(output).startsWith(join(root,'docs','evidence')+require('node:path').sep)||existsSync(output))throw Error('New workspace evidence path required');
app.setName('BrowserBench Electron Control');
app.setPath('userData',join(app.getPath('temp'),'BrowserCore-benchmark-control-'+randomUUID()));
app.commandLine.appendSwitch('force-gpu-mem-discardable-limit-mb','64');
app.whenReady().then(async()=>{
 const ses=session.fromPartition('bench-control-'+randomUUID(),{cache:false});
 ses.setUserAgent(ses.getUserAgent().replace(/\b(?:BrowserCore|browser-core|Electron)\/[\w.-]+\s*/g,'').replace(/ {2,}/g,' ').trim(),'tr-TR,tr,en-US,en');
 ses.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));
 ses.setPermissionCheckHandler(()=>false);
 const secure={nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false};
 const win=new BrowserWindow({width:1200,height:820,show:false,title:'BrowserBench · Electron kontrol',backgroundColor:'#edf1f8',webPreferences:secure});
 win.setMenu(null);
 const view=new WebContentsView({webPreferences:{...secure,session:ses}});
 win.contentView.addChildView(view);
 const resize=()=>{const {width,height}=win.getContentBounds();view.setBounds({x:0,y:196,width:Math.max(0,width-272),height:Math.max(0,height-196)});};
 win.on('resize',resize);
 view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 let metadata;
 view.webContents.once('did-finish-load',async()=>{
   // Read numeric environment once before the human starts the test. No
   // profiler, polling, DOM changes, focus changes or benchmark internals.
   metadata=await view.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visible:document.visibilityState,zoom:visualViewport.scale})');
   const display=screen.getDisplayMatching(win.getBounds());
   writeFileSync(output,JSON.stringify({kind:'same-runtime-electron-control',electron:process.versions.electron,chromium:process.versions.chrome,viewBounds:view.getBounds(),contentBounds:win.getContentBounds(),metadata,display:{size:display.size,workArea:display.workArea,scaleFactor:display.scaleFactor,displayFrequency:display.displayFrequency},cache:false,gpuCacheMiB:64,extraProfiler:false,extraInspector:false},null,2));
 });
 win.on('closed',()=>{if(!view.webContents.isDestroyed())view.webContents.close();});
 await win.loadURL('data:text/html,<title>BrowserBench · Electron kontrol</title><body style="margin:0;background:%23edf1f8;font:16px sans-serif"><p>Salt ölçüm: aynı Electron · köprüsüz WebContentsView · Browser Core katmanı yok</p></body>');
 resize();win.maximize();win.show();view.webContents.focus();
 await view.webContents.loadURL('https://browserbench.org/Speedometer3.1/');
}).catch(()=>{console.error('Benchmark control did not initialize');app.exit(1);});
app.on('window-all-closed',()=>app.quit());
