import { createHash } from 'node:crypto';

// Exact reviewed, contiguous edit-inbound rules from the pinned snapshot.
// Changed/reordered resources retain their original execution path.
const reviewed = [
  '35b95992ccf9e9976ea083b3d6774d49e172c4a127a66c4973c790ffdf3dd14f',
  '8575f74ab777a8b6aea57590af3a120a47e90c9d2e50077cf7b696b7348bac84',
  '04fc95293ec0f87aea25828e7544eb72625c4d5153a7e5aed925a9472874d5a2',
  '6cc608fe079a074f80a8c99b419ca98b38b5c51d9207aeb9f43acbe2f5ae765a',
  '60bc50961a4cc40cbfcc10369bfb1ca2a8f3791e2c8931e2828da48d5344b0f6',
  '44c1ae2a0f0733258660362ca8cfcc7b920c19ee3dc5eeee3e3fec2f6dcf4f77',
  '75243bb0ca003967e96c5179db72590bfa0e2ec1a2dbaf9fbb4c3848c9ec1f7a',
];
const install = String.raw`;(()=>{
  const safe=safeSelf(),base=scriptletGlobals.jsonEditBase,edits=scriptletGlobals.jsonEdits;
  delete scriptletGlobals.jsonEditBase;
  delete scriptletGlobals.jsonEdits;
  if(base!==safe.JSON_stringifyFn||edits.length!==7||safe.sendToLogger)return;
  const apply=Reflect.apply,includes=String.prototype.includes;
  proxyApplyFn('JSON.stringify',context=>{
    if(context.callArgs.length!==1)return context.reflect();
    const text=apply(base,context.thisArg,context.callArgs);
    if(typeof text!=='string'||(!apply(includes,text,['"attestationRequest":'])&&!apply(includes,text,['"createCommentParams":']))){
      context.callFn=context.thisArg=context.callArgs=context.private=undefined;
      return text;
    }
    // User getters/toJSON/Proxy run once, as in native JSON. All seven pinned
    // edits insert/replace JSON-safe strings or plain JSON objects. Applying the
    // very same compiled queries to one snapshot, in reverse registration order,
    // is equivalent to the nested proxy chain's repeated intermediate copies.
    const snapshot=safe.JSON_parse(text);
    if(snapshot===null||typeof snapshot!=='object'||(!safe.Object_hasOwn(snapshot,'attestationRequest')&&!safe.Object_hasOwn(snapshot,'createCommentParams'))){
      context.callFn=context.thisArg=context.callArgs=context.private=undefined;
      return text;
    }
    let value=snapshot,changed=false;
    for(let i=edits.length-1;i>=0;i--){const result=edits[i].apply(value);if(result!==undefined){value=result;changed=true;}}
    context.callFn=context.thisArg=context.callArgs=context.private=undefined;
    return changed?safe.JSON_stringify(value):text;
  });
})();`;

export function jsonEditFastPath(scripts: string[]): string[] {
  const candidates=scripts.map((source,index)=>({source,index})).filter(r=>r.source.includes('function editInboundObjectFn'));
  if(candidates.length!==reviewed.length)return scripts;
  const start=candidates[0]!.index;
  if(!candidates.every((r,i)=>r.index===start+i&&createHash('sha256').update(r.source).digest('hex')===reviewed[i]))return scripts;
  const result=[...scripts];
  for(let i=start;i<start+reviewed.length;i++)result[i]=result[i]!.replace('const f=JSONPath.create(n);','const f=JSONPath.create(n);scriptletGlobals.jsonEdits.push(f);');
  result[start]='scriptletGlobals.jsonEditBase=JSON.stringify;scriptletGlobals.jsonEdits=[];'+result[start];
  result[start+reviewed.length-1]+=install;
  return result;
}
