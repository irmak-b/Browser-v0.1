import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Session } from 'electron';

export async function registerUiProtocol(session: Session, rendererRoot: string) {
  const allowlist = new Map<string, string>();
  async function collect(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await collect(fullPath);
      else if (entry.isFile()) allowlist.set('/' + relative(rendererRoot, fullPath).replaceAll('\\', '/'), fullPath);
    }
  }
  await collect(rendererRoot);
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  session.protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const path = allowlist.get(url.pathname);
    if (request.method !== 'GET' || url.host !== 'browser' || url.username || url.password
      || url.search || url.hash || !path) return new Response('Not found', { status: 404 });
    try {
      const extension = path.slice(path.lastIndexOf('.'));
      return new Response(await readFile(path), {
        headers: {
          'content-type': `${types[extension] ?? 'application/octet-stream'}; charset=utf-8`,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        },
      });
    } catch { return new Response('Not found', { status: 404 }); }
  });
}
