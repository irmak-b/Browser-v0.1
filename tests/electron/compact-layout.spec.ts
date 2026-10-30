import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {LAYOUT} from '../../src/shared/contracts';

let app:ElectronApplication,ui:Page;
let errors:string[]=[];
test.afterEach(async()=>{await app?.close();expect(errors).toEqual([]);});

for(const scale of [1,1.25,1.5])test(`CL-01: compact native viewport, optional panel and live page survive toggles scale=${scale}`,async({},testInfo)=>{
 const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 app=await electron.launch({args:[`--force-device-scale-factor=${scale}`,resolve('.')],env,chromiumSandbox:true});errors=[];
 app.process().stderr?.on('data',(b:Buffer)=>{if(/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(b.toString()))errors.push(b.toString());});
 ui=await app.firstWindow();await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
 const panel=ui.getByRole('complementary',{name:'Bilgi paneli',includeHidden:true}),toggle=ui.getByRole('button',{name:'Bilgi paneli',exact:true});
 await expect(panel).toBeHidden();await expect(toggle).toHaveAttribute('aria-expanded','false');
 await expect(ui.locator('.brand-row,.context-row')).toHaveCount(0);
 const opened=await ui.evaluate(async()=>{const s=await window.browser.getState();if(!s.ok)throw Error();return window.browser.navigate(s.data.activeTabId!,s.data.fixtureUrl);});expect(opened.ok).toBe(true);
 await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
 await app.evaluate(async({BrowserWindow,webContents})=>{
  const w=BrowserWindow.getAllWindows()[0]!,site=webContents.getAllWebContents().find(c=>c.id!==w.webContents.id)!;
  await site.executeJavaScript(`(()=>{window.compactSentinel=73;const c=document.createElement('canvas');c.width=320;c.height=180;const v=document.createElement('video');v.muted=true;v.autoplay=true;v.srcObject=c.captureStream(15);document.body.replaceChildren(v);setInterval(()=>{const x=c.getContext('2d');x.fillStyle='#4682b4';x.fillRect(0,0,320,180);},60);void v.play();})()`);
 });
 const identity=()=>app.evaluate(async({BrowserWindow,webContents})=>{const w=BrowserWindow.getAllWindows()[0]!,c=webContents.getAllWebContents().find(c=>c.id!==w.webContents.id)!;return {id:c.id,...await c.executeJavaScript('({origin:performance.timeOrigin,sentinel:window.compactSentinel,time:document.querySelector("video").currentTime})')};});
 await expect.poll(async()=>(await identity()).time).toBeGreaterThan(0.1);const before=await identity();
 async function geometry(open:boolean,find=false){
  await expect.poll(async()=>{
   const native=await app.evaluate(({BrowserWindow,WebContentsView})=>{const w=BrowserWindow.getAllWindows()[0]!,v=w.contentView.children.find(c=>c instanceof WebContentsView&&c.webContents.id!==w.webContents.id)!;return {bounds:v.getBounds(),content:w.getContentBounds(),visible:v.getVisible()};});
   const dom=await ui.locator('.site-area').evaluate(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};});
   return native.visible&&JSON.stringify(native.bounds)===JSON.stringify(dom)&&native.bounds.y===LAYOUT.toolbarHeight+(find?42:0)&&native.bounds.width===native.content.width-(open?LAYOUT.infoPanelWidth:0);
  }).toBe(true);
 }
 for(const size of [{width:880,height:620},{width:1280,height:900}]){
  await app.evaluate(({BrowserWindow},s)=>BrowserWindow.getAllWindows()[0]!.setSize(s.width,s.height),size);
  await geometry(false);await toggle.click();await expect(panel).toBeVisible();await geometry(true);
  await ui.getByRole('button',{name:'Bilgi panelini kapat'}).click();await expect(toggle).toBeFocused();await geometry(false);
 }
 const s=await ui.evaluate(()=>window.browser.getState());if(!s.ok)throw Error();
 await ui.evaluate(id=>window.browser.openFind(id),s.data.activeTabId!);await geometry(false,true);
 await ui.getByRole('button',{name:'Sayfa aramasını kapat'}).click();await geometry(false);
 await toggle.click();await ui.getByRole('button',{name:'Geliştirme bilgisi'}).click();await expect(ui.getByRole('dialog')).toBeVisible();
 expect(await app.evaluate(({BrowserWindow,WebContentsView})=>{const w=BrowserWindow.getAllWindows()[0]!;return w.contentView.children.find(c=>c instanceof WebContentsView&&c.webContents.id!==w.webContents.id)!.getVisible();})).toBe(false);
 await ui.getByRole('button',{name:'Sayfaya dön'}).click();await geometry(true);
 await ui.screenshot({path:testInfo.outputPath('panel-open.png')});
 await ui.getByRole('button',{name:'Bilgi panelini kapat'}).click();await geometry(false);
 const after=await identity();expect(after.id).toBe(before.id);expect(after.origin).toBe(before.origin);expect(after.sentinel).toBe(73);expect(after.time).toBeGreaterThan(before.time);
 await ui.screenshot({path:testInfo.outputPath('panel-closed.png')});
});
