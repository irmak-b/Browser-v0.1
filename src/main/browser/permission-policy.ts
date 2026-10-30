import type { Session, WebContents } from 'electron';
import type { SitePermissions } from './site-permissions';

export type FullscreenGate = (contents: WebContents) => boolean;
const labels: Record<string, string> = {
  fullscreen: 'Tam ekran', 'automatic-fullscreen': 'Otomatik tam ekran',
  notifications: 'Bildirim', media: 'Kamera / mikrofon', geolocation: 'Konum',
  openExternal: 'Harici uygulama', 'display-capture': 'Ekran paylaşımı',
  pointerLock: 'Fare kilidi', keyboardLock: 'Klavye kilidi',
  'clipboard-read': 'Pano okuma', 'screen-wake-lock': 'Ekranı açık tutma',
};
export function permissionLabel(permission: string) { return Object.hasOwn(labels, permission) ? labels[permission]! : 'Diğer site izni'; }

// Normal fullscreen only: the main-owned gate checks the active tab and recent
// input. Embedded frames and automatic-fullscreen keep the default denial.
export function fullscreenOrigin(contents: WebContents | null, requestingUrl: string | undefined) {
  if (!contents || contents.isDestroyed() || !requestingUrl) return false;
  try {
    const top = new URL(contents.getURL()), caller = new URL(requestingUrl);
    return ['http:', 'https:'].includes(top.protocol) && top.origin === caller.origin;
  } catch { return false; }
}
export function denyPermissions(target: Session, notice: (permission: string) => void = () => {}, fullscreen: FullscreenGate = () => false, user?: Pick<SitePermissions, 'request'|'check'>) {
  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed = permission === 'fullscreen' && details?.isMainFrame === true
      && fullscreenOrigin(contents, details.requestingUrl) && fullscreen(contents);
    if (permission !== 'fullscreen' && user?.request(contents, permission, callback, details)) return;
    callback(allowed);
    if (!allowed) notice(permission);
  });
  target.setPermissionCheckHandler((contents, permission, origin, details) =>
    permission === 'fullscreen' ? details?.isMainFrame === true
      && fullscreenOrigin(contents, origin) && fullscreenOrigin(contents, details.requestingUrl) && fullscreen(contents!)
      : user?.check(contents, permission, origin, details) ?? false);
  target.setDevicePermissionHandler(() => false);
  target.setDisplayMediaRequestHandler((_request, callback) => { callback({}); notice('display-capture'); });
}
