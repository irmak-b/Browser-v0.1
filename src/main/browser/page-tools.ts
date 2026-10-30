import type { WebContents } from 'electron';
import { BrowserFault, type FindSnapshot, type FindDirection, type ZoomDirection } from '../../shared/contracts';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export function nextZoom(current: number, direction: ZoomDirection): number {
  if (direction === 'reset' || !Number.isFinite(current)) return 1;
  const value = Math.round(current * 100) / 100;
  return direction === 'in'
    ? ZOOM_STEPS.find(step => step > value) ?? 3
    : ZOOM_STEPS.findLast(step => step < value) ?? 0.5;
}

// One active find session, no timer, document copy or per-tab query cache.
export class PageTools {
  private owner?: WebContents;
  private state: FindSnapshot | null = null;
  private requestId?: number;
  private cleanup?: () => void;
  constructor(private readonly active: () => WebContents | undefined, private readonly changed: () => void) {}
  snapshot(): FindSnapshot | null { return this.state ? { ...this.state } : null; }
  reconcile() { if (this.owner && (this.owner.isDestroyed() || this.owner !== this.active())) this.close(false); }
  open(tabId: string, wc: WebContents) {
    if (this.owner === wc && this.state?.tabId === tabId) return;
    this.close(false);
    this.owner = wc;
    this.state = { tabId, text: '', matches: 0, activeMatch: 0, pending: false };
    const found = (_event: Electron.Event, result: Electron.Result) => {
      if (wc !== this.owner || wc !== this.active() || !this.state || result.requestId !== this.requestId || !result.finalUpdate) return;
      this.state = { ...this.state, matches: result.matches, activeMatch: result.activeMatchOrdinal, pending: false };
      this.changed();
    };
    const navigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (details.isMainFrame) this.close();
    };
    const invalidate = () => this.close();
    wc.on('found-in-page', found);
    wc.on('did-start-navigation', navigation);
    wc.on('render-process-gone', invalidate);
    wc.on('unresponsive', invalidate);
    wc.on('destroyed', invalidate);
    this.cleanup = () => {
      wc.off('found-in-page', found); wc.off('did-start-navigation', navigation);
      wc.off('render-process-gone', invalidate); wc.off('unresponsive', invalidate); wc.off('destroyed', invalidate);
    };
    this.changed();
  }
  search(tabId: string, wc: WebContents, text: string, direction: FindDirection) {
    if (this.owner !== wc || this.state?.tabId !== tabId || wc !== this.active()) {
      throw new BrowserFault('OPERATION_CANCELLED', 'Arama oturumu değişti.');
    }
    const findNext = direction !== 'new' && this.state.text === text;
    this.requestId = undefined;
    this.state = { tabId, text, matches: 0, activeMatch: 0, pending: !!text };
    if (!text) wc.stopFindInPage('clearSelection');
    else this.requestId = wc.findInPage(text, { forward: direction !== 'previous', findNext, matchCase: false });
    this.changed();
  }
  close(notify = true) {
    const wc = this.owner;
    this.owner = undefined; this.requestId = undefined; this.state = null;
    this.cleanup?.(); this.cleanup = undefined;
    if (wc && !wc.isDestroyed()) {
      try { wc.stopFindInPage('clearSelection'); } catch { /* The renderer may have just crashed. */ }
    }
    if (wc && notify) this.changed();
  }
  dispose() { this.close(false); }
}
