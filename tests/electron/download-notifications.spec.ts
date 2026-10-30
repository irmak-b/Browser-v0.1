import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { CHANNEL, type BrowserSnapshot } from '../../src/shared/contracts';

let app: ElectronApplication, ui: Page;
test.beforeAll(async () => {
  const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await electron.launch({args:[resolve('.')],env,chromiumSandbox:true});
  ui=await app.firstWindow();await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
});
test.afterAll(async () => {
  if(app){await app.evaluate(()=>{(globalThis as any).__downloadRestore?.();});await app.close();}
});
async function state():Promise<BrowserSnapshot>{return ui.evaluate(async()=>{const r=await window.browser.getState();if(!r.ok)throw Error('State failed');return r.data;});}

test('DN-01: one metadata burst publishes latest downloads once; context reset cannot replay the old list',async()=>{
  const initial=await state();
  await ui.evaluate(({id,url})=>window.browser.navigate(id,url),{id:initial.activeTabId!,url:initial.fixtureUrl});
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  await ui.evaluate(()=>{
    const scope=window as any;scope.__downloadEvents=[];
    scope.__downloadOff=window.browser.onDownloadChanged(event=>scope.__downloadEvents.push(event));
  });
  const immediate=await app.evaluate(({BrowserWindow,webContents},channels)=>{
    const win=BrowserWindow.getAllWindows()[0]!,owner=webContents.getAllWebContents().find(wc=>wc.getURL().startsWith('http://127.0.0.1:'))!;
    const send=win.webContents.send.bind(win.webContents),audit={downloads:0,states:0,serializedJsonBytes:0};
    (globalThis as any).__downloadAudit=audit;
    (globalThis as any).__downloadRestore=()=>{win.webContents.send=send;};
    win.webContents.send=(channel,...args)=>{
      if(channel===channels.download){audit.downloads++;audit.serializedJsonBytes+=Buffer.byteLength(JSON.stringify(args[0]),'utf8');}
      if(channel===channels.state)audit.states++;
      return send(channel,...args);
    };
    let cancelled=0;
    // Native session/owner, metadata adapters only. No URL request or file is created.
    for(let i=0;i<20;i++)owner.session.emit('will-download',{preventDefault:()=>cancelled++},{getURL:()=>new URL('/download?burst='+i,owner.getURL()).href,getTotalBytes:()=>4096,getFilename:()=>`burst-${i}.bin`},owner);
    return {downloads:audit.downloads,states:audit.states,cancelled};
  },{download:CHANNEL.download,state:CHANNEL.state});
  console.log('DOWNLOAD_BURST_IMMEDIATE '+JSON.stringify(immediate));
  expect(immediate).toEqual({downloads:0,states:0,cancelled:20});
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).__downloadAudit.downloads)).toBe(1);
  await expect.poll(()=>ui.evaluate(()=>(window as any).__downloadEvents.length)).toBe(1);
  const s=await state();expect(s.downloads).toHaveLength(20);expect(s.downloads.every(d=>d.status==='awaiting-approval')).toBe(true);
  expect(await ui.evaluate(()=>(window as any).__downloadEvents[0])).toEqual({contextEpoch:s.contextEpoch,downloads:s.downloads});
  const burst=await app.evaluate(()=>(globalThis as any).__downloadAudit);
  expect(burst.states).toBe(1);
  await ui.evaluate(()=>window.browser.switchDevelopmentIdentity('test-b'));
  const next=await state();expect(next.contextEpoch).not.toBe(s.contextEpoch);expect(next.downloads).toEqual([]);
  await expect.poll(()=>ui.evaluate(()=>(window as any).__downloadEvents.at(-1)?.contextEpoch)).toBe(next.contextEpoch);
  expect(await ui.evaluate(()=>(window as any).__downloadEvents.at(-1))).toEqual({contextEpoch:next.contextEpoch,downloads:[]});
  expect(await ui.evaluate(epoch=>{const events=(window as any).__downloadEvents;const index=events.findIndex((event:any)=>event.contextEpoch===epoch);return events.slice(index).every((event:any)=>event.contextEpoch===epoch&&event.downloads.length===0);},next.contextEpoch)).toBe(true);
  await ui.evaluate(()=>{(window as any).__downloadOff();delete (window as any).__downloadOff;});
  console.log('DOWNLOAD_BURST_FINAL '+JSON.stringify({metadataEvents:20,downloadMessages:burst.downloads,stateMessages:burst.states,serializedJsonBytes:burst.serializedJsonBytes,latestRows:20,newContextRows:0,oldListReplayed:false}));
});
