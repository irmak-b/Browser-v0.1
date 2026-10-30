import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContents } from 'electron';
import { PageFullscreen, FULLSCREEN_HINT_MS } from '../../src/main/browser/page-fullscreen';

function setup() {
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, setFullScreen: (_value: boolean) => {} });
  let changed = 0, scripts = 0, crashed = false;
  const wc = { getURL: () => 'https://video.test/watch?not-exposed=1', isDestroyed: () => false,
    isCrashed: () => crashed, executeJavaScript: async () => { scripts++; }, executeJavaScriptInIsolatedWorld: async () => {} } as unknown as WebContents;
  const fullscreen = new PageFullscreen(window as unknown as BrowserWindow, () => changed++);
  return { fullscreen, window, wc, changes: () => changed, scripts: () => scripts, crash: () => { crashed = true; } };
}

test('fullscreen hint expires once at 3s; native bounds stay fullscreen throughout without a second layout transition', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fullscreen, wc, changes, scripts } = setup();
  fullscreen.enter(wc);
  assert.deepEqual(fullscreen.snapshot(), { origin: 'https://video.test', hintVisible: true });
  assert.deepEqual(fullscreen.bounds(1920, 1080), { x: 0, y: 0, width: 1920, height: 1080 });
  t.mock.timers.tick(FULLSCREEN_HINT_MS - 1);
  assert.equal(fullscreen.snapshot()?.hintVisible, true);
  t.mock.timers.tick(1);
  assert.deepEqual(fullscreen.bounds(1920, 1080), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal(fullscreen.contents, wc); assert.equal(scripts(), 0);
  assert.equal(changes(), 2);
  t.mock.timers.tick(60000); assert.equal(changes(), 2);
  fullscreen.dispose();
});

test('early exit, rapid reentry and disposal cancel stale hint timers/listeners; crash exit schedules no site script', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fullscreen, window, wc, changes, scripts, crash } = setup();
  fullscreen.enter(wc); t.mock.timers.tick(1000); fullscreen.exit();
  fullscreen.enter(wc); t.mock.timers.tick(2000);
  assert.equal(fullscreen.snapshot()?.hintVisible, true);
  t.mock.timers.tick(1000); assert.equal(fullscreen.snapshot()?.hintVisible, false);
  assert.equal(scripts(), 1);
  fullscreen.exit(); fullscreen.enter(wc); crash(); fullscreen.dispose();
  assert.equal(scripts(), 2);
  const before = changes(); t.mock.timers.tick(60000);
  assert.equal(changes(), before); assert.equal(fullscreen.snapshot(), null);
  assert.equal(window.listenerCount('leave-full-screen'), 0);
});
