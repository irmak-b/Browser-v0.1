// Local, repeatable packaged-app measurement; no external sites or downloads.
import { createServer } from 'node:http';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus, release, totalmem } from 'node:os';
import { PackagedDriver } from '../tests/packaged/driver';

async function main() {
const [exeArg, outputArg] = process.argv.slice(2);
if (!exeArg || !outputArg) throw new Error('Usage: tsx scripts/measure-resources.ts <existing exe> <report.json>');
const executable = resolve(exeArg), output = resolve(outputArg);
if (!existsSync(executable) || existsSync(output)) throw new Error('Existing executable and new report path required');
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const html = '<!doctype html><meta charset="utf-8"><title>Local resource fixture</title>'
  + '<p>Static, no script/form/media; safe discard candidate.</p>'
  + Array.from({ length: 4000 }, (_, i) => `<p>${i} ${'local resource fixture '.repeat(10)}</p>`).join('');
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'"); res.end(html);
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS;
const runs: unknown[] = [];
try {
  for (let repetition = 1; repetition <= 3; repetition++) {
    const d = new PackagedDriver();
    try {
      await d.launch(executable, env, false);
      const ui = (expression: string) => d.evaluateUi(expression);
      for(let i=0;i<100;i++) { try { if(await ui('!!window.browser'))break; } catch {} await wait(50); }
      const getState = async () => { const r=await ui('window.browser.getState()');if(!r.ok)throw new Error();return r.data; };
      const command = (method:string,...args:unknown[]) => ui(`window.browser.${method}(...${JSON.stringify(args)})`);
      const ready = async(count:number) => { for(let i=0;i<200;i++){if((await getState()).tabs.filter((t:any)=>t.status==='ready').length===count)return;await wait(50);}throw new Error('Local pages not ready'); };
      const stages: unknown[] = [];
      const sample = async (name: string) => {
        await wait(1000);
        await d.evaluate("require('electron').app.getAppMetrics();void 0");
        const values = [];
        for (let i = 0; i < 5; i++) {
          await wait(500);
          values.push(await d.evaluate(`(() => {
            const e=require('electron'), m=e.app.getAppMetrics();
            return {workingSetKiB:m.reduce((s,p)=>s+p.memory.workingSetSize,0),
              privateKiB:m.reduce((s,p)=>s+(p.memory.privateBytes||0),0),
              cpuPercent:m.reduce((s,p)=>s+p.cpu.percentCPUUsage,0),processes:m.length,
              siteContents:e.webContents.getAllWebContents().filter(w=>w.getType()!=='window').length,
              siteViews:e.BrowserWindow.getAllWindows()[0].contentView.children.filter(v=>v instanceof e.WebContentsView&&v.webContents.id!==e.BrowserWindow.getAllWindows()[0].webContents.id).length};
          })()`));
        }
        const state = await getState();
        stages.push({ name, version:state.appVersion,tabs:state.tabs.length,sleeping:state.tabs.filter((t:any)=>t.status==='sleeping').length,samples: values });
      };
      await sample('one-empty');
      for(let i=1;i<10;i++)await command('openTab');
      await sample('ten-empty');
      for(const t of (await getState()).tabs.slice(1))await command('closeTab',t.tabId);
      await sample('after-closing-empty');
      await command('navigate',(await getState()).activeTabId,origin+'/static/0');await ready(1);
      await sample('one-static');
      for(let i=1;i<10;i++)await command('openTab',origin+'/static/'+i);await ready(10);
      await sample('ten-static');
      // Exercise the real production timer policy without waiting five minutes
      // per repetition. This changes only the test child's main Date clock.
      await d.evaluate('(()=>{const now=Date.now;Date.now=()=>now()+360000;})()');
      await command('activateTab',(await getState()).activeTabId);await wait(1800);
      await sample('ten-static-after-idle');
      for(const t of (await getState()).tabs.slice(0,9))await command('closeTab',t.tabId);
      await sample('after-closing-static');
      runs.push({ repetition, stages, errors:d.errors });
      console.log(`Measurement repetition ${repetition}/3 complete`);
    } finally { await d.close(); }
  }
} finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); }
writeFileSync(output, JSON.stringify({ recordedAt:new Date().toISOString(), executable,
  environment:{os:release(),arch:process.arch,cpu:cpus()[0]?.model,logicalCPUs:cpus().length,ramBytes:totalmem()},
  method:'3 fresh app launches; five samples/stage, 500ms apart after 1s settle. Electron app.getAppMetrics totals all app processes. Working sets include shared pages; private bytes reported separately. Local static 4000-paragraph pages, CSP default-src none. Node inspector only; no renderer CDP attached. After-idle advances only child main Date.now by 6 minutes and reselects active tab to reschedule production timeout. No real profile/URLs read. CPU is Electron percentCPUUsage. Same-machine indicative comparison, not universal benchmark.', runs },null,2)+'\n');
console.log('Report: '+output);
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
