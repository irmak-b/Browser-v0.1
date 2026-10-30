import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { PackagedDriver } from '../tests/packaged/driver';
import version from '../app-version.json';

// Own disposable local fixture only. Detaching below is a diagnostic control,
// never a production change to the ad filter or a real browser profile.
async function main() {
const output = process.argv[2];
if (!output) throw new Error('Evidence output path required');
const rows: unknown[] = [];
const executable = resolve(`artifacts/BrowserCore_${version.display}_Windows_x64/BrowserCore.exe`);
for (const detach of process.argv[3] === 'detached' ? [true] : [false, true]) {
  const driver = new PackagedDriver();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS;
  try {
    await driver.launch(executable, env, false, [], { mainOnly: true });
    const deadline = Date.now() + 15000;
    while (true) {
      const ready = await driver.evaluateUi("document.body.innerText.includes('Browser Core bağlı')").catch(() => false);
      if (ready) break;
      if (Date.now() > deadline) throw new Error('Own fixture UI not ready');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const opened = await driver.evaluateUi("window.browser.getState().then(s=>{if(!s.ok)throw new Error();return window.browser.navigate(s.data.activeTabId,new URL('/page/1',s.data.fixtureUrl).href);})");
    if (!opened.ok) throw new Error('Local navigation failed');
    for (let i = 0; i < 100; i++) {
      const ready = await driver.evaluateUi("window.browser.getState().then(s=>s.ok&&s.data.tabs[0].status==='ready')");
      if (ready) break;
      if (i === 99) throw new Error('Local page not ready');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const initial = await driver.evaluate(`(()=>{
      const e=require('electron'),win=e.BrowserWindow.getAllWindows()[0];win.show();win.focus();
      const wc=e.webContents.getAllWebContents().find(w=>w.getURL().endsWith('/page/1'));wc.focus();
      const before=wc.debugger.isAttached();
      if(${detach}&&before)wc.debugger.detach();
      globalThis.coreHangProbe={unresponsive:0,responsive:0,finished:false};
      wc.on('unresponsive',()=>globalThis.coreHangProbe.unresponsive++);
      wc.on('responsive',()=>globalThis.coreHangProbe.responsive++);
      void wc.executeJavaScript('(()=>{const end=Date.now()+12000;while(Date.now()<end){};return true;})()').then(()=>globalThis.coreHangProbe.finished=true).catch(()=>{});
      for(const delay of [200,1200,2200,3200])setTimeout(()=>{if(!wc.isDestroyed()){wc.sendInputEvent({type:'keyDown',keyCode:'A'});wc.sendInputEvent({type:'keyUp',keyCode:'A'});}},delay);
      return {beforeDebugger:before,duringDebugger:wc.debugger.isAttached(),visible:win.isVisible(),focused:win.isFocused(),electron:process.versions.electron,chrome:process.versions.chrome};
    })()`);
    await new Promise(resolve => setTimeout(resolve, 3500));
    const uiDuringHang = await driver.evaluateUi("window.browser.getState().then(s=>({ok:s.ok,connected:document.body.innerText.includes('Browser Core bağlı')}))");
    await new Promise(resolve => setTimeout(resolve, 9500));
    const observed = await driver.evaluate('globalThis.coreHangProbe');
    const after = await driver.evaluateUi("window.browser.getState().then(s=>s.ok?{status:s.data.tabs[0].status,error:s.data.tabs[0].errorCode}:null)");
    const row = { detachedInTestOnly: detach, durationMs: 12000, initial, uiDuringHang, observed, after };
    rows.push(row);
    console.log(JSON.stringify(row));
  } catch (error) {
    rows.push({ detachedInTestOnly: detach, failed: true, error: String(error).slice(0, 400) });
    throw error;
  } finally {
    await driver.close();
    writeFileSync(resolve(output), JSON.stringify({ version: version.display, method: 'one local finite busy loop per owned packaged process; no event injection', rows }, null, 2)+'\n');
  }
}
writeFileSync(resolve(output), JSON.stringify({ version: version.display, method: 'one local finite busy loop per owned packaged process; no event injection', rows }, null, 2)+'\n');
}
void main().catch(error => { console.error('Local watchdog diagnostic did not complete: '+String(error).slice(0, 400)); process.exitCode = 1; });
