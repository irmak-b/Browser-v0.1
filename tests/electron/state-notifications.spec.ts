import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {CHANNEL} from '../../src/shared/contracts';

let application:ElectronApplication,ui:Page;
test.beforeAll(async()=>{
  const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  application=await electron.launch({args:[resolve('.')],env,chromiumSandbox:true});
  ui=await application.firstWindow();await expect(ui.getByText('Browser Core bağlı',{exact:true})).toBeVisible();
});
test.afterAll(async()=>{await application?.close();});

test('SB-01: bursts send the latest state once; native safety, live getState, epoch and UI agree',async()=>{
  await ui.evaluate(async()=>{const r=await window.browser.getState();if(!r.ok)throw Error();await window.browser.navigate(r.data.activeTabId!,r.data.fixtureUrl);});
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  // Let the existing 300ms ad-counter notifier finish before isolating a burst.
  await new Promise(r=>setTimeout(r,400));
  await ui.evaluate(()=>{(window as any).__stateEvents=[];window.browser.onStateChanged(s=>(window as any).__stateEvents.push({revision:s.revision,epoch:s.contextEpoch,active:s.activeTabId,status:s.tabs.find(t=>t.tabId===s.activeTabId)?.status}));});
  const burst=await application.evaluate(({BrowserWindow,webContents},channel)=>{
    const win=BrowserWindow.getAllWindows()[0]!,ui=win.webContents;
    const site=webContents.getAllWebContents().find(w=>w!==ui&&w.getURL().startsWith('http://127.0.0.1:'))!;
    const view=win.contentView.children.find(v=>(v as Electron.WebContentsView).webContents===site)!;
    const send=ui.send.bind(ui),audit={sent:0,revisions:[] as number[]};(globalThis as any).__notificationAudit=audit;
    ui.send=(name,...args)=>{if(name===channel){audit.sent++;audit.revisions.push(args[0].revision);}return send(name,...args);};
    let hidden=true;
    for(let i=0;i<50;i++){site.emit('unresponsive');hidden&&=!view.getVisible();site.emit('responsive');}
    return {immediateSent:audit.sent,hidden};
  },CHANNEL.state);
  expect(burst).toEqual({immediateSent:0,hidden:true});
  await expect.poll(()=>application.evaluate(()=>(globalThis as any).__notificationAudit.sent)).toBe(1);
  await expect.poll(()=>ui.evaluate(()=>(window as any).__stateEvents.length)).toBe(1);
  await expect(ui.getByTestId('page-status')).toHaveText('Hazır');
  const snapshot=await ui.evaluate(async()=>{const r=await window.browser.getState();if(!r.ok)throw Error();return r.data;});
  expect(await ui.evaluate(()=>(window as any).__stateEvents[0])).toEqual({revision:snapshot.revision,epoch:snapshot.contextEpoch,active:snapshot.activeTabId,status:'ready'});
  // Switching context must publish the new epoch only, never a captured old
  // snapshot. The trusted API can always read the current main-owned state.
  await ui.evaluate(async()=>{const r=await window.browser.switchDevelopmentIdentity('test-b');if(!r.ok)throw Error(r.message);});
  await expect.poll(()=>ui.evaluate(async()=>{const r=await window.browser.getState();return r.ok?r.data.developmentIdentity:'';})).toBe('test-b');
  const after=await ui.evaluate(async()=>{const r=await window.browser.getState();if(!r.ok)throw Error();return {state:r.data,last:(window as any).__stateEvents.at(-1)};});
  expect(after.state.contextEpoch).not.toBe(snapshot.contextEpoch);
  expect(after.last.epoch).toBe(after.state.contextEpoch);
  expect(after.last.revision).toBe(after.state.revision);
  expect(after.state.tabs).toHaveLength(1);expect(after.state.tabs[0]?.status).toBe('empty');
});
