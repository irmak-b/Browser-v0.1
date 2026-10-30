// Offline build of the reviewed, hash-pinned list snapshot. No fetch calls.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FiltersEngine} from '@ghostery/adblocker';
const root=new URL('../src/main/browser/filter-data/20261028/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
const lists=[];let resources;
for(const entry of manifest.entries){
 const data=readFileSync(new URL(entry.name,root));
 if(createHash('sha256').update(data).digest('hex')!==entry.sha256)throw Error('Filter snapshot hash mismatch: '+entry.name);
 if(entry.name==='resources.json')resources={data:data.toString(),hash:entry.sha256};else lists.push(data.toString());
}
const supplemental=readFileSync(new URL('../browser-core.txt',root),'utf8');
lists.push(supplemental);
const engine=FiltersEngine.parse(lists.join('\n'),{enableCompression:true,enableInMemoryCache:false,loadCSPFilters:false,loadExtendedSelectors:false,loadPreprocessors:true,enableHtmlFiltering:false});
engine.updateEnv(new Map([['env_chromium',true],['ext_ghostery',true],['cap_user_stylesheet',true]]));
engine.updateResources(resources.data,resources.hash);
// Small document-start fallback for links/redirects into YouTube. Keep the
// full site's heavy cosmetics out of unrelated pages' execution paths.
const early=FiltersEngine.parse(supplemental+'\n'+['playerAds','adPlacements','adSlots'].map(key=>`www.youtube.com##+js(set, ytInitialPlayerResponse.${key}, undefined)`).join('\n'));
early.updateResources(resources.data,resources.hash);
writeFileSync(new URL('../youtube-early.json',root),JSON.stringify([...new Set(early.getCosmeticsFilters({url:'https://www.youtube.com/',hostname:'www.youtube.com',domain:'youtube.com'}).scripts)])+'\n');
const filters=engine.getFilters(),binary=engine.serialize();
writeFileSync(new URL('../engine.bin',root),binary);
writeFileSync(new URL('../engine.json',root),JSON.stringify({snapshot:'2026-10-28',supplementalSha256:createHash('sha256').update(supplemental).digest('hex'),networkRules:filters.networkFilters.length,cosmeticRules:filters.cosmeticFilters.length,sha256:createHash('sha256').update(binary).digest('hex')})+'\n');
const results=['www.donanimhaber.com','www.youtube.com'].map(host=>{
 const request={url:'https://'+host+'/',hostname:host,domain:host.replace(/^www\./,'')};
 const cosmetic=engine.getCosmeticsFilters(request);
 return {host,cssBytes:cosmetic.styles.length,scriptlets:cosmetic.scripts.length,scriptBytes:cosmetic.scripts.reduce((sum,v)=>sum+v.length,0)};
});
console.log(JSON.stringify({binaryBytes:binary.length,networkRules:filters.networkFilters.length,cosmeticRules:filters.cosmeticFilters.length,results}));
