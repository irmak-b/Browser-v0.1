import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { HistoryFailure, HistoryService, MemoryHistorySink, type HistorySink, type PageVisit } from '../../src/main/browser/history';

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) { if (check()) return; await delay(5); }
  assert.fail('History operation did not settle');
}
function setup(options: { maxQueue?: number; timeoutMs?: number; includeFixtures?: boolean; fixtureOrigin?: string } = {}) {
  const sink = new MemoryHistorySink();
  const service = new HistoryService(sink, () => {}, (key) => sink.entries(key), options);
  service.activate({ epoch: 'a', profileKey: 'profile-a' });
  return { sink, service, snapshot: () => service.snapshot(sink.mode) };
}

test('B25/B27: completion is idempotent; late titles update the same event without query/fragment exposure', async () => {
  const { sink, service, snapshot } = setup();
  try {
    const id = service.complete('tab', 'nav-1', 'https://example.test/page?private=value#secret', 'First', 'navigate')!;
    assert.equal(service.complete('tab', 'nav-1', 'https://example.test/page', 'Duplicate', 'navigate'), id);
    await until(() => snapshot().pendingCount === 0);
    service.metadata(id, 'Last title');
    await until(() => snapshot().pendingCount === 0);
    assert.equal(sink.entries('profile-a').length, 1);
    assert.equal(snapshot().entries[0]!.title, 'Last title');
    assert.equal(snapshot().entries[0]!.url, 'https://example.test/page');
    assert.equal('profileKey' in snapshot().entries[0]!, false);
    assert.equal('navigationToken' in snapshot().entries[0]!, false);
  } finally { service.dispose(); }
});

test('B26: non-web/credential URLs and fixture production history are excluded', async () => {
  const { service, snapshot } = setup({ fixtureOrigin: 'http://127.0.0.1:1234' });
  try {
    for (const url of ['app://browser/index.html','about:blank','file:///C:/secret','https://user:pw@example.test/','http://127.0.0.1:1234/page']) {
      assert.equal(service.complete('tab', url, url, 'Blocked', 'navigate'), undefined);
    }
    assert.equal(snapshot().entries.length, 0);
    assert.equal(snapshot().pendingCount, 0);
  } finally { service.dispose(); }
});

test('B29: offline/timeout/401/403 remain unsaved and recover on explicit retry', async () => {
  for (const mode of ['offline','timeout','unauthorized','forbidden'] as const) {
    const { sink, service, snapshot } = setup({ timeoutMs: 15 });
    try {
      sink.mode = mode;
      service.complete('tab', 'nav', 'https://example.test/', 'Pending', 'navigate');
      await until(() => snapshot().status === mode);
      assert.equal(snapshot().pendingCount, 1); assert.equal(snapshot().entries.length, 0);
      sink.mode = 'normal'; service.retry();
      await until(() => snapshot().pendingCount === 0);
      assert.equal(snapshot().status, 'memory-only'); assert.equal(snapshot().entries.length, 1);
    } finally { service.dispose(); }
  }
});

test('B30: retry after an uncertain acknowledgement uses the same eventId and preserves the late title', async () => {
  const memory = new MemoryHistorySink(); let first = true;
  const ids: string[] = [];
  const sink: HistorySink = {
    async recordVisit(visit, signal) {
      ids.push(visit.eventId); await memory.recordVisit(visit, signal);
      if (first) { first = false; throw new HistoryFailure('offline'); }
    },
    updateVisitMetadata: (...args) => memory.updateVisitMetadata(...args),
  };
  const service = new HistoryService(sink, () => {}, (key) => memory.entries(key));
  service.activate({ epoch: 'a', profileKey: 'a' });
  try {
    const id = service.complete('tab','1','https://example.test/','First','navigate')!;
    await until(() => service.snapshot('normal').status === 'offline');
    service.metadata(id, 'After acknowledgement'); service.retry();
    await until(() => service.snapshot('normal').pendingCount === 0);
    assert.deepEqual(ids, [id, id]);
    assert.equal(memory.entries('a').length, 1); assert.equal(memory.entries('a')[0]!.title, 'After acknowledgement');
  } finally { service.dispose(); }
});

test('B30: offline queue is bounded and reports dropped records instead of claiming they were saved', async () => {
  const { sink, service, snapshot } = setup({ maxQueue: 2 });
  try {
    sink.mode = 'offline';
    service.complete('tab','1','https://example.test/1','One','navigate');
    await until(() => snapshot().status === 'offline');
    service.complete('tab','2','https://example.test/2','Two','navigate');
    service.complete('tab','3','https://example.test/3','Three','navigate');
    assert.equal(snapshot().pendingCount, 2); assert.equal(snapshot().droppedCount, 1); assert.equal(snapshot().status, 'queue-full');
    sink.mode = 'normal'; service.retry(); await until(() => snapshot().pendingCount === 0);
    assert.equal(snapshot().entries.length, 2); assert.equal(snapshot().status, 'queue-full');
  } finally { service.dispose(); }
});

test('B16/B30: late completion from an abort-ignoring transport cannot mutate the active profile state', async () => {
  const memory = new MemoryHistorySink();
  let release: (() => void) | undefined;
  const sink: HistorySink = {
    async recordVisit(visit, signal) {
      if (visit.profileKey === 'a') await new Promise<void>((resolve) => { release = resolve; });
      await memory.recordVisit(visit, signal);
    }, updateVisitMetadata: (...args) => memory.updateVisitMetadata(...args),
  };
  const service = new HistoryService(sink, () => {}, (key) => memory.entries(key), { timeoutMs: 100 });
  try {
    service.activate({epoch:'a',profileKey:'a'}); service.complete('tab','1','https://example.test/a','Old','navigate');
    service.activate({epoch:'b',profileKey:'b'}); service.complete('tab','1','https://example.test/b','New','navigate');
    release!(); await until(() => service.snapshot('normal').pendingCount === 0);
    assert.equal(service.snapshot('normal').entries[0]!.title, 'New');
    assert.equal(memory.entries('a').length, 0);
  } finally { service.dispose(); }
});

test('B27: a metadata update arriving while another is in flight is not lost', async () => {
  const memory = new MemoryHistorySink(); let release: (() => void) | undefined; let wait = true;
  const sink: HistorySink = {
    recordVisit: (...args) => memory.recordVisit(...args),
    async updateVisitMetadata(profile, id, title, signal) {
      if (wait) { wait = false; await new Promise<void>((resolve) => { release = resolve; }); }
      await memory.updateVisitMetadata(profile, id, title, signal);
    },
  };
  const service = new HistoryService(sink, () => {}, (key) => memory.entries(key));
  service.activate({epoch:'a',profileKey:'a'});
  try {
    const id = service.complete('t','1','https://example.test/','Initial','navigate')!;
    await until(() => service.snapshot('normal').pendingCount === 0);
    service.metadata(id, 'Intermediate'); service.metadata(id, 'Final'); release!();
    await until(() => service.snapshot('normal').pendingCount === 0);
    assert.equal(memory.entries('a')[0]!.title, 'Final');
  } finally { service.dispose(); }
});

test('memory storage retains only the configured number of records per profile', async () => {
  const memory = new MemoryHistorySink(2); const signal = new AbortController().signal;
  for (let i=0;i<3;i++) await memory.recordVisit({eventId:String(i),profileKey:'a',navigationToken:String(i),url:'https://example.test/',title:String(i),visitedAtUtc:new Date().toISOString(),source:'navigate',developmentFixture:false} satisfies PageVisit, signal);
  assert.deepEqual(memory.entries('a').map((entry) => entry.eventId), ['2','1']);
});

test('B29: restoring a service while its timeout is pending retries promptly with the same visit', async () => {
  const { sink, service, snapshot } = setup({ timeoutMs: 500 });
  try {
    sink.mode='timeout'; const id=service.complete('t','1','https://example.test/','Pending','navigate');
    sink.mode='normal'; service.retry();
    await until(() => snapshot().pendingCount === 0);
    assert.equal(snapshot().entries.length, 1); assert.equal(snapshot().entries[0]!.eventId, id);
    assert.equal(snapshot().status, 'memory-only');
  } finally { service.dispose(); }
});
