import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserShortcut } from '../../src/main/browser/shortcuts';

const key = (key: string, modifiers: Partial<Parameters<typeof browserShortcut>[0]> = {}) =>
  browserShortcut({ type: 'keyDown', key, control: false, meta: false, shift: false, alt: false, ...modifiers });

test('keyboard navigation maps both command modifiers and preserves tab order intent', () => {
  for (const modifier of ['control', 'meta']) {
    const command = { [modifier]: true };
    for (const [letter, kind] of [['L', 'focus-address'], ['t', 'new-tab'], ['w', 'close-tab'], ['R', 'reload']]) {
      assert.deepEqual(key(letter!, command), { kind });
    }
    assert.deepEqual(key('Tab', command), { kind: 'cycle-tab', direction: 1 });
    assert.deepEqual(key('Tab', { ...command, shift: true }), { kind: 'cycle-tab', direction: -1 });
    for (let index = 1; index <= 8; index++) {
      assert.deepEqual(key(String(index), command), { kind: 'select-tab', index: index - 1 });
    }
    assert.deepEqual(key('9', command), { kind: 'select-tab', index: 'last' });
  }
  assert.deepEqual(key('ArrowLeft', { alt: true }), { kind: 'back' });
  assert.deepEqual(key('ArrowRight', { alt: true }), { kind: 'forward' });
  assert.deepEqual(key('F5'), { kind: 'reload' });
});

test('ordinary typing, keyup and conflicting modifiers stay with the page or OS', () => {
  for (const letter of ['l', 't', 'w', 'r', '1', '9', 'Tab', 'ArrowLeft', 'ArrowRight']) assert.equal(key(letter), undefined);
  for (const letter of ['l', 't', 'w', 'r', '1', '9', 'Tab']) {
    assert.equal(key(letter, { type: 'keyUp', control: true }), undefined);
    assert.equal(key(letter, { control: true, alt: true }), undefined);
    if (letter !== 'Tab' && letter !== 't' && letter !== 'r') assert.equal(key(letter, { control: true, shift: true }), undefined);
  }
  for (const arrow of ['ArrowLeft', 'ArrowRight']) {
    assert.equal(key(arrow, { alt: true, shift: true }), undefined);
    assert.equal(key(arrow, { alt: true, control: true }), undefined);
  }
  assert.deepEqual(key('0', { control: true }), { kind: 'zoom', direction: 'reset' });
  assert.deepEqual(key('F5', { control: true }), { kind: 'reload-without-cache' });
});

test('closed tab restore uses only the explicit command-shift-T chord', () => {
  assert.deepEqual(key('T', {control:true,shift:true}), {kind:'restore-tab'});
  assert.deepEqual(key('t', {meta:true,shift:true}), {kind:'restore-tab'});
  for(const modifiers of [{shift:true},{control:true,shift:true,alt:true},{control:true,shift:true,type:'keyUp' as const}]) assert.equal(key('t',modifiers),undefined);
  assert.deepEqual(key('t',{control:true}),{kind:'new-tab'});
});

test('page find and zoom shortcuts leave text entry and conflicting modifiers alone', () => {
  assert.deepEqual(key('f', { control: true }), { kind: 'find' });
  assert.deepEqual(key('F3'), { kind: 'find-next', backwards: false });
  assert.deepEqual(key('F3', { shift: true }), { kind: 'find-next', backwards: true });
  assert.deepEqual(key('=', { control: true }), { kind: 'zoom', direction: 'in' });
  assert.deepEqual(key('+', { control: true, shift: true }), { kind: 'zoom', direction: 'in' });
  assert.deepEqual(key('-', { control: true }), { kind: 'zoom', direction: 'out' });
  for (const letter of ['f', '+', '-', '=', '0']) {
    assert.equal(key(letter), undefined);
    assert.equal(key(letter, { control: true, alt: true }), undefined);
  }
});

test('cache bypass is explicit; ordinary reload and conflicting keys keep their behavior', () => {
  for (const modifier of ['control', 'meta']) {
    assert.deepEqual(key('R', { [modifier]: true, shift: true }), { kind: 'reload-without-cache' });
    assert.deepEqual(key('F5', { [modifier]: true }), { kind: 'reload-without-cache' });
    assert.deepEqual(key('r', { [modifier]: true }), { kind: 'reload' });
    assert.equal(key('R', { [modifier]: true, shift: true, alt: true }), undefined);
    assert.equal(key('R', { [modifier]: true, shift: true, type: 'keyUp' }), undefined);
  }
  assert.deepEqual(key('F5'), { kind: 'reload' });
  assert.equal(key('F5', { shift: true }), undefined);
  assert.equal(key('F5', { alt: true, control: true }), undefined);
});
