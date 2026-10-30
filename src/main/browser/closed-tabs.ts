import { BrowserFault } from '../../shared/contracts';
import { siteUrl } from './policy';

export const CLOSED_TAB_LIMIT = 10;
export const CLOSED_TAB_URL_LIMIT = 8192;

/** Current-context address and mute preference: no live pages or timers. */
export class ClosedTabs {
  private readonly urls: { url: string; muted: boolean }[] = [];
  get size() { return this.urls.length; }
  remember(input: string, muted = false) {
    if (!input || input.length > CLOSED_TAB_URL_LIMIT || /[\u0000-\u0020\u007f\\]/u.test(input)) return;
    let url: string;
    try { url = siteUrl(input); } catch { return; }
    if (url.length > CLOSED_TAB_URL_LIMIT) return;
    if (this.urls.length === CLOSED_TAB_LIMIT) this.urls.shift();
    this.urls.push({ url, muted });
  }
  restore<T>(open: (url: string, muted: boolean) => T): T {
    const entry = this.urls.at(-1);
    if (!entry) throw new BrowserFault('OPERATION_CANCELLED', 'Geri açılacak kapalı sekme yok.');
    // Do not lose the address when opening is rejected (for example, 32 tabs).
    const result = open(entry.url, entry.muted);
    this.urls.pop();
    return result;
  }
  clear() { this.urls.length = 0; }
}
