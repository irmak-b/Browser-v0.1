import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInput } from '../../src/main/browser/policy';

test('B07: full web URLs normalize and domains default to HTTPS', () => {
  for (const [input, expected] of [
    ['example.com', 'https://example.com/'],
    ['example.com/path?q=a#part', 'https://example.com/path?q=a#part'],
    ['http://127.0.0.1:9876/test', 'http://127.0.0.1:9876/test'],
    ['localhost:9876/page', 'https://localhost:9876/page'],
    ['https://EXAMPLE.com:443/', 'https://example.com/'],
    ['bücher.example', 'https://xn--bcher-kva.example/'],
    ['[::1]:9876/test', 'https://[::1]:9876/test'],
  ]) assert.equal(resolveInput(input!), expected);
});
test('B07: searches are encoded without loading a network page', () => {
  for (const text of ['browser core', 'merhaba dünya', 'ders', 'a & b # c']) {
    assert.equal(resolveInput(text), `https://www.google.com/search?q=${encodeURIComponent(text)}&hl=tr`);
  }
});
test('B07: unsafe schemes, credentials and deceptive/control inputs are rejected', () => {
  for (const input of [
    '', '   ', 'x'.repeat(8193), 'javascript:alert(1)', 'data:text/html,hi', 'file:///C:/test',
    'app://browser/index.html', 'mailto:a@b.test', 'C:\\Windows\\win.ini', '//example.com',
    'https:example.com', 'https://example.com@evil.test', 'user@example.com',
    'https://user:password@example.com', 'https://exam\nple.com', 'https://exam ple.com',
    'exa\u202Emple.com', 'exam\u200Bple.com', 'example..com', '999.999.999.999',
    'https://example.com\\@evil.test',
  ]) assert.throws(() => resolveInput(input), input);
});
