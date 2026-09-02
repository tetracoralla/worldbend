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
    for (const workspace of ["templates", "canvas", "mockup", "mesh", "remap"]) {
      expect(html).toContain(`data-workspace="${workspace}"`);
    }
    expect(html).toContain('id="templates-workspace"');
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

  it("keeps the Free and Perspective peers reachable outside Distort mode", () => {
    // The peers are the only controls that re-enter Distort, so no mode may
    // hide them: renderMode must never toggle the subgroup's hidden attribute.
    expect(html).toContain("#distort-kind { display: contents; }");
    expect(html).toContain("#distort-kind[hidden] { display: none; }");
    expect(html).not.toMatch(/<span id="distort-kind"[^>]*\shidden/);
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(uiSource).not.toContain("distortKind.hidden");
  });

  it("keeps session edit history beside Reset in the bottom session bar", () => {
    const dockStart = html.indexOf('<footer id="action-dock"');
    const dockEnd = html.indexOf("</footer>", dockStart);
    const dock = html.slice(dockStart, dockEnd);
    expect(dock).toContain('id="reset"');
    expect(dock).toContain('id="action-undo"');
    expect(dock).toContain('id="action-redo"');
    const popoverStart = html.indexOf('<div id="settings-popover"');
    const popoverEnd = html.indexOf("</div>", popoverStart);
    const popoverMarkup = html.slice(popoverStart, popoverEnd);
    expect(popoverMarkup).not.toContain('id="action-undo"');
    expect(popoverMarkup).not.toContain('id="action-redo"');
  });

  it("keeps output density visible but unobtrusive in the preview corner", () => {
    const editorStart = html.indexOf('<div id="editor"');
    const editorEnd = html.indexOf("</div>", editorStart);
    const editorMarkup = html.slice(editorStart, editorEnd);
    expect(editorMarkup).toContain('id="output-size"');
    expect(editorMarkup).toContain('aria-live="off"');
    expect(html).toContain("#output-size { position: absolute;");
    expect(html).toContain("pointer-events: none;");

    const popoverStart = html.indexOf('<div id="settings-popover"');
    const popoverEnd = html.indexOf("</div>", popoverStart);
    const popoverMarkup = html.slice(popoverStart, popoverEnd);
    expect(popoverMarkup).toContain('id="output-policy-fit"');
    expect(popoverMarkup).toContain('id="output-policy-original"');
  });
});
