// Test-only sandboxed attacker window. Never loaded by production code.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('probe', {
  result: ipcRenderer.invoke('browser:get-state'),
});
