import type { BrowserWindow, ContextMenuParams, Menu, MenuItemConstructorOptions, WebContents } from 'electron';
import { siteUrl } from './policy';

type Popup = Pick<Menu, 'popup' | 'closePopup'>;
interface Actions {
  openLink: (url: string) => void;
  back: () => Promise<unknown>;
  forward: () => Promise<unknown>;
  reload: () => Promise<unknown>;
  failed: () => void;
}

export function contextLink(input: string): string | undefined {
  if (!input || input.length > 8192 || /[\u0000-\u0020\u007f\\]/u.test(input)) return;
  try { return siteUrl(input); } catch { return; }
}

/** One short-lived native menu. No DOM probes, clipboard reads or idle work. */
export class PageContextMenu {
  private active?: { menu: Popup; current: () => boolean; live: boolean; release: () => void };
  private disposed = false;
  constructor(
    private readonly window: BrowserWindow,
    private readonly create: (items: MenuItemConstructorOptions[]) => Popup,
    private readonly copyLink: (text: string) => unknown,
  ) {}
  show(wc: WebContents, params: ContextMenuParams, current: () => boolean, actions: Actions) {
    this.close();
    if (this.disposed || !current() || !params.frame || params.frame.isDestroyed()) return;
    const frame = params.frame, frameUrl = frame.url;
    const valid = () => !this.disposed && !wc.isDestroyed() && !frame.isDestroyed() && frame.url === frameUrl && current();
    const items: MenuItemConstructorOptions[] = [];
    let owner: NonNullable<PageContextMenu['active']>;
    const add = (id: string, label: string, enabled: boolean, action: () => unknown, edit = false) => {
      items.push({ id, label, enabled, click: () => {
        if (!enabled || !owner.live || !valid() || (edit && wc.focusedFrame !== frame)) return;
        this.close();
        if (!valid()) return;
        try {
          const result = action();
          void Promise.resolve(result).catch(() => { if (valid()) actions.failed(); });
        } catch { if (valid()) actions.failed(); }
      } });
    };
    const separate = () => { if (items.length) items.push({ type: 'separator' }); };
    const link = contextLink(params.linkURL);
    if (link) {
      add('open-link', 'Bağlantıyı yeni sekmede aç', true, () => actions.openLink(link));
      add('copy-link', 'Bağlantı adresini kopyala', true, () => this.copyLink(link));
    }
    const flags = params.editFlags, password = params.formControlType === 'input-password';
    if (params.isEditable) {
      separate();
      add('undo', 'Geri al', flags.canUndo, () => wc.undo(), true);
      add('redo', 'Yinele', flags.canRedo, () => wc.redo(), true);
      separate();
      add('cut', 'Kes', !password && flags.canCut, () => wc.cut(), true);
      add('copy', 'Kopyala', !password && flags.canCopy, () => wc.copy(), true);
      add('paste', 'Yapıştır', flags.canPaste, () => wc.paste(), true);
    } else {
      if (params.selectionText.length && flags.canCopy) { separate(); add('copy', 'Kopyala', true, () => wc.copy(), true); }
      if (!link && !params.selectionText.length) {
        add('back', 'Geri', wc.navigationHistory.canGoBack(), actions.back);
        add('forward', 'İleri', wc.navigationHistory.canGoForward(), actions.forward);
        add('reload', 'Yenile', true, actions.reload);
      }
    }
    separate();
    add('select-all', 'Tümünü seç', flags.canSelectAll, () => wc.selectAll(), true);
    const menu = this.create(items);
    // Even a same-URL subframe reload invalidates the clicked document. These
    // listeners exist only while the native menu is open, never for idle tabs.
    const cancel = () => this.close();
    owner = { menu, current: valid, live: true, release: () => {
      wc.off('did-start-navigation', cancel); wc.off('render-process-gone', cancel); wc.off('destroyed', cancel);
    } };
    this.active = owner;
    wc.on('did-start-navigation', cancel); wc.on('render-process-gone', cancel); wc.on('destroyed', cancel);
    try {
      menu.popup({ window: this.window, frame, sourceType: params.menuSourceType, callback: () => {
        owner.live = false;
        owner.release();
        if (this.active === owner) this.active = undefined;
      } });
    } catch { this.close(); }
  }
  reconcile() { if (this.active && !this.active.current()) this.close(); }
  close() {
    const owner = this.active; this.active = undefined;
    if (!owner) return;
    owner.live = false;
    owner.release();
    try { owner.menu.closePopup(this.window); } catch { /* Window/menu already gone. */ }
  }
  dispose() { this.disposed = true; this.close(); }
}
