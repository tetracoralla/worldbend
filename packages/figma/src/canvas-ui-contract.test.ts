import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../ui.html", import.meta.url), "utf8");

describe("Figma product workspace markup", () => {
  it("keeps task workspaces behind one compact source-level launcher", () => {
    const controlsStart = html.indexOf('<section id="controls"');
    const controlsEnd = html.indexOf("</section>", controlsStart);
    const canvasStart = html.indexOf('<section id="canvas-workspace"');
    const objectGroupStart = html.indexOf('<div id="object-group"');
    const objectGroupEnd = html.indexOf("</div>", objectGroupStart);
    const objectMarkup = html.slice(objectGroupStart, objectGroupEnd);
    const popoverStart = html.indexOf('<div id="settings-popover"');
    const popoverEnd = html.indexOf("</div>", popoverStart);
    const popoverMarkup = html.slice(popoverStart, popoverEnd);

    expect(controlsStart).toBeGreaterThan(-1);
    expect(controlsEnd).toBeGreaterThan(controlsStart);
    expect(canvasStart).toBeGreaterThan(controlsEnd);
    expect(html.slice(canvasStart, canvasStart + 100)).toContain("hidden");
    expect(objectMarkup).toContain('id="source-name"');
    expect(objectMarkup).toContain('id="task-launcher-button"');
    expect(objectMarkup).toContain('id="task-menu"');
    for (const workspace of ["canvas", "mockup", "mesh", "remap"]) {
      expect(html).toContain(`data-workspace="${workspace}"`);
    }
    expect(popoverMarkup).not.toContain('id="task-launcher-button"');
  });

  it("freezes the Perspective mode control order while Canvas remains outside it", () => {
    const modeSwitchStart = html.indexOf('<div id="mode-switch"');
    const modeSwitchEnd = html.indexOf("</div>", modeSwitchStart);
    const modeMarkup = html.slice(modeSwitchStart, modeSwitchEnd);
    const expectedOrder = [
      "mode-transform",
      "distort-free",
      "distort-perspective",
      "mode-warp",
      "mode-rectify",
    ];
    const positions = expectedOrder.map((id) => modeMarkup.indexOf(`id="${id}"`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(modeMarkup).not.toContain("canvas-workspace");
    expect(modeMarkup).not.toContain("task-launcher-button");
    expect(html.indexOf('id="more-options"')).toBeGreaterThan(
      html.indexOf('id="mode-rectify"'),
    );
  });

  it("lets hidden remove the display-contents Distort subgroup outside Distort mode", () => {
    expect(html).toContain("#distort-kind { display: contents; }");
    expect(html).toContain("#distort-kind[hidden] { display: none; }");
  });
});
