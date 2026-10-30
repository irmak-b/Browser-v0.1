import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class PackagedDriver {
  child!: ChildProcess;
  browser!: Browser;
  ui!: Page;
  private mainEndpoint='';
  readonly errors: string[]=[];
  async launch(executable: string, env: NodeJS.ProcessEnv, attachRenderer=true, appArguments: string[] = [], options: {visible?:boolean;mainOnly?:boolean} = {}) {
    if(options.mainOnly&&attachRenderer)throw new Error('Main-only launch cannot attach renderer');
    const isolatedEnv={...env,BROWSER_CORE_INSTANCE_SCOPE:env.BROWSER_CORE_INSTANCE_SCOPE??randomUUID()};
    this.child=spawn(executable,['--inspect=0',...(options.mainOnly?[]:['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1']),...appArguments],{cwd:dirname(executable),env:isolatedEnv,stdio:'pipe',windowsHide:!options.visible});
    const endpoint=await new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Packaged debugger not available')),15000);
      let buffer='';
      this.child.stderr!.on('data',(data:Buffer)=>{
        const text=data.toString();
        if(/UnhandledPromiseRejection|Uncaught Exception|FATAL:/.test(text))this.errors.push(text);
        buffer=(buffer+text).slice(-8192);
        const node=/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(buffer);
        const chrome=/DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(buffer);
        if(node)this.mainEndpoint=node[1]!;
        if(options.mainOnly&&this.mainEndpoint){clearTimeout(timer);resolve(this.mainEndpoint);}
        if(chrome&&this.mainEndpoint){clearTimeout(timer);resolve(chrome[1]!);}
      });
      this.child.once('error',()=>{clearTimeout(timer);reject(new Error('Packaged child could not start'));});
      this.child.once('exit',()=>{clearTimeout(timer);reject(new Error('Packaged child exited before ready'));});
    });
    if(!attachRenderer)return;
    this.browser=await chromium.connectOverCDP(endpoint);
    const context=this.browser.contexts()[0]!;
    this.ui=context.pages().find(p=>p.url()==='app://browser/index.html')??await context.waitForEvent('page');
  }
  async evaluate(expression: string): Promise<any> {
    const socket=new WebSocket(this.mainEndpoint);
    try{
      return await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Main inspector did not respond')),5000);
        socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,includeCommandLineAPI:true,returnByValue:true,awaitPromise:true}}));
        socket.onmessage=event=>{
          const message=JSON.parse(String(event.data));if(message.id!==1)return;
          clearTimeout(timer);
          if(message.error||message.result?.exceptionDetails)reject(new Error('Main evaluation failed: '+String(message.result?.exceptionDetails?.exception?.description??message.error?.message??'unknown').slice(0,300)));
          else resolve(message.result?.result?.value);
        };
        socket.onerror=()=>{clearTimeout(timer);reject(new Error('Main inspector unavailable'));};
      });
    }finally{socket.close();}
  }
  async evaluateUi(expression: string): Promise<any> {
    // Keep site renderers detached. Schedule UI IPC, return to main, then poll
    // its result separately; awaiting nested UI->main IPC would deadlock.
    const code = `window.__resourceResult=undefined;Promise.resolve().then(()=>(${expression})).then(value=>{window.__resourceResult={ok:true,value}},()=>{window.__resourceResult={ok:false}});void 0`;
    await this.evaluate(`require('electron').BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(${JSON.stringify(code)})`);
    for (let i=0;i<200;i++) {
      const result = await this.evaluate("require('electron').BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.__resourceResult')");
      if (result) { if (!result.ok) throw new Error('UI resource command failed'); return result.value; }
      await new Promise(r=>setTimeout(r,25));
    }
    throw new Error('UI resource command timed out');
  }
  async close() {
    if(this.child&&this.child.exitCode===null){
      if(this.mainEndpoint)await this.evaluate("require('electron').BrowserWindow.getAllWindows().forEach(w=>w.close())").catch(()=>{});
      if(this.child.exitCode===null){
        let timer:ReturnType<typeof setTimeout>|undefined;
        await Promise.race([once(this.child,'exit'),new Promise<void>(r=>{timer=setTimeout(r,5000);})]).finally(()=>clearTimeout(timer));
        if(this.child.exitCode===null)this.child.kill(); // exact child owned by this test
      }
    }
    await this.browser?.close().catch(()=>{});
  }
}
