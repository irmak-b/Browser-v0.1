import type {WebContents} from 'electron';
import {hasAdDebugger} from './ad-scriptlets';

// A fixed internal lifecycle command, never a general CDP/executeScript bridge.
// Frozen pages keep DOM/JS state; this chiefly stops background computation.
export class PageFreezer {
  private readonly owned=new WeakSet<WebContents>();
  private readonly borrowed=new WeakSet<WebContents>();
  async freeze(wc:WebContents){
    if(wc.isDestroyed()||wc.isDevToolsOpened()||wc.debugger.isAttached()&&!hasAdDebugger(wc))return false;
    let attached=false;
    try{
      if(hasAdDebugger(wc))this.borrowed.add(wc);
      else{wc.debugger.attach('1.3');attached=true;}
      this.owned.add(wc);
      await wc.debugger.sendCommand('Page.setWebLifecycleState',{state:'frozen'});
      return !wc.isDestroyed();
    }catch{if(attached||this.borrowed.has(wc))this.detach(wc);return false;}
  }
  async resume(wc:WebContents){
    if(!this.owned.has(wc)||wc.isDestroyed())return;
    try{if(wc.debugger.isAttached())await wc.debugger.sendCommand('Page.setWebLifecycleState',{state:'active'});}
    finally{this.detach(wc);}
  }
  detach(wc:WebContents){
    if(!this.owned.delete(wc))return;
    if(this.borrowed.delete(wc))return;
    if(!wc.isDestroyed()&&wc.debugger.isAttached())wc.debugger.detach();
  }
}
