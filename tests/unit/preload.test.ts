import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { CHANNEL, type BrowserApi } from '../../src/shared/contracts';

test('B12: actual preload subscriptions clean up and never forward Electron event objects', () => {
  const ipc = Object.assign(new EventEmitter(), { invoke: async () => ({ ok: true, data: null }) });
  let exposed: BrowserApi | undefined;
  const source = readFileSync(new URL('../../src/preload/index.ts', import.meta.url), 'utf8');
  // Strip types using the installed Node runtime; replace only module imports
  // with test adapters so subscription logic is the actual preload source.
  const compiled = stripTypeScriptTypes(source)
    .replace(/^import .* from 'electron';$/m, "const { contextBridge, ipcRenderer } = require('electron');")
    .replace(/^import .* from '..\/shared\/contracts';$/m, "const { CHANNEL } = require('../shared/contracts');");
  vm.runInNewContext(compiled, {
    exports: {},
    require(name: string) {
      if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (name: string, api: BrowserApi) => { assert.equal(name, 'browser'); exposed = api; } } };
      if (name === '../shared/contracts') return { CHANNEL };
      throw new Error('Unexpected preload dependency');
    },
  });
  assert.ok(exposed);
  assert.equal('invoke' in exposed, false);
  assert.equal('executeScript' in exposed, false);
  for (let index = 0; index < 100; index++) {
    const calls: unknown[][] = [];
    const off = exposed.onStateChanged((...args: unknown[]) => calls.push(args));
    const offFocus = exposed.onFocusAddress((...args: unknown[]) => calls.push(args));
    const findCalls: unknown[][] = [];
    const offFind = exposed.onFocusFind((...args: unknown[]) => findCalls.push(args));
    const downloadCalls: unknown[][] = [];
    const offDownload = exposed.onDownloadChanged((...args: unknown[]) => downloadCalls.push(args));
    const state = { revision: index };
    const event = { secretEventMarker: true };
    ipc.emit(CHANNEL.state, event, state);
    ipc.emit(CHANNEL.focusAddress, event);
    ipc.emit(CHANNEL.focusFind, event);
    assert.equal(findCalls.length, 1); assert.equal(findCalls[0]?.length, 0);
    const downloadEvent = { contextEpoch: 'test', downloads: [] };
    ipc.emit(CHANNEL.download, event, downloadEvent);
    assert.equal(downloadCalls[0]?.length, 1);
    assert.equal(downloadCalls[0]?.[0], downloadEvent);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.length, 1);
    assert.equal(calls[0]?.[0], state);
    assert.equal(calls[1]?.length, 0);
    off(); offFocus(); offDownload(); offFind();
    assert.equal(ipc.listenerCount(CHANNEL.state), 0);
    assert.equal(ipc.listenerCount(CHANNEL.focusAddress), 0);
    assert.equal(ipc.listenerCount(CHANNEL.download), 0);
    assert.equal(ipc.listenerCount(CHANNEL.focusFind), 0);
  }
});
