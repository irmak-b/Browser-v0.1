import { randomUUID } from 'node:crypto';
import type { DevelopmentHistoryMode, HistoryEntry, HistorySnapshot, HistorySource } from '../../shared/contracts';

export interface PageVisit extends HistoryEntry { profileKey: string; navigationToken: string }
export type HistoryFailureCode = 'offline' | 'timeout' | 'unauthorized' | 'forbidden' | 'unavailable';
export class HistoryFailure extends Error {
  constructor(readonly code: HistoryFailureCode) { super(code); }
}
export interface HistorySink {
  recordVisit(visit: Readonly<PageVisit>, signal: AbortSignal): Promise<void>;
  updateVisitMetadata(profileKey: string, eventId: string, title: string, signal: AbortSignal): Promise<void>;
}

// The adapter boundary accepts the app context resolved in main. A future API
// must authenticate and enforce ownership on its server; profileKey is not auth.
export class MemoryHistorySink implements HistorySink {
  private readonly profiles = new Map<string, Map<string, PageVisit>>();
  mode: DevelopmentHistoryMode = 'normal';
  constructor(private readonly capacity = 100) {}
  private async gate(signal: AbortSignal) {
    signal.throwIfAborted();
    const mode = this.mode;
    if (mode === 'timeout') await new Promise<void>((_resolve, reject) => {
      const abort = () => reject(new HistoryFailure('timeout'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
    });
    if (mode !== 'normal') throw new HistoryFailure(mode);
    signal.throwIfAborted();
  }
  async recordVisit(visit: Readonly<PageVisit>, signal: AbortSignal) {
    await this.gate(signal);
    signal.throwIfAborted();
    let entries = this.profiles.get(visit.profileKey);
    if (!entries) { entries = new Map(); this.profiles.set(visit.profileKey, entries); }
    // Insert once by eventId; retries do not create a second visit or undo a
    // newer metadata update. Successful records stay local to this process.
    if (!entries.has(visit.eventId)) entries.set(visit.eventId, { ...visit });
    while (entries.size > this.capacity) entries.delete(entries.keys().next().value!);
  }
  async updateVisitMetadata(profileKey: string, eventId: string, title: string, signal: AbortSignal) {
    await this.gate(signal);
    signal.throwIfAborted();
    const visit = this.profiles.get(profileKey)?.get(eventId);
    if (visit) visit.title = title;
  }
  entries(profileKey: string): HistoryEntry[] {
    return [...(this.profiles.get(profileKey)?.values() ?? [])].reverse().slice(0, 20)
      .map(({ profileKey: _profile, navigationToken: _token, ...entry }) => ({ ...entry }));
  }
}

type Job = { type: 'record'; visit: PageVisit } | { type: 'metadata'; eventId: string; title: string };
interface Context { epoch: string; profileKey: string }
interface Options { timeoutMs?: number; maxQueue?: number; includeFixtures?: boolean; fixtureOrigin?: string }

export class HistoryService {
  private context: Context | null = null;
  private queue: Job[] = [];
  private readonly seen = new Map<string, string>();
  private status: HistorySnapshot['status'] = 'memory-only';
  private dropped = 0;
  private generation = 0;
  private running = false;
  private inFlight: AbortController | null = null;
  private halted = false;
  private disposed = false;
  constructor(private readonly sink: HistorySink, private readonly changed: () => void,
    private readonly entries: (profileKey: string) => HistoryEntry[], private readonly options: Options = {}) {}
  activate(context: Context) {
    this.generation++; this.inFlight?.abort(); this.inFlight = null;
    this.context = context; this.queue = []; this.seen.clear();
    this.status = 'memory-only'; this.dropped = 0; this.running = false; this.halted = false;
  }
  snapshot(simulation: DevelopmentHistoryMode): HistorySnapshot {
    return { mode: 'development-memory', status: this.dropped ? 'queue-full' : this.status,
      simulation, pendingCount: this.queue.length, droppedCount: this.dropped,
      entries: this.context ? this.entries(this.context.profileKey) : [] };
  }
  complete(tabId: string, navigationToken: string, url: string, title: string, source: HistorySource): string | undefined {
    if (!this.context || this.disposed) return;
    let safe: URL;
    try { safe = new URL(url); } catch { return; }
    if (!['http:', 'https:'].includes(safe.protocol) || safe.username || safe.password) return;
    const fixture = safe.origin === this.options.fixtureOrigin;
    if (fixture && !this.options.includeFixtures) return;
    const key = `${tabId}:${navigationToken}`;
    const existing = this.seen.get(key);
    if (existing) return existing;
    // No query, fragment or credentials enter the development history sink.
    safe.search = ''; safe.hash = '';
    const eventId = randomUUID();
    this.seen.set(key, eventId);
    if (this.seen.size > 256) this.seen.delete(this.seen.keys().next().value!);
    this.enqueue({ type: 'record', visit: { eventId, profileKey: this.context.profileKey,
      navigationToken, url: safe.href.slice(0, 8192), title: title.slice(0, 512),
      visitedAtUtc: new Date().toISOString(), source, developmentFixture: fixture } });
    return eventId;
  }
  metadata(eventId: string, title: string) {
    if (!this.context || this.disposed) return;
    const bounded = title.slice(0, 512);
    const pending = this.queue.find((job, index) => (!this.running || index !== 0) && job.type === 'metadata' && job.eventId === eventId);
    if (pending?.type === 'metadata') { pending.title = bounded; return; }
    this.enqueue({ type: 'metadata', eventId, title: bounded });
  }
  private enqueue(job: Job) {
    if (this.queue.length >= (this.options.maxQueue ?? 50)) { this.dropped++; this.changed(); return; }
    this.queue.push(job); this.status = this.halted ? this.status : 'pending'; this.changed();
    void this.pump();
  }
  retry() {
    // A user may restore the service before an earlier timeout has settled.
    // Fence off that attempt and retry the same queued IDs immediately.
    if (this.running) { this.generation++; this.inFlight?.abort(); this.inFlight = null; this.running = false; }
    this.halted = false; this.status = this.queue.length ? 'pending' : 'memory-only'; this.changed(); void this.pump();
  }
  private async pump() {
    if (this.running || this.halted || this.disposed || !this.context) return;
    this.running = true;
    const generation = this.generation;
    const context = this.context;
    try {
      while (this.queue.length && generation === this.generation && !this.disposed) {
        const job = this.queue[0]!;
        const abort = new AbortController(); this.inFlight = abort;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const operation = job.type === 'record'
            ? this.sink.recordVisit({ ...job.visit }, abort.signal)
            : this.sink.updateVisitMetadata(context.profileKey, job.eventId, job.title, abort.signal);
          await Promise.race([operation, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { abort.abort(); reject(new HistoryFailure('timeout')); }, this.options.timeoutMs ?? 1500);
          })]);
          if (generation !== this.generation || this.disposed) return;
          this.queue.shift(); this.status = this.queue.length ? 'pending' : 'memory-only'; this.changed();
        } catch (error) {
          if (generation !== this.generation || this.disposed) return;
          this.status = error instanceof HistoryFailure ? error.code : 'unavailable';
          this.halted = true; this.changed(); return;
        } finally { clearTimeout(timer); if (this.inFlight === abort) this.inFlight = null; }
      }
    } finally { if (generation === this.generation) this.running = false; }
  }
  dispose() { this.disposed = true; this.generation++; this.inFlight?.abort(); this.queue = []; this.seen.clear(); this.context = null; }
}
