import type { MessageBoxOptions, WebContents, PermissionRequest, MediaAccessPermissionRequest, PermissionCheckHandlerHandlerDetails } from 'electron';

export type SitePermission = 'camera' | 'microphone' | 'location' | 'notifications';
export const PERMISSION_NAMES: Record<SitePermission, string> = { camera: 'Kamera', microphone: 'Mikrofon', location: 'Konum', notifications: 'Bildirim' };
type Decision = 'allowed' | 'blocked';
type Context = { epoch: string; active: WebContents | undefined; owns: (wc: WebContents) => boolean; canPrompt: boolean };
interface Pending { owner: WebContents; epoch: string; origin: string; abort: AbortController; finish: (allowed: boolean) => void }
export interface PermissionSnapshot { origin: string; decisions: { permission: SitePermission; state: Decision }[] }

function originOf(url: string | undefined) {
  try { if (!url) return null; const u = new URL(url);
    return !u.username && !u.password && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)) ? u.origin : null;
  } catch { return null; }
}
function requested(permission: string, details: MediaAccessPermissionRequest): SitePermission[] {
  if (permission === 'media') {
    const types = details.mediaTypes;
    if (!types?.length || types.some(type => !['audio','video'].includes(type))) return [];
    return [...new Set(types.map(type => type === 'video' ? 'camera' as const : 'microphone' as const))];
  }
  return permission === 'geolocation' || permission === 'geolocation-approximate' ? ['location'] : permission === 'notifications' ? ['notifications'] : [];
}

// Decisions live only in the current mock-user context, keyed by exact origin.
// Requests are never auto-granted. One native prompt and one timeout at a time.
export class SitePermissions {
  private readonly decisions = new Map<string, Map<SitePermission, Decision>>();
  private pending?: Pending;
  private disposed = false;
  constructor(private readonly current: () => Context,
    private readonly show: (options: MessageBoxOptions) => Promise<{ response: number }>,
    private readonly modal: (open: boolean) => void,
    private readonly changed: () => void,
    private readonly denied: (permission: string) => void,
    private readonly protect: (wc: WebContents) => void) {}
  snapshot(wc?: WebContents): PermissionSnapshot | null {
    const origin = wc && !wc.isDestroyed() ? originOf(wc.getURL()) : null;
    return origin ? { origin, decisions: [...(this.decisions.get(origin) ?? [])].map(([permission, state]) => ({ permission, state })) } : null;
  }
  private live(wc: WebContents, epoch: string, origin: string) {
    const now = this.current();
    return !this.disposed && !wc.isDestroyed() && now.epoch === epoch && now.owns(wc) && now.active === wc && originOf(wc.getURL()) === origin;
  }
  request(wc: WebContents, permission: string, callback: (allowed: boolean) => void, details: PermissionRequest) {
    if (!['media','geolocation','geolocation-approximate','notifications'].includes(permission)) return false;
    const context = this.current(), origin = originOf(details?.requestingUrl), items = requested(permission, details);
    const deliver = (allowed: boolean) => { try { callback(allowed); } catch { /* Requesting frame already gone. */ } };
    const reject = () => { deliver(false); this.denied(permission); };
    if (!origin || details?.isMainFrame !== true || !items.length || !this.live(wc, context.epoch, origin)
      || !context.canPrompt || (details as MediaAccessPermissionRequest).securityOrigin && originOf((details as MediaAccessPermissionRequest).securityOrigin) !== origin) { reject(); return true; }
    const known = this.decisions.get(origin);
    if (items.some(p => known?.get(p) === 'blocked')) { reject(); return true; }
    if (items.every(p => known?.get(p) === 'allowed')) { deliver(true); this.protect(wc); return true; }
    if (this.pending || !known && this.decisions.size >= 128) { reject(); return true; }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, settled = false;
    const invalidate = () => finish(false, false);
    const navigation = (event: Electron.WebContentsDidStartNavigationEventParams) => { if (event.isMainFrame && !event.isSameDocument) invalidate(); };
    const finish = (allowed: boolean, remember: boolean) => {
      if (settled) return; settled = true; clearTimeout(timer);
      wc.off('destroyed', invalidate); wc.off('render-process-gone', invalidate); wc.off('did-start-navigation', navigation);
      const valid = this.live(wc, context.epoch, origin);
      this.pending = undefined; abort.abort(); this.modal(false);
      if (remember && valid) { const decisions = known ?? new Map<SitePermission, Decision>(); for (const p of items) decisions.set(p, allowed ? 'allowed' : 'blocked'); this.decisions.set(origin, decisions); }
      if (allowed && valid) this.protect(wc);
      deliver(allowed && valid); if (!allowed || !valid) this.denied(permission); this.changed();
    };
    this.pending = { owner: wc, epoch: context.epoch, origin, abort, finish: allowed => finish(allowed, false) };
    wc.once('destroyed', invalidate); wc.once('render-process-gone', invalidate); wc.on('did-start-navigation', navigation);
    this.modal(true);
    timer = setTimeout(() => finish(false, false), 30000);
    try {
      void this.show({ type: 'question', title: 'Browser Core · Site izni', message: `${origin}\n${items.map(p => PERMISSION_NAMES[p]).join(' ve ')} erişimine izin verilsin mi?`,
        detail: 'Kararın yalnız bu site ve bu uygulama oturumu için geçerli. Sayfa durumundaki Site izinleri bölümünden sıfırlayabilirsin.'
          + (items.includes('notifications') ? ' Bildirim izni arka plan işlerinin sekme kapandıktan sonra da çalışmasına izin verir.' : ''),
        buttons: ['Engelle','İzin ver'], defaultId: 0, cancelId: 0, noLink: true, signal: abort.signal,
      }).then(result => finish(result.response === 1, true), () => finish(false, false));
    } catch { finish(false, false); }
    return true;
  }
  check(wc: WebContents | null, permission: string, originUrl: string, details: PermissionCheckHandlerHandlerDetails) {
    const origin = originOf(originUrl), context = this.current();
    // Session's identity gate already ran. Background notifications require an
    // explicit grant recorded for this exact origin, never a new worker prompt.
    if (!wc && permission === 'notifications') return !this.disposed && !!origin && this.decisions.get(origin)?.get('notifications') === 'allowed';
    const owner = wc ?? (permission === 'notifications' ? context.active : undefined);
    if (!origin || !owner || owner.isDestroyed() || !context.owns(owner) || originOf(owner.getURL()) !== origin) return false;
    if (wc && (details?.isMainFrame !== true || originOf(details.requestingUrl) !== origin)) return false;
    if (details?.securityOrigin && originOf(details.securityOrigin) !== origin) return false;
    const mediaTypes = details?.mediaType === 'video' ? ['video'] as const : details?.mediaType === 'audio' ? ['audio'] as const : ['video','audio'] as const;
    const items = requested(permission, { isMainFrame: true, requestingUrl: origin, mediaTypes: [...mediaTypes] });
    const allowed = items.length > 0 && items.every(p => this.decisions.get(origin)?.get(p) === 'allowed');
    if (allowed && permission === 'media') this.protect(owner);
    return allowed;
  }
  resetOrigin(wc: WebContents) {
    const origin = originOf(wc.getURL()); if (!origin) return;
    if (this.pending?.origin === origin) this.pending.finish(false);
    this.decisions.delete(origin); this.changed();
  }
  reconcile() {
    const p = this.pending; if (p && !this.live(p.owner, p.epoch, p.origin)) p.finish(false);
  }
  reset() { this.pending?.finish(false); this.decisions.clear(); }
  hasBackgroundPermission() { return [...this.decisions.values()].some(origin => origin.get('notifications') === 'allowed'); }
  dispose() { this.disposed = true; this.reset(); }
}
