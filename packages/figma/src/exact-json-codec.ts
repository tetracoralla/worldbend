import { gzipSync, Gunzip, strFromU8, strToU8 } from "fflate";
import { sha256Hex } from "../../web/src/sha256";

/** Data only. Executable runtime bytes use the separately trusted transport. */
declare function btoa(binary:string):string;
declare function atob(encoded:string):string;

export interface ExactJsonEnvelope {
  encoding: "gzip-base64" | "utf8-base64";
  decodedBytes: number;
  digest: string;
  data: string;
}
export const MAX_EXACT_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_EXACT_JSON_ENCODED = 2 * 1024 * 1024;
const CRC_TABLE=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let n=0;n<8;n++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]!^(c>>>8);return (c^0xffffffff)>>>0;}

export function byteBase64(bytes: Uint8Array): string {
  let binary="";
  for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
export function base64Bytes(data: string): Uint8Array {
  if(!data.length||data.length>MAX_EXACT_JSON_ENCODED||data.length%4||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw Error("E_FIGMA_INPUT: invalid bounded exact base64");
  const binary=atob(data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(byteBase64(bytes)!==data)throw Error("E_FIGMA_INPUT: noncanonical base64");
  return bytes;
}
export function encodeExactJson(value: unknown, compressed=true): ExactJsonEnvelope {
  const bytes=strToU8(JSON.stringify(value));
  if(!bytes.length||bytes.length>MAX_EXACT_JSON_BYTES)throw Error("E_FIGMA_LIMIT: complete exact value exceeds decoded capacity");
  const data=byteBase64(compressed?gzipSync(bytes,{level:6,mtime:0}):bytes);
  if(data.length>MAX_EXACT_JSON_ENCODED)throw Error("E_FIGMA_LIMIT: complete exact value exceeds encoded capacity");
  return {encoding:compressed?"gzip-base64":"utf8-base64",decodedBytes:bytes.length,digest:sha256Hex(data),data};
}
export function isExactJsonEnvelope(value: unknown): value is ExactJsonEnvelope {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).sort().join(",")==="data,decodedBytes,digest,encoding"&&
    (v.encoding==="gzip-base64"||v.encoding==="utf8-base64")&&
    Number.isSafeInteger(v.decodedBytes)&&Number(v.decodedBytes)>0&&Number(v.decodedBytes)<=MAX_EXACT_JSON_BYTES&&
    typeof v.digest==="string"&&/^[a-f0-9]{64}$/.test(v.digest)&&typeof v.data==="string"&&
    v.data.length>0&&v.data.length<=MAX_EXACT_JSON_ENCODED;
}
export function decodeExactJson(value: unknown): unknown {
  if(!isExactJsonEnvelope(value)||sha256Hex(value.data)!==value.digest)throw Error("E_FIGMA_INTEGRITY: exact value bytes changed");
  const encoded=base64Bytes(value.data);
  let bytes:Uint8Array;
  if(value.encoding==="utf8-base64")bytes=encoded;
  else {
    if(encoded.length<18||encoded[0]!==31||encoded[1]!==139||encoded[2]!==8)throw Error("E_FIGMA_INPUT: invalid gzip framing");
    const trailer=new DataView(encoded.buffer,encoded.byteOffset+encoded.length-8,8);
    if(trailer.getUint32(4,true)!==value.decodedBytes)throw Error("E_FIGMA_INTEGRITY: gzip declared length changed");
    // Stream small compressed pieces so an untrusted decompression bomb cannot
    // allocate its entire expansion before the cumulative decoded bound runs.
    const pieces:Uint8Array[]=[],limit=value.decodedBytes;let size=0,finished=false;
    const stream=new Gunzip((piece,final)=>{
      size+=piece.length;if(size>limit)throw Error("E_FIGMA_LIMIT: exact decompression exceeds declared bytes");
      pieces.push(piece);finished=final;
    });
    stream.onmember=()=>{throw Error("E_FIGMA_INPUT: exact gzip must contain one member");};
    for(let offset=0;offset<encoded.length;offset+=512)
      stream.push(encoded.subarray(offset,offset+512),offset+512>=encoded.length);
    if(!finished||size!==limit)throw Error("E_FIGMA_INTEGRITY: incomplete exact compressed value");
    bytes=new Uint8Array(size);let offset=0;for(const piece of pieces){bytes.set(piece,offset);offset+=piece.length;}
    if(crc(bytes)!==trailer.getUint32(0,true))throw Error("E_FIGMA_INTEGRITY: gzip CRC changed");
  }
  if(bytes.length!==value.decodedBytes)throw Error("E_FIGMA_INTEGRITY: exact decoded length changed");
  const json=strFromU8(bytes),roundtrip=strToU8(json);
  if(roundtrip.length!==bytes.length||roundtrip.some((v,i)=>v!==bytes[i]))throw Error("E_FIGMA_INPUT: invalid exact UTF-8");
  try{return JSON.parse(json);}catch{throw Error("E_FIGMA_INPUT: incomplete exact JSON");}
}
