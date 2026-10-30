import type { Input } from 'electron';

type ShortcutInput = Pick<Input, 'type' | 'key' | 'control' | 'meta' | 'alt' | 'shift'>;
export type BrowserShortcut =
  | { kind: 'focus-address' | 'new-tab' | 'restore-tab' | 'close-tab' | 'reload' | 'reload-without-cache' | 'back' | 'forward' | 'find' }
  | { kind: 'find-next'; backwards: boolean }
  | { kind: 'zoom'; direction: 'in' | 'out' | 'reset' }
  | { kind: 'cycle-tab'; direction: 1 | -1 }
  | { kind: 'select-tab'; index: number | 'last' };

// Runs only on input; no global shortcut registration or background polling.
export function browserShortcut(input: ShortcutInput): BrowserShortcut | undefined {
  if (input.type !== 'keyDown') return;
  const key = input.key.toLowerCase();
  const command = input.control || input.meta;
  if (command && !input.alt) {
    if (key === 'f5' || key === 'r' && input.shift) return { kind: 'reload-without-cache' };
    if (key === '+' || (!input.shift && key === '=')) return { kind: 'zoom', direction: 'in' };
    if (key === '-' && !input.shift) return { kind: 'zoom', direction: 'out' };
    if (key === '0' && !input.shift) return { kind: 'zoom', direction: 'reset' };
    if (key === 'tab') return { kind: 'cycle-tab', direction: input.shift ? -1 : 1 };
    if (key === 't' && input.shift) return { kind: 'restore-tab' };
    if (input.shift) return;
    if (key === 'l') return { kind: 'focus-address' };
    if (key === 't') return { kind: 'new-tab' };
    if (key === 'w') return { kind: 'close-tab' };
    if (key === 'r') return { kind: 'reload' };
    if (key === 'f') return { kind: 'find' };
    if (/^[1-8]$/.test(key)) return { kind: 'select-tab', index: Number(key) - 1 };
    if (key === '9') return { kind: 'select-tab', index: 'last' };
  }
  if (!command && !input.alt && key === 'f3') return { kind: 'find-next', backwards: input.shift };
  if (!command && !input.shift) {
    if (input.alt && key === 'arrowleft') return { kind: 'back' };
    if (input.alt && key === 'arrowright') return { kind: 'forward' };
    if (!input.alt && key === 'f5') return { kind: 'reload' };
  }
}
