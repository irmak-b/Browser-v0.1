// Fixed, non-interactive help text in an isolated world. No site URL, bridge,
// page timers, extra renderer or layout inset. Popover also covers <video>
// fullscreen, where appending a normal child to the video cannot render text.
export const FULLSCREEN_HINT_WORLD = 1003;
export const FULLSCREEN_HINT_TEXT = 'Tam ekrandan çıkmak için ESC tuşuna basabilirsiniz.';
const HINT_CSS = '[popover]{all:initial;position:fixed;inset:auto;top:24px;left:50%;transform:translateX(-50%);margin:0;box-sizing:border-box;width:max-content;max-width:calc(100vw - 48px);padding:12px 18px;border:0;border-radius:8px;background:rgba(0,0,0,.65);color:#fff;font:14px/1.5 "Segoe UI",system-ui,sans-serif;text-align:center;box-shadow:0 4px 16px #0003;pointer-events:none;user-select:none}[popover]::backdrop{background:transparent;pointer-events:none}';

export function fullscreenHintCode(revision: number, show: boolean) {
  return `void (()=>{
    const key='__browserCoreFullscreenHint', revision=${revision};
    const old=globalThis[key];
    if(old?.revision>revision)return;
    old?.host?.remove();
    globalThis[key]={revision};
    ${show ? `if(!document.fullscreenElement)return;
    const host=document.createElement('span');
    host.setAttribute('data-browser-core-fullscreen-hint','');
    host.style.setProperty('display','contents','important');
    host.style.setProperty('pointer-events','none','important');
    const shadow=host.attachShadow({mode:'closed'}), sheet=new CSSStyleSheet();
    sheet.replaceSync(${JSON.stringify(HINT_CSS)});
    shadow.adoptedStyleSheets=[sheet];
    const hint=document.createElement('div');hint.popover='manual';hint.setAttribute('role','status');
    hint.textContent=${JSON.stringify(FULLSCREEN_HINT_TEXT)};
    shadow.append(hint);document.documentElement.append(host);
    globalThis[key]={revision,host,hint};
    try{hint.showPopover();}catch{host.remove();globalThis[key]={revision};}` : ''}
  })();`;
}
