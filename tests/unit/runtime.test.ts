import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

test('missing local Electron fails without loading its automatic downloader', () => {
  const cache = resolve('.cache');
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, 'runtime-guard-'));
  assert.ok(directory.startsWith(cache + sep));
  try {
    const fake = join(directory, 'node_modules/electron');
    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, 'package.json'), JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.cjs' }));
    writeFileSync(join(fake, 'index.cjs'), "require('node:fs').writeFileSync(require('node:path').join(__dirname,'DOWNLOADER_CALLED'),'bad')");
    const script = join(directory, 'check-runtime.mjs');
    copyFileSync(resolve('scripts/check-runtime.mjs'), script);
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Otomatik indirme başlatılmadı/);
    assert.equal(existsSync(join(fake, 'DOWNLOADER_CALLED')), false);
  } finally {
    // Only remove the newly created test folder verified under this workspace cache.
    if (!directory.startsWith(cache + sep)) throw new Error('Invalid cleanup target');
    rmSync(directory, { recursive: true, force: false });
  }
});
