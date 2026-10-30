import { createHash } from 'node:crypto';
import { join, win32 } from 'node:path';

// This key separates installation/version copies and optional test invocations.
// It is not a profile, an authorization key, or a source of navigation inputs.
export function instanceDirectory(temp: string, appPath: string, version: string, scope?: string) {
  if (!/^V\d+\.\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid instance version');
  const namespace = scope && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(scope) ? scope.toLowerCase() : 'default';
  const path = win32.resolve(appPath).toLowerCase();
  const digest = createHash('sha256').update(JSON.stringify([path, version, namespace])).digest('hex').slice(0, 32);
  return join(temp, `BrowserCore-instance-${digest}`);
}
