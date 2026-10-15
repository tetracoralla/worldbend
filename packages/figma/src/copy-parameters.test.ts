import { describe, expect, it, vi } from "vitest";
import {
  copyPlacementParameters,
  placementParametersJson,
  type CopyHost,
  type CopyTextArea,
} from "./copy-parameters";

function fakeArea(): CopyTextArea & { removed: boolean } {
  return {
    value: "",
    style: {},
    setAttribute: vi.fn(),
    select: vi.fn(),
    remove() {
      this.removed = true;
    },
    removed: false,
  };
}

function fallbackDocument(area: CopyTextArea, copied: boolean) {
  return {
    createElement: () => area,
    body: { append: vi.fn() },
    execCommand: vi.fn(() => copied),
  };
}

function fallbackHost(area: CopyTextArea, copied: boolean): CopyHost {
  return { document: fallbackDocument(area, copied) };
}

describe("Placement parameter export", () => {
  it("serializes the canonical document for handoff", () => {
    expect(placementParametersJson({ schema: "worldbend.transform", version: "0.1" })).toBe(
      [
        "{",
        '  "schema": "worldbend.transform",',
        '  "version": "0.1"',
        "}",
      ].join("\n"),
    );
  });

  it("prefers the async clipboard and reports its result", async () => {
    const writeText = vi.fn(async () => undefined);
    const host: CopyHost = { navigator: { clipboard: { writeText } } };
    await expect(copyPlacementParameters("{}", host)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("{}");
  });

  it("falls back to the editable host when the clipboard API is denied", async () => {
    const area = fakeArea();
    const host: CopyHost = {
      navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
      document: fallbackDocument(area, true),
    };
    await expect(copyPlacementParameters("{}", host)).resolves.toBe(true);
    expect(area.removed).toBe(true);
  });

  it("never claims success when no copy route exists", async () => {
    await expect(copyPlacementParameters("{}", {})).resolves.toBe(false);
    const area = fakeArea();
    await expect(copyPlacementParameters("{}", fallbackHost(area, false))).resolves.toBe(false);
    expect(area.removed).toBe(true);
  });
});
