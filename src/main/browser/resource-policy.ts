// Deliberately conservative: arbitrary web-app JS state cannot be reconstructed.
export const SLEEP_AFTER_MS = 5 * 60_000;
export const FREEZE_AFTER_MS = 2 * 60_000;
export const FREEZE_PROBE = `document.readyState === 'complete' && !document.querySelector('audio,video')`;
export function blocksScripts(policies: string[]) {
  return policies.some(policy => {
    const directives = new Map<string, string[]>();
    for (const part of policy.toLowerCase().split(';')) {
      const [name, ...sources] = part.trim().split(/\s+/);
      if (name && !directives.has(name)) directives.set(name, sources);
    }
    const script = directives.get('script-src') ?? directives.get('default-src');
    return [script, directives.get('script-src-elem') ?? script, directives.get('script-src-attr') ?? script]
      .every(sources => sources?.length === 1 && sources[0] === "'none'");
  });
}
export const STATIC_PROBE_NODE_LIMIT = 5000;
export const STATIC_PROBE_ATTRIBUTE_LIMIT = 20000;
export const STATIC_PROBE_CHARACTER_LIMIT = 262144;
export function staticProbeExceededBudget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const result = value as { safe?: unknown; budgetExceeded?: unknown };
  return result.safe === false && result.budgetExceeded === true;
}
export const STATIC_PAGE_PROBE = `(() => {
  if (document.readyState !== 'complete' || document.contentType !== 'text/html') return false;
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
  let element, nodes = 0, attributes = 0, characters = 0;
  while ((element = walker.nextNode())) {
    if (++nodes > ${STATIC_PROBE_NODE_LIMIT}) return { safe: false, budgetExceeded: true };
    if (element.nodeType !== Node.ELEMENT_NODE) continue;
    const attrs = element.attributes;
    if ((attributes += attrs.length) > ${STATIC_PROBE_ATTRIBUTE_LIMIT}) return { safe: false, budgetExceeded: true };
    if (/^(script|noscript|form|input|textarea|select|audio|video|iframe|frame|object|embed|canvas)$/i.test(element.localName)
      || element.hasAttribute('contenteditable') || element.localName === 'meta' && element.hasAttribute('http-equiv')
      || element.shadowRoot || element.localName.includes('-')) return false;
    for (const attr of attrs) {
      const name = attr.name, value = attr.value;
      if ((characters += name.length + value.length) > ${STATIC_PROBE_CHARACTER_LIMIT}) return { safe: false, budgetExceeded: true };
      if (/^on/i.test(name) || /^javascript:/i.test(value.trim())) return false;
    }
  }
  return { safe: true, x: scrollX, y: scrollY };
})()`;

export interface SleepCandidate {
  selected: boolean; ready: boolean; closing: boolean; interacted: boolean;
  keepAwake: boolean; busy: boolean; singleEntry: boolean; idleSince: number;
}
export function canSleep(candidate: SleepCandidate, now: number) {
  return !candidate.selected && candidate.ready && !candidate.closing && !candidate.interacted
    && !candidate.keepAwake && !candidate.busy && candidate.singleEntry
    && now - candidate.idleSince >= SLEEP_AFTER_MS;
}
