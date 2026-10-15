declare function btoa(binary:string):string;
declare function atob(encoded:string):string;
export function byteBase64(bytes:Uint8Array):string {
  let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);
}
export function base64Bytes(data:string,maximum=2*1024*1024):Uint8Array {
  if(!data.length||data.length>maximum||data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error("E_FIGMA_INPUT: invalid bounded exact base64");
  const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
  if(byteBase64(bytes)!==data)throw Error("E_FIGMA_INPUT: noncanonical base64");return bytes;
}
export function exactUtf8(bytes:Uint8Array):string {
  let escaped="";for(const byte of bytes)escaped+=`%${byte.toString(16).padStart(2,"0")}`;
  try{return decodeURIComponent(escaped);}catch{throw Error("E_FIGMA_INPUT: invalid exact UTF-8");}
}
export function utf8Bytes(text:string):Uint8Array {
  const escaped=encodeURIComponent(text),bytes:number[]=[];
  for(let i=0;i<escaped.length;i++)if(escaped[i]==="%"){bytes.push(parseInt(escaped.slice(i+1,i+3),16));i+=2;}
  else bytes.push(escaped.charCodeAt(i));return Uint8Array.from(bytes);
}
