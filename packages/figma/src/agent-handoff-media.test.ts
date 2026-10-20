import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as source from "./agent-handoff-media";

const bundled = new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-media.js", import.meta.url), "utf8")}\nreturn WorldbendFigmaMedia;`)() as typeof source;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture() {
  const data = new Map<string, string>([["worldbend:task", "published-recipe"]]);
  const page = { type: "PAGE", id: "page", parent: null };
  const node = { id: "result", type: "RECTANGLE", parent: page, removed: false, fills: [{ imageHash: "old-image" }],
    getSharedPluginData: (ns: string, key: string) => data.get(`${ns}:${key}`) ?? "",
    setSharedPluginData: (ns: string, key: string, value: string) => { if (value) data.set(`${ns}:${key}`, value); else data.delete(`${ns}:${key}`); },
  };
  const figma = { fileKey: "file", currentPage: page, getNodeByIdAsync: vi.fn(async () => node) };
  vi.stubGlobal("figma", figma);
  const scope = { fileKey: "file", pageId: "page", nodeId: node.id, transferId: "a".repeat(64) };
  const payload = { fileKey: "file", pageId: "page", nodeId: node.id, imageBase64: "x".repeat(60000), label: "新稿 🌀" };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  let hash = 2166136261;
  for (let i = 0; i < encoded.length; i++) hash = Math.imul(hash ^ encoded.charCodeAt(i), 16777619) >>> 0;
  const chunks = Array.from({ length: Math.ceil(encoded.length / 32768) }, (_, index) => ({ ...scope,
    count: Math.ceil(encoded.length / 32768), length: encoded.length, checksum: hash.toString(16).padStart(8, "0"),
    index, chunk: encoded.slice(index * 32768, (index + 1) * 32768),
  }));
  return { data, node, figma, scope, trustedScope:{...scope,payloadDigest:createHash("sha256").update(encoded).digest("hex")}, payload, chunks };
}

describe.each([ ["source", source], ["bundled", bundled] ] as const)("%s publication transport", (_name, media) => {
  it("binds UTF-8 payload bytes to the trusted digest, independently of editable transport metadata",async()=>{
    const f=fixture();for(const chunk of f.chunks)await media.stagePublicationChunk(chunk);
    const encoded=f.chunks.map(c=>c.chunk).join(""),scope={...f.scope,payloadDigest:createHash("sha256").update(encoded).digest("hex")};
    expect(await media.readPublication(scope)).toEqual(f.payload);
    for(const payloadDigest of ["", "bad", "0".repeat(64)])await expect(media.readPublication({...scope,payloadDigest})).rejects.toThrow("INTEGRITY");
    const changed=Buffer.from(JSON.stringify({...f.payload,label:"Substituted 🌀"})).toString("base64");
    let hash=2166136261;for(const byte of Buffer.from(changed))hash=Math.imul(hash^byte,16777619)>>>0;
    const meta=JSON.parse(f.data.get("worldbend:publication-transfer")!);
    Object.assign(meta,{count:Math.ceil(changed.length/32768),length:changed.length,checksum:hash.toString(16).padStart(8,"0")});
    f.data.set("worldbend:publication-transfer",JSON.stringify(meta));
    for(let i=0;i<meta.count;i++)f.data.set(`worldbend:publication-chunk-${i}`,changed.slice(i*32768,(i+1)*32768));
    const publish=vi.fn(async()=>({nodeId:f.node.id}));
    await expect(media.finishPublication(f.scope,publish)).rejects.toThrow("digest required");
    await expect(media.finishPublication(scope,publish)).rejects.toThrow("INTEGRITY");
    expect(publish).not.toHaveBeenCalled();expect(f.node.fills).toEqual([{imageHash:"old-image"}]);
    // Failed reads remain inspectable/cancellable; fresh bytes then succeed.
    await media.cancelPublication(scope);for(const chunk of f.chunks)await media.stagePublicationChunk(chunk);
    expect(await media.finishPublication(scope,publish)).toMatchObject({status:"published"});
  });
  it("resumes out of order and retries identical chunks without altering published pixels or recipe", async () => {
    const f = fixture();
    await media.stagePublicationChunk(f.chunks[1]!);
    await expect(media.readPublication(f.scope)).rejects.toThrow("incomplete");
    await media.stagePublicationChunk(f.chunks[0]!);
    await media.stagePublicationChunk(f.chunks[0]!);
    await media.stagePublicationChunk(f.chunks[2]!);
    expect(await media.readPublication(f.scope)).toEqual(f.payload);
    expect(f.node.fills).toEqual([{ imageHash: "old-image" }]);
    expect(f.data.get("worldbend:task")).toBe("published-recipe");
    await media.cancelPublication(f.scope);
    await media.cancelPublication(f.scope);
    expect([...f.data.keys()]).toEqual(["worldbend:task"]);
  });

  it("rejects another active transfer, changed retry bytes, corruption and wrong scope", async () => {
    const f = fixture();
    await media.stagePublicationChunk(f.chunks[0]!);
    await expect(media.stagePublicationChunk({ ...f.chunks[0]!, transferId: "b".repeat(64) })).rejects.toThrow("another");
    await expect(media.cancelPublication({ ...f.scope, transferId: "b".repeat(64) })).rejects.toThrow("another");
    await expect(media.stagePublicationChunk({ ...f.chunks[0]!, chunk: "a".repeat(32768) })).rejects.toThrow("chunk changed");
    for (const chunk of f.chunks.slice(1)) await media.stagePublicationChunk(chunk);
    f.data.set("worldbend:publication-chunk-0", "a".repeat(32768));
    await expect(media.readPublication(f.scope)).rejects.toThrow("corrupt");
    f.figma.fileKey = "other-file";
    await expect(media.cancelPublication(f.scope)).rejects.toThrow("SCOPE");
    expect(f.node.fills).toEqual([{ imageHash: "old-image" }]);
  });

  it("discovers a previous session's partial transfer without exposing media and safely cancels it", async () => {
    const f = fixture();
    const target = { fileKey: f.scope.fileKey, pageId: f.scope.pageId, nodeId: f.scope.nodeId };
    expect(await media.inspectPublication(target)).toEqual({ ...target, status: "empty" });
    await media.stagePublicationChunk(f.chunks[1]!);
    const state = await media.inspectPublication(target);
    expect(state).toMatchObject({ ...f.scope, status: "staging", chunkCount: 3, received: [1] });
    expect(JSON.stringify(state).length).toBeLessThan(1024);
    await expect(media.inspectPublication({ ...target, pageId: "wrong-page" })).rejects.toThrow("SCOPE");
    await expect(media.cancelPublication({ ...f.scope, transferId: "bad-id" })).rejects.toThrow("SCOPE");
    await media.cancelPublication(f.scope);
    expect(await media.inspectPublication(target)).toMatchObject({ status: "empty" });
    expect(f.node.fills).toEqual([{ imageHash: "old-image" }]);
  });

  it("expires partial staging, allows new transfer, and preserves the new transfer against old cancellation", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await media.stagePublicationChunk(f.chunks[0]!);
    vi.advanceTimersByTime(600001);
    expect(await media.inspectPublication(f.scope)).toMatchObject({ status: "expired" });
    await expect(media.readPublication(f.scope)).rejects.toThrow("expired");
    await media.stagePublicationChunk({ ...f.chunks[0]!, transferId: "b".repeat(64) });
    await expect(media.cancelPublication(f.scope)).rejects.toThrow("another");
    expect(f.data.get("worldbend:publication-transfer")).toContain("b".repeat(64));
  });

  it("rejects malformed chunks before writing and can cancel identified damaged manifests", async () => {
    const f = fixture();
    for (const input of [{ ...f.chunks[0]!, index: -1 }, { ...f.chunks[0]!, length: 0 },
      { ...f.chunks[0]!, count: 65 }, { ...f.chunks[0]!, chunk: "!".repeat(32768) }]) {
      await expect(media.stagePublicationChunk(input)).rejects.toThrow("INPUT");
    }
    expect([...f.data.keys()]).toEqual(["worldbend:task"]);
    f.data.set("worldbend:publication-transfer", JSON.stringify({ ...f.scope, count: "broken" }));
    await media.cancelPublication(f.scope);
    expect([...f.data.keys()]).toEqual(["worldbend:task"]);
  });

  it("returns publication failures after cleanup so the external host commits that cleanup", async () => {
    const f = fixture();
    for (const chunk of f.chunks) await media.stagePublicationChunk(chunk);
    const publish = vi.fn(async () => { throw Error("E_FIGMA_CONFLICT: result moved during transport"); });
    const receipt = await media.finishPublication(f.trustedScope, publish);
    expect(receipt).toMatchObject({ status: "failed", error: { code: "E_FIGMA_CONFLICT" }, requiresInspection: true });
    expect([...f.data.keys()]).toEqual(["worldbend:task"]);
    expect(f.node.fills).toEqual([{ imageHash: "old-image" }]);
    expect(publish).toHaveBeenCalledWith(f.payload,expect.objectContaining({validate:expect.any(Function),release:expect.any(Function)}));
    await media.stagePublicationChunk(f.chunks[0]!);
    await expect(media.finishPublication(f.trustedScope, publish)).rejects.toThrow("incomplete");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("returns the real published snapshot and clears all transport keys", async () => {
    const f = fixture();
    for (const chunk of f.chunks) await media.stagePublicationChunk(chunk);
    const receipt = await media.finishPublication(f.trustedScope, async () => {
      f.node.fills = [{ imageHash: "new-image" }];
      return { nodeId: f.node.id, revision: 2 };
    });
    expect(receipt).toMatchObject({ status: "published", snapshot: { nodeId: "result", revision: 2 } });
    expect([...f.data.keys()]).toEqual(["worldbend:task"]);
    await expect(media.finishPublication(f.trustedScope, vi.fn())).rejects.toThrow("missing");
    expect(f.node.fills).toEqual([{ imageHash: "new-image" }]);
  });
});
