import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../ui.html", import.meta.url), "utf8");
const canvasViewSource = readFileSync(new URL("./canvas-workspace-view.ts", import.meta.url), "utf8");
const workspaceSources = [
  ["Sizes", "./canvas-workspace.ts"],
  ["Composition", "./mockup-workspace.ts"],
  ["Mesh", "./mesh-workspace.ts"],
  ["Lens & maps", "./remap-workspace.ts"],
  ["Templates", "./template-workspace.ts"],
] as const;

describe("Figma product workspace markup", () => {
  it("keeps the release loop primary and advanced transforms inside More", () => {
    const controlsStart = html.indexOf('<section id="controls"');
    const controlsEnd = html.indexOf("</section>", controlsStart);
    const canvasStart = html.indexOf('<section id="canvas-workspace"');
    const navigationStart = html.indexOf('<nav id="workspace-navigation"');
    const navigationEnd = html.indexOf("</nav>", navigationStart);
    const navigationMarkup = html.slice(navigationStart, navigationEnd);

    expect(controlsStart).toBeGreaterThan(-1);
    expect(controlsEnd).toBeGreaterThan(controlsStart);
    expect(canvasStart).toBeGreaterThan(controlsEnd);
    expect(html.slice(canvasStart, html.indexOf(">", canvasStart))).toContain("hidden");
    expect(navigationStart).toBeGreaterThan(-1);
    expect(navigationStart).toBeLessThan(controlsStart);
    expect(navigationMarkup).toContain('role="tablist"');
    expect(navigationMarkup).toContain('id="workspace-backward"');
    expect(navigationMarkup).toContain('id="workspace-forward"');
    expect(navigationMarkup).toContain('id="more-options"');
    expect(navigationMarkup).toContain('id="settings-popover"');
    const primaryIcons = {
      perspective: "icon-park:perspective",
      canvas: "icon-park:scale",
      templates: "icon-park:page-template",
    } as const;
    const primaryPositions = Object.keys(primaryIcons).map((workspace) =>
      navigationMarkup.indexOf(`id="workspace-tab-${workspace}"`),
    );
    expect(primaryPositions.every((position) => position >= 0)).toBe(true);
    expect(primaryPositions).toEqual([...primaryPositions].sort((a, b) => a - b));
    for (const [workspace, icon] of Object.entries(primaryIcons)) {
      const workspaceAttribute = navigationMarkup.indexOf(`data-workspace="${workspace}"`);
      const buttonStart = navigationMarkup.lastIndexOf("<button", workspaceAttribute);
      const buttonEnd = navigationMarkup.indexOf("</button>", buttonStart);
      const buttonMarkup = navigationMarkup.slice(buttonStart, buttonEnd);
      expect(workspaceAttribute).toBeGreaterThan(-1);
      expect(buttonStart).toBeGreaterThan(-1);
      expect(buttonMarkup).toContain(`id="workspace-tab-${workspace}"`);
      expect(buttonMarkup).toContain(`data-icon-id="${icon}"`);
      expect(buttonMarkup).toContain('class="action-tooltip"');
      expect(buttonMarkup).toContain("aria-label=");
      const panelId = workspace === "perspective" ? "controls" : `${workspace}-workspace`;
      const panelStart = html.indexOf(`<section id="${panelId}"`);
      const panelOpeningTag = html.slice(panelStart, html.indexOf(">", panelStart));
      expect(panelStart).toBeGreaterThan(-1);
      expect(buttonMarkup).toContain(`aria-controls="${panelId}"`);
      expect(panelOpeningTag).toContain('role="tabpanel"');
      expect(panelOpeningTag).toContain(`aria-labelledby="workspace-tab-${workspace}"`);
    }

    const secondaryIcons = {
      mockup: "icon-park:layout-four",
      mesh: "icon-park:grid-nine",
      remap: "icon-park:distortion",
    } as const;
    const popoverStart = navigationMarkup.indexOf('<div id="settings-popover"');
    const popoverMarkup = navigationMarkup.slice(popoverStart);
    expect(popoverStart).toBeGreaterThan(-1);
    expect(popoverMarkup).toContain('id="advanced-tools-title"');
    for (const [workspace, icon] of Object.entries(secondaryIcons)) {
      const buttonId = `workspace-menu-${workspace}`;
      const buttonStart = popoverMarkup.indexOf(`<button id="${buttonId}"`);
      const buttonEnd = popoverMarkup.indexOf("</button>", buttonStart);
      const buttonMarkup = popoverMarkup.slice(buttonStart, buttonEnd);
      const panelId = `${workspace}-workspace`;
      const panelStart = html.indexOf(`<section id="${panelId}"`);
      const panelOpeningTag = html.slice(panelStart, html.indexOf(">", panelStart));
      expect(buttonStart).toBeGreaterThan(-1);
      expect(buttonMarkup).toContain(`data-workspace="${workspace}"`);
      expect(buttonMarkup).toContain(`data-icon-id="${icon}"`);
      expect(buttonMarkup).toContain(`aria-controls="${panelId}"`);
      expect(panelStart).toBeGreaterThan(-1);
      expect(panelOpeningTag).toContain('role="region"');
      expect(panelOpeningTag).toContain(`aria-labelledby="${buttonId}"`);
      expect(navigationMarkup).not.toContain(`id="workspace-tab-${workspace}"`);
    }
    expect(html).toContain('id="templates-workspace"');
    expect(html).not.toContain('id="task-launcher-button"');
    expect(html).not.toContain('id="task-menu"');
  });

  it("separates Perspective modes from the Distort submode", () => {
    const modeSwitchStart = html.indexOf('<div id="mode-switch"');
    const modeSwitchEnd = html.indexOf("</div>", modeSwitchStart);
    const modeMarkup = html.slice(modeSwitchStart, modeSwitchEnd);
    const expectedOrder = [
      "mode-transform",
      "mode-distort",
      "mode-warp",
      "mode-rectify",
    ];
    const positions = expectedOrder.map((id) => modeMarkup.indexOf(`id="${id}"`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(modeMarkup).not.toContain("canvas-workspace");
    expect(modeMarkup).not.toContain("distort-free");
    expect(modeMarkup).not.toContain("distort-perspective");
    expect(html.indexOf('id="distort-kind"')).toBeLessThan(
      html.indexOf('id="context-controls"'),
    );
    expect(modeMarkup).not.toContain("more-options");
  });

  it("shows Free and Perspective as Distort-local peers on the mode row", () => {
    expect(html).toContain("#distort-kind { display: inline-flex;");
    const operationStart = html.indexOf('<div id="operation-cluster"');
    const operationEnd = html.indexOf("</div>\n        </div>", operationStart);
    const operationMarkup = html.slice(operationStart, operationEnd);
    expect(operationMarkup.indexOf('id="distort-options"')).toBeGreaterThan(
      operationMarkup.indexOf('id="mode-forward"'),
    );
    expect(html).toContain('<div id="context-controls" hidden>');
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(uiSource).toContain("distortOptions.hidden = !distortSelected");
    expect(uiSource).toContain("contextControls.hidden = distortSelected");
    expect(uiSource).toContain("renderOptionsContext(next)");
  });

  it("keeps undo and redo on standard shortcuts instead of persistent footer buttons", () => {
    const dockStart = html.indexOf('<footer id="action-dock"');
    const dockEnd = html.indexOf("</footer>", dockStart);
    const dock = html.slice(dockStart, dockEnd);
    expect(dock).toContain('id="reset"');
    expect(dock).not.toContain('id="action-undo"');
    expect(dock).not.toContain('id="action-redo"');
    expect(html).toContain('id="shortcut-help"');
    const i18nSource = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");
    expect(i18nSource).toContain("⌘/Ctrl Z undo");
    expect(i18nSource).toContain("Ctrl Y redo");
  });

  it("keeps output density visible but unobtrusive in the preview corner", () => {
    const editorStart = html.indexOf('<div id="editor"');
    const editorEnd = html.indexOf("</div>", editorStart);
    const editorMarkup = html.slice(editorStart, editorEnd);
    expect(editorMarkup).toContain('id="output-size"');
    expect(editorMarkup).toContain('id="source-name"');
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

  it("does not move keyboard focus to hidden Back controls", () => {
    expect(html).toContain(".canvas-back, .designer-back { display: none !important; }");
    for (const [name, path] of workspaceSources) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source, name).not.toContain("back.focus()");
    }
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(uiSource).toContain("workspaceNavigation.focusCurrent()");
  });

  it("returns a failed task selection to the usable Perspective recovery surface", () => {
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    const errorStart = uiSource.indexOf("function showSelectionError");
    const errorEnd = uiSource.indexOf("async function resetPerspective", errorStart);
    const errorSource = uiSource.slice(errorStart, errorEnd);
    expect(errorStart).toBeGreaterThan(-1);
    expect(errorSource.indexOf("productWorkspace.returnToPerspective()"))
      .toBeLessThan(errorSource.indexOf("canvasWorkspace.clearSource"));
    expect(errorSource).toContain('selectionState.setAttribute("role", "alert")');
  });

  it("wires shared direct points to every interruption boundary", () => {
    const source = readFileSync(new URL("./direct-point-overlay.ts", import.meta.url), "utf8");
    expect(source).toContain('addEventListener("pointercancel"');
    expect(source).toContain('addEventListener("lostpointercapture"');
    expect(source).toContain('addEventListener("blur"');
    expect(source).toContain('addEventListener("visibilitychange"');
    expect(source).toContain('event.buttons === 0');
  });
});
