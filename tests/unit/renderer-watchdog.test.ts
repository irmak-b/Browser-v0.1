import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WebContents, WebFrameMain } from 'electron';
import { RendererWatchdog, type HealthClock, type HealthTarget } from '../../src/main/browser/renderer-watchdog';

class Clock implements HealthClock {
  value = 0; sequence = 0;
  tasks = new Map<number, { due: number; callback: () => void }>();
  now() { return this.value; }
  after(ms: number, callback: () => void) {
    const id = ++this.sequence; this.tasks.set(id, { due: this.value + ms, callback });
    return () => { this.tasks.delete(id); };
  }
  advance(ms: number, late = false) {
    const end = this.value + ms;
    if (late) this.value = end;
    while (true) {
      const next = [...this.tasks].sort((a, b) => a[1].due - b[1].due).find(([, task]) => task.due <= end);
      if (!next) break;
      this.tasks.delete(next[0]); if (!late) this.value = next[1].due; next[1].callback();
    }
    this.value = end;
  }
}
function fixture() {
  const time = new Clock();
  const a = { contents: {} as WebContents, frame: {} as WebFrameMain, epoch: 1, document: 1 };
  const b = { contents: {} as WebContents, frame: {} as WebFrameMain, epoch: 2, document: 1 };
  let active: HealthTarget | undefined = a, disposed = false;
  const calls: { target: HealthTarget; resolve: (value: unknown) => void; reject: () => void }[] = [];
  const hangs: HealthTarget[] = [], recovered: HealthTarget[] = [];
  const watcher = new RendererWatchdog(() => active, target => !disposed && (target === a || target === b),
    target => hangs.push(target), target => recovered.push(target), time, target => new Promise((resolve, reject) => calls.push({ target, resolve, reject })));
  return { time, a, b, calls, hangs, recovered, watcher, select(target?: HealthTarget) { active = target; watcher.reconcile(); }, invalidate() { disposed = true; watcher.reconcile(); } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('watchdog has no idle polling, coalesces input and schedules a trailing check during cooldown', async () => {
  const f = fixture();
  f.time.advance(100000); assert.equal(f.calls.length, 0); assert.equal(f.time.tasks.size, 0);
  for (let i = 0; i < 100; i++) f.watcher.activity();
  assert.equal(f.time.tasks.size, 1); f.time.advance(250); assert.equal(f.calls.length, 1);
  for (let i = 0; i < 100; i++) f.watcher.activity();
  assert.equal(f.calls.length, 1); assert.equal(f.time.tasks.size, 1);
  f.calls[0]!.resolve(0); await flush(); assert.equal(f.time.tasks.size, 1);
  f.watcher.activity(); // A single click within cooldown must not be lost.
  f.time.advance(1999); assert.equal(f.calls.length, 1);
  f.time.advance(1); assert.equal(f.calls.length, 2);
  f.calls[1]!.resolve(0); await flush();
  f.time.advance(100000); assert.equal(f.calls.length, 2); assert.equal(f.time.tasks.size, 0);
});

test('one blocked execution warns once, never queues retries and restores a warned background document', async () => {
  const f = fixture(); f.watcher.activity(true); f.time.advance(250);
  for (let i = 0; i < 200; i++) f.watcher.activity();
  f.time.advance(5000); assert.deepEqual(f.hangs, [f.a]);
  f.time.advance(50000); assert.equal(f.hangs.length, 1); assert.equal(f.calls.length, 1); assert.equal(f.time.tasks.size, 0);
  f.select(f.b); f.watcher.activity(true); f.time.advance(250);
  assert.equal(f.calls.length, 2);
  f.calls[0]!.resolve(0); await flush(); assert.deepEqual(f.recovered, [f.a]);
  f.calls[1]!.resolve(0); await flush(); assert.equal(f.time.tasks.size, 0);
});

test('selection, invalidation, rejected probes and disposal cannot warn or restore a newer document', async () => {
  for (const mode of ['selection', 'invalidate', 'reject', 'dispose']) {
    const f = fixture(); f.watcher.activity(true); f.time.advance(250);
    if (mode === 'selection') f.select(f.b);
    if (mode === 'invalidate') f.invalidate();
    if (mode === 'reject') { f.calls[0]!.reject(); await flush(); }
    if (mode === 'dispose') f.watcher.dispose();
    f.time.advance(10000); f.calls[0]!.resolve(0); await flush();
    assert.equal(f.hangs.length, 0); assert.equal(f.recovered.length, 0); assert.equal(f.time.tasks.size, 0);
  }
});

test('blur/suspend cancels the deadline and reuses a pending native request with a fresh budget after resume', () => {
  const f = fixture(); f.watcher.activity(true); f.time.advance(250);
  f.watcher.pause(); f.time.advance(20000); assert.equal(f.hangs.length, 0); assert.equal(f.time.tasks.size, 0);
  f.watcher.activity(true); assert.equal(f.calls.length, 1);
  f.time.advance(4999); assert.equal(f.hangs.length, 0);
  f.time.advance(1); assert.equal(f.hangs.length, 1);
});

test('a delayed main timer gives an already queued healthy reply time to run', async () => {
  const f = fixture(); f.watcher.activity(true); f.time.advance(250);
  f.time.advance(8000, true); assert.equal(f.hangs.length, 0); assert.equal(f.time.tasks.size, 1);
  f.calls[0]!.resolve(0); await flush(); f.time.advance(10000);
  assert.equal(f.hangs.length, 0); assert.equal(f.time.tasks.size, 0);
});

test('an old document reply cannot restore a newer navigation and releases its queued document check', async () => {
  const time = new Clock(), contents = {} as WebContents, frame = {} as WebFrameMain;
  let epoch = 1, restored = 0;
  const calls: { epoch: number; resolve: (value: unknown) => void }[] = [];
  const watcher = new RendererWatchdog(() => ({ contents, frame, epoch, document: 1 }), target => target.epoch === epoch,
    () => {}, () => restored++, time, target => new Promise(resolve => calls.push({ epoch: target.epoch, resolve })));
  watcher.activity(true); time.advance(5250); // Old document was warned.
  epoch = 2; watcher.reconcile(); watcher.activity(true);
  assert.equal(calls.length, 1); calls[0]!.resolve(0); await flush();
  assert.equal(restored, 0); time.advance(2000);
  assert.equal(calls.length, 2); assert.equal(calls[1]!.epoch, 2);
  calls[1]!.resolve(0); await flush(); assert.equal(time.tasks.size, 0);
});

test('a committed new document retires a lost old reply even when the native frame wrapper is reused', async () => {
  const time=new Clock(),contents={} as WebContents,frame={} as WebFrameMain;
  let epoch=1,document=1,hangs=0,recovered=0;
  const calls:{resolve:(value:unknown)=>void}[]=[];
  const watcher=new RendererWatchdog(()=>({contents,frame,epoch,document}),
    target=>target.epoch===epoch&&target.document===document,
    ()=>hangs++,()=>recovered++,time,()=>new Promise(resolve=>calls.push({resolve})));
  watcher.activity(true);time.advance(250);assert.equal(calls.length,1);
  epoch++;watcher.reconcile();watcher.activity(true);time.advance(250);
  assert.equal(calls.length,1,'An uncommitted intent still reuses the same blocked execution');
  document++;watcher.reconcile();watcher.activity(true);time.advance(250);
  assert.equal(calls.length,2,'New committed document must get its own native execution');
  calls[1]!.resolve(0);await flush();time.advance(6000);
  assert.equal(hangs,0);assert.equal(time.tasks.size,0);
  calls[0]!.resolve(0);await flush();
  assert.equal(hangs,0);assert.equal(recovered,0);assert.equal(time.tasks.size,0);
});
