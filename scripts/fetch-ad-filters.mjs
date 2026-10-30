// Explicit developer operation only. Never called by the application or build.
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {adsLists} from '@ghostery/adblocker';
const destination=new URL('../src/main/browser/filter-data/20261028/',import.meta.url);
if(existsSync(new URL('manifest.json',destination)))throw Error('Preserve existing snapshot; review an explicit update');
mkdirSync(destination,{recursive:true});
const currentLists=adsLists.map(url=>url.includes('/easylist/easylist.txt')?'https://easylist.to/easylist/easylist.txt':url.includes('/ublock-origin/')?url.replace('https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/','https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/'):url);
const urls=[...currentLists,'https://filters.adtidy.org/extension/ublock/filters/13.txt',
 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json'];
const entries=[];let bytes=0;
for(const [index,url] of urls.entries()){
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Filter response '+response.status);
 const data=Buffer.from(await response.arrayBuffer());bytes+=data.length;if(bytes>20_000_000)throw Error('Unexpected filter size');
 const name=index===urls.length-1?'resources.json':`list-${index}.txt`;
 writeFileSync(new URL(name,destination),data);
 entries.push({name,url,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
writeFileSync(new URL('manifest.json',destination),JSON.stringify({recordedAt:new Date().toISOString(),engine:'@ghostery/adblocker@2.20.1',decodedBytes:bytes,entries},null,2)+'\n');
console.log(JSON.stringify({files:entries.length,decodedBytes:bytes}));
