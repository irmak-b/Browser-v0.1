import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [input,output]=process.argv.slice(2);
if(!input||!output||existsSync(output))throw Error('Existing input and fresh output required');
const bytes=readFileSync(input),report=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),samples=report.samples;
const finite=values=>values.filter(Number.isFinite);
const median=values=>{const sorted=finite(values).sort((a,b)=>a-b),n=sorted.length;return n?n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2:null;};
function phase(cycle,name){
 const rows=samples.filter(row=>row.cycle===cycle&&row.phase===name);
 const intervals=rows.filter(row=>{
  const previous=samples[row.index-1];return row.cpu&&previous?.phase===name&&previous.cycle===cycle&&row.cpu.wallSeconds>=report.durations.interval/1000*.7;
 });
 const stable=intervals.filter(row=>row.cpu.stable);
 return {samples:rows.length,stableCpuIntervals:stable.length,churnCpuIntervals:intervals.length-stable.length,
  cpuHostPercentMedianStable:median(stable.map(row=>row.cpu.appHostPercentLowerBound)),
  cpuHostPercentMedianAllLowerBound:median(intervals.map(row=>row.cpu.appHostPercentLowerBound)),
  cpuCoreEquivalentsMedianStable:median(stable.map(row=>row.cpu.coreEquivalentsLowerBound)),
  hostCpuPercentMedian:median(rows.map(row=>row.hostCpuPercent)),privateMiBMedian:median(rows.map(row=>row.privateMiB)),
  privateMiBPeak:rows.length?Math.max(...rows.map(row=>row.privateMiB)):null,
  workingSetMiBMedian:median(rows.map(row=>row.workingSetMiB)),focusedSamples:rows.filter(row=>row.window.focused).length};
}
function frames(cycle){
 const probes=samples.filter(row=>row.cycle===cycle&&row.phase==='video'&&row.video);
 let total=0,dropped=0,used=0,excluded=0,progress=0;
 for(let index=1;index<probes.length;index++){
  const a=probes[index-1].video,b=probes[index].video,x=a.video,y=b.video;
  if(!a.visible||!b.visible||a.pageError||b.pageError||!x||!y||!x.playing||!y.playing||!x.width||!y.width||a.origin!==b.origin||x.width!==y.width||x.height!==y.height||y.time<x.time||!Number.isFinite(x.totalFrames)||!Number.isFinite(y.totalFrames)||y.totalFrames<x.totalFrames||y.droppedFrames<x.droppedFrames){excluded++;continue;}
  total+=y.totalFrames-x.totalFrames;dropped+=y.droppedFrames-x.droppedFrames;progress+=y.time-x.time;used++;
 }
 return {probes:probes.length,visibleProbes:probes.filter(row=>row.video.visible).length,
  focusedProbes:probes.filter(row=>row.window.focused).length,
  playingProbes:probes.filter(row=>row.video.video?.playing).length,
  pageErrorProbes:probes.filter(row=>row.video.pageError).length,
  adProbes:probes.filter(row=>row.video.ad).length,
  mediaErrorProbes:probes.filter(row=>row.video.video?.errorCode>0).length,
  dimensions:[...new Set(probes.filter(row=>row.video.video?.width).map(row=>row.video.video.width+'x'+row.video.video.height))],
  includedSegments:used,excludedSegments:excluded,observedFramesDelta:total,observedDroppedDelta:dropped,
  droppedPercent:total?100*dropped/total:null,observedMediaProgressSeconds:progress,
  limitation:'Only adjacent visible probes with matching document/dimensions and monotonic counters; not continuous physical-screen timing or full-run loss rate.'};
}
const cycles=report.cycles.map(cycle=>{
 const closed=samples.find(row=>row.index===cycle.closedSampleIndex);
 const closing=samples.filter(row=>row.cycle===cycle.cycle&&row.phase==='closed');
 const tail=closed?closing.filter(row=>row.atMs>=closed.atMs-20000):[];
 const byType={};for(const row of closed?.processes??[]){byType[row.type]=(byType[row.type]??0)+row.privateMiB;}
 return {cycle:cycle.cycle,warmup:cycle.warmup,news:cycle.news.map(page=>({label:page.label,status:page.status,errorCode:page.errorCode,interstitial:page.content.interstitial})),
  initialClip:cycle.video?.label,videoPlaybackInitiallyObserved:cycle.video?.playingObserved,
  newsPhase:phase(cycle.cycle,'news'),videoPhase:phase(cycle.cycle,'video'),frameEvidence:frames(cycle.cycle),
  closedPhase:phase(cycle.cycle,'closed'),closed:closed?{privateMiB:closed.privateMiB,workingSetMiB:closed.workingSetMiB,
    tailPrivateMiBMedian:median(tail.map(row=>row.privateMiB)),byType,mainHeapMiB:closed.mainHeapMiB,mainExternalMiB:closed.mainExternalMiB,
    cacheMiB:closed.cacheBytes/1048576,processCount:closed.processes.length,siteContents:closed.liveSiteContents,views:closed.nativeViews,
    oldCount:closed.oldCount,oldDestroyed:closed.oldDestroyed,oldListeners:closed.oldListeners,workers:closed.workers,
    uiInputListeners:closed.uiInputListeners,uiDestroyedListeners:closed.uiDestroyedListeners}:null,teardownClean:cycle.teardownClean};
});
const final=samples.at(-1),baseline=samples.filter(row=>row.phase==='baseline').at(-1);
const warmed=cycles.filter(row=>!row.warmup&&row.closed).map(row=>row.closed.tailPrivateMiBMedian);
const summary={version:report.version,inputSha256:createHash('sha256').update(bytes).digest('hex'),
 completed:report.completed,stage:report.stage,failureReason:report.failureReason??null,
 memoryLifecycleCompleted:cycles.length===report.durations.cycles&&cycles.every(cycle=>cycle.teardownClean)
  &&final.liveSiteContents===0&&final.nativeViews===0&&final.workers?.every(worker=>worker.running===0)
  &&report.cleanup?.childExited===true&&(report.runtimeErrorCount??report.cleanup?.runtimeErrorCount)===0,
 startedAtUtc:report.startedAtUtc,finishedAtUtc:report.finishedAtUtc??null,
 sampledMinutes:baseline&&final?(final.atMs-samples[0].atMs)/60000:null,
 logicalCpus:report.logicalCpus,sampleCount:samples.length,foregroundVideoValid:report.foregroundVideoValid??null,
 runtimeErrorCount:report.runtimeErrorCount??report.cleanup?.runtimeErrorCount??null,cleanup:report.cleanup,
 baseline:{privateMiB:baseline?.privateMiB,workingSetMiB:baseline?.workingSetMiB,processCount:baseline?.processes.length},
 peakPrivateMiB:Math.max(...samples.map(row=>row.privateMiB)),
 coreWarningSamples:samples.filter(row=>row.tabs?.some(tab=>tab.errorCode==='RENDER_PROCESS_UNRESPONSIVE')).length,
 crashedTabSamples:samples.filter(row=>row.tabs?.some(tab=>tab.errorCode==='RENDER_PROCESS_GONE')).length,
 cycles,postWarmupClosedTailPrivateMiB:warmed,
 final:{phase:final.phase,privateMiB:final.privateMiB,workingSetMiB:final.workingSetMiB,mainHeapMiB:final.mainHeapMiB,mainExternalMiB:final.mainExternalMiB,
  cacheMiB:final.cacheBytes===null?null:final.cacheBytes/1048576,processCount:final.processes.length,processes:final.processes,
  siteContents:final.liveSiteContents,views:final.nativeViews,workers:final.workers,idleMemory:final.idleMemory,
  uiInputListeners:final.uiInputListeners,uiDestroyedListeners:final.uiDestroyedListeners,cpu:phase(0,'final-idle')},
 limits:report.limits+' No causal gain versus an earlier version is inferred. Focus/visibility failures, player errors and CPU process churn are retained; incomplete protocol is not PASS.'};
writeFileSync(output,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({completed:summary.completed,cycles:cycles.length,sampledMinutes:summary.sampledMinutes,postWarmupClosedTailPrivateMiB:warmed,finalPrivateMiB:final.privateMiB,foregroundVideoValid:summary.foregroundVideoValid,coreWarningSamples:summary.coreWarningSamples}));
