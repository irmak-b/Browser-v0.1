import type { WebContents } from 'electron';
import { createHash } from 'node:crypto';
import { jsonEditFastPath } from './json-edit-fast-path';

const attachedByFilters=new WeakSet<WebContents>();
export const hasAdDebugger=(wc:WebContents)=>attachedByFilters.has(wc)&&!wc.isDestroyed()&&wc.debugger.isAttached();
interface Connection { generation:number;scriptId?:string;inputHash?:string;queue:Promise<unknown>;release:(detach?:boolean)=>void }

export function documentFilterDigest(host:string,scripts:string[],fallbackHosts:string[]=[],fallbackScripts:string[]=[]){
  const hash=createHash('sha256').update('browser-core-scriptlet-input-v1;');
  // Length-delimited groups preserve order and boundaries without joining the
  // large sources. UTF-16LE also distinguishes lone JS surrogate code units.
  for(const group of [[host],scripts,fallbackHosts,fallbackScripts]){
    hash.update(group.length+';');
    for(const text of group)hash.update(text.length+':').update(text,'utf16le');
  }
  return hash.digest('hex');
}

export function documentFilterSource(host:string,scripts:string[],fallbackHosts:string[]=[],fallbackScripts:string[]=[]){
  const hosts=host==='youtube.com'?['youtube.com','www.youtube.com']:[host];
  // Share uBO's safeSelf snapshot across scriptlets without merging their
  // function declarations or exposing state on the page's global object.
  // The resource prelude's var scriptletGlobals reuses this parameter binding.
  const wrap=(items:string[])=>`const sharedGlobals={};${jsonEditFastPath(items).map(s=>`try{((scriptletGlobals)=>{${s}\n})(sharedGlobals);}catch{}`).join('\n')}`;
  return `(()=>{if(!/^https?:$/.test(location.protocol))return;if(${JSON.stringify(hosts)}.includes(location.hostname)){${wrap(scripts)}}else if(${JSON.stringify(fallbackHosts)}.includes(location.hostname)){${wrap(fallbackScripts)}}})();`;
}

// One main-only connection per live filtered contents. No network port, site
// preload, IPC bridge, page inspection or event trace. Fixed Page commands only.
export class AdScriptlets {
  private readonly connections=new Map<WebContents,Connection>();
  stop(wc:WebContents){this.connections.get(wc)?.release();}
  clear(wc:WebContents){return this.arm(wc,'',[]);}
  async arm(wc:WebContents,host:string,scripts:string[],fallbackHosts:string[]=[],fallbackScripts:string[]=[]){
    if(wc.isDestroyed())return false;
    let connection=this.connections.get(wc);
    if(!connection){
      if((!scripts.length&&!fallbackScripts.length)||wc.debugger.isAttached()||wc.isDevToolsOpened())return false;
      const detached=()=>connection!.release(false);
      const destroyed=()=>connection!.release(false);
      const crashed=()=>{connection!.inputHash=undefined;};
      let released=false;
      connection={generation:0,queue:Promise.resolve(),release:(detach=true)=>{
        if(released)return;released=true;connection!.generation++;
        this.connections.delete(wc);attachedByFilters.delete(wc);
        wc.off('destroyed',destroyed);wc.off('render-process-gone',crashed);wc.debugger.off('detach',detached);
        try{if(detach&&!wc.isDestroyed()&&wc.debugger.isAttached())wc.debugger.detach();}catch{ /* closed */ }
      }};
      try{wc.debugger.attach('1.3');}catch{return false;}
      this.connections.set(wc,connection);attachedByFilters.add(wc);
      wc.once('destroyed',destroyed);wc.on('render-process-gone',crashed);wc.debugger.once('detach',detached);
    }
    const current=connection,generation=++current.generation;
    const task=current.queue.catch(()=>{}).then(async()=>{
      if(this.connections.get(wc)!==current||current.generation!==generation||wc.isDestroyed())return false;
      const hasScripts=scripts.length>0||fallbackScripts.length>0;
      const hash=documentFilterDigest(host,scripts,fallbackHosts,fallbackScripts);
      // Check raw inputs before rebuilding wrappers/JSON fast-path sources.
      // Keep only a digest per connection, never a retained large source copy.
      if(hasScripts&&current.scriptId&&current.inputHash===hash)return true;
      current.inputHash=undefined;
      if(current.scriptId){await wc.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:current.scriptId});current.scriptId=undefined;}
      if(!hasScripts)return true;
      await wc.debugger.sendCommand('Page.enable');
      if(current.generation!==generation)return false;
      const source=documentFilterSource(host,scripts,fallbackHosts,fallbackScripts);
      const result=await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source});current.scriptId=result.identifier;
      if(current.generation!==generation||this.connections.get(wc)!==current)return false;
      current.inputHash=hash;return true;
    });
    current.queue=task;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([task,new Promise<boolean>(resolve=>{timer=setTimeout(()=>{current.release();resolve(false);},1500);})]);}
    catch{current.release();return false;}finally{clearTimeout(timer);}
  }
  dispose(){for(const connection of [...this.connections.values()])connection.release();}
}
