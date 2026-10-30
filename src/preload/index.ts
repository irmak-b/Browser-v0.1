import { contextBridge, ipcRenderer } from 'electron';
import { CHANNEL, type BrowserApi, type BrowserSnapshot, type DevelopmentHistoryMode, type DevelopmentIdentity, type DevelopmentTheme, type DownloadEvent, type ViewportRequest } from '../shared/contracts';

const api: BrowserApi = Object.freeze({
  setTabMuted: (tabId: string, muted: boolean) => ipcRenderer.invoke(CHANNEL.tabMuted, { tabId, muted }),
  restoreClosedTab: () => ipcRenderer.invoke(CHANNEL.restoreClosedTab),
  forceCloseUnresponsive: (tabId: string) => ipcRenderer.invoke(CHANNEL.forceCloseUnresponsive, { tabId }),
  openFind: (tabId: string) => ipcRenderer.invoke(CHANNEL.openFind, { tabId }),
  findInPage: (tabId: string, text: string, direction: import('../shared/contracts').FindDirection) => ipcRenderer.invoke(CHANNEL.findInPage, { tabId, text, direction }),
  closeFind: (tabId: string) => ipcRenderer.invoke(CHANNEL.closeFind, { tabId }),
  zoom: (tabId: string, direction: import('../shared/contracts').ZoomDirection) => ipcRenderer.invoke(CHANNEL.zoom, { tabId, direction }),
  onFocusFind(callback: () => void) {
    const listener = () => callback();
    ipcRenderer.on(CHANNEL.focusFind, listener);
    return () => { ipcRenderer.removeListener(CHANNEL.focusFind, listener); };
  },
  resetSitePermissions: (tabId: string) => ipcRenderer.invoke(CHANNEL.resetSitePermissions, { tabId }),
  exitFullscreen: () => ipcRenderer.invoke(CHANNEL.exitFullscreen),
  setAdBlocking:(tabId:string,enabled:boolean)=>ipcRenderer.invoke(CHANNEL.adBlocking,{tabId,enabled}),
  getResources:()=>ipcRenderer.invoke(CHANNEL.resources),
  setTabKeepAwake: (tabId: string, keepAwake: boolean) => ipcRenderer.invoke(CHANNEL.keepAwake, { tabId, keepAwake }),
  getState: () => ipcRenderer.invoke(CHANNEL.getState),
  openTab: (input?: string) => ipcRenderer.invoke(CHANNEL.openTab, { input }),
  navigate: (tabId: string, input: string) => ipcRenderer.invoke(CHANNEL.navigate, { tabId, input }),
  activateTab: (tabId: string) => ipcRenderer.invoke(CHANNEL.activateTab, { tabId }),
  closeTab: (tabId: string) => ipcRenderer.invoke(CHANNEL.closeTab, { tabId }),
  goBack: (tabId: string) => ipcRenderer.invoke(CHANNEL.goBack, { tabId }),
  goForward: (tabId: string) => ipcRenderer.invoke(CHANNEL.goForward, { tabId }),
  reload: (tabId: string) => ipcRenderer.invoke(CHANNEL.reload, { tabId }),
  stop: (tabId: string) => ipcRenderer.invoke(CHANNEL.stop, { tabId }),
  switchDevelopmentIdentity: (identity: DevelopmentIdentity) => ipcRenderer.invoke(CHANNEL.switchIdentity, { identity }),
  setDevelopmentTheme: (theme: DevelopmentTheme) => ipcRenderer.invoke(CHANNEL.theme, { theme }),
  approveDownload: (downloadId: string) => ipcRenderer.invoke(CHANNEL.approveDownload, { downloadId }),
  cancelDownload: (downloadId: string) => ipcRenderer.invoke(CHANNEL.cancelDownload, { downloadId }),
  setDevelopmentHistoryMode: (mode: DevelopmentHistoryMode) => ipcRenderer.invoke(CHANNEL.historyMode, { mode }),
  retryHistory: () => ipcRenderer.invoke(CHANNEL.retryHistory),
  onDownloadChanged(callback: (event: DownloadEvent) => void) {
    const listener = (_event: Electron.IpcRendererEvent, event: DownloadEvent) => callback(event);
    ipcRenderer.on(CHANNEL.download, listener);
    return () => { ipcRenderer.removeListener(CHANNEL.download, listener); };
  },
  setViewport: (request: ViewportRequest) => ipcRenderer.invoke(CHANNEL.viewport, request),
  onStateChanged(callback: (state: BrowserSnapshot) => void) {
    const listener = (_event: Electron.IpcRendererEvent, state: BrowserSnapshot) => callback(state);
    ipcRenderer.on(CHANNEL.state, listener);
    return () => { ipcRenderer.removeListener(CHANNEL.state, listener); };
  },
  onFocusAddress(callback: () => void) {
    const listener = () => callback();
    ipcRenderer.on(CHANNEL.focusAddress, listener);
    return () => { ipcRenderer.removeListener(CHANNEL.focusAddress, listener); };
  },
});
contextBridge.exposeInMainWorld('browser', api);
