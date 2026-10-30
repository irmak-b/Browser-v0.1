import { WebContentsView, type Session } from 'electron';
import { SECURE_PREFERENCES } from './preferences';

// Stop execution, never unregister or erase cache/cookies. A temporary opaque
// target scopes the fixed ServiceWorker command to this exact partition.
export class IdleWorkers {
  private timer?: ReturnType<typeof setTimeout>;
  private task?: Promise<void>;
  private previous = false;
  private previousKeep = false;
  private disposed = false;
  private target?: WebContentsView;
  status = 'idle';
  constructor(private readonly session: Session, private readonly hasPages: () => boolean, private readonly keepBackground: () => boolean) {}
  update() {
    const active = this.hasPages();
    const keep = this.keepBackground();
    if (active) { clearTimeout(this.timer); this.timer = undefined; if (!this.task) this.status = 'idle'; }
    else if ((this.previous || this.previousKeep && !keep) && !this.disposed) {
      clearTimeout(this.timer); this.status = 'scheduled';
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.task = this.stop().catch(() => { this.status = 'unsupported'; }).finally(() => { this.task = undefined; });
      }, 1000); this.timer.unref();
    }
    this.previous = active;
    this.previousKeep = keep;
  }
  // New main-owned site creation waits only for an already-running cleanup, so
  // it cannot race a stop command against the new document's worker startup.
  ready() { return this.task ?? Promise.resolve(); }
  private async stop() {
    if (this.disposed || this.hasPages()) { this.status = 'cancelled'; return; }
    if (this.keepBackground()) { this.status = 'kept-permission'; return; }
    if (!Object.keys(this.session.serviceWorkers.getAllRunning()).length) { this.status = 'no-workers'; return; }
    this.status = 'cleaning';
    const view = new WebContentsView({ webPreferences: { ...SECURE_PREFERENCES, session: this.session, backgroundThrottling: true } });
    this.target = view; const wc = view.webContents;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      await wc.loadURL('about:blank');
      if (this.disposed || this.hasPages() || this.keepBackground() || wc.isDestroyed()) { this.status = 'cancelled'; return; }
      wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('ServiceWorker.enable');
      if (this.disposed || this.hasPages() || this.keepBackground()) { this.status = 'cancelled'; return; }
      await wc.debugger.sendCommand('ServiceWorker.stopAllWorkers'); this.status = 'stopped';
    };
    try {
      await Promise.race([work(), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('worker cleanup timeout')), 1500); })]);
    } catch { this.status = 'unsupported'; }
    finally {
      clearTimeout(timeout);
      if (!wc.isDestroyed()) { try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch {} wc.close({ waitForBeforeUnload: false }); }
      this.target = undefined;
    }
  }
  snapshot() { return { status: this.status, running: Object.keys(this.session.serviceWorkers.getAllRunning()).length }; }
  dispose() {
    this.disposed = true; clearTimeout(this.timer);
    const wc = this.target?.webContents;
    if (wc && !wc.isDestroyed()) wc.close({ waitForBeforeUnload: false });
  }
}
