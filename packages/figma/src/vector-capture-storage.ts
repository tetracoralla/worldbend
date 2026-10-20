/** Owned capture transport only: never authoring controls or creation identity. */
const NS="worldbend",META="vector-read-manifest",PREFIX="vector-read-chunk-";
export const VECTOR_CAPTURE_CHUNK_BYTES=60*1024;
export const VECTOR_CAPTURE_ENCODED_BYTES=2*1024*1024+1024;
const COUNT=Math.ceil(VECTOR_CAPTURE_ENCODED_BYTES/VECTOR_CAPTURE_CHUNK_BYTES);
type Reader={getSharedPluginData(namespace:string,key:string):string};
type Writer=Reader&{setSharedPluginData(namespace:string,key:string,value:string):void};
export interface VectorCaptureStorage {manifest:string;chunks:string[]}
export function vectorCaptureStorage(node:Reader):VectorCaptureStorage{
  return {manifest:node.getSharedPluginData(NS,META),chunks:Array.from({length:COUNT},(_,i)=>node.getSharedPluginData(NS,`${PREFIX}${i}`))};
}
export function restoreVectorCaptureStorage(node:Writer,value:VectorCaptureStorage){
  for(let i=0;i<COUNT;i++)node.setSharedPluginData(NS,`${PREFIX}${i}`,value.chunks[i]??"");
  node.setSharedPluginData(NS,META,value.manifest);
}
/** Publication changes the captured reference synchronously. Any cache present
 * at that commit is obsolete; clear its exact known keys in the same rollback
 * boundary. No broad shared-key enumeration or creation-marker removal. */
export function clearVectorCaptureStorage(node:Writer,value:VectorCaptureStorage){
  for(let i=0;i<COUNT;i++)if(value.chunks[i])node.setSharedPluginData(NS,`${PREFIX}${i}`,"");
  if(value.manifest)node.setSharedPluginData(NS,META,"");
  if(node.getSharedPluginData(NS,META)||Array.from({length:COUNT},(_,i)=>node.getSharedPluginData(NS,`${PREFIX}${i}`)).some(Boolean))
    throw Error("E_FIGMA_STATE: obsolete Vector capture was not cleared");
}
