import test from 'node:test';
import assert from 'node:assert/strict';
import { basename, dirname, normalize } from 'node:path';
import { instanceDirectory } from '../../src/main/browser/instance-key';

test('the same Windows installation/version has a stable key independent of case, slashes or PID',()=>{
  assert.equal(instanceDirectory('C:/Temp','C:/Projects/Browser','V1.0.12.0'),instanceDirectory('C:/Temp','c:\\projects\\browser\\','V1.0.12.0'));
  const key=instanceDirectory('C:/Temp','C:/Projects/Browser','V1.0.12.0');
  assert.match(basename(key),/^BrowserCore-instance-[a-f0-9]{32}$/);assert.equal(dirname(key),normalize('C:/Temp'));
});

test('different installations, versions and explicit test namespaces do not share the lock',()=>{
  const key=instanceDirectory('C:/Temp','C:/A','V1.0.12.0');
  assert.notEqual(key,instanceDirectory('C:/Temp','C:/B','V1.0.12.0'));
  assert.notEqual(key,instanceDirectory('C:/Temp','C:/A','V1.0.11.0'));
  assert.notEqual(key,instanceDirectory('C:/Temp','C:/A','V1.0.12.0','test-a'));
  assert.notEqual(instanceDirectory('C:/Temp','C:/A','V1.0.12.0','test-a'),instanceDirectory('C:/Temp','C:/A','V1.0.12.0','test-b'));
});

test('namespace is bounded data, never a path; invalid input falls back to the ordinary lock',()=>{
  const key=instanceDirectory('C:/Temp','C:/A','V1.0.12.0');
  for(const scope of ['../other','C:\\Profiles','x'.repeat(65),'with space','\0'])assert.equal(instanceDirectory('C:/Temp','C:/A','V1.0.12.0',scope),key);
  assert.throws(()=>instanceDirectory('C:/Temp','C:/A','not-a-version'));
});
