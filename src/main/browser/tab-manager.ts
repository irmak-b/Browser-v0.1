import { randomUUID } from 'node:crypto';
import { WebContentsView, powerMonitor, Menu, clipboard, type BrowserWindow, type Session, type WebContents } from 'electron';
import { BrowserFault, type HistorySource, type TabSnapshot } from '../../shared/contracts';
import { SECURE_PREFERENCES } from './preferences';
import { siteUrl } from './policy';
import { canSleep, SLEEP_AFTER_MS, STATIC_PAGE_PROBE, FREEZE_AFTER_MS, FREEZE_PROBE, staticProbeExceededBudget } from './resource-policy';
import { PageFreezer } from './page-freezer';
import { RendererWatchdog, type HealthTarget } from './renderer-watchdog';
import { PageContextMenu } from './page-context-menu';
import { ClosedTabs } from './closed-tabs';

interface TabRecord {
  view?: WebContentsView;
  idleSince: number;
  nextCheck: number;
  interacted: boolean;
  sleepTask?: Promise<void>;
  freezeTask?: Promise<void>;
  sleepClosing?: boolean;
  scroll?: { x: number; y: number };
  resuming: boolean;
  reloadSafe: boolean;
  sleepBudgetBlocked: boolean;
  state: TabSnapshot;
  epoch: number;
  committedEpoch: number;
  documentRevision: number;
  expectedUrl: string;
  awaitingStart: boolean;
  closing: boolean;
  cleanup: (() => void)[];
  gestureAt: number;
  retainedPage?: TabSnapshot;
  downloadUrl?: string;
  source: HistorySource;
  recordedEpoch: number;
  visitId?: string;
}

export class TabManager {
  private readonly records = new Map<string, TabRecord>();
  private readonly closedIds = new Set<string>();
  private readonly closedTabs = new ClosedTabs();
  private selectedId: string | null = null;
  private disposed = false;
  private closingAll = false;
  private sleepTimer?: ReturnType<typeof setTimeout>;
  private readonly freezer=new PageFreezer();
  private activationRevision=0;
  private readonly watchdog: RendererWatchdog;
  private readonly contextMenu: PageContextMenu;
  private readonly healthHandlers = new WeakMap<WebContents, { hung: () => void; recovered: () => void }>();
  private readonly healthCleanup: (() => void)[] = [];

  constructor(
    private readonly window: BrowserWindow,
    private readonly session: Session,
    private readonly changed: () => void,
    private readonly notice: (text: string) => void,
    private readonly shortcut: (event: Electron.Event, input: Electron.Input) => void,
    private readonly visits: {
      complete: (tabId: string, token: string, url: string, title: string, source: HistorySource) => string | undefined;
      metadata: (eventId: string, title: string) => void;
    },
    private readonly busy: (wc: WebContents) => boolean = () => false,
    private readonly preparePage: (wc:WebContents,url:string)=>Promise<void> = async()=>{},
    private readonly fullscreen: (wc: WebContents, entered: boolean) => void = () => {},
    private readonly zoom: (wc: WebContents, direction: 'in' | 'out') => void = () => {},
    private readonly healthAllowed: () => boolean = () => true,
    private readonly cancelPage: (wc: WebContents) => void = () => {},
  ) {
    this.contextMenu = new PageContextMenu(window, items => Menu.buildFromTemplate(items), text => clipboard.writeText(text));
    this.watchdog = new RendererWatchdog(() => this.healthTarget(), target => this.currentHealth(target),
      target => this.healthHandlers.get(target.contents)?.hung(), target => this.healthHandlers.get(target.contents)?.recovered());
    const pause = () => { this.watchdog.pause(); this.contextMenu.close(); };
    const resume = () => this.watchdog.activity(true, 1000);
    window.on('blur', pause); window.on('hide', pause); window.on('minimize', pause);
    window.on('focus', resume); window.on('show', resume); window.on('restore', resume);
    this.healthCleanup.push(() => window.off('blur', pause), () => window.off('hide', pause), () => window.off('minimize', pause),
      () => window.off('focus', resume), () => window.off('show', resume), () => window.off('restore', resume));
    powerMonitor.on('suspend', pause); powerMonitor.on('resume', resume);
    this.healthCleanup.push(() => powerMonitor.off('suspend', pause), () => powerMonitor.off('resume', resume));
  }
  private healthTarget(): HealthTarget | undefined {
    const record = this.records.get(this.selectedId ?? ''), wc = record?.view?.webContents;
    if (this.disposed || this.closingAll || !record || !wc || wc.isDestroyed() || record.closing || record.freezeTask || record.sleepTask || record.state.frozen
      || record.committedEpoch < 0 || !/^https?:/.test(wc.getURL()) || !record.state.url
      || (record.state.errorCode && record.state.errorCode !== 'RENDER_PROCESS_UNRESPONSIVE')
      || this.window.isDestroyed() || !this.window.isFocused() || !this.window.isVisible() || this.window.isMinimized() || !this.healthAllowed() || wc.isDevToolsOpened()) return;
    try { const frame = wc.mainFrame; if (!frame.isDestroyed()) return { contents: wc, frame, epoch: record.epoch, document: record.documentRevision }; } catch { /* Navigating or closed. */ }
  }
  private currentHealth(target: HealthTarget) {
    if (this.disposed || target.contents.isDestroyed()) return false;
    const record = [...this.records.values()].find(record => record.view?.webContents === target.contents);
    try { return !!record && !record.closing && record.epoch === target.epoch && record.documentRevision === target.document && !target.frame.isDestroyed() && target.contents.mainFrame === target.frame; }
    catch { return false; }
  }
  reconcileHealth() { this.watchdog.reconcile(); this.contextMenu.reconcile(); }
  get activeId() { return this.selectedId; }
  get canRestoreClosedTab() { return !this.disposed && !this.closingAll && this.records.size < 32 && this.closedTabs.size > 0; }
  restoreClosedTab() {
    if (this.disposed || this.closingAll) throw new BrowserFault('OPERATION_CANCELLED', 'Pencere kapanıyor.');
    const result = this.closedTabs.restore((url, muted) => this.open(url, true, muted));
    this.notice('Kapatılan sekme yeniden yükleniyor; form ve video durumu geri getirilmez.');
    this.changed();
    return result;
  }
  contents(id:string){return this.get(id).view?.webContents;}
  peekContents(id:string){const wc=this.records.get(id)?.view?.webContents;return wc&&!wc.isDestroyed()?wc:undefined;}
  snapshots() { return [...this.records.values()].map((record) => ({ ...record.state })); }
  entries() { return [...this.records.values()].flatMap((record) => record.view ? [{ view: record.view, state: record.state }] : []); }
  owns(wc: WebContents) { return !this.disposed && [...this.records.values()].some((record) => record.view?.webContents === wc && !record.closing && !wc.isDestroyed()); }
  hasRecentGesture(wc: WebContents) {
    const record = this.records.get(this.selectedId ?? '');
    return !!record && record.view?.webContents === wc && this.owns(wc)
      && record.gestureAt > 0 && Date.now() - record.gestureAt < 1500;
  }
  setReloadSafety(webContentsId: number, safe: boolean) {
    const record = [...this.records.values()].find(r => r.view?.webContents.id === webContentsId);
    if (record) record.reloadSafe = safe;
  }
  protect(webContentsId: number) {
    const record = [...this.records.values()].find(r => r.view?.webContents.id === webContentsId);
    if (record) record.interacted = true;
  }
  downloadStarted(wc: WebContents, url: string) {
    const record = [...this.records.values()].find((record) => record.view?.webContents === wc);
    if (!record || !this.live(record) || record.expectedUrl !== url || record.committedEpoch === record.epoch) return;
    record.downloadUrl = url;
    this.restoreDownload(record);
  }
  private restoreDownload(record: TabRecord) {
    const wc = record.view!.webContents;
    if (!this.live(record) || record.closing || !record.downloadUrl || record.downloadUrl !== record.expectedUrl
      || wc.isLoadingMainFrame() || !record.retainedPage || wc.getURL() === record.downloadUrl) return false;
    record.epoch++;
    record.recordedEpoch = record.epoch;
    record.committedEpoch = record.epoch;
    record.awaitingStart = false;
    record.expectedUrl = record.retainedPage.url;
    const previous = record.retainedPage;
    record.retainedPage = undefined; record.downloadUrl = undefined;
    this.publish(record, { ...previous, muted: record.state.muted, audible: wc.isCurrentlyAudible(), loading: false, ...this.history(record) });
    return true;
  }
  private restoreRetained(record: TabRecord, stopped = false) {
    const previous = record.retainedPage, wc = record.view?.webContents;
    if (!this.live(record) || record.closing || record.sleepClosing || !wc || wc.isDestroyed()
      || !previous?.url || wc.getURL() !== previous.url) return false;
    record.epoch++;
    record.committedEpoch = record.recordedEpoch = record.epoch;
    record.expectedUrl = previous.url; record.awaitingStart = false; record.resuming = false;
    record.retainedPage = undefined; record.downloadUrl = undefined;
    this.publish(record, { ...previous, title: wc.getTitle().slice(0, 512), loading: false, status: stopped ? 'stopped' : previous.status,
      muted: record.state.muted, keepAwake: record.state.keepAwake, audible: wc.isCurrentlyAudible(), ...this.history(record) });
    this.scheduleSleep();
    return true;
  }
  private live(record: TabRecord) { return !this.disposed && this.records.get(record.state.tabId) === record; }
  private get(id: string, allowClosing = false): TabRecord {
    const record = this.records.get(id);
    if (!record || record.view?.webContents.isDestroyed()) {
      throw new BrowserFault(this.closedIds.has(id) ? 'TAB_CLOSED' : 'TAB_NOT_FOUND', 'Sekme bu pencereye ait değil veya kapanmış.');
    }
    if (record.closing && !allowClosing) throw new BrowserFault('TAB_CLOSED', 'Sekme kapanıyor.');
    return record;
  }
  private publish(record: TabRecord, patch: Partial<TabSnapshot>) {
    if (!this.live(record)) return;
    if (Object.entries(patch).every(([key, value]) => Object.is(record.state[key as keyof TabSnapshot], value))) return;
    Object.assign(record.state, patch);
    this.changed();
  }
  private fail(record: TabRecord, code: string) { this.publish(record, { loading: false, status: 'error', errorCode: code }); }
  private history(record: TabRecord) {
    const history = record.view!.webContents.navigationHistory;
    return { canGoBack: history.canGoBack(), canGoForward: history.canGoForward() };
  }
  private begin(record: TabRecord, url: string, source: HistorySource = 'navigate') {
    this.contextMenu.close();
    if (record.view) this.fullscreen(record.view.webContents, false);
    record.gestureAt = 0;
    if (!record.state.loading) record.retainedPage = { ...record.state };
    record.downloadUrl = undefined;
    record.epoch++;
    record.source = source;
    record.expectedUrl = url;
    record.awaitingStart = true;
    this.publish(record, { url, title: 'Yükleniyor…', loading: true, status: 'loading', errorCode: null });
    if (record.state.tabId === this.selectedId) this.watchdog.activity(true);
    return record.epoch;
  }

  private eligible(record: TabRecord) {
    const wc = record.view?.webContents;
    return !record.sleepBudgetBlocked && record.reloadSafe && !!wc && !wc.isDestroyed() && canSleep({ selected: record.state.tabId === this.selectedId,
      ready: record.state.status === 'ready' && !record.state.loading, closing: record.closing || this.closingAll,
      interacted: record.interacted, keepAwake: !!record.state.keepAwake,
      busy: wc.isLoading() || wc.isCurrentlyAudible() || wc.isBeingCaptured() || this.busy(wc),
      singleEntry: wc.navigationHistory.length() === 1, idleSince: record.idleSince }, Date.now());
  }
  private scheduleSleep() {
    clearTimeout(this.sleepTimer); this.sleepTimer = undefined;
    if (this.disposed || this.closingAll) return;
    const due = [...this.records.values()].filter(r => r.view && !r.freezeTask && !r.state.frozen && !r.sleepTask && !r.closing
      && r.state.status === 'ready' && r.state.tabId !== this.selectedId && !r.interacted && !r.state.keepAwake && !(r.reloadSafe && r.sleepBudgetBlocked))
      .map(r => Math.max(r.idleSince + (r.reloadSafe?SLEEP_AFTER_MS:FREEZE_AFTER_MS), r.nextCheck));
    if (!due.length) return;
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = undefined;
      for (const record of this.records.values()) {
        const delay=record.reloadSafe?SLEEP_AFTER_MS:FREEZE_AFTER_MS;
        if (record.sleepTask || record.freezeTask || record.state.frozen || record.reloadSafe && record.sleepBudgetBlocked || Math.max(record.idleSince + delay, record.nextCheck) > Date.now()) continue;
        record.nextCheck = Date.now() + delay;
        if(!record.reloadSafe){
          if(this.freezeEligible(record))record.freezeTask=this.tryFreeze(record).finally(()=>{record.freezeTask=undefined;this.scheduleSleep();});
          continue;
        }
        if (!this.eligible(record)) continue;
        record.sleepTask = this.trySleep(record).finally(() => {
          record.sleepTask = undefined;
          if (this.live(record) && !this.closingAll && record.state.status === 'sleeping' && record.state.tabId === this.selectedId) this.resume(record);
          this.scheduleSleep();
        });
      }
      this.scheduleSleep();
    }, Math.max(1, Math.min(...due) - Date.now()));
    this.sleepTimer.unref();
  }
  private freezeEligible(record:TabRecord){
    const wc=record.view?.webContents;
    return this.live(record)&&!!wc&&!wc.isDestroyed()&&!record.closing&&!this.closingAll
      &&record.state.tabId!==this.selectedId&&record.state.status==='ready'&&!record.state.loading
      &&!record.interacted&&!record.state.keepAwake&&!record.state.frozen
      &&!wc.isLoading()&&!wc.isCurrentlyAudible()&&!wc.isBeingCaptured()&&!this.busy(wc)
      &&Date.now()-record.idleSince>=FREEZE_AFTER_MS;
  }
  private async tryFreeze(record:TabRecord){
    const wc=record.view!.webContents,epoch=record.epoch;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const safe=await Promise.race([wc.executeJavaScriptInIsolatedWorld(1001,[{code:FREEZE_PROBE}]),new Promise<boolean>(r=>{timer=setTimeout(()=>r(false),1500);})]).finally(()=>clearTimeout(timer));
      if(safe!==true||record.epoch!==epoch||!this.freezeEligible(record))return;
      if(!await this.freezer.freeze(wc))return;
      // Native lifecycle changes are asynchronous: media, a WebSocket or a
      // download may have acquired protection while the command was pending.
      if(record.epoch!==epoch||!this.freezeEligible(record)){await this.freezer.resume(wc);return;}
      this.publish(record,{frozen:true});
    }catch{/* Leave uncertain pages running; no forced discard or reload. */}
  }
  private async trySleep(record: TabRecord) {
    const view = record.view!, wc = view.webContents, epoch = record.epoch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Constant read-only probe in an isolated world; only eligibility/scroll.
      // No site preload, form values, DOM dump or general-purpose UI script API.
      const safe = await Promise.race([
        wc.executeJavaScriptInIsolatedWorld(1001, [{ code: STATIC_PAGE_PROBE }]),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1500); }),
      ]).finally(() => clearTimeout(timer));
      if (staticProbeExceededBudget(safe) && this.live(record) && record.view === view && record.epoch === epoch) {
        // Remember only a definite budget result for this document. A new
        // committed document clears it; intents/hash/cancelled reloads do not.
        record.sleepBudgetBlocked = true;
        return;
      }
      if (!safe || safe.safe !== true || !Number.isFinite(safe.x) || !Number.isFinite(safe.y)
        || !this.live(record) || record.view !== view || record.epoch !== epoch || !this.eligible(record)) return;
      record.scroll = { x: safe.x, y: safe.y };
      record.sleepClosing = true;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); wc.off('destroyed', finish); wc.off('will-prevent-unload', finish); resolve(); };
        timer = setTimeout(finish, 5000);
        wc.once('destroyed', finish); wc.once('will-prevent-unload', finish);
        // Never override beforeunload; an unexpected guard leaves the tab live.
        wc.close({ waitForBeforeUnload: true });
      });
      if (!wc.isDestroyed() || !this.live(record)) return;
      for (const cleanup of record.cleanup) cleanup(); record.cleanup = [];
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view);
      record.view = undefined;
      record.epoch++; record.recordedEpoch = record.epoch;
      this.publish(record, { status: 'sleeping', loading: false, audible: false, canGoBack: false, canGoForward: false });
    } catch { /* Fail closed: an uncertain page remains resident. */ }
    finally { record.sleepClosing = false; }
  }

  open(url?: string, foreground = true, muted = false): { tabId: string } {
    if (this.disposed || this.closingAll) throw new BrowserFault('OPERATION_CANCELLED', 'Pencere kapanıyor.');
    if (this.records.size >= 32) throw new BrowserFault('INVALID_INPUT', 'Geliştirme sürümünde en fazla 32 sekme açılabilir.');
    if (url !== undefined) siteUrl(url);
    const id = randomUUID();
    const record: TabRecord = {
      idleSince: Date.now(), nextCheck: 0, interacted: false, resuming: false, reloadSafe: false, sleepBudgetBlocked: false,
      epoch: 0, committedEpoch: -1, documentRevision: 0, expectedUrl: '', awaitingStart: false, closing: false, cleanup: [], gestureAt: 0,
      source: 'navigate', recordedEpoch: -1,
      state: { tabId: id, url: '', title: 'Yeni sekme', loading: false, audible: false, muted, canGoBack: false, canGoForward: false, status: 'empty', errorCode: null },
    };
    this.records.set(id, record);
    if (foreground || !this.selectedId) this.select(id);
    this.changed();
    if (url !== undefined) this.navigate(id, url);
    this.scheduleSleep();
    return { tabId: id };
  }

  private attach(record: TabRecord) {
    if (record.view) return record.view;
    const id = record.state.tabId;
    const view = new WebContentsView({ webPreferences: { ...SECURE_PREFERENCES, session: this.session, navigateOnDragDrop: false, backgroundThrottling: true } });
    record.view = view;
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const wc = view.webContents;
    // Apply before the first navigation, including a muted sleeping tab's wake.
    wc.setAudioMuted(!!record.state.muted);
    wc.setWindowOpenHandler((details) => {
      let permitted = false;
      try {
        const url = siteUrl(details.url);
        permitted = this.live(record) && !record.closing && !this.closingAll && id === this.selectedId
          && Date.now() - record.gestureAt < 1500 && record.gestureAt > 0 && !details.postBody
          && details.disposition !== 'other' && new URL(url).origin === new URL(wc.getURL()).origin;
        if (permitted) queueMicrotask(() => {
          if (!this.live(record) || record.closing || this.closingAll) return;
          try { this.open(url, details.disposition !== 'background-tab'); this.notice('Popup aynı kaynaktan kontrollü yeni sekmede açıldı.'); }
          catch { this.notice('Popup engellendi; sekme açılamadı.'); }
        });
      } catch { /* deny */ }
      record.gestureAt = 0;
      if (!permitted && this.live(record)) this.notice('Popup engellendi. Yakın kullanıcı tıklaması, aynı kaynak ve HTTP(S) GET gerekir.');
      return { action: 'deny' };
    });
    const start = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (!this.live(record) || !details.isMainFrame || details.isSameDocument) return;
      if (record.awaitingStart && details.url !== record.expectedUrl) return;
      if (!record.awaitingStart) this.begin(record, details.url);
      record.awaitingStart = false;
    };
    const policy = (details: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>) => {
      try { siteUrl(details.url); }
      catch { details.preventDefault(); if (details.isMainFrame) this.fail(record, 'POLICY_BLOCKED'); }
    };
    const redirect = (details: Electron.Event<Electron.WebContentsWillRedirectEventParams>) => {
      try { siteUrl(details.url); }
      catch { details.preventDefault(); if (details.isMainFrame) this.fail(record, 'POLICY_BLOCKED'); }
    };
    const redirected = (details: Electron.Event<Electron.WebContentsDidRedirectNavigationEventParams>) => {
      if (this.live(record) && details.isMainFrame && !record.awaitingStart) {
        record.expectedUrl = details.url;
        this.publish(record, { url: details.url });
      }
    };
    const committed = (_event: Electron.Event, nextUrl: string, statusCode: number) => {
      if (!this.live(record) || record.awaitingStart || nextUrl !== record.expectedUrl) return;
      record.committedEpoch = record.epoch;
      record.documentRevision++;
      record.sleepBudgetBlocked = false;
      record.visitId = undefined;
      const oldDocumentWarning = record.state.errorCode === 'RENDER_PROCESS_UNRESPONSIVE';
      previousStatus = undefined; unresponsiveEpoch = -1;
      this.publish(record, { url: nextUrl, ...this.history(record),
        ...(oldDocumentWarning ? { loading: true, status: 'loading' as const, errorCode: null } : {}) });
      if (statusCode >= 400) this.fail(record, `HTTP_${statusCode}`);
      if (id === this.selectedId) this.watchdog.activity(true);
    };
    const pageState = (patch:Partial<TabSnapshot>,previousTitle=record.state.title) => {
      const titleChanged=patch.title!==undefined&&patch.title!==previousTitle;
      this.publish(record,patch);
      // Page title and finish/in-page events may arrive in either order. Send
      // metadata only when the real title changes, with no per-visit cache.
      if(titleChanged&&this.live(record)&&record.visitId)this.visits.metadata(record.visitId,record.state.title);
    };
    const finished = () => {
      if (this.restoreDownload(record)) return;
      if (!this.live(record) || record.awaitingStart || record.committedEpoch !== record.epoch
        || wc.getURL() !== record.expectedUrl || wc.isLoadingMainFrame() || record.state.status === 'error' || record.state.status === 'stopped') return;
      pageState({ url: wc.getURL(), title: wc.getTitle().slice(0, 512), loading: false, status: 'ready', errorCode: null, ...this.history(record) });
      if (record.recordedEpoch !== record.epoch && !record.resuming) {
        record.recordedEpoch = record.epoch;
        record.visitId = this.visits.complete(id, String(record.epoch), wc.getURL(), record.state.title, record.source);
      }
      if (record.resuming && record.scroll) {
        const { x, y } = record.scroll; record.scroll = undefined;
        void wc.executeJavaScriptInIsolatedWorld(1001, [{ code: `window.scrollTo(${x},${y});void 0` }]).catch(() => {});
      }
      record.resuming = false;
      this.scheduleSleep();
      if (id === this.selectedId) this.watchdog.activity();
    };
    const title = () => {
      if (this.live(record) && !record.awaitingStart && record.committedEpoch === record.epoch && wc.getURL() === record.expectedUrl) {
        pageState({ title: wc.getTitle().slice(0, 512) });
      }
    };
    const inPage = (_event: Electron.Event, nextUrl: string, mainFrame: boolean) => {
      if (!this.live(record) || !mainFrame) return;
      // A same-document address-bar/history request emits no did-navigate or
      // did-finish-load. Complete that request here instead of leaving loading on.
      if (record.awaitingStart) {
        if (nextUrl !== record.expectedUrl || wc.isLoadingMainFrame()) return;
        record.awaitingStart = false;
        record.committedEpoch = record.epoch;
        record.recordedEpoch = record.epoch;
        record.expectedUrl = nextUrl;
        pageState({ ...record.retainedPage, muted: record.state.muted, audible: wc.isCurrentlyAudible(), url: nextUrl, title: wc.getTitle().slice(0, 512), loading: false, ...this.history(record) },record.retainedPage?.title??record.state.title);
      } else if (record.committedEpoch === record.epoch) {
        // SPA/hash changes during document load belong to the current document.
        // Keep the new URL so its later finish event is not mistaken for stale work.
        record.expectedUrl = nextUrl;
        this.publish(record, { url: nextUrl, ...this.history(record) });
      }
    };
    const failed = (_event: Electron.Event, code: number, _description: string, nextUrl: string, mainFrame: boolean) => {
      if (this.live(record) && mainFrame && code !== -3 && !record.awaitingStart
        && record.expectedUrl === nextUrl && record.state.status !== 'error') this.fail(record, `NET_${code}`);
    };
    const gone = () => { if (this.live(record)) { this.publish(record, { audible: false }); this.fail(record, 'RENDER_PROCESS_GONE'); view.setVisible(false); } };
    let unresponsiveEpoch = -1;
    let previousStatus: TabSnapshot | undefined;
    const unresponsive = () => {
      if (!this.live(record) || record.closing || record.state.errorCode === 'RENDER_PROCESS_UNRESPONSIVE') return;
      unresponsiveEpoch = record.epoch; previousStatus = { ...record.state };
      this.fail(record, 'RENDER_PROCESS_UNRESPONSIVE'); view.setVisible(false);
      if (id === this.selectedId) this.notice('Sayfa yanıt vermiyor. Bekleyebilir, diğer sekmeleri kullanabilir veya onaylayarak bu sekmeyi kapatabilirsiniz.');
    };
    const responsive = () => {
      if (!this.live(record) || record.epoch !== unresponsiveEpoch || record.state.errorCode !== 'RENDER_PROCESS_UNRESPONSIVE' || !previousStatus) return;
      this.publish(record, { ...previousStatus, muted: record.state.muted, audible: wc.isCurrentlyAudible() });
      previousStatus = undefined;
      finished();
      if (id === this.selectedId) this.notice('Sayfa yeniden yanıt veriyor.');
    };
    this.healthHandlers.set(wc, { hung: unresponsive, recovered: responsive });
    const input = (event: Electron.Event, key: Electron.Input) => {
      // During an asynchronous thaw the old page can still own native focus.
      // Keep browser keys responsive there; an invisible background view may
      // not dispatch them on behalf of the currently selected page.
      if (this.live(record) && (id === this.selectedId || (view.getVisible() && wc.isFocused()))) this.shortcut(event, key);
      // A consumed host command never reaches the document. In particular,
      // Ctrl+Tab and its preceding modifier must not pin the departing page.
      // Ordinary page keys/chords still acquire the conservative protection.
      if (key.type === 'keyDown' && !event.defaultPrevented && !['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(key.key)) {
        record.interacted = true;
        if (!key.isAutoRepeat && !key.control && !key.meta && !key.alt && key.key !== 'Escape' && id === this.selectedId) record.gestureAt = Date.now();
      }
      if (key.type === 'keyDown' && !key.isAutoRepeat && id === this.selectedId) this.watchdog.activity();
    };
    const mouse = (_event: Electron.Event, value: Electron.MouseInputEvent) => {
      if (value.type === 'mouseDown') record.interacted = true;
      if (value.type === 'mouseDown' && id === this.selectedId) record.gestureAt = Date.now();
      if ((value.type === 'mouseDown' || value.type === 'mouseWheel') && id === this.selectedId) this.watchdog.activity();
    };
    const enteredFullscreen = () => this.fullscreen(wc, true);
    const zoom = (_event: Electron.Event, direction: 'in' | 'out') => {
      if (this.live(record) && id === this.selectedId && wc.isFocused()) this.zoom(wc, direction);
    };
    const leftFullscreen = () => this.fullscreen(wc, false);
    const audio = () => {
      if (this.live(record) && record.view === view && !record.closing && !record.sleepClosing && !wc.isDestroyed()) {
        this.publish(record, { audible: wc.isCurrentlyAudible(), muted: wc.isAudioMuted() });
      }
    };
    const unloadPrevented = () => {
      const previous = record.retainedPage;
      // Respect the native cancellation. Close/sleep have their own handling;
      // only reconcile an uncommitted navigation to this still-live document.
      if (!this.live(record) || record.closing || record.sleepClosing || wc.isDestroyed()
        || !record.state.loading || !previous || !previous.url || wc.getURL() !== previous.url
        || record.committedEpoch === record.epoch) return;
      this.restoreRetained(record);
      if (id === this.selectedId) this.notice('Sayfa ayrılmayı reddetti; mevcut içerik ve kaydedilmemiş değişiklikler korundu.');
    };
    const contextMenu = (_event: Electron.Event, params: Electron.ContextMenuParams) => {
      const epoch = record.epoch;
      const current = () => this.live(record) && !this.closingAll && !record.closing && record.view === view
        && record.epoch === epoch && this.selectedId === id && !wc.isDestroyed() && view.getVisible()
        && !record.state.errorCode && !record.state.frozen && !record.freezeTask && !record.sleepTask
        && !this.window.isDestroyed() && this.window.isFocused() && this.window.isVisible() && !this.window.isMinimized() && this.healthAllowed();
      this.contextMenu.show(wc, params, current, {
        openLink: url => { this.open(siteUrl(url), false); },
        back: () => this.go(id, 'back'), forward: () => this.go(id, 'forward'), reload: () => this.reload(id),
        failed: () => this.notice('Sağ tık işlemi tamamlanamadı; sekme sınırını veya sayfa durumunu kontrol edin.'),
      });
    };
    const destroyed = () => { this.fullscreen(wc, false); if (!record.sleepClosing) this.forget(record); };
    wc.on('context-menu', contextMenu);
    wc.on('audio-state-changed', audio);
    wc.on('will-prevent-unload', unloadPrevented);
    wc.on('enter-html-full-screen', enteredFullscreen);
    wc.on('leave-html-full-screen', leftFullscreen);
    wc.on('did-start-navigation', start);
    wc.on('will-frame-navigate', policy);
    wc.on('will-redirect', redirect);
    wc.on('did-redirect-navigation', redirected);
    wc.on('did-navigate', committed);
    wc.on('did-finish-load', finished);
    wc.on('did-stop-loading', finished);
    wc.on('page-title-updated', title);
    wc.on('did-navigate-in-page', inPage);
    wc.on('did-fail-load', failed);
    wc.on('render-process-gone', gone);
    wc.on('unresponsive', unresponsive);
    wc.on('responsive', responsive);
    wc.on('before-input-event', input);
    wc.on('before-mouse-event', mouse);
    wc.on('zoom-changed', zoom);
    wc.on('destroyed', destroyed);
    record.cleanup = [
      () => wc.off('audio-state-changed', audio),
      () => wc.off('will-prevent-unload', unloadPrevented),
      () => this.contextMenu.reconcile(), () => wc.off('context-menu', contextMenu),
      () => this.healthHandlers.delete(wc),
      () => wc.off('enter-html-full-screen', enteredFullscreen), () => wc.off('leave-html-full-screen', leftFullscreen),
      () => wc.off('did-start-navigation', start), () => wc.off('will-frame-navigate', policy),
      () => wc.off('will-redirect', redirect), () => wc.off('did-redirect-navigation', redirected),
      () => wc.off('did-navigate', committed), () => wc.off('did-finish-load', finished),
      () => wc.off('did-stop-loading', finished), () => wc.off('page-title-updated', title),
      () => wc.off('did-navigate-in-page', inPage), () => wc.off('did-fail-load', failed),
      () => wc.off('render-process-gone', gone), () => wc.off('before-input-event', input),
      () => wc.off('unresponsive', unresponsive), () => wc.off('responsive', responsive),
      () => wc.off('before-mouse-event', mouse),
      () => wc.off('zoom-changed', zoom),
      () => wc.off('destroyed', destroyed),
    ];
    return view;
  }

  private select(id: string) {
    this.contextMenu.close();
    const previous = this.records.get(this.selectedId ?? '');
    if (previous && previous.state.tabId !== id) { previous.idleSince = Date.now(); previous.nextCheck = 0; }
    this.selectedId = id;
  }
  async activate(id: string) {
    const revision=++this.activationRevision;
    const record = this.get(id); this.select(id);
    if(record.freezeTask)await record.freezeTask;
    if(!this.live(record)||revision!==this.activationRevision||this.selectedId!==id){this.scheduleSleep();throw new BrowserFault('OPERATION_CANCELLED','Sekme seçimi değişti.');}
    if(record.view&&record.state.frozen){await this.freezer.resume(record.view.webContents);if(this.live(record))this.publish(record,{frozen:false});}
    if(!this.live(record)||revision!==this.activationRevision||this.selectedId!==id){this.scheduleSleep();throw new BrowserFault('OPERATION_CANCELLED','Sekme seçimi değişti.');}
    if (record.state.status === 'sleeping' && !record.sleepTask) this.resume(record);
    this.changed(); this.scheduleSleep(); this.watchdog.activity(true); return { tabId: id };
  }
  async setKeepAwake(id: string, keepAwake: boolean) {
    const record = this.get(id); record.state.keepAwake = keepAwake;
    if(keepAwake&&record.freezeTask)await record.freezeTask;
    if(keepAwake&&record.view&&record.state.frozen){await this.freezer.resume(record.view.webContents);if(this.live(record))this.publish(record,{frozen:false});}
    record.nextCheck = 0; this.changed(); this.scheduleSleep(); return null;
  }
  setMuted(id: string, muted: boolean) {
    const record = this.get(id);
    if (record.view && record.view.webContents.isAudioMuted() !== muted) record.view.webContents.setAudioMuted(muted);
    this.publish(record, { muted });
    return null;
  }
  private resume(record: TabRecord) {
    const url = record.state.url;
    this.navigate(record.state.tabId, url);
    record.resuming = true;
    record.recordedEpoch = record.epoch;
    this.notice('Uyuyan sekme yeniden yükleniyor; internet bağlantısı gerekebilir.');
  }
  async navigate(id: string, input: string) {
    const record = this.get(id);
    if(record.freezeTask)await record.freezeTask;
    if(record.view&&record.state.frozen){await this.freezer.resume(record.view.webContents);if(!this.live(record))throw new BrowserFault('OPERATION_CANCELLED','Sekme kapandı.');this.publish(record,{frozen:false});}
    if (record.sleepTask) throw new BrowserFault('OPERATION_CANCELLED', 'Sekme uyutuluyor; tekrar deneyin.');
    const url = siteUrl(input);
    const view = this.attach(record);
    record.resuming = false;
    const epoch = this.begin(record, url);
    await this.preparePage(view.webContents,url);
    if(!this.live(record)||record.epoch!==epoch||record.closing||view.webContents.isDestroyed())return null;
    void view.webContents.loadURL(url).catch((error: unknown) => {
      if (!this.live(record) || epoch !== record.epoch || record.closing || record.state.status === 'error') return;
      if ((error as { code?: string }).code === 'ERR_ABORTED') {
        this.publish(record, { loading: false, status: 'stopped', ...this.history(record) });
      } else this.fail(record, 'LOAD_FAILED');
    });
    return null;
  }
  async go(id: string, direction: 'back' | 'forward') {
    const record = this.get(id);
    if(record.freezeTask)await record.freezeTask;
    if(record.view&&record.state.frozen){await this.freezer.resume(record.view.webContents);if(!this.live(record))throw new BrowserFault('OPERATION_CANCELLED','Sekme kapandı.');this.publish(record,{frozen:false});}
    if (!record.view) throw new BrowserFault('OPERATION_CANCELLED', 'Bu yönde gidilecek sayfa yok.');
    const navigation = record.view!.webContents.navigationHistory;
    const possible = direction === 'back' ? navigation.canGoBack() : navigation.canGoForward();
    if (!possible) throw new BrowserFault('OPERATION_CANCELLED', 'Bu yönde gidilecek sayfa yok.');
    const target = navigation.getEntryAtIndex(navigation.getActiveIndex() + (direction === 'back' ? -1 : 1));
    if (!target) throw new BrowserFault('OPERATION_CANCELLED', 'Geçmiş girdisi bulunamadı.');
    const url=siteUrl(target.url),epoch=this.begin(record,url,direction);
    await this.preparePage(record.view.webContents,url);
    if(!this.live(record)||record.epoch!==epoch||record.closing)return null;
    if (direction === 'back') navigation.goBack(); else navigation.goForward();
    return null;
  }
  async reload(id: string, ignoreCache = false) {
    const record = this.get(id);
    if(record.freezeTask)await record.freezeTask;
    if(record.view&&record.state.frozen){await this.freezer.resume(record.view.webContents);if(!this.live(record))throw new BrowserFault('OPERATION_CANCELLED','Sekme kapandı.');this.publish(record,{frozen:false});}
    if (!record.state.url) throw new BrowserFault('OPERATION_CANCELLED', 'Önce bir sayfa açın.');
    // A stopped first request can leave only the local bootstrap document.
    // Retry the requested address, rather than reloading that blank document.
    if (!record.view || record.view.webContents.getURL() !== record.state.url) {
      await this.navigate(id, record.state.url);
      if (ignoreCache && this.live(record)) this.notice('Önce adres yükleniyor. Önbelleği atlamak için sayfa açıldıktan sonra kısayolu tekrar kullanabilirsiniz.');
      return null;
    }
    const url=siteUrl(record.state.url),epoch=this.begin(record,url,'reload');
    await this.preparePage(record.view.webContents,url);
    if(!this.live(record)||record.epoch!==epoch||record.closing)return null;
    record.resuming = false;
    if (ignoreCache) record.view.webContents.reloadIgnoringCache(); else record.view.webContents.reload();
    return null;
  }
  stop(id: string) {
    const record = this.get(id);
    if (!record.state.loading || !record.view) return null;
    const uncommitted = record.committedEpoch !== record.epoch, wc = record.view.webContents;
    record.epoch++;
    record.awaitingStart = false;
    wc.stop();
    if (!uncommitted || !this.restoreRetained(record, true)) {
      const currentUrl = wc.getURL(), hasDocument = /^https?:/.test(currentUrl);
      // Keep the current document's events live, but never count an unfinished
      // load as a completed visit, including a late native finish after stop.
      record.committedEpoch = hasDocument ? record.epoch : -1;
      record.recordedEpoch = record.epoch;
      record.expectedUrl = hasDocument ? currentUrl : record.state.url;
      record.retainedPage = undefined; record.downloadUrl = undefined; record.resuming = false; record.scroll = undefined;
      this.publish(record, {
        url: record.expectedUrl, title: wc.getTitle().slice(0, 512) || 'Durduruldu',
        loading: false, status: 'stopped', errorCode: null, ...this.history(record),
      });
    }
    this.cancelPage(wc);
    if (id === this.selectedId) this.watchdog.activity(true);
    return null;
  }
  async close(id: string, force = false): Promise<{ closed: boolean }> {
    const record = this.get(id);
    if(!force&&record.freezeTask)await record.freezeTask;
    if(!force&&record.view&&record.state.frozen){await this.freezer.resume(record.view.webContents);record.state.frozen=false;}
    if (!force&&record.sleepTask) { await record.sleepTask; return this.close(id); }
    if (!record.view) { record.closing = true; this.forget(record); return { closed: true }; }
    const wc = record.view.webContents;
    record.closing = true;
    this.contextMenu.reconcile();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: BrowserFault) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        wc.off('destroyed', done);
        wc.off('will-prevent-unload', prevented);
        if (error) { record.closing = false; reject(error); } else resolve();
      };
      const done = () => finish();
      const prevented = () => finish(new BrowserFault('OPERATION_CANCELLED', 'Sayfa kaydedilmemiş değişiklik nedeniyle açık tutuldu.'));
      const timeout = setTimeout(() => finish(new BrowserFault('OPERATION_CANCELLED', 'Sekme kapanışı tamamlanamadı.')), 5000);
      wc.once('destroyed', done);
      wc.once('will-prevent-unload', prevented);
      wc.close({ waitForBeforeUnload: !force });
    });
    return { closed: true };
  }
  forceCloseUnresponsive(id: string) {
    const record = this.get(id);
    if (record.state.errorCode !== 'RENDER_PROCESS_UNRESPONSIVE' || !record.view) throw new BrowserFault('OPERATION_CANCELLED', 'Bu sekme artık yanıtsız değil.');
    return this.close(id, true);
  }
  private forget(record: TabRecord) {
    if (!this.live(record)) return;
    if (record.closing && !this.closingAll) this.closedTabs.remember(record.state.url, !!record.state.muted);
    const ids = [...this.records.keys()];
    const index = ids.indexOf(record.state.tabId);
    this.records.delete(record.state.tabId);
    this.closedIds.add(record.state.tabId);
    if (this.closedIds.size > 128) this.closedIds.delete(this.closedIds.values().next().value!);
    for (const cleanup of record.cleanup) cleanup();
    record.cleanup = [];
    if(record.view){this.freezer.detach(record.view.webContents);if(!this.window.isDestroyed())this.window.contentView.removeChildView(record.view);}
    record.view=undefined;record.retainedPage=undefined;record.scroll=undefined;
    const replacedActive=this.selectedId===record.state.tabId;
    if (replacedActive) this.selectedId = ids[index + 1] ?? ids[index - 1] ?? null;
    if (!this.records.size && !this.closingAll) this.open(); else {
      const selected = this.records.get(this.selectedId ?? '');
      if(replacedActive&&selected&&!this.closingAll&&(selected.state.frozen||selected.freezeTask||selected.state.status==='sleeping')){
        // Visibility can wake Chromium before our frozen flag is cleared.
        // Use the ordinary activation path so future background checks work,
        // and fence late completion against any newer user selection.
        const revision=this.activationRevision+1;
        void this.activate(selected.state.tabId).catch(()=>{
          if(this.live(selected)&&!this.closingAll&&this.selectedId===selected.state.tabId&&revision===this.activationRevision)
            this.notice('Sekme otomatik etkinleştirilemedi; yeniden seçebilir veya yenileyebilirsiniz.');
        });
      }
      this.changed(); this.scheduleSleep();
      this.watchdog.activity(true);
    }
  }
  async closeAllForWindow(): Promise<boolean> {
    this.closingAll = true;
    this.contextMenu.close();
    try { for (const id of [...this.records.keys()]) await this.close(id); return true; }
    catch { this.closingAll = false; this.scheduleSleep();this.notice('Pencere kapatılmadı; sayfa kapanışı iptal edildi.'); return false; }
  }
  dispose() {
    this.disposed = true;
    this.closedTabs.clear();
    this.contextMenu.dispose();
    this.watchdog.dispose(); for (const cleanup of this.healthCleanup) cleanup();
    clearTimeout(this.sleepTimer);
    for (const record of this.records.values()) {
      for (const remove of record.cleanup) remove();
      record.cleanup = [];
      if(record.view)this.freezer.detach(record.view.webContents);
      if (record.view && !this.window.isDestroyed()) this.window.contentView.removeChildView(record.view);
      if (record.view && !record.view.webContents.isDestroyed()) record.view.webContents.close({ waitForBeforeUnload: false });
    }
    this.records.clear();
    this.selectedId = null;
  }
}
