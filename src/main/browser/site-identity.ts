// Preserve the actual Chromium/OS identity; remove application/runtime tokens
// that websites can mistake for an embedded or unsupported browser.
export function siteUserAgent(original:string){
  return original.replace(/\b(?:BrowserCore|browser-core|Electron)\/[\w.-]+\s*/g,'').replace(/ {2,}/g,' ').trim();
}
// Default site language for the current Turkish shell. Not an IP/country claim.
export const SITE_LANGUAGES='tr-TR,tr,en-US,en';
