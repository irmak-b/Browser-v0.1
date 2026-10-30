import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { app, BrowserWindow, protocol, session } from 'electron';
import { DEV_UI_ORIGIN, UI_URL } from '../shared/contracts';
import { BrowserController, SECURE_PREFERENCES } from './browser/controller';
import { startFixture } from './browser/fixture';
import { isTrustedUiUrl } from './browser/policy';
import { registerBrowserIpc } from './ipc';
import { registerUiProtocol } from './ui-protocol';
import { denyPermissions } from './browser/permission-policy';
import { instanceDirectory } from './browser/instance-key';
import version from '../../app-version.json';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Browser Core');
// Bound only Chromium's discardable GPU image/transfer cache. This is not a
// limit on total GPU-process memory; acceleration and live textures stay on.
// Verified with the pinned Electron 45 / Chromium 156 runtime and local images.
app.commandLine.appendSwitch('force-gpu-mem-discardable-limit-mb', '64');
// Acquire the native lock in a stable, app-owned namespace before the PID-only
// disposable profile is selected. A secondary must not create views/sessions.
let primary = false;
try {
  const lockRoot = instanceDirectory(app.getPath('temp'), app.getAppPath(), version.display, process.env.BROWSER_CORE_INSTANCE_SCOPE);
  mkdirSync(lockRoot, { recursive: true });
  app.setPath('userData', lockRoot);
  primary = app.requestSingleInstanceLock();
  if (primary) {
    const runtimeRoot = join(app.getPath('temp'), `BrowserCore-${process.pid}`);
    mkdirSync(runtimeRoot, { recursive: true });
    app.setPath('userData', runtimeRoot);
    app.setPath('sessionData', runtimeRoot);
  }
} catch {
  console.error('Browser Core tek örnek başlatması tamamlanamadı.');
  app.exit(1);
}

let window: BrowserWindow | null = null;
let fixture: Awaited<ReturnType<typeof startFixture>> | null = null;
function revealWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}

async function createWindow() {
  if (window) { window.show(); return; }
  const development = !app.isPackaged && process.env.ELECTRON_RENDERER_URL === DEV_UI_ORIGIN;
  if (process.env.ELECTRON_RENDERER_URL && !development) throw new Error('Beklenmeyen geliştirme origin değeri.');
  const uiSession = session.fromPartition('browser-core-a1-ui', { cache: false });
  denyPermissions(uiSession);
  uiSession.on('will-download', (event) => event.preventDefault());
  uiSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const allowed = development
      ? url.origin === DEV_UI_ORIGIN || (url.protocol === 'ws:' && url.host === '127.0.0.1:5173')
      : url.protocol === 'app:' && url.host === 'browser';
    callback({ cancel: !allowed });
  });
  if (!development) await registerUiProtocol(uiSession, join(__dirname, '../renderer'));
  const win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 880, minHeight: 580,
    title: 'Browser Core · Performans', backgroundColor: '#edf1f8', show: false,
    webPreferences: {
      ...SECURE_PREFERENCES, session: uiSession,
      preload: join(__dirname, '../preload/index.cjs'), navigateOnDragDrop: false,
    },
  });
  window = win;
  win.setMenu(null);
  const controller = new BrowserController(win, fixture!.url);
  const removeIpc = registerBrowserIpc(win, controller, development);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame || !isTrustedUiUrl(details.url, development)) details.preventDefault();
  });
  win.webContents.on('will-redirect', (details) => details.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && ['+', '-', '=', '0'].includes(input.key)) event.preventDefault();
    controller.handleShortcut(event, input);
  });
  win.webContents.on('before-mouse-event', (_event, input) => {
    if (input.type === 'mouseDown') controller.invalidateShortcutFocus();
  });
  win.on('resize', () => controller.resize());
  let allowClose = false;
  let closing = false;
  win.on('close', (event) => {
    if (allowClose) { removeIpc(); controller.dispose(); return; }
    event.preventDefault();
    if (closing) return;
    closing = true;
    void controller.closeAllForWindow().then((closed) => {
      closing = false;
      if (closed && !win.isDestroyed()) { allowClose = true; win.close(); }
    });
  });
  win.on('closed', () => { window = null; });
  win.once('ready-to-show', () => win.show());
  await win.loadURL(development ? `${DEV_UI_ORIGIN}/` : UI_URL);
  win.webContents.setZoomFactor(1);
  await win.webContents.setVisualZoomLevelLimits(1, 1);
}

if (!primary) app.quit();
else {
  // Ignore all secondary argv/URL/data: an extra launch only reveals this window.
  app.on('second-instance', () => revealWindow());
  app.whenReady().then(async () => {
    fixture = await startFixture();
    await createWindow();
  }).catch(() => {
    // No raw URLs, credentials, stack traces or user profiles in logs.
    console.error('Browser Core başlatılamadı. Yerel derleme çıktısını kontrol edin.');
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => fixture?.close());
}
