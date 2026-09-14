import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSceneDraftSession,
  createSceneDraftToken,
  isSceneDraftNode,
} from "./scene-draft";

const SESSION_A = "session-a-00001";
const SESSION_B = "session-b-00001";

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
    const session = createSceneDraftSession(SESSION_A);
    session.update(page, payload(1, { x: 5, y: 6, width: 50, height: 40 }), "Poster");
    const draft = page.children[0]!;
    expect(isSceneDraftNode(draft)).toBe(true);
    expect(draft.locked).toBe(true);
    expect(draft.name).toBe("Poster · Worldbend Working Preview");
    expect(draft).toMatchObject({ x: 5, y: 6, width: 50, height: 40 });
    expect(draft.fills).toEqual([{ type: "IMAGE", imageHash: "hash-1", scaleMode: "FILL" }]);
    // One pre-create boundary only: updates never produce per-frame history.
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
    expect(events.slice(0, 2)).toEqual(["commit", "create"]);

    session.update(page, payload(2, { x: 7, y: 8, width: 60, height: 30 }), "Poster");
    expect(page.children).toHaveLength(1);
    expect(page.children[0]).toBe(draft);
    expect(draft).toMatchObject({ x: 7, y: 8, width: 60, height: 30 });
    expect(draft.fills).toEqual([{ type: "IMAGE", imageHash: "hash-2", scaleMode: "FILL" }]);
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
    expect(figma.createRectangle).toHaveBeenCalledTimes(1);
  });

  it("clear retires and removes only this session's draft without replaying host history", () => {
    const { page, figma } = host();
    const session = createSceneDraftSession(SESSION_A);
    session.update(page, payload(1, { x: 0, y: 0, width: 10, height: 10 }), "Poster");
    const selected = rectangle("selected");
    selected.parent = page;
    page.children.push(selected);
    page.selection = [selected];
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
    const draft = page.children[0]!;
    const id = draft.id;
    session.clear(page);
    expect(draft.getPluginData("sceneDraftRetired")).toBe("1");
    expect(page.children).toEqual([selected]);
    expect(session.isOwnedNodeId(id)).toBe(true);
    session.forgetNodeId(id);
    expect(session.isOwnedNodeId(id)).toBe(false);
    expect(figma.triggerUndo).not.toHaveBeenCalled();
    expect(page.selection).toEqual([selected]);
    expect(figma.commitUndo).toHaveBeenCalledTimes(2);
    // Clearing with no draft creates no additional host boundary.
    session.clear(page);
    expect(figma.commitUndo).toHaveBeenCalledTimes(2);
  });

  it("sweeps only nodes whose owning session explicitly retired them", () => {
    const { page, figma } = host();
    const previous = createSceneDraftSession("session-old-0001");
    previous.update(page, payload(1, { x: 0, y: 0, width: 10, height: 10 }), "Old");
    const staleDraft = page.children[0]!;
    previous.clear(page);
    // Model host Undo resurrecting the removed node with its pre-removal data.
    staleDraft.removed = false;
    page.children.push(staleDraft);
    const artwork = rectangle("art");
    artwork.parent = page;
    page.children.push(artwork);
    const current = createSceneDraftSession(SESSION_A);
    current.sweepRetired(page);
    expect(page.children).toEqual([artwork]);
    expect(staleDraft.removed).toBe(true);
    expect(artwork.removed).toBe(false);
    expect(figma.triggerUndo).not.toHaveBeenCalled();
    expect(figma.commitUndo).toHaveBeenCalledTimes(3);
    current.sweepRetired(page);
    expect(figma.commitUndo).toHaveBeenCalledTimes(3);
  });

  it("does not let a late retired sweep remove any live preview", () => {
    const { page, figma } = host();
    const session = createSceneDraftSession(SESSION_A);
    session.update(page, payload(1, { x: 0, y: 0, width: 10, height: 10 }), "Poster");
    const draft = page.children[0];

    createSceneDraftSession(SESSION_B).sweepRetired(page);

    expect(page.children).toEqual([draft]);
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
  });

  it("ignores empty payloads instead of writing a broken draft", () => {
    const { page, figma } = host();
    const session = createSceneDraftSession(SESSION_A);
    session.update(page, { ...payload(0, { x: 0, y: 0, width: 10, height: 10 }), bytes: new Uint8Array() }, "Poster");
    expect(page.children).toHaveLength(0);
    expect(figma.createRectangle).not.toHaveBeenCalled();
  });

  it("drops a partially painted node when the host rejects the frame, without a history boundary", () => {
    const { page, figma } = host();
    const session = createSceneDraftSession(SESSION_A);
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
    expect(() => session.update(page, extreme, "Poster")).not.toThrow();
    expect(page.children).toHaveLength(0);
    // Only the pre-create boundary ran; the failed create never entered history.
    expect(figma.commitUndo).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent sessions from sweeping, overwriting, or clearing one another", () => {
    const { page } = host();
    const a = createSceneDraftSession(SESSION_A);
    const b = createSceneDraftSession(SESSION_B);
    a.update(page, payload(1, { x: 1, y: 2, width: 10, height: 10 }), "A");
    const aNode = page.children[0]!;

    b.sweepRetired(page);
    expect(page.children).toEqual([aNode]);
    b.update(page, payload(2, { x: 20, y: 30, width: 12, height: 14 }), "B");
    const bNode = page.children[1]!;
    expect(bNode).not.toBe(aNode);

    a.update(page, payload(3, { x: 4, y: 5, width: 16, height: 18 }), "A");
    expect(aNode).toMatchObject({ x: 4, y: 5, width: 16, height: 18 });
    expect(bNode).toMatchObject({ x: 20, y: 30, width: 12, height: 14 });

    b.clear(page);
    expect(page.children).toEqual([aNode]);
    expect(aNode.removed).toBe(false);
  });

  it("preserves an unowned legacy marker because it may still be another live session", () => {
    const { page, figma } = host();
    const legacy = rectangle("legacy");
    legacy.parent = page;
    legacy.setPluginData("sceneDraft", "1");
    page.children.push(legacy);

    createSceneDraftSession(SESSION_A).sweepRetired(page);

    expect(page.children).toEqual([legacy]);
    expect(figma.commitUndo).not.toHaveBeenCalled();
  });

  it("creates bounded session identities and rejects malformed ones", () => {
    const generated = createSceneDraftToken();
    expect(generated).toMatch(/^[a-z0-9-]{12,96}$/);
    expect(() => createSceneDraftSession(generated)).not.toThrow();
    expect(() => createSceneDraftSession("short")).toThrow("Scene draft identity is invalid");
  });
});
