import { randomUUID } from 'node:crypto';
import { app, dialog, type BrowserWindow, type WebContents } from 'electron';
import { BrowserFault, CHANNEL, LAYOUT, type DevelopmentIdentity, type DevelopmentTheme, type DevelopmentHistoryMode, type BrowserSnapshot, type ViewportRequest, type Bounds, type ResourceSnapshot } from '../../shared/contracts';
import version from '../../../app-version.json';
import { safeBounds } from './layout';
import { resolveInput } from './policy';
import { TabManager } from './tab-manager';
import { SiteSessions } from './site-sessions';
import { DownloadManager } from './downloads';
import { HistoryService, MemoryHistorySink } from './history';
import { IdleMemory } from './idle-memory';
import { PageFullscreen } from './page-fullscreen';
import { permissionLabel } from './permission-policy';
import { SitePermissions } from './site-permissions';
import { browserShortcut, type BrowserShortcut } from './shortcuts';
import { PageTools, nextZoom } from './page-tools';
export { SECURE_PREFERENCES } from './preferences';

export class BrowserController {
  private tabs: TabManager;
  private revision = 0;
  private contextEpoch = randomUUID();
  private identity: DevelopmentIdentity = 'test-a';
  private theme: DevelopmentTheme = 'light';
  private switching = false;
  private modalDepth = 0;
  private readonly sessions: SiteSessions;
  private readonly downloads: DownloadManager;
  private readonly historySink = new MemoryHistorySink();
  private readonly history: HistoryService;
  private lastViewportRevision = -1;
  private viewport: ViewportRequest | null = null;
  private disposed = false;
  private stateNotification?: ReturnType<typeof setImmediate>;
  private downloadNotification = false;
  private shortcutRevision = 0;
  private notice: string | null = null;
  private readonly idleMemory:IdleMemory;
  private readonly fullscreen: PageFullscreen;
  private readonly permissions: SitePermissions;
  private readonly pageTools: PageTools;

  constructor(private readonly window: BrowserWindow, private readonly fixtureUrl: string) {
    this.pageTools = new PageTools(() => this.tabs?.peekContents(this.tabs.activeId ?? ''), () => this.publish());
    this.fullscreen = new PageFullscreen(window, () => this.publish());
    this.permissions = new SitePermissions(() => ({ epoch: this.contextEpoch,
      active: this.tabs?.peekContents(this.tabs.activeId ?? ''), owns: wc => !this.switching && !!this.tabs?.owns(wc),
      canPrompt: !this.disposed && !this.switching && this.modalDepth === 0 && this.viewport?.visible !== false && !window.isDestroyed() && window.isFocused(),
    }), options => dialog.showMessageBox(window, options), open => this.setModal(open), () => this.publish(),
    permission => { this.notice = `${permissionLabel(permission)} izni reddedildi · site politikası.`; this.publish(); }, wc => this.tabs.protect(wc.id));
    this.history = new HistoryService(this.historySink, () => this.publish(), (key) => this.historySink.entries(key),
      { fixtureOrigin: new URL(fixtureUrl).origin, includeFixtures: !app.isPackaged });
    this.downloads = new DownloadManager(window,
      () => ({ identity: this.identity, epoch: this.contextEpoch, owns: (wc) => !this.switching && this.tabs.owns(wc) }),
      () => {
        this.downloadNotification = true;
        this.publish();
      }, (text) => { this.notice = text; this.publish(); },
      (open) => this.setModal(open),
      (owner, url) => this.tabs.downloadStarted(owner, url));
    this.sessions = new SiteSessions((id, target) => this.downloads.attach(id, target));
    this.sessions.permissions = this.permissions;
    this.sessions.permissionContextActive = id => !this.disposed && !this.switching && id === this.identity;
    this.sessions.hasPages = id => id === this.identity && !!this.tabs?.entries().length;
    this.sessions.keepBackground = id => id === this.identity && this.permissions.hasBackgroundPermission();
    this.sessions.reloadSafety = (wcId, safe) => this.tabs?.setReloadSafety(wcId, safe);
    this.sessions.protect = wcId => this.tabs?.protect(wcId);
    this.sessions.blockedChanged=id=>{if(!this.disposed&&!this.switching&&id===this.identity)this.publish();};
    this.sessions.fullscreenAllowed = wc => this.canFullscreen(wc);
    this.sessions.permissionDenied = (id, permission) => {
      if (!this.disposed && !this.switching && id === this.identity) { this.notice = `${permissionLabel(permission)} izni reddedildi · site politikası.`; this.publish(); }
    };
    this.history.activate({ epoch: this.contextEpoch, profileKey: this.sessions.profileKey(this.identity) });
    this.idleMemory=new IdleMemory(window,()=>this.tabs?.entries().length??0);
    this.tabs = this.createTabs();
    this.tabs.open();
  }
  get epoch() { return this.contextEpoch; }
  private setModal(open: boolean) {
    if (open) this.fullscreen.exit();
    this.modalDepth = Math.max(0, this.modalDepth + (open ? 1 : -1)); this.resize();
  }
  private createTabs() {
    return new TabManager(this.window, this.sessions.get(this.identity), () => this.publish(),
      (text) => { this.notice = text; this.publish(); }, (event, input) => this.handleShortcut(event, input),
      { complete: (...args) => this.history.complete(...args), metadata: (...args) => this.history.metadata(...args) },
      wc => this.modalDepth > 0 || this.switching || this.downloads.protects(wc),
      (wc,url)=>this.sessions.filter(this.identity).prepareNavigation(wc,url),
      (wc, entered) => {
        if (!entered) this.fullscreen.leave(wc);
        else if (this.canFullscreen(wc)) { this.notice = null; this.fullscreen.enter(wc); }
        else if (!wc.isDestroyed()) void wc.executeJavaScript('document.fullscreenElement ? document.exitFullscreen().catch(()=>{}) : undefined').catch(() => {});
      }, (wc, direction) => {
        const id = this.tabs.activeId;
        if (id && !this.disposed && !this.switching && this.modalDepth === 0 && wc === this.tabs.peekContents(id)) this.zoom(id, direction);
      }, () => !this.disposed && !this.switching && this.modalDepth === 0 && this.viewport?.visible !== false,
      wc => this.sessions.filter(this.identity).cancelNavigation(wc));
  }
  private canFullscreen(wc: WebContents) {
    return !this.disposed && !this.switching && this.modalDepth === 0 && this.viewport?.visible !== false
      && !this.window.isDestroyed() && this.window.isFocused() && wc.isFocused() && this.tabs?.hasRecentGesture(wc);
  }
  exitFullscreen() { this.available(); this.fullscreen.exit(); return null; }
  private available() { if (this.switching || this.disposed) throw new BrowserFault('OPERATION_CANCELLED', 'Bağlam değişiyor veya kapanıyor.'); }
  async switchIdentity(identity: DevelopmentIdentity) {
    if (app.isPackaged) throw new BrowserFault('POLICY_BLOCKED', 'Test kullanıcısı yalnız geliştirmede seçilir.');
    this.available();
    if (identity === this.identity) return null;
    this.fullscreen.exit();
    this.permissions.reset();
    this.pageTools.close(false);
    this.switching = true;
    try {
      if (!await this.tabs.closeAllForWindow()) throw new BrowserFault('OPERATION_CANCELLED', 'Kullanıcı değişmedi; sayfa kapanışı iptal edildi.');
      if (this.disposed) throw new BrowserFault('OPERATION_CANCELLED', 'Pencere kapandı.');
      this.downloads.reset(); this.tabs.dispose();
      this.identity = identity; this.contextEpoch = randomUUID(); this.notice = null;
      this.historySink.mode = 'normal';
      this.history.activate({ epoch: this.contextEpoch, profileKey: this.sessions.profileKey(identity) });
      this.tabs = this.createTabs(); this.tabs.open();
    } finally { this.switching = false; }
    this.downloadNotification = true;
    this.publish(); return null;
  }
  setTheme(theme: DevelopmentTheme) {
    if (app.isPackaged) throw new BrowserFault('POLICY_BLOCKED', 'Tema denemesi yalnız geliştirmede.');
    this.available(); this.theme = theme; this.publish(); return null;
  }
  approveDownload(id: string) { this.available(); return this.downloads.approve(id); }
  cancelDownload(id: string) { this.available(); return this.downloads.cancel(id); }
  setHistoryMode(mode: DevelopmentHistoryMode) {
    if (app.isPackaged) throw new BrowserFault('POLICY_BLOCKED', 'Servis denemesi yalnız geliştirmede.');
    this.available(); this.historySink.mode = mode; this.history.retry(); return null;
  }
  retryHistory() { this.available(); this.history.retry(); return null; }
  snapshot(): BrowserSnapshot {
    return {
      find: this.pageTools.snapshot(),
      zoomFactor: this.tabs.peekContents(this.tabs.activeId ?? '')?.getZoomFactor() ?? 1,
      sitePermissions: this.permissions.snapshot(this.tabs.peekContents(this.tabs.activeId ?? '')),
      fullscreen: this.fullscreen.snapshot(),
      adBlocking:this.sessions.filter(this.identity).snapshot(this.tabs.activeId?this.tabs.peekContents(this.tabs.activeId):undefined),
      protocolVersion: 1, revision: this.revision, contextEpoch: this.contextEpoch,
      activeTabId: this.tabs.activeId, tabs: this.tabs.snapshots(),
      canRestoreClosedTab: this.tabs.canRestoreClosedTab,
      dataMode: 'mock', persistenceStatus: 'not-connected', fixtureUrl: this.fixtureUrl,
      appVersion: version.display, viewportRevision: this.lastViewportRevision, notice: this.notice,
      developmentIdentity: this.identity, developmentControls: !app.isPackaged, theme: this.theme,
      downloads: this.downloads.snapshots(),
      history: this.history.snapshot(this.historySink.mode),
    };
  }
  private publish() {
    if (this.disposed) return;
    if (this.tabs?.snapshots().some(tab => tab.tabId === this.tabs.activeId && ['RENDER_PROCESS_GONE', 'RENDER_PROCESS_UNRESPONSIVE'].includes(tab.errorCode ?? ''))) this.pageTools.close(false);
    this.pageTools.reconcile();
    this.permissions.reconcile();
    const owner = this.fullscreen.contents;
    if (owner && (!this.tabs?.owns(owner) || this.tabs.peekContents(this.tabs.activeId ?? '') !== owner
      || this.tabs.snapshots().some(t => t.tabId === this.tabs.activeId && !!t.errorCode))) this.fullscreen.exit(false);
    this.revision++;
    this.sessions.updateWorkers();
    this.resize();
    this.idleMemory?.update();
    // Keep policy, native visibility and revision changes synchronous. Only
    // snapshot copying/IPC is coalesced; always read the latest context at send.
    // One pending callback, no polling timer or queue of old snapshots.
    if (!this.stateNotification) {
      this.stateNotification = setImmediate(() => {
        this.stateNotification = undefined;
        if (!this.disposed && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
          const snapshot = this.snapshot(), downloadsChanged = this.downloadNotification;
          this.downloadNotification = false;
          this.window.webContents.send(CHANNEL.state, snapshot);
          if (downloadsChanged) this.window.webContents.send(CHANNEL.download, { contextEpoch: snapshot.contextEpoch, downloads: snapshot.downloads });
        }
      });
      this.stateNotification.unref();
    }
  }
  private async readySession() {
    this.available(); const epoch = this.contextEpoch; await this.sessions.ready(this.identity); this.available();
    if (epoch !== this.contextEpoch) throw new BrowserFault('OPERATION_CANCELLED', 'Eski bağlamın işlemi iptal edildi.');
  }
  async open(input?: string) { const url = input === undefined ? undefined : resolveInput(input); await this.readySession(); this.notice = null; return this.tabs.open(url); }
  async restoreClosedTab() {
    await this.readySession();
    if (this.modalDepth > 0 || this.viewport?.visible === false) throw new BrowserFault('OPERATION_CANCELLED', 'Önce açık iletişim kutusunu kapatın.');
    this.fullscreen.exit();
    return this.tabs.restoreClosedTab();
  }
  async activate(id: string) { await this.readySession(); this.notice = null; return this.tabs.activate(id); }
  setTabKeepAwake(id: string, keepAwake: boolean) { this.available(); return this.tabs.setKeepAwake(id, keepAwake); }
  setTabMuted(id: string, muted: boolean) {
    this.available();
    if (this.modalDepth > 0) throw new BrowserFault('OPERATION_CANCELLED', 'Önce açık iletişim kutusunu kapatın.');
    return this.tabs.setMuted(id, muted);
  }
  setAdBlocking(id:string,enabled:boolean){
    this.available();const wc=this.tabs.contents(id);
    if(!wc||!this.sessions.filter(this.identity).setEnabled(wc,enabled))throw new BrowserFault('OPERATION_CANCELLED','Önce bir sayfa açın veya istisna sınırını kontrol edin.');
    this.notice='Reklam engelleme tercihi güncellendi. Önceden yüklenen içerik için sayfayı yenileyin.';this.publish();return null;
  }
  async resetSitePermissions(id: string) {
    this.available(); const wc = this.tabs.contents(id);
    if (!wc || id !== this.tabs.activeId) throw new BrowserFault('OPERATION_CANCELLED', 'Önce etkin sayfayı seçin.');
    this.permissions.resetOrigin(wc);
    this.notice = 'Bu sitenin izinleri sıfırlandı. Yenileme tamamlandığında açık medya erişimi de durur.'; this.publish();
    await this.tabs.reload(id); return null;
  }
  getResources():ResourceSnapshot{
    this.available();const metrics=app.getAppMetrics();
    return {privateMiB:metrics.reduce((sum,p)=>sum+(p.memory.privateBytes??0),0)/1024,processCount:metrics.length,
      processes:metrics.slice(0,256).map(p=>({pid:p.pid,type:p.type,privateMiB:(p.memory.privateBytes??0)/1024})),
      tabs:this.tabs.snapshots().map(tab=>{const wc=this.tabs.peekContents(tab.tabId);let frames:Electron.WebFrameMain[]=[];try{frames=wc?.mainFrame.framesInSubtree??[];}catch{}
        return {tabId:tab.tabId,frameCount:frames.length,processIds:[...new Set(frames.slice(0,512).map(f=>{try{return f.osProcessId;}catch{return 0;}}).filter(pid=>pid>0))]};}),
      idleMemory:{status:this.idleMemory.status,lastFreedKiB:this.idleMemory.lastFreedKiB},backgroundWorkers:this.sessions.workerSnapshot()};
  }
  close(id: string) { this.available(); const wc = this.tabs.contents(id); if (wc) this.fullscreen.leave(wc); return this.tabs.close(id); }
  async forceCloseUnresponsive(id: string) {
    this.available();
    if (this.modalDepth > 0 || id !== this.tabs.activeId || !this.tabs.snapshots().some(tab => tab.tabId === id && tab.errorCode === 'RENDER_PROCESS_UNRESPONSIVE')) {
      throw new BrowserFault('OPERATION_CANCELLED', 'Önce yanıtsız etkin sekmeyi seçin.');
    }
    const epoch = this.contextEpoch, wc = this.tabs.peekContents(id);
    this.setModal(true);
    try {
      const answer = await dialog.showMessageBox(this.window, { type: 'warning', message: 'Yanıt vermeyen sekme kapatılsın mı?', detail: 'Bu sekmedeki kaydedilmemiş değişiklikler kaybolabilir.', buttons: ['Vazgeç', 'Sekmeyi kapat'], defaultId: 0, cancelId: 0, noLink: true });
      this.available();
      if (answer.response !== 1) return { closed: false };
      if (epoch !== this.contextEpoch || id !== this.tabs.activeId || !wc || this.tabs.peekContents(id) !== wc) throw new BrowserFault('OPERATION_CANCELLED', 'Sekme bağlamı değişti.');
      return this.tabs.forceCloseUnresponsive(id);
    } finally { this.setModal(false); }
  }
  async navigate(id: string, input: string) { const url = resolveInput(input); await this.readySession(); this.notice = null; return this.tabs.navigate(id, url); }
  goBack(id: string) { this.available(); return this.tabs.go(id, 'back'); }
  goForward(id: string) { this.available(); return this.tabs.go(id, 'forward'); }
  async reload(id: string, ignoreCache = false) { await this.readySession(); this.notice = null; return this.tabs.reload(id, ignoreCache); }
  stop(id: string) { this.available(); return this.tabs.stop(id); }
  closeAllForWindow() { if (this.switching) return Promise.resolve(false); this.fullscreen.exit(); return this.tabs.closeAllForWindow(); }
  private focusAddress() {
    this.fullscreen.exit();
    this.window.webContents.focus();
    this.window.webContents.send(CHANNEL.focusAddress);
  }
  private toolContents(id: string) {
    this.available();
    const wc = this.tabs.peekContents(id);
    if (id !== this.tabs.activeId || !wc || !this.tabs.owns(wc) || this.modalDepth > 0) {
      throw new BrowserFault('OPERATION_CANCELLED', 'Önce etkin bir sayfa seçin.');
    }
    if (this.tabs.snapshots().some(tab => tab.tabId === id && ['RENDER_PROCESS_GONE', 'RENDER_PROCESS_UNRESPONSIVE'].includes(tab.errorCode ?? ''))) {
      throw new BrowserFault('OPERATION_CANCELLED', 'Önce bu sayfayı yenileyin.');
    }
    return wc;
  }
  openFind(id: string) {
    const wc = this.toolContents(id);
    this.fullscreen.exit(); this.pageTools.open(id, wc);
    this.window.webContents.focus(); this.window.webContents.send(CHANNEL.focusFind);
    return null;
  }
  findInPage(id: string, text: string, direction: import('../../shared/contracts').FindDirection) {
    this.pageTools.search(id, this.toolContents(id), text, direction); return null;
  }
  closeFind(id: string) {
    const wc = this.toolContents(id);
    if (this.pageTools.snapshot()?.tabId === id) {
      this.pageTools.close();
      if (!this.window.isDestroyed() && this.window.isFocused()) wc.focus();
    }
    return null;
  }
  zoom(id: string, direction: import('../../shared/contracts').ZoomDirection) {
    const wc = this.toolContents(id);
    wc.setZoomFactor(nextZoom(wc.getZoomFactor(), direction));
    this.publish(); return null;
  }
  invalidateShortcutFocus() { this.shortcutRevision++; }
  private shortcutCurrent(revision: number, epoch: string) {
    return revision === this.shortcutRevision && epoch === this.contextEpoch
      && !this.disposed && !this.switching && this.modalDepth === 0
      && !this.window.isDestroyed() && this.window.isFocused();
  }
  private async runShortcut(shortcut: BrowserShortcut, revision: number, epoch: string) {
    this.available();
    const active = this.tabs.activeId;
    const focusTab = (id: string) => {
      if (!this.shortcutCurrent(revision, epoch) || this.tabs.activeId !== id) return;
      const wc = this.tabs.peekContents(id);
      if (wc) wc.focus(); else this.focusAddress();
    };
    switch (shortcut.kind) {
      case 'find': if (active && this.tabs.peekContents(active)) this.openFind(active); return;
      case 'find-next': {
        if (!active || !this.tabs.peekContents(active)) return;
        const find = this.pageTools.snapshot();
        if (find?.text) this.findInPage(active, find.text, shortcut.backwards ? 'previous' : 'next');
        else this.openFind(active);
        return;
      }
      case 'zoom': if (active && this.tabs.peekContents(active)) this.zoom(active, shortcut.direction); return;
      case 'focus-address': this.focusAddress(); return;
      case 'new-tab': {
        const result = await this.open();
        focusTab(result.tabId); return;
      }
      case 'restore-tab': {
        if (!this.tabs.canRestoreClosedTab) return;
        const result = await this.restoreClosedTab();
        focusTab(result.tabId); return;
      }
      case 'close-tab':
        if (active && (await this.close(active)).closed) {
          const selected = this.tabs.activeId;
          if (selected) focusTab(selected);
        }
        return;
      case 'cycle-tab':
      case 'select-tab': {
        const tabs = this.tabs.snapshots();
        const index = shortcut.kind === 'cycle-tab'
          ? (tabs.findIndex(tab => tab.tabId === active) + shortcut.direction + tabs.length) % tabs.length
          : shortcut.index === 'last' ? tabs.length - 1 : shortcut.index;
        const target = tabs[index];
        if (!target) return;
        this.fullscreen.exit();
        await this.activate(target.tabId);
        focusTab(target.tabId); return;
      }
      case 'reload':
      case 'reload-without-cache':
        if (active && this.tabs.snapshots().some(tab => tab.tabId === active && !!tab.url)) await this.reload(active, shortcut.kind === 'reload-without-cache');
        return;
      case 'back':
      case 'forward': {
        const tab = this.tabs.snapshots().find(tab => tab.tabId === active);
        if (!tab || !(shortcut.kind === 'back' ? tab.canGoBack : tab.canGoForward)) return;
        await (shortcut.kind === 'back' ? this.goBack(tab.tabId) : this.goForward(tab.tabId));
      }
    }
  }
  handleShortcut(event: Electron.Event, input: Electron.Input) {
    if (input.type !== 'keyDown' || this.disposed || this.switching || this.modalDepth > 0) return;
    const shortcut = browserShortcut(input);
    if (shortcut && input.isAutoRepeat) { event.preventDefault(); return; }
    // A newer key or UI click owns focus, including ordinary address typing.
    // An old asynchronous thaw must not move the caret back to the site.
    const revision = ++this.shortcutRevision, epoch = this.contextEpoch;
    if (input.key.toLowerCase() === 'escape' && this.fullscreen.contents) {
      event.preventDefault(); this.fullscreen.exit(); return;
    }
    if (input.key.toLowerCase() === 'escape' && this.pageTools.snapshot() && this.tabs.activeId) {
      event.preventDefault(); this.closeFind(this.tabs.activeId); return;
    }
    if (!shortcut) return;
    event.preventDefault();
    void this.runShortcut(shortcut, revision, epoch).catch(() => {
      if (!this.shortcutCurrent(revision, epoch)) return;
      this.notice = 'Kısayol işlemi tamamlanamadı veya sayfa kapatmayı reddetti.'; this.publish();
    });
  }
  setViewport(request: ViewportRequest): Bounds {
    if (request.revision <= this.lastViewportRevision) throw new BrowserFault('OPERATION_CANCELLED', 'Eski yerleşim isteği.');
    this.lastViewportRevision = request.revision;
    this.viewport = request;
    if (!request.visible) this.fullscreen.exit();
    return this.resize();
  }
  resize(): Bounds {
    if (this.disposed || this.window.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 };
    this.tabs?.reconcileHealth();
    const { width, height } = this.window.getContentBounds();
    const request = this.viewport ?? {
      x: 0, y: LAYOUT.toolbarHeight, width: Math.max(0, width - LAYOUT.sidebarWidth),
      height: Math.max(0, height - LAYOUT.toolbarHeight), visible: true, revision: 0,
    };
    if ((!request.visible || this.modalDepth > 0) && this.fullscreen.contents) this.fullscreen.exit(false);
    const bounds = this.fullscreen.contents ? this.fullscreen.bounds(width, height) : safeBounds(request, width, height);
    for (const { view, state } of this.tabs?.entries() ?? []) {
      if (view.webContents.isDestroyed()) continue;
      const current = view.getBounds();
      if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) view.setBounds(bounds);
      const visible = request.visible && this.modalDepth === 0 && state.tabId === this.tabs.activeId && !!state.url
        && bounds.width > 0 && bounds.height > 0 && !['RENDER_PROCESS_GONE', 'RENDER_PROCESS_UNRESPONSIVE'].includes(state.errorCode ?? '');
      if (view.getVisible() !== visible) view.setVisible(visible);
    }
    return bounds;
  }
  dispose() { this.disposed = true; clearImmediate(this.stateNotification); this.stateNotification = undefined; this.downloadNotification = false; this.pageTools.dispose(); this.permissions.dispose(); this.fullscreen.dispose(); this.idleMemory.dispose();this.sessions.dispose();this.history.dispose(); this.downloads.dispose(); this.tabs.dispose(); }
}
