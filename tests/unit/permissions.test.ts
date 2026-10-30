import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session, WebContents } from 'electron';
import { denyPermissions, permissionLabel } from '../../src/main/browser/permission-policy';

test('B18: all request/check/device/display handlers deny, including unknown permission', () => {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const fake = Object.fromEntries(['Request', 'Check', 'Device', 'Display'].map((key) => {
    const name = key === 'Display' ? 'setDisplayMediaRequestHandler' : key === 'Device' ? 'setDevicePermissionHandler' : `setPermission${key}Handler`;
    return [name, (handler: (...args: any[]) => any) => { handlers[key] = handler; }];
  }));
  denyPermissions(fake as unknown as Session);
  for (const permission of ['fullscreen', 'automatic-fullscreen', 'media', 'geolocation', 'notifications', 'unknown', 'future-permission']) {
    let granted: unknown;
    handlers.Request!(null, permission, (value: boolean) => { granted = value; });
    assert.equal(granted, false);
    assert.equal(handlers.Check!(null, permission), false);
  }
  assert.equal(handlers.Device!({}), false);
  let streams: unknown;
  handlers.Display!({}, (value: unknown) => { streams = value; });
  assert.deepEqual(streams, {});
});

test('fullscreen exception needs owned foreground input gate and matching HTTP(S) origin; other permissions stay denied', () => {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const target = { setPermissionRequestHandler: (h: any) => handlers.request = h,
    setPermissionCheckHandler: (h: any) => handlers.check = h,
    setDevicePermissionHandler: (h: any) => handlers.device = h,
    setDisplayMediaRequestHandler: (h: any) => handlers.display = h } as unknown as Session;
  const wc = { isDestroyed: () => false, getURL: () => 'https://video.test/watch?v=public' } as WebContents;
  let gesture = false;
  const denied: string[] = [];
  denyPermissions(target, p => denied.push(p), contents => contents === wc && gesture);
  const request = (permission: string, requestingUrl = 'https://video.test/watch') => {
    let granted: unknown;
    handlers.request!(wc, permission, (value: boolean) => granted = value, { requestingUrl, isMainFrame: true });
    return granted;
  };
  assert.equal(request('fullscreen'), false);
  gesture = true;
  assert.equal(request('fullscreen'), true);
  assert.equal(handlers.check!(wc, 'fullscreen', 'https://video.test', { requestingUrl: 'https://video.test/watch', isMainFrame: true }), true);
  assert.equal(handlers.check!(wc, 'fullscreen', 'https://ad.test', { requestingUrl: 'https://video.test/watch', isMainFrame: true }), false);
  assert.equal(handlers.check!(wc, 'fullscreen', 'https://video.test', { requestingUrl: 'https://video.test/embed', isMainFrame: false }), false);
  for (const url of ['https://ad.test/', 'http://video.test/', 'file:///video', '', 'invalid']) assert.equal(request('fullscreen', url), false);
  for (const p of ['automatic-fullscreen', 'keyboardLock', 'pointerLock', 'notifications', 'media', 'openExternal', 'future']) assert.equal(request(p), false);
  assert.equal(handlers.check!(null, 'fullscreen', '', {}), false);
  assert.equal(handlers.device!({}), false);
  assert.ok(denied.includes('automatic-fullscreen'));
  assert.equal(permissionLabel('notifications'), 'Bildirim');
  assert.equal(permissionLabel('__proto__'), 'Diğer site izni');
});
