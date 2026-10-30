import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';

const output=resolve(process.argv[2]??'');
if(!output.startsWith(resolve('docs/evidence')+sep)||!output.endsWith('.json')||existsSync(output))throw Error('Fresh evidence JSON required');
const inputs=[];
function read(name){const path=`docs/evidence/p2-v1.0.13.6-core-completion-${name}.json`,body=readFileSync(path);inputs.push({path,sha256:createHash('sha256').update(body).digest('hex')});return JSON.parse(body);}
const gpu=read('gpu16'),ready=read('gpu-ready3'),player=read('player-dom-pair'),interfering=read('player-pair');
const gpuMiB=s=>s.processes.filter(p=>p.type==='GPU').reduce((sum,p)=>sum+p.privateMiB,0);
const closed=gpu.samples.filter(s=>s.label==='closed-10s'),late=closed.filter(s=>s.cycle>=4),final=gpu.samples.at(-1);
const range=a=>({min:Math.min(...a),max:Math.max(...a),span:Math.max(...a)-Math.min(...a)});
const result={version:'V1.0.13.6',recordedAt:new Date().toISOString(),inputs,
 gpu:{completed:gpu.completed,cycles:gpu.cycles,pages:gpu.cycles*3,draws:gpu.checks.reduce((s,c)=>s+c.fixture.reduce((n,f)=>n+f.draws,0),0),
  seconds:final.seconds,closedGpuMiB:closed.map(s=>({cycle:s.cycle,miB:gpuMiB(s)})),lateGpuRangeMiB:range(late.map(gpuMiB)),
  sameGpuPid:new Set(gpu.samples.flatMap(s=>s.processes.filter(p=>p.type==='GPU').map(p=>p.pid))).size===1,
  closedSiteContentsAndViewsZero:gpu.samples.filter(s=>s.label!=='loaded').every(s=>s.siteContents===0&&s.siteViews===0),
  final:{privateMiB:final.privateMiB,gpuPrivateMiB:gpuMiB(final),mainHeapMiB:final.mainHeapMiB,mainExternalMiB:final.mainExternalMiB,cacheBytes:final.cacheBytes,counters:final.counters},
  finding:'Bounded warmup/retention in this fixed finite background workload. No observed unbounded per-cycle growth; no proof every site/driver is leak-free or exact attribution of all private commit to the driver. Overlapping allocator parents must not be summed.',
  policyChange:false},
 gpuReadiness:{completed:ready.completed,cycles:ready.cycles,startupFeatureStatusUsable:false,
  reason:'Electron45 local declaration: getGPUFeatureStatus and isHardwareAccelerationEnabled usable only after gpu-info-update; early startup snapshot is not authoritative.',
  firstDelayedStatus:ready.samples[0].gpuFeatures,lastDelayedStatus:ready.samples.at(-1).gpuFeatures,
  delayedAccelerationFeaturesEnabled:ready.samples.every(s=>['gpu_compositing','video_decode','webgl'].every(k=>s.gpuFeatures[k]==='enabled'))},
 player:{completed:player.completed,visibility:'background',runs:player.runs.map(r=>({mode:r.mode,completed:r.completed,childExited:r.childExited,samples:r.samples.length,
   displayedErrorSamples:r.samples.filter(s=>s.page.error?.displayed).length,mediaErrorSamples:r.samples.filter(s=>s.page.video?.errorCode).length,
   coreErrorSamples:r.samples.filter(s=>s.tabErrors.length).length,consentSamples:r.samples.filter(s=>s.page.consent).length,
   contentSamples:r.samples.filter(s=>s.page.expectedClip&&!s.page.ad&&s.page.video?.time>1).length,
   targetDurationSeconds:[...new Set(r.samples.filter(s=>s.page.expectedClip).map(s=>s.page.video?.duration))],
   maxTargetTime:Math.max(...r.samples.filter(s=>s.page.expectedClip&&!s.page.ad).map(s=>s.page.video?.time??0)),
   automaticNextSamples:r.samples.filter(s=>s.page.youtube&&!s.page.expectedClip).length,
   adSamples:r.samples.filter(s=>s.page.ad).length,scriptletStatuses:[...new Set(r.samples.map(s=>s.adBlocking?.scriptletStatus))],runtimeErrors:r.runtimeErrors})),
  finding:'Old intermittent NASA stop not reproduced. Current83.301s target plays beyond80s then auto-advances in both modes. Historical13.5 stop occurred around45s with time0 and must not be explained away as this natural ending. No production fix or universal adblock claim.'},
 excludedDiagnostic:{completed:interfering.completed,reason:'Early Network debugger instrumentation preceded filter preparation; on-mode scriptletStatus unavailable. Does not represent an intact production-filter comparison. Retained for provenance, not adblock/CPU acceptance.'},
 foregroundCpu:{status:'BEKLEME',executed:false,reason:'User currently using computer; explicitly requested other checks. No foreground run started.',preparedCommand:'node node_modules/tsx/dist/cli.mjs scripts/diagnose-video-player-errors.ts docs/evidence/p2-v1.0.13.6-core-completion-foreground.json on,off,off,on 70 foreground',limits:'Prepared foreground metrics path typechecked but not executed. A later run needs fresh idle readiness and equal quality/visibility checks; no speedup claimed.'},
 secondPhysicalWindowsDpi:{status:'BEKLEME',executed:false},productionApplicationChanged:false};
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({gpuCompleted:result.gpu.completed,lateGpuRangeMiB:result.gpu.lateGpuRangeMiB,gpuDelayedReady:result.gpuReadiness.delayedAccelerationFeaturesEnabled,player:result.player.runs,foregroundCpu:result.foregroundCpu.status}));
