import { boundedStateFingerprint } from "./agent-handoff";
import type { WorkPage, WorkScope } from "./agent-work-state";
import { utf8Bytes } from "./utf8-base64";

/** Exact ASCII envelopes keep every returned host receipt below 20 KiB. */
export function vectorExactPage(json:string,input:WorkPage,scope:Partial<WorkScope>={}) {
  if(json.length>2*1024*1024+1024||/[^\x20-\x7e]/.test(json))throw Error("E_FIGMA_LIMIT: exact Vector envelope exceeds bounded read capacity");
  // The SDK bounds the COMPLETE UTF-8 return to 20 KiB, independently of
  // executable packet size. Reserve its state/capture/initialization wrappers,
  // including every repeated scoped identity, plus all possible slice escapes.
  // Ordinary canonical envelopes then use 18 KiB; unusual identities remain
  // readable through smaller complete pages, never truncation.
  const idBytes=(value?:string)=>utf8Bytes(JSON.stringify(value??"")).length;
  let escapes=0;for(let i=0;i<json.length;i++)if(json[i]==='"'||json[i]==='\\')escapes++;
  const overhead=1024+2*idBytes(scope.fileKey)+2*idBytes(scope.pageId)+4*idBytes(scope.nodeId)+escapes;
  const partSize=Math.min(18*1024,20*1024-overhead);
  if(partSize<1)throw Error("E_FIGMA_LIMIT: exact Vector receipt metadata exceeds host return capacity");
  // A runtime/page-size change must explicitly invalidate an old partial read,
  // rather than returning a different slice under the same token.
  const token=boundedStateFingerprint(`${partSize}:${json}`),partCount=Math.max(1,Math.ceil(json.length/partSize)),part=input.part??0;
  if(!Number.isSafeInteger(part)||part<0||part>=partCount||(part>0&&!input.token))throw Error("E_FIGMA_INPUT: use a valid Vector part and token");
  if(input.token!==undefined&&input.token!==token)throw Error("E_FIGMA_CONFLICT: Vector bytes changed; restart read");
  return {schema:"worldbend.figma.work-state-page" as const,version:"0.1" as const,token,part,partCount,codeUnits:json.length,
    json:json.slice(part*partSize,(part+1)*partSize),encoding:"exact-json-envelope" as const};
}
