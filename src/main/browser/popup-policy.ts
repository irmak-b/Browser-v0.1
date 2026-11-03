import type { WebContents } from 'electron';

export type PopupInput = { at: number; kind: 'mouse'; x: number; y: number } | { at: number; kind: 'keyboard' };
export const POPUP_INPUT_MS = 1500;

export function isTabDisposition(disposition: string) {
  return disposition === 'foreground-tab' || disposition === 'background-tab';
}

// A bounded DOM read only when a popup is requested. No site preload, bridge,
// observer or recurring scan. Native input supplies the point; the DOM is an
// intent heuristic, never an authority to bypass URL/ad/ownership checks.
export function popupIntentSource(input: PopupInput, destination: string): string {
  return `(()=>{
    const destination=new URL(${JSON.stringify(destination)});
    let element=${input.kind === 'mouse' ? `document.elementFromPoint(${JSON.stringify(input.x)},${JSON.stringify(input.y)})` : 'document.activeElement'};
    for(let depth=0;element&&element.shadowRoot&&depth<8;depth++){
      const nested=${input.kind === 'mouse' ? `element.shadowRoot.elementFromPoint(${JSON.stringify(input.x)},${JSON.stringify(input.y)})` : 'element.shadowRoot.activeElement'};
      if(!nested||nested===element)break;element=nested;
    }
    for(let depth=0;element&&depth<16;depth++,element=element.parentElement||element.getRootNode().host){
      const disabled=element.matches(':disabled')||element.getAttribute('aria-disabled')==='true';
      if(disabled)return false;
      if(element.getAttribute('role')==='button')return true;
      if(element.localName==='a'||element.localName==='area'){
        const href=element.getAttribute('href');
        if(!href||href.length>8192)return false;
        try{
          const link=new URL(href,document.baseURI);
          return /^https?:$/.test(link.protocol)&&link.origin===destination.origin&&link.pathname===destination.pathname;
        }catch{return false;}
      }
      const tag=element.localName;
      if(tag==='button'||tag==='input'||tag==='select'||tag==='textarea'){
        const form=element.form;
        if(!form)return tag==='button'||tag==='input'&&['button','submit','image'].includes(element.type);
        if(form.method.toLowerCase()!=='get')return false;
        const action=new URL(element.getAttribute('formaction')||form.getAttribute('action')||location.href,document.baseURI);
        const method=element.getAttribute('formmethod');
        return (!method||method.toLowerCase()==='get')&&action.origin===destination.origin&&action.pathname===destination.pathname;
      }
    }
    return false;
  })()`;
}

export type PopupIntent = 'allow' | 'block' | 'unavailable';
export async function inspectPopupIntent(wc: WebContents, input: PopupInput, url: string): Promise<PopupIntent> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Isolated intrinsics; page scripts cannot replace URL/DOM method bindings.
    // Completion callbacks retain no tab/controller if a renderer never replies.
    const probe = wc.executeJavaScriptInIsolatedWorld(998, [{ code: popupIntentSource(input, url) }])
      .then((value): PopupIntent => value === true ? 'allow' : 'block', (): PopupIntent => 'unavailable');
    return await Promise.race([probe, new Promise<PopupIntent>(resolve => { timer = setTimeout(() => resolve('unavailable'), 750); })]);
  } catch { return 'unavailable'; }
  finally { clearTimeout(timer); }
}
