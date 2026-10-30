import { FiltersEngine, Request, type ElectronRequestType } from '@ghostery/adblocker';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import snapshot from './filter-data/engine.json';

// One immutable engine shared by profiles. Preferences and counters are separate.
// No automatic fetching, request-result cache, telemetry, or page data logs.
let engine: FiltersEngine | undefined;
export const FILTER_RULE_COUNT = snapshot.networkRules + snapshot.cosmeticRules;
export function filterEngine() {
  if(!engine){
    const path=process.versions.electron?join(__dirname,'ad-engine.bin'):join(__dirname,'filter-data','engine.bin');
    const data=readFileSync(path);
    if(createHash('sha256').update(data).digest('hex')!==snapshot.sha256)throw new Error('Bundled filter integrity check failed');
    engine=FiltersEngine.deserialize(data);
  }
  return engine;
}
export function adRequest(url:string, sourceUrl:string, type:string) {
  return Request.fromRawDetails({url,sourceUrl,type:type as ElectronRequestType});
}
export function pageFilters(url:string) {
  const parsed=new URL(url);
  // The normal HTTPS apex redirects to www; prepare that site's reviewed rules
  // before the first document, rather than missing the initial player response.
  if(parsed.hostname==='youtube.com'){parsed.hostname='www.youtube.com';url=parsed.href;}
  const request=adRequest(url,url,'mainFrame');
  const result=filterEngine().getCosmeticsFilters({url,hostname:request.hostname,domain:request.domain,
    getRulesFromDOM:false,getExtendedRules:false});
  return {...result,scripts:[...new Set(result.scripts)]};
}
