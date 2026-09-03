import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../ui.html", import.meta.url), "utf8");
const canvasViewSource = readFileSync(new URL("./canvas-workspace-view.ts", import.meta.url), "utf8");
const workspaceSources = [
  ["Sizes", "./canvas-workspace.ts", "view.back.focus()"],
  ["Mockup", "./mockup-workspace.ts", "shell.back.focus()"],
  ["Mesh", "./mesh-workspace.ts", "shell.back.focus()"],
  ["Remap", "./remap-workspace.ts", "shell.back.focus()"],
  ["Templates", "./template-workspace.ts", "shell.back.focus()"],
] as const;

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
    expect(objectMarkup).not.toContain('id="task-launcher-label"');
    expect(objectMarkup).toContain('data-icon-id="icon-park:tool"');
    expect(objectMarkup).toContain('aria-orientation="horizontal"');
    const icons = {
      templates: "icon-park:page-template",
      canvas: "icon-park:scale",
      mockup: "icon-park:layout-four",
      mesh: "icon-park:grid-nine",
      remap: "icon-park:distortion",
    } as const;
    for (const [workspace, icon] of Object.entries(icons)) {
      const buttonStart = objectMarkup.indexOf(`data-workspace="${workspace}"`);
      const buttonEnd = objectMarkup.indexOf("</button>", buttonStart);
      const buttonMarkup = objectMarkup.slice(buttonStart, buttonEnd);
      expect(buttonStart).toBeGreaterThan(-1);
      expect(buttonMarkup).toContain(`data-icon-id="${icon}"`);
      expect(buttonMarkup).toContain('class="action-tooltip"');
      expect(buttonMarkup).toContain("aria-label=");
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

  it("keeps Sizes template saving compact and icon-led", () => {
    expect(canvasViewSource).toContain('id="canvas-template-name"');
    expect(canvasViewSource).toContain('id="canvas-save-template"');
    expect(canvasViewSource).toContain('data-icon-id="icon-park:save"');
    expect(canvasViewSource).toContain('class="action-tooltip"');
  });

  it("moves keyboard focus to Back in every task workspace", () => {
    for (const [name, path, focusCall] of workspaceSources) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source, name).toContain(`queueMicrotask(() => ${focusCall})`);
    }
  });
});
