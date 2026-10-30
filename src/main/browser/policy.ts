import { BrowserFault, DEV_UI_ORIGIN, UI_URL } from '../../shared/contracts';

export function siteUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); }
  catch { throw new BrowserFault('INVALID_INPUT', 'Geçerli bir web adresi girin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new BrowserFault('POLICY_BLOCKED', 'Bu adres geliştirme politikası tarafından reddedildi.');
  }
  return url.href;
}

/** Only address-bar intent can become a search; links/redirects use siteUrl. */
export function resolveInput(input: string): string {
  const text = input.trim();
  if (!text || text.length > 8192 || /[\u0000-\u001f\u007f\\\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(text)) {
    throw new BrowserFault('INVALID_INPUT', 'Adres veya arama girdisi geçersiz.');
  }
  if (text.startsWith('//')) throw new BrowserFault('INVALID_INPUT', 'Adresin protokolünü veya alan adını açık yazın.');
  const hostPort = /^(?:localhost|[^\s/:]+\.[^\s/:]+|\[[0-9a-f:]+\]):\d+(?:[/?#]|$)/i.test(text);
  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(text)?.[0];
  if (scheme && !hostPort) {
    if (!/^https?:$/i.test(scheme)) throw new BrowserFault('POLICY_BLOCKED', 'Bu protokole izin verilmiyor.');
    if (!/^https?:\/\//i.test(text) || /\s/u.test(text)) throw new BrowserFault('INVALID_INPUT', 'Web adresi geçersiz.');
    return siteUrl(text);
  }
  if (!/\s/u.test(text) && text.includes('@')) throw new BrowserFault('POLICY_BLOCKED', 'Adres içinde kullanıcı bilgisi kullanılamaz.');
  const looksLikeHost = !/\s/u.test(text) && /^(?:localhost(?=[:/?#]|$)|\[[0-9a-f:]+\]|[^/?#]+\.[^/?#]+)(?:[/?#].*)?$/i.test(text);
  if (hostPort || looksLikeHost) {
    const url = siteUrl(`https://${text}`);
    const hostname = new URL(url).hostname;
    if (!hostname || hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.')) {
      throw new BrowserFault('INVALID_INPUT', 'Alan adı geçersiz.');
    }
    return url;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(text)}&hl=tr`;
}

export function isTrustedUiUrl(input: string, development: boolean): boolean {
  try {
    const url = new URL(input);
    if (development) return url.origin === DEV_UI_ORIGIN && url.pathname === '/';
    return url.href === UI_URL;
  } catch { return false; }
}

export function isTrustedCaller(
  expectedId: number, senderId: number, mainFrame: boolean, frameUrl: string, development: boolean,
): boolean {
  return senderId === expectedId && mainFrame && isTrustedUiUrl(frameUrl, development);
}
