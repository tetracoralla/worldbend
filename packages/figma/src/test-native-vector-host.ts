import { vi } from "vitest";

export function nativeVectorTestHost() {
  const registry = new Map<string, any>();
  let nextId = 1;
  let rejectNextNetwork = false;
  let nextNetworkHook: (() => void | Promise<void>) | undefined;
  const page: any = { id: "page", type: "PAGE", parent: null, children: [] };
  registry.set(page.id,page);

  const detach = (node: any) => {
    if (node.parent?.children) node.parent.children = node.parent.children.filter((child: any) => child !== node);
  };
  const remove = (node: any) => {
    detach(node); registry.delete(node.id); node.parent = null; node.removed = true;
  };
  const append = (parent: any, child: any) => {
    detach(child); parent.children.push(child); child.parent = parent;
  };
  page.appendChild=(child:any)=>append(page,child);

  function makeVector(name = "Card"): any {
    const shared = new Map<string,string>();
    const plugin = new Map<string,string>();
    const node: any = {
      id: `vector-${nextId++}`, type: "VECTOR", name, width: 100, height: 50, x: 10, y: 20,
      visible: true, locked: false, opacity: 1, blendMode: "PASS_THROUGH", isMask: false,
      maskType: "ALPHA", effects: [],
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }], strokes: [],
      strokeWeight: 4, strokeAlign: "CENTER", strokeCap: "NONE", strokeJoin: "MITER",
      strokeMiterLimit: 4, dashPattern: [],
      constraints: { horizontal: "MIN", vertical: "MIN" },
      getPluginData:(key:string)=>plugin.get(key)??"",
      setPluginData:(key:string,value:string)=>plugin.set(key,value),
      getSharedPluginData:(ns:string,key:string)=>shared.get(`${ns}:${key}`)??"",
      setSharedPluginData:(ns:string,key:string,value:string)=>shared.set(`${ns}:${key}`,value),
      vectorNetwork: {
        vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
        segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 }],
        regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }],
      },
      get relativeTransform() { return [[1, 0, node.x], [0, 1, node.y]]; },
      set relativeTransform(value: Transform) { node.x = value[0][2]; node.y = value[1][2]; },
      get absoluteTransform() {
        const parentX = node.parent?.absoluteTransform?.[0][2] ?? 0;
        const parentY = node.parent?.absoluteTransform?.[1][2] ?? 0;
        return [[1, 0, parentX + node.x], [0, 1, parentY + node.y]];
      },
      get absoluteBoundingBox() {
        const transform = node.absoluteTransform;
        return { x: transform[0][2], y: transform[1][2], width: node.width, height: node.height };
      },
      clone: vi.fn(() => {
        const clone = makeVector(node.name);
        clone.vectorNetwork = structuredClone(node.vectorNetwork);
        clone.fills = structuredClone(node.fills); clone.strokes = structuredClone(node.strokes);
        clone.effects = structuredClone(node.effects); clone.opacity = node.opacity; clone.blendMode = node.blendMode;
        clone.x = node.x; clone.y = node.y;
        clone.width=node.width;clone.height=node.height;
        return clone;
      }),
      setVectorNetworkAsync: vi.fn(async (network: VectorNetwork) => {
        if (rejectNextNetwork) { rejectNextNetwork = false; throw new Error("network write failed"); }
        const hook = nextNetworkHook; nextNetworkHook = undefined; await hook?.();
        node.vectorNetwork = structuredClone(network);
        const xs = network.vertices.map((vertex) => vertex.x);
        const ys = network.vertices.map((vertex) => vertex.y);
        node.width = Math.max(...xs) - Math.min(...xs);
        node.height = Math.max(...ys) - Math.min(...ys);
      }),
      remove: vi.fn(() => remove(node)),
    };
    registry.set(node.id, node); page.children.push(node); node.parent = page;
    return node;
  }

  function makeFrame(): any {
    const shared = new Map<string, string>();
    const plugin = new Map<string,string>();
    const node: any = {
      id: `frame-${nextId++}`, type: "FRAME", name: "Frame", width: 100, height: 100, x: 0, y: 0,
      visible:true,removed:false,locked:false,
      parent: page, children: [], fills: [], strokes: [], effects: [], opacity: 1,
      blendMode: "PASS_THROUGH", layoutMode: "NONE", clipsContent: false,
      get relativeTransform() { return [[1, 0, node.x], [0, 1, node.y]]; },
      set relativeTransform(value: Transform) { node.x = value[0][2]; node.y = value[1][2]; },
      get absoluteTransform() { return node.absoluteTransformOverride ?? [[1, 0, node.x+(node.parent?.absoluteTransform?.[0][2]??0)], [0, 1, node.y+(node.parent?.absoluteTransform?.[1][2]??0)]]; },
      get absoluteBoundingBox(){return {x:node.x,y:node.y,width:node.width,height:node.height};},
      resizeWithoutConstraints: vi.fn((width: number, height: number) => { node.width = width; node.height = height; }),
      appendChild: vi.fn((child: any) => append(node, child)),
      getPluginData:(key:string)=>plugin.get(key)??"",
      setPluginData:(key:string,value:string)=>plugin.set(key,value),
      getSharedPluginData: (namespace: string, key: string) => shared.get(`${namespace}:${key}`) ?? "",
      setSharedPluginData: (namespace: string, key: string, value: string) => shared.set(`${namespace}:${key}`, value),
      remove: vi.fn(() => { for (const child of [...node.children]) child.remove(); remove(node); }),
    };
    registry.set(node.id, node); page.children.push(node);
    return node;
  }

  const api = {
    fileKey:"file",currentPage:page,
    flatten:vi.fn((nodes:any[])=>{
      const result=makeVector("Native flattened outline"),vertices:any[]=[],segments:any[]=[],regions:any[]=[];
      for(const node of nodes) {
        const transform=node.absoluteTransform;
        if(transform[0][0]!==1||transform[0][1]!==0||transform[1][0]!==0||transform[1][1]!==1)throw Error("test flatten only models translation");
        const vo=vertices.length,so=segments.length;
        vertices.push(...node.vectorNetwork.vertices.map((v:any)=>({...v,x:v.x+transform[0][2],y:v.y+transform[1][2]})));
        segments.push(...node.vectorNetwork.segments.map((s:any)=>({...s,start:s.start+vo,end:s.end+vo})));
        regions.push(...node.vectorNetwork.regions.map((r:any)=>({...r,loops:r.loops.map((l:number[])=>l.map(i=>i+so)),fills:r.fills??node.fills})));
        node.remove();
      }
      const x=Math.min(...vertices.map(v=>v.x)),y=Math.min(...vertices.map(v=>v.y));
      result.x=x;result.y=y;result.width=Math.max(...vertices.map(v=>v.x))-x;result.height=Math.max(...vertices.map(v=>v.y))-y;
      result.vectorNetwork={vertices:vertices.map(v=>({...v,x:v.x-x,y:v.y-y})),segments,regions};return result;
    }),
    mixed: Symbol("mixed"), createFrame: vi.fn(makeFrame), createVector: vi.fn(makeVector),
    getNodeByIdAsync: vi.fn(async (id: string) => registry.get(id) ?? null),
  };
  vi.stubGlobal("figma", api);
  return { api, page, registry, source: makeVector(), rejectNetwork: () => { rejectNextNetwork = true; },
    onNextNetwork: (hook: () => void | Promise<void>) => { nextNetworkHook = hook; }, makeVector };
}
