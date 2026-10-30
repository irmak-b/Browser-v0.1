import type { WebContents } from 'electron';
import { adRequest, filterEngine, FILTER_RULE_COUNT, pageFilters } from './ad-filter-engine';
import { AdScriptlets } from './ad-scriptlets';
import youtubeEarly from './filter-data/youtube-early.json';

// Small, auditable network-only starter list, authored here. No subscription,
// remote list or extension is downloaded. This is not EasyList/uBlock parity.
export const AD_DOMAINS = Object.freeze([
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'googletagservices.com',
  'adservice.google.com', 'adnxs.com', 'adsrvr.org', 'adform.net', 'adform.com',
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'mgid.com',
  'pubmatic.com', 'rubiconproject.com', 'openx.net', 'smartadserver.com',
  'casalemedia.com', 'bidswitch.net', 'bidr.io', '360yield.com', 'yieldmo.com',
  'yieldlab.net', 'lijit.com', 'sovrn.com', 'contextweb.com', 'sharethrough.com',
  'indexww.com', 'advertising.com', 'adtech.de', 'adtechus.com', 'media.net',
  'adhood.com', 'admatic.com.tr', 'admost.com', 'reklamstore.com', 'reklamport.com',
  'exoclick.com', 'propellerads.com', 'popads.net', 'popcash.net',
]);
const domains = new Set<string>(AD_DOMAINS);
export function isAdHost(hostname: string) {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.');
  for (let index=0;index<labels.length-1;index++) if(domains.has(labels.slice(index).join('.')))return true;
  return false;
}
interface PageFilter { host: string; url:string; blocked: number; cssKey?:string; styleRevision:number; scriptletStatus:'none'|'pending'|'ready'|'unavailable' }
export class AdBlocker {
  private readonly pages = new WeakMap<WebContents, PageFilter>();
  private readonly retained = new WeakMap<WebContents, PageFilter>();
  private readonly exceptions = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private readonly bindings=new Map<WebContents,()=>void>();
  private readonly scriptlets=new AdScriptlets();
  private disposed=false;
  private readonly prepared=new WeakMap<WebContents,string>();
  private readonly initialBlank=new WeakSet<WebContents>();
  constructor(private readonly changed:()=>void) {}
  navigation(wc:WebContents,url:string) {
    const previous=this.pages.get(wc);
    if(previous&&!this.retained.has(wc)&&typeof wc.getURL==='function'&&previous.url===wc.getURL())this.retained.set(wc,previous);
    let host='';try{host=new URL(url).hostname;}catch{}
    this.pages.set(wc,{host,url,blocked:0,styleRevision:0,scriptletStatus:'none'});
    // Unit fakes have no Electron event surface. Real contents are bound once.
    if(typeof wc.on==='function'&&!this.bindings.has(wc)){
      const ready=()=>{void this.applyStyles(wc);};
      const committed=()=>{
        this.retained.delete(wc);
        if(!this.initialBlank.has(wc)||wc.isDestroyed())return;
        const history=wc.navigationHistory;
        if(history.getActiveIndex()===0)return;
        // Remove only the first local bootstrap document we created. Preserve
        // every user entry and the current document; no wholesale history clear.
        if(history.getEntryAtIndex(0)?.url==='about:blank')history.removeEntryAtIndex(0);
        this.initialBlank.delete(wc);
      };
      const cancelled=()=>this.cancelNavigation(wc);
      const clean=()=>{this.scriptlets.stop(wc);wc.off('dom-ready',ready);wc.off('did-navigate',committed);wc.off('will-prevent-unload',cancelled);wc.off('destroyed',clean);this.bindings.delete(wc);this.pages.delete(wc);this.retained.delete(wc);this.prepared.delete(wc);this.initialBlank.delete(wc);};
      wc.on('dom-ready',ready);wc.on('did-navigate',committed);wc.on('will-prevent-unload',cancelled);wc.once('destroyed',clean);this.bindings.set(wc,clean);
    }
  }
  cancelNavigation(wc:WebContents){
    const retained=this.retained.get(wc);
    if(!retained||wc.isDestroyed()||wc.getURL()!==retained.url)return;
    this.retained.delete(wc);this.prepared.delete(wc);this.pages.set(wc,retained);
    // Re-arm only future document rules. The retained page/CSS is intact.
    void this.prepareDocument(wc).catch(()=>{if(this.pages.get(wc)===retained)retained.scriptletStatus='unavailable';});
    this.changed();
  }
  snapshot(wc?:WebContents) {
    const page=wc&&this.pages.get(wc);
    return {enabled:!page||!this.exceptions.has(page.host),blockedRequests:page?.blocked??0,ruleCount:FILTER_RULE_COUNT,mode:'bundled-lists' as const,scriptletStatus:page?.scriptletStatus??'none'};
  }
  setEnabled(wc:WebContents,enabled:boolean) {
    const page=this.pages.get(wc);if(!page?.host)return false;
    if(enabled)this.exceptions.delete(page.host);
    else if(this.exceptions.has(page.host)||this.exceptions.size<128)this.exceptions.add(page.host);
    else return false;
    for(const current of this.bindings.keys())if(this.pages.get(current)?.host===page.host){
      if(!enabled)void this.scriptlets.clear(current);
      void this.applyStyles(current);
    }
    // Also update future YouTube link guards in already-open unrelated tabs.
    for(const current of this.bindings.keys())void this.prepareDocument(current).catch(()=>{});
    this.changed();return true;
  }
  block(wc:WebContents|undefined,url:string,resourceType:string) {
    if(!wc||resourceType==='mainFrame')return false;
    const page=this.pages.get(wc);if(!page?.host||this.exceptions.has(page.host))return false;
    if(!filterEngine().match(adRequest(url,page.url,resourceType)).match)return false;
    page.blocked=Math.min(Number.MAX_SAFE_INTEGER,page.blocked+1);
    if(!this.timer){this.timer=setTimeout(()=>{this.timer=undefined;this.changed();},300);this.timer.unref();}
    return true;
  }
  async prepareDocument(wc:WebContents){
    const page=this.pages.get(wc);
    if(!page)return;
    const scripts=this.exceptions.has(page.host)?[]:pageFilters(page.url).scripts;
    const fallbackHosts=['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].filter(host=>!this.exceptions.has(host));
    if(scripts.length)page.scriptletStatus='pending';
    // Electron cannot acknowledge Page commands until the new contents has a
    // renderer. A local empty document initializes it without network traffic.
    if(!wc.getURL()){this.initialBlank.add(wc);await wc.loadURL('about:blank');}
    if(wc.isDestroyed()||this.pages.get(wc)!==page)return;
    const ready=await this.scriptlets.arm(wc,page.host,scripts,fallbackHosts,fallbackHosts.length?youtubeEarly:[]);
    if(this.pages.get(wc)===page){page.scriptletStatus=scripts.length?(ready?'ready':'unavailable'):'none';this.changed();}
  }
  async prepareNavigation(wc:WebContents,url:string){
    this.navigation(wc,url);const page=this.pages.get(wc);
    try{await this.prepareDocument(wc);}catch{if(page&&this.pages.get(wc)===page)page.scriptletStatus='unavailable';}
    if(!wc.isDestroyed()&&this.pages.get(wc)===page)this.prepared.set(wc,url);
  }
  requestNavigation(wc:WebContents,url:string){
    if(this.prepared.get(wc)===url){this.prepared.delete(wc);return;}
    this.prepared.delete(wc);
    const previous=this.pages.get(wc);this.navigation(wc,url);
    const page=this.pages.get(wc)!;
    if(previous?.host===page.host||previous?.host==='youtube.com'&&page.host==='www.youtube.com')page.scriptletStatus=previous!.scriptletStatus;
    else if(!this.exceptions.has(page.host)&&pageFilters(url).scripts.length)page.scriptletStatus='unavailable';
    // Existing document-start scripts check their exact host. Cross-site links
    // remain usable; a host requiring new scriptlets can be reloaded via main.
  }
  private async applyStyles(wc:WebContents){
    const page=this.pages.get(wc);if(!page||this.disposed||wc.isDestroyed())return;
    const revision=++page.styleRevision,previous=page.cssKey;page.cssKey=undefined;
    try{
      if(previous)await wc.removeInsertedCSS(previous);
      if(this.exceptions.has(page.host)||this.pages.get(wc)!==page||new URL(wc.getURL()).hostname!==page.host)return;
      const styles=pageFilters(page.url).styles;if(!styles)return;
      const key=await wc.insertCSS(styles);
      if(this.disposed||this.pages.get(wc)!==page||revision!==page.styleRevision||this.exceptions.has(page.host)){
        if(!wc.isDestroyed())await wc.removeInsertedCSS(key);
      }else page.cssKey=key;
    }catch{ /* Navigation/close can invalidate an in-flight stylesheet. */ }
  }
  dispose(){this.disposed=true;clearTimeout(this.timer);this.scriptlets.dispose();for(const clean of [...this.bindings.values()])clean();}
}
