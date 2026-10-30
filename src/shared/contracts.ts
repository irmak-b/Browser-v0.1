export const CHANNEL = {
  getState: 'browser:get-state',
  openTab: 'browser:open-tab',
  restoreClosedTab: 'browser:restore-closed-tab',
  tabMuted: 'browser:tab-muted',
  navigate: 'browser:navigate',
  activateTab: 'browser:activate-tab',
  closeTab: 'browser:close-tab',
  goBack: 'browser:go-back',
  goForward: 'browser:go-forward',
  reload: 'browser:reload',
  stop: 'browser:stop',
  focusAddress: 'browser:focus-address',
  viewport: 'browser:set-viewport',
  state: 'browser:state-changed',
  switchIdentity: 'browser:development-identity',
  theme: 'browser:development-theme',
  approveDownload: 'browser:approve-download',
  cancelDownload: 'browser:cancel-download',
  download: 'browser:download-changed',
  historyMode: 'browser:development-history-mode',
  retryHistory: 'browser:retry-history',
  keepAwake: 'browser:keep-awake',
  adBlocking: 'browser:ad-blocking',
  resources: 'browser:resources',
  exitFullscreen: 'browser:exit-fullscreen',
  resetSitePermissions: 'browser:reset-site-permissions',
  openFind: 'browser:open-find',
  findInPage: 'browser:find-in-page',
  closeFind: 'browser:close-find',
  focusFind: 'browser:focus-find',
  zoom: 'browser:zoom',
  forceCloseUnresponsive: 'browser:force-close-unresponsive',
} as const;

// Only the compact tab/address area is a permanent main-process reservation.
// The optional diagnostic panel is excluded by the trusted UI's viewport rect.
export const LAYOUT = { toolbarHeight: 84, sidebarWidth: 0, infoPanelWidth: 272 } as const;
export const UI_URL = 'app://browser/index.html';
export const DEV_UI_ORIGIN = 'http://127.0.0.1:5173';

export type ErrorCode = 'INVALID_INPUT' | 'TAB_NOT_FOUND' | 'TAB_CLOSED' | 'POLICY_BLOCKED'
  | 'UNAUTHORIZED' | 'OPERATION_CANCELLED' | 'INTERNAL_ERROR';
export type CommandResult<T> = { requestId: string; contextEpoch: string; ok: true; data: T }
  | { requestId: string; contextEpoch: string; ok: false; errorCode: ErrorCode; message: string };

export type DevelopmentIdentity = 'test-a' | 'test-b';
export type DevelopmentTheme = 'light' | 'dark';
export type HistorySource = 'navigate' | 'back' | 'forward' | 'reload';
export type DevelopmentHistoryMode = 'normal' | 'offline' | 'timeout' | 'unauthorized' | 'forbidden';
export interface HistoryEntry {
  eventId: string;
  url: string;
  title: string;
  visitedAtUtc: string;
  source: HistorySource;
  developmentFixture: boolean;
}
export interface HistorySnapshot {
  mode: 'development-memory';
  status: 'memory-only' | 'pending' | 'offline' | 'timeout' | 'unauthorized' | 'forbidden' | 'queue-full' | 'unavailable';
  simulation: DevelopmentHistoryMode;
  pendingCount: number;
  droppedCount: number;
  entries: HistoryEntry[];
}
export interface DownloadSnapshot {
  downloadId: string;
  filename: string;
  totalBytes: number;
  receivedBytes: number;
  status: 'awaiting-approval' | 'choosing-target' | 'downloading' | 'completed' | 'cancelled' | 'failed';
}
export interface DownloadEvent { contextEpoch: string; downloads: DownloadSnapshot[] }

export interface TabSnapshot {
  audible?: boolean;
  muted?: boolean;
  tabId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  status: 'empty' | 'loading' | 'ready' | 'stopped' | 'error' | 'sleeping';
  keepAwake?: boolean;
  frozen?: boolean;
  errorCode: string | null;
}
export interface BrowserSnapshot {
  canRestoreClosedTab?: boolean;
  find?: FindSnapshot | null;
  zoomFactor?: number;
  sitePermissions?: { origin: string; decisions: { permission: 'camera'|'microphone'|'location'|'notifications'; state: 'allowed'|'blocked' }[] } | null;
  fullscreen?: { origin: string; hintVisible: boolean } | null;
  adBlocking?: { enabled:boolean;blockedRequests:number;ruleCount:number;mode:'built-in-network'|'bundled-lists';scriptletStatus?:'none'|'pending'|'ready'|'unavailable' };
  protocolVersion: 1;
  revision: number;
  contextEpoch: string;
  activeTabId: string | null;
  tabs: TabSnapshot[];
  dataMode: 'mock';
  persistenceStatus: 'not-connected';
  fixtureUrl: string;
  appVersion: string;
  viewportRevision: number;
  notice: string | null;
  developmentIdentity: DevelopmentIdentity;
  developmentControls: boolean;
  theme: DevelopmentTheme;
  downloads: DownloadSnapshot[];
  history: HistorySnapshot;
}
export interface ViewportRequest {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  revision: number;
}
export interface Bounds { x: number; y: number; width: number; height: number }
export interface BrowserApi {
  setTabMuted(tabId: string, muted: boolean): Promise<CommandResult<null>>;
  forceCloseUnresponsive(tabId: string): Promise<CommandResult<{ closed: boolean }>>;
  openFind(tabId: string): Promise<CommandResult<null>>;
  findInPage(tabId: string, text: string, direction: FindDirection): Promise<CommandResult<null>>;
  closeFind(tabId: string): Promise<CommandResult<null>>;
  onFocusFind(callback: () => void): () => void;
  zoom(tabId: string, direction: ZoomDirection): Promise<CommandResult<null>>;
  resetSitePermissions(tabId: string): Promise<CommandResult<null>>;
  exitFullscreen(): Promise<CommandResult<null>>;
  setAdBlocking(tabId:string,enabled:boolean):Promise<CommandResult<null>>;
  getResources():Promise<CommandResult<ResourceSnapshot>>;
  setTabKeepAwake(tabId: string, keepAwake: boolean): Promise<CommandResult<null>>;
  getState(): Promise<CommandResult<BrowserSnapshot>>;
  openTab(input?: string): Promise<CommandResult<{ tabId: string }>>;
  restoreClosedTab(): Promise<CommandResult<{ tabId: string }>>;
  navigate(tabId: string, input: string): Promise<CommandResult<null>>;
  activateTab(tabId: string): Promise<CommandResult<{ tabId: string }>>;
  closeTab(tabId: string): Promise<CommandResult<{ closed: boolean }>>;
  goBack(tabId: string): Promise<CommandResult<null>>;
  goForward(tabId: string): Promise<CommandResult<null>>;
  reload(tabId: string): Promise<CommandResult<null>>;
  stop(tabId: string): Promise<CommandResult<null>>;
  setViewport(viewport: ViewportRequest): Promise<CommandResult<Bounds>>;
  onStateChanged(callback: (state: BrowserSnapshot) => void): () => void;
  onFocusAddress(callback: () => void): () => void;
  switchDevelopmentIdentity(identity: DevelopmentIdentity): Promise<CommandResult<null>>;
  setDevelopmentTheme(theme: DevelopmentTheme): Promise<CommandResult<null>>;
  approveDownload(downloadId: string): Promise<CommandResult<null>>;
  cancelDownload(downloadId: string): Promise<CommandResult<null>>;
  onDownloadChanged(callback: (event: DownloadEvent) => void): () => void;
  setDevelopmentHistoryMode(mode: DevelopmentHistoryMode): Promise<CommandResult<null>>;
  retryHistory(): Promise<CommandResult<null>>;
}

export interface ResourceSnapshot {
  backgroundWorkers?: { status: string; running: number }[];
  privateMiB:number;
  processCount:number;
  processes:{pid:number;type:string;privateMiB:number}[];
  tabs:{tabId:string;frameCount:number;processIds:number[]}[];
  idleMemory:{status:string;lastFreedKiB:number|null};
}

export type FindDirection = 'new' | 'next' | 'previous';
export type ZoomDirection = 'in' | 'out' | 'reset';
export interface FindSnapshot { tabId: string; text: string; matches: number; activeMatch: number; pending: boolean }
export function parseFindRequest(value: unknown): { tabId: string; text: string; direction: FindDirection } {
  const args = exactObject(value, ['tabId', 'text', 'direction']);
  if (typeof args.tabId !== 'string' || !args.tabId || args.tabId.length > 64
    || typeof args.text !== 'string' || args.text.length > 256 || args.text.includes('\0')
    || !['new', 'next', 'previous'].includes(args.direction as string)) {
    throw new BrowserFault('INVALID_INPUT', 'Sayfa araması geçersiz.');
  }
  return args as { tabId: string; text: string; direction: FindDirection };
}

export class BrowserFault extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); }
}

export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BrowserFault('INVALID_INPUT', 'Nesne bekleniyor.');
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !keys.includes(key))) {
    throw new BrowserFault('INVALID_INPUT', 'Beklenmeyen alan.');
  }
  return object;
}

export function parseInput(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) {
    throw new BrowserFault('INVALID_INPUT', 'Geçerli bir http/https adresi girin.');
  }
  return value.trim();
}

export function parseViewport(value: unknown): ViewportRequest {
  const object = exactObject(value, ['visible', 'x', 'y', 'width', 'height', 'revision']);
  if (typeof object.visible !== 'boolean') throw new BrowserFault('INVALID_INPUT', 'Görünürlük geçersiz.');
  for (const key of ['x', 'y', 'width', 'height', 'revision'] as const) {
    if (typeof object[key] !== 'number' || !Number.isSafeInteger(object[key])
      || (object[key] as number) < 0 || (key !== 'revision' && (object[key] as number) > 32768)) {
      throw new BrowserFault('INVALID_INPUT', 'Görünüm ölçüleri geçersiz.');
    }
  }
  return object as unknown as ViewportRequest;
}

// Renderer accepts events/snapshots in revision order, including initial snapshot races.
export function newerSnapshot(current: BrowserSnapshot | null, incoming: BrowserSnapshot): BrowserSnapshot {
  return current && incoming.revision <= current.revision ? current : incoming;
}
