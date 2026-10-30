import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebContents, MessageBoxOptions, PermissionRequest } from 'electron';
import { SitePermissions } from '../../src/main/browser/site-permissions';

function setup() {
  let epoch = 'a', url = 'https://video.test/watch?private=not-exposed', destroyed = false;
  const wc = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed, getURL: () => url }) as unknown as WebContents;
  let active: WebContents | undefined = wc, canPrompt = true, answer: (r: { response: number }) => void = () => {};
  const boxes: MessageBoxOptions[] = [], results: boolean[] = [], modals: boolean[] = [];
  const service = new SitePermissions(() => ({ epoch, active, canPrompt, owns: w => w === wc && !destroyed }),
    options => { boxes.push(options); return new Promise(resolve => { answer = resolve; }); }, open => modals.push(open), () => {}, () => {}, () => {});
  const request = (permission = 'media', details: PermissionRequest = { isMainFrame: true, requestingUrl: url, mediaTypes: ['video'] } as PermissionRequest) => service.request(wc, permission, allowed => results.push(allowed), details);
  const check = (permission = 'media', origin = 'https://video.test', mediaType: 'video'|'audio' = 'video') => service.check(wc, permission, origin, { isMainFrame: true, requestingUrl: url, mediaType });
  return { service, wc, boxes, results, modals, request, check, answer: (response: number) => answer({ response }),
    switch: () => { epoch = 'b'; service.reset(); }, background: () => { active = undefined; },
    navigate: () => { url = 'https://other.test/'; wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }); },
    destroy: () => { destroyed = true; wc.emit('destroyed'); }, disablePrompt: () => { canPrompt = false; } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('permission request remains pending until explicit approval; camera grant never grants microphone or other origin; reset revokes', async () => {
  const s = setup(); assert.equal(s.check(), false); s.request();
  assert.deepEqual(s.results, []); assert.deepEqual(s.modals, [true]);
  assert.deepEqual(s.boxes[0]!.buttons, ['Engelle','İzin ver']); assert.equal(s.boxes[0]!.defaultId, 0);
  assert.ok(!s.boxes[0]!.message.includes('private')); s.answer(1); await flush();
  assert.deepEqual(s.results, [true]); assert.equal(s.check(), true); assert.equal(s.check('media','https://video.test','audio'), false);
  assert.equal(s.check('media','https://evil.test'), false); s.service.resetOrigin(s.wc); assert.equal(s.check(), false);
  assert.deepEqual(s.modals, [true,false]); assert.equal(s.wc.listenerCount('did-start-navigation'), 0); s.service.dispose();
});

test('denial is remembered per exact origin/context; malformed, insecure, iframe and unsupported requests never prompt', async () => {
  const s = setup(); s.request(); s.answer(0); await flush(); s.request();
  assert.equal(s.boxes.length, 1); assert.deepEqual(s.results, [false,false]);
  for (const details of [{isMainFrame:false,requestingUrl:'https://video.test/'}, {isMainFrame:true,requestingUrl:'https://evil.test/'}, {isMainFrame:true,requestingUrl:'http://video.test/'}]) s.request('geolocation', details);
  assert.equal(s.boxes.length, 1); assert.equal(s.request('usb'), false); s.switch(); assert.equal(s.check(), false);
  s.service.dispose();
});

test('navigation, background ownership change, close, timeout and context switch deny pending request once and ignore late approval', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const reason of ['navigate','background','destroy','switch','timeout'] as const) {
    const s = setup(); s.request();
    if (reason === 'timeout') t.mock.timers.tick(30000);
    else { s[reason](); s.service.reconcile(); }
    assert.deepEqual(s.results, [false], reason); assert.equal(s.boxes[0]!.signal!.aborted, true);
    s.answer(1); await flush(); assert.deepEqual(s.results, [false]);
    assert.equal(s.wc.listenerCount('destroyed'), 0); assert.equal(s.wc.listenerCount('did-start-navigation'), 0);
    s.service.dispose();
  }
});

test('one pending native prompt blocks concurrent requests; resetting/disposal aborts and does not retain listeners', () => {
  const s = setup(); s.request(); s.request('geolocation'); assert.equal(s.boxes.length, 1);
  assert.deepEqual(s.results, [false]); s.service.dispose(); assert.deepEqual(s.results, [false,false]);
  assert.equal(s.wc.listenerCount('render-process-gone'), 0);
});

test('background notification check requires an explicit exact-origin grant and is revoked on context reset', async () => {
  const s = setup();
  assert.equal(s.service.check(null,'notifications','https://video.test',{} as any),false);
  s.request('notifications'); s.answer(1); await flush(); s.background();
  assert.equal(s.service.check(null,'notifications','https://video.test',{} as any),true);
  assert.equal(s.service.check(null,'notifications','https://other.test',{} as any),false);
  s.switch(); assert.equal(s.service.check(null,'notifications','https://video.test',{} as any),false); s.service.dispose();
});
