import {base64Bytes,byteBase64,exactUtf8,utf8Bytes} from "./utf8-base64";
import {sha256Hex} from "../../web/src/sha256";
import {utf8ByteLength} from "./json-value";

const NS="worldbend",CHUNK_SIZE=60*1024;
type Reader={getSharedPluginData(namespace:string,key:string):string};
type Writer=Reader&{setSharedPluginData(namespace:string,key:string,value:string):void};
interface Bank {schema:"worldbend.operation-bank";version:"0.1";encoding:"utf8-base64";decodedBytes:number;digest:string;count:number;length:number}
function key(bank:Bank,index:number){return `operation-bank-${bank.digest}-${index}`;}
function manifest(raw:string):Bank|undefined {
  if(!raw||raw.length>4096)return undefined;
  let b:Bank;try{b=JSON.parse(raw);}catch{return undefined;}
  if(b?.schema!=="worldbend.operation-bank")return undefined;
  if(Object.keys(b).sort().join(",")!=="count,decodedBytes,digest,encoding,length,schema,version"||b.version!=="0.1"||
    b.encoding!=="utf8-base64"||!/^[a-f0-9]{64}$/.test(b.digest)||!Number.isSafeInteger(b.decodedBytes)||b.decodedBytes<1||b.decodedBytes>8*1024*1024||
    !Number.isSafeInteger(b.length)||b.length<1||b.length>Math.ceil(8*1024*1024/3)*4||!Number.isSafeInteger(b.count)||b.count!==Math.ceil(b.length/CHUNK_SIZE))
    throw Error("E_FIGMA_STATE: invalid owning operation bank");
  return b;
}
export function operationBankBytes(source:Reader,raw:string):Record<string,string>|undefined {
  const bank=manifest(raw);if(!bank)return undefined;
  return Object.fromEntries(Array.from({length:bank.count},(_,i)=>[key(bank,i),source.getSharedPluginData(NS,key(bank,i))]));
}
/** Only unreferenced keys belonging to this exact bank codec are staging/history.
 * Active bytes remain included in all author/source freshness proofs. */
export function inactiveOperationBankKey(source:Reader,k:string):boolean {
  if(!/^operation-bank-[a-f0-9]{64}-[0-9]+$/.test(k))return false;
  for(const slot of ["transform","rectification","canvas","task"]){
    try{const b=manifest(source.getSharedPluginData(NS,slot));if(b&&Array.from({length:b.count},(_,i)=>key(b,i)).includes(k))return false;}
    catch{return false;}
  }
  return true;
}
export function ephemeralWorldbendKey(key:string):boolean {
  return key==="vectorPublicationGuard"||/^publication-(transfer|chunk-[0-9]+|runtime|runtime-chunk-[0-9]+)$/.test(key)||
    /^vector-read-(manifest|chunk-[0-9]+)$/.test(key);
}
export function readOperationSlot(source:Reader,raw:string):unknown {
  const bank=manifest(raw);if(!bank)return JSON.parse(raw);
  let data="";for(let i=0;i<bank.count;i++){
    const chunk=source.getSharedPluginData(NS,key(bank,i));
    if(chunk.length!==Math.min(CHUNK_SIZE,bank.length-i*CHUNK_SIZE))throw Error("E_FIGMA_STATE: incomplete owning operation bank");
    data+=chunk;
  }
  if(sha256Hex(data)!==bank.digest)throw Error("E_FIGMA_INTEGRITY: owning operation bytes changed");
  const bytes=base64Bytes(data,Math.ceil(8*1024*1024/3)*4);if(bytes.length!==bank.decodedBytes)throw Error("E_FIGMA_INTEGRITY: owning operation decoded bytes changed");
  return JSON.parse(exactUtf8(bytes));
}
/** The active slot remains unchanged until all immutable bytes read back.
 * Return only newly written keys for failure cleanup, never a reused bank. */
export function prepareOperationSlot(target:Writer,value:unknown):{raw:string;created:string[]} {
  const raw=JSON.stringify(value);
  if(raw.length<=90*1024&&utf8ByteLength(raw)<=90*1024)return {raw,created:[]};
  const bytes=utf8Bytes(raw);if(bytes.length>8*1024*1024)throw Error("E_FIGMA_LIMIT: owning operation exceeds decoded capacity");
  const data=byteBase64(bytes),bank:Bank={schema:"worldbend.operation-bank",version:"0.1",encoding:"utf8-base64",
    decodedBytes:bytes.length,digest:sha256Hex(data),length:data.length,count:Math.ceil(data.length/CHUNK_SIZE)};
  if(bank.decodedBytes>8*1024*1024)throw Error("E_FIGMA_LIMIT: owning operation exceeds decoded capacity");
  const created:string[]=[];
  try{
    for(let i=0;i<bank.count;i++){
      const k=key(bank,i),bytes=data.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE),old=target.getSharedPluginData(NS,k);
      if(old&&old!==bytes)throw Error("E_FIGMA_INTEGRITY: immutable operation bank changed");
      if(!old){created.push(k);target.setSharedPluginData(NS,k,bytes);}
      if(target.getSharedPluginData(NS,k)!==bytes)throw Error("E_FIGMA_STATE: owning operation bytes were not retained");
    }
    const serialized=JSON.stringify(bank);readOperationSlot(target,serialized);
    return {raw:serialized,created};
  }catch(e){for(const k of created)target.setSharedPluginData(NS,k,"");throw e;}
}
