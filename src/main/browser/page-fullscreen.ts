import type { BrowserWindow, WebContents } from 'electron';
import type { Bounds } from '../../shared/contracts';
import { fullscreenHintCode, FULLSCREEN_HINT_WORLD } from './fullscreen-hint';

export const FULLSCREEN_HINT_MS = 3000;

// The page fills the whole screen from entry. The hint never changes its size.
// One cancellable timeout per entry; no polling or renderer-supplied bounds.
export class PageFullscreen {
  private owner: WebContents | null = null;
  private origin = '';
  private hintVisible = false;
  private hintTimer?: ReturnType<typeof setTimeout>;
  private hintRevision = 0;
  constructor(private readonly window: BrowserWindow, private readonly changed: () => void) {
    window.on('leave-full-screen', this.nativeExit);
  }
  get contents() { return this.owner; }
  snapshot() { return this.owner ? { origin: this.origin, hintVisible: this.hintVisible } : null; }
  enter(wc: WebContents) {
    if (this.owner === wc) return;
    this.exit(false);
    this.owner = wc;
    this.origin = new URL(wc.getURL()).origin;
    this.hintVisible = true;
    const revision = ++this.hintRevision;
    this.hintTimer = setTimeout(() => {
      this.hintTimer = undefined;
      if (this.owner !== wc || this.hintRevision !== revision) return;
      this.hintVisible = false;
      this.renderHint(wc, false);
      this.changed();
    }, FULLSCREEN_HINT_MS);
    this.window.setFullScreen(true);
    this.changed();
    this.renderHint(wc, true, revision);
  }
  leave(wc: WebContents) { if (this.owner === wc) this.exit(); }
  exit(notify = true) {
    clearTimeout(this.hintTimer); this.hintTimer = undefined;
    const wc = this.owner;
    if (!wc) return;
    this.renderHint(wc, false);
    this.owner = null; this.origin = ''; this.hintVisible = false;
    if (!wc.isDestroyed() && !wc.isCrashed()) void wc.executeJavaScript('document.fullscreenElement ? document.exitFullscreen().catch(()=>{}) : undefined').catch(() => {});
    if (!this.window.isDestroyed()) this.window.setFullScreen(false);
    if (notify) this.changed();
  }
  bounds(width: number, height: number): Bounds {
    return { x: 0, y: 0, width, height };
  }
  private renderHint(wc: WebContents, show: boolean, revision = ++this.hintRevision) {
    if (wc.isDestroyed() || wc.isCrashed()) return;
    void wc.executeJavaScriptInIsolatedWorld(FULLSCREEN_HINT_WORLD, [{ code: fullscreenHintCode(revision, show) }]).catch(() => {});
  }
  private readonly nativeExit = () => this.exit();
  dispose() { this.exit(false); this.window.off('leave-full-screen', this.nativeExit); }
}
