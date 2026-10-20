import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMaterialTrial,
  type MaterialTrialRequest,
} from "./material-trial";
import { BUILTIN_APPEARANCE_RECIPES } from "./appearance-wire";

const recipe = BUILTIN_APPEARANCE_RECIPES[1]!;
function fixture() {
  let id = 0;
  const page: any = {
    id: "page",
    type: "PAGE",
    backgrounds: [{ type: "SOLID", color: { r: 0.2, g: 0.3, b: 0.4 } }],
    children: [],
  };
  const captures: any[] = [],
    exports: {
      resolve: (bytes: Uint8Array) => void;
      reject: (error: Error) => void;
    }[] = [];
  const make = (
    name: string,
    type = "RECTANGLE",
    box = { x: 0, y: 0, width: 100, height: 80 },
  ): any => {
    const data = new Map<string, string>();
    const n: any = {
      id: `n-${++id}`,
      name,
      type,
      width: box.width,
      height: box.height,
      visible: true,
      removed: false,
      effects: [],
      fills: [],
      resolvedVariableModes: {},
      setExplicitVariableModeForCollection:vi.fn(),
      parent: page,
      absoluteBoundingBox: { ...box },
      absoluteRenderBounds: { ...box },
      absoluteTransform: [
        [1, 0, box.x],
        [0, 1, box.y],
      ],
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      exportAsync: vi.fn(async () => new Uint8Array([8])),
      getPluginData: (key: string) => data.get(key) ?? "",
      setPluginData: (key: string, value: string) => data.set(key, value),
      getSharedPluginData: (_ns: string, key: string) => data.get(key) ?? "",
      setSharedPluginData: (_ns: string, key: string, value: string) =>
        data.set(key, value),
      remove() {
        this.removed = true;
        this.parent.children = this.parent.children.filter(
          (child: any) => child !== this,
        );
      },
      clone() {
        const copy = make(name, type, box);
        copy.effects = structuredClone(this.effects);
        copy.fills = structuredClone(this.fills);
        if (this.children)
          this.children.forEach((child: any) =>
            copy.appendChild(child.clone()),
          );
        page.children.push(copy);
        return copy;
      },
    };
    if (type === "FRAME") {
      n.children = [];
      n.resize = (w: number, h: number) => {
        n.width = w;
        n.height = h;
      };
      n.appendChild = (child: any) => {
        child.parent.children = child.parent.children.filter(
          (value: any) => value !== child,
        );
        n.children.push(child);
        child.parent = n;
      };
      n.exportAsync = vi.fn(
        () =>
          new Promise<Uint8Array>((resolve, reject) =>
            exports.push({ resolve, reject }),
          ),
      );
    }
    return n;
  };
  const frame = make("scene", "FRAME"),
    surface = make("surface"),
    foreground = make("foreground");
  page.children.push(frame);
  frame.appendChild(surface);
  frame.appendChild(foreground);
  const tracked = new Set<string>(),
    observed = new Set<string>(),
    present = vi.fn(
      (
        _request: MaterialTrialRequest,
        _frames: import("./scene-draft").SceneDraftPayload[],
      ) => true,
    ),
    post = vi.fn(),
    clear = vi.fn();
  let selected: readonly SceneNode[] | undefined = [surface];
  vi.stubGlobal("figma", {
    currentPage: page,
    viewport: { zoom: 2.5 },
    createImage: () => ({ hash: "current-scene-pixels", getSizeAsync: async () => ({ width: 100, height: 80 }), getBytesAsync: async () => new Uint8Array([8]) }),
    createFrame: () => {
      const capture = make("capture", "FRAME");
      page.children.push(capture);
      captures.push(capture);
      return capture;
    },
  });
  const trial = createMaterialTrial({
    current: () => selected,
    sessionId: () => "material-session-1",
    track: (id) => {
      tracked.add(id);
    },
    observe: (id) => {
      observed.add(id);
    },
    clear,
    present,
    post,
  });
  const request = (requestId: number): MaterialTrialRequest => ({
    type: "request-material-trial",
    generation: 1,
    requestId,
    edit: { family: "glass", recipe, material: recipe.material },
  });
  return {
    page,
    make,
    frame,
    surface,
    foreground,
    captures,
    exports,
    tracked,
    observed,
    present,
    post,
    clear,
    trial,
    request,
    setSelection: (nodes: readonly SceneNode[] | undefined) => {
      selected = nodes;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("native material trial lifecycle", () => {
  it('materializes inherited root modes only on the copied scene before export',async()=>{
    const f=fixture(),collection={id:'palette'};
    (f.frame as any).resolvedVariableModes={palette:'cool'};
    (figma as any).variables={getVariableCollectionByIdAsync:vi.fn(async()=>collection)};
    f.trial.request(f.request(1));
    await vi.waitFor(()=>expect(f.exports).toHaveLength(1));
    expect(f.captures[0].children[0].setExplicitVariableModeForCollection).toHaveBeenCalledWith(collection,'cool');
    expect(f.frame.setExplicitVariableModeForCollection).not.toHaveBeenCalled();
    f.exports[0]!.resolve(new Uint8Array([1]));
    await vi.waitFor(()=>expect(f.present).toHaveBeenCalledOnce());
  });
  it('cancels a pending inherited-mode read without exporting or editing a retired copy',async()=>{
    const f=fixture();let resolve!:(value:unknown)=>void;
    (f.frame as any).resolvedVariableModes={palette:'cool'};
    (figma as any).variables={getVariableCollectionByIdAsync:()=>new Promise(done=>{resolve=done;})};
    f.trial.request(f.request(1));
    const copy=f.captures[0].children[0];
    f.trial.cancel();resolve({id:'palette'});
    await new Promise(done=>setTimeout(done,0));
    expect(f.captures[0].removed).toBe(true);
    expect(copy.setExplicitVariableModeForCollection).not.toHaveBeenCalled();
    expect(f.exports).toHaveLength(0);expect(f.present).not.toHaveBeenCalled();expect(f.post).not.toHaveBeenCalled();
  });
  it("replaces only the copied scene result, preserving native foreground and published pixels", async () => {
    const f = fixture(); f.surface.fills = [{ type: "IMAGE", imageHash: "published-pixels", scaleMode: "FILL" }];
    const request: MaterialTrialRequest = { type: "request-scene-context", generation: 1, requestId: 4, bytes: new Uint8Array([4]), showCanvas: true };
    f.trial.request(request);
    expect(f.captures[0].children[0].children[0].fills).toEqual([{ type: "IMAGE", imageHash: "current-scene-pixels", scaleMode: "FILL" }]);
    expect(f.captures[0].children[0].children[1].name).toBe("foreground");
    expect(f.surface.fills[0].imageHash).toBe("published-pixels");
    await vi.waitFor(() => expect(f.exports).toHaveLength(1));
    f.exports[0]!.resolve(new Uint8Array([4]));
    await vi.waitFor(() => expect(f.post).toHaveBeenCalledWith(request, true, expect.any(Array), true));
    expect(f.page.children).toEqual([f.frame]);
  });

  it("keeps an unedited or transparent scene preview in the window without alpha overlay", async () => {
    for (const transparent of [false, true]) {
      const f = fixture(); if (transparent) f.page.backgrounds[0].opacity = 0;
      const request: MaterialTrialRequest = { type: "request-scene-context", generation: 1, requestId: 5, bytes: new Uint8Array([5]), showCanvas: transparent };
      f.trial.request(request); await vi.waitFor(() => expect(f.exports).toHaveLength(1)); f.exports[0]!.resolve(new Uint8Array([5]));
      await vi.waitFor(() => expect(f.post).toHaveBeenCalledWith(request, true, expect.any(Array), false));
      expect(f.present).not.toHaveBeenCalled(); expect(f.page.children).toEqual([f.frame]);
    }
  });
  it("keeps transparent-page trials in the window rather than doubling alpha on the original", async () => {
    const f = fixture();
    f.page.backgrounds[0].opacity = 0;
    f.trial.request(f.request(1));
    f.exports[0]!.resolve(new Uint8Array([1]));
    await vi.waitFor(() =>
      expect(f.post).toHaveBeenCalledWith(
        f.request(1),
        true,
        expect.any(Array),
        false,
      ),
    );
    expect(f.present).not.toHaveBeenCalled();
    expect(f.surface.effects).toEqual([]);
    expect(f.page.children).toEqual([f.frame]);
  });
  it("preserves section backgrounds and native child order through a capture-frame proxy", async () => {
    const f = fixture();
    const section = f.make("section", "FRAME");
    Object.assign(section, {
      type: "SECTION",
      width: 100,
      height: 80,
      strokeWeight: 1,
      strokeAlign: "INSIDE",
      dashPattern: [],
      strokes: [],
      topLeftRadius: 4,
      topRightRadius: 4,
      bottomLeftRadius: 4,
      bottomRightRadius: 4,
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    });
    f.page.children.push(section);
    section.appendChild(f.frame);
    f.trial.request(f.request(1));
    const proxy = f.captures[0].children[0];
    expect(proxy.fills).toEqual(section.fills);
    expect(proxy.clipsContent).toBe(false);
    expect(proxy.children[0].children[0].effects[0].type).toBe("GLASS");
    f.exports[0]!.resolve(new Uint8Array([1]));
    await vi.waitFor(() => expect(f.present).toHaveBeenCalledOnce());
    expect(f.page.children).toEqual([section]);
    expect(f.surface.effects).toEqual([]);
  });
  it("captures the native surrounding scene, tracks every clone and leaves original effects unchanged", async () => {
    const f = fixture();
    f.trial.request(f.request(1));
    expect(f.captures).toHaveLength(1);
    const capture = f.captures[0];
    expect(capture.fills).toEqual(f.page.backgrounds);
    expect(capture.children[0].children[0].effects[0]).toMatchObject({
      type: "GLASS",
      radius: recipe.material.radius,
    });
    expect(capture.children[0].children[1].name).toBe("foreground");
    expect(f.surface.effects).toEqual([]);
    expect(f.tracked.size).toBe(4);
    expect(f.observed).toEqual(new Set(["page", f.frame.id]));
    f.exports[0]!.resolve(new Uint8Array([1]));
    await vi.waitFor(() => expect(f.present).toHaveBeenCalledOnce());
    expect(f.present.mock.calls[0]![1][0]).toMatchObject({
      placement: { x: 0, y: 0, width: 100, height: 80 },
      renderWidth: 500,
      renderHeight: 400,
    });
    expect(capture.removed).toBe(true);
    expect(f.page.children).toEqual([f.frame]);
  });
  it("renders applied artwork for the large viewing area without installing canvas feedback or editing a clone", async () => {
    const f = fixture();
    const request: MaterialTrialRequest = {
      type: "request-material-preview",
      generation: 1,
      requestId: 7,
    };
    f.trial.request(request);
    expect(f.captures[0].children[0].children[0].effects).toEqual([]);
    f.exports[0]!.resolve(new Uint8Array([7]));
    await vi.waitFor(() =>
      expect(f.post).toHaveBeenCalledWith(request, true, expect.any(Array)),
    );
    expect(f.present).not.toHaveBeenCalled();
    expect(f.surface.effects).toEqual([]);
    expect(f.page.children).toEqual([f.frame]);
  });
  it("drops a late cancelled export without showing it or changing the next workpiece", async () => {
    const f = fixture();
    f.trial.request(f.request(1));
    f.trial.cancel();
    f.setSelection(undefined);
    expect(f.captures[0].removed).toBe(true);
    f.exports[0]!.resolve(new Uint8Array([1]));
    await vi.waitFor(() =>
      expect(f.captures[0].getPluginData("sceneDraftRetired")).toBe("1"),
    );
    expect(f.present).not.toHaveBeenCalled();
    expect(f.post).not.toHaveBeenCalled();
    expect(f.surface.effects).toEqual([]);
  });
  it("serializes exports and replaces queued requests with the most recent candidate", async () => {
    const f = fixture();
    f.trial.request(f.request(1));
    f.trial.request(f.request(2));
    f.trial.request(f.request(3));
    expect(f.exports).toHaveLength(1);
    f.exports[0]!.resolve(new Uint8Array([1]));
    await vi.waitFor(() => expect(f.exports).toHaveLength(2));
    expect(f.present).not.toHaveBeenCalled();
    f.exports[1]!.resolve(new Uint8Array([3]));
    await vi.waitFor(() => expect(f.post).toHaveBeenCalledOnce());
    expect(f.present.mock.calls[0]![0].requestId).toBe(3);
    expect(f.post).toHaveBeenCalledWith(
      f.request(3),
      true,
      expect.any(Array),
      true,
    );
    expect(f.page.children).toEqual([f.frame]);
  });
  it("presents all separate selected scenes together, and cleans every copy if a later export fails", async () => {
    const f = fixture(),
      other = f.make("second", "FRAME", {
        x: 300,
        y: 0,
        width: 100,
        height: 80,
      }),
      surface = f.make("second surface");
    f.page.children.push(other);
    other.appendChild(surface);
    f.setSelection([f.surface, surface]);
    f.trial.request(f.request(1));
    f.exports[0]!.resolve(new Uint8Array([1]));
    await vi.waitFor(() => expect(f.exports).toHaveLength(2));
    expect(f.present).not.toHaveBeenCalled();
    f.exports[1]!.reject(Error("native export rejected"));
    await vi.waitFor(() =>
      expect(f.post).toHaveBeenCalledWith(
        f.request(1),
        false,
        undefined,
        false,
      ),
    );
    expect(f.present).not.toHaveBeenCalled();
    expect(f.captures.every((n) => n.removed)).toBe(true);
    expect(f.page.children).toEqual([f.frame, other]);
  });
  it("merges overlapping selected contexts so combined effects render in one native scene", async () => {
    const f = fixture();
    f.setSelection([f.surface, f.foreground]);
    f.trial.request(f.request(1));
    expect(
      f.captures[0].children[0].children.every(
        (n: any) => n.effects[0]?.type === "GLASS",
      ),
    ).toBe(true);
    f.exports[0]!.resolve(new Uint8Array([1]));
    await vi.waitFor(() => expect(f.present).toHaveBeenCalledOnce());
    expect(f.present.mock.calls[0]![1]).toHaveLength(1);
    expect(f.surface.effects).toEqual([]);
    expect(f.foreground.effects).toEqual([]);
  });
});
