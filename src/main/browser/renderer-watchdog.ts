import type { WebContents, WebFrameMain } from 'electron';

export interface HealthTarget { contents: WebContents; frame: WebFrameMain; epoch: number; document: number }
export interface HealthClock { now(): number; after(ms: number, callback: () => void): () => void }
const clock: HealthClock = {
  now: () => performance.now(),
  after(ms, callback) { const timer = setTimeout(callback, ms); timer.unref(); return () => clearTimeout(timer); },
};
export const HEALTH_DELAY_MS = 250;
export const HEALTH_TIMEOUT_MS = 5000;
export const HEALTH_COOLDOWN_MS = 2000;
interface Check { target: HealthTarget; pending: boolean; warned: boolean; due: number; again: boolean }
const same = (a: HealthTarget | undefined, b: HealthTarget) => a?.contents === b.contents && a.frame === b.frame && a.epoch === b.epoch && a.document === b.document;

// Input/commit/selection driven, never an interval or idle heartbeat. Only one
// active delay/deadline and one authoritative request for the current document.
// Old native replies cannot be cancelled; they are only weakly observed.
export class RendererWatchdog {
  private active?: Check;
  private outstanding = new WeakMap<WebContents, Check>();
  private cancelDelay?: () => void;
  private cancelDeadline?: () => void;
  private nextCheck = 0;
  private disposed = false;
  constructor(
    private readonly selected: () => HealthTarget | undefined,
    private readonly current: (target: HealthTarget) => boolean,
    private readonly hung: (target: HealthTarget) => void,
    private readonly recovered: (target: HealthTarget) => void,
    private readonly time: HealthClock = clock,
    // Fixed primitive, not a UI/site-provided script or DOM scan. Unlike
    // webContents.executeJavaScript this does not wait for network load to end.
    private readonly probe = (target: HealthTarget) => target.frame.executeJavaScript('0'),
  ) {}
  reconcile() {
    if (this.active && (!same(this.selected(), this.active.target) || !this.current(this.active.target))) this.pause();
  }
  activity(force = false, grace = HEALTH_DELAY_MS) {
    if (this.disposed) return;
    const target = this.selected();
    if (!target || !this.current(target)) { this.pause(); return; }
    if (this.active && same(this.active.target, target)) {
      if (this.active.pending) this.active.again = true;
      return;
    }
    this.pause();
    const pending = this.outstanding.get(target.contents);
    if (pending && pending.target.frame === target.frame && pending.target.document === target.document) {
      // Do not queue another execution behind an already blocked frame.
      if (pending.target.epoch !== target.epoch) {
        // A new navigation intent may still be waiting on this same renderer.
        // Reuse its one request, but discard the old warning/restore authority.
        pending.target = target; pending.warned = false; pending.again = true;
      }
      if (same(pending.target, target)) {
        this.active = pending;
        if (!pending.warned) this.deadline(pending, HEALTH_TIMEOUT_MS);
      }
      return;
    }
    // A wrapper may survive a committed reload while an execution sent to
    // its old native document never replies. Never let that old request own
    // the new document's deadline, warning or recovery authority.
    if (pending) this.outstanding.delete(target.contents);
    const check: Check = { target, pending: false, warned: false, due: 0, again: false };
    this.active = check;
    const delay = Math.max(grace, force ? 0 : this.nextCheck - this.time.now());
    this.cancelDelay = this.time.after(delay, () => {
      this.cancelDelay = undefined;
      if (!this.usable(check)) { if (this.active === check) this.pause(); return; }
      check.pending = true; this.outstanding.set(target.contents, check);
      this.deadline(check, HEALTH_TIMEOUT_MS);
      try { this.observe(check, this.probe(target)); }
      catch { this.finish(check, false); }
    });
  }
  private observe(check: Check, response: Promise<unknown>) {
    // Retired native executions have no cancellation API. Their eventual
    // completion must not retain a closed target or this whole manager.
    const owner = new WeakRef(this), ticket = new WeakRef(check);
    void Promise.resolve(response).then(value => {
      const manager = owner.deref(), current = ticket.deref();
      if (manager && current) manager.finish(current, value === 0);
    }, () => {
      const manager = owner.deref(), current = ticket.deref();
      if (manager && current) manager.finish(current, false);
    });
  }
  private usable(check: Check) {
    return !this.disposed && this.active === check && same(this.selected(), check.target) && this.current(check.target);
  }
  private deadline(check: Check, delay: number) {
    this.cancelDeadline?.();
    check.due = this.time.now() + delay;
    this.cancelDeadline = this.time.after(delay, () => {
      this.cancelDeadline = undefined;
      if (!this.usable(check)) { if (this.active === check) this.pause(); return; }
      // A stalled main loop or OS wake must get a chance to consume an already
      // queued healthy reply before it declares a renderer unresponsive.
      if (this.time.now() - check.due > 1000) { this.deadline(check, 1000); return; }
      if (!check.warned) { check.warned = true; this.hung(check.target); }
    });
  }
  private finish(check: Check, healthy: boolean) {
    if (this.outstanding.get(check.target.contents) === check) this.outstanding.delete(check.target.contents);
    if (this.active === check) this.pause();
    if (this.disposed || !this.current(check.target)) return;
    this.nextCheck = this.time.now() + HEALTH_COOLDOWN_MS;
    // A warned background tab may recover, but the host still checks its exact
    // document/epoch and must not replace a newer tab's notice or selection.
    if (healthy && check.warned && this.current(check.target)) this.recovered(check.target);
    const selected = this.selected();
    if (selected?.contents === check.target.contents && !same(selected, check.target) && this.current(selected)) this.activity(true);
    else if (healthy && check.again && same(selected, check.target) && this.current(check.target)) this.activity();
  }
  pause() {
    this.cancelDelay?.(); this.cancelDelay = undefined;
    this.cancelDeadline?.(); this.cancelDeadline = undefined;
    this.active = undefined;
  }
  dispose() { this.disposed = true; this.pause(); this.outstanding = new WeakMap(); }
}
