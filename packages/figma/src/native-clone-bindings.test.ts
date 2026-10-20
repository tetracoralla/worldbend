import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransformSpec } from "@worldbend/web/types";
import { clonedNativeGraph, rebindClonedNativeGraph } from "./native-clone-bindings";
import { nativeDocumentParts } from "./native-document";
import { nativeVectorDocumentParts } from "./native-vector-document";
import { nativeVectorFingerprint, serializeNativeVectorProjection } from "./native-vector";
import { readStoredBinding, writeStoredBinding } from "./stored-binding";
import { writeStoredOperation } from "./stored-operation";

const spec: TransformSpec = { schema: "worldbend.transform", version: "0.1", content: { fit: "stretch" },
  destination: { space: "normalized", quad: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } } } };
function fixture() {
  let next = 0; const nodes = new Map<string, Node>();
  class Node {
    id = String(++next); parent: Node | null = null; children: Node[] = []; removed = false;
    name = "Artwork"; x = 0; y = 0; width = 100; height = 80; clipsContent = true; layoutMode = "NONE";
    fills = []; strokes = []; effects: unknown[] = []; opacity = 1; blendMode = "PASS_THROUGH";
    visible = true; locked = false; isMask = false; maskType = "ALPHA"; constraints = { horizontal: "MIN", vertical: "MIN" };
    vectorNetwork = { vertices: [], segments: [], regions: [] }; shared = new Map<string, string>();
    constructor(readonly type: string) { nodes.set(this.id, this); }
    get relativeTransform() { return [[1, 0, this.x], [0, 1, this.y]]; }
    get absoluteTransform() { return this.relativeTransform; }
    append(node: Node) { this.children.push(node); node.parent = this; }
    getSharedPluginData(_namespace: string, key: string) { return this.shared.get(key) ?? ""; }
    setSharedPluginData(_namespace: string, key: string, value: string) { this.shared.set(key, value); }
    clone(): Node { const copy = new Node(this.type); Object.assign(copy, { name:this.name, x:this.x, y:this.y,
      width:this.width, height:this.height, vectorNetwork:structuredClone(this.vectorNetwork),
      fills:structuredClone(this.fills), strokes:structuredClone(this.strokes), opacity:this.opacity, blendMode:this.blendMode,
      shared: new Map(this.shared), effects: structuredClone(this.effects), clipsContent: this.clipsContent }); this.children.forEach(child => copy.append(child.clone())); return copy; }
  }
  const page = new Node("PAGE"); vi.stubGlobal("figma", { currentPage: page, getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null });
  return { Node, page };
}
afterEach(() => vi.unstubAllGlobals());

describe("Native scene dependency rebinding", () => {
  it.each([false,true])("rebinds every part when cloning a multi-part result, including an unadopted native duplicate: %s", async nativeCopy => {
    const {Node,page}=fixture(); const source=new Node("VECTOR"); let result=new Node("FRAME");
    page.append(source); page.append(result); result.clipsContent=false;
    const children=[new Node("VECTOR"),new Node("VECTOR")]; children.forEach(child=>result.append(child));
    writeStoredOperation(result as unknown as FrameNode,{kind:"transform",spec});
    writeStoredBinding(result as unknown as FrameNode,{sourceNodeIds:[source.id],renderWidth:100,renderHeight:80});
    result.setSharedPluginData("worldbend","nativeVector",serializeNativeVectorProjection({schema:"worldbend.figma.native-vector",version:"0.2",
      resultNodeId:result.id,sourceNodeId:source.id,outputSize:{width:100,height:80},placement:{x:0,y:0,width:100,height:80},
      operation:JSON.stringify(spec),fidelity:{class:"exact",reasons:[]},
      parts:children.map(child=>({contentNodeId:child.id,fingerprint:nativeVectorFingerprint(child as unknown as VectorNode)}))}));
    if(nativeCopy){result=result.clone();page.append(result);}
    const copy=result.clone();page.append(copy);
    const graph=clonedNativeGraph(result as unknown as SceneNode,copy as unknown as SceneNode);
    rebindClonedNativeGraph(graph.copies,graph.originals);
    const parts=await nativeVectorDocumentParts(copy as unknown as FrameNode);
    expect(parts.copied).toBe(false);
    expect(parts.record.parts.map(part=>part.contentNodeId)).toEqual(copy.children.map(child=>child.id));
    expect(parts.binding.sourceNodeIds).toEqual([source.id]);
  });
  it.each([false, true])("reopens a cloned shader graph when the source is already a Figma copy: %s", async copiedSource => {
    const { Node, page } = fixture(); let result = new Node("FRAME"); const surface = new Node("FRAME"), content = new Node("FRAME");
    page.append(result); result.append(surface); surface.append(content);
    const properties = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [String(index), 1]));
    surface.effects = [{ type: "SHADER", visible: true, id: "shader", properties }];
    writeStoredOperation(result as unknown as FrameNode, { kind: "transform", spec });
    writeStoredBinding(result as unknown as FrameNode, { sourceNodeIds: [content.id], renderWidth: 100, renderHeight: 80 });
    result.setSharedPluginData("worldbend", "native", JSON.stringify({ schema: "worldbend.figma.native", version: "0.2", resultNodeId: result.id,
      surfaceNodeId: surface.id, contentNodeId: content.id, shaderId: "shader", sourceSize: { width: 100, height: 80 }, outputSize: { width: 100, height: 80 },
      placement: { x: 0, y: 0, width: 100, height: 80 }, operation: JSON.stringify(spec), properties }));
    if (copiedSource) { result = result.clone(); page.append(result); }
    const before = result.getSharedPluginData("worldbend", "native"), copy = result.clone(); page.append(copy);
    const graph = clonedNativeGraph(result as unknown as SceneNode, copy as unknown as SceneNode);
    rebindClonedNativeGraph(graph.copies, graph.originals);
    const parts = await nativeDocumentParts(copy as unknown as FrameNode);
    expect(parts.copied).toBe(false); expect(parts.content.id).toBe(copy.children[0]!.children[0]!.id);
    expect(parts.binding.sourceNodeIds).toEqual([parts.content.id]);
    expect(result.getSharedPluginData("worldbend", "native")).toBe(before);
    const second = copy.clone(); page.append(second); const next = clonedNativeGraph(copy as unknown as SceneNode, second as unknown as SceneNode);
    rebindClonedNativeGraph(next.copies, next.originals);
    await expect(nativeDocumentParts(second as unknown as FrameNode)).resolves.toMatchObject({ copied: false });
  });

  it("reopens a scaled cloned native vector against its copied source without accepting an edited result", async () => {
    const { Node, page } = fixture(); const root = new Node("FRAME"), result = new Node("FRAME"), content = new Node("VECTOR"), source = new Node("VECTOR");
    page.append(root); root.append(source); root.append(result); result.append(content); result.clipsContent = false;
    writeStoredOperation(result as unknown as FrameNode, { kind: "transform", spec });
    writeStoredBinding(result as unknown as FrameNode, { sourceNodeIds: [source.id], renderWidth: 100, renderHeight: 80 });
    result.setSharedPluginData("worldbend", "nativeVector", JSON.stringify({ schema: "worldbend.figma.native-vector", version: "0.1", resultNodeId: result.id,
      contentNodeId: content.id, sourceNodeId: source.id, fingerprint: nativeVectorFingerprint(content as unknown as VectorNode),
      outputSize: { width: 100, height: 80 }, placement: { x: 0, y: 0, width: 100, height: 80 }, operation: JSON.stringify(spec) }));
    const copy = root.clone(); page.append(copy); const vector = copy.children[1]!; vector.width = 200; vector.height = 160; vector.children[0]!.x = 5;
    const graph = clonedNativeGraph(root as unknown as SceneNode, copy as unknown as SceneNode); rebindClonedNativeGraph(graph.copies, graph.originals);
    const parts = await nativeVectorDocumentParts(vector as unknown as FrameNode);
    expect(parts.record.outputSize).toEqual({ width: 200, height: 160 });
    expect(readStoredBinding(vector as unknown as FrameNode)?.sourceNodeIds).toEqual([copy.children[0]!.id]);
    content.name = "Edited outside Worldbend"; const stale = root.clone(); page.append(stale);
    const staleGraph = clonedNativeGraph(root as unknown as SceneNode, stale as unknown as SceneNode); rebindClonedNativeGraph(staleGraph.copies, staleGraph.originals);
    await expect(nativeVectorDocumentParts(stale.children[1] as unknown as FrameNode)).rejects.toThrow("Native vector result changed");
    expect(() => rebindClonedNativeGraph(staleGraph.copies, staleGraph.originals, id => staleGraph.copies.get(id), true)).toThrow(/damaged native vector/i);
  });
});
