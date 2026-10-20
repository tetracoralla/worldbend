import {appendNativeTestChild,installNativeTestBasis} from "./native-capture-test-host";
import { describe, expect, it, vi } from "vitest";
import {
  artworkVectorFingerprint,
  canCaptureArtworkVectorSource,
  captureArtworkVectorGeometry,
  planArtworkVectorLayers,
} from "./native-vector-artwork";

const fill = { type: "SOLID", color: { r: .9, g: .2, b: .2 } };
const otherFill = { type: "SOLID", color: { r: .1, g: .2, b: .9 } };
const stroke = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
const network = { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
  segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 }],
  regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }] };

function fixture() {
  const children: any[] = [];
  let nextId = 1;
  const page = { id: "page", type: "PAGE", children,
    appendChild: vi.fn((node: any) => {
      appendNativeTestChild(page,node);
    }) };
  const painters = { mixed: Symbol("mixed") };

  function leaf(type: string, extra: Record<string, unknown> = {}): any {
    const node: any = {
      id: `leaf-${nextId++}`, type, name: type, visible: true, removed: false,
      width: 100, height: 50, opacity: 1, blendMode: "NORMAL", effects: [], isMask: false,
      fills: [fill], strokes: [], strokeWeight: 2, strokeAlign: "INSIDE", strokeCap: "NONE",
      strokeJoin: "MITER", strokeMiterLimit: 4, dashPattern: [],
      relativeTransform: [[1, 0, 10], [0, 1, 20]], absoluteTransform: [[1, 0, 10], [0, 1, 20]],
      absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 50 },
      characters: "Hello",
      fontName: { family: "Inter", style: "Regular" },
      getStyledTextSegments: vi.fn(() => [{ characters: "Hello", fontName: { family: "Inter", style: "Regular" } }]),
      clone: vi.fn(() => {
        const copy = leaf(type, extra);
        copy.parent = page; children.push(copy);
        return copy;
      }),
      remove() {
        node.removed = true;
        const index = children.indexOf(node);
        if (index >= 0) children.splice(index, 1);
      },
      outlineStroke: vi.fn(() => {const out=vector(`outline-${nextId++}`, [stroke]);page.appendChild(out);return out;}),
      resize: vi.fn((width: number, height: number) => { node.width = width; node.height = height; }),
      setVectorNetworkAsync: vi.fn(async (value: any) => { node.vectorNetwork = value; }),
      ...extra,
    };
    node.vectorNetwork = structuredClone(network);
    return installNativeTestBasis(node);
  }

  function vector(name: string, fills: any[] = [fill]): any {
    const node = leaf("VECTOR", { name });
    node.fills = painters.mixed;
    node.vectorNetwork = {
      vertices: structuredClone(network.vertices),
      segments: structuredClone(network.segments),
      regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]], fills: structuredClone(fills) }],
    };
    return node;
  }

  function frame(kind = "FRAME", ...layers: any[]): any {
    const node: any = {
      id: `frame-${nextId++}`, type: kind, name: "Poster", visible: true, removed: false,
      width: 440, height: 620, opacity: 1, blendMode: kind === "GROUP" ? "PASS_THROUGH" : "NORMAL",
      effects: [], isMask: false, fills: [otherFill], strokes: [], strokeWeight: 2,
      strokeAlign: "INSIDE", clipsContent: false, layoutMode: "NONE",
      children: layers,
      relativeTransform: [[1, 0, 0], [0, 1, 0]], absoluteTransform: [[1, 0, 0], [0, 1, 0]],
      absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 620 },
      clone: vi.fn(() => { const copy = frame(kind, ...layers.map((layer: any) => layer)); copy.parent = page; children.push(copy); return copy; }),
    };
    for (const layer of layers) layer.parent = node;
    node.remove=()=>{node.removed=true;const i=node.parent?.children?.indexOf(node);if(i>=0)node.parent.children.splice(i,1);};
    return installNativeTestBasis(node);
  }

  const host: any = {
    currentPage: page,
    createFrame:vi.fn(()=>frame("FRAME")),
    createRectangle: vi.fn(() => leaf("RECTANGLE")),
    createEllipse: vi.fn(() => leaf("ELLIPSE")),
    createPolygon: vi.fn(() => leaf("POLYGON")),
    createStar: vi.fn(() => leaf("STAR")),
    createVector: vi.fn(() => leaf("VECTOR")),
    loadFontAsync: vi.fn(async () => {}),
    flatten: vi.fn((nodes: any[]) => {
      for (const node of nodes) {
        node.removed = true;
        const index = children.indexOf(node);
        if (index >= 0) children.splice(index, 1);
      }
      const merged = vector(`flat-${nextId++}`);
      merged.parent = page; children.push(merged);
      // Each native region retains its paint independently of node fills.
      const regionFills = nodes.flatMap((node: any) =>
        Array.isArray(node.fills) ? node.fills.filter((paint: any) => paint.visible !== false) : []);
      const outlineFills = nodes.flatMap((node: any) =>
        node.vectorNetwork?.regions?.flatMap((region: any) => region.fills ?? []) ?? []);
      const paints = [...regionFills, ...outlineFills];
      if (paints.length) {
        merged.vectorNetwork.regions = paints.map((paint: any) =>
          ({ windingRule: "NONZERO", loops: [[0, 1, 2, 3]], fills: [structuredClone(paint)] }));
      }
      return merged;
    }),
  };
  vi.stubGlobal("figma", painters);
  return { page, children, host, leaf, vector, frame };
}

describe("whole-artwork vector planning", () => {
  it("preserves inherited clone modes and freezes mixed text range colors before outlining", async () => {
    const h = fixture(), collection = { id: "collection" }, rangeWrites: any[] = [], modes: any[] = [];
    const blue = { type: "SOLID", color: { r: .05, g: .2, b: .8 }, boundVariables: { color: { id: "color", type: "VARIABLE_ALIAS" } } };
    const text = h.leaf("TEXT", { fills: figma.mixed, resolvedVariableModes: { collection: "cool" } });
    text.getStyledTextSegments = () => [{ start: 0, end: 2, fills: [blue], fontName: text.fontName },
      { start: 2, end: 5, fills: [stroke], fontName: text.fontName }];
    text.clone.mockImplementation(() => h.leaf("TEXT", {
      setExplicitVariableModeForCollection: (c: any, mode: string) => modes.push([c, mode]),
      setRangeFills: function(this: any, start: number, end: number, fills: any[]) {
        rangeWrites.push({ start, end, fills });
        this.fills = [...(rangeWrites.length > 1 ? this.fills : []), ...fills];
      },
    }));
    h.host.variables = { getVariableCollectionByIdAsync: vi.fn(async () => collection) };
    const poster = h.frame("FRAME", text); poster.fills = [];
    expect(await canCaptureArtworkVectorSource(poster, h.host)).toBe(true);
    const geometry = await captureArtworkVectorGeometry(poster, h.host, () => {});
    expect(modes).toEqual([[collection, "cool"]]);
    expect(rangeWrites).toEqual([{ start: 0, end: 2, fills: [{ type: "SOLID", color: blue.color }] },
      { start: 2, end: 5, fills: [stroke] }]);
    expect(geometry![0]!.vectorNetwork.regions!.map(r => r.fills)).toEqual(rangeWrites.map(r => r.fills));
    expect(text.fills).toBe(figma.mixed); expect(text.resolvedVariableModes).toEqual({ collection: "cool" });
  });

  it("rejects mode drift during async collection lookup before cloning and removes owned preparations", async () => {
    const h = fixture(), text = h.leaf("TEXT", { resolvedVariableModes: { collection: "cool" } });
    const poster = h.frame("FRAME", text);
    h.host.variables = { getVariableCollectionByIdAsync: async () => {
      text.resolvedVariableModes.collection = "warm"; return { id: "collection" };
    } };
    await expect(captureArtworkVectorGeometry(poster, h.host, () => {})).rejects.toThrow("source changed");
    expect(text.clone).not.toHaveBeenCalled(); expect(text.resolvedVariableModes.collection).toBe("warm");
    expect(h.children.filter((node: any) => !node.removed)).toEqual([]);
  });
  it("keeps Frame border above its full-bleed children, including nested containers", () => {
    const h = fixture(); const child = h.leaf("RECTANGLE");
    const nested = h.frame("FRAME", child); nested.strokes = [stroke];
    const root = h.frame("FRAME", nested); root.strokes = [stroke];
    expect(planArtworkVectorLayers(root)!.map(l => [l.kind, l.node.id]))
      .toEqual([["background", root.id], ["background", nested.id], ["shape", child.id], ["border", nested.id], ["border", root.id]]);
  });
  it("uses unclipped logical bounds rather than Figma's already-cropped render bounds", () => {
    const h = fixture();
    const child = h.leaf("RECTANGLE", {
      absoluteBoundingBox: { x: 400, y: 20, width: 100, height: 50 },
      absoluteRenderBounds: { x: 400, y: 20, width: 40, height: 50 },
    });
    const poster = h.frame("FRAME", child); poster.clipsContent = true;
    expect(planArtworkVectorLayers(poster)!.at(-1)!.clips).toEqual([poster]);
  });
  it("classifies a poster frame into paint-order layers with its background first", () => {
    const h = fixture();
    const poster = h.frame("FRAME", h.leaf("RECTANGLE"), h.leaf("ELLIPSE"), h.leaf("TEXT"));
    const layers = planArtworkVectorLayers(poster);
    expect(layers?.map((layer) => [layer.kind, layer.node.type])).toEqual([
      ["background", "FRAME"], ["shape", "RECTANGLE"], ["shape", "ELLIPSE"], ["clone", "TEXT"],
    ]);
    expect(canCapturePlanLayersOnly(h, poster)).toBe(true);
  });

  it("keeps unsupported content on the HD route instead of silently dropping it", () => {
    const h = fixture();
    expect(planArtworkVectorLayers(h.frame("FRAME", h.leaf("RECTANGLE", { fills: [{ type: "GRADIENT_LINEAR" }] })))).toBeUndefined();
    expect(planArtworkVectorLayers(h.frame("FRAME", h.leaf("RECTANGLE", { effects: [{ type: "DROP_SHADOW", visible: true }] })))).toBeUndefined();
    expect(planArtworkVectorLayers(h.frame("FRAME", h.leaf("RECTANGLE", { isMask: true })))).toBeUndefined();
    expect(planArtworkVectorLayers(h.frame("FRAME", { type: "SECTION", visible: true } as any))).toBeUndefined();
    const blended = h.leaf("RECTANGLE"); blended.opacity = .5;
    expect(planArtworkVectorLayers(h.frame("FRAME", blended))).toBeDefined();
    const semiGroup = h.frame("GROUP", h.leaf("RECTANGLE")); semiGroup.opacity = .5;
    expect(planArtworkVectorLayers(semiGroup)).toBeUndefined();
    const multiplyGroup = h.frame("GROUP", h.leaf("RECTANGLE")); multiplyGroup.blendMode = "MULTIPLY";
    expect(planArtworkVectorLayers(multiplyGroup)).toBeUndefined();
    const multiplied = h.leaf("RECTANGLE", { blendMode: "MULTIPLY" });
    const isolated = h.frame("FRAME", multiplied);
    expect(planArtworkVectorLayers(isolated)).toBeUndefined();
    isolated.blendMode = "PASS_THROUGH";
    expect(planArtworkVectorLayers(isolated)).toBeDefined();
    expect(planArtworkVectorLayers(h.frame("FRAME", h.leaf("TEXT", { characters: "x".repeat(8193) })))).toBeUndefined();
    expect(planArtworkVectorLayers(h.frame("FRAME",
      h.leaf("RECTANGLE", { strokes: [stroke], strokeWeight: Symbol("mixed") })))).toBeUndefined();
    const tooMany = h.frame("FRAME", ...Array.from({ length: 64 }, () => h.leaf("RECTANGLE")));
    expect(planArtworkVectorLayers(tooMany)).toBeUndefined();
  });

  it("plans native cropping only for overflow, preserving the clipping Frame", () => {
    const h = fixture();
    const inside = h.leaf("RECTANGLE");
    const poster = h.frame("FRAME", inside);
    poster.clipsContent = true;
    expect(planArtworkVectorLayers(poster)).toBeDefined();
    const outside = h.leaf("RECTANGLE");
    outside.absoluteBoundingBox = { x: 200, y: 500, width: 400, height: 300 };
    const clipped = h.frame("FRAME", outside); clipped.clipsContent = true;
    expect(planArtworkVectorLayers(clipped)!.at(-1)!.clips).toEqual([clipped]);
    expect(h.host.flatten).not.toHaveBeenCalled();
  });

  it("requires every component font to load before offering the vector route", async () => {
    const h = fixture();
    const poster = h.frame("FRAME", h.leaf("TEXT"));
    expect(await canCaptureArtworkVectorSource(poster, h.host)).toBe(true);
    expect(h.host.loadFontAsync).toHaveBeenCalledWith({ family: "Inter", style: "Regular" });
    const failing = { ...h.host, loadFontAsync: vi.fn(async () => { throw Error("font missing"); }) };
    expect(await canCaptureArtworkVectorSource(poster, failing)).toBe(false);
  });

  it("accepts translated clipped artwork instead of treating document coordinates as local", () => {
    const h = fixture();
    const child = h.leaf("RECTANGLE", {
      absoluteTransform: [[1, 0, 4010], [0, 1, 3020]],
      absoluteBoundingBox: { x: 4010, y: 3020, width: 100, height: 50 },
    });
    const poster = h.frame("FRAME", child);
    poster.clipsContent = true;
    poster.absoluteTransform = [[1, 0, 4000], [0, 1, 3000]];
    poster.absoluteBoundingBox = { x: 4000, y: 3000, width: 440, height: 620 };
    expect(planArtworkVectorLayers(poster)).toBeDefined();
    child.absoluteTransform = [[1, 0, 4430], [0, 1, 3020]];
    child.absoluteBoundingBox.x = 4430;
    expect(planArtworkVectorLayers(poster)!.at(-1)!.clips).toEqual([poster]);
  });
});

describe("native crop and border continuation", () => {
  function croppedFixture() {
    const h = fixture();
    const rect = h.leaf("RECTANGLE", { opacity: .5, absoluteBoundingBox: { x: -20, y: 20, width: 180, height: 50 } });
    const poster = h.frame("FRAME", rect); poster.fills = []; poster.clipsContent = true;
    poster.topLeftRadius = 20; poster.topRightRadius = 10; poster.bottomLeftRadius = 4; poster.bottomRightRadius = 8;
    const intersect = vi.fn((operands: any[]) => {
      const b = h.leaf("BOOLEAN_OPERATION", { fillGeometry: [{ windingRule: "NONZERO", data: "cropped" }] });
      h.children.push(b);
      return b;
    });
    h.host.intersect = intersect;
    return { ...h, poster, rect, intersect };
  }
  it("retains every ancestor crop, including instance clipping, without flattening the component as a unit", () => {
    const h = fixture();
    const child = h.leaf("RECTANGLE", { absoluteBoundingBox: { x: -30, y: 0, width: 600, height: 700 } });
    const nested = h.frame("INSTANCE", child); nested.clipsContent = true;
    const root = h.frame("FRAME", nested); root.clipsContent = true;
    const layers = planArtworkVectorLayers(root)!;
    expect(layers.map(l => l.kind)).toEqual(["background", "background", "shape"]);
    expect(layers.at(-1)!.clips).toEqual([root, nested]);
    expect(nested.clone).not.toHaveBeenCalled();
  });
  it("keeps colors, native crop corners and single layer opacity across region intersections", async () => {
    const h = croppedFixture();
    const before = artworkVectorFingerprint(h.poster);
    const captured = await captureArtworkVectorGeometry(h.poster, h.host, () => {});
    expect(captured).toHaveLength(1); expect(captured![0]!.opacity).toBe(.5);
    expect(captured![0]!.vectorNetwork.regions!.every(r => JSON.stringify(r.fills) === JSON.stringify([fill]))).toBe(true);
    const operands = h.intersect.mock.calls[0]![0];
    const nativeMask=h.host.createRectangle.mock.results.at(-1)!.value;
    expect(nativeMask).toMatchObject({ topLeftRadius: 20, topRightRadius: 10, bottomLeftRadius: 4, bottomRightRadius: 8, strokes: [] });
    expect(h.host.flatten.mock.calls.some((call:any[])=>call[0][0]===nativeMask)).toBe(true);
    expect(operands[1].type).toBe("VECTOR");
    expect(operands[0].setVectorNetworkAsync).toHaveBeenCalled();
    expect(artworkVectorFingerprint(h.poster)).toBe(before);
    expect(h.children.filter(n => !n.removed)).toEqual([]);
  });
  it("omits genuinely empty crops without trying to flatten an empty Boolean", async () => {
    const h = croppedFixture();
    h.intersect.mockImplementation(() => {
      const node = h.leaf("BOOLEAN_OPERATION", { fillGeometry: [] }); h.children.push(node); return node;
    });
    expect(await captureArtworkVectorGeometry(h.poster, h.host, () => {})).toBeUndefined();
    expect(h.host.flatten.mock.calls.flatMap((call: any[]) => call[0]).some((node: any) => node.type === "BOOLEAN_OPERATION")).toBe(false);
    expect(h.children.filter(n => !n.removed)).toEqual([]);
  });
  it("retains the host's region normalization shift and compact hole loops during cropping", async () => {
    const h = croppedFixture();
    const flatten = h.host.flatten;
    h.host.flatten.mockImplementationOnce((nodes: any[]) => {
      const n = flatten(nodes);
      n.vectorNetwork = {
        vertices: [...network.vertices, ...network.vertices.map(v => ({ x: v.x + 20, y: v.y + 4 }))],
        segments: [...network.segments, ...network.segments.map(s => ({ start: s.start + 4, end: s.end + 4 }))],
        regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2, 3], [4, 5, 6, 7]], fills: [fill] }],
      };
      return n;
    });
    const createVector = h.host.createVector;
    h.host.createVector = vi.fn(() => {
      const n = createVector();
      n.setVectorNetworkAsync.mockImplementationOnce(async (net: VectorNetwork) => {
        expect(n.relativeTransform).toEqual([[1, 0, 10], [0, 1, 20]]);
        expect(net.regions![0]!.loops).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
        n.relativeTransform = [[1, 0, 30], [0, 1, 24]]; n.vectorNetwork = net;
      });
      return n;
    });
    expect(await captureArtworkVectorGeometry(h.poster, h.host, () => {})).toBeDefined();
    expect(h.intersect.mock.calls[0]![0][0].relativeTransform).toEqual([[1, 0, 30], [0, 1, 24]]);
  });
  it.each(["failure", "source drift"])("cleans every operand on crop %s", async condition => {
    const h = croppedFixture();
    if (condition === "failure") h.intersect.mockImplementationOnce(() => { throw Error("crop failed"); });
    else h.host.createVector.mockImplementationOnce(() => {
      const temp = h.leaf("VECTOR"); h.children.push(temp);
      temp.setVectorNetworkAsync.mockImplementationOnce(async () => { h.poster.topLeftRadius = 30; }); return temp;
    });
    await expect(captureArtworkVectorGeometry(h.poster, h.host, () => {})).rejects.toThrow(condition === "failure" ? "crop failed" : "source changed");
    expect(h.children.filter(n => !n.removed)).toEqual([]);
    if (condition === "source drift") expect(h.intersect).not.toHaveBeenCalled();
  });
  it("bounds actual necessary native Boolean work and cleans a refused complete crop", async () => {
    const h = croppedFixture();
    const originalFlatten = h.host.flatten;
    h.host.flatten.mockImplementationOnce((nodes: any[]) => {
      const n = originalFlatten(nodes); n.vectorNetwork.regions = Array.from({length: 65}, () => structuredClone(n.vectorNetwork.regions[0])); return n;
    });
    await expect(captureArtworkVectorGeometry(h.poster, h.host, () => {})).rejects.toThrow(/crop work exceeds/);
    expect(h.intersect.mock.calls.length).toBe(64);
    expect(h.children.filter(n=>!n.removed)).toEqual([]);
  });
  it("copies and fingerprints per-side native Frame border weights", async () => {
    const h = fixture(); const poster = h.frame(); poster.strokes = [stroke];
    Object.assign(poster, { strokeWeight: Symbol("mixed"), strokeTopWeight: 2, strokeRightWeight: 5, strokeBottomWeight: 9, strokeLeftWeight: 12 });
    const make = h.host.createRectangle;
    h.host.createRectangle = vi.fn(() => Object.assign(make(), { strokeTopWeight: 0, strokeRightWeight: 0, strokeBottomWeight: 0, strokeLeftWeight: 0 }));
    const before = artworkVectorFingerprint(poster);
    expect(await captureArtworkVectorGeometry(poster, h.host, () => {})).toBeDefined();
    expect(h.host.createRectangle.mock.results.at(-1)!.value).toMatchObject({ strokeTopWeight: 2, strokeRightWeight: 5, strokeBottomWeight: 9, strokeLeftWeight: 12 });
    poster.strokeLeftWeight = 14; expect(artworkVectorFingerprint(poster)).not.toBe(before);
  });
});

function canCapturePlanLayersOnly(h: ReturnType<typeof fixture>, source: any) {
  return planArtworkVectorLayers(source) !== undefined;
}

describe("whole-artwork vector capture", () => {
  it("preserves an unstroked native Vector clone without writing a new network",async()=>{
    const h=fixture(),source=h.vector("Unstroked artwork"),poster=h.frame("FRAME",source);poster.fills=[];
    const captured=await captureArtworkVectorGeometry(poster,h.host,()=>{});
    const clone=source.clone.mock.results[0]!.value;
    expect(clone.strokes).toEqual([]);expect(clone.setVectorNetworkAsync).not.toHaveBeenCalled();
    expect(h.host.createVector).not.toHaveBeenCalled();expect(captured![0]!.nativeStrokeOutlined).toBeUndefined();
    expect(h.children).toEqual([]);
  });
  it("restores the outline above freshly flattened fills before the native merge", async () => {
    const h = fixture(); const rect = h.leaf("RECTANGLE", { strokes: [stroke] });
    const poster = h.frame("FRAME", rect); poster.fills = [];
    const flatten = h.host.flatten;
    h.host.flatten = vi.fn((nodes: any[]) => {
      if (nodes.length === 2) {
        expect(h.page.appendChild).toHaveBeenLastCalledWith(nodes[1]);
        expect(h.children.at(-1)).toBe(nodes[1]);
      }
      return flatten(nodes);
    });
    expect(await captureArtworkVectorGeometry(poster, h.host, () => {})).toBeDefined();
    expect(h.children).toEqual([]);
  });
  it("keeps stroke overflow when native flatten merges a same-painted fill and outside stroke", async () => {
    const h = fixture(); const rect = h.leaf("RECTANGLE", { fills: [stroke], strokes: [stroke], strokeAlign: "OUTSIDE" });
    const poster = h.frame("FRAME", rect); poster.fills = [];
    const captured = await captureArtworkVectorGeometry(poster, h.host, () => {});
    expect(captured![0]!.nativeStrokeOutlineRegions!.every(Boolean)).toBe(true);
  });
  it("keeps mixed region paints and vertex semantics on the native clone until flatten",async()=>{
    const h=fixture(),source=h.vector("multi-color");
    source.vectorNetwork.regions.push({...source.vectorNetwork.regions[0],fills:[otherFill]});
    source.clone.mockImplementation(()=>{const clone=h.vector("clone");clone.vectorNetwork=structuredClone(source.vectorNetwork);return clone;});
    const poster=h.frame("FRAME",source);poster.fills=[];
    const geometry=await captureArtworkVectorGeometry(poster,h.host,()=>{});
    expect(source.clone.mock.results[0]!.value.setVectorNetworkAsync).not.toHaveBeenCalled();
    expect(geometry![0]!.vectorNetwork.regions!.map(r=>r.fills)).toEqual([[fill],[otherFill]]);
    expect(h.children).toEqual([]);
  });
  it("invalidates cached captures when native Frame corners or paragraph layout change", () => {
    const h = fixture();
    const text = h.leaf("TEXT", { paragraphSpacing: 0 });
    const poster = h.frame("FRAME", text);
    const before = artworkVectorFingerprint(poster);
    poster.topLeftRadius = 12;
    const rounded = artworkVectorFingerprint(poster);
    expect(rounded).not.toBe(before);
    text.paragraphSpacing = 20;
    expect(artworkVectorFingerprint(poster)).not.toBe(rounded);
  });
  it("keeps page-space placement and native corners for background and reparented text", async () => {
    const h = fixture();
    const text = h.leaf("TEXT", { absoluteTransform: [[1, 0, 4030], [0, 1, 3060]] });
    const poster = h.frame("FRAME", text);
    poster.absoluteTransform = [[1, 0, 4000], [0, 1, 3000]];
    poster.topLeftRadius = 12; poster.topRightRadius = 8;
    poster.bottomLeftRadius = 6; poster.bottomRightRadius = 4; poster.cornerSmoothing = .3;
    const captureInputs: any[] = [];
    const flatten = h.host.flatten;
    h.host.flatten = vi.fn((nodes: any[]) => {
      captureInputs.push(...nodes.map(n => ({ type: n.type, transform: structuredClone(n.absoluteTransform),
        corners: [n.topLeftRadius, n.topRightRadius, n.bottomLeftRadius, n.bottomRightRadius, n.cornerSmoothing] })));
      return flatten(nodes);
    });
    await captureArtworkVectorGeometry(poster, h.host, () => {});
    expect(captureInputs[0].transform).toEqual(poster.absoluteTransform);
    expect(captureInputs[0].corners).toEqual([12, 8, 6, 4, .3]);
    expect(captureInputs[1].transform).toEqual(text.absoluteTransform);
  });

  it("removes the native clone and copied ancestry when native outlining fails",async()=>{
    const h=fixture(),source=h.vector("stroked");source.strokes=[stroke];
    source.clone.mockImplementation(()=>{const temp=h.vector("clone");temp.outlineStroke.mockImplementation(()=>{throw Error("outline rejected");});return temp;});
    const poster=h.frame("FRAME",source);poster.fills=[];
    await expect(captureArtworkVectorGeometry(poster,h.host,()=>{})).rejects.toThrow("outline rejected");
    expect(h.children).toEqual([]);expect(source.removed).toBe(false);
  });
  it("captures every layer in paint order through page-level temps and clones, then removes them", async () => {
    const h = fixture();
    const text = h.leaf("TEXT");
    const stroked = h.leaf("RECTANGLE"); stroked.strokes = [stroke]; stroked.strokeAlign = "CENTER";
    const poster = h.frame("FRAME", stroked, text);
    const observed: any[] = [];
    const geometries = await captureArtworkVectorGeometry(poster, h.host, node => observed.push(node));
    expect(geometries).toHaveLength(3);
    // Background rect + stroked rect resolved through temps; text through a clone.
    expect(h.host.createRectangle).toHaveBeenCalledTimes(2);
    expect(text.clone).toHaveBeenCalledOnce();
    expect(h.host.flatten).toHaveBeenCalled();
    // Stroked layer merged its fill and the stroke outline, and
    // only the outline region is exempt from the placement-fit check.
    expect(geometries![1]!.nativeStrokeOutlineRegions).toEqual([false, true]);
    expect(geometries![1]!.nativeStrokeOutlined).toBe(true);
    expect(geometries![1]!.vectorNetwork.regions?.map((region: any) => region.fills)).toEqual([[fill], [stroke]]);
    // Text layers freeze glyph outlines and say so.
    expect(geometries![2]!.nativeTextOutlined).toBe(true);
    // Every temporary node is gone and the original artwork is untouched.
    expect(h.children.filter((node: any) => !node.removed)).toEqual([]);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((node) => node.removed)).toBe(true);
    expect(text.removed).toBe(false);
    expect(poster.children).toHaveLength(2);
  });

  it("changes fingerprint when any layer's text, paint or structure changes", () => {
    const h = fixture();
    const text = h.leaf("TEXT");
    const poster = h.frame("FRAME", h.leaf("RECTANGLE"), text);
    const before = artworkVectorFingerprint(poster);
    expect(artworkVectorFingerprint(poster)).toBe(before);
    text.characters = "Changed";
    expect(artworkVectorFingerprint(poster)).not.toBe(before);
    const second = artworkVectorFingerprint(poster);
    poster.children[0]!.fills = [otherFill];
    expect(artworkVectorFingerprint(poster)).not.toBe(second);
  });

  it("aborts and cleans up when the artwork drifts during an async flatten", async () => {
    const h = fixture();
    const rect = h.leaf("RECTANGLE");
    const poster = h.frame("FRAME", rect, h.leaf("ELLIPSE"));
    const realFlatten = h.host.flatten.getMockImplementation()!;
    h.host.flatten.mockImplementation((nodes: any[]) => {
      rect.fills = [otherFill];
      return realFlatten(nodes);
    });
    await expect(captureArtworkVectorGeometry(poster, h.host, () => {}))
      .rejects.toThrow("Artwork vector source changed");
    expect(h.children.filter((node: any) => !node.removed)).toEqual([]);
    expect(poster.children).toHaveLength(2);
  });

  it("witnesses an equal-bounds ancestor rotation despite unchanged local matrices", async () => {
    const h = fixture();
    const rect = h.leaf("RECTANGLE");
    const source = h.frame("FRAME", rect);
    const ancestor = h.frame("FRAME", source);
    ancestor.relativeTransform = [[1, 0, 0], [0, 1, 0]];
    const bounds = structuredClone(source.absoluteBoundingBox);
    const locals = [source.relativeTransform, rect.relativeTransform].map(matrix => structuredClone(matrix));
    const originalBasis = structuredClone(source.absoluteTransform);
    const before = artworkVectorFingerprint(source);
    const flatten = h.host.flatten.getMockImplementation()!;
    h.host.flatten.mockImplementationOnce((nodes: any[]) => {
      ancestor.relativeTransform = [[-1, 0, 100], [0, -1, 100]];
      // The symmetric real-host discriminator leaves this AABB unchanged.
      source.absoluteBoundingBox = structuredClone(bounds);
      return flatten(nodes);
    });
    await expect(captureArtworkVectorGeometry(source, h.host, () => {}))
      .rejects.toThrow("Artwork vector source changed");
    expect(source.absoluteBoundingBox).toEqual(bounds);
    expect([source.relativeTransform, rect.relativeTransform]).toEqual(locals);
    expect(source.absoluteTransform).not.toEqual(originalBasis);
    expect(artworkVectorFingerprint(source)).not.toBe(before);
    expect(h.children.filter((node: any) => !node.removed)).toEqual([]);
    expect(source.children).toEqual([rect]);
  });

  it("declines the whole capture when a stroke cannot be outlined natively", async () => {
    const h = fixture();
    const broken = h.leaf("RECTANGLE"); broken.strokes = [stroke];
    const realRectangle = h.host.createRectangle;
    h.host.createRectangle = vi.fn(() => {
      const temp = realRectangle();
      temp.outlineStroke = vi.fn(() => null);
      return temp;
    });
    const poster = h.frame("FRAME", broken);
    expect(await captureArtworkVectorGeometry(poster, h.host, () => {})).toBeUndefined();
    expect(h.children.filter((node: any) => !node.removed)).toEqual([]);
  });
});


describe("conservative complete clip planning",()=>{
  it("inherits all external clips in paint order, without treating ancestor paints as source parts",()=>{
    const h=fixture(),text=h.leaf("TEXT"),source=h.frame("FRAME",text),inner=h.frame("FRAME",source),outer=h.frame("FRAME",inner);
    outer.clipsContent=true;inner.clipsContent=true;source.clipsContent=true;
    const layers=planArtworkVectorLayers(source)!;
    expect(layers.map(layer=>layer.clips)).toEqual([[outer,inner],[outer,inner,source]]);
    expect(layers.map(layer=>layer.node)).toEqual([source,text]);
  });
  it.each(["radius","clipMode"])("invalidates unchanged-bounds external %s during capture and keeps the source intact",async(change)=>{
    const h=fixture(),text=h.leaf("TEXT"),source=h.frame("FRAME",text),ancestor=h.frame("FRAME",source);source.fills=[];
    ancestor.clipsContent=change==="radius";ancestor.topLeftRadius=0;
    const before=artworkVectorFingerprint(source),basis=structuredClone(source.absoluteTransform),bounds=structuredClone(source.absoluteBoundingBox);
    const flatten=h.host.flatten.getMockImplementation()!;
    h.host.flatten.mockImplementationOnce((nodes:any[])=>{if(change==="radius")ancestor.topLeftRadius=30;else ancestor.clipsContent=true;return flatten(nodes);});
    await expect(captureArtworkVectorGeometry(source,h.host,()=>{})).rejects.toThrow("source changed");
    expect(source.absoluteTransform).toEqual(basis);expect(source.absoluteBoundingBox).toEqual(bounds);
    expect(artworkVectorFingerprint(source)).not.toBe(before);expect(source.children).toEqual([text]);expect(h.children).toEqual([]);
  });
  it.each([80,100000])("retains even a small true crossing on a %s-high clip until native crop",async(height)=>{
    const h=fixture(),overhang=height===80?.0000801086:.08;
    const source=h.leaf("RECTANGLE",{width:10+overhang,height:20,relativeTransform:[[1,0,110],[0,1,10]],absoluteBoundingBox:{x:110,y:10,width:10+overhang,height:20}});
    const root=h.frame("FRAME",source);root.width=120;root.height=height;root.fills=[];root.clipsContent=true;
    expect(planArtworkVectorLayers(root)![0]!.clips).toEqual([root]);
    const flatten=h.host.flatten.getMockImplementation()!;
    h.host.flatten.mockImplementationOnce((nodes:any[])=>{const out=flatten(nodes);out.absoluteBoundingBox={...source.absoluteBoundingBox};return out;});
    h.host.intersect=vi.fn(()=>h.leaf("BOOLEAN_OPERATION",{fillGeometry:[{data:"native crop"}]}));
    const before=artworkVectorFingerprint(root);
    expect(await captureArtworkVectorGeometry(root,h.host,()=>{})).toHaveLength(1);
    expect(h.host.intersect).toHaveBeenCalledOnce();expect(artworkVectorFingerprint(root)).toBe(before);
    expect(h.children).toEqual([]);
  });
  it("discharges an original text clip only after its fresh native outline is strictly interior",async()=>{
    const h=fixture(),source=h.leaf("TEXT"),root=h.frame("FRAME",source);root.fills=[];root.clipsContent=true;
    expect(planArtworkVectorLayers(root)![0]!.clips).toEqual([root]);
    h.host.intersect=vi.fn(()=>{throw Error("interior native bounds need no Boolean");});
    const geometry=await captureArtworkVectorGeometry(root,h.host,()=>{});
    expect(geometry).toHaveLength(1);expect(geometry![0]!.nativeTextOutlined).toBe(true);
    expect(h.host.intersect).not.toHaveBeenCalled();expect(h.children).toEqual([]);
  });
});
