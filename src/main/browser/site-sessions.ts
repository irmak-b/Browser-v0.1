import { randomUUID } from 'node:crypto';
import { session, webContents, type Session } from 'electron';
import type { DevelopmentIdentity } from '../../shared/contracts';
import { denyPermissions, type FullscreenGate } from './permission-policy';
import { blocksScripts } from './resource-policy';
import { AdBlocker } from './ad-blocker';
import {siteUserAgent,SITE_LANGUAGES} from './site-identity';
import type { SitePermissions } from './site-permissions';
import { IdleWorkers } from './idle-workers';

// Mock identity context: opaque, memory-only partitions chosen by main, never an
// authentication mechanism. Returning to A retains A's site data until app exit.
export class SiteSessions {
  private readonly contexts = new Map<DevelopmentIdentity, Session>();
  private readonly profiles = new Map<DevelopmentIdentity, string>();
  private readonly filters = new Map<DevelopmentIdentity, AdBlocker>();
  private readonly workers = new Map<DevelopmentIdentity, IdleWorkers>();
  constructor(private readonly configure: (id: DevelopmentIdentity, target: Session) => void) {}
  get(id: DevelopmentIdentity) {
    let target = this.contexts.get(id);
    if (!target) {
      // Cache reusable HTTP resources for this identity's temporary session.
      // The opaque partition has no persist: prefix; app exit discards it.
      target = session.fromPartition(`browser-core-development-${randomUUID()}`, { cache: true });
      // Configure before creating any site contents. Trusted UI session is separate.
      target.setUserAgent(siteUserAgent(target.getUserAgent()),SITE_LANGUAGES);
      const filter=new AdBlocker(()=>this.blockedChanged?.(id));this.filters.set(id,filter);
      const permissions = this.permissions;
      denyPermissions(target, permission => this.permissionDenied?.(id, permission), wc => this.fullscreenAllowed?.(wc) ?? false, permissions ? {
        request: (...args) => this.permissionContextActive?.(id) === true && permissions.request(...args),
        check: (...args) => this.permissionContextActive?.(id) === true && permissions.check(...args),
      } : undefined);
      target.webRequest.onBeforeRequest((details, callback) => {
        const owner=details.webContents??(details.webContentsId===undefined?undefined:webContents.fromId(details.webContentsId)??undefined);
        if(details.resourceType==='mainFrame'&&owner)filter.requestNavigation(owner,details.url);
        if(['webSocket','media'].includes(details.resourceType)&&details.webContentsId!==undefined)this.protect?.(details.webContentsId);
        if (details.resourceType === 'mainFrame' && details.webContentsId !== undefined) {
          this.reloadSafety?.(details.webContentsId, false);
          if (details.method !== 'GET') this.protect?.(details.webContentsId);
        }
        let allowed = false;
        try { allowed = ['http:', 'https:', 'ws:', 'wss:'].includes(new URL(details.url).protocol); } catch { /* deny */ }
        callback({cancel:!allowed||filter.block(owner,details.url,details.resourceType)});
      });
      target.webRequest.onHeadersReceived((details, callback) => {
        if (details.resourceType === 'mainFrame' && details.webContentsId !== undefined) {
          const policies = Object.entries(details.responseHeaders ?? {}).filter(([name]) => name.toLowerCase() === 'content-security-policy').flatMap(([, values]) => values);
          this.reloadSafety?.(details.webContentsId, details.method === 'GET' && blocksScripts(policies));
        }
        callback({});
      });
      this.contexts.set(id, target);
      this.workers.set(id, new IdleWorkers(target, () => this.hasPages?.(id) ?? true, () => this.keepBackground?.(id) ?? true));
      this.profiles.set(id, randomUUID());
      this.configure(id, target);
    }
    return target;
  }
  permissionDenied?: (id: DevelopmentIdentity, permission: string) => void;
  permissions?: SitePermissions;
  permissionContextActive?: (id: DevelopmentIdentity) => boolean;
  fullscreenAllowed?: FullscreenGate;
  blockedChanged?: (id: DevelopmentIdentity) => void;
  filter(id:DevelopmentIdentity){this.get(id);return this.filters.get(id)!;}
  updateWorkers() { for (const workers of this.workers.values()) workers.update(); }
  ready(id: DevelopmentIdentity) { return this.workers.get(id)?.ready() ?? Promise.resolve(); }
  workerSnapshot() { return [...this.workers.values()].map(worker => worker.snapshot()); }
  hasPages?: (id: DevelopmentIdentity) => boolean;
  keepBackground?: (id: DevelopmentIdentity) => boolean;
  dispose(){for(const worker of this.workers.values())worker.dispose();for(const filter of this.filters.values())filter.dispose();}
  reloadSafety?: (webContentsId: number, safe: boolean) => void;
  protect?: (webContentsId: number) => void;
  profileKey(id: DevelopmentIdentity) { this.get(id); return this.profiles.get(id)!; }
}
