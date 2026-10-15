/** Opaque receiving identity. getRandomValues also exists in sandboxed Figma
 * frames where secure-context-only randomUUID is deliberately unavailable. */
export function receivingInstanceId(crypto: Pick<Crypto,"getRandomValues">):string {
  if(typeof crypto?.getRandomValues!=="function")
    throw Error("This browser cannot start this receiving view. Reopen the work in a supported browser.");
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  return "worldbend-"+Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");
}
