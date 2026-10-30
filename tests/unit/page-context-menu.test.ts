import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { BrowserWindow, ContextMenuParams, Menu, MenuItemConstructorOptions, WebContents, WebFrameMain } from 'electron';
import { PageContextMenu, contextLink } from '../../src/main/browser/page-context-menu';

function setup() {
  let current = true, destroyed = false, frameGone = false, closed = 0, created = 0;
  const calls: string[] = [];
  const frame = { url: 'https://example.test/', isDestroyed: () => frameGone } as WebFrameMain;
  const emitter = new EventEmitter();
  const wc = Object.assign(emitter, { isDestroyed: () => destroyed, focusedFrame: frame,
    navigationHistory: { canGoBack: () => false, canGoForward: () => true },
    ...Object.fromEntries(['undo','redo','cut','copy','paste','selectAll'].map(key => [key, () => calls.push(key)])),
  }) as unknown as WebContents;
  let items: MenuItemConstructorOptions[] = [], finish: (() => void) | undefined;
  const menus = new PageContextMenu({} as BrowserWindow, template => {
    created++; items = template;
    return { popup: options => { finish = options?.callback; }, closePopup: () => { closed++; finish?.(); } } as Pick<Menu, 'popup' | 'closePopup'>;
  }, text => { calls.push('link:' + text); });
  const params = { frame, linkURL: '', selectionText: '', formControlType: 'none', isEditable: false, menuSourceType: 'mouse',
    editFlags: {canUndo:true,canRedo:false,canCut:true,canCopy:true,canPaste:true,canSelectAll:true},
  } as ContextMenuParams;
  const show = () => menus.show(wc, params, () => current, {
    openLink: url => { calls.push('open:' + url); }, back: async () => { calls.push('back'); },
    forward: async () => { calls.push('forward'); }, reload: async () => { calls.push('reload'); }, failed: () => { calls.push('failed'); },
  });
  const item = (id: string) => items.find(item => item.id === id)!;
  const click = (item: MenuItemConstructorOptions) => item.click?.({} as never, undefined, {} as never);
  return { menus, wc, frame, params, calls, show, item, click, items: () => items, close: () => finish?.(), counts: () => ({closed,created}),
    invalidate: () => { current = false; }, destroy: () => { destroyed = true; }, frameGone: () => { frameGone = true; } };
}

test('context links are bounded HTTP(S) URLs; unsafe targets cannot bypass address policy', () => {
  assert.equal(contextLink('https://example.test/a?q=1#x'), 'https://example.test/a?q=1#x');
  for (const input of ['', 'javascript:alert(1)', 'file:///C:/x', 'mailto:a@b.test', 'https://user:pass@example.test/', 'https://exa\nmple.test/', 'https://example.test/ has space', 'https://example.test/\\x', 'https://example.test/'+'x'.repeat(8192)]) assert.equal(contextLink(input), undefined);
});

test('menus are built on demand, single-owner and single-use; close/dispose invalidate retained actions', () => {
  const s = setup(); assert.deepEqual(s.counts(), {closed:0,created:0});
  s.params.linkURL = 'https://other.test/page'; s.show(); const old = s.item('open-link');
  assert.equal(s.items().length, 4); s.show(); assert.equal(s.counts().closed, 1);
  s.click(old); assert.deepEqual(s.calls, []);
  const selected = s.item('open-link'); s.click(selected); s.click(selected);
  assert.deepEqual(s.calls, ['open:https://other.test/page']);
  s.show(); const late = s.item('copy-link'); s.close(); s.click(late);
  s.show(); const disposed = s.item('copy-link'); s.menus.dispose(); s.click(disposed); s.show();
  assert.equal(s.counts().created, 4); assert.equal(s.calls.length, 1);
});

test('selection/document/frame destruction and reconciliation reject stale commands', () => {
  for (const reason of ['current','destroy','frame','url']) {
    const s = setup(); s.params.linkURL='https://other.test/'; s.show(); const item=s.item('open-link');
    if(reason==='current')s.invalidate(); if(reason==='destroy')s.destroy(); if(reason==='frame')s.frameGone(); if(reason==='url')Object.defineProperty(s.frame,'url',{value:'https://example.test/new'});
    s.menus.reconcile(); s.click(item); assert.deepEqual(s.calls, []); assert.equal(s.counts().closed,1);
  }
});

test('edit flags, password fields and native focused frame fence clipboard/edit operations', () => {
  const s=setup(); s.params.isEditable=true; s.show();
  assert.equal(s.item('redo').enabled,false); s.click(s.item('redo')); assert.deepEqual(s.calls,[]);
  s.click(s.item('undo')); assert.deepEqual(s.calls,['undo']);
  s.params.formControlType='input-password'; s.show(); assert.equal(s.item('copy').enabled,false); assert.equal(s.item('cut').enabled,false);
  s.click(s.item('copy')); assert.equal(s.calls.length,1);
  s.params.formControlType='input-text'; s.show();
  Object.defineProperty(s.wc,'focusedFrame',{value:{},configurable:true}); s.click(s.item('paste')); assert.equal(s.calls.length,1);
  Object.defineProperty(s.wc,'focusedFrame',{value:s.frame,configurable:true}); s.click(s.item('paste')); assert.deepEqual(s.calls,['undo','paste']);
});

test('menu commands preserve native navigation availability and do not retain selection text', () => {
  const s=setup(); s.show(); assert.equal(s.item('back').enabled,false); assert.equal(s.item('forward').enabled,true);
  s.click(s.item('back')); assert.deepEqual(s.calls,[]); s.click(s.item('forward')); assert.deepEqual(s.calls,['forward']);
  s.params.selectionText='selected fixture'; s.show(); assert.equal(s.item('back'),undefined); s.click(s.item('copy')); assert.deepEqual(s.calls,['forward','copy']);
  s.params.linkURL='javascript:alert(1)'; s.show(); assert.equal(s.item('open-link'),undefined);
});

test('any document navigation cancels the menu and its temporary listeners, including same-URL subframe reload', () => {
  const s=setup(); s.params.linkURL='https://other.test/'; s.show(); const retained=s.item('open-link');
  for(const event of ['did-start-navigation','render-process-gone','destroyed'])assert.equal(s.wc.listenerCount(event),1);
  s.wc.emit('did-start-navigation',{isMainFrame:false,isSameDocument:false,url:s.frame.url});
  s.click(retained);assert.deepEqual(s.calls,[]);
  for(const event of ['did-start-navigation','render-process-gone','destroyed'])assert.equal(s.wc.listenerCount(event),0);
  s.show();s.close();for(const event of ['did-start-navigation','render-process-gone','destroyed'])assert.equal(s.wc.listenerCount(event),0);
});
