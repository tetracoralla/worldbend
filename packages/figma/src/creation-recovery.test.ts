import {afterEach,expect,it,vi} from "vitest";
import {recoverCreation} from "./creation-recovery";
afterEach(()=>vi.unstubAllGlobals());
it("shares an in-flight publication, rejects conflicting inputs, and releases a failed identity for retry",async()=>{
  vi.stubGlobal("figma",{});
  const page={id:"page",children:[]} as unknown as PageNode;
  const accepts=(node:SceneNode):node is FrameNode=>node.type==="FRAME";
  let reject!:(error:Error)=>void;
  const create=vi.fn(()=>new Promise<FrameNode>((_resolve,fail)=>{reject=fail;}));
  const first=recoverCreation(page,"same","nativeCreation","input-A",accepts,create);
  const second=recoverCreation(page,"same","nativeCreation","input-A",accepts,create);
  expect(second).toBe(first);expect(create).toHaveBeenCalledTimes(1);
  expect(()=>recoverCreation(page,"same","nativeCreation","input-B",accepts,create)).toThrow("CONFLICT");
  reject(Error("publication failed"));await expect(first).rejects.toThrow("publication failed");
  const result={id:"retry",type:"FRAME"} as FrameNode;
  await expect(recoverCreation(page,"same","nativeCreation","input-A",accepts,async()=>result)).resolves.toBe(result);
});

it("reserves page capacity across different asynchronous creations and releases it after failure", async () => {
  vi.stubGlobal("figma", { fileKey: "file" });
  const page = { id: "page", children: Array.from({ length: 19998 }, (_, i) => ({
    id: `existing-${i}`, type: "RECTANGLE", removed: false,
  })) } as unknown as PageNode;
  const accepts = (node: SceneNode): node is FrameNode => node.type === "FRAME";
  let fail!: (error: Error) => void;
  const first = recoverCreation(page, "first", "nativeCreation", "input", accepts,
    () => new Promise<FrameNode>((_, reject) => { fail = reject; }), 2);
  const create = vi.fn(async () => ({ id: "second", type: "FRAME" }) as FrameNode);
  expect(() => recoverCreation(page, "second", "nativeCreation", "input", accepts, create, 1)).toThrow("recoverable page budget");
  expect(create).not.toHaveBeenCalled();
  expect(recoverCreation(page, "first", "nativeCreation", "input", accepts, create, 2)).toBe(first);
  fail(Error("cancelled"));
  await expect(first).rejects.toThrow("cancelled");
  await expect(recoverCreation(page, "second", "nativeCreation", "input", accepts, create, 2)).resolves.toMatchObject({ id: "second" });
});

it("keeps pending capacity and creation identities scoped to the current file and page", async () => {
  const host = { fileKey: "first-file" };
  vi.stubGlobal("figma", host);
  const page = { id: "page", children: [] } as unknown as PageNode;
  const accepts = (node: SceneNode): node is FrameNode => node.type === "FRAME";
  let finish!: (node: FrameNode) => void;
  const first = recoverCreation(page, "same", "nativeCreation", "same", accepts,
    () => new Promise<FrameNode>(resolve => { finish = resolve; }), 20000);
  const create = vi.fn(async () => ({ id: "other", type: "FRAME" }) as FrameNode);
  await expect(recoverCreation({ ...page, id: "other-page" } as PageNode, "other", "nativeCreation", "same", accepts, create, 1)).resolves.toMatchObject({ id: "other" });
  host.fileKey = "second-file";
  await expect(recoverCreation(page, "same", "nativeCreation", "same", accepts, create, 1)).resolves.toMatchObject({ id: "other" });
  finish({ id: "first", type: "FRAME" } as FrameNode);
  await first;
  expect(create).toHaveBeenCalledTimes(2);
});
