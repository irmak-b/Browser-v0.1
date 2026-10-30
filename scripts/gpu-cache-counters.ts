import type {PackagedDriver} from '../tests/packaged/driver';

// Own diagnostic child only. For real-site runs call only AFTER site contents
// have closed. Background numeric counters, not heap/page contents or a trace.
export async function gpuCacheCounters(driver:PackagedDriver){
 try{
  const started=await driver.evaluate(`(async()=>{const e=require('electron'),wc=e.BrowserWindow.getAllWindows()[0].webContents,gpu=e.app.getAppMetrics().find(p=>p.type==='GPU');
   if(!gpu||wc.debugger.isAttached())return false;
   globalThis.__gpuCacheCounts={gpuPid:gpu.pid,dumps:0,complete:false,entries:[]};
   const handler=(_event,method,params)=>{
    const result=globalThis.__gpuCacheCounts;
    if(method==='Tracing.tracingComplete')result.complete=true;
    if(method!=='Tracing.dataCollected')return;
    for(const item of params.value??[]){
     if(item.pid!==result.gpuPid||!item.args?.dumps?.allocators)continue;
     result.dumps++;
     for(const [name,value] of Object.entries(item.args.dumps.allocators)){
      if(!/^(gpu\\/transfer_cache\\/|skia\\/gpu_resources|gpu\\/command_buffer|malloc(?:\\/|$)|partition_alloc(?:\\/|$)|winheap(?:\\/|$))/.test(name))continue;
      const attributes={};
      for(const [key,attr] of Object.entries(value.attrs??{})){
       if(!['size','resident_size','allocated_size','active_size','decommittable_size','discardable_size'].includes(key)||attr.type!=='scalar'||attr.units!=='bytes')continue;
       const bytes=typeof attr.value==='number'?attr.value:parseInt(attr.value,16);if(Number.isFinite(bytes))attributes[key]=bytes;
      }
      if(Object.keys(attributes).length&&result.entries.length<128)result.entries.push({category:name.replace(/0x[0-9a-f]+/gi,'instance'),attributes});
     }
    }
   };
   globalThis.__gpuCacheCounterHandler=handler;wc.debugger.attach('1.3');wc.debugger.on('message',handler);
   await wc.debugger.sendCommand('Tracing.start',{traceConfig:{recordMode:'recordUntilFull',includedCategories:['disabled-by-default-memory-infra'],memoryDumpConfig:{triggers:[]}}});
   await wc.debugger.sendCommand('Tracing.requestMemoryDump',{levelOfDetail:'background'});
   await wc.debugger.sendCommand('Tracing.end');return true;})()`);
  if(!started)return {supported:false,reason:'No GPU or debugger already attached'};
  for(let i=0;i<100;i++){
   const result=await driver.evaluate('globalThis.__gpuCacheCounts');
   if(result.complete)return {supported:true,...result};
   await new Promise(r=>setTimeout(r,100));
  }
  return {supported:false,reason:'Numeric counter collection timed out'};
 }catch{return {supported:false,reason:'Background GPU counters unavailable'};}
 finally{
  await driver.evaluate(`(()=>{const wc=require('electron').BrowserWindow.getAllWindows()[0]?.webContents;
   if(wc&&globalThis.__gpuCacheCounterHandler){wc.debugger.off('message',globalThis.__gpuCacheCounterHandler);if(wc.debugger.isAttached())wc.debugger.detach();}
   globalThis.__gpuCacheCounterHandler=undefined;globalThis.__gpuCacheCounts=undefined;})()`).catch(()=>{});
 }
}
