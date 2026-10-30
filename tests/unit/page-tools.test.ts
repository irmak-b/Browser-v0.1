import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebContents, FindInPageOptions } from 'electron';
import { PageTools, nextZoom } from '../../src/main/browser/page-tools';
import { parseFindRequest } from '../../src/shared/contracts';

class FakePage extends EventEmitter {
  destroyed = false;
  searches: { text: string; options?: FindInPageOptions }[] = [];
  clears = 0;
  isDestroyed() { return this.destroyed; }
  findInPage(text: string, options?: FindInPageOptions) { this.searches.push({ text, options }); return this.searches.length; }
  stopFindInPage() { this.clears++; }
  get wc() { return this as unknown as WebContents; }
}

test('find accepts only the latest final native result and releases query/listeners on close', () => {
  const page = new FakePage(); let updates = 0;
  const tools = new PageTools(() => page.wc, () => updates++);
  tools.open('tab', page.wc); tools.open('tab', page.wc);
  assert.equal(page.listenerCount('found-in-page'), 1);
  tools.search('tab', page.wc, 'old', 'new');
  tools.search('tab', page.wc, 'new', 'new');
  const result = (requestId: number, finalUpdate: boolean, matches: number, activeMatchOrdinal: number) => page.emit('found-in-page', {}, { requestId, finalUpdate, matches, activeMatchOrdinal });
  const before = updates;
  result(1, true, 100, 1); result(2, false, 3, 1);
  assert.equal(updates, before); assert.equal(tools.snapshot()?.pending, true);
  result(2, true, 3, 1);
  assert.equal(tools.snapshot()?.matches, 3);
  tools.search('tab', page.wc, 'new', 'next');
  assert.equal(page.searches.at(-1)?.options?.findNext, true);
  tools.search('tab', page.wc, 'new', 'previous');
  assert.equal(page.searches.at(-1)?.options?.forward, false);
  tools.search('tab', page.wc, '', 'new');
  assert.equal(tools.snapshot()?.pending, false); assert.equal(tools.snapshot()?.matches, 0);
  tools.close(); assert.equal(tools.snapshot(), null);
  for (const event of ['found-in-page', 'did-start-navigation', 'render-process-gone', 'unresponsive', 'destroyed']) assert.equal(page.listenerCount(event), 0);
});

test('find is cleared on main navigation, crash, context/selection change and disposal; late results cannot revive it', () => {
  for (const event of ['did-start-navigation', 'render-process-gone', 'unresponsive', 'destroyed', 'selection', 'dispose']) {
    const page = new FakePage(); let active: WebContents | undefined = page.wc;
    const tools = new PageTools(() => active, () => {});
    tools.open('a', page.wc); tools.search('a', page.wc, 'private test text', 'new');
    page.emit('did-start-navigation', { isMainFrame: false }); assert.notEqual(tools.snapshot(), null);
    if (event === 'selection') { active = undefined; tools.reconcile(); }
    else if (event === 'dispose') tools.dispose();
    else page.emit(event, { isMainFrame: true });
    assert.equal(tools.snapshot(), null); assert.equal(page.listenerCount('found-in-page'), 0);
    page.emit('found-in-page', {}, { requestId: 1, finalUpdate: true, matches: 9, activeMatchOrdinal: 1 });
    assert.equal(tools.snapshot(), null);
    assert.throws(() => tools.search('a', page.wc, 'late', 'next'), /oturumu değişti/);
  }
});

test('find IPC accepts bounded literal text and rejects invalid shapes, foreign fields and directions', () => {
  assert.deepEqual(parseFindRequest({ tabId: 'a', text: '<script>not code</script>', direction: 'new' }), { tabId: 'a', text: '<script>not code</script>', direction: 'new' });
  for (const value of [null, [], {}, { tabId: '', text: '', direction: 'new' }, { tabId: 'a', text: 'x'.repeat(257), direction: 'new' }, { tabId: 'a', text: '\0', direction: 'new' }, { tabId: 'a', text: 'x', direction: 'execute' }, { tabId: 'a', text: 'x', direction: 'next', script: 'x' }]) assert.throws(() => parseFindRequest(value));
});

test('zoom moves through bounded steps, tolerates native rounding and resets without a site cache', () => {
  assert.equal(nextZoom(1.099999, 'in'), 1.25);
  assert.equal(nextZoom(1.100001, 'out'), 1);
  let value = 1;
  for (let i = 0; i < 30; i++) value = nextZoom(value, 'in');
  assert.equal(value, 3);
  for (let i = 0; i < 30; i++) value = nextZoom(value, 'out');
  assert.equal(value, 0.5);
  assert.equal(nextZoom(value, 'reset'), 1);
});
