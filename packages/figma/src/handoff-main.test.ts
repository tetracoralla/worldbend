import {installNativeTestBasis} from "./native-capture-test-host";
import { readFileSync } from "node:fs";
import {createHash} from "node:crypto";
import * as publicationMedia from "./agent-handoff-media";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStoredBinding, writeStoredBinding } from "./stored-binding";
import { readStoredOperation, writeStoredOperation } from "./stored-operation";
import { publishNativeResult, nativeDocumentParts, restoreNativeProjection } from "./native-document";
import { nativeShaderProperties } from "./native-projective";
import { nativeVectorDocumentParts } from "./native-vector-document";
import { planVectorProjection } from "@worldbend/web";
import { createMeshSpec } from "./mesh-workspace";
import { continuedCompositionTask, type FigmaSpatialEffectTask } from "./stored-designer-task";
import type { MockupSpecInput } from "@worldbend/web/types";
import { READY_SCENE_IDS } from "./ready-scenes";

// Exercise the exact script embedded in MCP as well as its TypeScript source.
// Bundler upgrades can change this carrier independently of source tests.
async function loadAgentHandoff(entry: "source" | "bundled"): Promise<typeof import("./agent-handoff") & typeof import("./agent-scene-create") & typeof import("./agent-effect-create") & typeof import("./agent-native-create")> {
  if (entry === "source") return { ...await import("./agent-handoff"), ...await import("./agent-scene-create"), ...await import("./agent-effect-create"), ...await import("./agent-native-create") };
  // Prepared requests embed one runtime variant per call family; the bundled
  // fixture merges the families and dispatches the exact selected-scene
  // variant, matching Rust preparation rather than embedding a full catalog.
  const publishers = readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime.js", import.meta.url), "utf8");
  const transform = readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-transform.js", import.meta.url), "utf8");
  const images = readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-image-publishers.js", import.meta.url), "utf8");
  const materials = readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-materials.js", import.meta.url), "utf8");
  const scenes = readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-scenes.js", import.meta.url), "utf8");
  const creation = readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-scene-create.js", import.meta.url), "utf8");
  const readyCreation = Object.fromEntries(READY_SCENE_IDS.map(id => {
    const code = readFileSync(new URL(`../../../crates/worldbend-mcp/src/figma-runtime-scene-ready-create-${id}.js`, import.meta.url), "utf8");
    return [id, new Function(`${code}\nreturn WorldbendFigmaHandoff;`)()];
  }));
  const effects = readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-effect-create.js", import.meta.url), "utf8");
  const sourceSets = readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-effect-sources.js", import.meta.url), "utf8");
  const nativeCreation = readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-native-create.js", import.meta.url), "utf8");
  return new Function("readyCreation", `${transform}\nconst transform = WorldbendFigmaHandoff;\n${publishers}\nconst publishers = WorldbendFigmaHandoff;\n${images}\nconst images = WorldbendFigmaHandoff;\n${materials}\nconst materials = WorldbendFigmaHandoff;\n${scenes}\nconst scenes = WorldbendFigmaHandoff;\n${creation}\nconst creation = WorldbendFigmaHandoff;\n${effects}\nconst effects = WorldbendFigmaHandoff;\n${sourceSets}\nconst sourceSets = WorldbendFigmaHandoff;\n${nativeCreation}\nreturn { ...transform, ...publishers, ...images, ...materials, ...scenes, ...effects, ...sourceSets, ...WorldbendFigmaHandoff, createScene: input => (input.scene.kind === 'ready' ? readyCreation[input.scene.id] : creation).createScene(input) };`)(readyCreation);
}
async function loadNativeDocumentFrame(entry:"source"|"bundled") {
  if(entry==="source")return {...await import("./agent-native-continuation-frame"),...await import("./agent-native-continuation-revise-frame")};
  const read=readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-native-continuation-frame.js",import.meta.url),"utf8");
  const revise=readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-native-continuation-revise-frame.js",import.meta.url),"utf8");
  return new Function(`${read}\nconst read=WorldbendFigmaHandoff;\n${revise}\nreturn {...read,...WorldbendFigmaHandoff};`)();
}

const spec = {
  schema: "worldbend.transform" as const, version: "0.1" as const,
  destination: { space: "normalized" as const, quad: {
    tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
  } }, content: { fit: "stretch" as const },
};
const renderer = { id: `sampler/${"a".repeat(40)}`, propertyIds: Array.from({ length: 9 }, (_, i) => String(i)), extentPropertyIds: ["9", "10"] as [string, string] };

function spatialTask(pointerX = 0): FigmaSpatialEffectTask {
  const viewport = { width: 600, height: 400 };
  return {
    kind: "effect" as const,
    recipe: {
      schema: "worldbend.effect-recipe" as const, version: "3" as const,
      origin: { effect: "multiplane-camera" as const, version: "3" as const, viewport, intensity: .8 },
      viewport,
      camera: { focalLength: 1320, focusDistance: 1000, travel: { x: 48, y: 32 } },
      appearance: { depthOfField: { focusDistance: 1000, focusRange: 300, maxBlurRadius: 12 }, motionBlur: { exposureFraction: .65, maxBlurRadius: 24 } },
      layers: [
        { id: "background", offset: { x: -60, y: -40 }, surface: { kind: "camera-plane" as const, size: { width: 720, height: 480 }, distance: 1500 }, tracks: [] },
        { id: "middle", offset: { x: -60, y: -40 }, surface: { kind: "camera-plane" as const, size: { width: 720, height: 480 }, distance: 1000 }, tracks: [] },
        { id: "foreground", offset: { x: -60, y: -40 }, surface: { kind: "camera-plane" as const, size: { width: 720, height: 480 }, distance: 650 }, tracks: [] },
      ],
    },
    state: { progress: 1, pointerX, pointerY: 0, reducedMotion: false },
  };
}

function mockupTask(opacity = 1): { kind: "mockup"; spec: MockupSpecInput } {
  return { kind: "mockup", spec: {
    schema: "worldbend.mockup", version: "0.1", canvas: { width: 600, height: 400 },
    background: { kind: "transparent" }, seams: [],
    planes: [
      { id: "artwork", sourceId: "source-1", transform: structuredClone(spec), opacity },
      { id: "scene", sourceId: "source-2", transform: structuredClone(spec), opacity: 1 },
    ],
  } };
}

/**
 * Mirrors the installed host's strict effect validation for the effect types
 * the handoff runtime writes (aligned with texture.test.ts). The real host
 * rejected an appended NOISE color without its alpha channel on 2026-10-01;
 * validating here keeps a stale handoff bundle from passing bundled tests.
 */
function assertHostEffectShape(effect: any): void {
  if (effect.type === "NOISE") {
    const color = effect.color;
    if (!color || ![color.r, color.g, color.b, color.a].every((channel: unknown) => typeof channel === "number")) {
      throw new Error("mock host rejected effect: NOISE color must be complete RGBA");
    }
  } else if (effect.type === "TEXTURE") {
    if (typeof effect.noiseSize !== "number" || typeof effect.radius !== "number" ||
        typeof effect.clipToShape !== "boolean") {
      throw new Error("mock host rejected effect: TEXTURE requires noiseSize, radius and clipToShape");
    }
  }
}

function host() {
  const registry = new Map<string, any>();
  const handlers = new Map<string, (...args: any[]) => void>();
  const pageHandlers = new Map<string, (...args: any[]) => void>();
  const posts: any[] = [];
  let nextId = 1;
  const pageShared=new Map<string,string>([["worldbend:nativeRenderer",JSON.stringify({schema:"worldbend.figma.projective-sampler",version:"0.1",id:renderer.id})]]);
  const page: any = { findAll: (predicate: (node: any) => boolean) => page.children.filter(predicate), id: "page", type: "PAGE", parent: null, selection: [], children: [],
    appendChild: vi.fn((child: any) => {
      if(child.parent?.children)child.parent.children=child.parent.children.filter((n:any)=>n!==child);
      child.parent=page;page.children.push(child);
    }),
    on: (name: string, fn: (...args: any[]) => void) => pageHandlers.set(name, fn), off: vi.fn(),
    getSharedPluginData: (ns:string,key:string)=>pageShared.get(`${ns}:${key}`)??"",
    setSharedPluginData: (ns:string,key:string,value:string)=>pageShared.set(`${ns}:${key}`,value),
  };
  registry.set(page.id, page);
  function frame(): any {
    const shared = new Map<string, string>();
    const privateData = new Map<string, string>();
    let effects: any[] = [];
    const node: any = {
      id: `node-${nextId++}`, type: "FRAME", name: "Card", visible: true, removed: false,
      width: 520, height: 606, x: 0, y: 0, parent: page, children: [], fills: [], strokes: [],
      opacity: 1, blendMode: "PASS_THROUGH", clipsContent: true,
      constraints: { horizontal: "MIN", vertical: "MIN" }, layoutMode: "NONE",
      resolvedVariableModes: {}, explicitVariableModes: {},
      relativeTransform: [[1, 0, 0], [0, 1, 0]], absoluteTransform: [[1, 0, 0], [0, 1, 0]],
      get absoluteBoundingBox() { return { x: node.x, y: node.y, width: node.width, height: node.height }; },
      resize: vi.fn((width: number, height: number) => {
        // Figma applies child constraints recursively. A width/height-only
        // stub concealed mutations of the supposedly untouched Content.
        for (const child of node.children) {
          for (const [axis, position, constraint] of [["width", "x", "horizontal"], ["height", "y", "vertical"]] as const) {
            const next = axis === "width" ? width : height;
            if (child.constraints[constraint] === "CENTER") child[position] += (next - node[axis]) / 2;
            if (child.constraints[constraint] === "SCALE") {
              child[position] *= next / node[axis]; child[axis] *= next / node[axis];
            }
          }
        }
        node.width = width; node.height = height;
      }),
    resizeWithoutConstraints: vi.fn((width: number, height: number) => { node.width = width; node.height = height; }),
      rescale: vi.fn((scale: number) => { node.width *= scale; node.height *= scale; }),
      getSharedPluginData: (ns: string, key: string) => shared.get(`${ns}:${key}`) ?? "",
      getSharedPluginDataKeys: (ns: string) => [...shared.keys()].filter(key=>key.startsWith(ns+":" )).map(key=>key.slice(ns.length+1)),
      setSharedPluginData: vi.fn((ns: string, key: string, value: string) => { shared.set(`${ns}:${key}`, value); }),
      getPluginData: (key: string) => privateData.get(key) ?? "",
      setPluginData: (key: string, value: string) => privateData.set(key, value),
      setRelaunchData: vi.fn(),
      manualKeyframeTracks: {}, animationStyles: [], timelines: [],
      applyManualKeyframeTrack: vi.fn((field:KeyframeField,input:ManualKeyframeTrackInput)=>{
        const keyframes=input.keyframes.map(keyframe=>({id:keyframe.id??`key-${nextId++}`,timelinePosition:keyframe.timelinePosition,
          easing:structuredClone(keyframe.easing??{type:"LINEAR"}),value:structuredClone(keyframe.value)}));
        const binding={id:input.id??`track-${nextId++}`,baseValue:structuredClone(input.baseValue??{type:"FLOAT",value:0}),keyframes};
        if(field.type==="PROPERTY")node.manualKeyframeTracks[field.name]=binding;
        else {
          const collection=node.manualKeyframeTracks[field.collection]??=( {} );
          const item=collection[field.index]??=( {} );
          if("propertyId" in field){(item.properties??=( {} ))[field.propertyId]=binding;
            const effect=node.effects[field.index];if(effect?.properties)delete effect.properties[field.propertyId];}
          else if(field.collection==="effects"&&"field" in field)item[field.field]=binding;
          else item.keyframes=binding.keyframes;
        }
        if(!node.timelines.length){const duration=Math.max(.001,...keyframes.map(keyframe=>keyframe.timelinePosition));node.timelines=[{id:`timeline-${node.id}`,duration}];}
      }),
      removeManualKeyframeTrack:vi.fn((field:KeyframeField)=>{
        if(field.type==="PROPERTY"){delete node.manualKeyframeTracks[field.name];return;}
        const item=node.manualKeyframeTracks[field.collection]?.[field.index];if(!item)return;
        if("propertyId" in field){const binding=item.properties?.[field.propertyId];
          if(binding?.baseValue.type==="FLOAT"&&node.effects[field.index]?.properties)node.effects[field.index].properties[field.propertyId]=binding.baseValue.value;
          if(item.properties)delete item.properties[field.propertyId];}
        else if(field.collection==="effects"&&"field" in field)delete item[field.field];
        else delete item.keyframes;
      }),
      applyAnimationStyle:vi.fn((styleId:string,data:AnimationStyleConfiguration={})=>{const id=`style-${nextId++}`;node.animationStyles.push({id,styleId,name:styleId,...structuredClone(data)});return id;}),
      removeAnimationStyle:vi.fn((id:string)=>{node.animationStyles=node.animationStyles.filter((style:any)=>style.id!==id);}),
      setTimelineDuration:vi.fn((id:string,duration:number)=>{const timeline=node.timelines.find((entry:any)=>entry.id===id);if(timeline)timeline.duration=duration;}),
      exportAsync: vi.fn(async () => Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"))),
      appendChild: (child: any) => {
        child.parent.children = child.parent.children.filter((n: any) => n !== child);
        child.parent = node; node.children.push(child);
      },
      remove: () => {
        node.removed = true;
        for (const child of [...node.children]) child.remove();
        node.parent.children = node.parent.children.filter((n: any) => n !== node);
        registry.delete(node.id);
      },
      clone: () => {
        const copy = frame(); copy.type = node.type; copy.name = node.name; copy.resize(node.width, node.height);
        for (const [qualified, value] of shared) {
          const split = qualified.indexOf(":");
          copy.setSharedPluginData(qualified.slice(0, split), qualified.slice(split + 1), value);
        }
        for (const [key, value] of privateData) copy.setPluginData(key, value);
        copy.fills = structuredClone(node.fills); copy.effects = structuredClone(node.effects);
        copy.manualKeyframeTracks=structuredClone(node.manualKeyframeTracks);copy.animationStyles=structuredClone(node.animationStyles);copy.timelines=structuredClone(node.timelines);
        copy.constraints = { ...node.constraints };
        for (const child of node.children) copy.appendChild(child.clone());
        return copy;
      },
    };
    Object.defineProperty(node, "effects", {
      get: () => effects,
      set: (next: any[]) => {
        for (const effect of next) assertHostEffectShape(effect);
        effects = next;
      },
    });
    registry.set(node.id, node); page.children.push(node); return node;
  }
  function vector(): any {
    const node = frame();
    node.type = "VECTOR"; node.name = "Straight vector"; node.width = 100; node.height = 50;
    node.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }]; node.strokes = [];
    node.isMask = false;
    node.vectorNetwork = {
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
      segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 }],
      regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }],
    };
    node.setVectorNetworkAsync = vi.fn(async (network: VectorNetwork) => { node.vectorNetwork = structuredClone(network); });
    node.clone = () => {
      const copy = vector(); copy.name = node.name; copy.x = node.x; copy.y = node.y;
      copy.vectorNetwork = structuredClone(node.vectorNetwork); copy.fills = structuredClone(node.fills);
      copy.strokes = structuredClone(node.strokes); copy.effects = structuredClone(node.effects);
      copy.opacity = node.opacity; copy.blendMode = node.blendMode; copy.visible = node.visible;
      copy.width=node.width;copy.height=node.height;
      return copy;
    };
    return node;
  }
  const source = frame(); source.name = "Editable source";
  page.selection = [source];
  const api = {
    currentPage: page, root: { children: [page] }, fileKey: "granted-file", mixed: Symbol("mixed"),
    motion:{playheadPosition:undefined as number|undefined},
    on: (name: string, fn: (...args: any[]) => void) => handlers.set(name, fn),
    showUI: vi.fn(), commitUndo: vi.fn(), triggerUndo: vi.fn(), notify: vi.fn(),
    clientStorage: {
      getAsync: vi.fn(async (_key?: string): Promise<unknown> => undefined),
      setAsync: vi.fn(async () => undefined),
    },
    viewport: { zoom: 1, scrollAndZoomIntoView: vi.fn() },
    ui: { on: vi.fn(), onmessage: undefined as ((message: unknown) => void) | undefined, postMessage: (message: unknown) => posts.push(message) },
    base64Decode: (text: string) => Uint8Array.from(atob(text), character => character.charCodeAt(0)),
    base64Encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
    getNodeByIdAsync: vi.fn(async (id: string) => registry.get(id) ?? null),
    createFrame: vi.fn(frame), createImage: vi.fn(() => ({ hash: "rendered" })),
    createRectangle: vi.fn(() => { const n = frame(); n.type = "RECTANGLE"; return n; }),
    createVector: vi.fn(vector), loadFontAsync: vi.fn(async () => {}),
    group: vi.fn((children: any[], parent: any) => {
      const group = frame(); group.type = "GROUP"; group.resize(children[0].width, children[0].height);
      parent.appendChild(group); children.forEach(child => group.appendChild(child)); return group;
    }),
    importShaderById: vi.fn(async (id: string) => ({ id, type: "effect", propertyDefinitions:
      Object.fromEntries(["h00", "h01", "h02", "h10", "h11", "h12", "h20", "h21", "h22", "sourceRight", "sourceBottom"].map((name, i) => [String(i), { name, type: "NUMBER" }])),
    })),
  };
  vi.stubGlobal("figma", api); vi.stubGlobal("__html__", "");
  return { api, source, page, registry, posts, handlers, pageHandlers, frame, vector };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

/** The host restores structural edits as well as metadata. Shader surfaces
 * are immutable publications; a restored old surface owns the same Content. */
function captureLegacyHostUndo(h:ReturnType<typeof host>,result:any) {
  const surface=result.children[0],content=surface.children[0];
  const geometry={x:result.x,y:result.y,width:result.width,height:result.height};
  const slots=["transform","binding","native"].map(key=>[key,result.getSharedPluginData("worldbend",key)]);
  return ()=>{
    const current=result.children[0];
    surface.removed=false;h.registry.set(surface.id,surface);
    result.appendChild(surface);surface.appendChild(content);
    if(current!==surface)current.remove();
    surface.visible=true;result.resizeWithoutConstraints(geometry.width,geometry.height);result.x=geometry.x;result.y=geometry.y;
    for(const [key,value]of slots)result.setSharedPluginData("worldbend",key!,value!);
  };
}

describe("designer and Agent handoff", () => {
  it("opens a native Motion result but refuses graph-changing edits until Motion closes",async()=>{
    const h=host();
    Object.assign(h.api,{createComponent:()=>{
      const component=h.frame();component.type="COMPONENT";
      component.createInstance=()=>{const instance=component.clone();instance.type="INSTANCE";instance.scaleFactor=1;
        instance.getMainComponentAsync=async()=>component;return instance;};return component;
    }});
    const baseInverse:[number,number,number,number,number,number,number,number,number]=[1/520,0,0,0,1/606,0,0,0,1];
    const result=await publishNativeResult({source:h.source,renderer,spec,inverse:baseInverse,
      nativePlan:{kind:"projective",inverse:baseInverse,sourceSize:{width:520,height:606},outputSize:{width:520,height:606}},
      placement:{x:800,y:0,width:520,height:606},renderWidth:520,renderHeight:606});
    const parts=await nativeDocumentParts(result);
    expect(parts.record).toMatchObject({version:"0.3",renderer:{kind:"projective"}});
    if(parts.record.version!=="0.3"||parts.record.renderer.kind!=="projective")throw Error("expected projective component");
    const surface=parts.surface as any,recorded=parts.record.renderer.properties;
    surface.applyManualKeyframeTrack({type:"PROPERTY",name:"OPACITY"},{baseValue:{type:"FLOAT",value:1},keyframes:[
      {timelinePosition:0,value:{type:"FLOAT",value:1}},{timelinePosition:2,value:{type:"FLOAT",value:.75}},
    ]});
    for(const propertyId of renderer.propertyIds)surface.applyManualKeyframeTrack(
      {type:"INDEXED_ITEM",collection:"effects",index:0,propertyId},
      {baseValue:{type:"FLOAT",value:recorded[propertyId]},keyframes:[
        {timelinePosition:0,value:{type:"FLOAT",value:recorded[propertyId]}},
        {timelinePosition:2,easing:{type:"EASE_IN_AND_OUT"},value:{type:"FLOAT",value:recorded[propertyId]}},
      ]});
    h.api.motion.playheadPosition=1;h.page.selection=[result];await import("./main");
    h.api.ui.onmessage?.({type:"ready",systemLocales:["en"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"source",payload:expect.objectContaining({
      targetNodeId:result.id,nativeMotion:{playheadPosition:1}})})));
    const ready=h.posts.findLast(post=>post.type==="source");
    h.api.ui.onmessage?.({type:"request-native-motion-context",generation:ready.generation,targetNodeId:result.id});
    expect(h.posts.at(-1)).toEqual({type:"native-motion-context",generation:ready.generation,targetNodeId:result.id,playheadPosition:1});
    h.api.motion.playheadPosition=undefined;
    h.api.ui.onmessage?.({type:"request-native-motion-context",generation:ready.generation,targetNodeId:result.id});
    expect(h.posts.at(-1)).toEqual({type:"native-motion-context",generation:ready.generation,targetNodeId:result.id});
    h.api.motion.playheadPosition=1;
    const beforeTracks=structuredClone(surface.manualKeyframeTracks);
    const beforeRecord=result.getSharedPluginData("worldbend","native");
    const commits=h.api.commitUndo.mock.calls.length;
    const inverse:[number,number,number,number,number,number,number,number,number]=[1/600,0.0001,.02,-0.0002,1/650,.03,0.00001,-0.00002,1];
    h.api.ui.onmessage?.({type:"apply-native",payload:{generation:ready.generation,sourceNodeId:parts.content.id,targetNodeId:result.id,
      spec,inverse,nativePlan:{kind:"projective",inverse,sourceSize:{width:520,height:606},outputSize:{width:520,height:606}},
      placement:ready.payload.placement,renderWidth:520,renderHeight:606}});
    await vi.waitFor(()=>expect(h.posts.at(-1)).toMatchObject({type:"apply-error",generation:ready.generation,
      message:{key:"nativeMotionCloseForUpdate"}}));
    expect(surface.manualKeyframeTracks).toEqual(beforeTracks);
    expect(result.getSharedPluginData("worldbend","native")).toBe(beforeRecord);
    expect(h.api.commitUndo).toHaveBeenCalledTimes(commits);

    const beforeEditPosts=h.posts.length;
    h.api.ui.onmessage?.({type:"edit-native-source",generation:ready.generation,sourceNodeId:parts.content.id,targetNodeId:result.id,spec});
    await vi.waitFor(()=>expect(h.posts.slice(beforeEditPosts)).toContainEqual(expect.objectContaining({type:"apply-error",generation:ready.generation,
      message:{key:"nativeMotionCloseForUpdate"}})));
    expect(surface.manualKeyframeTracks).toEqual(beforeTracks);
    expect(result.getSharedPluginData("worldbend","native")).toBe(beforeRecord);
    expect(h.api.commitUndo).toHaveBeenCalledTimes(commits);
  });
  it("creates an independent affine Frame from legacy content when its sampler is unavailable",async()=>{
    const h=host();
    Object.assign(h.api,{createComponent:()=>{
      const component=h.frame();component.type="COMPONENT";
      component.createInstance=()=>{
        const instance=component.clone();instance.type="INSTANCE";instance.scaleFactor=1;
        instance.getMainComponentAsync=async()=>component;return instance;
      };return component;
    }});
    const legacy=await publishNativeResult({source:h.source,renderer,spec,
      inverse:[1/520,0,0,0,1/606,0,0,0,1],placement:{x:800,y:0,width:520,height:606},renderWidth:520,renderHeight:606});
    const before=legacy.getSharedPluginData("worldbend","native");
    h.api.importShaderById.mockRejectedValue(Error("sampler unavailable"));
    h.page.selection=[legacy];await import("./main");
    h.api.ui.onmessage?.({type:"ready",systemLocales:["en"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"source"})));
    const ready=h.posts.findLast(post=>post.type==="source");
    const identity:[[number,number,number],[number,number,number]]=[[1,0,0],[0,1,0]];
    const nativePlan={kind:"affine" as const,contentScale:1,numericalResidual:0,outerBasis:identity,innerBasis:identity,logicalToOutput:identity,
      sourceSize:{width:520,height:606},outputSize:{width:520,height:606}};
    const imports=h.api.importShaderById.mock.calls.length;
    h.api.ui.onmessage?.({type:"apply-native",payload:{generation:ready.generation,sourceNodeId:ready.payload.sourceNodeId,targetNodeId:legacy.id,
      duplicate:true,spec,inverse:[1/520,0,0,0,1/606,0,0,0,1],nativePlan,placement:ready.payload.placement,renderWidth:520,renderHeight:606}});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"apply-complete",operation:"apply"})));
    const complete=h.posts.findLast(post=>post.type==="apply-complete");
    expect(complete.targetNodeId).not.toBe(legacy.id);
    const parts=await nativeDocumentParts(h.registry.get(complete.targetNodeId));
    expect(parts.record).toMatchObject({version:"0.3",renderer:{kind:"affine"}});
    expect(parts.content.id).not.toBe(ready.payload.sourceNodeId);
    expect(legacy.getSharedPluginData("worldbend","native")).toBe(before);
    expect(h.api.importShaderById.mock.calls.length).toBe(imports);
  });
  it("resumes the independent result after a designer source swap instead of retaining the replacement pair",async()=>{
    const h=host();
    const result=await publishNativeResult({source:h.source,renderer,spec,inverse:[1/520,0,0,0,1/606,0,0,0,1],
      placement:{x:800,y:0,width:520,height:606},renderWidth:520,renderHeight:606});
    const oldContent=(await nativeDocumentParts(result)).content;
    h.page.selection=[h.source,result];await import("./main");
    h.api.ui.onmessage?.({type:"ready",systemLocales:["en"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"source",payload:expect.objectContaining({sourceNodeId:h.source.id,targetNodeId:result.id})})));
    const ready=h.posts.findLast(post=>post.type==="source");
    h.api.ui.onmessage?.({type:"apply-native",payload:{generation:ready.generation,sourceNodeId:h.source.id,targetNodeId:result.id,spec,
      inverse:[1/520,0,0,0,1/606,0,0,0,1],placement:ready.payload.placement,renderWidth:520,renderHeight:606}});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"apply-complete",targetNodeId:result.id})));
    const next=(await nativeDocumentParts(result)).content;
    expect(next.id).not.toBe(oldContent.id);expect(next.id).not.toBe(h.source.id);
    expect(h.page.selection).toEqual([result]);expect(oldContent.removed).toBe(false);
    await vi.waitFor(()=>expect(h.posts.findLast(post=>post.type==="source")?.payload).toMatchObject({targetNodeId:result.id,sourceNodeId:next.id}));
  });
  it.each(["agent","designer"] as const)("updates a legacy native Frame with a core affine plan while preserving its live source (%s)",async route=>{
    const h=host(),handoff=await loadAgentHandoff("source");
    const result=await publishNativeResult({source:h.source,renderer,spec,
      inverse:[1/520,0,0,0,1/606,0,0,0,1],placement:{x:800,y:0,width:520,height:606},renderWidth:520,renderHeight:606});
    const before=await handoff.inspect(result.id,"granted-file","page");
    const identity:[[number,number,number],[number,number,number]]=[[1,0,0],[0,1,0]];
    const nativePlan={kind:"affine" as const,contentScale:1,numericalResidual:0,outerBasis:identity,innerBasis:identity,logicalToOutput:identity,
      sourceSize:{width:520,height:606},outputSize:{width:520,height:606}};
    if(route==="agent")await handoff.apply({...before,inverse:[1/520,0,0,0,1/606,0,0,0,1],width:520,height:606,nativePlan});
    else {
      h.page.selection=[result];await import("./main");
      h.api.ui.onmessage?.({type:"ready",systemLocales:["en"],sceneDraftSessionId:"test-session-00001"});
      await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"source"})));
      const ready=h.posts.findLast(post=>post.type==="source");
      h.api.ui.onmessage?.({type:"apply-native",payload:{generation:ready.generation,sourceNodeId:before.source.nodeId,targetNodeId:result.id,
        spec,inverse:[1/520,0,0,0,1/606,0,0,0,1],nativePlan,placement:before.placement,renderWidth:520,renderHeight:606}});
      await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"apply-complete",targetNodeId:result.id})));
    }
    const after=await handoff.inspect(result.id,"granted-file","page");
    expect(after.source.nodeId).toBe(before.source.nodeId);
    expect(after.revision).toBe(before.revision+1);
    expect((await nativeDocumentParts(result)).record.version).toBe("0.2");
  });
  it.each(["source","bundled"] as const)("cancels generic Composition/Depth transfers before the visible image write (%s)",async entry=>{
    for(const family of ["mockup","effect"] as const) {
      const h=host(),handoff=await loadAgentHandoff(entry),result=h.api.createRectangle();
      const sources=[h.source,h.frame(),...(family==="effect"?[h.frame()]:[])];
      const task=family==="mockup"?mockupTask():spatialTask();
      writeStoredOperation(result,{kind:"task",task});writeStoredBinding(result,{sourceNodeIds:sources.map(s=>s.id),renderWidth:600,renderHeight:400});
      result.fills=[{type:"IMAGE",imageHash:"old-pixels",scaleMode:"FILL"}];
      const snapshot=family==="mockup"?await handoff.inspectMockup(result.id,"granted-file","page"):await handoff.inspectEffect(result.id,"granted-file","page");
      const input={...snapshot,task,renderWidth:600,renderHeight:400,imageBase64:btoa("new pixels")};
      const encoded=Buffer.from(JSON.stringify(input)).toString("base64"),scope={fileKey:"granted-file",pageId:"page",nodeId:result.id,transferId:"d".repeat(64),payloadDigest:createHash("sha256").update(encoded).digest("hex")};
      let hash=2166136261;for(const byte of Buffer.from(encoded))hash=Math.imul(hash^byte,16777619)>>>0;
      const media=entry==="source"?publicationMedia:new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-media.js",import.meta.url),"utf8")}\nreturn WorldbendFigmaMedia;`)() as typeof publicationMedia;
      const stage=async()=>{for(let i=0;i<Math.ceil(encoded.length/32768);i++)await media.stagePublicationChunk({...scope,count:Math.ceil(encoded.length/32768),length:encoded.length,checksum:hash.toString(16).padStart(8,"0"),index:i,chunk:encoded.slice(i*32768,(i+1)*32768)});};
      const publish=family==="mockup"?handoff.publishMockupImage:handoff.publishEffectImage;
      const finalize=()=>media.finishPublication<{nodeId:string}>(scope,(data,lease)=>publish(data as any,lease.validate));
      await stage();let resume!:()=>void,reached!:()=>void;
      const paused=new Promise<void>(r=>{resume=r;}),entered=new Promise<void>(r=>{reached=r;});
      const originalExport=h.source.exportAsync.getMockImplementation()!;
      h.source.exportAsync.mockImplementationOnce(async()=>{reached();await paused;return originalExport();});
      const beforeFills=structuredClone(result.fills),beforeBinding=readStoredBinding(result);
      const pending=finalize();await entered;await media.cancelPublication(scope);resume();
      expect(await pending).toMatchObject({status:"failed"});expect(result.fills).toEqual(beforeFills);expect(readStoredBinding(result)).toEqual(beforeBinding);
      await stage();expect(await finalize()).toMatchObject({status:"published"});expect(result.fills[0].imageHash).toBe("rendered");
    }
  });
  it.each(["source", "bundled"] as const)("lets an Agent inspect, stage and publish a copied multi-source result with rollback and original protection (%s)", async entry => {
    const h = host(), sources = [h.source, h.frame()];
    const original = h.api.createRectangle();
    writeStoredOperation(original, { kind: "task", task: mockupTask() });
    for (let i = 0; i < 2; i++) writeStoredBinding(original, { sourceNodeIds: sources.map(n => n.id), renderWidth: 600, renderHeight: 400 });
    original.fills = [{ type: "IMAGE", imageHash: "original", scaleMode: "FILL" }];
    const copy = original.clone(); copy.x = 900;
    const raw = copy.getSharedPluginData("worldbend", "binding");
    const originalState = [original.getSharedPluginData("worldbend", "binding"), original.getSharedPluginData("worldbend", "task"), original.fills];
    const handoff = await loadAgentHandoff(entry);
    const snapshot = await handoff.inspectMockup(copy.id, "granted-file", "page");
    expect(snapshot).toMatchObject({ nodeId: copy.id, revision: 2, sourceNodeIds: sources.map(n => n.id) });
    expect(copy.getSharedPluginData("worldbend", "binding")).toBe(raw);
    const staged = await handoff.stageMockup({ fileKey: "granted-file", pageId: "page", nodeId: copy.id,
      expected: snapshot.expected, task: mockupTask(.4) });
    expect(staged.draft?.task).toEqual(mockupTask(.4));
    const input = { fileKey: "granted-file", pageId: "page", nodeId: copy.id,
      expected: staged.expected, revision: staged.revision, task: mockupTask(.4),
      renderWidth: 600, renderHeight: 400, imageBase64: btoa("pixels") };
    const write = copy.setSharedPluginData;
    let fail = true;
    copy.setSharedPluginData = (namespace: string, key: string, value: string) => {
      if (key === "binding" && fail) { fail = false; throw Error("host write failed"); }
      write(namespace, key, value);
    };
    await expect(handoff.publishMockupImage(input)).rejects.toThrow("host write failed");
    expect(copy.getSharedPluginData("worldbend", "binding")).toBe(raw);
    expect(copy.fills).toEqual(original.fills);
    expect((await handoff.inspectMockup(copy.id, "granted-file", "page")).expected).toBe(staged.expected);
    const after = await handoff.publishMockupImage(input);
    expect(after.revision).toBe(3);
    expect(readStoredBinding(copy)).toMatchObject({ resultNodeId: copy.id, revision: 3, sourceNodeIds: sources.map(n => n.id) });
    expect(copy.x).toBe(900);
    expect([original.getSharedPluginData("worldbend", "binding"), original.getSharedPluginData("worldbend", "task"), original.fills]).toEqual(originalState);
    await expect(handoff.publishMockupImage(input)).rejects.toThrow("E_FIGMA_CONFLICT");
  });

  it.each(["malformed", "missing", "ambiguous"] as const)("does not admit a copied raster with a %s saved operation", async issue => {
    vi.useFakeTimers();
    const h = host(), copy = h.api.createRectangle();
    writeStoredOperation(copy, { kind: "transform", spec });
    writeStoredBinding(copy, { sourceNodeIds: [h.source.id], renderWidth: 1040, renderHeight: 1212 });
    const raw = JSON.parse(copy.getSharedPluginData("worldbend", "binding"));
    copy.setSharedPluginData("worldbend", "binding", JSON.stringify({ ...raw, resultNodeId: "original" }));
    if (issue === "ambiguous") copy.setSharedPluginData("worldbend", "rectification", "{}");
    else copy.setSharedPluginData("worldbend", "transform", issue === "missing" ? "" : "not JSON");
    copy.setSharedPluginData.mockClear();
    h.page.selection = [copy];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.findLast(p => p.type === "selection-error")).toMatchObject({ message: { key: "invalidReusablePlane" } });
    expect(h.posts.some(p => p.type === "source")).toBe(false);
    expect(copy.setSharedPluginData).not.toHaveBeenCalled();
    expect(h.api.commitUndo).not.toHaveBeenCalled();
  });

  it("cold-reopens an ordinary duplicated HD result and updates only the copy with its retained operation and density", async () => {
    vi.useFakeTimers();
    const h = host();
    const original = h.api.createRectangle();
    const authored = structuredClone(spec); authored.destination.quad.tl = { x: .18, y: .14 };
    original.resize(520, 606); original.x = 700; original.fills = [{ type: "IMAGE", imageHash: "old-pixels", scaleMode: "FILL" }];
    writeStoredOperation(original, { kind: "transform", spec: authored });
    for (let i = 0; i < 2; i++) writeStoredBinding(original, { sourceNodeIds: [h.source.id], renderWidth: 1040, renderHeight: 1212 });
    const originalBinding = original.getSharedPluginData("worldbend", "binding");
    const copy = original.clone(); copy.x = 1400; copy.name = "My second placement";
    const copiedBinding = copy.getSharedPluginData("worldbend", "binding");
    copy.setSharedPluginData.mockClear();
    h.page.selection = [copy];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const opened = h.posts.findLast(p => p.type === "source");
    expect(opened).toMatchObject({ payload: { sourceNodeId: h.source.id, targetNodeId: copy.id,
      spec: authored, renderWidth: 1040, renderHeight: 1212 } });
    expect(copy.setSharedPluginData).not.toHaveBeenCalled();
    expect(copy.getSharedPluginData("worldbend", "binding")).toBe(copiedBinding);
    expect(h.api.commitUndo).not.toHaveBeenCalled();
    const rectangles = h.api.createRectangle.mock.calls.length;
    h.api.ui.onmessage?.({ type: "apply", payload: { generation: opened.generation,
      sourceNodeId: h.source.id, targetNodeId: copy.id, spec: authored,
      bytes: new Uint8Array([7]), renderWidth: 1040, renderHeight: 1212,
      placement: opened.payload.placement } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", operation: "replace", targetNodeId: copy.id });
    expect(h.api.createRectangle).toHaveBeenCalledTimes(rectangles);
    expect(readStoredBinding(copy)).toMatchObject({ resultNodeId: copy.id, sourceNodeIds: [h.source.id], revision: 3 });
    expect(copy.x).toBe(1400); expect(copy.name).toBe("My second placement");
    expect(original.getSharedPluginData("worldbend", "binding")).toBe(originalBinding);
    expect(original.fills).toEqual([{ type: "IMAGE", imageHash: "old-pixels", scaleMode: "FILL" }]);
    expect(original.x).toBe(700);
  });

  it("cold-reads a published native scene without writes, and recomposes after a source or saved-task edit", async () => {
    vi.useFakeTimers();
    const h = host();
    const created = await (await import("./ready-scenes-main")).createReadyScene({ id: "studio-poster", artwork: h.source,
      fit: "contain", placement: { x: 0, y: 0 }, assertCurrent() {}, begin() {} });
    const result = created.result;
    h.page.selection = [result];
    const start = async () => {
      vi.resetModules();
      await import("./main");
      h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
      await vi.advanceTimersByTimeAsync(0);
      return h.posts.findLast(p => p.type === "source");
    };
    const initial = await start();
    h.api.ui.onmessage?.({ type: "apply-designer", payload: {
      generation: initial.generation, sourceNodeIds: created.reference.sourceNodeIds, targetNodeId: result.id,
      task: initial.payload.task, bytes: new Uint8Array([7]), renderWidth: 1200, renderHeight: 900, placement: initial.payload.placement,
    } });
    await vi.advanceTimersByTimeAsync(0);
    const cold = await start();
    expect(cold.payload).toMatchObject({ sceneContext: true, sceneContextReadOnly: true });
    const frames = h.api.createFrame.mock.calls.length, images = h.api.createImage.mock.calls.length,
      commits = h.api.commitUndo.mock.calls.length;
    h.api.ui.onmessage?.({ type: "request-scene-context", generation: cold.generation, requestId: 1,
      bytes: new Uint8Array([7]), showCanvas: false, readPublished: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "scene-context-preview", requestId: 1, frame: { resultWidth: 1200 } });
    expect(h.api.createFrame).toHaveBeenCalledTimes(frames);
    expect(h.api.createImage).toHaveBeenCalledTimes(images);
    expect(h.api.commitUndo).toHaveBeenCalledTimes(commits);
    const source = h.registry.get(created.reference.sourceNodeIds[0]!);
    source.opacity = .73;
    expect((await start()).payload).not.toHaveProperty("sceneContextReadOnly");
    source.opacity = 1;
    const task = JSON.parse(result.getSharedPluginData("worldbend", "task"));
    task.spec.planes[0].opacity = .61;
    writeStoredOperation(result, { kind: "task", task });
    expect((await start()).payload).not.toHaveProperty("sceneContextReadOnly");
  });

  it.each(["source", "bundled"] as const)("records the same native read proof on an Agent publication (%s)", async entry => {
    const h = host();
    const created = await (await import("./ready-scenes-main")).createReadyScene({ id: "studio-poster", artwork: h.source,
      fit: "contain", placement: { x: 0, y: 0 }, assertCurrent() {}, begin() {} });
    const handoff = await loadAgentHandoff(entry);
    const snapshot = await handoff.inspectMockup(created.result.id, "granted-file", "page");
    await handoff.publishMockupImage({ fileKey: "granted-file", pageId: "page", nodeId: created.result.id,
      expected: snapshot.expected, revision: snapshot.revision, task: snapshot.task,
      renderWidth: 1200, renderHeight: 900, imageBase64: btoa("image") });
    const proof = await import("./native-scene-read-proof");
    const sources = created.reference.sourceNodeIds.map(id => h.registry.get(id));
    const current = await proof.prepareSceneReadProof(sources);
    expect(proof.matchesSceneReadProof(created.result, current.fingerprint)).toBe(true);
    sources[0].opacity = .67;
    expect(proof.matchesSceneReadProof(created.result, (await proof.prepareSceneReadProof(sources)).fingerprint)).toBe(false);
  });

  it("refuses a native scene publication after an unreported source edit", async () => {
    vi.useFakeTimers();
    const h = host();
    const created = await (await import("./ready-scenes-main")).createReadyScene({ id: "studio-poster", artwork: h.source,
      fit: "contain", placement: { x: 0, y: 0 }, assertCurrent() {}, begin() {} });
    h.page.selection = [created.result];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const initial = h.posts.findLast(p => p.type === "source");
    const prior = created.result.getSharedPluginData("worldbend", "binding");
    h.registry.get(created.reference.sourceNodeIds[0]!).opacity = .67;
    h.api.ui.onmessage?.({ type: "apply-designer", payload: {
      generation: initial.generation, sourceNodeIds: created.reference.sourceNodeIds, targetNodeId: created.result.id,
      task: initial.payload.task, bytes: new Uint8Array([7]), renderWidth: 1200, renderHeight: 900, placement: initial.payload.placement,
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-designer-error" });
    expect(created.result.getSharedPluginData("worldbend", "binding")).toBe(prior);
    expect(created.result.fills).toEqual([]);
  });

  it("reloads a human-created published scene task on native Undo even when material context still observes the Page", async () => {
    vi.useFakeTimers();
    const h = host();
    const created = await (await import("./ready-scenes-main")).createReadyScene({ id:"studio-poster", artwork:h.source,
      fit:"contain",placement:{x:0,y:0},assertCurrent(){},begin(){} });
    const scene = { snapshot: { nodeId:created.result.id, sourceNodeIds:created.reference.sourceNodeIds } };
    const result = created.result;
    const originalTask = result.getSharedPluginData("worldbend", "task");
    const originalBinding = result.getSharedPluginData("worldbend", "binding");
    h.page.selection = [result];
    vi.doMock("./material-trial", () => ({ createMaterialTrial: (input: Parameters<typeof import("./material-trial").createMaterialTrial>[0]) => ({
      request: () => input.observe(h.page.id), cancel: () => input.clear(),
    }) }));
    try {
      await import("./main");
      h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
      await vi.advanceTimersByTimeAsync(0);
      const initial = h.posts.findLast(p => p.type === "source");
      expect(initial.payload).toMatchObject({ sceneContext: true, targetNodeId: result.id });
      h.api.ui.onmessage?.({ type: "request-appearance-state" });
      h.api.ui.onmessage?.({ type: "request-texture-state" });
      h.api.ui.onmessage?.({ type: "request-material-preview", generation: initial.generation, requestId: 1 });
      const nextTask = structuredClone(initial.payload.task);
      nextTask.spec.planes[0].opacity = .99;
      h.api.ui.onmessage?.({ type: "apply-designer", payload: {
        generation: initial.generation, sourceNodeIds: scene.snapshot.sourceNodeIds, targetNodeId: result.id,
        task: nextTask, bytes: new Uint8Array([7]), renderWidth: 1200, renderHeight: 900, placement: initial.payload.placement,
      } });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.at(-1)).toMatchObject({ type: "apply-designer-complete", operation: "replace" });
      expect(readStoredBinding(result)?.revision).toBe(2);
      // Publication clears the temporary scene capture. The independent
      // material capture can still observe this target without appearance edits.
      result.setSharedPluginData("worldbend", "task", originalTask);
      result.setSharedPluginData("worldbend", "binding", originalBinding);
      const before = h.posts.length;
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: result.id, node: result, properties: ["pluginData", "fills"] }] });
      await vi.advanceTimersByTimeAsync(150);
      expect(h.posts.slice(before).some(p => p.type === "material-context-changed")).toBe(false);
      const undone = h.posts.findLast(p => p.type === "source");
      expect(undone).toMatchObject({ generation: initial.generation + 1, payload: { task: initial.payload.task, sceneContextReadOnly: true } });
      const createdFrames = h.api.createFrame.mock.calls.length;
      const createdImages = h.api.createImage.mock.calls.length;
      const commits = h.api.commitUndo.mock.calls.length;
      h.api.ui.onmessage?.({ type: "request-scene-context", generation: undone.generation, requestId: 2,
        bytes: new Uint8Array([7]), showCanvas: false, readPublished: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.at(-1)).toMatchObject({ type: "scene-context-preview", requestId: 2, frame: { resultWidth: 1200, resultHeight: 900 } });
      expect(h.api.createFrame).toHaveBeenCalledTimes(createdFrames);
      expect(h.api.createImage).toHaveBeenCalledTimes(createdImages);
      expect(h.api.commitUndo).toHaveBeenCalledTimes(commits);
      // A host Redo also supplies a fresh task and remains editable.
      writeStoredOperation(result, { kind: "task", task: nextTask });
      writeStoredBinding(result, { sourceNodeIds: scene.snapshot.sourceNodeIds, renderWidth: 1200, renderHeight: 900 });
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: result.id, node: result, properties: ["pluginData", "fills"] }] });
      await vi.advanceTimersByTimeAsync(150);
      expect(h.posts.findLast(p => p.type === "source")).toMatchObject({ generation: undone.generation + 1, payload: { task: nextTask, sceneContextReadOnly: true } });
      // Source edits require fresh compositing, even while continuing a
      // result that had previously used a read-only history preview.
      const artwork = h.registry.get(scene.snapshot.sourceNodeIds[0]!);
      artwork.exportAsync.mockResolvedValue(new Uint8Array([8, 9, 10]));
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: artwork.id, node: artwork }] });
      await vi.advanceTimersByTimeAsync(150);
      expect(h.posts.findLast(p => p.type === "source").payload).not.toHaveProperty("sceneContextReadOnly");
    } finally { vi.doUnmock("./material-trial"); }
  });


  it("publishes native multi-region shape clipping through the full main entry", async () => {
    vi.useFakeTimers(); const h = host(), guide = h.frame();
    h.page.selection = [h.source, guide];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const ready = h.posts.findLast(p => p.type === "source");
    const contour = (x: number) => ({ start: { x, y: .1 }, segments: [
      { kind: "line" as const, to: { x: x + .3, y: .1 } }, { kind: "line" as const, to: { x: x + .3, y: .9 } },
      { kind: "line" as const, to: { x, y: .9 } }, { kind: "line" as const, to: { x, y: .1 } },
    ] });
    const task = mockupTask(); task.spec.planes[1]!.opacity = 0;
    task.spec.clip = { contours: [contour(.1), contour(.6)], regions: [
      { contourIndices: [0], fillRule: "nonZero" }, { contourIndices: [1], fillRule: "evenOdd" },
    ] };
    h.api.ui.onmessage?.({ type: "apply-designer", payload: { generation: ready.generation,
      sourceNodeIds: [h.source.id, guide.id], task, bytes: new Uint8Array([1, 2, 3]),
      renderWidth: 600, renderHeight: 400, placement: { x: 0, y: 0, width: 600, height: 400 } } });
    await vi.advanceTimersByTimeAsync(0);
    const applied = h.posts.findLast(p => p.type === "apply-designer-complete");
    expect(applied).toMatchObject({ operation: "apply" });
    const stored = readStoredOperation(h.registry.get(applied.targetNodeId));
    expect(stored).toMatchObject({ status: "valid", operation: { kind: "task", task } });
    expect(readStoredBinding(h.registry.get(applied.targetNodeId))?.sourceNodeIds).toEqual([h.source.id, guide.id]);
  });

  it("uses the same full Frame appearance for initial placement, HD density and drift rejection", async () => {
    vi.useFakeTimers(); const h = host(); h.source.resize(320, 240);
    h.source.absoluteRenderBounds = { x: -7, y: -3, width: 344, height: 264 };
    h.source.effects = [{ type: "DROP_SHADOW", visible: true, radius: 12,
      color: { r: 0, g: 0, b: 0, a: .35 }, offset: { x: 5, y: 9 }, blendMode: "NORMAL" }];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const first = h.posts.findLast(p => p.type === "source");
    expect(first.payload).toMatchObject({ renderWidth: 344, renderHeight: 264,
      placement: { x: -7, y: -3, width: 344, height: 264 } });
    expect(h.source.exportAsync.mock.calls[0][0]).not.toHaveProperty("useAbsoluteBounds");
    expect(h.api.importShaderById).not.toHaveBeenCalled();
    h.api.ui.onmessage?.({ type: "request-source-raster", generation: first.generation, requestId: 1,
      sourceNodeId: h.source.id, desiredWidth: 4096, desiredHeight: 4096 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.source.exportAsync.mock.lastCall[0].constraint.value).toBe(4096 / 344);
    // An appearance-only change can arrive before a host event. It must not
    // publish pixels captured with the obsolete window or populate the cache.
    let finish!: (bytes: Uint8Array) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
    h.api.ui.onmessage?.({ type: "request-source-raster", generation: first.generation, requestId: 2,
      sourceNodeId: h.source.id, desiredWidth: 688, desiredHeight: 528 });
    await vi.advanceTimersByTimeAsync(0);
    h.source.absoluteRenderBounds.width = 350;
    finish(new Uint8Array([1, 2, 3])); await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.findLast(p => p.requestId === 2)).toMatchObject({ type: "source-raster-error", message: { key: "selectionChanged" } });
    expect(h.source.width).toBe(320); expect(h.api.createImage).not.toHaveBeenCalled();
  });

  it("retains an existing Shader Frame's authored logical viewport when its Content gains outside paint", async () => {
    vi.useFakeTimers(); const h = host();
    // This branch now outlines through real containing-coordinate ancestry.
    // Give its host fixture coherent affine getters and clone dimensions.
    installNativeTestBasis(h.source);
    const originalFrame=h.api.createFrame.getMockImplementation()!;
    h.api.createFrame.mockImplementation(()=>installNativeTestBasis(originalFrame()));
    const child=installNativeTestBasis(h.vector());
    const clone=child.clone;child.clone=()=>installNativeTestBasis(clone());
    h.source.appendChild(child);
    (h.api as any).flatten=vi.fn(([temporary]:any[])=>{
      const input=temporary.vectorNetwork??{vertices:[{x:0,y:0},{x:temporary.width,y:0},{x:temporary.width,y:temporary.height},{x:0,y:temporary.height}],segments:[{start:0,end:1},{start:1,end:2},{start:2,end:3},{start:3,end:0}],regions:[{windingRule:"NONZERO",loops:[[0,1,2,3]]}]};
      const m=temporary.absoluteTransform,points=input.vertices.map((p:any)=>({x:m[0][0]*p.x+m[0][1]*p.y+m[0][2],y:m[1][0]*p.x+m[1][1]*p.y+m[1][2]}));
      const result=installNativeTestBasis(h.vector()),x=Math.min(...points.map((p:any)=>p.x)),y=Math.min(...points.map((p:any)=>p.y));
      result.x=x;result.y=y;result.width=Math.max(...points.map((p:any)=>p.x))-x;result.height=Math.max(...points.map((p:any)=>p.y))-y;
      result.vectorNetwork={vertices:points.map((p:any)=>({x:p.x-x,y:p.y-y})),segments:structuredClone(input.segments),regions:input.regions.map((r:any)=>({...r,fills:r.fills??temporary.fills}))};
      result.fills=temporary.fills;temporary.remove();return result;
    });
    (h.api as any).intersect=vi.fn(([outline,mask]:any[])=>{
      // This fixture's straight leaf is contained, touching the clip edge.
      // Native Boolean work is still necessary because the strict no-op
      // certificate intentionally does not guess across an uncertain edge.
      const world=(n:any,p:any)=>({x:p.x+n.x,y:p.y+n.y});
      const boundary=mask.vectorNetwork.vertices.map((p:any)=>world(mask,p));
      for(const p of outline.vectorNetwork.vertices.map((p:any)=>world(outline,p)))for(let i=0;i<4;i++){
        const a=boundary[i],b=boundary[(i+1)%4];expect((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)).toBeGreaterThanOrEqual(-1e-6);
      }
      const result=installNativeTestBasis(h.vector());result.type="BOOLEAN_OPERATION";result.fillGeometry=[{data:"contained fixture"}];
      result.x=outline.x;result.y=outline.y;result.width=outline.width;result.height=outline.height;result.vectorNetwork=structuredClone(outline.vectorNetwork);result.fills=outline.fills;
      outline.remove();mask.remove();return result;
    });
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 600, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 0, y: 0, width: 600, height: 400 }, renderWidth: 600, renderHeight: 400 });
    const parts = await nativeDocumentParts(result), content = parts.content as any;
    content.absoluteRenderBounds = { x: -10, y: -10, width: content.width + 20, height: content.height + 20 };
    h.page.selection = [result]; await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const first = h.posts.findLast(p => p.type === "source");
    expect(first.payload).toMatchObject({ nativeTarget: true, sourceNodeId: content.id, targetNodeId: result.id });
    expect(content.exportAsync.mock.lastCall[0]).toHaveProperty("useAbsoluteBounds", true);
    h.api.ui.onmessage?.({ type: "request-source-raster", generation: first.generation, requestId: 1,
      sourceNodeId: content.id, targetNodeId: result.id, desiredWidth: 1200, desiredHeight: 800 });
    await vi.advanceTimersByTimeAsync(0);
    expect(content.exportAsync.mock.lastCall[0]).toHaveProperty("useAbsoluteBounds", true);
    expect((await nativeDocumentParts(result)).content.id).toBe(content.id);
    h.api.ui.onmessage?.({ type: "request-native-vector-projection", payload: {
      generation: first.generation, sourceNodeId: content.id, targetNodeId: result.id, spec,
      matrix: [600, 0, 0, 0, 400, 0, 0, 0, 1], renderWidth: 600, renderHeight: 400,
      placement: { x: 0, y: 0, width: 600, height: 400 } } });
    await vi.advanceTimersByTimeAsync(0);
    const relay = h.posts.findLast(p => p.type.startsWith("native-vector-projection"));
    expect(relay).toHaveProperty("inputs");
    expect(relay.inputs[0].sourceBounds).toEqual(content.absoluteBoundingBox);
    await expect(publishNativeResult({ source: content, renderer, spec,
      inverse: [1 / 600, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 0, y: 0, width: 600, height: 400 }, renderWidth: 600, renderHeight: 400 })).rejects.toThrow("Unsupported editable frame");
    const frameChildren = result.children.map(child => child.id), frameOperation = readStoredOperation(result);
    const outputs = await Promise.all(relay.inputs.map((input: any) => planVectorProjection(input)));
    h.api.ui.onmessage?.({ type: "apply-native-vector", payload: {
      generation: first.generation, sourceNodeId: content.id, targetNodeId: result.id, spec,
      matrix: [600, 0, 0, 0, 400, 0, 0, 0, 1], renderWidth: 600, renderHeight: 400,
      placement: relay.placement, projection: { outputs, sourceFingerprint: relay.sourceFingerprint },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const complete = h.posts.findLast(p => p.type === "apply-complete");
    expect(complete).toMatchObject({ operation: "apply" });
    expect(complete.targetNodeId).not.toBe(result.id);
    const vectorParts = await nativeVectorDocumentParts(h.registry.get(complete.targetNodeId));
    expect(vectorParts.binding.sourceNodeIds).toEqual([content.id]);
    expect(result.children.map(child => child.id)).toEqual(frameChildren);
    expect(readStoredOperation(result)).toEqual(frameOperation);
    expect((await nativeDocumentParts(result)).content.id).toBe(content.id);
  });

  it.each(["source", "bundled"] as const)("%s bounds Agent PNG density by its complete appearance and rejects a changed window", async entry => {
    const h = host(); h.source.resize(1200, 800);
    h.source.absoluteRenderBounds = { x: -20, y: -20, width: 5000, height: 4800 };
    const handoff = await loadAgentHandoff(entry);
    const second = h.api.createRectangle(), result = h.api.createRectangle();
    writeStoredBinding(result, { sourceNodeIds: [h.source.id, second.id], renderWidth: 4096, renderHeight: 4096 });
    writeStoredOperation(result, { kind: "task", task: mockupTask() });
    const read = await handoff.inspectMockupWithSources(result.id, h.api.fileKey, h.page.id);
    expect(read.sources[0]).toMatchObject({ width: 1200, height: 800 }); // Logical/native metadata stays separate.
    expect(h.source.exportAsync.mock.lastCall[0].constraint.value).toBe(4096 / 5000);
    for (const [settings] of h.source.exportAsync.mock.calls) {
      expect(settings).not.toHaveProperty("useAbsoluteBounds");
      expect(settings.constraint.value * 5000).toBeLessThanOrEqual(4096);
      expect(settings.constraint.value * 4800).toBeLessThanOrEqual(4096);
    }
    h.source.exportAsync.mockImplementationOnce(async () => {
      h.source.absoluteRenderBounds.width += 10;
      return new Uint8Array([1, 2, 3]);
    });
    await expect(handoff.inspectMockupWithSources(result.id, h.api.fileKey, h.page.id)).rejects.toThrow("E_FIGMA_CONFLICT");
  });

  it.each(["regions", "stroke overflow", "effect overflow"] as const)("keeps %s artwork visible through preview, HD recapture, Card and batch source reads", async route => {
    vi.useFakeTimers();
    const h = host(), source = h.vector();
    source.fills = h.api.mixed;
    source.vectorNetwork.regions[0].fills = [{ type: "SOLID", color: { r: .1, g: .6, b: .5 } }];
    if (route === "stroke overflow") source.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }];
    if (route === "effect overflow") source.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: .3 }, offset: { x: 0, y: 2 }, radius: 4, visible: true, blendMode: "NORMAL" }];
    const visible = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")), empty = new Uint8Array([0]);
    // Model the actual Desktop export behavior: region-only artwork requires
    // absolute bounds; outside stroke/effect appearance uses the default crop.
    source.exportAsync = vi.fn(async (settings: ExportSettingsImage) =>
      Boolean(settings.useAbsoluteBounds) === (route === "regions") ? visible : empty);
    h.page.selection = [source];
    const result = h.api.createRectangle(); result.resize(100, 50);
    writeStoredBinding(result, { sourceNodeIds: [source.id], renderWidth: 100, renderHeight: 50 });
    writeStoredOperation(result, { kind: "transform", spec });
    (h.page as any).findAllWithCriteria = () => [result];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const first = h.posts.findLast(p => p.type === "source");
    expect(first.payload.bytes).toEqual(visible);
    expect(first.payload.linkedResults?.total).toBe(1);
    h.api.ui.onmessage?.({ type: "request-source-raster", generation: first.generation, requestId: 1,
      sourceNodeId: source.id, desiredWidth: 200, desiredHeight: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.findLast(p => p.type === "source-raster")?.bytes).toEqual(visible);
    h.api.ui.onmessage?.({ type: "request-card-source", generation: first.generation, requestId: 2, nodeId: source.id });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.findLast(p => p.type === "card-source")?.bytes).toBe(h.api.base64Encode(visible));
    h.api.ui.onmessage?.({ type: "prepare-linked-batch", generation: first.generation });
    await vi.advanceTimersByTimeAsync(0);
    const batch = h.posts.findLast(p => p.type === "linked-batch");
    h.api.ui.onmessage?.({ type: "export-batch-source", generation: first.generation, batchRunId: batch.items[0].batchRunId,
      requestId: 1, resultNodeId: result.id, nodeId: source.id, desiredWidth: 100, desiredHeight: 50 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.filter(p => ["linked-batch-error", "batch-source-error"].includes(p.type))).toEqual([]);
    expect(h.posts.findLast(p => p.type === "batch-source")?.bytes).toEqual(visible);
    expect(source.fills).toBe(h.api.mixed);
  });

  it.each(["source", "bundled"] as const)("%s exports mixed region artwork through the Agent linked-source route", async entry => {
    const h = host(), source = h.vector();
    source.fills = h.api.mixed;
    source.vectorNetwork.regions[0].fills = [{ type: "SOLID", color: { r: .1, g: .6, b: .5 } }];
    const visible = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    source.exportAsync = vi.fn(async (settings: ExportSettingsImage) => settings.useAbsoluteBounds ? visible : new Uint8Array([0]));
    const result = h.api.createRectangle(); result.resize(600, 400);
    writeStoredBinding(result, { sourceNodeIds: [source.id, h.source.id], renderWidth: 600, renderHeight: 400 });
    writeStoredOperation(result, { kind: "task", task: mockupTask() });
    result.setPluginData("worldbend.renderWidth", "600"); result.setPluginData("worldbend.renderHeight", "400");
    const handoff = await loadAgentHandoff(entry);
    const read = await handoff.inspectMockupWithSources(result.id, h.api.fileKey, h.page.id);
    expect(read.sourceRasters[0]?.base64).toBe(h.api.base64Encode(visible));
    expect(source.fills).toBe(h.api.mixed);
  });

  it.each(["source", "bundled"] as const)("%s rejects an appearance edit arriving during target resolution", async (entry) => {
    const h = host();
    const { BUILTIN_APPEARANCE_RECIPES } = await import("./appearance-wire");
    const handoff = await loadAgentHandoff(entry);
    const before = await handoff.inspectAppearance(h.source.id, h.api.fileKey, h.page.id);
    const recipe = BUILTIN_APPEARANCE_RECIPES[0]!;
    h.api.getNodeByIdAsync.mockImplementationOnce(async () => h.source)
      .mockImplementationOnce(async () => {
        h.source.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: .3 }, offset: { x: 0, y: 2 }, radius: 4, visible: true, blendMode: "NORMAL" }];
        return h.source;
      });
    await expect(handoff.applyAppearance({ fileKey: h.api.fileKey, pageId: h.page.id, nodeId: h.source.id, expected: before.expected, recipe })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(h.source.effects).toHaveLength(1);
    expect(h.source.effects[0].type).toBe("DROP_SHADOW");
    expect(h.source.getSharedPluginData("worldbend", "appearance")).toBe("");
  });

  it.each(["source", "bundled"] as const)("%s applies a texture seed and reconciles a native edit through the Agent entry", async (entry) => {
    const h = host();
    const { BUILTIN_TEXTURE_RECIPES } = await import("./texture-wire");
    const handoff = await loadAgentHandoff(entry);
    const recipe = BUILTIN_TEXTURE_RECIPES[0]!;
    const applied = await handoff.applyTexture({ fileKey: h.api.fileKey, pageId: h.page.id, nodeId: h.source.id, expected: (await handoff.inspectTexture(h.source.id, h.api.fileKey, h.page.id)).expected, recipe });
    expect(applied.state).toBe("tagged");
    expect(applied.noiseCount).toBe(1);
    expect(applied.textureCount).toBe(1);
    // A native-panel density edit surfaces as the designer's own change, and
    // a stale expected state is rejected without writing.
    h.source.effects = [
      { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: .3 }, offset: { x: 0, y: 2 }, radius: 4, visible: true, blendMode: "NORMAL" },
      ...h.source.effects.filter((effect: Effect) => effect.type === "NOISE" || effect.type === "TEXTURE")
        .map((effect: Effect) => effect.type === "NOISE" ? { ...effect, density: 0.8 } : effect),
    ];
    const edited = await handoff.inspectTexture(h.source.id, h.api.fileKey, h.page.id);
    expect(edited.state).toBe("customized");
    expect(edited.customized).toEqual(["grain"]);
    expect(edited.nativeExtras).toMatchObject({ "noise.noiseType": "MONOTONE" });
    await expect(handoff.applyTexture({ fileKey: h.api.fileKey, pageId: h.page.id, nodeId: h.source.id, expected: applied.expected, recipe, material: recipe.material })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(h.source.effects.filter((effect: Effect) => effect.type === "NOISE")[0]?.["density"]).toBe(0.8);
    expect(h.source.getSharedPluginData("worldbend", "texture")).toBe(JSON.stringify(recipe));
  });

  it("projects native geometry through the visible capture window and refuses window drift before publication", async () => {
    vi.useFakeTimers(); const h = host(), source = h.vector();
    source.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }];
    Object.assign(source, { strokeWeight: 8, strokeAlign: "CENTER", strokeCap: "NONE",
      strokeJoin: "MITER", strokeMiterLimit: 4, dashPattern: [],
      absoluteRenderBounds: { x: -4, y: -4, width: 108, height: 58 } });
    // The full-appearance route asks the native host to outline, rather than
    // incorrectly using centerline bounds as its complete-domain witness.
    // This fixture models the native ring of this one centered8px rectangle;
    // it is not a generic adapter-local stroke/Boolean implementation.
    const clone=source.clone;
    source.clone=()=>{const copy=clone();copy.outlineStroke=()=>{
      const outline=h.vector();outline.x=-4;outline.y=-4;outline.width=108;outline.height=58;
      outline.fills=structuredClone(source.strokes);
      outline.vectorNetwork={vertices:[{x:0,y:0},{x:108,y:0},{x:108,y:58},{x:0,y:58},{x:8,y:8},{x:100,y:8},{x:100,y:50},{x:8,y:50}],
        segments:Array.from({length:8},(_,i)=>({start:i,end:i<4?(i+1)%4:4+(i-3)%4})),regions:[{windingRule:"EVENODD",loops:[[0,1,2,3],[4,5,6,7]]}]};return outline;};return copy;};
    (h.api as any).flatten=vi.fn((nodes:any[])=>{
      const result=h.vector(),vertices:any[]=[],segments:any[]=[],regions:any[]=[];
      for(const node of nodes){const [[a,c,e],[b,d,f]]=node.absoluteTransform,vo=vertices.length,so=segments.length;
        vertices.push(...node.vectorNetwork.vertices.map((p:any)=>({x:a*p.x+c*p.y+e,y:b*p.x+d*p.y+f})));
        segments.push(...node.vectorNetwork.segments.map((s:any)=>({...s,start:s.start+vo,end:s.end+vo})));
        regions.push(...node.vectorNetwork.regions.map((r:any)=>({...r,fills:r.fills??node.fills,loops:r.loops.map((l:number[])=>l.map(i=>i+so))})));node.remove();}
      const x=Math.min(...vertices.map(v=>v.x)),y=Math.min(...vertices.map(v=>v.y));result.x=x;result.y=y;
      result.width=Math.max(...vertices.map(v=>v.x))-x;result.height=Math.max(...vertices.map(v=>v.y))-y;
      result.vectorNetwork={vertices:vertices.map(v=>({x:v.x-x,y:v.y-y})),segments,regions};return result;
    });
    h.page.selection = [source]; await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const first = h.posts.findLast(p => p.type === "source");
    expect(first.payload).toMatchObject({ renderWidth: 108, renderHeight: 58, nativeVector: true });
    const payload = { generation: first.generation, sourceNodeId: source.id, spec,
      matrix: [108, 0, 0, 0, 58, 0, 0, 0, 1], renderWidth: 108, renderHeight: 58,
      placement: { x: 0, y: 0, width: 108, height: 58 } };
    h.api.ui.onmessage?.({ type: "request-native-vector-projection", payload });
    await vi.advanceTimersByTimeAsync(0);
    const relayed = h.posts.findLast(p => p.type === "native-vector-projection");
    expect(relayed.inputs[0].sourceBounds).toEqual(source.absoluteRenderBounds);
    expect(relayed.inputs[0].stroke).toBeUndefined();expect(relayed.inputs[0].path.regions).toHaveLength(2);
    expect(source.absoluteBoundingBox).toMatchObject({ width: 100, height: 50 });
    const output = await planVectorProjection(relayed.inputs[0]);
    // Paint growth can change the output domain before selectionchange arrives.
    source.absoluteRenderBounds.width += 2;
    h.api.ui.onmessage?.({ type: "apply-native-vector", payload: { ...payload,
      placement: relayed.placement, projection: { outputs: [output], sourceFingerprint: relayed.sourceFingerprint } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-error", message: { key: "nativeVectorApplyFailed" } });
    expect(h.page.children).toContain(source);
  });

  it.each(["VECTOR", "RECTANGLE"] as const)("creates, reopens, and updates a native Vector from %s through the plugin entry point", async type => {
    vi.useFakeTimers();
    const h = host(); const source = type === "VECTOR" ? h.vector() : h.api.createRectangle();
    if (type === "RECTANGLE") {
      source.width = 100; source.height = 50; source.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
      Object.assign(source, { topLeftRadius: 12, topRightRadius: 12, bottomLeftRadius: 12,
        bottomRightRadius: 12, cornerSmoothing: .4, strokeAlign: "CENTER", strokeWeight: 2,
        strokeCap: "NONE", strokeJoin: "MITER", strokeMiterLimit: 4, dashPattern: [] });
      (h.api as any).flatten = vi.fn(([temporary]: any[]) => {
        temporary.remove(); const captured = h.vector(); captured.fills = structuredClone(source.fills); return captured;
      });
    }
    h.page.selection = [source];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const first = h.posts.findLast(p => p.type === "source");
    expect(first).toMatchObject({ payload: { sourceNodeId: source.id, vectorSource: true, nativeVector: true } });
    if (type === "RECTANGLE") expect((h.api as any).flatten).not.toHaveBeenCalled();
    const undoBoundaries: string[] = [];
    const documentState = (nodes: any[]): any[] => nodes.map(node => ({
      id: node.id, type: node.type, network: node.vectorNetwork,
      operation: readStoredOperation(node), children: documentState(node.children ?? []),
    }));
    h.api.commitUndo.mockImplementation(() => undoBoundaries.push(JSON.stringify(documentState(h.page.children))));

    // Phase 1: the main thread maps the fresh source onto the shared core
    // input and hands it to the UI.
    h.api.ui.onmessage?.({ type: "request-native-vector-projection", payload: {
      generation: first.generation, sourceNodeId: source.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: { x: 0, y: 0, width: 100, height: 50 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const relayed = h.posts.findLast(p => p.type === "native-vector-projection");
    expect(relayed).toMatchObject({ generation: first.generation,
      sourceFingerprint: expect.stringMatching(/^source32x2:/) });
    expect(relayed.inputs).toHaveLength(1);
    expect(relayed.inputs[0]!.schema).toBe("worldbend.vector-projection");
    expect(relayed.placement).toMatchObject({ width: 100, height: 50 });

    // Phase 2: the UI relays through the shared WASM core and applies.
    const output = await planVectorProjection(relayed.inputs[0]!);
    expect(output.report.fidelity).toBe("exact");
    h.api.ui.onmessage?.({ type: "apply-native-vector", payload: {
      generation: first.generation, sourceNodeId: source.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: relayed.placement,
      projection: { outputs: [output], sourceFingerprint: relayed.sourceFingerprint },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const created = h.posts.at(-1);
    expect(created).toMatchObject({ type: "apply-complete", operation: "apply",
      vectorFidelity: { class: "exact" } });
    // The visible completion toast reports the same fidelity as the status
    // region, not the generic applied copy.
    expect(h.api.notify).toHaveBeenCalledWith("Native Vector applied exactly.");
    const result = h.registry.get(created.targetNodeId);
    expect((await nativeVectorDocumentParts(result)).contents[0]!.type).toBe("VECTOR");
    // Prior user content is sealed before any capture/preparation mutation;
    // the next publication records the complete artifact as its starting
    // point. No post-write checkpoint may turn active-plugin Undo into a no-op.
    expect(undoBoundaries).toHaveLength(1);
    expect(JSON.parse(undoBoundaries[0]!).map((node: any) => node.id)).toEqual([h.source.id, source.id]);

    h.page.selection = [result]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    const reopened = h.posts.findLast(p => p.type === "source");
    expect(reopened).toMatchObject({ payload: {
      sourceNodeId: source.id, targetNodeId: result.id, nativeVectorTarget: true,
    } });

    h.api.ui.onmessage?.({ type: "request-native-vector-projection", payload: {
      generation: reopened.generation, sourceNodeId: source.id, targetNodeId: result.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: { x: result.x, y: result.y, width: 100, height: 50 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const secondRelay = h.posts.findLast(p => p.type === "native-vector-projection");
    const secondOutput = await planVectorProjection(secondRelay.inputs[0]!);
    h.api.ui.onmessage?.({ type: "apply-native-vector", payload: {
      generation: reopened.generation, sourceNodeId: source.id, targetNodeId: result.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: secondRelay.placement,
      projection: { outputs: [secondOutput], sourceFingerprint: secondRelay.sourceFingerprint },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", operation: "replace", targetNodeId: result.id });
    expect((await nativeVectorDocumentParts(result)).record.sourceNodeId).toBe(source.id);
    expect(undoBoundaries).toHaveLength(2);
    expect(JSON.parse(undoBoundaries[1]!).map((node: any) => node.id)).toEqual([h.source.id, source.id, result.id]);
    // A core-refused Update publishes a disclosed independent HD fallback,
    // not a raster replacement of the selected Vector or its source.
    const retained = await nativeVectorDocumentParts(result);
    const retainedParts = retained.contents.map(part => ({ id: part.id,
      network: structuredClone(part.vectorNetwork), fills: structuredClone(part.fills) }));
    const retainedBinding = readStoredBinding(result);
    const retainedSource = { width: source.width, height: source.height,
      fills: structuredClone(source.fills), network: structuredClone(source.vectorNetwork) };
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation: reopened.generation, sourceNodeId: source.id, targetNodeId: result.id, spec,
      bytes: new Uint8Array([9]), renderWidth: 200, renderHeight: 100,
      placement: { x: result.x, y: result.y, width: 100, height: 50 }, nativeVectorFallback: true,
    } });
    await vi.advanceTimersByTimeAsync(0);
    const fallback = h.posts.at(-1);
    expect(fallback).toMatchObject({ type: "apply-complete", operation: "apply" });
    expect(fallback.targetNodeId).not.toBe(result.id);
    const image = h.registry.get(fallback.targetNodeId);
    expect(image.type).toBe("RECTANGLE");
    expect(readStoredBinding(image)?.sourceNodeIds).toEqual([source.id]);
    expect(readStoredBinding(result)).toEqual(retainedBinding);
    const afterFallback = await nativeVectorDocumentParts(result);
    expect(afterFallback.record).toEqual(retained.record);
    expect(afterFallback.contents.map(part => ({ id: part.id,
      network: part.vectorNetwork, fills: part.fills }))).toEqual(retainedParts);
    expect(source.removed).toBe(false);
    expect({ width: source.width, height: source.height,
      fills: source.fills, network: source.vectorNetwork }).toEqual(retainedSource);
    expect(h.api.notify).toHaveBeenLastCalledWith(
      "Native Vector can't project this path faithfully, so an HD image was created instead.");
    // Reopening and reusing an unchanged source must not resolve availability
    // by writing to the host, which would erase native redo.
    if (type === "RECTANGLE") expect((h.api as any).flatten).toHaveBeenCalledOnce();
  });

  it("creates, reopens, and updates a whole-Frame native Vector through the plugin entry point", async () => {
    vi.useFakeTimers();
    const h = host();
    const poster = h.frame();
    poster.name = "Poster"; poster.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
    poster.clipsContent = false; poster.resize(100, 50);
    for (const index of [0, 1]) {
      const rect = h.api.createRectangle();
      rect.resize(40, 20); rect.x = 10 + index * 30; rect.y = 10;
      rect.fills = [{ type: "SOLID", color: { r: 1 - index * .5, g: 0, b: 0 } }];
      poster.appendChild(rect);
    }
    (h.api as any).flatten = vi.fn((nodes: any[]) => {
      const first: any = nodes[0];
      for (const node of nodes) node.remove();
      const captured = h.vector();
      captured.fills = structuredClone(first.fills ?? []);
      // Real flattening resolves geometry into the layer's own bounds; the
      // stub scales its square network the same way.
      captured.x = first.x; captured.y = first.y; captured.resize(first.width, first.height);
      const scaleX = first.width / 100, scaleY = first.height / 50;
      captured.vectorNetwork = {
        vertices: [{ x: 0, y: 0 }, { x: 100 * scaleX, y: 0 }, { x: 100 * scaleX, y: 50 * scaleY }, { x: 0, y: 50 * scaleY }],
        segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 }],
        regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }],
      };
      return captured;
    });
    h.page.selection = [poster];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const first = h.posts.findLast(p => p.type === "source");
    expect(first).toMatchObject({ payload: { sourceNodeId: poster.id,
      vectorSource: true, artworkSource: true, nativeVector: true } });

    h.api.ui.onmessage?.({ type: "request-native-vector-projection", payload: {
      generation: first.generation, sourceNodeId: poster.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: { x: 0, y: 0, width: 100, height: 50 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const relayed = h.posts.findLast(p => p.type === "native-vector-projection");
    // One core input per captured layer: the frame background plus two rects.
    expect(relayed.inputs).toHaveLength(3);
    const outputs = [];
    for (const input of relayed.inputs) outputs.push(await planVectorProjection(input));
    h.api.ui.onmessage?.({ type: "apply-native-vector", payload: {
      generation: first.generation, sourceNodeId: poster.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: relayed.placement,
      projection: { outputs, sourceFingerprint: relayed.sourceFingerprint },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const created = h.posts.at(-1);
    expect(created).toMatchObject({ type: "apply-complete", operation: "apply",
      vectorFidelity: { class: "exact", reasons: [] } });
    const result = h.registry.get(created.targetNodeId);
    const parts = await nativeVectorDocumentParts(result);
    expect(result.children).toHaveLength(3);
    expect(parts.record.version).toBe("0.3");
    expect(parts.record.parts).toHaveLength(3);
    // The original frame keeps its own children untouched.
    expect(poster.children).toHaveLength(2);

    h.page.selection = [result]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    const reopened = h.posts.findLast(p => p.type === "source");
    expect(reopened).toMatchObject({ payload: {
      sourceNodeId: poster.id, targetNodeId: result.id, nativeVectorTarget: true, artworkSource: true,
    } });
    h.api.ui.onmessage?.({ type: "request-native-vector-projection", payload: {
      generation: reopened.generation, sourceNodeId: poster.id, targetNodeId: result.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: { x: result.x, y: result.y, width: 100, height: 50 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const secondRelay = h.posts.findLast(p => p.type === "native-vector-projection");
    const secondOutputs = [];
    for (const input of secondRelay.inputs) secondOutputs.push(await planVectorProjection(input));
    h.api.ui.onmessage?.({ type: "apply-native-vector", payload: {
      generation: reopened.generation, sourceNodeId: poster.id, targetNodeId: result.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: secondRelay.placement,
      projection: { outputs: secondOutputs, sourceFingerprint: secondRelay.sourceFingerprint },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", operation: "replace", targetNodeId: result.id });
    expect(result.children).toHaveLength(3);
    const duplicate = result.clone(); duplicate.x = 800; duplicate.clipsContent = false;
    const oldChildren = [...result.children];
    const raw = duplicate.getSharedPluginData("worldbend", "nativeVector");
    duplicate.setSharedPluginData.mockClear();
    h.page.selection = [duplicate]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    const copied = h.posts.findLast(p => p.type === "source");
    expect(copied).toMatchObject({payload:{targetNodeId:duplicate.id,sourceNodeId:poster.id,nativeVectorTarget:true}});
    expect(duplicate.setSharedPluginData).not.toHaveBeenCalled();
    expect(duplicate.getSharedPluginData("worldbend", "nativeVector")).toBe(raw);
    h.api.ui.onmessage?.({type:"request-native-vector-projection",payload:{generation:copied.generation,
      sourceNodeId:poster.id,targetNodeId:duplicate.id,spec,matrix:[100,0,0,0,50,0,0,0,1],renderWidth:100,renderHeight:50,
      placement:{x:800,y:0,width:100,height:50}}});
    await vi.advanceTimersByTimeAsync(0);
    const copiedRelay=h.posts.findLast(p=>p.type==="native-vector-projection");
    const copiedOutputs=await Promise.all(copiedRelay.inputs.map(planVectorProjection));
    h.api.ui.onmessage?.({type:"apply-native-vector",payload:{generation:copied.generation,
      sourceNodeId:poster.id,targetNodeId:duplicate.id,spec,matrix:[100,0,0,0,50,0,0,0,1],renderWidth:100,renderHeight:50,
      placement:copiedRelay.placement,projection:{outputs:copiedOutputs,sourceFingerprint:copiedRelay.sourceFingerprint}}});
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({type:"apply-complete",operation:"replace",targetNodeId:duplicate.id});
    expect((await nativeVectorDocumentParts(duplicate)).copied).toBe(false);
    expect(duplicate.x).toBe(800);
    expect(result.children).toEqual(oldChildren);
  });

  it("rejects an apply whose projection was computed from a different source state", async () => {
    vi.useFakeTimers();
    const h = host(); const source = h.vector(); h.page.selection = [source];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const first = h.posts.findLast(p => p.type === "source");
    h.api.ui.onmessage?.({ type: "request-native-vector-projection", payload: {
      generation: first.generation, sourceNodeId: source.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: { x: 0, y: 0, width: 100, height: 50 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const relayed = h.posts.findLast(p => p.type === "native-vector-projection");
    const output = await planVectorProjection(relayed.inputs[0]!);

    // The source changes after the projection was computed.
    source.vectorNetwork = { ...source.vectorNetwork,
      vertices: [{ x: 4, y: 4 }, ...source.vectorNetwork.vertices.slice(1)] };
    h.api.ui.onmessage?.({ type: "apply-native-vector", payload: {
      generation: first.generation, sourceNodeId: source.id, spec,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], renderWidth: 100, renderHeight: 50,
      placement: relayed.placement,
      projection: { outputs: [output], sourceFingerprint: relayed.sourceFingerprint },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-error",
      message: { key: "nativeVectorApplyFailed" } });
    expect(h.page.children).toContain(source);
    expect(h.page.children.every((child: any) => child.type !== "FRAME" || child === h.source)).toBe(true);
  });

  it.each(["source", "bundled"] as const)("stages Composition on the same Figma result without publishing pixels (%s)", async (entry) => {
    const h = host();
    const sources = [h.source, h.frame()];
    const result = h.api.createRectangle();
    result.resize(600, 400);
    result.setPluginData("worldbend.renderWidth", "600");
    result.setPluginData("worldbend.renderHeight", "400");
    writeStoredOperation(result, { kind: "task", task: mockupTask() });
    writeStoredBinding(result, { sourceNodeIds: sources.map(node => node.id), renderWidth: 600, renderHeight: 400 });
    result.getPluginData = () => { throw new Error("private plugin data is unavailable in Figma MCP"); };
    const handoff = await loadAgentHandoff(entry);
    const snapshot = await handoff.inspectMockup(result.id, "granted-file", "page");
    expect(snapshot).toMatchObject({
      schema: "worldbend.figma.mockup-handoff", revision: 1,
      sourceNodeIds: sources.map(node => node.id), task: mockupTask(),
      sources: [{ slotId: "source-1", nodeId: sources[0].id, name: "Editable source" },
        { slotId: "source-2", nodeId: sources[1].id, name: "Card" }],
    });
    expect(snapshot.sources.every(source => /^preview32x2:\d+:[0-9a-f]{16}$/.test(source.previewFingerprint))).toBe(true);
    const staged = mockupTask(.4);
    const nativeClone = globalThis.structuredClone;
    vi.stubGlobal("structuredClone", undefined);
    let after: Awaited<ReturnType<typeof handoff.stageMockup>>;
    try {
      after = await handoff.stageMockup({
        fileKey: "granted-file", pageId: "page", nodeId: result.id, expected: snapshot.expected, task: staged,
      });
    } finally {
      vi.stubGlobal("structuredClone", nativeClone);
    }
    expect(after.task).toEqual(mockupTask());
    expect(after.draft).toMatchObject({ baseRevision: 1, task: staged });
    expect(readStoredOperation(result)).toEqual({ status: "valid", operation: { kind: "task", task: mockupTask() } });
    expect(result.fills).toEqual([]);
    await expect(handoff.stageMockup({
      fileKey: "granted-file", pageId: "page", nodeId: result.id, expected: snapshot.expected, task: mockupTask(.2),
    })).rejects.toThrow("E_FIGMA_CONFLICT");
    sources[0].exportAsync.mockResolvedValue(new Uint8Array([9, 8, 7]));
    await expect(handoff.stageMockup({
      fileKey: "granted-file", pageId: "page", nodeId: result.id, expected: after.expected, task: mockupTask(.2),
    })).rejects.toThrow("E_FIGMA_CONFLICT");
    sources[0].width = 530;
    await expect(handoff.stageMockup({
      fileKey: "granted-file", pageId: "page", nodeId: result.id, expected: after.expected, task: mockupTask(.2),
    })).rejects.toThrow("E_FIGMA_CONFLICT");
    h.registry.delete(sources[1].id);
    await expect(handoff.inspectMockup(result.id, "granted-file", "page")).rejects.toThrow("E_FIGMA_STATE");
  });

  it.each(["source", "bundled"] as const)("recovers an unusable Composition draft through a fresh guarded stage (%s)", async (entry) => {
    const h = host();
    const sources = [h.source, h.frame()];
    const result = h.api.createRectangle();
    result.resize(600, 400);
    writeStoredOperation(result, { kind: "task", task: mockupTask() });
    writeStoredBinding(result, { sourceNodeIds: sources.map(node => node.id), renderWidth: 600, renderHeight: 400 });
    result.setSharedPluginData("worldbend", "mockupDraft", "{broken");
    const handoff = await loadAgentHandoff(entry);
    const snapshot = await handoff.inspectMockup(result.id, "granted-file", "page");
    expect(snapshot).toMatchObject({ draftIssue: "invalid-or-stale", task: mockupTask() });
    expect(snapshot).not.toHaveProperty("draft");
    const recovered = await handoff.stageMockup({
      fileKey: "granted-file", pageId: "page", nodeId: result.id, expected: snapshot.expected,
      task: mockupTask(.4),
    });
    expect(recovered.draft).toMatchObject({ baseRevision: 1, task: mockupTask(.4) });
    await expect(handoff.stageMockup({
      fileKey: "granted-file", pageId: "page", nodeId: result.id, expected: snapshot.expected,
      task: mockupTask(.6),
    })).rejects.toThrow("E_FIGMA_CONFLICT");
  });

  it.each(["source", "bundled"] as const)("stages a Spatial draft without changing the published recipe or pixels (%s)", async (entry) => {
    const h = host();
    const sources = [h.source, h.frame(), h.frame()];
    const result = h.api.createRectangle();
    result.resize(600, 400);
    result.setPluginData("renderWidth", "600");
    result.setPluginData("renderHeight", "400");
    writeStoredOperation(result, { kind: "task", task: spatialTask() });
    writeStoredBinding(result, { sourceNodeIds: sources.map(node => node.id), renderWidth: 600, renderHeight: 400 });
    result.getPluginData = () => { throw new Error("private plugin data is unavailable in Figma MCP"); };
    const handoff = await loadAgentHandoff(entry);
    const snapshot = await handoff.inspectEffect(result.id, "granted-file", "page");
    expect(snapshot).toMatchObject({
      schema: "worldbend.figma.effect-handoff", revision: 1,
      sourceNodeIds: sources.map(node => node.id), task: spatialTask(),
    });
    const staged = spatialTask(.45);
    const nativeClone = globalThis.structuredClone;
    vi.stubGlobal("structuredClone", undefined);
    let after: Awaited<ReturnType<typeof handoff.stageEffect>>;
    try {
      after = await handoff.stageEffect({
        fileKey: "granted-file", pageId: "page", nodeId: result.id,
        expected: snapshot.expected, task: staged,
        fingerprint: `sha256:${"b".repeat(64)}`,
      });
    } finally {
      vi.stubGlobal("structuredClone", nativeClone);
    }
    expect(after.task).toEqual(spatialTask());
    expect(after.draft).toMatchObject({ baseRevision: 1, task: staged });
    expect(readStoredOperation(result)).toEqual({ status: "valid", operation: { kind: "task", task: spatialTask() } });
    await expect(handoff.stageEffect({
      fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: snapshot.expected, task: spatialTask(-.4),
      fingerprint: `sha256:${"c".repeat(64)}`,
    })).rejects.toThrow("E_FIGMA_CONFLICT");
  });

  it("distinguishes an empty canvas selection from an unsupported selection and recovers", async () => {
    vi.useFakeTimers();
    const h = host(); h.page.selection = [];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-error", message: { key: "selectOneSource" } });
    h.page.selection = Array.from({ length: 10 }, () => h.frame()); h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-error", message: { key: "selectOneOrPair" } });
    expect(h.source.exportAsync).not.toHaveBeenCalled();
    h.page.selection = [h.source]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts.findLast(p => p.type === "source")).toMatchObject({ payload: { sourceNodeId: h.source.id } });
  });

  it("follows Frame → A → B → Frame and keeps each effect bound to the chosen workpiece", async () => {
    vi.useFakeTimers();
    const h = host();
    const a = h.frame(); a.name = "A"; a.resize(160, 100); h.source.appendChild(a);
    const b = h.frame(); b.name = "B"; b.resize(100, 180); h.source.appendChild(b);
    h.page.selection = [h.source];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const workpieces = [a, b, h.source];
    const results = [];
    for (const [index, workpiece] of workpieces.entries()) {
      h.page.selection = [workpiece]; h.handlers.get("selectionchange")?.();
      await vi.advanceTimersByTimeAsync(150);
      const source = h.posts.findLast(p => p.type === "source");
      expect(source).toMatchObject({ payload: { sourceNodeId: workpiece.id, sourceName: workpiece.name } });
      const effect = structuredClone(spec); effect.destination.quad.tl.x = (index + 1) / 10;
      h.api.ui.onmessage?.({ type: "apply", payload: {
        generation: source.generation, sourceNodeId: workpiece.id, spec: effect, bytes: new Uint8Array([index + 4]),
        renderWidth: workpiece.width * 2, renderHeight: workpiece.height * 2,
        placement: { x: 800, y: 0, width: workpiece.width, height: workpiece.height },
      } });
      await vi.advanceTimersByTimeAsync(0);
      const published = h.registry.get(h.posts.findLast(p => p.type === "apply-complete").targetNodeId);
      expect(readStoredBinding(published)?.sourceNodeIds).toEqual([workpiece.id]);
      expect(readStoredOperation(published)).toEqual({ status: "valid", operation: { kind: "transform", spec: effect } });
      results.push(published);
      // After decorating a child, it can be assembled into the containing
      // Frame before that Frame receives its own independent effect.
      if (index < 2) h.source.appendChild(published);
    }
    expect(results[0].parent).toBe(h.source); expect(results[1].parent).toBe(h.source);
    expect(a.width).toBe(160); expect(b.height).toBe(180);
    // Returning from the whole to A is another target change, not a sticky
    // Frame session. A source change continues that exact child.
    h.page.selection = [a]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    a.exportAsync.mockResolvedValue(new Uint8Array([9]));
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: a.id, node: a }] });
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", payload: { sourceNodeId: a.id, bytes: new Uint8Array([9]) } });
  });

  it("rejects the former whole-Frame apply when a child becomes the live target before selection delivery", async () => {
    vi.useFakeTimers();
    const h = host();
    const child = h.frame(); h.source.appendChild(child);
    h.page.selection = [h.source];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const before = h.page.children.map((n: { id: string }) => n.id);
    h.page.selection = [child];
    // The host has changed selection, but its event is still queued. The
    // publication boundary must inspect the actual workpiece itself.
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation: 1, sourceNodeId: h.source.id, spec, bytes: new Uint8Array([4]),
      renderWidth: 1040, renderHeight: 1212,
      placement: { x: 800, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-error", message: { key: "selectionChanged" } });
    expect(h.page.children.map((n: { id: string }) => n.id)).toEqual(before);
    expect(h.api.createImage).not.toHaveBeenCalled();
  });


  it("stores card rigs beside the artwork, reopens them, and publishes named stills with provenance", async () => {
    vi.useFakeTimers();
    const h = host();
    try {
      await import("./main");
      h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
      await vi.advanceTimersByTimeAsync(0);
      h.page.selection = [h.source];
      h.pageHandlers.get("selectionchange")?.();
      await vi.advanceTimersByTimeAsync(200);
      h.api.ui.onmessage?.({ type: "request-card-state" });
      await vi.advanceTimersByTimeAsync(0);
      const state = h.posts.findLast(p => p.type === "card-state");
      expect(state.nodes[0].nodeId).toBe(h.source.id);
      expect(state.nodes[0].rig).toBeUndefined();
      h.source.absoluteRenderBounds = {...h.source.absoluteBoundingBox, width: 552, height: 638};
      await h.api.ui.onmessage?.({type:"request-card-state"});
      await vi.advanceTimersByTimeAsync(0);
      const fullBounds = h.posts.findLast(p=>p.type==="card-state").nodes[0];
      expect(fullBounds.width).toBe(552); expect(fullBounds.height).toBe(638);
      h.source.absoluteRenderBounds = undefined;
      const rig = {
        schema: "worldbend.card", version: "0.1",
        elementSize: { width: 520, height: 606 },
        geometry: { perspective: 1100 },
        tilt: { maxRotateX: 10, maxRotateY: 14 },
        action: { axis: "y", direction: 1, turns: 2, durationMs: 700 },
      };
      await h.api.ui.onmessage?.({ type: "apply-card-rig", generation: state.generation, rig });
      expect(h.posts.findLast(p => p.type === "card-rig-applied")?.generation).toBe(state.generation);
      expect(JSON.parse(h.source.getSharedPluginData("worldbend", "card")).rig.action.turns).toBe(2);
      const loadCount=h.posts.filter(p=>p.type==="selection-loading").length;
      h.pageHandlers.get("nodechange")?.({nodeChanges:[{type:"PROPERTY_CHANGE",id:h.source.id,node:h.source,properties:["pluginData"]}]});
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.filter(p=>p.type==="selection-loading")).toHaveLength(loadCount);
      h.api.ui.onmessage?.({ type: "request-card-state" });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.findLast(p => p.type === "card-state")?.nodes[0].rig.action.turns).toBe(2);
      // A stale apply cannot overwrite the stored rig.
      await h.api.ui.onmessage?.({
        type: "apply-card-rig", generation: state.generation + 10,
        rig: { ...rig, action: { ...rig.action, turns: 8 } },
      });
      expect(h.posts.findLast(p => p.type === "card-error")).toBeTruthy();
      expect(JSON.parse(h.source.getSharedPluginData("worldbend", "card")).rig.action.turns).toBe(2);
      // A named still lands beside the artwork with its own provenance.
      const unrelated = h.api.createRectangle();
      unrelated.x = 90000;
      unrelated.resize(200,200);
      unrelated.setSharedPluginData("worldbend", "card-still", JSON.stringify({
        schema:"worldbend.card-still",sourceNodeId:"another-workpiece",viewId:"another-view",
      }));
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      await h.api.ui.onmessage?.({
        type: "publish-card-still", generation: state.generation, requestId: 1,
        name: "Turn 50% · Card", viewId: "derived-8", face: "front", view: { rotateY: 360 }, rig,
        bytes: png, renderWidth: 200, renderHeight: 160,
      });
      const published = h.posts.findLast(p => p.type === "card-still-published");
      expect(published?.generation).toBe(state.generation);
      const still = h.page.children.find((node: any) => node.type === "RECTANGLE" && node.name === "Turn 50% · Card");
      expect(still).toBeTruthy();
      expect(still.fills[0].imageHash).toBe("rendered");
      expect(still.x).toBeGreaterThan(h.source.x + h.source.width);
      expect(still.x).toBe(h.source.absoluteBoundingBox.x + h.source.absoluteBoundingBox.width + 48);
      expect(JSON.parse(still.getSharedPluginData("worldbend", "card-still")).view.rotateY).toBe(360);
      // Re-publishing the same view updates its linked result in place.
      still.name = "Hero · hover left";
      await h.api.ui.onmessage?.({ type: "publish-card-still", generation: state.generation, requestId: 2,
        name: "Turn 50% · Card", viewId: "derived-8", face: "front", view: { rotateY: 360 }, rig,
        bytes: png, renderWidth: 240, renderHeight: 180 });
      expect(h.posts.findLast(p => p.type === "card-still-published")?.nodeId).toBe(still.id);
      expect(still.width).toBe(240);
      expect(still.name).toBe("Hero · hover left");
      // A failed metadata write must not leave new pixels or dimensions in
      // the already published, identity-preserving result.
      const beforeFailedUpdate = {name: still.name, width: still.width, height: still.height,
        fills: structuredClone(still.fills), record: still.getSharedPluginData("worldbend", "card-still")};
      vi.spyOn(still, "setSharedPluginData").mockImplementationOnce(() => {throw new Error("storage write rejected");});
      await h.api.ui.onmessage?.({type: "publish-card-still", generation: state.generation, requestId: 3,
        name: "Changed generated name", viewId: "derived-8", face: "front", view: {rotateY: 20}, rig,
        bytes: png, renderWidth: 300, renderHeight: 220});
      expect(h.posts.findLast(p => p.type === "card-error")?.requestId).toBe(3);
      expect({name: still.name, width: still.width, height: still.height,
        fills: still.fills, record: still.getSharedPluginData("worldbend", "card-still")}).toEqual(beforeFailedUpdate);
      h.source.exportAsync = vi.fn(async () => Uint8Array.from(Buffer.from(png, "base64")));
      h.page.selection = [still];
      await h.api.ui.onmessage?.({type: "request-card-state"});
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.findLast(p => p.type === "card-state").nodes[0].nodeId).toBe(h.source.id);
      expect(h.posts.findLast(p => p.type === "card-state").nodes[0].selectedStill.viewId).toBe("derived-8");
      h.page.selection = [h.source];
      // The artwork raster request answers with encoded bytes for the preview.
      h.api.ui.onmessage?.({ type: "request-card-source", generation: state.generation, requestId: 2, nodeId: h.source.id });
      await vi.advanceTimersByTimeAsync(0);
      const cardSource = h.posts.findLast(p => p.type === "card-source");
      expect(cardSource?.requestId).toBe(2);
      expect(cardSource.bytes.length).toBeGreaterThan(0);
      expect(cardSource.back).toBeUndefined();
      // An external metadata edit must not be mistaken for our queued write.
      await h.api.ui.onmessage?.({type:"apply-card-rig", generation:state.generation, rig});
      const beforeExternalEdit = h.posts.findLast(p=>p.type==="selection-loading").generation;
      h.source.setSharedPluginData("worldbend", "external-edit", "changed");
      h.pageHandlers.get("nodechange")?.({nodeChanges:[{type:"PROPERTY_CHANGE",id:h.source.id,node:h.source,properties:["pluginData"]}]});
      await vi.advanceTimersByTimeAsync(200);
      expect(h.posts.findLast(p=>p.type==="selection-loading").generation).toBe(beforeExternalEdit+1);
      // Reopening a saved view also observes the editable source, so a native
      // source edit invalidates the view even while the still is selected.
      h.page.selection = [still];
      h.handlers.get("selectionchange")?.();
      await vi.advanceTimersByTimeAsync(200);
      expect(h.posts.findLast(p=>p.type==="source").payload.cardResult).toBe(true);
      await h.api.ui.onmessage?.({type:"request-card-state"});
      const beforeSourceEdit = h.posts.findLast(p=>p.type==="selection-loading").generation;
      h.source.opacity = 0.5;
      h.pageHandlers.get("nodechange")?.({nodeChanges:[{type:"PROPERTY_CHANGE",id:h.source.id,node:h.source,properties:["opacity"]}]});
      await vi.advanceTimersByTimeAsync(200);
      expect(h.posts.findLast(p=>p.type==="selection-loading").generation).toBe(beforeSourceEdit+1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains material context edits and refreshes the shared spatial source on leaving", async () => {
    vi.useFakeTimers();
    const h = host();
    const backdrop = h.frame();
    Object.assign(h.api.ui, { resize: vi.fn() });
    vi.doMock("./material-trial", () => ({ createMaterialTrial: (input: Parameters<typeof import("./material-trial").createMaterialTrial>[0]) => ({
      request: () => input.observe(h.page.id),
      cancel: () => input.clear(),
    }) }));
    try {
      await import("./main");
      h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
      await vi.advanceTimersByTimeAsync(0);
      const source = h.posts.findLast(p => p.type === "source");
      h.api.ui.onmessage?.({ type: "material-layout", active: true });
      h.api.ui.onmessage?.({ type: "request-appearance-state" });
      h.api.ui.onmessage?.({ type: "request-texture-state" });
      h.api.ui.onmessage?.({ type: "request-material-preview", generation: source.generation, requestId: 1 });
      const before = h.posts.length;
      h.source.exportAsync.mockResolvedValue(new Uint8Array([8, 9]));
      backdrop.fills = [{ type: "SOLID", color: { r: .6, g: .2, b: .8 } }];
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: backdrop.id, node: backdrop }] });
      await vi.advanceTimersByTimeAsync(150);
      expect(h.posts.slice(before)).toContainEqual({ type: "material-context-changed", generation: source.generation });
      expect(h.posts.slice(before).some(p => p.type === "selection-loading")).toBe(false);
      h.api.ui.onmessage?.({ type: "material-layout", active: false });
      await vi.advanceTimersByTimeAsync(150);
      const refreshed = h.posts.findLast(p => p.type === "source");
      expect(refreshed).toMatchObject({ generation: source.generation + 1, payload: { bytes: new Uint8Array([8, 9]) } });
      // A native effect edit changes the target itself and requires fresh state.
      h.api.ui.onmessage?.({ type: "request-appearance-state" });
      h.api.ui.onmessage?.({ type: "request-texture-state" });
      h.api.ui.onmessage?.({ type: "request-material-preview", generation: refreshed.generation, requestId: 2 });
      const changedAt = h.posts.length;
      h.source.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: .3 }, offset: { x: 0, y: 2 }, radius: 4, visible: true, blendMode: "NORMAL" }];
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
      await vi.advanceTimersByTimeAsync(150);
      expect(h.posts.slice(changedAt).some(p => p.type === "material-context-changed")).toBe(false);
      expect(h.posts.findLast(p => p.type === "source").generation).toBe(refreshed.generation + 1);
    } finally {
      vi.doUnmock("./material-trial");
    }
  });

  it("keeps the native result operation while editing its private Content tree", async () => {
    const native = true;
    vi.useFakeTimers();
    const h = host();
    const anchor = native ? await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    }) : h.source;
    const content = native ? (await nativeDocumentParts(anchor)).content : h.source;
    const text = h.frame(); text.type = "TEXT"; content.appendChild(text);
    // Native cropping now makes this overflowing content eligible; model
    // the TEXT reads used by the read-only availability/font probe.
    text.characters = "Screen title"; text.fontName = { family: "Inter", style: "Regular" };
    text.getStyledTextSegments = () => [{ fontName: text.fontName, characters: text.characters }];
    text.x = 50; text.y = 90; text.width = 550; text.height = 114;
    h.page.selection = [anchor];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const before = h.posts.length;
    h.page.selection = [text]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts).toHaveLength(before);
    expect(text.exportAsync).not.toHaveBeenCalled();
    content.exportAsync.mockResolvedValue(new Uint8Array([8, 9]));
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: text.id, node: text }] });
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", generation: 2, payload: {
      sourceNodeId: content.id, bytes: new Uint8Array([8, 9]), ...(native ? { targetNodeId: anchor.id } : {}),
    } });
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation: 2, sourceNodeId: content.id, ...(native ? { targetNodeId: anchor.id, duplicate: true } : {}),
      spec, bytes: new Uint8Array([4]), renderWidth: 1040, renderHeight: 1212,
      placement: { x: 800, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", operation: "apply" });
    expect(h.registry.get(h.posts.at(-1).targetNodeId).y).toBe(anchor.y);
    const outside = h.frame(); h.page.selection = [outside]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", payload: { sourceNodeId: outside.id } });
  });

  it("does not capture an explicitly selected native surface as the whole wrapper", async () => {
    vi.useFakeTimers();
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { surface } = await nativeDocumentParts(result);
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    h.page.selection = [surface]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", payload: { sourceNodeId: surface.id } });
    expect(h.posts.at(-1).payload.targetNodeId).toBeUndefined();
  });

  it("follows the live selection after the anchored native result is deleted", async () => {
    vi.useFakeTimers();
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    // The real host rejects plugin-data access through a removed reference;
    // a stale editing anchor must fall through instead of breaking
    // selectionchange permanently.
    result.getSharedPluginData = () => {
      throw new Error(`in getSharedPluginData: The node with id "${result.id}" does not exist`);
    };
    result.remove();
    const next = h.frame(); next.name = "Next artwork";
    h.page.selection = [next]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", payload: { sourceNodeId: next.id } });
  });

  it.each(["native", "raster"] as const)("reopens a %s result and supports update plus independent outputs of both types", async (kind) => {
    vi.useFakeTimers();
    const h = host();
    const original = { width: h.source.width, fills: structuredClone(h.source.fills) };
    const result = kind === "native" ? await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    }) : h.api.createRectangle();
    if (kind === "raster") {
      writeStoredOperation(result, { kind: "transform", spec });
      writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 1040, renderHeight: 1212 });
    }
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const { payload, generation } = h.posts.findLast(p => p.type === "source");
    const nextSpec = structuredClone(spec); nextSpec.destination.quad.tl.x = .1;
    for (const [output, duplicate] of [[kind, false], ["native", true], ["raster", true]] as const) {
      const previous = readStoredBinding(result);
      h.api.ui.onmessage?.({ type: output === "native" ? "apply-native" : "apply", payload: {
        generation, sourceNodeId: payload.sourceNodeId, targetNodeId: result.id, spec: nextSpec,
        ...(duplicate ? { duplicate: true } : {}),
        ...(output === "native" ? { inverse: [1 / 1040, 0, 0, 0, 1 / 1212, 0, 0, 0, 1] } : { bytes: new Uint8Array([9]) }),
        renderWidth: 1040, renderHeight: 1212, placement: { x: 800, y: 0, width: 520, height: 606 },
      } });
      await vi.advanceTimersByTimeAsync(0);
      const complete = h.posts.at(-1);
      expect(complete).toMatchObject({ type: "apply-complete", operation: duplicate ? "apply" : "replace" });
      expect(complete.targetNodeId === result.id).toBe(!duplicate);
      const published = h.registry.get(complete.targetNodeId);
      expect(readStoredOperation(published)).toEqual({ status: "valid", operation: { kind: "transform", spec: nextSpec } });
      if (duplicate) expect(readStoredBinding(result)).toEqual(previous);
      if (output === "native" && duplicate) {
        expect((await nativeDocumentParts(published)).content.id).not.toBe(payload.sourceNodeId);
      } else if (output === "raster") {
        expect(readStoredBinding(published)?.sourceNodeIds).toEqual([payload.sourceNodeId]);
      }
    }
    expect(h.source.width).toBe(original.width); expect(h.source.fills).toEqual(original.fills);
  });

  it.each(["warp", "rectify"] as const)("publishes a %s raster beside an open native result", async (mode) => {
    vi.useFakeTimers(); const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const { payload, generation } = h.posts.findLast(p => p.type === "source");
    expect(payload.nativeTarget).toBe(true);
    const rasterSpec = { ...spec, content: { ...spec.content, warp: { preset: "arc" as const, amount: 0.5 } } };
    const rectification = { schema: "worldbend.rectify" as const, version: "0.1" as const,
      source: { space: "normalized" as const, quad: spec.destination.quad }, output: { width: 1040, height: 1212 } };
    // The primary Apply in Warp/Correct mode is the HD route and carries the
    // native frame's targetNodeId without a duplicate flag.
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation, sourceNodeId: payload.sourceNodeId, targetNodeId: result.id,
      ...(mode === "warp" ? { spec: rasterSpec } : { rectification }),
      bytes: new Uint8Array([9]), renderWidth: 1040, renderHeight: 1212,
      placement: { x: 800, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const complete = h.posts.at(-1);
    expect(complete).toMatchObject({ type: "apply-complete", operation: "apply" });
    expect(complete.targetNodeId).not.toBe(result.id);
    const published = h.registry.get(complete.targetNodeId);
    expect(published.type).toBe("RECTANGLE");
    expect(readStoredOperation(published)).toEqual({ status: "valid", operation: mode === "warp"
      ? { kind: "transform", spec: rasterSpec } : { kind: "rectify", spec: rectification } });
    expect(readStoredBinding(published)?.sourceNodeIds).toEqual([payload.sourceNodeId]);
    // The editable result keeps its projection instead of being overwritten.
    expect(result.type).toBe("FRAME");
    expect(await nativeDocumentParts(result)).toBeDefined();
    expect(h.api.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith(
      expect.arrayContaining([published, result]),
    );
  });

  it("keeps the live canvas preview locked, marked, reusable, and outside publication", async () => {
    vi.useFakeTimers(); const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const { payload, generation } = h.posts.findLast(p => p.type === "source");
    const preview = () => h.page.children.find((node: any) => node.getPluginData?.("sceneDraft") === "1");
    const sceneDraft = (bytes: number, placement: { x: number; y: number; width: number; height: number }) =>
      h.api.ui.onmessage?.({ type: "scene-draft", generation, bytes: new Uint8Array([bytes]),
        renderWidth: 100, renderHeight: 80, placement });
    sceneDraft(1, { x: 5, y: 6, width: 50, height: 40 });
    await vi.advanceTimersByTimeAsync(0);
    const first = preview();
    expect(first).toBeDefined();
    expect(first!.type).toBe("RECTANGLE");
    expect(first!.locked).toBe(true);
    expect(first!.name).toBe("Editable source · Worldbend Working Preview");
    expect(first).toMatchObject({ x: 5, y: 6, width: 50, height: 40 });
    expect(h.api.commitUndo).toHaveBeenCalledTimes(1);

    // Updates reuse one node and create no per-frame host history.
    sceneDraft(2, { x: 7, y: 8, width: 60, height: 30 });
    await vi.advanceTimersByTimeAsync(0);
    expect(preview()).toBe(first);
    expect(h.api.commitUndo).toHaveBeenCalledTimes(1);

    // Publication clears preview feedback before writing the real result.
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation, sourceNodeId: payload.sourceNodeId, spec,
      bytes: new Uint8Array([9]), renderWidth: 520, renderHeight: 606,
      placement: { x: 0, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(preview()).toBeUndefined();
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete" });
    expect(h.api.triggerUndo).not.toHaveBeenCalled();

    // A stale-generation frame cannot revive the working preview.
    h.api.ui.onmessage?.({ type: "scene-draft", generation: generation + 99,
      bytes: new Uint8Array([4]), renderWidth: 10, renderHeight: 8,
      placement: { x: 0, y: 0, width: 10, height: 8 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(preview()).toBeUndefined();
    expect(h.api.createRectangle).toHaveBeenCalledTimes(2); // preview + published result
  });

  it.each(["existing", "new"])("ignores %s foreign preview deletion while still refreshing deleted artwork", async (kind) => {
    vi.useFakeTimers(); const h = host();
    const foreign = h.api.createRectangle();
    foreign.setPluginData("sceneDraft", "1");
    foreign.setPluginData("sceneDraftSession", "foreign-session-0001");
    if (kind === "new") h.page.children = h.page.children.filter((node: any) => node !== foreign);
    const child = h.api.createRectangle(); h.source.appendChild(child);
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    if (kind === "new") {
      h.page.children.push(foreign);
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "CREATE", id: foreign.id, node: foreign }] });
    }
    const before = h.posts.length;
    const exports = h.source.exportAsync.mock.calls.length;
    foreign.remove();
    // Deleted host nodes no longer expose private data or ancestry.
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "DELETE", id: foreign.id }] });
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts.slice(before).filter(p => p.type === "selection-loading")).toEqual([]);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(exports);

    // Remove artwork that was present in the exported snapshot, rather than
    // constructing and removing a new child without any host CREATE event.
    child.remove();
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "DELETE", id: child.id }] });
    await vi.advanceTimersByTimeAsync(150);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(exports + 1);
  });

  it("preserves native redo at startup and page reads, sweeping retired drafts only during explicit publication", async () => {
    vi.useFakeTimers(); const h = host();
    const leftover = h.api.createRectangle();
    leftover.setPluginData("sceneDraft", "1");
    leftover.setPluginData("sceneDraftSession", "prior-run-00001");
    leftover.setPluginData("sceneDraftRetired", "1");
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.page.children).toContain(leftover);
    expect(h.page.children).toContain(h.source);
    expect(h.api.commitUndo).not.toHaveBeenCalled();
    expect(h.api.triggerUndo).not.toHaveBeenCalled();
    h.handlers.get("currentpagechange")?.(); await vi.advanceTimersByTimeAsync(150);
    expect(h.page.children).toContain(leftover); expect(h.api.commitUndo).not.toHaveBeenCalled();
    const { payload, generation } = h.posts.findLast(p => p.type === "source");
    h.api.ui.onmessage?.({ type: "apply", payload: { generation, sourceNodeId: payload.sourceNodeId, spec,
      bytes: new Uint8Array([9]), renderWidth: 520, renderHeight: 606,
      placement: { x: 0, y: 0, width: 520, height: 606 } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(leftover.removed).toBe(true);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete" });
  });

  it("preserves an unretired preview from another active plugin session", async () => {
    vi.useFakeTimers(); const h = host();
    const other = h.api.createRectangle();
    other.setPluginData("sceneDraft", "1");
    other.setPluginData("sceneDraftSession", "other-live-0001");
    other.setPluginData("sceneDraftRetired", "0");
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.page.children).toContain(other);
    expect(h.api.commitUndo).not.toHaveBeenCalled();
  });

  it("removes pending native Vector preparations synchronously on plugin close and cannot commit the resumed old write", async () => {
    vi.useFakeTimers(); const h = host(), source = h.vector(); h.page.selection = [source];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const first = h.posts.findLast(p => p.type === "source");
    const placement={x:0,y:0,width:100,height:50},matrix=[100,0,0,0,50,0,0,0,1];
    const boundaries:any[][]=[];h.api.commitUndo.mockImplementation(()=>{boundaries.push([...h.page.children]);});
    h.api.ui.onmessage?.({type:"request-native-vector-projection",payload:{generation:first.generation,sourceNodeId:source.id,spec,matrix,renderWidth:100,renderHeight:50,placement}});
    await vi.advanceTimersByTimeAsync(0);
    const relayed=h.posts.findLast(p=>p.type==="native-vector-projection"),output=await planVectorProjection(relayed.inputs[0]);
    expect(boundaries).toEqual([[h.source,source]]);
    const original=JSON.stringify(source.vectorNetwork),create=h.api.createVector;
    let resume!:()=>void,preparation:any;
    const paused=new Promise<void>(resolve=>{resume=resolve;});
    h.api.createVector=vi.fn(()=>{const node=create();preparation=node;const write=node.setVectorNetworkAsync;
      node.setVectorNetworkAsync=vi.fn(async(network:VectorNetwork)=>{await paused;return write(network);});return node;});
    h.api.ui.onmessage?.({type:"apply-native-vector",payload:{generation:first.generation,sourceNodeId:source.id,spec,matrix,
      renderWidth:100,renderHeight:50,placement,projection:{outputs:[output],sourceFingerprint:relayed.sourceFingerprint}}});
    await vi.advanceTimersByTimeAsync(0);
    expect(preparation?.removed).toBe(false);expect(h.page.children).toContain(preparation);
    h.handlers.get("close")?.();
    try {expect(preparation.removed).toBe(true);expect(h.page.children).toEqual([h.source,source]);}
    finally {resume();await vi.advanceTimersByTimeAsync(0);}
    expect(h.posts.some(p=>p.type==="apply-complete")).toBe(false);
    expect(h.posts.at(-1)).toMatchObject({type:"apply-error"});
    expect(JSON.stringify(source.vectorNetwork)).toBe(original);expect(source.removed).toBe(false);
  });

  it("removes this session's live canvas draft synchronously when the host closes the plugin", async () => {
    vi.useFakeTimers(); const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const { generation } = h.posts.findLast(p => p.type === "source");
    h.api.ui.onmessage?.({
      type: "scene-draft",
      generation,
      bytes: new Uint8Array([1]),
      renderWidth: 10,
      renderHeight: 8,
      placement: { x: 0, y: 0, width: 10, height: 8 },
    });
    expect(h.page.children.some((node: any) => node.getPluginData?.("sceneDraft") === "1")).toBe(true);

    h.handlers.get("close")?.();

    expect(h.page.children.some((node: any) => node.getPluginData?.("sceneDraft") === "1")).toBe(false);
    expect(h.api.commitUndo).toHaveBeenCalledTimes(2);
    expect(h.api.triggerUndo).not.toHaveBeenCalled();
  });

  it("rejects a tagged result with missing transform data instead of applying perspective to its pixels again", async () => {
    vi.useFakeTimers(); const h = host(); const result = h.api.createRectangle();
    writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 1040, renderHeight: 1212 });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-error", message: { key: "invalidReusablePlane" } });
    expect(result.exportAsync).not.toHaveBeenCalled();
  });

  it("delivers the source and permits HD publication before an optional renderer import finishes", async () => {
    vi.useFakeTimers();
    const h = host();
    h.api.importShaderById.mockImplementation(() => new Promise(() => {}));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.findLast((post) => post.type === "source")?.payload).toMatchObject({
      sourceNodeId: h.source.id, nativeFrameSource: true, nativeRendererPending: true,
    });
    expect(h.posts.findLast((post) => post.type === "source")?.payload.nativeRenderer).toBeUndefined();
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation: 1, sourceNodeId: h.source.id, spec, bytes: new Uint8Array([4]),
      renderWidth: 520, renderHeight: 606, placement: { x: 0, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.some((post) => post.type === "apply-complete")).toBe(true);
    expect(h.api.createRectangle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.posts.at(-1)).toMatchObject({ type: "source-renderer", generation: 1, sourceNodeId: h.source.id });
    expect(h.posts.at(-1).renderer).toBeUndefined();
  });

  it("keeps image preview usable when the optional host import throws synchronously", async () => {
    vi.useFakeTimers();
    const h = host();
    h.api.importShaderById.mockImplementation(() => { throw new Error("Host import unavailable"); });
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.some(p => p.type === "selection-error")).toBe(false);
    expect(h.posts.findLast(p => p.type === "source").payload.sourceNodeId).toBe(h.source.id);
  });

  it.each(["content", "selection"])("does not deliver obsolete renderer availability after a %s change", async (change) => {
    vi.useFakeTimers();
    const h = host();
    const definition = await h.api.importShaderById(renderer.id);
    let finish!: (shader: typeof definition) => void;
    h.api.importShaderById.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.some(p => p.type === "source" && p.generation === 1)).toBe(true);
    if (change === "content") {
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    } else {
      const other = h.api.createRectangle(); h.page.selection = [other]; h.handlers.get("selectionchange")?.();
    }
    finish(definition);
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts.some(p => p.type === "source-renderer" && p.generation === 1)).toBe(false);
    expect(h.posts.findLast(p => p.type === "source").generation).toBe(2);
    if (change === "selection") expect(h.posts.findLast(p => p.type === "source").payload.nativeRenderer).toBeUndefined();
  });

  it("finishes optional discovery after an HD replacement without exporting again or resetting its source", async () => {
    vi.useFakeTimers();
    const h = host();
    const result = h.api.createRectangle();
    writeStoredOperation(result, { kind: "transform", spec });
    writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 1040, renderHeight: 1212 });
    h.page.selection = [result];
    const definition = await h.api.importShaderById(renderer.id);
    let finish!: (shader: typeof definition) => void;
    h.api.importShaderById.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation: 1, sourceNodeId: h.source.id, targetNodeId: result.id, spec, bytes: new Uint8Array([4]),
      renderWidth: 1040, renderHeight: 1212, placement: { x: 800, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", operation: "replace", targetNodeId: result.id });
    finish(definition); await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "source-renderer", generation: 1, sourceNodeId: h.source.id,
      targetNodeId: result.id, renderer: { id: definition.id } });
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
  });

  it.each(["CENTER", "SCALE"])("preserves native content with %s constraints during creation, replacement and failed replacement", async (constraint) => {
    const h = host();
    h.source.constraints = { horizontal: constraint, vertical: constraint };
    const input = { source: h.source, renderer, spec,
      inverse: [1 / 800, 0, 0, 0, 1 / 700, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number],
      placement: { x: 800, y: 0, width: 800, height: 700 }, renderWidth: 800, renderHeight: 700 };
    const result = await publishNativeResult(input);
    const content = result.children[0]!.type === "FRAME" ? result.children[0].children[0]! : undefined;
    expect(content).toMatchObject({ width: 520, height: 606, x: 0, y: 0 });
    await expect(nativeDocumentParts(result)).resolves.toMatchObject({ content: { id: content!.id } });
    await publishNativeResult({ ...input, source: content as FrameNode, existing: result,
      placement: { x: 800, y: 0, width: 900, height: 750 } });
    expect(content).toMatchObject({ width: 520, height: 606, x: 0, y: 0 });
    const before = JSON.stringify((await nativeDocumentParts(result)).record);
    vi.mocked(result.setSharedPluginData).mockImplementationOnce(() => { throw new Error("write failed"); });
    await expect(publishNativeResult({ ...input, source: content as FrameNode, existing: result })).rejects.toThrow("write failed");
    expect(content).toMatchObject({ width: 520, height: 606, x: 0, y: 0 });
    expect(JSON.stringify((await nativeDocumentParts(result)).record)).toBe(before);
    expect(h.source).toMatchObject({ width: 520, height: 606 });
  });

  it.each(["native", "raster", "canvas", "mesh"] as const)("rejects a %s publication when its source changes during asynchronous preflight, then permits a fresh retry", async (kind) => {
    vi.useFakeTimers();
    const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    let release!: (node: any) => void;
    h.api.getNodeByIdAsync.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const common = { generation: 1, sourceNodeId: h.source.id, spec, bytes: new Uint8Array([4]), renderWidth: 520, renderHeight: 606,
      placement: { x: 0, y: 0, width: 520, height: 606 } };
    const message = kind === "native" ? { type: "apply-native", payload: {
      ...common, inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1] } }
      : kind === "raster" ? { type: "apply", payload: common }
      : kind === "canvas" ? { type: "apply-canvas", payload: {
        generation: 1, sourceNodeId: h.source.id,
        setSpec: { schema: "worldbend.canvas-set", version: "0.1", variants: [{ id: "one", operation: { kind: "stretch", output: { width: 520, height: 606 } } }] },
        outputs: [{ id: "one", bytes: common.bytes, renderWidth: 520, renderHeight: 606, placement: common.placement }],
      } } : { type: "apply-designer", payload: { generation: 1, sourceNodeIds: [h.source.id],
        task: { kind: "mesh", spec: createMeshSpec(520, 606, 2) }, bytes: common.bytes,
        renderWidth: 520, renderHeight: 606, placement: common.placement } };
    if (kind === "native") delete (message.payload as any).bytes;
    h.api.ui.onmessage?.(message);
    await vi.advanceTimersByTimeAsync(0);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    release(h.source);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.filter(p => /apply.*-complete/.test(p.type))).toHaveLength(0);
    expect(h.posts).toContainEqual(expect.objectContaining({ message: { key: "selectionChanged" } }));
    expect(h.page.children).toEqual([h.source]);
    await vi.advanceTimersByTimeAsync(120);
    message.payload.generation = h.posts.findLast(p => p.type === "source").generation;
    h.api.ui.onmessage?.(message);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.filter(p => /apply.*-complete/.test(p.type))).toHaveLength(1);
  });

  it.each(["native", "raster", "canvas", "mesh"] as const)("publishes twice from the same %s source snapshot, then rejects a changed source", async (kind) => {
    vi.useFakeTimers();
    const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const placement = { x: 0, y: 0, width: 520, height: 606 };
    const common = { generation: 1, sourceNodeId: h.source.id, spec, bytes: new Uint8Array([4]), renderWidth: 520, renderHeight: 606, placement };
    const operation = { kind: "stretch", output: { width: 520, height: 606 } };
    const message = kind === "native"
      ? { type: "apply-native", payload: { ...common, inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1] } }
      : kind === "raster" ? { type: "apply", payload: common }
      : kind === "canvas" ? { type: "apply-canvas", payload: {
          generation: 1, sourceNodeId: h.source.id,
          setSpec: { schema: "worldbend.canvas-set", version: "0.1", variants: [{ id: "one", operation }] },
          outputs: [{ id: "one", bytes: common.bytes, renderWidth: 520, renderHeight: 606, placement }],
        } }
      : { type: "apply-designer", payload: {
          generation: 1, sourceNodeIds: [h.source.id], task: { kind: "mesh", spec: createMeshSpec(520, 606, 2) },
          bytes: common.bytes, renderWidth: 520, renderHeight: 606, placement,
        } };
    // The closed native message has no raster bytes.
    if (kind === "native") delete (message.payload as any).bytes;
    for (let i = 0; i < 2; i++) {
      h.api.ui.onmessage?.(message);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.filter(p => /apply.*-complete/.test(p.type))).toHaveLength(i + 1);
    }
    const results = h.page.children.filter((n: any) => n.id !== h.source.id&&n.getSharedPluginData("worldbend","nativeShaderTemplate")!=="worldbend.figma.native-shader-template/0.1");
    expect(results).toHaveLength(2);
    expect(results[0].id).not.toBe(results[1].id);
    expect(h.page.selection).toEqual([h.source]);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    h.api.ui.onmessage?.(message);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ message: { key: "selectionChanged" } });
    expect(h.page.children.filter((n: any) => n.id !== h.source.id&&n.getSharedPluginData("worldbend","nativeShaderTemplate")!=="worldbend.figma.native-shader-template/0.1")).toHaveLength(2);
  });

  it.each(["native", "raster"] as const)("keeps a %s replacement usable across successive output sizes", async (kind) => {
    vi.useFakeTimers();
    const h = host();
    const result = kind === "native" ? await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    }) : h.api.createRectangle();
    if (kind === "raster") {
      writeStoredOperation(result, { kind: "transform", spec });
      writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 520, renderHeight: 606 });
    }
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const ready = h.posts.findLast(p => p.type === "source");
    for (const width of [600, 700]) {
      h.api.ui.onmessage?.({ type: kind === "native" ? "apply-native" : "apply", payload: {
        generation: 1, sourceNodeId: ready.payload.sourceNodeId, targetNodeId: result.id, spec,
        ...(kind === "native" ? { inverse: [1 / width, 0, 0, 0, 1 / 606, 0, 0, 0, 1] } : { bytes: new Uint8Array([5]) }),
        renderWidth: width, renderHeight: 606, placement: { x: 800, y: 0, width, height: 606 },
      } });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", operation: "replace" });
      expect(result.width).toBe(width);
    }
    expect(readStoredBinding(result)?.revision).toBe(3);
    expect(h.page.selection).toEqual([result]);
  });

  it("keeps an in-flight and prepared preview when only the text caret or range changes", async () => {
    vi.useFakeTimers();
    const h = host();
    let finishExport!: (bytes: Uint8Array) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => { finishExport = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 4; i++) {
      h.page.selectedTextRange = { node: h.source, start: i, end: i + 1 };
      h.handlers.get("selectionchange")?.();
      await vi.advanceTimersByTimeAsync(150);
    }
    finishExport(new Uint8Array([7]));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
    expect(h.posts.filter((p) => p.type === "source")).toEqual([
      expect.objectContaining({ generation: 1, payload: expect.objectContaining({ bytes: new Uint8Array([7]) }) }),
    ]);
    const delivered = h.posts.length;
    h.page.selectedTextRange = null;
    h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts).toHaveLength(delivered);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps editing through native capture deletions while refreshing deleted artwork", async () => {
    vi.useFakeTimers();
    const h = host(), child = h.frame();
    h.source.appendChild(child);
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.filter(p => p.type === "source")).toHaveLength(1);
    const count = h.posts.length;
    // Real flatten emits DELETE for an internal Vector that never had a
    // public CREATE notification or a handle returned to the plugin.
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "DELETE", id: "internal-flatten",
      node: { id: "internal-flatten", type: "VECTOR", removed: true }, origin: "LOCAL" }] });
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts).toHaveLength(count);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);

    // A new ancestor can be deleted before its own CREATE event is delivered.
    // Its removal still deletes existing observed artwork beneath it.
    const wrapper = h.frame(); wrapper.appendChild(child); wrapper.remove();
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "DELETE", id: wrapper.id,
      node: { id: wrapper.id, type: "FRAME", removed: true }, origin: "REMOTE" }] });
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-loading", generation: 2 });
    await vi.advanceTimersByTimeAsync(150);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(2);
    expect(h.posts.filter(p => p.type === "source")).toHaveLength(2);
  });

  it.each(["back", "back child"] as const)("refreshes a deleted unselected card %s after source capture", async removed => {
    vi.useFakeTimers();
    const h = host(), back = h.frame(), child = h.frame(); back.appendChild(child);
    h.source.setSharedPluginData("worldbend", "card", JSON.stringify({
      schema: "worldbend.card-binding", version: "0.1", backNodeId: back.id,
      rig: { schema: "worldbend.card", version: "0.1", elementSize: { width: 520, height: 606 },
        geometry: { perspective: 1100 }, tilt: { maxRotateX: 10, maxRotateY: 14 },
        action: { axis: "y", direction: 1, turns: 2, durationMs: 700 } },
    }));
    back.exportAsync.mockResolvedValue(new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")));
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    h.api.ui.onmessage?.({ type: "request-card-state" }); await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.findLast(p => p.type === "card-state").nodes[0].backNodeId).toBe(back.id);
    h.api.ui.onmessage?.({ type: "request-card-source", generation: 1, requestId: 1, nodeId: back.id, back: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.findLast(p => p.type === "card-source")).toMatchObject({ back: true, generation: 1 });
    const node = removed === "back" ? back : child; node.remove();
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "DELETE", id: node.id, node, origin: "LOCAL" }] });
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-loading", generation: 2 });
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts.filter(p => p.type === "source")).toHaveLength(2);
  });

  it("invalidates a deleted source child during the first asynchronous export", async () => {
    vi.useFakeTimers();
    const h = host(), child = h.frame(); h.source.appendChild(child);
    let finishExport!: (bytes: Uint8Array) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>(resolve => { finishExport = resolve; }));
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    child.remove();
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "DELETE", id: child.id,
      node: { id: child.id, type: "FRAME", removed: true }, origin: "LOCAL" }] });
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-loading", generation: 2 });
    finishExport(new Uint8Array([7]));
    await vi.advanceTimersByTimeAsync(150);
    const sources = h.posts.filter(p => p.type === "source");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ generation: 2, payload: { bytes: Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")) } });
  });

  it("refreshes actual content edits on time while caret events continue", async () => {
    vi.useFakeTimers();
    const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-loading", generation: 2 });
    await vi.advanceTimersByTimeAsync(80);
    h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(40);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(2);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", generation: 2 });
  });

  it("invalidates an away-and-back selection and an empty selection on another page", async () => {
    vi.useFakeTimers();
    const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    h.page.selection = []; h.handlers.get("selectionchange")?.();
    h.page.selection = [h.source]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(2);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", generation: 2 });
    h.page.selection = []; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(120);
    const nextPage = { ...h.page, id: "other-page", selection: [] };
    h.api.currentPage = nextPage;
    h.handlers.get("currentpagechange")?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-error", generation: 4 });
    const delivered = h.posts.length;
    h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts).toHaveLength(delivered);
  });

  it("coalesces selection changes during a slow host export and only delivers the latest source", async () => {
    vi.useFakeTimers();
    const h = host();
    let finishExport!: (bytes: Uint8Array) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => { finishExport = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
    const skipped = h.frame();
    h.page.selection = [skipped]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(250);
    expect(skipped.exportAsync).not.toHaveBeenCalled();
    const latest = h.frame();
    h.page.selection = [latest]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(250);
    expect(latest.exportAsync).not.toHaveBeenCalled();
    finishExport(new Uint8Array([1, 2, 3]));
    await vi.advanceTimersByTimeAsync(0);
    expect(skipped.exportAsync).not.toHaveBeenCalled();
    expect(latest.exportAsync).toHaveBeenCalledTimes(1);
    expect(h.posts.filter((p) => p.type === "source").map((p) => p.payload.sourceNodeId)).toEqual([latest.id]);
  });

  it("releases the selection export queue after an obsolete export fails", async () => {
    vi.useFakeTimers();
    const h = host();
    let failExport!: (reason: Error) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>((_, reject) => { failExport = reject; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const latest = h.frame();
    h.page.selection = [latest]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(250);
    failExport(new Error("Host export failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.filter((p) => p.type === "source").map((p) => p.payload.sourceNodeId)).toEqual([latest.id]);
    expect(h.posts.filter((p) => p.type === "selection-error")).toEqual([]);
  });

  it("invalidates an edited linked source during the first export before a prepared selection exists", async () => {
    vi.useFakeTimers();
    const h = host();
    const result = h.api.createRectangle();
    writeStoredOperation(result, { kind: "transform", spec });
    writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 520, renderHeight: 606 });
    h.page.selection = [result];
    let finishExport!: (bytes: Uint8Array) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => { finishExport = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const child = h.frame(); h.source.appendChild(child);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: child.id, node: child }] });
    await vi.advanceTimersByTimeAsync(250);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
    finishExport(new Uint8Array([9]));
    await vi.advanceTimersByTimeAsync(0);
    const delivered = h.posts.filter((p) => p.type === "source");
    expect(h.source.exportAsync).toHaveBeenCalledTimes(2);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].payload.bytes).toEqual(Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")));
    expect(delivered[0].generation).toBe(2);
  });

  it.each(["PAGE", "FRAME"] as const)("updates a copied raster through groups in its containing %s coordinates", async containerType => {
    vi.useFakeTimers(); const h = host();
    const container = containerType === "PAGE" ? h.page : h.frame();
    if (containerType === "FRAME") container.absoluteTransform = [[1, 0, 1000], [0, 1, 2000]];
    const group = h.frame(); group.type = "GROUP";
    group.absoluteTransform = [[1, 0, 3500], [0, 1, 4500]]; container.appendChild(group);
    const inner = h.frame(); inner.type = "BOOLEAN_OPERATION";
    inner.absoluteTransform = [[1, 0, 3600], [0, 1, 4600]]; group.appendChild(inner);
    const original = h.api.createRectangle();
    writeStoredOperation(original, { kind: "transform", spec });
    writeStoredBinding(original, { sourceNodeIds: [h.source.id], renderWidth: 1400, renderHeight: 840 });
    const result = original.clone(); result.type = "RECTANGLE"; inner.appendChild(result);
    result.x = 4000; result.y = 5000;
    const offset = containerType === "FRAME" ? { x: 1000, y: 2000 } : { x: 0, y: 0 };
    Object.defineProperty(result, "absoluteBoundingBox", { get: () => ({
      x: result.x + offset.x, y: result.y + offset.y, width: result.width, height: result.height,
    }) });
    h.page.selection = [result]; await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const ready = h.posts.findLast(p => p.type === "source");
    const placement = { ...ready.payload.placement, x: ready.payload.placement.x + 10, y: ready.payload.placement.y + 20 };
    h.api.ui.onmessage?.({ type: "apply", payload: { generation: ready.generation,
      sourceNodeId: h.source.id, targetNodeId: result.id, spec, bytes: new Uint8Array([7]),
      renderWidth: 1400, renderHeight: 840, placement } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", targetNodeId: result.id });
    expect(result).toMatchObject({ x: 4010, y: 5020, parent: inner });
    expect(result.absoluteBoundingBox).toMatchObject({ x: placement.x, y: placement.y });
    expect(readStoredBinding(result)).toMatchObject({ resultNodeId: result.id, revision: 2 });
    expect(readStoredBinding(original)).toMatchObject({ resultNodeId: original.id, revision: 1 });
  });

  it.each([ ["source", false], ["bundled", false], ["source", true], ["bundled", true] ] as const)(
    "updates a nested native result in containing coordinates and rejects stale reparenting (%s, grouped=%s)", async (entry, grouped) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 40, y: 50, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606 });
    const parent = h.frame(); parent.absoluteTransform = [[1, 0, 1000], [0, 1, 2000]];
    const immediate = grouped ? h.frame() : parent;
    if (grouped) {
      immediate.type = "GROUP"; immediate.absoluteTransform = [[1, 0, 1020], [0, 1, 2030]];
      parent.appendChild(immediate);
    }
    immediate.appendChild(result);
    Object.defineProperty(result, "absoluteBoundingBox", { get: () => ({
      x: result.x + 1000, y: result.y + 2000, width: result.width, height: result.height,
    }) });
    const { inspect, apply } = await loadAgentHandoff(entry);
    expect((await inspect(result.id, "granted-file", h.page.id)).placement).toMatchObject({ x: 40, y: 50 });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source" })));
    const ready = h.posts.findLast((p) => p.type === "source");
    expect(ready.payload.placement).toMatchObject({ x: 1040, y: 2050 });
    h.api.ui.onmessage?.({ type: "apply-native", payload: {
      generation: ready.generation, sourceNodeId: ready.payload.sourceNodeId, targetNodeId: result.id,
      spec, inverse: [1 / 600, 0, 0, 0, 1 / 650, 0, 0, 0, 1],
      placement: { x: 1050, y: 2060, width: 600, height: 650 }, renderWidth: 600, renderHeight: 650,
    } });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-complete" })));
    expect(result.parent).toBe(immediate);
    expect(result).toMatchObject({ x: 50, y: 60, width: 600, height: 650 });
    expect((await nativeDocumentParts(result)).record.placement).toMatchObject({ x: 1050, y: 2060 });
    const snapshot = await inspect(result.id, "granted-file", h.page.id);
    const otherParent = h.frame(); otherParent.appendChild(result);
    await expect(apply({ fileKey: "granted-file", pageId: h.page.id, nodeId: result.id,
      expected: snapshot.expected, spec, inverse: [1 / 600, 0, 0, 0, 1 / 650, 0, 0, 0, 1],
      width: 600, height: 650 })).rejects.toThrow("E_FIGMA_CONFLICT");
    otherParent.absoluteTransform = [[1, 0, 3000], [0, 1, 4000]];
    await restoreNativeProjection(result, () => {});
    expect(result).toMatchObject({ x: -1950, y: -1940, width: 600, height: 650 });
    otherParent.parent = { type: "PAGE", id: "other-page", parent: null };
    await expect(inspect(result.id, "granted-file", h.page.id)).rejects.toThrow("E_FIGMA_SCOPE");
  });
  it.each(["source", "bundled"] as const)("reopens and independently updates a duplicated native design without touching its original (%s)", async (entry) => {
    const h = host();
    const original = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606 });
    const originalParts = await nativeDocumentParts(original);
    const before = JSON.stringify(originalParts.record);
    const copy = original.clone(); copy.x = 1500;
    const parts = await nativeDocumentParts(copy);
    expect(parts.copied).toBe(true);
    expect(parts.content.id).not.toBe(originalParts.content.id);
    const { inspect, apply } = await loadAgentHandoff(entry);
    const snapshot = await inspect(copy.id, "granted-file", h.page.id);
    expect(snapshot.revision).toBe(0);
    expect(snapshot.source.nodeId).toBe(parts.content.id);
    h.page.selection = [copy];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", payload: expect.objectContaining({ nativeTarget: true, targetNodeId: copy.id, sourceNodeId: parts.content.id }) })));
    await apply({ fileKey: "granted-file", pageId: h.page.id, nodeId: copy.id, expected: snapshot.expected,
      spec, inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1], width: 720, height: 400 });
    expect((await nativeDocumentParts(copy)).copied).toBe(false);
    expect(readStoredBinding(copy)).toMatchObject({ revision: 1, sourceNodeIds: [parts.content.id] });
    expect(JSON.stringify((await nativeDocumentParts(original)).record)).toBe(before);
    expect(original).toMatchObject({ width: 520, height: 606, x: 800 });
    await expect(apply({ fileKey: "granted-file", pageId: h.page.id, nodeId: copy.id, expected: snapshot.expected,
      spec, inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1], width: 520, height: 606 })).rejects.toThrow("E_FIGMA_CONFLICT");
    const broken = original.clone(); (await nativeDocumentParts(broken)).content.remove();
    await expect(nativeDocumentParts(broken)).rejects.toThrow("structure changed");
  });
  it("reopens a raster result alone, refreshes on source changes, and publishes its next revision", async () => {
    const h = host(); const target = h.api.createRectangle();
    writeStoredOperation(target, { kind: "transform", spec });
    writeStoredBinding(target, { sourceNodeIds: [h.source.id], renderWidth: 520, renderHeight: 606 });
    h.page.selection = [target];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", payload: expect.objectContaining({ sourceNodeId: h.source.id, targetNodeId: target.id, spec }) })));
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-loading", generation: 2 });
    h.api.ui.onmessage?.({ type: "apply", payload: { generation: 1, sourceNodeId: h.source.id, targetNodeId: target.id, spec, bytes: new Uint8Array([4]), renderWidth: 520, renderHeight: 606, placement: { x: 10, y: 20, width: 520, height: 606 } } });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-error", message: { key: "selectionChanged" } })));
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    h.api.ui.onmessage?.({ type: "apply", payload: { generation: 2, sourceNodeId: h.source.id, targetNodeId: target.id, spec, bytes: new Uint8Array([4]), renderWidth: 520, renderHeight: 606, placement: { x: 10, y: 20, width: 520, height: 606 } } });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-complete", operation: "replace" })));
    expect(readStoredBinding(target)).toMatchObject({ revision: 2, sourceNodeIds: [h.source.id] });
    expect(target.setRelaunchData).toHaveBeenCalledWith({ edit: "" });
    expect(h.page.selection).toEqual([target]);
  });

  it("undoes a duplicate's first publication back to its own placement and retained copy record", async () => {
    const h = host();
    const native = await import("./native-document");
    const original = await native.publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606 });
    const copy = original.clone(); copy.x = 1500; copy.y = 200;
    const copiedParts = await native.nativeDocumentParts(copy);
    const restoreHost=captureLegacyHostUndo(h,copy);
    await native.publishNativeResult({ source: copiedParts.content, existing: copy, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 1510, y: 220, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400 });
    h.page.selection = [copy];
    h.api.triggerUndo.mockImplementation(() => {
      restoreHost();
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: copy.id, node: copy }] });
    });
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    await vi.waitFor(() => expect(copy).toMatchObject({ x: 1500, y: 200, width: 520, height: 606 }));
    expect((await native.nativeDocumentParts(copy)).copied).toBe(true);
    expect(copiedParts.content.id).toBe(copy.children[0]?.type === "FRAME" ? copy.children[0].children[0]?.id : undefined);
    expect(original).toMatchObject({ x: 800, y: 0, width: 520, height: 606 });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    expect(h.posts).not.toContainEqual(expect.objectContaining({ type: "selection-error" }));
  });

  it("requires an explicit repair when a copied binding or a deleted source is encountered", async () => {
    const h = host(); const target = h.api.createRectangle();
    writeStoredOperation(target, { kind: "transform", spec });
    writeStoredBinding(target, { sourceNodeIds: [h.source.id], renderWidth: 520, renderHeight: 606 });
    const copy = { id: "copied-node", getSharedPluginData: target.getSharedPluginData };
    expect(readStoredBinding(copy)).toBeUndefined();
    h.source.remove(); h.page.selection = [target];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", message: { key: "linkedSourceUnavailable" } })));
    expect(h.api.createImage).not.toHaveBeenCalled();
  });

  it("preserves native content dimensions across output sizes, reopens it, and rejects effect drift", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400,
    });
    const parts = await nativeDocumentParts(result);
    expect(parts.content).toMatchObject({ width: 520, height: 606 });
    expect(parts.surface).toMatchObject({ width: 720, height: 606 });
    expect(readStoredOperation(result)).toEqual({ status: "valid", operation: { kind: "transform", spec } });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", payload: expect.objectContaining({ nativeTarget: true, sourceNodeId: parts.content.id, renderWidth: 720, renderHeight: 400 }) })));
    expect(parts.content.exportAsync).toHaveBeenCalledWith(expect.objectContaining({ useAbsoluteBounds: true }));
    const next = await publishNativeResult({ source: parts.content, existing: result, renderer, spec,
      inverse: [1 / 240, 0, 0, 0, 1 / 800, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 240, height: 800 }, renderWidth: 240, renderHeight: 800,
    });
    expect(next.id).toBe(result.id);
    expect((await nativeDocumentParts(next)).content.id).toBe(parts.content.id);
    expect(parts.content).toMatchObject({ width: 520, height: 606 });
    expect(h.api.createImage).not.toHaveBeenCalled();
    ((await nativeDocumentParts(result)).surface.effects[0] as any).properties["0"] += .2;
    await expect(nativeDocumentParts(result)).rejects.toThrow("effect changed");
  });

  it("rolls back native pixels, geometry and both records when publication fails", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const parts = await nativeDocumentParts(result);
    const before = JSON.stringify(parts.record);
    const binding = readStoredBinding(result);
    const set = result.setSharedPluginData.bind(result);
    vi.spyOn(result, "setSharedPluginData").mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
    await expect(publishNativeResult({ source: parts.content, existing: result, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 900, y: 10, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400,
    })).rejects.toThrow("Storage unavailable");
    expect(result).toMatchObject({ x: 800, y: 0, width: 520, height: 606 });
    expect(JSON.stringify((await nativeDocumentParts(result)).record)).toBe(before);
    expect(readStoredBinding(result)).toEqual(binding);
    result.setSharedPluginData = set;
  });

  it.each([
    { kind: "resize", entry: "source" }, { kind: "scale", entry: "source" },
    { kind: "resize", entry: "bundled" }, { kind: "scale", entry: "bundled" },
  ] as const)("reopens a native $kind with current dimensions and can fit changed content in place ($entry)", async ({ kind, entry }) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606 });
    const { content, surface } = await nativeDocumentParts(result);
    result.resize(780, 909);
    if (kind === "scale") { surface.resize(780, 909); content.resize(780, 909); content.y = -0.00000762939453125; }
    const { inspect, apply } = await loadAgentHandoff(entry);
    const snapshot = await inspect(result.id, "granted-file", h.page.id);
    expect(snapshot.spec.destination.quad.br.x).toBeCloseTo(kind === "scale" ? 1 : 520 / 780);
    expect(snapshot.spec.destination.quad.br.y).toBeCloseTo(kind === "scale" ? 1 : 606 / 909);
    if (kind === "resize") {
      // Both surface extents are structurally valid after a host resize, but
      // switching between them changes the visible mapping and must conflict.
      surface.resize(780, 909);
      await expect(apply({ fileKey: "granted-file", pageId: h.page.id, nodeId: result.id,
        expected: snapshot.expected, spec, inverse: [1 / 780, 0, 0, 0, 1 / 909, 0, 0, 0, 1], width: 780, height: 909 }))
        .rejects.toThrow("E_FIGMA_CONFLICT");
      surface.resize(520, 606);
    }
    // Auto layout may reflow by a few pixels rather than multiply its height.
    content.resize(content.width, content.height + 64);
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source",
      payload: expect.objectContaining({ nativeTarget: true, renderWidth: 780, renderHeight: 909 }) })));
    await publishNativeResult({ source: content, existing: result, renderer, spec,
      inverse: [1 / 780, 0, 0, 0, 1 / 909, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 780, height: 909 }, renderWidth: 780, renderHeight: 909 });
    expect((await nativeDocumentParts(result)).content.id).toBe(content.id);
    expect((await nativeDocumentParts(result)).record.sourceSize.height).toBe(content.height);
    const currentSurface=(await nativeDocumentParts(result)).surface;
    currentSurface.resize(currentSurface.width+17,currentSurface.height);
    await expect(nativeDocumentParts(result)).rejects.toThrow("structure changed");
  });

  it.each(["source", "bundled"] as const)("lets an external Agent retain native edits, then rejects reuse of an obsolete handoff (%s)", async (entry) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { inspect, apply } = await loadAgentHandoff(entry);
    const before = await inspect(result.id, "granted-file", h.page.id);
    const { content } = await nativeDocumentParts(result);
    content.name = "Human edited this content";
    const request = { fileKey: before.fileKey, pageId: before.pageId, nodeId: before.nodeId,
      expected: before.expected, spec, width: 720, height: 400,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number],
    };
    const after = await apply(request);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.source.nodeId).toBe(content.id);
    expect(content.name).toBe("Human edited this content");
    await expect(apply(request)).rejects.toThrow("E_FIGMA_CONFLICT");
    expect((await inspect(result.id, before.fileKey, before.pageId)).expected).toBe(after.expected);
    await expect(inspect(result.id, before.fileKey, "other-page")).rejects.toThrow("E_FIGMA_SCOPE");
    await expect(inspect(result.id, "other-file", before.pageId)).rejects.toThrow("E_FIGMA_SCOPE");
    await expect(apply({ ...request, expected: after.expected, fileKey: "other-file" })).rejects.toThrow("E_FIGMA_SCOPE");
    expect((await inspect(result.id, before.fileKey, before.pageId)).expected).toBe(after.expected);
  });

  it("reports a native preview export failure without offering geometry repair, then retries cleanly", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content } = await nativeDocumentParts(result);
    vi.spyOn(content, "exportAsync").mockRejectedValueOnce(new Error("Temporary export failure"));
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error" })));
    const error = h.posts.find((p: any) => p.type === "selection-error");
    expect(error.message).toEqual({ key: "previewFailed" });
    expect(error).not.toHaveProperty("nativeRecovery");
    h.page.selection = [];
    h.handlers.get("selectionchange")?.();
    h.page.selection = [result];
    h.handlers.get("selectionchange")?.();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    expect(readStoredBinding(result)?.revision).toBe(1);
  });

  it("checks the last publication boundary before creating or changing any native node", async () => {
    const h = host();
    const before = h.page.children.map((n: any) => n.id);
    await expect(publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
      beforeWrite: () => { throw new Error("E_FIGMA_CONFLICT"); },
    })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(h.page.children.map((n: any) => n.id)).toEqual(before);
    expect(h.api.createFrame).not.toHaveBeenCalled();
  });

  it.each([[0, false], [250, false], [0, true], [250, true]] as const)(
    "completes a host Undo delivered after %i ms with descendant selection %s, preserving current native content", async (delay, descendant) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 20, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content } = await nativeDocumentParts(result);
    const restoreHost=captureLegacyHostUndo(h,result);
    await publishNativeResult({ source: content, existing: result, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 900, y: 30, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400,
    });
    content.name = "Current human content";
    h.page.selection = [result];
    h.api.triggerUndo.mockImplementation(() => {
      const deliver = () => {
        restoreHost();
        h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: result.id, node: result }] });
      };
      if (delay) setTimeout(deliver, delay); else deliver();
    });
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    if (descendant) {
      h.page.selection = [content]; h.handlers.get("selectionchange")?.();
    }
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    await vi.waitFor(() => expect(result).toMatchObject({ x: 800, y: 20, width: 520, height: 606 }));
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    expect((await nativeDocumentParts(result)).content.id).toBe(content.id);
    expect(content.name).toBe("Current human content");
    expect(readStoredBinding(result)?.revision).toBe(1);
    expect(h.page.selection).toEqual([descendant ? content : result]);
  });

  it("releases the plugin after the Undo deadline when no rollback arrives", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 20, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    vi.useFakeTimers();
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    await vi.advanceTimersByTimeAsync(1120);
    expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 }));
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    expect(h.api.triggerUndo).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1120);
    expect(result).toMatchObject({ x: 800, y: 20, width: 520, height: 606 });
    expect(readStoredBinding(result)?.revision).toBe(1);
    expect(h.posts).not.toContainEqual(expect.objectContaining({ type: "apply-error" }));
  });

  it("cancels pending Undo repair when the designer selects another object", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 20, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content } = await nativeDocumentParts(result);
    const saved = ["transform", "binding", "native"].map(key => [key, result.getSharedPluginData("worldbend", key)]);
    await publishNativeResult({ source: content, existing: result, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 900, y: 30, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400,
    });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    h.page.selection = [h.source]; h.handlers.get("selectionchange")?.();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-error", message: { key: "selectionChanged" } })));
    for (const [key, value] of saved) result.setSharedPluginData("worldbend", key!, value!);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: result.id, node: result }] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    expect(result).toMatchObject({ x: 900, y: 30, width: 720, height: 400 });
    h.page.selection = [result]; h.handlers.get("selectionchange")?.();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", nativeRecovery: expect.objectContaining({ nodeId: result.id }) })));
  });

  it.each([false, true])("offers explicit repair for changed effects with descendant selection %s and refuses to overwrite changed source dimensions", async (descendant) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content, surface } = await nativeDocumentParts(result);
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    if (descendant) {
      h.page.selection = [content]; h.handlers.get("selectionchange")?.();
    }
    surface.effects = [];
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: surface.id, node: surface }] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", nativeRecovery: expect.objectContaining({ nodeId: result.id }) })));
    const error = h.posts.findLast((p: any) => p.nativeRecovery);
    h.api.ui.onmessage?.({ type: "restore-native", generation: error.generation, ...error.nativeRecovery });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 3,
      payload: expect.objectContaining({ targetNodeId: result.id, sourceNodeId: content.id }),
    })));
    expect((await nativeDocumentParts(result)).surface.effects.length).toBe(1);
    expect(h.page.selection).toEqual([descendant ? content : result]);
    content.resize(521, 606);
    await expect(restoreNativeProjection(result, vi.fn())).rejects.toThrow("Native content changed");
    expect(content.width).toBe(521);
  });

  it.each(["outside", "mixed", "stale-record"] as const)("cancels descendant recovery at the write boundary after %s changes", async (change) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content, surface } = await nativeDocumentParts(result);
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    h.page.selection = [content]; h.handlers.get("selectionchange")?.();
    surface.effects = [];
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: surface.id, node: surface }] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", nativeRecovery: expect.anything() })));
    const error = h.posts.findLast((post: any) => post.nativeRecovery);
    h.api.ui.onmessage?.({ type: "restore-native", generation: error.generation, ...error.nativeRecovery });
    // The node lookup yields before writing. No selection event is needed to
    // exercise the final safety check rather than generation invalidation.
    if (change === "stale-record") result.setSharedPluginData("worldbend", "native", "");
    else h.page.selection = change === "mixed" ? [content, h.source] : [h.source];
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-error" })));
    expect(surface.effects).toEqual([]);
    expect(readStoredBinding(result)?.revision).toBe(1);
  });
});

describe("Agent template discovery", () => {
  it.each(["source", "bundled"] as const)("lists reusable scene templates with slots and appearance (%s)", async (entry) => {
    const h = host();
    const library = {
      schema: "worldbend.figma-template-library", version: "0.1",
      templates: [{
        id: "scene-1", name: "Studio placement",
        template: { schema: "worldbend.spatial-template", version: "0.1",
          operation: { kind: "mockup", spec: mockupTask().spec }, output: { kind: "single", id: "output" } },
        slots: [{ name: "Editable source", width: 600, height: 400 }, { name: "Card", width: 520, height: 606 }],
        appearance: { supported: ["perspective", "opacity"], unsupported: ["clip", "masking", "occlusion", "lighting"] },
      }],
    };
    h.api.clientStorage.getAsync = vi.fn(async (key?: string) =>
      key === "worldbend.spatial-templates.v1" ? library : undefined);
    const handoff = await loadAgentHandoff(entry);
    const state = await handoff.inspectTemplates("granted-file");
    expect(state).toMatchObject({
      schema: "worldbend.figma.template-library-handoff", version: "0.1", fileKey: "granted-file",
    });
    expect(state.templates).toEqual([{
      id: "scene-1", name: "Studio placement", kind: "mockup", sourceCount: 2,
      slots: library.templates[0]?.slots, appearance: library.templates[0]?.appearance,
    }]);
    expect(state.readyScenes.map(scene => scene.readyScene)).toEqual(["studio-poster", "desktop-screen", "carton-label", "studio-can", "hanging-fabric"]);
    expect(state.readyScenes.every(scene => scene.sourceCount === 1 && scene.provenance.license === "Apache-2.0")).toBe(true);
    // An absent library is an empty list, not an error.
    h.api.clientStorage.getAsync = vi.fn(async () => undefined);
    expect((await handoff.inspectTemplates("granted-file")).templates).toEqual([]);
    // An unreadable cache does not hide valid file-native masters. Its status
    // remains explicit; a foreign file still fails before either read.
    h.api.clientStorage.getAsync = vi.fn(async () => ({ schema: "wrong" }));
    expect((await handoff.inspectTemplates("granted-file")).discovery.clientLibrary).toBe("unreadable");
    await expect(handoff.inspectTemplates("other-file")).rejects.toThrow("E_FIGMA_SCOPE");
  });

  it.each(["source", "bundled"] as const)("discovers current file-native masters when client storage is unsupported (%s)", async (entry) => {
    const h = host();
    const root = h.frame(), preview = h.frame(), guide = h.frame(), result = h.api.createRectangle();
    root.appendChild(h.source); root.appendChild(preview); preview.appendChild(guide); preview.appendChild(result);
    const scene = { schema: "worldbend.figma.scene", version: "0.1", sceneId: "scene-12345678901234",
      pageId: "old-page-hint", rootNodeId: root.id, previewNodeId: preview.id, resultNodeId: result.id,
      sourceNodeIds: [h.source.id, guide.id], replaceSourceNodeIds: [h.source.id] };
    root.setSharedPluginData("worldbend", "nativeScene", JSON.stringify(scene));
    root.setSharedPluginData("worldbend", "sceneTemplate", JSON.stringify({ id: "studio", name: "Studio scene" }));
    writeStoredOperation(result, { kind: "task", task: mockupTask() });
    writeStoredBinding(result, { sourceNodeIds: scene.sourceNodeIds, renderWidth: 600, renderHeight: 400 });
    h.api.clientStorage.getAsync = vi.fn(async () => { throw new Error('"getAsync" is not a supported API'); });
    const handoff = await loadAgentHandoff(entry);
    const state = await handoff.inspectTemplates("granted-file");
    expect(state.templates).toEqual([{ id: "studio", name: "Studio scene", kind: "mockup", sourceCount: 1,
      nativeScene: scene, pageId: "page", slots: [{ name: h.source.name, width: h.source.width, height: h.source.height }],
      appearance: { supported: ["perspective", "opacity"], unsupported: ["clip", "masking", "occlusion", "lighting"] } }]);
    expect(state.discovery).toMatchObject({ clientLibrary: "unavailable", pageIds: ["page"], complete: true, issueCount: 0 });
    expect(h.api.currentPage).toBe(h.page);
    expect(h.page.selection).toEqual([h.source]);
    expect(root.setSharedPluginData).toHaveBeenCalledTimes(2);
    const children = h.page.children;
    h.api.root.children = [{ id: h.page.id, type: "PAGE", children: [] }] as any;
    h.page.children = [{ id: root.id, type: "FRAME", children: [], visible: true, getSharedPluginData: () => "" }];
    expect((await handoff.inspectTemplates("granted-file")).templates).toEqual(state.templates);
    h.api.root.children = [h.page]; h.page.children = children;
    h.api.clientStorage.getAsync = vi.fn(async () => ({ schema: "worldbend.figma-template-library", version: "0.1",
      templates: [{ id: "foreign", name: "Cached scene in another file", nativeScene: { ...scene, sceneId: "foreign-scene-12345678" },
        template: { schema: "worldbend.spatial-template", version: "0.1", operation: { kind: "mockup", spec: mockupTask().spec },
          output: { kind: "single", id: "output" } } }] }));
    const cached = await handoff.inspectTemplates("granted-file");
    expect(cached.templates).toEqual(state.templates);
    expect(cached.discovery).toMatchObject({ clientLibrary: "readable", unresolvedClientSceneCount: 1 });
    // Figma Duplicate carries the original master identity; it is not a
    // second usable catalog entry. Changed slots of the real master are read.
    const copy = root.clone();
    h.source.resize(900, 450); h.source.name = "Current artwork";
    const next = await handoff.inspectTemplates("granted-file");
    expect(next.templates).toHaveLength(1);
    expect(next.templates[0]?.slots).toEqual([{ name: "Current artwork", width: 900, height: 450 }]);
    expect(next.discovery.issues).toContainEqual({ nodeId: copy.id, reason: "invalid-scene" });
    guide.remove();
    const unavailable = await handoff.inspectTemplates("granted-file");
    expect(unavailable.templates).toHaveLength(0);
    expect(unavailable.discovery.issues).toContainEqual({ nodeId: root.id, reason: "missing-content" });
  });

  it.each(["source", "bundled"] as const)("reports bounded incomplete scans and rejects a changed file (%s)", async (entry) => {
    const h = host();
    h.page.children.push(...Array.from({ length: 20000 }, (_, i) => ({ id: `leaf-${i}`, type: "RECTANGLE", parent: h.page })));
    const handoff = await loadAgentHandoff(entry);
    const state = await handoff.inspectTemplates("granted-file");
    expect(state.discovery).toMatchObject({ visitedNodes: 20000, complete: false });
    const readCount = h.api.getNodeByIdAsync.mock.calls.length;
    h.api.clientStorage.getAsync = vi.fn(async () => { h.api.fileKey = "changed-file"; return undefined; });
    await expect(handoff.inspectTemplates("granted-file")).rejects.toThrow("E_FIGMA_SCOPE");
    expect(h.api.getNodeByIdAsync.mock.calls).toHaveLength(readCount);
  });

  it.each(["source", "bundled"] as const)("reports an unreadable page and still reads available pages (%s)", async (entry) => {
    const h = host();
    h.api.root.children.unshift({ id: "unreadable", type: "PAGE" } as any);
    const resolve = h.api.getNodeByIdAsync.getMockImplementation()!;
    h.api.getNodeByIdAsync.mockImplementation(async id => {
      if (id === "unreadable") throw Error("page read failed");
      return resolve(id);
    });
    const handoff = await loadAgentHandoff(entry);
    const state = await handoff.inspectTemplates("granted-file");
    expect(state.discovery).toMatchObject({ complete: false, pageIds: ["page"], issueCount: 1,
      issues: [{ nodeId: "unreadable", reason: "page-unavailable" }] });
  });
});

describe("Agent native scene creation", () => {
  it.each(["source", "bundled"] as const)("ignores a native duplicate when replaying the original scene identity (%s)", async entry => {
    const h = host(), handoff = await loadAgentHandoff(entry);
    const input = { fileKey: "granted-file", pageId: "page", scene: { kind: "ready" as const, id: "studio-poster" as const },
      artworkNodeIds: [h.source.id], fit: "contain" as const, requestId: "native-duplicate-replay" };
    const first = await handoff.createScene(input), root = h.registry.get(first.nativeScene.rootNodeId);
    const duplicate = root.clone();
    h.page.children = [duplicate, ...h.page.children.filter((node: SceneNode) => node !== duplicate)];
    const replay = await handoff.createScene(input);
    expect(replay).toMatchObject({ reused: true, nativeScene: first.nativeScene });
    expect(replay.snapshot.nodeId).toBe(first.snapshot.nodeId);
    expect(duplicate.removed).toBe(false);
    const container = h.frame(); container.appendChild(root);
    const nested = await handoff.createScene(input);
    expect(nested).toMatchObject({ reused: true, nativeScene: first.nativeScene });
    expect(nested.snapshot.nodeId).toBe(first.snapshot.nodeId);
  });

  it("reloads a published scene task on native Undo even when material context still observes the Page", async () => {
    vi.useFakeTimers();
    const h = host(), handoff = await loadAgentHandoff("source");
    const scene = await handoff.createScene({ fileKey: "granted-file", pageId: "page", scene: { kind: "ready", id: "studio-poster" },
      artworkNodeIds: [h.source.id], fit: "contain", requestId: "undo-scene-creation" });
    const result = h.registry.get(scene.snapshot.nodeId);
    const originalTask = result.getSharedPluginData("worldbend", "task");
    const originalBinding = result.getSharedPluginData("worldbend", "binding");
    h.page.selection = [result];
    vi.doMock("./material-trial", () => ({ createMaterialTrial: (input: Parameters<typeof import("./material-trial").createMaterialTrial>[0]) => ({
      request: () => input.observe(h.page.id), cancel: () => input.clear(),
    }) }));
    try {
      await import("./main");
      h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
      await vi.advanceTimersByTimeAsync(0);
      const initial = h.posts.findLast(p => p.type === "source");
      expect(initial.payload).toMatchObject({ sceneContext: true, targetNodeId: result.id });
      h.api.ui.onmessage?.({ type: "request-appearance-state" });
      h.api.ui.onmessage?.({ type: "request-texture-state" });
      h.api.ui.onmessage?.({ type: "request-material-preview", generation: initial.generation, requestId: 1 });
      const nextTask = structuredClone(initial.payload.task);
      nextTask.spec.planes[0].opacity = .99;
      h.api.ui.onmessage?.({ type: "apply-designer", payload: {
        generation: initial.generation, sourceNodeIds: scene.snapshot.sourceNodeIds, targetNodeId: result.id,
        task: nextTask, bytes: new Uint8Array([7]), renderWidth: 1200, renderHeight: 900, placement: initial.payload.placement,
      } });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.at(-1)).toMatchObject({ type: "apply-designer-complete", operation: "replace" });
      expect(readStoredBinding(result)?.revision).toBe(2);
      // Publication clears the temporary scene capture. The independent
      // material capture can still observe this target without appearance edits.
      result.setSharedPluginData("worldbend", "task", originalTask);
      result.setSharedPluginData("worldbend", "binding", originalBinding);
      const before = h.posts.length;
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: result.id, node: result, properties: ["pluginData", "fills"] }] });
      await vi.advanceTimersByTimeAsync(150);
      expect(h.posts.slice(before).some(p => p.type === "material-context-changed")).toBe(false);
      const undone = h.posts.findLast(p => p.type === "source");
      expect(undone).toMatchObject({ generation: initial.generation + 1, payload: { task: initial.payload.task, sceneContextReadOnly: true } });
      const createdFrames = h.api.createFrame.mock.calls.length;
      const createdImages = h.api.createImage.mock.calls.length;
      const commits = h.api.commitUndo.mock.calls.length;
      h.api.ui.onmessage?.({ type: "request-scene-context", generation: undone.generation, requestId: 2,
        bytes: new Uint8Array([7]), showCanvas: false, readPublished: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.at(-1)).toMatchObject({ type: "scene-context-preview", requestId: 2, frame: { resultWidth: 1200, resultHeight: 900 } });
      expect(h.api.createFrame).toHaveBeenCalledTimes(createdFrames);
      expect(h.api.createImage).toHaveBeenCalledTimes(createdImages);
      expect(h.api.commitUndo).toHaveBeenCalledTimes(commits);
      // A host Redo also supplies a fresh task and remains editable.
      writeStoredOperation(result, { kind: "task", task: nextTask });
      writeStoredBinding(result, { sourceNodeIds: scene.snapshot.sourceNodeIds, renderWidth: 1200, renderHeight: 900 });
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: result.id, node: result, properties: ["pluginData", "fills"] }] });
      await vi.advanceTimersByTimeAsync(150);
      expect(h.posts.findLast(p => p.type === "source")).toMatchObject({ generation: undone.generation + 1, payload: { task: nextTask, sceneContextReadOnly: true } });
      // Source edits require fresh compositing, even while continuing a
      // result that had previously used a read-only history preview.
      const artwork = h.registry.get(scene.snapshot.sourceNodeIds[0]!);
      artwork.exportAsync.mockResolvedValue(new Uint8Array([8, 9, 10]));
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: artwork.id, node: artwork }] });
      await vi.advanceTimersByTimeAsync(150);
      expect(h.posts.findLast(p => p.type === "source").payload).not.toHaveProperty("sceneContextReadOnly");
    } finally { vi.doUnmock("./material-trial"); }
  });

  it.each(["source", "bundled"] as const)("creates ready scenes and reuses an independent native graph (%s)", async (entry) => {
    const h = host();
    const handoff = await loadAgentHandoff(entry);
    const first = await handoff.createScene({ fileKey: "granted-file", pageId: "page", scene: { kind: "ready", id: "studio-poster" },
      artworkNodeIds: [h.source.id], fit: "contain", name: "Agent poster", requestId: "ready-poster-creation" });
    expect(first).toMatchObject({ status: "needs-publication", snapshot: { revision: 1, task: { kind: "mockup" } } });
    const root = h.registry.get(first.nativeScene.rootNodeId), result = h.registry.get(first.snapshot.nodeId);
    expect(root.name).toBe("Agent poster · Worldbend scene");
    expect(result.fills).toEqual([]);
    const count = h.page.children.length;
    const replay = await handoff.createScene({ fileKey: "granted-file", pageId: "page", scene: { kind: "ready", id: "studio-poster" },
      artworkNodeIds: [h.source.id], fit: "contain", name: "Agent poster", requestId: "ready-poster-creation" });
    expect(replay).toMatchObject({ reused: true, affectedNodeIds: [], nativeScene: first.nativeScene });
    expect(h.page.children).toHaveLength(count);
    await expect(handoff.createScene({ fileKey: "granted-file", pageId: "page", scene: { kind: "ready", id: "studio-poster" },
      artworkNodeIds: [h.source.id], fit: "cover", name: "Agent poster", requestId: "ready-poster-creation" })).rejects.toThrow("CONFLICT");
    expect(h.source.parent).toBe(h.page);
    expect(first.snapshot.sourceNodeIds).not.toContain(h.source.id);
    const original = root.getSharedPluginData("worldbend", "nativeScene");
    root.setSharedPluginData("worldbend", "sceneTemplate", JSON.stringify({ id: "master", name: "My poster" }));
    const secondSource = h.frame(); secondSource.resize(700, 420);
    const next = await handoff.createScene({ fileKey: "granted-file", pageId: "page", scene: {
      kind: "native", nodeId: first.snapshot.nodeId, revision: first.snapshot.revision, expected: first.snapshot.expected },
      artworkNodeIds: [secondSource.id], fit: "cover", requestId: "native-poster-creation" });
    expect(next.nativeScene.sceneId).not.toBe(first.nativeScene.sceneId);
    expect(next.snapshot.sourceNodeIds.some(id => first.snapshot.sourceNodeIds.includes(id))).toBe(false);
    expect(h.registry.get(next.nativeScene.rootNodeId).getSharedPluginData("worldbend", "sceneTemplate")).toBe("");
    expect(root.getSharedPluginData("worldbend", "nativeScene")).toBe(original);
    expect(root.name).toBe("Agent poster · Worldbend scene");
    expect(secondSource.parent).toBe(h.page);
    expect(h.page.selection).toEqual([h.source]);
  });

  it.each(["source", "bundled"] as const)("rejects stale masters after font loading and removes only failed new instances (%s)", async (entry) => {
    const h = host(), handoff = await loadAgentHandoff(entry);
    const initial = await handoff.createScene({ fileKey: "granted-file", pageId: "page", scene: { kind: "ready", id: "desktop-screen" },
      artworkNodeIds: [h.source.id], fit: "contain", requestId: "desktop-creation" });
    const originalNodes = [...h.page.children];
    const result = h.registry.get(initial.snapshot.nodeId);
    let fontRead = 0;
    h.source.findAll = () => {
      if (++fontRead === 1) result.x += 1;
      return [];
    };
    await expect(handoff.createScene({ fileKey: "granted-file", pageId: "page", scene: {
      kind: "native", nodeId: result.id, revision: 1, expected: initial.snapshot.expected }, artworkNodeIds: [h.source.id], fit: "cover", requestId: "failing-creation" })).rejects.toThrow("CONFLICT");
    expect(h.page.children).toEqual(originalNodes);
    // The snapshot's export can fail after construction. Roll back that
    // owned graph, while leaving the first instance and originals intact.
    delete h.source.findAll;
    const clone = h.source.clone;
    h.source.clone = () => { const copy = clone(); copy.exportAsync = async () => { throw Error("export refused"); }; return copy; };
    // Export happens on the slot Frame, so inject the failure there too.
    h.api.createFrame.mockImplementationOnce(() => h.frame()).mockImplementationOnce(() => {
      const slot = h.frame(); slot.exportAsync = async () => { throw Error("export refused"); }; return slot;
    });
    await expect(handoff.createScene({ fileKey: "granted-file", pageId: "page", scene: { kind: "ready", id: "carton-label" },
      artworkNodeIds: [h.source.id], fit: "cover", requestId: "failing-creation" })).rejects.toThrow("export refused");
    expect(h.page.children).toEqual(originalNodes);
  });
});

describe("Agent complete publication", () => {
  it.each(["source", "bundled"] as const)("emits no source artifacts if any exported PNG is invalid (%s)", async entry => {
    const h = host(), other = h.frame(), result = h.frame(); result.type = "RECTANGLE";
    writeStoredBinding(result, { sourceNodeIds: [h.source.id, other.id], renderWidth: 600, renderHeight: 400 });
    writeStoredOperation(result, { kind: "task", task: mockupTask() });
    other.exportAsync.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const write = vi.fn(); Object.assign(h.api, { io: { write } });
    const handoff = await loadAgentHandoff(entry);
    await expect(handoff.inspectMockupWithSources(result.id, "granted-file", "page", "artifact")).rejects.toThrow("E_FIGMA_RASTER");
    expect(write).not.toHaveBeenCalled();
    expect(result.fills).toEqual([]);
    expect(readStoredBinding(result)?.revision).toBe(1);
  });

  it.each(["source", "bundled"] as const)("rejects Composition media that changed between snapshot and export (%s)", async entry => {
    const h = host(), other = h.frame(), result = h.frame(); result.type = "RECTANGLE";
    writeStoredBinding(result, { sourceNodeIds: [h.source.id, other.id], renderWidth: 600, renderHeight: 400 });
    writeStoredOperation(result, { kind: "task", task: mockupTask() });
    const handoff = await loadAgentHandoff(entry);
    h.source.exportAsync.mockResolvedValueOnce(new Uint8Array([1, 2, 3])).mockResolvedValue(new Uint8Array([4, 5, 6]));
    await expect(handoff.inspectMockupWithSources(result.id, "granted-file", "page")).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
    expect(readStoredBinding(result)?.revision).toBe(1);
  });

  it.each(["source", "bundled"] as const)("exports named images without inline text and retains native export resolution (%s)", async (entry) => {
    const h = host();
    const sources = [h.source, h.frame()];
    const result = h.frame(); result.type = "RECTANGLE";
    writeStoredBinding(result, { sourceNodeIds: sources.map(node => node.id), renderWidth: 1040, renderHeight: 1212 });
    result.setSharedPluginData("worldbend", "task", JSON.stringify(mockupTask()));
    const handoff = await loadAgentHandoff(entry);
    await expect(handoff.inspectMockupWithSources(result.id, "granted-file", "page", "artifact")).rejects.toThrow("ARTIFACT");
    const write = vi.fn(); Object.assign(h.api, { io: { write } });
    const completed: number[] = [];
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    sources[0].exportAsync = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 5)); completed.push(0); return png; });
    sources[1].exportAsync = vi.fn(async () => { completed.push(1); return png; });
    const state = await handoff.inspectMockupWithSources(result.id, "granted-file", "page", "artifact");
    expect(state.sourceRasters).toHaveLength(2);
    expect(write).toHaveBeenCalledTimes(2);
    expect(completed.slice(-2)).toEqual([1, 0]);
    for (const [index, raster] of state.sourceRasters.entries()) {
      expect(raster.base64).toBeUndefined();
      expect(raster.artifact).toEqual({ name: `worldbend-${result.id}-source-${index + 1}.png`, mimeType: "image/png", bytes: png.length });
      // Hidden native guides may export 1x1; report the actual returned PNG.
      expect(raster.width).toBe(1); expect(raster.height).toBe(1);
      // Native sources retain their logical bounds at the requested density.
      expect(sources[index].exportAsync).toHaveBeenCalledWith({ format: "PNG", useAbsoluteBounds: true, constraint: { type: "SCALE", value: 2 } });
      expect(write.mock.calls[index]?.[0]).toBe(raster.artifact?.name);
    }
    expect(result.getSharedPluginData("worldbend", "publication-transfer")).toBe("");
    expect(h.api.createImage).not.toHaveBeenCalled();
  });
  it.each(["source", "bundled"] as const)("publishes core-rendered pixels in place and advances the revision (%s)", async (entry) => {
    const h = host();
    // Build a linked Composition result with two bound sources like the staging test.
    const sources = [h.source, h.frame()];
    h.page.selection = [...sources];
    const result = h.frame(); result.type = "RECTANGLE";
    h.page.appendChild(result);
    const { writeStoredBinding } = await import("./stored-binding");
    writeStoredBinding(result, { sourceNodeIds: sources.map(node => node.id), renderWidth: 600, renderHeight: 400 });
    result.setSharedPluginData("worldbend", "task", JSON.stringify(mockupTask()));
    result.setPluginData("worldbend.renderWidth", "600");
    result.setPluginData("worldbend.renderHeight", "400");
    const handoff = await loadAgentHandoff(entry);
    const snapshot = await handoff.inspectMockupWithSources(result.id, "granted-file", "page");
    expect(snapshot.sourceRasters).toHaveLength(2);
    for (const raster of snapshot.sourceRasters ?? []) {
      expect(raster.base64?.length).toBeGreaterThan(0);
      expect(/^source-[1-8]$/.test(raster.slotId)).toBe(true);
    }
    // A stale guard: publishing against a changed revision writes nothing.
    await expect(handoff.publishMockupImage({
      fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: snapshot.expected, revision: snapshot.revision + 5,
      task: mockupTask(.45),
      renderWidth: 600, renderHeight: 400, imageBase64: snapshot.sourceRasters?.[0]?.base64 ?? "",
    })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
    const before = readRevision(result);
    const after = await handoff.publishMockupImage({
      fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: snapshot.expected, revision: snapshot.revision,
      task: mockupTask(.45),
      renderWidth: 600, renderHeight: 400, imageBase64: snapshot.sourceRasters?.[0]?.base64 ?? "",
    });
    // FILL matches the plugin publication path: never letterbox a resized node.
    expect(result.fills).toEqual([{ type: "IMAGE", scaleMode: "FILL", imageHash: "rendered" }]);
    expect(after.revision).toBe(before + 1);
    expect(after.task).toEqual(mockupTask(.45));
    expect(readStoredOperation(result)).toEqual({ status: "valid", operation: { kind: "task", task: mockupTask(.45) } });
    const nextSpec = mockupTask(.65).spec;
    nextSpec.canvas = { width: 720, height: 480 };
    const nextTask = continuedCompositionTask(nextSpec);
    // External Figma cannot write another plugin's private data. A subsequent
    // edit must continue from the shared task and shared raster binding alone.
    const privateWrite = result.setPluginData;
    result.setPluginData = () => { throw new Error("private writes unavailable in external Figma"); };
    const continued = await handoff.publishMockupImage({
      fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: after.expected, revision: after.revision, task: nextTask,
      renderWidth: 720, renderHeight: 480, imageBase64: snapshot.sourceRasters?.[0]?.base64 ?? "",
    });
    expect(continued.task).toEqual(nextTask);
    expect(continued.revision).toBe(before + 2);
    expect(readStoredBinding(result)).toMatchObject({ renderWidth: 720, renderHeight: 480 });
    expect(result.getPluginData("worldbend.renderWidth")).toBe("600");
    // The human plugin can reopen and publish again despite obsolete private
    // size fields left by its earlier publication.
    result.setPluginData = privateWrite;
    vi.useFakeTimers();
    h.page.selection = [result];
    await import("./main");
    h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"], sceneDraftSessionId: "test-session-00001" });
    await vi.advanceTimersByTimeAsync(0);
    const reopened = h.posts.filter(post => post.type === "source").at(-1);
    expect(reopened.payload).toMatchObject({ targetNodeId: result.id, task: nextTask });
    h.api.ui.onmessage?.({ type: "apply-designer", payload: {
      generation: reopened.generation, sourceNodeIds: sources.map(node => node.id),
      targetNodeId: result.id, task: nextTask, bytes: new Uint8Array([7]),
      renderWidth: 720, renderHeight: 480, placement: reopened.payload.placement,
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-designer-complete", targetNodeId: result.id });
    function readRevision(node: any): number {
      const raw = node.getSharedPluginData("worldbend", "binding");
      return raw ? JSON.parse(raw).revision : 0;
    }
  });

  it.each(["source", "bundled"] as const)("rolls back a failed task publication and rejects a late host edit (%s)", async (entry) => {
    const h = host();
    const sources = [h.source, h.frame()];
    const result = h.api.createRectangle();
    writeStoredOperation(result, { kind: "task", task: mockupTask() });
    writeStoredBinding(result, { sourceNodeIds: sources.map(node => node.id), renderWidth: 600, renderHeight: 400 });
    const handoff = await loadAgentHandoff(entry);
    const snapshot = await handoff.stageMockup({
      ...(await handoff.inspectMockup(result.id, "granted-file", "page")), task: mockupTask(.45),
    });
    const priorBinding = result.getSharedPluginData("worldbend", "binding");
    const priorDraft = result.getSharedPluginData("worldbend", "mockupDraft");
    const write = result.setSharedPluginData.getMockImplementation();
    let failed = false;
    result.setSharedPluginData.mockImplementation((namespace: string, key: string, value: string) => {
      if (key === "binding" && !failed) { failed = true; throw new Error("host write failed"); }
      write(namespace, key, value);
    });
    const input = { fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: snapshot.expected, revision: snapshot.revision, task: mockupTask(.45),
      renderWidth: 600, renderHeight: 400, imageBase64: btoa("png") };
    await expect(handoff.publishMockupImage(input)).rejects.toThrow("host write failed");
    expect(result.fills).toEqual([]);
    expect(readStoredOperation(result)).toEqual({ status: "valid", operation: { kind: "task", task: mockupTask() } });
    expect(result.getSharedPluginData("worldbend", "binding")).toBe(priorBinding);
    expect(result.getSharedPluginData("worldbend", "mockupDraft")).toBe(priorDraft);
    let resolutions = 0;
    h.api.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === result.id && ++resolutions === 2) result.x += 10;
      return h.registry.get(id) ?? null;
    });
    await expect(handoff.publishMockupImage(input)).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
    expect(result.getSharedPluginData("worldbend", "binding")).toBe(priorBinding);
    result.x -= 10;
    const after = await handoff.publishMockupImage(input);
    expect(after.task).toEqual(mockupTask(.45));
    expect(after).not.toHaveProperty("draft");
  });
});

describe("Agent Depth publication", () => {
  it.each(["source", "bundled"] as const)("restores pixels, task, source count and pending draft after a failed source replacement (%s)", async entry => {
    for (const failedKey of ["task", "binding", "effectDraft"]) {
      const h = host(); const original = [h.source, h.frame(), h.frame()]; const extra = h.frame();
      const handoff = await loadAgentHandoff(entry);
      const created = await handoff.createEffect({ fileKey: "granted-file", pageId: "page",
        sourceNodeIds: original.map(node => node.id), task: spatialTask(), requestId: "replace-rollback" });
      const result = h.registry.get(created.snapshot.nodeId);
      const published = await handoff.publishEffectImage({ ...created.snapshot,
        renderWidth: 600, renderHeight: 400, imageBase64: btoa("old pixels") });
      const staged = await handoff.stageEffect({ ...published, task: spatialTask(.45),
        fingerprint: `sha256:${"b".repeat(64)}` });
      const proposal = await handoff.inspectEffectSources({ ...staged, sourceNodeIds: [original[0].id, extra.id] });
      const before = { fills: result.fills, task: result.getSharedPluginData("worldbend", "task"),
        binding: result.getSharedPluginData("worldbend", "binding"), draft: result.getSharedPluginData("worldbend", "effectDraft") };
      const task = structuredClone(published.task); task.recipe.origin = null; task.recipe.layers.splice(1, 1);
      const input = { fileKey: published.fileKey, pageId: published.pageId, nodeId: published.nodeId,
        expected: proposal.expected, revision: proposal.revision, task, sourceSet: proposal.sourceSet,
        renderWidth: 600, renderHeight: 400, imageBase64: btoa("new pixels") };
      const write = result.setSharedPluginData.getMockImplementation();
      let failed = false;
      result.setSharedPluginData.mockImplementation((namespace: string, key: string, value: string) => {
        if (key === failedKey && !failed) { failed = true; throw Error(`host ${key} write failed`); }
        write(namespace, key, value);
      });
      await expect(handoff.publishEffectImage(input)).rejects.toThrow(`host ${failedKey} write failed`);
      expect(result.fills).toEqual(before.fills);
      expect(result.getSharedPluginData("worldbend", "task")).toBe(before.task);
      expect(result.getSharedPluginData("worldbend", "binding")).toBe(before.binding);
      expect(result.getSharedPluginData("worldbend", "effectDraft")).toBe(before.draft);
      const restored = await handoff.inspectEffect(result.id, "granted-file", "page");
      expect(restored.sourceNodeIds).toEqual(original.map(node => node.id));
      expect(restored.revision).toBe(published.revision);
      const retried = await handoff.publishEffectImage(input);
      expect(retried.sourceNodeIds).toEqual([original[0].id, extra.id]);
      expect(retried.task).toEqual(task);
      expect(retried.revision).toBe(published.revision + 1);
      expect(retried).not.toHaveProperty("draft");
    }
  });

  it.each(["source", "bundled"] as const)("adds and removes Depth sources through a guarded read-only proposal (%s)", async entry => {
    const h = host(); const original = [h.source, h.frame(), h.frame()]; const extra = h.frame();
    const handoff = await loadAgentHandoff(entry);
    const created = await handoff.createEffect({ fileKey: "granted-file", pageId: "page",
      sourceNodeIds: original.map(node => node.id), task: spatialTask(), requestId: "source-set" });
    const result = h.registry.get(created.snapshot.nodeId);
    const proposal = await handoff.inspectEffectSources({ ...created.snapshot, sourceNodeIds: [...original, extra].map(node => node.id), includeSourceRasters: true });
    expect(proposal.sourceRasters).toHaveLength(4);
    expect(result.fills).toEqual([]);
    expect((await handoff.inspectEffect(result.id,"granted-file","page")).sourceNodeIds).toEqual(original.map(node => node.id));
    const task = structuredClone(created.snapshot.task); task.recipe.origin = null;
    const last = structuredClone(task.recipe.layers[2]!);
    if (last.surface.kind !== "camera-plane") throw Error("expected camera plane");
    last.id = "additional"; last.surface.distance = 400; task.recipe.layers.push(last);
    const after = await handoff.publishEffectImage({ fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: proposal.expected, revision: proposal.revision, task, sourceSet: proposal.sourceSet,
      renderWidth: 600, renderHeight: 400, imageBase64: proposal.sourceRasters![0]!.base64! });
    expect(after.sourceNodeIds).toEqual([...original, extra].map(node => node.id));
    expect(after.task).toEqual(task);
    const fewer = await handoff.inspectEffectSources({ ...after, sourceNodeIds: [original[0].id, extra.id], includeSourceRasters: true });
    const reduced = structuredClone(task); reduced.recipe.layers = [task.recipe.layers[0]!, task.recipe.layers[3]!];
    const final = await handoff.publishEffectImage({ fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: fewer.expected, revision: fewer.revision, task: reduced, sourceSet: fewer.sourceSet,
      renderWidth: 600, renderHeight: 400, imageBase64: fewer.sourceRasters![0]!.base64! });
    expect(final.sourceNodeIds).toEqual([original[0].id, extra.id]);
    expect(final.task).toEqual(reduced);
    expect(final.revision).toBe(created.snapshot.revision + 2);
    expect(original.map(node => node.fills)).toEqual([[],[],[]]);
  });

  it.each(["source", "bundled"] as const)("rejects cyclic, stale and edited Depth source proposals before writing (%s)", async entry => {
    const h = host(); const original = [h.source, h.frame(), h.frame()]; const extra = h.frame();
    const handoff = await loadAgentHandoff(entry);
    const created = await handoff.createEffect({ fileKey: "granted-file", pageId: "page",
      sourceNodeIds: original.map(node => node.id), task: spatialTask(), requestId: "source-guards" });
    const result = h.registry.get(created.snapshot.nodeId);
    const request = { ...created.snapshot, sourceNodeIds: [original[0].id, extra.id] };
    await expect(handoff.inspectEffectSources({ ...request, expected: "stale" })).rejects.toThrow("E_FIGMA_CONFLICT");
    const folder = h.frame(); folder.appendChild(result);
    const current = await handoff.inspectEffect(result.id,"granted-file","page");
    await expect(handoff.inspectEffectSources({ ...current, sourceNodeIds: [original[0].id, folder.id] })).rejects.toThrow("E_FIGMA_CYCLE");
    const dependent = h.frame(); const { writeStoredBinding } = await import("./stored-binding");
    writeStoredBinding(dependent, { sourceNodeIds: [result.id], renderWidth: 600, renderHeight: 400 });
    await expect(handoff.inspectEffectSources({ ...current, sourceNodeIds: [original[0].id, dependent.id] })).rejects.toThrow("E_FIGMA_CYCLE");
    extra.exportAsync.mockImplementationOnce(async () => { extra.name = "Edited while exporting"; return new Uint8Array([1,2,3]); });
    await expect(handoff.inspectEffectSources({ ...current, sourceNodeIds: request.sourceNodeIds })).rejects.toThrow("E_FIGMA_CONFLICT");
    const fresh = await handoff.inspectEffectSources({ ...current, sourceNodeIds: request.sourceNodeIds });
    extra.exportAsync.mockResolvedValue(new Uint8Array([4,5,6]));
    const task = structuredClone(current.task); task.recipe.origin = null; task.recipe.layers.splice(1,1);
    await expect(handoff.publishEffectImage({ fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: fresh.expected, revision: fresh.revision, task, sourceSet: fresh.sourceSet,
      renderWidth: 600, renderHeight: 400, imageBase64: "AQID" })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
    expect((await handoff.inspectEffect(result.id,"granted-file","page")).sourceNodeIds).toEqual(original.map(node => node.id));
  });

  it.each(["source", "bundled"] as const)("creates, retries, publishes and resumes Depth without changing sources (%s)", async (entry) => {
    const h = host(); const sources = [h.source, h.frame(), h.frame()];
    const handoff = await loadAgentHandoff(entry);
    const input = { fileKey: "granted-file", pageId: "page", sourceNodeIds: sources.map(node => node.id),
      task: spatialTask(.2), requestId: "cold-depth-creation", name: "Editable Depth" };
    const first = await handoff.createEffect(input);
    expect(first).toMatchObject({ reused: false, status: "needs-publication", snapshot: { task: input.task, revision: 1, published: false, sourceNodeIds: input.sourceNodeIds } });
    const result = h.registry.get(first.snapshot.nodeId);
    expect(result.fills).toEqual([]);
    expect(sources.map(node => node.fills)).toEqual([[],[],[]]);
    const count = h.page.children.length;
    const folder = h.frame(); folder.appendChild(result);
    expect((await handoff.createEffect(input)).snapshot.nodeId).toBe(result.id);
    // The folder replaces the result at Page level; retry adds no object.
    expect(h.page.children.length).toBe(count);
    await expect(handoff.createEffect({ ...input, task: spatialTask(.4) })).rejects.toThrow("E_FIGMA_CONFLICT");
    const snapshot = await handoff.inspectEffectWithSources(result.id, "granted-file", "page");
    await handoff.publishEffectImage({ ...snapshot, renderWidth: 600, renderHeight: 400, imageBase64: btoa("png") });
    expect(await handoff.createEffect(input)).toMatchObject({ reused: true, status: "published", snapshot: { nodeId: result.id, revision: 2, published: true } });
  });

  it.each(["source", "bundled"] as const)("serializes concurrent creation retries and cleans failed unused results (%s)", async (entry) => {
    const h = host(); const sources = [h.source, h.frame(), h.frame()];
    const handoff = await loadAgentHandoff(entry);
    const input = { fileKey: "granted-file", pageId: "page", sourceNodeIds: sources.map(node => node.id),
      task: spatialTask(), requestId: "concurrent-depth-creation" };
    const results = await Promise.all([handoff.createEffect(input), handoff.createEffect(input)]);
    expect(results[0].snapshot.nodeId).toBe(results[1].snapshot.nodeId);
    expect(results.map(result => result.reused).sort()).toEqual([false, true]);
    const before = [...h.registry.values()].filter(node => !node.removed && node.type === "RECTANGLE").length;
    sources[0].exportAsync.mockRejectedValueOnce(Error("export failed"));
    await expect(handoff.createEffect({ ...input, requestId: "failed-depth-creation" })).rejects.toThrow("export failed");
    expect([...h.registry.values()].filter(node => !node.removed && node.type === "RECTANGLE")).toHaveLength(before);
    expect((await handoff.createEffect({ ...input, requestId: "failed-depth-creation" })).status).toBe("needs-publication");
    await expect(handoff.createEffect({ ...input, fileKey: "other" })).rejects.toThrow("E_FIGMA_SCOPE");
    await expect(handoff.createEffect({ ...input, sourceNodeIds: [sources[0].id, sources[0].id, sources[2].id] })).rejects.toThrow("E_FIGMA_INPUT");
  });

  it.each(["source", "bundled"] as const)("preserves edits made during a failed creation and rejects changed result paints (%s)", async (entry) => {
    const h = host(); const sources = [h.source, h.frame(), h.frame()];
    const handoff = await loadAgentHandoff(entry);
    const input = { fileKey: "granted-file", pageId: "page", sourceNodeIds: sources.map(node => node.id),
      task: spatialTask(), requestId: "edited-failed-depth" };
    sources[0].exportAsync.mockImplementationOnce(async () => {
      const created = [...h.registry.values()].find(node => node.type === "RECTANGLE" && !node.removed);
      created.name = "Keep my edited artwork";
      throw Error("export failed");
    });
    await expect(handoff.createEffect(input)).rejects.toThrow("export failed");
    const recovered = await handoff.createEffect(input);
    const result = h.registry.get(recovered.snapshot.nodeId);
    expect(result.name).toBe("Keep my edited artwork");
    expect(recovered.reused).toBe(true);
    result.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
    await expect(handoff.publishEffectImage({ ...recovered.snapshot, renderWidth: 600, renderHeight: 400, imageBase64: btoa("png") })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills[0].type).toBe("SOLID");
    const fresh = await handoff.inspectEffect(result.id, "granted-file", "page");
    expect((await handoff.publishEffectImage({ ...fresh, renderWidth: 600, renderHeight: 400, imageBase64: btoa("png") })).published).toBe(true);
  });

  it.each(["source", "bundled"] as const)("rejects source or task drift between inspect and artifact export (%s)", async (entry) => {
    const h = host(); const sources = [h.source, h.frame(), h.frame()];
    const result = h.frame(); result.type = "RECTANGLE";
    writeStoredBinding(result, { sourceNodeIds: sources.map(node => node.id), renderWidth: 600, renderHeight: 400 });
    writeStoredOperation(result, { kind: "task", task: spatialTask() });
    const write = vi.fn(); Object.assign(h.api, { io: { write } });
    const handoff = await loadAgentHandoff(entry);
    sources[0].exportAsync.mockResolvedValueOnce(new Uint8Array([1,2,3])).mockResolvedValueOnce(new Uint8Array([4,5,6]));
    await expect(handoff.inspectEffectWithSources(result.id, "granted-file", "page", "artifact")).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(write).not.toHaveBeenCalled();
    sources[0].exportAsync.mockResolvedValueOnce(new Uint8Array([1,2,3])).mockImplementationOnce(async () => {
      writeStoredOperation(result, { kind: "task", task: spatialTask(.6) });
      return new Uint8Array([1,2,3]);
    });
    await expect(handoff.inspectEffectWithSources(result.id, "granted-file", "page", "artifact")).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(write).not.toHaveBeenCalled();
    const snapshot = await handoff.inspectEffectWithSources(result.id, "granted-file", "page", "artifact");
    expect(snapshot.task).toEqual(spatialTask(.6));
    expect(write).toHaveBeenCalledTimes(3);
  });

  it.each(["source", "bundled"] as const)("publishes edited recipe/state/roles together and rejects stale source pixels (%s)", async (entry) => {
    const h = host();
    const sources = [h.source, h.frame(), h.frame()];
    const result = h.frame(); result.type = "RECTANGLE";
    h.page.appendChild(result);
    writeStoredBinding(result, { sourceNodeIds: sources.map(node => node.id), renderWidth: 600, renderHeight: 400 });
    writeStoredOperation(result, { kind: "task", task: spatialTask() });
    const handoff = await loadAgentHandoff(entry);
    let snapshot = await handoff.inspectEffect(result.id, "granted-file", "page");
    const original = { task: result.getSharedPluginData("worldbend", "task"), binding: result.getSharedPluginData("worldbend", "binding") };
    const task = spatialTask(.45); task.recipe.camera!.focalLength = 1400;
    const sourceNodeIds = [sources[1].id, sources[0].id, sources[2].id];
    const input = () => ({ fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: snapshot.expected, revision: snapshot.revision, task, sourceNodeIds,
      renderWidth: 600, renderHeight: 400, imageBase64: btoa("png") });
    sources[0].exportAsync.mockResolvedValue(new Uint8Array([9,8,7]));
    await expect(handoff.publishEffectImage(input())).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
    expect(result.getSharedPluginData("worldbend", "task")).toBe(original.task);
    expect(result.getSharedPluginData("worldbend", "binding")).toBe(original.binding);
    snapshot = await handoff.inspectEffect(result.id, "granted-file", "page");
    snapshot = await handoff.stageEffect({ ...input(), fingerprint: `sha256:${"b".repeat(64)}` });
    const priorDraft = result.getSharedPluginData("worldbend", "effectDraft");
    const write = result.setSharedPluginData.getMockImplementation();
    let failed = false;
    result.setSharedPluginData.mockImplementation((ns: string, key: string, value: string) => {
      if (key === "binding" && !failed) { failed = true; throw new Error("host write failed"); }
      write(ns,key,value);
    });
    await expect(handoff.publishEffectImage(input())).rejects.toThrow("host write failed");
    expect(result.fills).toEqual([]);
    expect(result.getSharedPluginData("worldbend", "task")).toBe(original.task);
    expect(result.getSharedPluginData("worldbend", "binding")).toBe(original.binding);
    expect(result.getSharedPluginData("worldbend", "effectDraft")).toBe(priorDraft);
    const after = await handoff.publishEffectImage(input());
    expect(after.task).toEqual(task);
    expect(after.sourceNodeIds).toEqual(sourceNodeIds);
    expect(after.sources.map(source => source.nodeId)).toEqual(sourceNodeIds);
    expect(after.revision).toBe(snapshot.revision + 1);
    expect(after).not.toHaveProperty("draft");
    expect(result.fills).toEqual([{ type:"IMAGE", scaleMode:"FILL", imageHash:"rendered" }]);
    await expect(handoff.publishEffectImage(input())).rejects.toThrow("E_FIGMA_CONFLICT");
    expect((await handoff.inspectEffect(result.id,"granted-file","page")).task).toEqual(task);
    expect(sources.map(node => node.fills)).toEqual([[],[],[]]);
  });

  it.each(["source", "bundled"] as const)("rejects invalid role permutations and a task that changes during source reads (%s)", async (entry) => {
    const h = host(); const sources = [h.source,h.frame(),h.frame()];
    const result = h.frame(); result.type = "RECTANGLE";
    writeStoredBinding(result,{ sourceNodeIds:sources.map(node=>node.id),renderWidth:600,renderHeight:400 });
    writeStoredOperation(result,{ kind:"task",task:spatialTask() });
    const handoff = await loadAgentHandoff(entry);
    const snapshot = await handoff.inspectEffect(result.id,"granted-file","page");
    for (const sourceNodeIds of [[sources[0].id,sources[0].id,sources[2].id], [sources[0].id,sources[1].id,"foreign"], [sources[0].id]]) {
      await expect(handoff.publishEffectImage({ ...snapshot, task:spatialTask(.2),sourceNodeIds,
        renderWidth:600,renderHeight:400,imageBase64:btoa("png") })).rejects.toThrow("E_FIGMA_INPUT");
      expect(result.fills).toEqual([]);
      expect(readStoredBinding(result)?.revision).toBe(snapshot.revision);
    }
    sources[0].exportAsync.mockImplementationOnce(async () => {
      writeStoredOperation(result,{ kind:"task",task:spatialTask(.6) });
      return new Uint8Array([1,2,3]);
    });
    await expect(handoff.inspectEffect(result.id,"granted-file","page")).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(readStoredOperation(result)).toMatchObject({ operation:{ task:spatialTask(.6) } });
  });

  it.each(["source", "bundled"] as const)("exports viewport-scale sources and publishes Depth pixels in place (%s)", async (entry) => {
    const h = host();
    const sources = [h.source, h.frame(), h.frame()];
    h.page.selection = [...sources];
    const result = h.frame(); result.type = "RECTANGLE";
    h.page.appendChild(result);
    const { writeStoredBinding } = await import("./stored-binding");
    writeStoredBinding(result, { sourceNodeIds: sources.map(node => node.id), renderWidth: 600, renderHeight: 400 });
    const recipe = spatialTask().recipe;
    result.setSharedPluginData("worldbend", "task", JSON.stringify({ kind: "effect", recipe, state: spatialTask().state }));
    const handoff = await loadAgentHandoff(entry);
    const snapshot = await handoff.inspectEffectWithSources(result.id, "granted-file", "page");
    expect(snapshot.sourceRasters).toHaveLength(3);
    expect(snapshot.sourceRasters?.every(raster => (raster.base64?.length ?? 0) > 0)).toBe(true);
    // A stale revision writes nothing.
    await expect(handoff.publishEffectImage({
      fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: snapshot.expected, revision: snapshot.revision + 3,
      renderWidth: 600, renderHeight: 400, imageBase64: snapshot.sourceRasters?.[0]?.base64 ?? "",
    })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
    const staged = spatialTask(.45);
    const withDraft = await handoff.stageEffect({
      fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: snapshot.expected, task: staged, fingerprint: `sha256:${"b".repeat(64)}`,
    });
    const after = await handoff.publishEffectImage({
      fileKey: "granted-file", pageId: "page", nodeId: result.id,
      expected: withDraft.expected, revision: withDraft.revision,
      renderWidth: 600, renderHeight: 400, imageBase64: snapshot.sourceRasters?.[0]?.base64 ?? "",
    });
    // FILL matches the plugin publication path: never letterbox a resized node.
    expect(result.fills).toEqual([{ type: "IMAGE", scaleMode: "FILL", imageHash: "rendered" }]);
    expect(after.revision).toBe(snapshot.revision + 1);
    expect(after.task).toEqual({ kind: "effect", recipe, state: spatialTask().state });
    expect(after.draft).toMatchObject({ task: staged, baseRevision: after.revision });
  });
});

describe.each(["source", "bundled"] as const)("Cold editable native Perspective (%s)", entry => {
  it("reads native source facts without shader discovery or writes, then refuses stale facts",async()=>{
    const h=host(),handoff=await loadAgentHandoff(entry),count=h.registry.size;
    h.api.importShaderById.mockRejectedValue(new Error("unavailable"));
    const read=await handoff.probeNativeSource({fileKey:"granted-file",pageId:"page",sourceNodeId:h.source.id});
    expect(read.sourceFacts).toMatchObject({sourceNodeId:h.source.id,width:h.source.width,height:h.source.height,expected:expect.any(String)});
    expect(h.registry.size).toBe(count);expect(h.api.importShaderById).not.toHaveBeenCalled();
    h.source.width+=1;
    await expect(handoff.createNative({...inputFor(h),sourceFacts:read.sourceFacts})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(h.api.createFrame).not.toHaveBeenCalled();
  });
  it("rejects a source below the native protocol's minimum logical axis before creating unreadable work",async()=>{
    const h=host(),handoff=await loadAgentHandoff(entry),count=h.registry.size;
    h.source.width=.001;
    await expect(handoff.createNative({fileKey:"granted-file",pageId:"page",sourceNodeId:h.source.id,requestId:"tiny-native",
      spec,width:520,height:606,renderWidth:520,renderHeight:606,inverse:[1/520,0,0,0,1/606,0,0,0,1]})).rejects.toThrow(/INPUT/);
    expect(h.registry.size).toBe(count);expect(h.api.createFrame).not.toHaveBeenCalled();
  });
  async function replacementFixture() {
    const h=host(),native=await loadNativeDocumentFrame(entry);
    const result=await publishNativeResult({source:h.source,renderer,spec,
      inverse:[1/520,0,0,0,1/606,0,0,0,1],placement:{x:800,y:0,width:520,height:606},renderWidth:520,renderHeight:606});
    const old=(await nativeDocumentParts(result)).content;
    (old.exportAsync as ReturnType<typeof vi.fn>).mockResolvedValue("<svg width='520' height='606'><path d='M0 0H520V606H0Z'/></svg>");
    const text=(name:string,characters:string)=>{
      const node=h.frame();node.type="TEXT";node.fontName={family:name,style:"Regular"};node.characters=characters;
      node.getStyledTextSegments=()=>[{fontName:node.fontName,characters:node.characters}];
      node.clone=()=>text(node.fontName.family,node.characters);
      return node;
    };
    const oldText=text("Old family","Keep this original"),replacement=h.frame(),newText=text("New family","New editable content");
    old.appendChild(oldText);replacement.appendChild(newText);replacement.resizeWithoutConstraints(320,180);
    replacement.x=1800;replacement.fills=[{type:"SOLID",color:{r:.1,g:.3,b:.8}}];
    const scope={fileKey:"granted-file",pageId:"page",nodeId:result.id,carrier:"frame" as const};
    const first=await native.readNativeContinuation(scope);let json=first.json;
    for(let part=1;part<first.partCount;part++)json+=(await native.readNativeContinuation({...scope,part,token:first.token})).json;
    const saved=JSON.parse(json),input={...scope,targetExpected:saved.targetExpected,sourceExpected:saved.sourceExpected,svgExpected:saved.source.previewFingerprint,
      sourceNodeId:replacement.id,spec,inverse:[1/601,0,0,0,1/401,0,0,0,1],width:600.5,height:400.25,renderWidth:601,renderHeight:401};
    return {h,native,result,old,oldText,replacement,newText,input};
  }
  it("retires a transferred native replacement during font loading and allows a fresh retry",async()=>{
    const f=await replacementFixture(),oldParent=f.old.parent,count=f.h.registry.size;let cancelled=false;
    const validate=()=>{if(cancelled)throw Error("E_FIGMA_TRANSFER: retired transfer");};
    f.h.api.loadFontAsync.mockImplementation(async()=>{cancelled=true;});
    await expect(f.native.reviseNativeFrame(f.input,validate)).rejects.toThrow(/retired transfer/);
    expect((await nativeDocumentParts(f.result)).content.id).toBe(f.old.id);
    expect(f.old.parent).toBe(oldParent);expect(f.replacement.removed).toBe(false);
    expect(f.h.registry.size).toBe(count);
    cancelled=false;f.h.api.loadFontAsync.mockResolvedValue(undefined);
    const after=await f.native.reviseNativeFrame(f.input,validate);
    expect(after.snapshot.revision).toBe(2);
    expect((await nativeDocumentParts(f.result)).content.id).not.toBe(f.old.id);
  });
  it("replaces native Content independently while retaining its old node identity and loading both font sets",async()=>{
    const f=await replacementFixture(),sourceBefore=JSON.stringify({x:f.replacement.x,y:f.replacement.y,fills:f.replacement.fills,characters:f.newText.characters});
    const after=await f.native.reviseNativeFrame(f.input),parts=await nativeDocumentParts(f.result);
    expect(after).toMatchObject({sourceOriginNodeId:f.replacement.id,retainedSourceNodeIds:[f.old.id],snapshot:{revision:2,source:{width:320,height:180}}});
    expect(parts.content.id).not.toBe(f.old.id);expect(parts.content.id).not.toBe(f.replacement.id);
    expect(parts.content.children[0]).toMatchObject({type:"TEXT",characters:"New editable content"});
    expect(f.old.parent).toBe(f.h.page);expect(f.old.removed).toBe(false);expect(f.oldText.characters).toBe("Keep this original");
    expect(f.old.name).toContain("Previous content");
    expect(f.h.api.loadFontAsync).toHaveBeenCalledWith({family:"Old family",style:"Regular"});
    expect(f.h.api.loadFontAsync).toHaveBeenCalledWith({family:"New family",style:"Regular"});
    expect(JSON.stringify({x:f.replacement.x,y:f.replacement.y,fills:f.replacement.fills,characters:f.newText.characters})).toBe(sourceBefore);
    (parts.content.children[0] as any).characters="Later local edit";
    expect(f.newText.characters).toBe("New editable content");expect(f.oldText.characters).toBe("Keep this original");
    expect(f.h.api.createImage).not.toHaveBeenCalled();
  });
  it.each(["metadata","reparent"] as const)("restores old Content and removes only the new clone after a failed replacement (%s)",async failure=>{
    const f=await replacementFixture(),before=JSON.stringify((await nativeDocumentParts(f.result)).record),roots=f.h.page.children.map((n:any)=>n.id),count=f.h.registry.size;
    const oldBefore={name:f.old.name,x:f.old.x,y:f.old.y,parent:f.old.parent};
    if(failure==="metadata")vi.mocked(f.result.setSharedPluginData).mockImplementationOnce(()=>{throw Error("metadata write failed");});
    else {const append=f.h.page.appendChild.getMockImplementation()!;f.h.page.appendChild.mockImplementationOnce((node:any)=>{append(node);throw Error("reparent write failed");});}
    await expect(f.native.reviseNativeFrame(f.input)).rejects.toThrow(/write failed/);
    expect(JSON.stringify((await nativeDocumentParts(f.result)).record)).toBe(before);
    expect(f.old).toMatchObject(oldBefore);expect(f.oldText.characters).toBe("Keep this original");
    expect(f.h.registry.size).toBe(count);expect(f.h.page.children.map((n:any)=>n.id)).toEqual(roots);
    expect(f.replacement.removed).toBe(false);expect(f.newText.characters).toBe("New editable content");
  });
  it("rejects replacement-source drift during font loading before any clone or metadata write",async()=>{
    const f=await replacementFixture(),before=f.result.getSharedPluginData("worldbend","native"),count=f.h.registry.size;
    f.h.api.loadFontAsync.mockImplementationOnce(async()=>{f.newText.characters="A newer source edit";});
    await expect(f.native.reviseNativeFrame(f.input)).rejects.toThrow(/CONFLICT/);
    expect(f.result.getSharedPluginData("worldbend","native")).toBe(before);expect(f.h.registry.size).toBe(count);
    expect(f.old.parent?.type).toBe("FRAME");expect(f.newText.characters).toBe("A newer source edit");
  });
  it.each(["ok","metadata","mode","lookupDrift"] as const)("preserves inherited modes on new, replacement and retained Content, and restores explicit modes after failure (%s)",async failure=>{
    const f=await replacementFixture(),collection={id:"colors",modes:[{modeId:"warm"},{modeId:"cool"}]};
    (f.h.api as any).variables={getVariableCollectionByIdAsync:vi.fn(async(id:string)=>id==="colors"?collection:null)};
    const mode=(node:any):string=>node?.explicitVariableModes?.colors??(node?.parent?mode(node.parent):"warm");
    const install=(node:any,initial:Record<string,string>={})=>{
      let explicit={...initial};
      Object.defineProperty(node,"explicitVariableModes",{get:()=>({...explicit}),configurable:true});
      Object.defineProperty(node,"resolvedVariableModes",{get:()=>({colors:mode(node)}),configurable:true});
      node.setExplicitVariableModeForCollection=vi.fn((value:any,id:string)=>{expect(value).toBe(collection);explicit[value.id]=id;});
      node.clearExplicitVariableModeForCollection=vi.fn((value:any)=>{expect(value).toBe(collection);delete explicit[value.id];});
      const clone=node.clone;node.clone=()=>{const copy=clone();install(copy,explicit);return copy;};
    };
    install(f.old);install(f.result,{colors:"cool"});install(f.replacement);
    const parent=f.h.frame();install(parent,{colors:"cool"});parent.appendChild(f.replacement);
    expect(f.replacement.explicitVariableModes).toEqual({});expect(f.replacement.resolvedVariableModes).toEqual({colors:"cool"});
    const handoff=await loadAgentHandoff(entry),created=await handoff.createNative({fileKey:"granted-file",pageId:"page",sourceNodeId:f.replacement.id,
      requestId:"inherited-modes",spec,width:320,height:180,renderWidth:320,renderHeight:180,inverse:[1/320,0,0,0,1/180,0,0,0,1]});
    const createdParts=await nativeDocumentParts(f.h.registry.get(created.nodeId));
    expect(createdParts.content.explicitVariableModes).toEqual({colors:"cool"});
    expect(createdParts.content.resolvedVariableModes).toEqual({colors:"cool"});
    expect(f.h.api.loadFontAsync).toHaveBeenCalledWith({family:"New family",style:"Regular"});
    const scope={fileKey:"granted-file",pageId:"page",nodeId:f.result.id,carrier:"frame" as const},first=await f.native.readNativeContinuation(scope);let json=first.json;
    for(let part=1;part<first.partCount;part++)json+=(await f.native.readNativeContinuation({...scope,part,token:first.token})).json;
    const saved=JSON.parse(json),input={...f.input,targetExpected:saved.targetExpected,sourceExpected:saved.sourceExpected,svgExpected:saved.source.previewFingerprint};
    if(failure!=="ok") {
      if(failure==="metadata")vi.mocked(f.result.setSharedPluginData).mockImplementationOnce(()=>{throw Error("metadata write failed");});
      else if(failure==="mode") {
        const setter=vi.mocked(f.old.setExplicitVariableModeForCollection),set=setter.getMockImplementation()!;
        setter.mockImplementationOnce((collection,mode)=>{set(collection,mode);throw Error("mode write failed");});
      } else (f.h.api as any).variables.getVariableCollectionByIdAsync.mockImplementationOnce(async()=>{
        f.newText.characters="Newer native text";return collection;
      });
      await expect(f.native.reviseNativeFrame(input)).rejects.toThrow(failure==="lookupDrift"?/CONFLICT/:/write failed/);
      expect(f.old.explicitVariableModes).toEqual({});expect(f.old.resolvedVariableModes).toEqual({colors:"cool"});
      expect(f.old.parent?.type).toBe("FRAME");
    } else {
      await f.native.reviseNativeFrame(input);const parts=await nativeDocumentParts(f.result);
      expect(parts.content.explicitVariableModes).toEqual({colors:"cool"});expect(parts.content.resolvedVariableModes).toEqual({colors:"cool"});
      expect(f.old.explicitVariableModes).toEqual({colors:"cool"});expect(f.old.resolvedVariableModes).toEqual({colors:"cool"});
      expect(f.old.parent).toBe(f.h.page);
    }
    expect(f.replacement.explicitVariableModes).toEqual({});expect(f.replacement.resolvedVariableModes).toEqual({colors:"cool"});
  });
  it("revises a guarded document on the same native work and refuses later content edits even when geometry stays unchanged",async()=>{
    const h=host(),native=await loadNativeDocumentFrame(entry);
    const result=await publishNativeResult({source:h.source,renderer,spec,
      inverse:[1/520,0,0,0,1/606,0,0,0,1],placement:{x:800,y:10,width:520,height:606},renderWidth:520,renderHeight:606});
    const parts=await nativeDocumentParts(result);
    (parts.content.exportAsync as ReturnType<typeof vi.fn>).mockResolvedValue("<svg width='520' height='606'><path d='M0 0H520V606H0Z'/></svg>");
    const scope={fileKey:"granted-file",pageId:"page",nodeId:result.id,carrier:"frame" as const};
    const read=async()=>{
      const first=await native.readNativeContinuation(scope);let json=first.json;
      for(let part=1;part<first.partCount;part++)json+=(await native.readNativeContinuation({...scope,part,token:first.token})).json;
      return JSON.parse(json);
    };
    const saved=await read(),guard={...scope,targetExpected:saved.targetExpected,sourceExpected:saved.sourceExpected,svgExpected:saved.source.previewFingerprint};
    const input={...guard,sourceNodeId:parts.content.id,spec:structuredClone(spec),inverse:[1/701,0,0,0,1/481,0,0,0,1],
      width:700.5,height:480.25,renderWidth:701,renderHeight:481};
    input.spec.destination.quad.tr.x=.9;
    const after=await native.reviseNativeFrame(input);
    expect(after.snapshot).toMatchObject({nodeId:result.id,revision:2,placement:{x:800,y:10,width:700.5,height:480.25}});
    expect((await nativeDocumentParts(result)).content.id).toBe(parts.content.id);
    const fresh=await read();
    parts.content.fills=[{type:"SOLID",color:{r:.8,g:.1,b:.2}}];
    const before=JSON.stringify(result.getSharedPluginData("worldbend","native"));
    await expect(native.reviseNativeFrame({...input,targetExpected:fresh.targetExpected,sourceExpected:fresh.sourceExpected,
      svgExpected:fresh.source.previewFingerprint})).rejects.toThrow(/CONFLICT/);
    expect(JSON.stringify(result.getSharedPluginData("worldbend","native"))).toBe(before);
    expect(parts.content.fills).toEqual([{type:"SOLID",color:{r:.8,g:.1,b:.2}}]);
    expect(h.api.createImage).not.toHaveBeenCalled();
  });
  it("rejects native content drift during renderer import and permits a current retry",async()=>{
    const h=host(),native=await loadNativeDocumentFrame(entry);
    const result=await publishNativeResult({source:h.source,renderer,spec,
      inverse:[1/520,0,0,0,1/606,0,0,0,1],placement:{x:800,y:0,width:520,height:606},renderWidth:520,renderHeight:606});
    const parts=await nativeDocumentParts(result);
    (parts.content.exportAsync as ReturnType<typeof vi.fn>).mockResolvedValue("<svg width='520' height='606'><path d='M0 0H520V606H0Z'/></svg>");
    const scope={fileKey:"granted-file",pageId:"page",nodeId:result.id,carrier:"frame" as const};
    const read=async()=>{const first=await native.readNativeContinuation(scope);let json=first.json;
      for(let part=1;part<first.partCount;part++)json+=(await native.readNativeContinuation({...scope,part,token:first.token})).json;
      return JSON.parse(json);};
    const inputFor=(saved:any)=>({...scope,targetExpected:saved.targetExpected,sourceExpected:saved.sourceExpected,svgExpected:saved.source.previewFingerprint,
      sourceNodeId:parts.content.id,spec,inverse:[1/600,0,0,0,1/606,0,0,0,1],width:600,height:606,renderWidth:600,renderHeight:606});
    const input=inputFor(await read()),before=result.getSharedPluginData("worldbend","native");
    const importShader=h.api.importShaderById.getMockImplementation()!;
    h.api.importShaderById.mockImplementationOnce(async id=>{parts.content.name="late edit";return importShader(id);});
    await expect(native.reviseNativeFrame(input)).rejects.toThrow(/changed/);
    expect(result.getSharedPluginData("worldbend","native")).toBe(before);
    expect(result.width).toBe(520);
    const after=await native.reviseNativeFrame(inputFor(await read()));
    expect(after.snapshot).toMatchObject({revision:2,placement:{width:600}});
    expect(parts.content.name).toBe("late edit");
  });
  const inputFor = (h: ReturnType<typeof host>) => ({
    fileKey: "granted-file", pageId: "page", sourceNodeId: h.source.id, requestId: "native-brand",
    name: "Weekly editable presentation", spec, width: 520, height: 606, renderWidth: 520, renderHeight: 606,
    inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1] as import("@worldbend/web/types").NineNumbers,
  });
  it("creates once across concurrent retries, preserves originals and recovers native content edits after copy/reparenting", async () => {
    const h = host(), handoff = await loadAgentHandoff(entry), input = inputFor(h);
    h.source.fills = [{ type: "SOLID", color: { r: .1, g: .2, b: .3 } }];
    const original = JSON.stringify({ fills: h.source.fills, children: h.source.children, width: h.source.width });
    const both = await Promise.all([handoff.createNative(input), handoff.createNative(input)]);
    expect(both[0].nodeId).toBe(both[1].nodeId);
    expect(both.map(v => v.reused).sort()).toEqual([false, true]);
    const result = h.registry.get(both[0].nodeId);
    const parts = await nativeDocumentParts(result);
    expect(parts.content.id).not.toBe(h.source.id);
    expect(parts.content.fills).toEqual(h.source.fills);
    expect(result.name).toBe(input.name);
    expect(JSON.stringify({ fills: h.source.fills, children: h.source.children, width: h.source.width })).toBe(original);
    // Native content updates intentionally keep the live geometry; they are
    // retained by a fresh creation retry rather than resetting to the source.
    parts.content.fills = [{ type: "SOLID", color: { r: .8, g: .2, b: .1 } }];
    const copy = result.clone(); copy.x = 1800;
    const parent = h.frame(); parent.appendChild(result); result.x = 70; result.y = 30;
    h.source.remove();
    const retried = await handoff.createNative(input);
    expect(retried).toMatchObject({ nodeId: result.id, reused: true, status: "published", affectedNodeIds: [] });
    expect((await nativeDocumentParts(result)).content.fills).toContainEqual({ type: "SOLID", color: { r: .8, g: .2, b: .1 } });
    expect(result).toMatchObject({ x: 70, y: 30 });
    const copyState = await handoff.inspect(copy.id, "granted-file", "page");
    expect(copyState.revision).toBe(0);
    await expect(handoff.createNative({ ...input, width: 521, renderWidth: 521 })).rejects.toThrow("E_FIGMA_CONFLICT");
    const next = await handoff.apply({ ...retried.snapshot, expected: retried.snapshot.expected, spec,
      inverse: [1 / 600, 0, 0, 0, 1 / 606, 0, 0, 0, 1], width: 600, height: 606 });
    expect(next).toMatchObject({ revision: 2, placement: { x: 70, y: 30, width: 600 } });
    expect((await handoff.inspect(copy.id, "granted-file", "page")).revision).toBe(0);
  });
  it("rejects a source descendant change during sampler import before creating anything", async () => {
    const h = host(), handoff = await loadAgentHandoff(entry), child = h.frame();
    h.source.appendChild(child);
    h.api.importShaderById.mockImplementationOnce(async id => {
      child.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      return { id, type: "effect", propertyDefinitions: Object.fromEntries(
        ["h00", "h01", "h02", "h10", "h11", "h12", "h20", "h21", "h22", "sourceRight", "sourceBottom"]
          .map((name, i) => [String(i), { name, type: "NUMBER" }])) };
    });
    const before = h.registry.size;
    await expect(handoff.createNative(inputFor(h))).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(h.registry.size).toBe(before);
    expect(h.api.createFrame).not.toHaveBeenCalled();
  });
  it("refuses unavailable samplers, outside paints and malformed geometry without making a raster fallback", async () => {
    const h = host(), handoff = await loadAgentHandoff(entry), input = inputFor(h), before = h.registry.size;
    h.api.importShaderById.mockRejectedValueOnce(Error("unavailable"));
    await expect(handoff.createNative(input)).rejects.toThrow("E_FIGMA_RENDERER");
    h.source.absoluteRenderBounds = { x: -10, y: 0, width: 530, height: 606 };
    await expect(handoff.createNative(input)).rejects.toThrow("E_FIGMA_INPUT");
    delete h.source.absoluteRenderBounds;
    await expect(handoff.createNative({ ...input, requestId: "" })).rejects.toThrow("E_FIGMA_INPUT");
    await expect(handoff.createNative({ ...input, width: 520.5 })).rejects.toThrow("E_FIGMA_INPUT");
    expect(h.registry.size).toBe(before);
    expect(h.api.createImage).not.toHaveBeenCalled();
  });
  it("removes a half-written result and its Content if host metadata publication fails", async () => {
    const h = host(), handoff = await loadAgentHandoff(entry), create = h.api.createFrame.getMockImplementation()!;
    const before = h.registry.size;
    h.api.createFrame.mockImplementation(() => {
      const result = create();
      const set = result.setSharedPluginData;
      result.setSharedPluginData = (ns: string, key: string, value: string) => {
        if (key === "native") throw Error("host storage failed");
        set(ns, key, value);
      };
      return result;
    });
    await expect(handoff.createNative(inputFor(h))).rejects.toThrow("host storage failed");
    const resources=h.page.children.filter((node:any)=>node.getSharedPluginData("worldbend","nativeShaderTemplate")==="worldbend.figma.native-shader-template/0.1");
    expect(resources).toHaveLength(1);expect(resources[0]).toMatchObject({visible:false,locked:true,children:[]});
    expect(h.registry.size).toBe(before+1);
    expect(h.source.removed).toBe(false);
  });
  it("keeps a newly edited native work when structural drift invalidates the final read", async () => {
    const h = host(), handoff = await loadAgentHandoff(entry);
    const get = h.api.getNodeByIdAsync.getMockImplementation()!;
    let edited: any;
    h.api.getNodeByIdAsync.mockImplementation(async (id: string) => {
      const node = await get(id);
      const result = h.page.children.find((n: any) => n.getSharedPluginData("worldbend", "nativeCreation") && n.children.length);
      if (!edited && result && id === result.children[0]?.children[0]?.id) {
        edited = result;
        result.children[0].appendChild(h.frame());
      }
      return node;
    });
    await expect(handoff.createNative(inputFor(h))).rejects.toThrow("structure changed");
    expect(edited.removed).toBe(false);
    expect(edited.children[0].children).toHaveLength(2);
    expect(h.source.removed).toBe(false);
    const createdCount = h.api.createFrame.mock.calls.length;
    await expect(handoff.createNative(inputFor(h))).rejects.toThrow("structure changed");
    expect(h.api.createFrame.mock.calls.length).toBe(createdCount);
  });
  it("refuses an over-depth recovery tree before writing a native result", async () => {
    const h = host(), handoff = await loadAgentHandoff(entry);
    let parent = h.source;
    for (let i = 0; i < 66; i++) { const child = h.frame(); parent.appendChild(child); parent = child; }
    await expect(handoff.createNative(inputFor(h))).rejects.toThrow("E_FIGMA_LIMIT");
    expect(h.api.createFrame).not.toHaveBeenCalled();
  });

  it("reserves the copied Content and two wrappers so creation remains recoverable within the page budget", async () => {
    const h = host(), handoff = await loadAgentHandoff(entry);
    for (let i = 0; i < 19997; i++) h.page.children.push({ id: `budget-${i}`, type: "RECTANGLE", removed: false,
      parent: h.page, getSharedPluginData: () => "" });
    await expect(handoff.createNative(inputFor(h))).rejects.toThrow("recoverable page budget");
    expect(h.api.createFrame).not.toHaveBeenCalled();
  });

});
