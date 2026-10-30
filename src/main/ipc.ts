import { randomUUID } from 'node:crypto';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { BrowserFault, CHANNEL, exactObject, parseInput, parseViewport, parseFindRequest, type CommandResult } from '../shared/contracts';
import { BrowserController } from './browser/controller';
import { isTrustedCaller } from './browser/policy';

export function registerBrowserIpc(window: BrowserWindow, controller: BrowserController, development: boolean) {
  const handles = [CHANNEL.getState, CHANNEL.openTab, CHANNEL.navigate, CHANNEL.viewport,
    CHANNEL.activateTab, CHANNEL.closeTab, CHANNEL.goBack, CHANNEL.goForward, CHANNEL.reload, CHANNEL.stop,
    CHANNEL.switchIdentity, CHANNEL.theme, CHANNEL.approveDownload, CHANNEL.cancelDownload, CHANNEL.historyMode, CHANNEL.retryHistory, CHANNEL.keepAwake,CHANNEL.adBlocking,CHANNEL.resources,CHANNEL.exitFullscreen,CHANNEL.resetSitePermissions,
    CHANNEL.openFind, CHANNEL.findInPage, CHANNEL.closeFind, CHANNEL.zoom, CHANNEL.forceCloseUnresponsive, CHANNEL.restoreClosedTab, CHANNEL.tabMuted];
  function authorize(event: IpcMainInvokeEvent) {
    const frame = event.senderFrame;
    if (!frame || window.isDestroyed() || event.sender.isDestroyed()
      || !isTrustedCaller(window.webContents.id, event.sender.id,
        frame === window.webContents.mainFrame, frame.url, development)) {
      throw new BrowserFault('UNAUTHORIZED', 'Çağrı kaynağı yetkili değil.');
    }
  }
  function handle(channel: string, action: (value: unknown) => unknown) {
    ipcMain.handle(channel, async (event, value: unknown): Promise<CommandResult<unknown>> => {
      const requestId = randomUUID();
      const contextEpoch = controller.epoch;
      try {
        authorize(event);
        const data = await action(value);
        if (channel !== CHANNEL.switchIdentity && contextEpoch !== controller.epoch) {
          throw new BrowserFault('OPERATION_CANCELLED', 'Eski bağlamın işlemi iptal edildi.');
        }
        return { requestId, contextEpoch: channel === CHANNEL.switchIdentity ? controller.epoch : contextEpoch, ok: true, data };
      } catch (error) {
        return error instanceof BrowserFault
          ? { requestId, contextEpoch, ok: false, errorCode: error.code, message: error.message }
          : { requestId, contextEpoch, ok: false, errorCode: 'INTERNAL_ERROR', message: 'İşlem tamamlanamadı.' };
      }
    });
  }
  handle(CHANNEL.getState, (value) => {
    if (value !== undefined) throw new BrowserFault('INVALID_INPUT', 'Bu komut girdi almaz.');
    return controller.snapshot();
  });
  handle(CHANNEL.openTab, (value) => {
    const args = exactObject(value, ['input']);
    return controller.open(args.input === undefined ? undefined : parseInput(args.input));
  });
  handle(CHANNEL.restoreClosedTab, value => {
    if (value !== undefined) throw new BrowserFault('INVALID_INPUT', 'Bu komut girdi almaz.');
    return controller.restoreClosedTab();
  });
  handle(CHANNEL.navigate, (value) => {
    const args = exactObject(value, ['tabId', 'input']);
    if (typeof args.tabId !== 'string' || args.tabId.length > 64) {
      throw new BrowserFault('INVALID_INPUT', 'Sayfa kimliği geçersiz.');
    }
    return controller.navigate(args.tabId, parseInput(args.input));
  });
  handle(CHANNEL.viewport, (value) => controller.setViewport(parseViewport(value)));
  handle(CHANNEL.exitFullscreen, value => {
    if (value !== undefined) throw new BrowserFault('INVALID_INPUT', 'Bu komut girdi almaz.');
    return controller.exitFullscreen();
  });
  handle(CHANNEL.resources,value=>{if(value!==undefined)throw new BrowserFault('INVALID_INPUT','Bu komut girdi almaz.');return controller.getResources();});
  handle(CHANNEL.findInPage, value => {
    const args = parseFindRequest(value);
    return controller.findInPage(args.tabId, args.text, args.direction);
  });
  handle(CHANNEL.zoom, value => {
    const args = exactObject(value, ['tabId', 'direction']);
    if (typeof args.tabId !== 'string' || !args.tabId || args.tabId.length > 64 || !['in', 'out', 'reset'].includes(args.direction as string)) {
      throw new BrowserFault('INVALID_INPUT', 'Yakınlaştırma isteği geçersiz.');
    }
    return controller.zoom(args.tabId, args.direction as import('../shared/contracts').ZoomDirection);
  });
  handle(CHANNEL.adBlocking,value=>{const args=exactObject(value,['tabId','enabled']);
    if(typeof args.tabId!=='string'||!args.tabId||args.tabId.length>64||typeof args.enabled!=='boolean')throw new BrowserFault('INVALID_INPUT','Reklam tercihi geçersiz.');
    return controller.setAdBlocking(args.tabId,args.enabled);
  });
  handle(CHANNEL.keepAwake, (value) => {
    const args = exactObject(value, ['tabId', 'keepAwake']);
    if (typeof args.tabId !== 'string' || !args.tabId || args.tabId.length > 64 || typeof args.keepAwake !== 'boolean') {
      throw new BrowserFault('INVALID_INPUT', 'Sekme koruma tercihi geçersiz.');
    }
    return controller.setTabKeepAwake(args.tabId, args.keepAwake);
  });
  handle(CHANNEL.tabMuted, value => {
    const args = exactObject(value, ['tabId', 'muted']);
    if (typeof args.tabId !== 'string' || !args.tabId || args.tabId.length > 64 || typeof args.muted !== 'boolean') {
      throw new BrowserFault('INVALID_INPUT', 'Sekme ses tercihi geçersiz.');
    }
    return controller.setTabMuted(args.tabId, args.muted);
  });
  handle(CHANNEL.historyMode, (value) => {
    const args = exactObject(value, ['mode']);
    if (!['normal', 'offline', 'timeout', 'unauthorized', 'forbidden'].includes(args.mode as string)) throw new BrowserFault('INVALID_INPUT', 'Servis denemesi geçersiz.');
    return controller.setHistoryMode(args.mode as import('../shared/contracts').DevelopmentHistoryMode);
  });
  handle(CHANNEL.retryHistory, (value) => {
    if (value !== undefined) throw new BrowserFault('INVALID_INPUT', 'Bu komut girdi almaz.');
    return controller.retryHistory();
  });
  handle(CHANNEL.switchIdentity, (value) => {
    const args = exactObject(value, ['identity']);
    if (args.identity !== 'test-a' && args.identity !== 'test-b') throw new BrowserFault('INVALID_INPUT', 'Yalnız Test-A/B geliştirme bağlamı seçilebilir.');
    return controller.switchIdentity(args.identity);
  });
  handle(CHANNEL.theme, (value) => {
    const args = exactObject(value, ['theme']);
    if (args.theme !== 'light' && args.theme !== 'dark') throw new BrowserFault('INVALID_INPUT', 'Tema geçersiz.');
    return controller.setTheme(args.theme);
  });
  for (const [channel, action] of [
    [CHANNEL.approveDownload, (id: string) => controller.approveDownload(id)],
    [CHANNEL.cancelDownload, (id: string) => controller.cancelDownload(id)],
  ] as const) handle(channel, (value) => {
    const args = exactObject(value, ['downloadId']);
    if (typeof args.downloadId !== 'string' || !args.downloadId || args.downloadId.length > 64) throw new BrowserFault('INVALID_INPUT', 'İndirme kimliği geçersiz.');
    return action(args.downloadId);
  });
  for (const [channel, action] of [
    [CHANNEL.openFind, (id: string) => controller.openFind(id)],
    [CHANNEL.closeFind, (id: string) => controller.closeFind(id)],
    [CHANNEL.resetSitePermissions, (id: string) => controller.resetSitePermissions(id)],
    [CHANNEL.forceCloseUnresponsive, (id: string) => controller.forceCloseUnresponsive(id)],
    [CHANNEL.activateTab, (id: string) => controller.activate(id)],
    [CHANNEL.closeTab, (id: string) => controller.close(id)],
    [CHANNEL.goBack, (id: string) => controller.goBack(id)],
    [CHANNEL.goForward, (id: string) => controller.goForward(id)],
    [CHANNEL.reload, (id: string) => controller.reload(id)],
    [CHANNEL.stop, (id: string) => controller.stop(id)],
  ] as const) {
    handle(channel, (value) => {
      const args = exactObject(value, ['tabId']);
      if (typeof args.tabId !== 'string' || !args.tabId || args.tabId.length > 64) {
        throw new BrowserFault('INVALID_INPUT', 'Sekme kimliği geçersiz.');
      }
      return action(args.tabId);
    });
  }
  return () => { for (const channel of handles) ipcMain.removeHandler(channel); };
}
