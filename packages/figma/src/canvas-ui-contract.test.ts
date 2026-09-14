import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../ui.html", import.meta.url), "utf8");
const canvasViewSource = readFileSync(new URL("./canvas-workspace-view.ts", import.meta.url), "utf8");
const workspaceSources = [
  ["Sizes", "./canvas-workspace.ts"],
  ["Composition", "./mockup-workspace.ts"],
  ["Mesh", "./mesh-workspace.ts"],
  ["Split Warp", "./surface-workspace.ts"],
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
      expect(buttonMarkup).toContain('class="workspace-name"');
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
      surface: "icon-park:split",
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

  it("keeps both output types beside contextual replacement in the Perspective footer", () => {
    const dockStart = html.indexOf('<footer id="action-dock"');
    const dockEnd = html.indexOf("</footer>", dockStart);
    const dock = html.slice(dockStart, dockEnd);
    expect(dock).toContain('id="reset"');
    expect(dock).toContain('id="apply"');
    expect(dock).toContain('id="action-apply-editable"');
    expect(dock).toContain('id="action-apply-copy"');
    expect(dock).not.toContain('role="menuitem"');
    expect(dock).toContain('id="status" class="sr-only"');
  });

  it("keeps unavailable native output keyboard-reachable with visible recovery guidance", () => {
    const dockStart = html.indexOf('<footer id="action-dock"');
    const dockEnd = html.indexOf("</footer>", dockStart);
    const dock = html.slice(dockStart, dockEnd);
    // A missing effect cannot be fixed by editing inputs, so the guidance
    // cannot hide behind a disabled button's hover-only tooltip.
    expect(dock).toContain('id="native-guidance" class="native-guidance" hidden');
    expect(dock).toContain('id="copy-effect-listing"');
    expect(html).toContain(".native-guidance {");
    expect(html).toContain('button[aria-disabled="true"] { cursor: default; }');

    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(uiSource).toContain("editableEnvironmentBlocked");
    expect(uiSource).toContain('setAttribute("aria-disabled", "true")');
    expect(uiSource).toContain('setAttribute("aria-describedby", "native-guidance")');
    expect(uiSource).toContain("copyNativeEffectListing");
    expect(uiSource).toContain("NATIVE_EFFECT_LISTING_URL");
    const i18nSource = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");
    expect(i18nSource).toContain('copyEffectListing: "Copy listing link"');
    expect(i18nSource).toContain('copyEffectListing: "复制效果链接"');
    // Transient discovery and unsupported modes keep the quiet disabled form.
    expect(uiSource).toContain("nativeRendererPending ? \"nativePreparing\"");
  });

  it("names Repeat Last Transform in More instead of showing an ambiguous toolbar glyph", () => {
    const popoverStart = html.indexOf('<div id="settings-popover"');
    const popoverEnd = html.indexOf("</div>", popoverStart);
    const popover = html.slice(popoverStart, popoverEnd);
    const actionsStart = html.indexOf('<div id="transform-actions"');
    const actionsEnd = html.indexOf("</div>", actionsStart);
    const actions = html.slice(actionsStart, actionsEnd);
    expect(popover).toContain('id="action-transform-again"');
    expect(popover).toContain("Repeat Last Transform");
    expect(actions).not.toContain('id="action-transform-again"');
  });

  it("offers Sizes operations as direct choices instead of a visible select", () => {
    expect(canvasViewSource).toContain('id="canvas-operation" class="sr-only"');
    expect(canvasViewSource).toContain('id="canvas-operation-choices"');
    for (const operation of ["crop", "trim", "pad", "contain", "cover", "stretch"]) {
      expect(canvasViewSource).toContain(`data-operation="${operation}"`);
    }
  });

  it("previews Sizes numeric edits live without locking the inspector to planning", () => {
    const source = readFileSync(new URL("./canvas-workspace.ts", import.meta.url), "utf8");
    expect(source).toContain("bindNumericField");
    expect(source).toContain("parseCanvasNumericPreview");
    expect(source).toContain("previewDraft");
    expect(source).toContain('const busy = phase === "applying"');
    expect(source).not.toContain('const busy = phase === "planning" || phase === "applying"');
    // Non-numeric commits (operation, background, anchor, reset, variants)
    // changed geometry with nothing queued; a flush-only tail froze their
    // preview on the stale plan.
    expect(source).toContain("if (planFrames.pending()) planFrames.flush();");
    expect(source).toContain("else void requestPlan();");
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

  it("follows Figma light and dark themes while keeping canvas labels legible", () => {
    expect(html).toContain(":root.figma-light {");
    expect(html).toContain(":root.figma-dark {");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("--wb-canvas-reference:");
    expect(html).toContain("text-shadow: none;");
    expect(html).toContain("stroke: var(--wb-canvas-reference);");
  });

  it("keeps direct-manipulation controls square and outside generic button motion", () => {
    expect(html).toContain(
      ".worldbend-editor__handle { position: absolute; z-index: 3; left: 0; top: 0; width: 32px; min-width: 0; height: 32px; min-height: 0;",
    );
    expect(html).toContain(
      ".direct-point { position: absolute; width: 32px; min-width: 0; height: 32px; min-height: 0;",
    );
    expect(html).toContain('.direct-point[aria-pressed="true"]::after');
    expect(html).toContain(
      "button:not(:disabled):not([aria-disabled=\"true\"]):not(.worldbend-editor__handle):not(.worldbend-editor__pivot):not(.direct-point):not(#warp-mesh-continue):not(#copy-effect-listing):active",
    );
    expect(html).not.toContain("button:not(:disabled):active { transform:");
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
    // Alert/status semantics are exercised by the built selection-entry flow;
    // empty selections now share this recovery path without being an error.
  });

  it("keeps Split Warp as an advanced Bezier workspace under More", () => {
    expect(html).toContain('id="workspace-menu-surface"');
    expect(html).toContain('id="surface-workspace"');
    expect(html).not.toContain('id="workspace-tab-surface"');
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(uiSource).toContain("createSurfaceWorkspace");
    expect(uiSource).toContain("surfaceWorkspace");
    const surfaceSource = readFileSync(new URL("./surface-workspace.ts", import.meta.url), "utf8");
    expect(surfaceSource).toContain("planSurfaceDeformation");
    expect(surfaceSource).toContain("identityEnvelope");
    expect(surfaceSource).toContain("transformForMesh");
    // Stored tasks may carry densities this workspace does not author; the
    // Patches select must display them instead of going blank.
    expect(surfaceSource).toContain("patchChoicesFor");
    // Pin targets toggle anchors; they must not be draggable or nudged into
    // a visual position the spec never took.
    expect(surfaceSource).toContain("draggable: tool === \"handles\"");
    const meshSource = readFileSync(new URL("./mesh-workspace.ts", import.meta.url), "utf8");
    expect(meshSource).toContain('selection: "multiple"');
  });

  it("keeps Copy CSS available for Distort quads as documented", () => {
    expect(html).toContain('id="action-copy-css"');
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(uiSource).toContain("emitCssTransform");
    expect(uiSource).toContain("cssWarpUnsupported");
    // A Distort quad is exactly what matrix3d represents; the documented
    // route is Transform/Distort without Warp, not Transform alone.
    expect(uiSource).toContain("const cssReady = menuReady && !transformInitializing && transformInputsValid &&");
    expect(uiSource).toContain('(editorMode === "transform" || editorMode === "distort")');
  });

  it("lets Warp continue into Mesh without adding a Perspective mode", () => {
    expect(html).toContain('id="warp-mesh-continue"');
    const modeSwitchStart = html.indexOf('<div id="mode-switch"');
    const modeSwitchEnd = html.indexOf("</div>", modeSwitchStart);
    expect(html.slice(modeSwitchStart, modeSwitchEnd)).not.toContain("warp-mesh-continue");
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(uiSource).toContain('productWorkspace.enter("mesh")');
    expect(uiSource).toContain("livePerspective()");
    const meshSource = readFileSync(new URL("./mesh-workspace.ts", import.meta.url), "utf8");
    expect(meshSource).toContain("meshSpecFromPerspective");
    expect(meshSource).toContain("transformForMesh");
  });

  it("keeps the primary Apply usable for Warp and Transform Again reachable from Distort", () => {
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    // A Warp operation cannot publish editable output, so the native-file
    // primary button must fall back to the HD route, not disable itself.
    expect(uiSource).toContain("const primaryEditable = Boolean(current?.nativeTarget) && editableModeSupported;");
    expect(uiSource).toContain("!editor?.captureSpec().content.warp");
    // Fresh selections open in Distort; Transform Again must stay reachable
    // there instead of demanding a manual mode switch first.
    expect(uiSource).toContain('const repeatReady = menuReady && !transformInitializing && transformInputsValid &&');
    expect(uiSource).toContain('(editorMode === "transform" || editorMode === "distort")');
  });

  it("keeps a human placement-parameters export on both authoring surfaces", () => {
    const actionsStart = html.indexOf('<div id="transform-actions"');
    const actionsEnd = html.indexOf("</div>", actionsStart);
    const actions = html.slice(actionsStart, actionsEnd);
    expect(actions).toContain('id="action-copy-parameters"');
    expect(actions).toContain('data-icon-id="icon-park:copy"');
    expect(actions).toContain("Copy placement parameters");

    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(uiSource).toContain('actionCopyParameters.addEventListener("click"');
    // Correct mode is a different operation; its quad is not a placement.
    expect(uiSource).toContain('editorMode === "rectify"');

    const mockupSource = readFileSync(new URL("./mockup-workspace.ts", import.meta.url), "utf8");
    expect(mockupSource).toContain('data-role="copy-parameters"');
    expect(mockupSource).toContain("copyPlacementParameters(placementParametersJson(spec))");
    // Both labels stay in the shared dictionaries, never hardcoded per surface.
    const i18nSource = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");
    for (const key of ["copyParameters", "parametersCopied", "copyParametersFailed"]) {
      expect(i18nSource).toMatch(new RegExp(`${key}: ".+",`));
    }
    expect(i18nSource).toContain('copyParameters: "复制放置参数"');
  });

  it("wires shared direct points to every interruption boundary", () => {
    const source = readFileSync(new URL("./direct-point-overlay.ts", import.meta.url), "utf8");
    expect(source).toContain('addEventListener("pointercancel"');
    expect(source).toContain('addEventListener("lostpointercapture"');
    expect(source).toContain('addEventListener("blur"');
    expect(source).toContain('addEventListener("visibilitychange"');
    expect(source).toContain('event.buttons === 0');
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("cancelPointer()");
  });

  it("keeps Mesh density changes from discarding interior edits", () => {
    const source = readFileSync(new URL("./mesh-workspace.ts", import.meta.url), "utf8");
    expect(source).toContain("resampleMesh(spec.mesh, Number(subdivisions.value))");
    expect(source).not.toContain("mesh: identityMesh(Number(subdivisions.value))");
  });

  it("does not rebuild the whole Perspective dock on every live geometry sample", () => {
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    expect(uiSource).toContain('? "publication"');
    expect(uiSource).toContain('if (scope === "publication") return;');
  });

  it("seeds the rectify output at a publishable size instead of an invalid one", () => {
    const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
    // Both raw render-size seeds route through the axis-limit fit; the entry
    // path must derive validity honestly instead of asserting it.
    expect(uiSource).toContain("fitRectifySeed(activeFrame.renderWidth, activeFrame.renderHeight)");
    expect(uiSource).toContain("fitRectifySeed(nextInitial.renderWidth, nextInitial.renderHeight)");
    const hardValidLines = uiSource
      .split("\n")
      .filter((line) => line.includes("rectifyInputsValid = true"));
    expect(hardValidLines).toEqual(["let rectifyInputsValid = true;"]);
  });

  it("hides native spin buttons on every numeric field", () => {
    expect(html).toContain('input[type="number"]::-webkit-inner-spin-button');
    expect(html).not.toContain(".transform-number::-webkit-inner-spin-button");
  });
});
