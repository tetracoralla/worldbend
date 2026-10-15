/** Source-only envelope prepared by the owning MCP binary. This export is
 * never a product tool accepting caller-authored JavaScript. */
import {decodeExactJson,type ExactJsonEnvelope} from "./exact-json-codec";
import {utf8ByteLength} from "./json-value";
export async function executeEmbeddedRuntime(source:ExactJsonEnvelope) {
  if(source.decodedBytes>256*1024)throw Error("E_FIGMA_LIMIT: trusted executable envelope too large");
  const code=decodeExactJson(source);
  if(typeof code!=="string"||utf8ByteLength(code)>128*1024)throw Error("E_FIGMA_LIMIT: trusted executable source too large");
  return Function("figma",`return (async()=>{${code}\n})()`)(figma) as Promise<unknown>;
}
