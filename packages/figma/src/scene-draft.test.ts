import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSceneDraft,
  forgetSceneDraftNodeId,
  isSceneDraftNode,
  isSceneDraftNodeId,
  sweepStaleSceneDrafts,
  updateSceneDraft,
} from "./scene-draft";

function rectangle(id: string) {
  const pluginData = new Map<string, string>();
  const node: any = {
    id,
    type: "RECTANGLE",
    name: "",
    locked: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fills: [] as unknown[],
    removed: false,
    resize(width: number, height: number) {
      this.width = width;
      this.height = height;
    },
    remove() {
      this.removed = true;
      this.parent.children = this.parent.children.filter((node: unknown) => node !== this);
    },
    setPluginData: vi.fn((key: string, value: string) => pluginData.set(key, value)),
    getPluginData: vi.fn((key: string) => pluginData.get(key) ?? ""),
  };
  return node;
}

function host() {
  const events: string[] = [];
  const page: any = {
    id: "page",
    type: "PAGE",
    selection: [] as ReturnType<typeof rectangle>[],
    children: [] as ReturnType<typeof rectangle>[],
    appendChild: vi.fn(function (this: { children: unknown[] }, node: unknown) {
      this.children.push(node);
    }),
  };
  const created: ReturnType<typeof rectangle>[] = [];
  const figma = {
    commitUndo: vi.fn(() => events.push("commit")),
    triggerUndo: vi.fn(() => events.push("undo")),
    createImage: vi.fn((bytes: Uint8Array) => ({ hash: `hash-${bytes[0]}` })),
    createRectangle: vi.fn(() => {
      events.push("create");
      const node = rectangle(`node-${created.length + 1}`);
      node.parent = page;
      created.push(node);
      // Match the real Figma API: createRectangle is parented under the
      // current page immediately.
      page.children.push(node);
      return node;
    }),
  };
  vi.stubGlobal("figma", figma);
  return { page, figma, created, events };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const payload = (bytes: number, placement: { x: number; y: number; width: number; height: number }) => ({
  generation: 1,
  bytes: new Uint8Array([bytes]),
  renderWidth: 100,
  renderHeight: 80,
  placement,
});

describe("scene draft node lifecycle", () => {
  it("maintains one locked, marked node reused across updates without undo commits", () => {
    const { page, figma, events } = host();
    updateSceneDraft(page, payload(1, { x: 5, y: 6, width: 50, height: 40 }), "Poster");
    const draft = page.children[0]!;
    expect(isSceneDraftNode(draft)).toBe(true);
    expect(draft.locked).toBe(true);
    expect(draft.name).toBe("Poster · Worldbend Working Preview");
    expect(draft).toMatchObject({ x: 5, y: 6, width: 50, height: 40 });
    expect(draft.fills).toEqual([{ type: "IMAGE", imageHash: "hash-1", scaleMode: "FILL" }]);
    // One pre-create boundary only: updates never produce per-frame history.
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
    expect(events.slice(0, 2)).toEqual(["commit", "create"]);

    updateSceneDraft(page, payload(2, { x: 7, y: 8, width: 60, height: 30 }), "Poster");
    expect(page.children).toHaveLength(1);
    expect(page.children[0]).toBe(draft);
    expect(draft).toMatchObject({ x: 7, y: 8, width: 60, height: 30 });
    expect(draft.fills).toEqual([{ type: "IMAGE", imageHash: "hash-2", scaleMode: "FILL" }]);
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
    expect(figma.createRectangle).toHaveBeenCalledTimes(1);
  });

  it("clear removes only marked drafts and never replays host history", () => {
    const { page, figma } = host();
    updateSceneDraft(page, payload(1, { x: 0, y: 0, width: 10, height: 10 }), "Poster");
    const selected = rectangle("selected");
    selected.parent = page;
    page.children.push(selected);
    page.selection = [selected];
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
    const id = page.children[0]!.id;
    clearSceneDraft(page);
    expect(page.children).toEqual([selected]);
    expect(isSceneDraftNodeId(id)).toBe(true);
    forgetSceneDraftNodeId(id);
    expect(isSceneDraftNodeId(id)).toBe(false);
    expect(figma.triggerUndo).not.toHaveBeenCalled();
    expect(page.selection).toEqual([selected]);
    expect(figma.commitUndo).toHaveBeenCalledTimes(2);
    // Clearing with no draft creates no additional host boundary.
    clearSceneDraft(page);
    expect(figma.commitUndo).toHaveBeenCalledTimes(2);
  });

  it("sweeps stale drafts from abnormal exits and never touches artwork", () => {
    const { page, figma } = host();
    const staleDraft = rectangle("stale-draft");
    staleDraft.parent = page;
    staleDraft.setPluginData("sceneDraft", "1");
    page.children.push(staleDraft);
    const artwork = rectangle("art");
    artwork.parent = page;
    page.children.push(artwork);
    sweepStaleSceneDrafts(page);
    expect(page.children).toEqual([artwork]);
    expect(artwork.removed).toBe(false);
    expect(figma.triggerUndo).not.toHaveBeenCalled();
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
    sweepStaleSceneDrafts(page);
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
  });

  it("does not let a late stale sweep remove this run's live preview", () => {
    const { page, figma } = host();
    updateSceneDraft(page, payload(1, { x: 0, y: 0, width: 10, height: 10 }), "Poster");
    const draft = page.children[0];

    sweepStaleSceneDrafts(page);

    expect(page.children).toEqual([draft]);
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
  });

  it("ignores empty payloads instead of writing a broken draft", () => {
    const { page, figma } = host();
    updateSceneDraft(page, { ...payload(0, { x: 0, y: 0, width: 10, height: 10 }), bytes: new Uint8Array() }, "Poster");
    expect(page.children).toHaveLength(0);
    expect(figma.createRectangle).not.toHaveBeenCalled();
  });

  it("drops a partially painted node when the host rejects the frame, without a history boundary", () => {
    const { page, figma } = host();
    // Simulate the host rejecting an extreme placement size during paint.
    figma.createRectangle.mockImplementationOnce(() => {
      const node = rectangle("node-rejected");
      node.parent = page;
      node.resize = () => {
        throw new Error("resize is not supported");
      };
      page.children.push(node);
      return node;
    });
    const extreme = payload(1, { x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: 10 });
    expect(() => updateSceneDraft(page, extreme, "Poster")).not.toThrow();
    expect(page.children).toHaveLength(0);
    // Only the pre-create boundary ran; the failed create never entered history.
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
  });
});
