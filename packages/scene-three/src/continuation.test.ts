import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { continueFromAuthor } from "../examples/paper-stage/continuation";
import type { SpatialDocumentSpec } from "./index";

const authors = JSON.parse(readFileSync(new URL("../examples/paper-stage/author-versions.json", import.meta.url), "utf8")) as { document: SpatialDocumentSpec }[];
const scene = (doc: SpatialDocumentSpec) => {
  const expression = doc.expressions.find(e => e.kind === "scene3d")!;
  if (expression.kind !== "scene3d") throw Error("Missing test scene");
  return expression.scene;
};
describe("author updates preserve a receiving author's intention", () => {
  it("preserves local rhythm as a unit across a new rate and two author sources", () => {
    const [first, second, third] = authors.map(a => a.document);
    const local = structuredClone(first);
    scene(local).camera = "FrontCamera";
    scene(local).frameCount = 144;
    local.assets[1].contentVersion = second.assets[1].contentVersion;
    const before = JSON.stringify([first, local, second, third]);
    const adopted = continueFromAuthor(first, local, second);
    expect(adopted.conflicts.map(d => d.path)).toEqual(["/expressions/paper-theatre/scene/timing"]);
    expect(scene(adopted.document).frameCount).toBe(144);
    const later = continueFromAuthor(second, adopted.document, third);
    expect(scene(later.document).camera).toBe("FrontCamera");
    expect(scene(later.document).timebase).toEqual({ numerator: 24, denominator: 1 });
    expect(scene(later.document).frameCount).toBe(144);
    expect(later.conflicts.map(d => d.path).sort()).toEqual([
      "/expressions/paper-theatre/scene/camera", "/expressions/paper-theatre/scene/timing",
    ]);
    const chosen = continueFromAuthor(second, adopted.document, third, {
      "/expressions/paper-theatre/scene/timing": "source",
    });
    expect(scene(chosen.document).frameCount).toBe(210);
    expect(scene(chosen.document).timebase).toEqual({ numerator: 30, denominator: 1 });
    expect(scene(chosen.document).camera).toBe("FrontCamera");
    expect(JSON.stringify([first, local, second, third])).toBe(before);
  });
  it("keeps a new local cover edit while adopting a renamed source camera", () => {
    const [first, second, third] = authors.map(a => a.document);
    const local = structuredClone(second);
    local.assets[1].contentVersion = first.assets[1].contentVersion;
    const next = continueFromAuthor(second, local, third);
    expect(next.document.assets[0].contentVersion).toBe(third.assets[0].contentVersion);
    expect(next.document.assets[1].contentVersion).toBe(first.assets[1].contentVersion);
    expect(scene(next.document).camera).toBe("Reveal Camera.003");
    expect(next.conflicts).toEqual([]);
  });
  it("retains explicit local ownership when an intervening author chose the same cover", () => {
    const [first, second, third] = authors.map(a => a.document);
    const local = structuredClone(first);
    local.assets[1].contentVersion = second.assets[1].contentVersion;
    const adopted = continueFromAuthor(first, local, second);
    const nextAuthor = structuredClone(third);
    nextAuthor.assets[1].contentVersion = first.assets[1].contentVersion;
    const next = continueFromAuthor(second, adopted.document, nextAuthor, {}, adopted.localFields);
    expect(next.document.assets[1].contentVersion).toBe(second.assets[1].contentVersion);
    expect(next.conflicts.map(d => d.path)).toContain("/assets/field-notes/contentVersion");
    const chosen = continueFromAuthor(second, adopted.document, nextAuthor,
      { "/assets/field-notes/contentVersion": "source" }, adopted.localFields);
    expect(chosen.localFields).not.toContain("/assets/field-notes/contentVersion");
  });
});
