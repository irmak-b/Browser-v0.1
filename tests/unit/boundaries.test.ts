import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, parseViewport, LAYOUT, newerSnapshot, type BrowserSnapshot } from '../../src/shared/contracts';
import { isTrustedCaller, isTrustedUiUrl, siteUrl } from '../../src/main/browser/policy';
import { safeBounds } from '../../src/main/browser/layout';

test('main accepts only exact UI identity, main frame and document URL', () => {
  assert.equal(isTrustedCaller(12, 12, true, 'app://browser/index.html', false), true);
  for (const args of [
    [12, 13, true, 'app://browser/index.html', false],
    [12, 12, false, 'app://browser/index.html', false],
    [12, 12, true, 'https://example.com/', false],
    [12, 12, true, 'file:///index.html', false],
    [12, 12, true, 'app://browser/index.html?spoof=1', false],
    [12, 12, true, 'http://127.0.0.1:5173/', false],
    [12, 12, true, 'http://127.0.0.1:5174/', true],
    [12, 12, true, 'http://localhost:5173/', true],
  ] as const) assert.equal(isTrustedCaller(args[0], args[1], args[2], args[3], args[4]), false);
  assert.equal(isTrustedUiUrl('http://127.0.0.1:5173/', true), true);
});

test('navigation rejects non-web schemes and embedded credentials', () => {
  for (const value of ['javascript:alert(1)', 'file:///C:/secret', 'app://browser/index.html', 'data:text/html,hi', 'mailto:a@b.test', 'https://user:password@example.com']) {
    assert.throws(() => siteUrl(value), /reddedildi/);
  }
  assert.equal(siteUrl('https://example.com/path'), 'https://example.com/path');
  assert.throws(() => siteUrl('bare-domain.test'));
  for (const value of [null, {}, '', ' '.repeat(5), 'x'.repeat(8193)]) assert.throws(() => parseInput(value));
});

test('viewport rejects malformed values and clamps against reserved trusted UI', () => {
  const valid = { visible: true, x: 0, y: 0, width: 1200, height: 820, revision: 1 };
  for (const patch of [{ x: NaN }, { y: -1 }, { width: Infinity }, { height: 2.5 }, { visible: 'true' }, { partition: 'admin' }, { revision: -1 }]) {
    assert.throws(() => parseViewport({ ...valid, ...patch }));
  }
  const bounds = safeBounds(parseViewport(valid), 1200, 820);
  assert.deepEqual(bounds, { x: 0, y: LAYOUT.toolbarHeight, width: 1200 - LAYOUT.sidebarWidth, height: 820 - LAYOUT.toolbarHeight });
  for (const width of [100, 500, 880, 1200, 1920]) {
    for (const height of [100, 580, 820, 1080]) {
      const result = safeBounds(parseViewport(valid), width, height);
      assert.ok(result.width >= 0 && result.height >= 0);
      assert.ok(result.x + result.width <= width);
      assert.ok(result.y + result.height <= height);
      if (result.width && result.height) {
        assert.ok(result.y >= LAYOUT.toolbarHeight);
        assert.ok(result.x + result.width <= width - LAYOUT.sidebarWidth);
      }
    }
  }
});

test('late initial snapshot cannot overwrite a newer event', () => {
  const fresh = { revision: 12, contextEpoch: 'A' } as BrowserSnapshot;
  const stale = { revision: 11, contextEpoch: 'A' } as BrowserSnapshot;
  assert.equal(newerSnapshot(fresh, stale), fresh);
  assert.equal(newerSnapshot(null, fresh), fresh);
  assert.equal(newerSnapshot(stale, fresh), fresh);
});
