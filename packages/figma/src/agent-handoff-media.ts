/** Bounded, resumable transport only. Visible publication still belongs to
 * the shared guarded publishers; staging never changes artwork or its recipe. */
import { sha256Hex } from "../../web/src/sha256";
import {decodeExactJson,MAX_EXACT_JSON_BYTES} from "./exact-json-codec";
const NAMESPACE = "worldbend";
const META = "publication-transfer";
const CHUNK = "publication-chunk-";
const MAX_CHUNKS = 64;
const CHUNK_LENGTH = 32768;
const TTL = 10 * 60 * 1000;
const RUNTIME_META = "publication-runtime";
const RUNTIME_CHUNK = "publication-runtime-chunk-";
const MAX_RUNTIME_BYTES = 128 * 1024;
const MAX_RUNTIME_ENCODED = Math.ceil(MAX_RUNTIME_BYTES / 3) * 4;
const MAX_RUNTIME_CHUNKS = Math.ceil(MAX_RUNTIME_ENCODED / CHUNK_LENGTH);

type TargetScope = { fileKey: string; pageId: string; nodeId: string };
type Scope = TargetScope & { transferId: string; payloadDigest?: string };
type Manifest = Scope & { count: number; length: number; checksum: string; expiresAt: number; leaseId?: string };
type RuntimeManifest = Scope & { count:number; length:number; digest:string };

async function target(scope: TargetScope): Promise<RectangleNode | FrameNode> {
  const node = await figma.getNodeByIdAsync(scope.nodeId);
  validateTarget(node, scope);
  return node as RectangleNode | FrameNode;
}

function validateTarget(node: BaseNode | null, scope: TargetScope) {
  let page: BaseNode | null = node;
  while (page && page.type !== "PAGE") page = page.parent;
  if (figma.fileKey !== scope.fileKey || figma.currentPage.id !== scope.pageId ||
    (!node || (node.type !== "RECTANGLE" && !(node.type === "FRAME" &&
      (node.getSharedPluginData(NAMESPACE,"nativeVector") || node.getSharedPluginData(NAMESPACE,"vectorCreation"))))) ||
    node.removed || page?.id !== scope.pageId) {
    throw Error("E_FIGMA_SCOPE: target unavailable on the granted page");
  }
}

function validateTransfer(scope: Scope) {
  if (!/^[a-f0-9]{64}$/.test(scope.transferId)) throw Error("E_FIGMA_SCOPE: invalid transfer identity");
}

function manifest(node: RectangleNode | FrameNode): Manifest | undefined {
  const raw = node.getSharedPluginData(NAMESPACE, META);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Manifest;
    if (typeof value.fileKey === "string" && typeof value.pageId === "string" &&
      typeof value.nodeId === "string" && /^[a-f0-9]{64}$/.test(value.transferId) &&
      Number.isSafeInteger(value.count) && value.count >= 1 && value.count <= MAX_CHUNKS &&
      Number.isSafeInteger(value.length) && value.length > 0 && value.length <= MAX_CHUNKS * CHUNK_LENGTH &&
      value.count === Math.ceil(value.length / CHUNK_LENGTH) && /^[a-f0-9]{8}$/.test(value.checksum) &&
      Number.isSafeInteger(value.expiresAt) && (value.leaseId === undefined ||
        (typeof value.leaseId === "string" && /^[a-f0-9]{32}$/.test(value.leaseId)))) return value;
  } catch { /* Corrupt staging must not silently overwrite another transfer. */ }
  throw Error("E_FIGMA_STATE: unreadable transfer; cancel before retrying");
}

function clear(node: RectangleNode | FrameNode) {
  // Every key is owned by this transport; do not remove any other plugin data.
  for (let i = 0; i < MAX_CHUNKS; i++) node.setSharedPluginData(NAMESPACE, `${CHUNK}${i}`, "");
  node.setSharedPluginData(NAMESPACE, META, "");
  node.setSharedPluginData(NAMESPACE, "vectorPublicationGuard", "");
  for(let i=0;i<MAX_RUNTIME_CHUNKS;i++)node.setSharedPluginData(NAMESPACE,`${RUNTIME_CHUNK}${i}`,"");
  node.setSharedPluginData(NAMESPACE,RUNTIME_META,"");
}

function runtimeManifest(node:RectangleNode|FrameNode):RuntimeManifest|undefined {
  const raw=node.getSharedPluginData(NAMESPACE,RUNTIME_META);if(!raw)return undefined;
  try {
    if(raw.length>4096)throw Error();
    const value=JSON.parse(raw) as RuntimeManifest;
    if(Number.isSafeInteger(value.count)&&value.count>=1&&value.count<=MAX_RUNTIME_CHUNKS&&
      Number.isSafeInteger(value.length)&&value.length>0&&value.length<=MAX_RUNTIME_ENCODED&&
      value.count===Math.ceil(value.length/CHUNK_LENGTH)&&/^[a-f0-9]{64}$/.test(value.digest))return value;
  }catch{ /* Cancellation remains available for corrupt runtime transport. */ }
  throw Error("E_FIGMA_STATE: invalid runtime transport; cancel before retrying");
}

/** Only the source server prepares these chunks. Staging never executes them. */
export async function stageRuntimeChunk(input:RuntimeManifest & {index:number;chunk:string}) {
  validateTransfer(input);const node=await target(input),active=manifest(node);
  if(!active||!sameScope(active,input)||active.expiresAt<=Date.now())throw Error("E_FIGMA_STATE: publication transfer missing or expired");
  if(!Number.isSafeInteger(input.count)||input.count<1||input.count>MAX_RUNTIME_CHUNKS||
    !Number.isSafeInteger(input.length)||input.length<1||input.length>MAX_RUNTIME_ENCODED||
    input.count!==Math.ceil(input.length/CHUNK_LENGTH)||!Number.isSafeInteger(input.index)||input.index<0||input.index>=input.count||
    !/^[a-f0-9]{64}$/.test(input.digest)||input.chunk.length!==Math.min(CHUNK_LENGTH,input.length-input.index*CHUNK_LENGTH)||
    !/^[A-Za-z0-9+/=]+$/.test(input.chunk))throw Error("E_FIGMA_INPUT: invalid runtime chunk");
  const saved=runtimeManifest(node);
  if(saved&&(!sameScope(saved,input)||saved.digest!==input.digest||saved.count!==input.count||saved.length!==input.length))throw Error("E_FIGMA_CONFLICT: different runtime transport");
  const key=`${RUNTIME_CHUNK}${input.index}`,previous=node.getSharedPluginData(NAMESPACE,key);
  if(previous&&previous!==input.chunk)throw Error("E_FIGMA_CONFLICT: runtime chunk changed");
  if(!saved)node.setSharedPluginData(NAMESPACE,RUNTIME_META,JSON.stringify({fileKey:input.fileKey,pageId:input.pageId,nodeId:input.nodeId,transferId:input.transferId,count:input.count,length:input.length,digest:input.digest}));
  node.setSharedPluginData(NAMESPACE,key,input.chunk);
  return {transferId:input.transferId,stagedRuntimeIndex:input.index,count:input.count,affectedNodeIds:[node.id]};
}

/** The expected digest and method come from the trusted prepared request,
 * independently of every editable document field and publication argument. */
export async function executeTrustedRuntime(input:Scope & {digest:string;method:string}) {
  validateTransfer(input);const node=await target(input),active=manifest(node),saved=runtimeManifest(node);
  if(!active||!sameScope(active,input)||active.expiresAt<=Date.now()||!saved||!sameScope(saved,input)||
    !/^[a-f0-9]{64}$/.test(input.digest)||saved.digest!==input.digest||!/^[$A-Za-z_][$A-Za-z0-9_]{0,127}$/.test(input.method))throw Error("E_FIGMA_STATE: trusted runtime missing, expired or mismatched");
  let encoded="";
  for(let index=0;index<saved.count;index++) {
    const chunk=node.getSharedPluginData(NAMESPACE,`${RUNTIME_CHUNK}${index}`);
    if(chunk.length!==Math.min(CHUNK_LENGTH,saved.length-index*CHUNK_LENGTH))throw Error("E_FIGMA_STATE: runtime incomplete; resume chunks");
    encoded+=chunk;
  }
  // Reuse the already verified ASCII SHA-256 implementation. Base64 binds the
  // complete UTF-8 source while remaining independent of host crypto APIs.
  if(sha256Hex(encoded)!==input.digest)throw Error("E_FIGMA_INTEGRITY: runtime bytes differ from trusted source");
  const binary=atob(encoded);if(binary.length>MAX_RUNTIME_BYTES)throw Error("E_FIGMA_LIMIT: runtime source too large");
  const code=decodeURIComponent(Array.from(binary,c=>`%${c.charCodeAt(0).toString(16).padStart(2,"0")}`).join(""));
  const originalTransfer=node.getSharedPluginData(NAMESPACE,META),originalRuntime=node.getSharedPluginData(NAMESPACE,RUNTIME_META);
  const library=Function("figma",`${code}\nreturn WorldbendFigmaHandoff;`)(figma) as Record<string,unknown>;
  if(!library||!Object.prototype.hasOwnProperty.call(library,input.method)||typeof library[input.method]!=="function")throw Error("E_FIGMA_STATE: runtime method unavailable");
  try { return await (library[input.method] as (scope:Scope)=>Promise<unknown>)(input); }
  finally {
    // Do not clear a replacement payload/runtime while a native write awaited.
    // Finalizers may already have released their whole original transfer.
    if(!node.removed&&node.getSharedPluginData(NAMESPACE,META)===originalTransfer&&
      node.getSharedPluginData(NAMESPACE,RUNTIME_META)===originalRuntime){
      for(let i=0;i<saved.count;i++)node.setSharedPluginData(NAMESPACE,`${RUNTIME_CHUNK}${i}`,"");
      node.setSharedPluginData(NAMESPACE,RUNTIME_META,"");
    }
  }
}

function sameTarget(a: TargetScope | Record<string, unknown>, b: TargetScope) {
  return a.fileKey === b.fileKey && a.pageId === b.pageId && a.nodeId === b.nodeId;
}

function sameScope(a: Scope, b: Scope) {
  return sameTarget(a, b) && a.transferId === b.transferId;
}

export interface PublicationLease {
  readonly leaseId: string;
  readonly expiresAt: number;
  validate(): void;
  release(): void;
}

/** Capture one staging incarnation, not just its reusable transfer id. The
 * callbacks remain synchronous at the final visible write and never clear a
 * replacement transfer, even when it reused the same id/clock/payload. */
export async function publicationLease(scope: Scope): Promise<PublicationLease> {
  validateTransfer(scope);
  const node = await target(scope), active = manifest(node);
  if (!active || !sameScope(active, scope) || active.expiresAt <= Date.now() || !active.leaseId) {
    throw Error("E_FIGMA_STATE: publication lease missing or expired; cancel and restage");
  }
  const original = node.getSharedPluginData(NAMESPACE, META);
  const chunks = Array.from({ length: active.count }, (_, i) => node.getSharedPluginData(NAMESPACE, `${CHUNK}${i}`));
  return { leaseId: active.leaseId, expiresAt: active.expiresAt,
    validate() {
      validateTarget(node, scope);
      if (active.expiresAt <= Date.now() || node.getSharedPluginData(NAMESPACE, META) !== original ||
        chunks.some((chunk, i) => node.getSharedPluginData(NAMESPACE, `${CHUNK}${i}`) !== chunk)) {
        throw Error("E_FIGMA_CONFLICT: publication cancelled, expired or replaced; restage");
      }
    },
    release() {
      // No await or scope lookup: cleanup owns this exact node/incarnation.
      // A missing, moved, corrupt or newly leased transfer is not ours to clear.
      if (!node.removed && node.getSharedPluginData(NAMESPACE, META) === original) clear(node);
    },
  };
}

/** Discover transport state after the preparing Agent session has ended.
 * Payload bytes remain private to transport; callers receive only bounded state. */
export async function inspectPublication(scope: TargetScope) {
  const node = await target(scope);
  const active = manifest(node);
  if (!active) return { ...scope, status: "empty" as const };
  if (!sameTarget(active, scope)) {
    throw Error("E_FIGMA_SCOPE: transfer belongs to another target");
  }
  const received = [];
  for (let i = 0; i < active.count; i++) {
    if (node.getSharedPluginData(NAMESPACE, `${CHUNK}${i}`).length ===
      Math.min(CHUNK_LENGTH, active.length - i * CHUNK_LENGTH)) received.push(i);
  }
  return { ...scope, transferId: active.transferId,
    status: active.expiresAt <= Date.now() ? "expired" as const : "staging" as const,
    chunkCount: active.count, received, expiresAt: active.expiresAt };
}

/** Retry a chunk verbatim, resume in any order, or replace an expired transfer. */
export async function stagePublicationChunk(input: Scope & {
  count: number; length: number; checksum: string; index: number; chunk: string;
}) {
  validateTransfer(input);
  if (!Number.isSafeInteger(input.length) || input.length < 1 || input.length > MAX_CHUNKS * CHUNK_LENGTH ||
    input.count !== Math.ceil(input.length / CHUNK_LENGTH) || !Number.isSafeInteger(input.index) ||
    input.index < 0 || input.index >= input.count || !/^[a-f0-9]{8}$/.test(input.checksum) ||
    typeof input.chunk !== "string" || !/^[A-Za-z0-9+/=]+$/.test(input.chunk) ||
    input.chunk.length !== Math.min(CHUNK_LENGTH, input.length - input.index * CHUNK_LENGTH)) {
    throw Error("E_FIGMA_INPUT: invalid publication chunk");
  }
  const node = await target(input);
  let active = manifest(node);
  if (active && active.expiresAt <= Date.now()) { clear(node); active = undefined; }
  if (active && (!sameScope(active, input) || active.count !== input.count ||
    active.length !== input.length || active.checksum !== input.checksum)) {
    throw Error("E_FIGMA_CONFLICT: another transfer is active");
  }
  if (!active) clear(node);
  const key = `${CHUNK}${input.index}`;
  const previous = node.getSharedPluginData(NAMESPACE, key);
  if (previous && previous !== input.chunk) throw Error("E_FIGMA_CONFLICT: publication chunk changed");
  if (!active) {
    const next: Manifest = { fileKey: input.fileKey, pageId: input.pageId, nodeId: input.nodeId,
      transferId: input.transferId, count: input.count, length: input.length,
      checksum: input.checksum, expiresAt: Date.now() + TTL,
      leaseId: Array.from({length:4},()=>Math.floor(Math.random()*0x100000000).toString(16).padStart(8,"0")).join("") };
    node.setSharedPluginData(NAMESPACE, META, JSON.stringify(next));
  }
  node.setSharedPluginData(NAMESPACE, key, input.chunk);
  return { transferId: input.transferId, stagedIndex: input.index, count: input.count, affectedNodeIds: [node.id] };
}

/** Read complete transport bytes. Integrity is an accidental-corruption check,
 * not authorization: the normal publisher still verifies the current result. */
export async function readPublication(scope: Scope): Promise<Record<string, unknown>> {
  validateTransfer(scope);
  const node = await target(scope);
  const active = manifest(node);
  if (!active || !sameScope(active, scope) || active.expiresAt <= Date.now()) {
    throw Error("E_FIGMA_STATE: transfer missing or expired");
  }
  let encoded = "";
  for (let i = 0; i < active.count; i++) {
    const chunk = node.getSharedPluginData(NAMESPACE, `${CHUNK}${i}`);
    if (chunk.length !== Math.min(CHUNK_LENGTH, active.length - i * CHUNK_LENGTH)) {
      throw Error("E_FIGMA_STATE: transfer incomplete; resume its chunks");
    }
    encoded += chunk;
  }
  let hash = 2166136261;
  for (let i = 0; i < encoded.length; i++) hash = Math.imul(hash ^ encoded.charCodeAt(i), 16777619) >>> 0;
  if (hash.toString(16).padStart(8, "0") !== active.checksum) throw Error("E_FIGMA_STATE: transfer is corrupt");
  // Expected SHA comes from trusted prepared code, never editable document
  // metadata. The mutable checksum above only detects accidental corruption.
  if (scope.payloadDigest !== undefined && (!/^[a-f0-9]{64}$/.test(scope.payloadDigest) ||
    sha256Hex(encoded) !== scope.payloadDigest)) throw Error("E_FIGMA_INTEGRITY: publication bytes differ from the prepared payload");
  let value: Record<string, unknown>;
  try {
    const binary = atob(encoded);
    if(binary.charCodeAt(0)===31&&binary.charCodeAt(1)===139){
      if(binary.length<18)throw Error("incomplete gzip");
      const n=binary.length,decodedBytes=(binary.charCodeAt(n-4)|(binary.charCodeAt(n-3)<<8)|(binary.charCodeAt(n-2)<<16)|(binary.charCodeAt(n-1)<<24))>>>0;
      if(decodedBytes>MAX_EXACT_JSON_BYTES)throw Error("decoded capacity");
      value=decodeExactJson({encoding:"gzip-base64",decodedBytes,digest:scope.payloadDigest??sha256Hex(encoded),data:encoded}) as Record<string,unknown>;
    }else{
      let escaped = "";
      for (let i = 0; i < binary.length; i++) escaped += `%${binary.charCodeAt(i).toString(16).padStart(2, "0")}`;
      value = JSON.parse(decodeURIComponent(escaped)) as Record<string, unknown>;
    }
  } catch { throw Error("E_FIGMA_STATE: unreadable publication payload"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || !sameTarget(value, scope)) {
    throw Error("E_FIGMA_SCOPE: payload scope changed");
  }
  return value;
}

export async function cancelPublication(scope: Scope) {
  validateTransfer(scope);
  const node = await target(scope);
  const raw = node.getSharedPluginData(NAMESPACE, META);
  if (raw) {
    let active: Scope;
    try { active = JSON.parse(raw) as Scope; }
    catch { throw Error("E_FIGMA_STATE: cannot identify unreadable transfer"); }
    if (!sameScope(active, scope)) throw Error("E_FIGMA_CONFLICT: another transfer is active");
  }
  clear(node);
  return { transferId: scope.transferId, cancelled: true, affectedNodeIds: [node.id] };
}

/** Figma's external interface rolls a script's writes back when it throws.
 * A publication conflict therefore returns a failed receipt after cleanup,
 * rather than throwing and rolling that cleanup back too. Incomplete reads
 * still throw before publication so their chunks can resume. */
export async function finishPublication<Snapshot extends { nodeId: string }>(
  scope: Scope,
  publish: (input: Record<string, unknown>, lease: PublicationLease) => Promise<Snapshot>,
  successStatus:"published"|"captured"|"initialized"="published",
) {
  if(typeof scope.payloadDigest!=="string"||!/^[a-f0-9]{64}$/.test(scope.payloadDigest)) {
    throw Error("E_FIGMA_INTEGRITY: prepared publication payload digest required");
  }
  const lease = await publicationLease(scope);
  const input = await readPublication(scope);
  lease.validate();
  const receipt = { schema: "worldbend.figma.publication-receipt" as const, version: "0.1" as const,
    fileKey:scope.fileKey,pageId:scope.pageId,nodeId:scope.nodeId,transferId:scope.transferId,affectedNodeIds: [scope.nodeId] };
  let snapshot: Snapshot;
  try {
    snapshot = await publish(input, lease);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1024);
    const code = /^E_[A-Z_]+(?=:|$)/.exec(message)?.[0] ?? "E_FIGMA_PUBLICATION";
    lease.release();
    return { ...receipt, status: "failed" as const, error: { code, message }, requiresInspection: true as const };
  }
  lease.release();
  return { ...receipt,status:successStatus,snapshot };
}
