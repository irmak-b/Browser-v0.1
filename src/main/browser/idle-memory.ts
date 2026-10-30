import { app, type BrowserWindow } from 'electron';

// One moderate notification after all own site views disappear, not a periodic
// GC/working-set trim. Cookies, storage and the HTTP cache are never cleared.
export class IdleMemory {
  private timer?:ReturnType<typeof setTimeout>;
  private previous=0;
  private disposed=false;
  private generation=0;
  status:'idle'|'scheduled'|'released'|'skipped'|'unsupported'='idle';
  lastFreedKiB:number|null=null;
  constructor(private readonly window:BrowserWindow,private readonly count:()=>number){}
  update(){
    const current=this.count();
    if(current>0){clearTimeout(this.timer);this.timer=undefined;this.generation++;this.status='idle';}
    else if(this.previous>0&&!this.disposed){
      clearTimeout(this.timer);const generation=++this.generation;this.status='scheduled';
      this.timer=setTimeout(()=>{this.timer=undefined;void this.release(generation);},5000);this.timer.unref();
    }
    this.previous=current;
  }
  private async release(generation:number){
    if(this.disposed||this.window.isDestroyed()||this.count()!==0||generation!==this.generation)return;
    const wc=this.window.webContents;
    if(wc.isDestroyed()||wc.debugger.isAttached()){this.status='skipped';return;}
    const memory=()=>app.getAppMetrics().reduce((sum,p)=>sum+(p.memory.privateBytes??0),0);
    const before=memory();let attached=false;
    try{
      wc.debugger.attach('1.3');attached=true;
      // Fixed command and parameters only; never exposed to UI or site content.
      await wc.debugger.sendCommand('Memory.simulatePressureNotification',{level:'moderate'});
      this.status='released';this.lastFreedKiB=Math.max(0,before-memory());
    }catch{this.status='unsupported';}
    finally{try{if(attached&&!wc.isDestroyed()&&wc.debugger.isAttached())wc.debugger.detach();}catch{/* Window teardown may race the command response. */}}
  }
  dispose(){this.disposed=true;this.generation++;clearTimeout(this.timer);}
}
