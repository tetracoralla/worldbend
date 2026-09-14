import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { closeChrome, createPage, findChrome, launchChrome, readPageResult } from "./remap-native-webgl-parity.mjs";

// Built UI + real WASM + browser DOM, with the Figma message boundary simulated.
// This does not assert installed Figma event timing or document Undo support.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(path.join(tmpdir(), "worldbend-figma-ui-"));
let browser, server;
try {
  await build({ configFile: path.join(root, "packages/figma/vite.config.ts"), mode: "ui",
    logLevel: "silent", build: { outDir: output } });
  const ui = await readFile(path.join(output, "ui.html"), "utf8");
  const bootstrap = `<script>
    window.fixtureMessages = [];
    window.fixtureErrors = [];
    addEventListener('error', event => window.fixtureErrors.push(event.message));
    addEventListener('unhandledrejection', event => window.fixtureErrors.push(String(event.reason)));
    addEventListener('message', event => {
      const message = event.data?.pluginMessage;
      if (message) window.fixtureMessages.push(message);
    });
  </script>`;
  const fixture = `<script>(${runFixture.toString()})();</script>`;
  const html = ui.replace("<head>", `<head>${bootstrap}`).replace("</body>", `${fixture}</body>`);
  server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  browser = await launchChrome(await findChrome(), ["--window-size=820,760"]);
  const scenarios = ["content-history", "pending-distort-commit", "unpainted-distort-commit", "transform-controls", "external-operation", "output-workflow", "native-output-limits", "native-publication-undo", "fixed-preview-labels", "late-native-renderer", "hd-source-reuse", "projective-edge-quality", "selection-entry", "dogfood-tasks", "designer-history", "designer-publication", "designer-projection", "designer-refresh", "designer-template", "surface-authoring", "designer-experience", "scene-draft"];
  const requested = process.argv.slice(2);
  for (const scenario of requested) assert(scenarios.includes(scenario), `Unknown Figma UI scenario: ${scenario}`);
  for (const scenario of requested.length ? requested : scenarios) {
    const target = await createPage(browser.debugUrl, `http://127.0.0.1:${address.port}/?case=${scenario}`);
    const result = await readPageResult(target.webSocketDebuggerUrl);
    assert(!result.error, `${scenario}: ${result.error}`);
    console.log(`Built Figma UI refresh passed: ${scenario}`);
  }
  const compactScenarios = requested.length
    ? requested.filter((name) => ["selection-entry", "designer-experience"].includes(name))
    : ["selection-entry", "designer-experience"];
  for (const scenario of compactScenarios) {
    // Plugin windows shrink to Figma's 300 px minimum; the selection entry
    // must survive that width too, not only the comfortable default.
    const compact = await launchChrome(await findChrome(), ["--window-size=300,520"]);
    try {
      // Chrome clamps its window to 500 px; set the content viewport before
      // navigation so this really exercises Figma's narrower plugin surface.
      const target = await createPage(compact.debugUrl, "about:blank");
      const result = await readPageResult(target.webSocketDebuggerUrl, {
        width: 300, height: 520, url: `http://127.0.0.1:${address.port}/?case=${scenario}&width=300`,
      });
      assert(!result.error, `${scenario} at 300 px: ${result.error}`);
      console.log(`Built Figma UI refresh passed: ${scenario} at 300 px`);
    } finally {
      await closeChrome(compact);
    }
  }
} finally {
  if (browser) await closeChrome(browser);
  if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(output, { recursive: true, force: true });
}

async function runFixture() {
  const delay = () => new Promise(resolve => setTimeout(resolve, 10));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (predicate, label) => {
    const deadline = performance.now() + 5000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
      await delay();
    }
  };
  const get = selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing UI element: ${selector}`);
    return node;
  };
  const key = (target, value, modifiers = {}) => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...modifiers }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key: value, bubbles: true, ...modifiers }));
  };
  const send = message => dispatchEvent(new MessageEvent("message", { data: { pluginMessage: message } }));
  const ready = () => wait(() => !get("#apply").disabled, "ready to apply");
  try {
    const expectedWidth = new URL(location.href).searchParams.get("width");
    if (expectedWidth) check(innerWidth === Number(expectedWidth), `Expected ${expectedWidth}px viewport, received ${innerWidth}px`);
    await wait(() => window.fixtureMessages.some(message => message.type === "ready"), "UI startup");
    send({ type: "locale", preference: "en", locale: "en" });
    const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 160;
    const context = canvas.getContext("2d");
    context.fillStyle = "#123345"; context.fillRect(0, 0, 200, 160);
    context.fillStyle = "#eabe55"; context.fillRect(20, 20, 80, 40);
    const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), character => character.charCodeAt(0));
    const spec = { schema: "worldbend.transform", version: "0.1", destination: {
      space: "normalized", quad: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } },
    }, content: { fit: "stretch" } };
    const payload = { bytes, spec, sourceNodeId: "content", sourceName: "Refresh fixture", renderWidth: 200, renderHeight: 160,
      placement: { x: 500, y: 200, width: 200, height: 160 }, targetNodeId: "result", nativeTarget: true,
      nativeRenderer: { id: "fixture", propertyIds: Array.from({ length: 9 }, (_, i) => String(i)), extentPropertyIds: ["9", "10"] } };
    let generation = 0;
    const refresh = async (next = payload) => {
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: [next.targetNodeId ?? next.sourceNodeId] });
      send({ type: "source", generation, payload: next });
      await ready();
    };
    await refresh();
    const corner = () => get('[data-corner="tl"]');
    const label = () => corner().getAttribute("aria-label");
    const moveCorner = async () => {
      const before = label(); corner().focus(); key(corner(), "ArrowRight");
      await wait(() => label() !== before, "corner edit");
      get("#mode-distort").focus(); await ready();
    };
    const undo = () => { get("#mode-distort").focus(); key(document.activeElement, "z", { metaKey: true }); };
    const apply = async () => {
      get("#apply").click();
      await wait(() => window.fixtureMessages.some(message => message.type === "apply-native"), "native apply");
      return window.fixtureMessages.findLast(message => message.type === "apply-native").payload;
    };
    const scenario = new URL(location.href).searchParams.get("case");
    if (scenario === "scene-draft") {
      const drafts = () => window.fixtureMessages.filter(m => m.type === "scene-draft");
      const clears = () => window.fixtureMessages.filter(m => m.type === "scene-draft-clear");
      const settle = () => new Promise(resolve => setTimeout(resolve, 400));
      const failNextCanvasEncode = () => {
        const original = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function(callback) {
          HTMLCanvasElement.prototype.toBlob = original;
          callback(null);
        };
      };
      await settle();
      check(drafts().length === 0, "Opening Perspective mutated the document before an edit");
      // The default Distort workspace activates the preview from a real
      // keyboard edit and removes it again when local Undo reaches baseline.
      const initialClears = clears().length;
      await moveCorner();
      await wait(() => drafts().length >= 1, "Distort edit activates the canvas preview");
      undo();
      await wait(() => clears().length > initialClears, "Undo to baseline clears the canvas preview");
      // A Transform edit activates the same bounded publication-parity frame.
      get("#mode-transform").click();
      await wait(() => !get("#scale-x").disabled, "transform controls enabled");
      const seen = window.fixtureMessages.length;
      get("#scale-x").value = "1.5";
      get("#scale-x").dispatchEvent(new Event("input", { bubbles: true }));
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "scene-draft"),
        "edited scene working preview");
      const first = drafts()[0];
      check(first.bytes.length > 8 && first.renderWidth >= 1 && first.renderHeight >= 1 &&
        first.placement.width > 0 && first.placement.height > 0, "Scene preview frame is incomplete");
      const png = await createImageBitmap(new Blob([first.bytes], { type: "image/png" }));
      check(png.width === first.renderWidth && png.height === first.renderHeight,
        "Scene preview PNG disagrees with its dimensions");
      png.close();
      check(first.bytes.length <= 4 * 1024 * 1024, "Scene preview frame exceeds its bounded size");
      // Correct is not a destination preview; entering it clears the canvas.
      get("#mode-rectify").click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "scene-draft-clear"),
        "Correct clears the canvas preview");
      // Returning to a placement mode does not create feedback until it differs
      // from the loaded result; the Warp edit then resumes the working preview.
      get("#mode-warp").click(); await ready();
      get("#warp-preset").value = "arc";
      get("#warp-preset").dispatchEvent(new Event("change", { bubbles: true }));
      await ready();
      get("#warp-amount").value = "200";
      get("#warp-amount").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => get("#apply").disabled, "invalid Warp disables publication");
      get("#warp-amount").value = "40";
      get("#warp-amount").dispatchEvent(new Event("change", { bubbles: true }));
      await ready();
      await wait(() => drafts().length >= 2, "Warp recovery resumes the canvas preview");
      // A local final-encode failure also restores the preview; this path
      // never reaches the simulated Figma main thread.
      const perspectiveDraftsBeforeLocalFailure = drafts().length;
      const perspectiveApplyMessagesBeforeLocalFailure = window.fixtureMessages.filter(m => m.type === "apply").length;
      failNextCanvasEncode();
      get("#apply").click();
      await wait(() => !get("#apply").disabled && !get("#error").hidden,
        "Perspective local failure returns to editing");
      await wait(() => drafts().length > perspectiveDraftsBeforeLocalFailure,
        "Perspective local failure restores the working preview");
      check(window.fixtureMessages.filter(m => m.type === "apply").length === perspectiveApplyMessagesBeforeLocalFailure,
        "Perspective local failure crossed the host publication boundary");
      // A host-side publication failure restores the still-dirty canvas
      // preview and leaves the error visible for a meaningful retry.
      const perspectiveDraftsBeforeFailure = drafts().length;
      const perspectiveClearsBeforeFailure = clears().length;
      const perspectiveApplySeen = window.fixtureMessages.length;
      get("#apply").click();
      await wait(() => window.fixtureMessages.slice(perspectiveApplySeen).some(m => m.type === "apply"),
        "Perspective publication request");
      await wait(() => clears().length > perspectiveClearsBeforeFailure,
        "Perspective publication clears the working preview");
      send({ type: "apply-error", generation, message: { key: "nativeApplyFailed" } });
      await ready();
      await wait(() => drafts().length > perspectiveDraftsBeforeFailure,
        "Perspective failure restores the working preview");
      check(!get("#error").hidden, "Perspective failure recovery erased its error");
      // Composition follows the same first-edit activation rule.
      generation++;
      send({ type: "selection-loading", generation, nodeIds: ["art", "backdrop"] });
      const art = { ...payload, sourceName: "Poster artwork" };
      const backdrop = { ...art, sourceNodeId: "backdrop", sourceName: "Studio scene", placement: { x: 800, y: 200, width: 600, height: 400 } };
      send({ type: "source", generation, payload: { ...art, targetNodeId: undefined, nativeTarget: undefined, nativeRenderer: undefined, sources: [art, backdrop] } });
      await wait(() => !get("#workspace-menu-mockup").disabled, "scene selection");
      get("#more-options").click(); get("#workspace-menu-mockup").click();
      await wait(() => get("#mockup-workspace").querySelectorAll('[data-role="planes"] button').length === 2, "scene layers");
      const draftsBeforeCompositionEdit = drafts().length;
      await settle();
      check(drafts().length === draftsBeforeCompositionEdit,
        "Opening Composition mutated the document before an edit");
      get("#mockup-workspace").querySelectorAll('[data-role="planes"] button')[1].click();
      get("#mockup-workspace").querySelector('[data-role="backdrop"]').click();
      await wait(() => get("#mockup-workspace").querySelector('[data-role="width"]').value === "600", "backdrop layout");
      await wait(() => drafts().some(m => m.placement.width === 600 && m.placement.height === 400),
        "composition canvas preview");
      const composite = drafts().findLast(m => m.placement.width === 600 && m.placement.height === 400);
      check(composite.placement.x === 800 && composite.placement.y === 200,
        "Composition preview lost its backdrop anchoring");
      const compositionDraftsBeforeLocalFailure = drafts().length;
      const compositionApplyMessagesBeforeLocalFailure = window.fixtureMessages.filter(m => m.type === "apply-designer").length;
      failNextCanvasEncode();
      get('#mockup-workspace [data-role="apply"]').click();
      await wait(() => !get('#mockup-workspace [data-role="apply"]').disabled &&
        !get('#mockup-workspace [data-role="error"]').hidden,
      "Composition local failure returns to editing");
      await wait(() => drafts().length > compositionDraftsBeforeLocalFailure,
        "Composition local failure restores the working preview");
      check(window.fixtureMessages.filter(m => m.type === "apply-designer").length === compositionApplyMessagesBeforeLocalFailure,
        "Composition local failure crossed the host publication boundary");
      const compositionDraftsBeforeFailure = drafts().length;
      const compositionApplySeen = window.fixtureMessages.length;
      get('#mockup-workspace [data-role="apply"]').click();
      await wait(() => window.fixtureMessages.slice(compositionApplySeen).some(m => m.type === "apply-designer"),
        "Composition publication request");
      send({ type: "apply-designer-error", generation, message: { key: "previewFailed" } });
      await wait(() => drafts().length > compositionDraftsBeforeFailure,
        "Composition failure restores the working preview");
      check(!get('#mockup-workspace [data-role="error"]').hidden,
        "Composition failure recovery erased its error");
      const exitClearBefore = clears().length;
      get("#workspace-tab-perspective").click();
      await wait(() => clears().length > exitClearBefore, "workspace exit clears the canvas preview");
      check(window.fixtureErrors.length === 0, `fixture errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "designer-experience") {
      get("#mode-warp").click();
      await wait(() => !get("#warp-picker-trigger").disabled, "visual preset entry");
      get("#warp-picker-trigger").click();
      await wait(() => document.querySelectorAll("#warp-picker-options svg").length === 11, "core-generated preset thumbnails");
      check(!get("#warp-picker-options").hidden, "Preset picker closed while thumbnails loaded");
      get('[data-warp-preset="arc"]').click();
      await wait(() => get("#warp-picker-trigger").textContent === "Arc" && get("#apply").textContent === "New HD Image" && !get("#apply").disabled, "Arc selection");
      check(get("#apply").textContent === "New HD Image" && get("#action-apply-copy").hidden, "Warp falsely offers native replacement or duplicates image action");
      get("#warp-picker-trigger").click();
      get("#warp-picker-options").dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}));
      check(get("#warp-picker-options").hidden && document.activeElement === get("#warp-picker-trigger"), "Escape did not restore picker focus");
      generation++;
      send({type:"selection-loading",generation,nodeIds:["art","backdrop"]});
      const art = {...payload, sourceNodeId:"art",sourceName:"Poster artwork",targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined};
      const backdrop = {...art,sourceNodeId:"backdrop",sourceName:"Studio scene",placement:{x:800,y:200,width:600,height:400}};
      send({type:"source",generation,payload:{...art,sources:[art,backdrop]}});
      await wait(() => !get("#workspace-menu-mockup").disabled, "scene selection");
      get("#more-options").click(); get("#workspace-menu-mockup").click();
      const root = get("#mockup-workspace");
      await wait(() => root.querySelectorAll('[data-role="planes"] button').length === 2, "named scene layers");
      const thumbnails = [...root.querySelectorAll('.plane-thumbnail')];
      check(thumbnails.length === 2 && thumbnails.every(node => node instanceof HTMLCanvasElement && node.getContext('2d').getImageData(0,0,64,52).data.some((value,index) => index % 4 === 3 && value > 0)), "Source thumbnails lost decoded artwork");
      const secondPlane = root.querySelectorAll('[data-role="planes"] button')[1];
      secondPlane.focus(); secondPlane.click();
      check(document.activeElement?.getAttribute('aria-selected') === 'true', "Layer selection lost keyboard focus");
      root.querySelector('[data-role="backdrop"]').click();
      await wait(() => root.querySelector('[data-role="width"]').value === "600" && !root.querySelector('[data-role="apply"]').disabled, "artwork placed on backdrop");
      root.querySelector('[data-role="template-name"]').value = "Studio placement";
      root.querySelector('[data-role="save-template"]').click();
      await wait(() => window.fixtureMessages.some(m => m.type === "save-template"), "save reusable scene");
      const saved = window.fixtureMessages.findLast(m => m.type === "save-template");
      check(saved.template.operation.spec.planes[0].sourceId === "source-2", "Backdrop reordered source identities");
      send({type:"template-library",templates:[{id:"studio",name:saved.name,template:saved.template}],mutation:{kind:"save",workspace:"mockup",requestId:saved.requestId}});
      get("#workspace-tab-templates").click();
      await wait(() => get('.template-item-preview').querySelector('svg'), "reusable scene thumbnail");
      get('.template-item').click();
      get('#templates-workspace [data-role="apply"]').click();
      await wait(() => !root.hidden && !root.querySelector('[data-role="apply"]').disabled, "reopen scene template");
      const seen = window.fixtureMessages.length;
      root.querySelector('[data-role="apply"]').click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), "scene output");
      const published = window.fixtureMessages.findLast(m => m.type === "apply-designer");
      check(published.payload.task.spec.planes[0].sourceId === "source-2", "Publication lost backdrop source mapping");
    } else if (scenario === "surface-authoring") {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      get("#more-options").click(); get("#workspace-menu-surface").click();
      const panel = "#surface-workspace";
      await wait(() => !get(panel).hidden && document.querySelector(`${panel} .direct-point`), "Split Warp handles");
      await frames();
      const control = () => get(`${panel} .direct-point`);
      const original = control().style.left;
      key(control(), "ArrowRight", { shiftKey: true }); await frames();
      check(control().style.left !== original, "Split Warp handle did not move");
      const preview = get(`${panel} canvas`);
      const before = preview.toDataURL();
      const splits = get(`${panel} [data-role="patches"]`);
      splits.value = "2x2"; splits.dispatchEvent(new Event("change", { bubbles: true })); await frames();
      check(get(`${panel} [data-role="error"]`).hidden, "Exact split failed to plan");
      check(preview.toDataURL() === before, "Adding splits changed the rendered cubic surface");
      splits.value = "1x1"; splits.dispatchEvent(new Event("change", { bubbles: true })); await frames();
      check(preview.toDataURL() === before, "Merging unchanged split curves changed the rendered surface");
      const save = async () => {
        const seen = window.fixtureMessages.length;
        const field = get(`${panel} [data-role="template-name"]`); field.value = "Review fixture";
        field.dispatchEvent(new Event("input", { bubbles: true })); get(`${panel} [data-role="save-template"]`).click();
        await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "save-template"), "saved surface spec");
        const request = window.fixtureMessages.findLast(m => m.type === "save-template");
        send({ type: "template-library", templates: [], mutation: { kind: "save", workspace: "surface", requestId: request.requestId } });
        return request.template.operation.spec;
      };
      get(`${panel} [data-role="tool-pin"]`).click(); await frames();
      get(`${panel} [data-point-id="1,1"]`).click(); await frames();
      check(get(`${panel} [data-point-id="1,1"]`).getAttribute("aria-pressed") === "true", "Pin is not keyboard-activatable or does not announce its state");
      const density = get(`${panel} [data-role="subdivisions"]`);
      density.value = "8"; density.dispatchEvent(new Event("change", { bubbles: true })); await frames();
      check(density.value === "12" && !get(`${panel} [data-role="error"]`).hidden, "Density silently moved a nonrepresentable pin");
      get(`${panel} [data-point-id="1,1"]`).click(); await frames();
      get(`${panel} [data-point-id="6,6"]`).click(); await frames();
      density.value = "8"; density.dispatchEvent(new Event("change", { bubbles: true })); await frames();
      const pinned = await save();
      check(pinned.anchors[0].column === 4 && pinned.anchors[0].row === 4, "Representable pin changed its source position");
      get(`${panel} [data-role="tool-brush"]`).click(); await frames();
      const box = preview.getBoundingClientRect(), x = box.left + box.width * .4, y = box.top + box.height * .4;
      const pointer = (type, offset, buttons, pointerId = 11) => preview.dispatchEvent(new PointerEvent(type, {
        clientX: x + offset, clientY: y, pointerId, button: 0, buttons, bubbles: true,
      }));
      pointer("pointerdown", 0, 1); pointer("pointermove", 6, 1); await frames();
      key(get(`${panel} [data-role="tool-brush"]`), "Escape"); await frames();
      check(!get(panel).hidden && (await save()).strokes.length === 0, "Escape did not cancel just the in-flight brush stroke");
      get(`${panel} [data-role="tool-handles"]`).click(); get(`${panel} [data-role="tool-brush"]`).click();
      check(!document.querySelector(`${panel} .direct-point-lattice path`), "Brush tool restored a stale footprint");
      pointer("pointerdown", 0, 1);
      const ownedFootprint = get(`${panel} .direct-point-lattice path`).getAttribute("d");
      pointer("pointermove", 5, 1, 99);
      check(get(`${panel} .direct-point-lattice path`).getAttribute("d") === ownedFootprint,
        "Foreign pointer moved the active brush footprint");
      pointer("pointerup", 8, 0); await frames();
      const brushed = await save();
      check(brushed.strokes.length === 1 && brushed.strokes[0].samples.length === 1 && brushed.strokes[0].samples[0].delta.x > 0,
        "Brush lost the final pointerup position or accepted another pointer");
      const edited = preview.toDataURL();
      key(get(`${panel} [data-role="tool-brush"]`), "z", { metaKey: true }); await frames();
      check((await save()).strokes.length === 0, "Brush Undo did not restore its starting surface");
      key(get(`${panel} [data-role="tool-brush"]`), "z", { metaKey: true, shiftKey: true }); await frames();
      check(preview.toDataURL() === edited, "Brush Redo changed pixels");
      const seen = window.fixtureMessages.length;
      get(`${panel} [data-role="apply"]`).click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), "surface publication");
      const published = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check(published.task.spec.strokes.length === 1 && published.bytes.length > 0, "Surface output lost authored brush data");
      send({ type: "apply-designer-complete", generation, targetNodeId: "surface-result", operation: "apply" });
      await frames();
      const seenUndo = window.fixtureMessages.length;
      pointer("pointerdown", 0, 1); pointer("pointerup", 5, 0); await frames();
      key(get(`${panel} [data-role="tool-brush"]`), "z", { metaKey: true }); await frames();
      check(!window.fixtureMessages.slice(seenUndo).some(m => m.type === "trigger-undo"), "New brush edit incorrectly routed Undo to the host");
      check((await save()).strokes.length === 1, "Undo after publication did not retain the previous stroke");
      get(`${panel} [data-role="reset"]`).click(); await frames();
      const error = () => get(`${panel} [data-role="error"]`);
      for (let stroke = 0; stroke < 4; stroke += 1) {
        pointer("pointerdown", 0, 1);
        for (let sample = 0; sample < 256; sample += 1) {
          pointer("pointermove", sample % 2 ? .02 : .01, 1);
        }
        // Drain preview frames before the rejected sample: release must clear
        // feedback even when there is no pending frame left to flush.
        await frames();
        pointer("pointermove", .03, 1); await frames();
        check(!error().hidden && error().textContent.includes(stroke === 3 ? "Brush capacity" : "sample limit"),
          "Brush capacity guidance did not distinguish stroke and total limits");
        pointer("pointerup", .03, 0); await frames();
        check(error().hidden, "Completed stroke retained obsolete capacity feedback");
      }
      check((await save()).strokes.every(stroke => stroke.samples.length === 256), "Capped stroke changed its samples");
      pointer("pointerdown", 0, 1); pointer("pointermove", .03, 1); await frames();
      check(!error().hidden && error().textContent.includes("Brush capacity"), "Full brush did not explain recovery");
      pointer("pointerup", .03, 0); await frames();
      check(error().hidden, "Unchanged capped gesture retained obsolete feedback");
      pointer("pointerdown", 0, 1); pointer("pointermove", .03, 1); await frames();
      get(`${panel} [data-role="tool-handles"]`).click(); await frames();
      check(error().hidden, "Switching tools retained a finished brush warning");
      get(`${panel} [data-role="tool-brush"]`).click();
      key(get(`${panel} [data-role="tool-brush"]`), "z", { metaKey: true }); await frames();
      check((await save()).strokes.length === 3, "Rejected gesture consumed an Undo entry");
    } else if (scenario?.startsWith("designer-")) {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (const workspace of (scenario === "designer-publication" ? ["mesh", "surface", "mockup", "remap"] : ["mesh", "surface"])) {
        const panel = `#${workspace}-workspace`;
        get("#more-options").click(); get(`#workspace-menu-${workspace}`).click();
        await wait(() => !get(panel).hidden && document.querySelector(`${panel} canvas`) && !get(`${panel} [data-role="apply"]`).disabled, `${workspace} ready`);
        await frames();
        const point = () => get(`${panel} .direct-point`);
        if (scenario === "designer-template") {
          // A template starts with an empty local history just like a blank
          // workspace. Its explicit origin, not canUndo(), must keep the live
          // Perspective seed from replacing it on entry.
          get(`${panel} [data-role="back"]`).click();
          const transform = structuredClone(spec);
          const meshVertices = Array.from({ length: 9 }, (_, index) => {
            const x = index % 3, y = Math.floor(index / 3);
            const source = { x: x / 2, y: y / 2 };
            return { source, warped: index === 4 ? { x: .37, y: .62 } : { ...source } };
          });
          const surfacePoints = Array.from({ length: 16 }, (_, index) => ({
            x: (index % 4) / 3,
            y: Math.floor(index / 4) / 3,
          }));
          surfacePoints[5] = { x: .38, y: .42 };
          const templateSpec = workspace === "mesh" ? {
            schema: "worldbend.mesh-warp", version: "0.1", transform,
            targetSize: { width: 200, height: 160 },
            mesh: { subdivisions: 2, vertices: meshVertices },
          } : {
            schema: "worldbend.surface-deformation", version: "0.1", transform,
            targetSize: { width: 200, height: 160 }, meshSubdivisions: 12,
            envelope: { columns: 1, rows: 1, points: surfacePoints },
            anchors: [{ id: "pin-6-6", column: 6, row: 6 }],
            strokes: [{ id: "stroke-1", samples: [{
              position: { x: .4, y: .4 }, delta: { x: .05, y: 0 }, radius: .12, strength: .5,
            }] }],
          };
          send({ type: "template-library", templates: [{
            id: `${workspace}-template`, name: `${workspace} template`, template: {
              schema: "worldbend.figma-task-template", version: "0.1",
              operation: { kind: workspace, spec: templateSpec },
            },
          }] });
          get("#workspace-tab-templates").click();
          await wait(() => !get("#templates-workspace").hidden && document.querySelector(".template-item"),
            `${workspace} template list`);
          get(".template-item").click();
          get('#templates-workspace [data-role="apply"]').click();
          await wait(() => !get(panel).hidden && document.querySelector(`${panel} .direct-point`) &&
            !get(`${panel} [data-role="apply"]`).disabled, `${workspace} template opened`);
          await frames();
          const templatePosition = point().style.left;

          get("#workspace-tab-perspective").click();
          get("#more-options").click(); get(`#workspace-menu-${workspace}`).click();
          await frames();
          check(point().style.left === templatePosition, `${workspace} template changed after leaving and re-entering`);

          generation += 1;
          send({ type: "selection-loading", generation, nodeIds: [payload.targetNodeId] });
          send({ type: "source", generation, payload });
          await wait(() => !get(`${panel} [data-role="apply"]`).disabled, `${workspace} template refresh`);
          await frames();
          check(point().style.left === templatePosition, `${workspace} source refresh replaced the template`);

          key(point(), "ArrowRight", { shiftKey: true }); await frames();
          check(point().style.left !== templatePosition, `${workspace} template edit did not move`);
          key(get(`${panel} [data-role="reset"]`), "z", { metaKey: true }); await frames();
          check(point().style.left === templatePosition, `${workspace} Undo did not restore the template baseline`);
          key(point(), "ArrowRight", { shiftKey: true }); await frames();
          get(`${panel} [data-role="reset"]`).click(); await frames();
          check(point().style.left === templatePosition, `${workspace} Reset did not restore the template baseline`);

          const seen = window.fixtureMessages.length;
          get(`${panel} [data-role="apply"]`).click();
          await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"),
            `${workspace} template publication`);
          const published = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload.task.spec;
          check(published.targetSize.width === 200 && published.targetSize.height === 160,
            `${workspace} template lost its current source dimensions`);
          if (workspace === "mesh") {
            check(published.mesh.subdivisions === 2 && published.mesh.vertices[4].warped.x === .37 &&
              published.mesh.vertices[4].warped.y === .62, "Mesh template lost its authored grid");
          } else {
            check(published.envelope.points[5].x === .38 && published.envelope.points[5].y === .42 &&
              published.anchors[0].id === "pin-6-6" && published.strokes[0].samples.length === 1,
            "Split Warp template lost its envelope, pin, or brush stroke");
          }
          send({ type: "apply-designer-complete", generation, targetNodeId: `${workspace}-result`, operation: "apply" });
        } else if (scenario === "designer-history") {
          const original = point().style.left;
          const button = point(), box = button.getBoundingClientRect();
          const x = box.left + box.width / 2, y = box.top + box.height / 2;
          const pointer = (type, px, buttons) => button.dispatchEvent(new PointerEvent(type, {
            clientX: px, clientY: y, pointerId: 7, buttons, bubbles: true,
          }));
          pointer("pointerdown", x, 1); pointer("pointermove", x + 8, 1);
          await frames(); const moved = point().style.left;
          check(moved !== original, `${workspace} pointer preview did not move`);
          pointer("pointerup", x + 8, 0);
          key(get(`${panel} [data-role="reset"]`), "z", { metaKey: true });
          await wait(() => point().style.left === original, `${workspace} Undo committed drag`);
          key(get(`${panel} [data-role="reset"]`), "z", { metaKey: true, shiftKey: true });
          await wait(() => point().style.left === moved, `${workspace} Redo committed drag`);
          get(`${panel} [data-role="back"]`).click();
          get("#more-options").click(); get(`#workspace-menu-${workspace}`).click();
          await frames(); check(point().style.left === moved, `${workspace} round trip discarded draft`);
        } else if (scenario === "designer-refresh") {
          const original = point().style.left;
          key(point(), "ArrowRight", { shiftKey: true }); await frames();
          const edited = point().style.left;
          check(edited !== original, `${workspace} edit did not render`);
          generation += 1;
          send({ type: "selection-loading", generation, nodeIds: [payload.targetNodeId] });
          check(get(`${panel} [data-role="apply"]`).disabled, `${workspace} allowed output during source refresh`);
          send({ type: "source", generation, payload }); await frames();
          await wait(() => !get(`${panel} [data-role="apply"]`).disabled, `${workspace} refresh complete`);
          check(point().style.left === edited, `${workspace} pixel refresh discarded the draft`);
          key(get(`${panel} [data-role="reset"]`), "z", { metaKey: true }); await frames();
          check(point().style.left === original, `${workspace} refresh discarded Undo`);
          key(get(`${panel} [data-role="reset"]`), "z", { metaKey: true, shiftKey: true }); await frames();
          check(point().style.left === edited, `${workspace} refresh discarded Redo`);
        } else if (scenario === "designer-publication") {
          const encode = HTMLCanvasElement.prototype.toBlob;
          let release;
          HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
            encode.call(this, blob => { release = () => callback(blob); }, ...args);
          };
          const seen = window.fixtureMessages.length;
          get(`${panel} [data-role="apply"]`).click();
          await wait(() => release, `${workspace} encoding output`);
          // Back remains usable while encoding. A late output must not publish
          // after the user has left, or get relabeled as a later selection.
          get(`${panel} [data-role="back"]`).click();
          await refresh({ ...payload, sourceNodeId: `next-${workspace}`, targetNodeId: undefined });
          HTMLCanvasElement.prototype.toBlob = encode;
          release(); await frames(); await delay();
          check(!window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"),
            `${workspace} published after leaving during encoding`);
          continue;
        } else {
          get(`${panel} [data-role="back"]`).click();
          const inset = { ...spec, destination: { space: "normalized", quad: {
            tl: { x: .2, y: .1 }, tr: { x: .8, y: .1 }, br: { x: .8, y: .9 }, bl: { x: .2, y: .9 },
          } } };
          await refresh({ ...payload, spec: inset, sourceNodeId: `projected-${workspace}`, targetNodeId: undefined });
          get("#more-options").click(); get(`#workspace-menu-${workspace}`).click();
          await frames();
          const canvasBox = get(`${panel} canvas`).getBoundingClientRect();
          const handleBox = point().getBoundingClientRect();
          const u = workspace === "mesh" ? .25 : 1 / 3;
          const visibleX = (handleBox.left + handleBox.width / 2 - canvasBox.left) / canvasBox.width;
          check(Math.abs(visibleX - (.2 + .6 * u)) < .005,
            `${workspace} handle is detached from the projected artwork: ${visibleX}`);
        }
        get(`${panel} [data-role="back"]`).click();
      }
    } else if (scenario === "selection-entry") {
      const state = get("#selection-state");
      const visible = node => node.getBoundingClientRect().height > 0;
      generation++;
      send({ type: "selection-loading", generation, nodeIds: [] });
      send({ type: "selection-error", generation, message: { key: "selectOneSource" } });
      check(visible(state) && visible(get(".selection-demo")) && get("#controls").hidden,
        "Empty selection did not replace the previous editor with visual guidance");
      check(state.getAttribute("role") === "status" && get("#selection-detail").textContent.includes("Figma canvas"),
        "Empty selection is an alarm or does not identify where to select content");
      check(!state.querySelector('button:not([hidden]), input, [tabindex]'), "Decorative guidance presents a fake control");
      send({ type: "locale", preference: "zh-CN", locale: "zh-CN" });
      check(get("#selection-title").textContent === "从你的设计开始" && get("#selection-continue").textContent.includes("继续调整"),
        "Empty state or result reopening guidance did not localize");
      generation++;
      send({ type: "selection-loading", generation, nodeIds: ["next"] });
      check(!visible(get(".selection-demo")) && visible(get(".selection-spinner")) && get("#selection-detail").hidden,
        "Loading retained the onboarding illustration or duplicated its message");
      send({ type: "selection-error", generation, message: { key: "nativeResultChanged" },
        nativeRecovery: { nodeId: "next", expected: "fingerprint" } });
      check(state.getAttribute("role") === "alert" && !visible(get(".selection-spinner")) &&
        get("#selection-detail").textContent.includes("恢复已保存的变形"), "Error lost its actual recovery instructions");
      const detail = get("#selection-detail").getBoundingClientRect(), button = get("#native-recover").getBoundingClientRect();
      check(button.top >= detail.bottom && button.bottom <= innerHeight, "Recovery button overlaps its instruction or is clipped");
      get("#native-recover").focus(); get("#native-recover").click();
      await wait(() => window.fixtureMessages.some(m => m.type === "restore-native" && m.nodeId === "next" && m.expected === "fingerprint"),
        "recovery reaching the existing restore boundary");
      send({ type: "selection-error", generation, message: { key: "webglRequired" } });
      check(get("#selection-title").textContent === "暂时无法显示预览" && get("#native-recover").hidden,
        "Device failure incorrectly asks for a different selection or retains an unrelated repair action");
      send({ type: "locale", preference: "en", locale: "en" });
      await refresh();
      check(!visible(state) && !get("#controls").hidden && !get("#apply").disabled,
        "Selecting valid content after an error did not restore the editor");
    } else if (scenario === "projective-edge-quality") {
      const pattern = document.createElement("canvas"); pattern.width = 650; pattern.height = 813;
      const ctx = pattern.getContext("2d"); ctx.fillStyle = "rgb(246,246,248)"; ctx.fillRect(0, 0, 650, 813);
      ctx.fillStyle = "#271911"; ctx.fillRect(100, 100, 450, 610);
      ctx.fillStyle = "#dfac18"; ctx.fillRect(200, 200, 250, 410);
      const encoded = c => Uint8Array.from(atob(c.toDataURL().split(",")[1]), ch => ch.charCodeAt(0));
      const quad = { tl: { x: 0, y: 0 }, tr: { x: .9625748502994014, y: .09375 },
        br: { x: 1, y: .9583333333333334 }, bl: { x: .09880239520958084, y: 1 } };
      await refresh({ ...payload, bytes: encoded(pattern), renderWidth: 668, renderHeight: 768,
        placement: { x: 0, y: 0, width: 668, height: 768 }, spec: { ...spec, destination: { space: "normalized", quad } } });
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type !== "request-source-raster") return;
        const fresh = document.createElement("canvas"); fresh.width = request.desiredWidth; fresh.height = request.desiredHeight;
        fresh.getContext("2d").drawImage(pattern, 0, 0, fresh.width, fresh.height);
        send({ type: "source-raster", generation, requestId: request.requestId, bytes: encoded(fresh) });
      });
      get("#action-apply-copy").click();
      await wait(() => window.fixtureMessages.some(m => m.type === "apply"), "edge quality export");
      const result = window.fixtureMessages.findLast(m => m.type === "apply").payload;
      const bitmap = await createImageBitmap(new Blob([result.bytes], { type: "image/png" }));
      const sample = document.createElement("canvas"); sample.width = bitmap.width; sample.height = bitmap.height;
      const pixels = sample.getContext("2d"); pixels.drawImage(bitmap, 0, 0); bitmap.close();
      const data = pixels.getImageData(0, 0, sample.width, sample.height).data;
      let bad = 0, checked = 0;
      for (let x = 180; x < sample.width - 90; x++) {
        const t = (x / sample.width - quad.bl.x) / (quad.br.x - quad.bl.x);
        const bottom = (quad.bl.y + t * (quad.br.y - quad.bl.y)) * sample.height;
        for (let y = Math.floor(bottom) - 2; y <= Math.floor(bottom); y++) {
          const i = (y * sample.width + x) * 4;
          if (data[i + 3] < 128) continue;
          checked++;
          if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 242) bad++;
        }
      }
      check(checked > 1000 && bad === 0, `Solid pale border contains ${bad} colored/dark pixels among ${checked} edge samples`);
      for (const content of [
        { fit: "stretch", orientation: "flipHorizontal" },
        { fit: "stretch", orientation: "flipVertical" },
        { fit: "stretch", warp: { preset: "arc", amount: .25 } },
      ]) {
        await refresh({ ...payload, nativeTarget: undefined, bytes: encoded(pattern), renderWidth: 668, renderHeight: 768,
          placement: { x: 0, y: 0, width: 668, height: 768 },
          spec: { ...spec, destination: { space: "normalized", quad }, content } });
        const start = window.fixtureMessages.length;
        get("#action-apply-copy").click();
        await wait(() => window.fixtureMessages.slice(start).some(m => m.type === "apply"), "flipped/warped edge export");
        const next = window.fixtureMessages.slice(start).find(m => m.type === "apply").payload;
        const image = await createImageBitmap(new Blob([next.bytes], { type: "image/png" }));
        sample.width = image.width; sample.height = image.height; pixels.drawImage(image, 0, 0); image.close();
        const d = pixels.getImageData(0, 0, sample.width, sample.height).data;
        let edgeCount = 0, colored = 0; const examples = [];
        for (let y = 1; y < sample.height - 1; y++) for (let x = 1; x < sample.width - 1; x++) {
          const i = (y * sample.width + x) * 4;
          if (d[i + 3] < 128 || ![i - 4, i + 4, i - sample.width * 4, i + sample.width * 4].some(n => d[n + 3] < 16)) continue;
          edgeCount++;
          if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 242) { colored++; if (examples.length < 12) examples.push([x,y,...d.slice(i,i+4)]); }
        }
        check(edgeCount > 500 && colored === 0, `${JSON.stringify(content)}: ${colored} colored pixels among ${edgeCount} boundary pixels; ${JSON.stringify(examples)}`);
        send({ type: "apply-complete", generation, operation: "apply", targetNodeId: "edge-image" });
      }
    } else if (scenario === "late-native-renderer") {
      const pending = { ...payload, nativeRenderer: undefined, nativeRendererPending: true };
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["result"] });
      send({ type: "source", generation, payload: pending });
      await wait(() => !get("#action-apply-copy").disabled, "HD ready during optional discovery");
      check(get("#apply").disabled && get("#apply").title.includes("Preparing"), "Pending Frame availability is misleading");
      get("#mode-rectify").click();
      await wait(() => !get("#action-apply-copy").disabled, "image correction during renderer discovery");
      check(get("#action-apply-editable").disabled && get("#action-apply-editable").title.includes("Warp or Correct"),
        "Unavailable editing mode misleadingly promises a pending editable output");
      get("#mode-distort").click();
      await wait(() => !get("#action-apply-copy").disabled, "return to pending editable mode");
      const before = label(); corner().focus(); key(corner(), "ArrowRight");
      await wait(() => label() !== before, "draft during optional discovery");
      const draft = label();
      const announce = (g, target = "result") => send({ type: "source-renderer", generation: g,
        sourceNodeId: "content", targetNodeId: target, renderer: payload.nativeRenderer });
      announce(generation - 1); announce(generation, "other");
      check(get("#apply").disabled, "Late or unrelated availability enabled native output");
      announce(generation);
      await ready(); check(label() === draft, "Optional availability reset the transform draft");
      // Same message can precede async image decoding and must survive it.
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["result"] });
      send({ type: "source", generation, payload: pending });
      announce(generation);
      await ready(); check(label() === draft, "Early availability lost the retained draft");
    } else if (scenario === "hd-source-reuse") {
      let requests = 0, fail = false, held, hold = false;
      let color = "#eabe55";
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type !== "request-source-raster") return;
        requests += 1;
        const answer = () => {
          if (fail) { send({ type: "source-raster-error", generation: request.generation, requestId: request.requestId,
            message: { key: "sourceExportTimedOut" } }); return; }
          const fresh = document.createElement("canvas"); fresh.width = request.desiredWidth; fresh.height = request.desiredHeight;
          const ctx = fresh.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, fresh.width, fresh.height);
          ctx.clearRect(0, 0, 10, 10); ctx.fillStyle = "rgba(18,51,69,.4)"; ctx.fillRect(0, 30, fresh.width, 10);
          const pixels = Uint8Array.from(atob(fresh.toDataURL().split(",")[1]), ch => ch.charCodeAt(0));
          send({ type: "source-raster", generation: request.generation, requestId: request.requestId, bytes: pixels });
        };
        if (hold) held = answer; else answer();
      });
      const publish = async () => {
        const start = window.fixtureMessages.length;
        get("#action-apply-copy").click();
        await wait(() => window.fixtureMessages.slice(start).some(m => m.type === "apply"), "HD publication");
        const result = window.fixtureMessages.slice(start).find(m => m.type === "apply").payload;
        send({ type: "apply-complete", generation, operation: "apply", targetNodeId: "new-image" }); await ready();
        return result;
      };
      const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      const cold = await publish(), warm = await publish();
      check(requests === 1 && equal(cold.bytes, warm.bytes), "Repeated HD output re-exported its source or changed pixels");
      await refresh(); color = "#145ad4";
      const changed = await publish();
      check(requests === 2 && !equal(cold.bytes, changed.bytes), "Source refresh reused stale HD pixels");
      get("#mode-transform").click(); await ready();
      get("#scale-x").value = "150"; get("#scale-x").dispatchEvent(new Event("input", { bubbles: true }));
      get("#scale-x").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => get("#output-size-flow").textContent.includes("600"), "larger output preview"); await ready();
      const larger = await publish();
      check(requests === 3 && larger.renderWidth === 600, "A larger output reused undersized source pixels");
      const largerAgain = await publish();
      check(requests === 3 && equal(larger.bytes, largerAgain.bytes), "Larger output failed exact reuse");
      await refresh(); fail = true;
      get("#action-apply-copy").click(); await wait(() => requests === 4 && !get("#apply").disabled, "failed export recovery");
      fail = false; await publish(); check(requests === 5, "Failed source raster was cached");
      await refresh(); hold = true;
      const start = window.fixtureMessages.length;
      get("#action-apply-copy").click(); await wait(() => held, "pending source read");
      await refresh(); held(); hold = false;
      await new Promise(resolve => setTimeout(resolve, 100));
      check(!window.fixtureMessages.slice(start).some(m => m.type === "apply"), "Obsolete HD job published after refresh");
      await publish(); check(requests === 7, "Late source pixels poisoned the fresh cache");
    } else if (scenario === "fixed-preview-labels") {
      const labels = ["#source-name", "#output-size"];
      const metrics = () => labels.map(selector => {
        const element = get(selector), bounds = element.getBoundingClientRect(), css = getComputedStyle(element);
        const parent = get("#editor").getBoundingClientRect();
        return { left: bounds.left - parent.left, bottom: parent.bottom - bounds.bottom,
          width: bounds.width, height: bounds.height, font: css.fontSize };
      });
      for (const theme of ["figma-light", "figma-dark"]) {
        document.documentElement.className = theme;
        for (const selector of labels) {
          const css = getComputedStyle(get(selector));
          check(css.textShadow === "none", `${selector} has blurred text shadows`);
          check(css.backgroundColor.startsWith("rgb("), `${selector} lacks an opaque backdrop over artwork`);
        }
        key(document.body, "0", { metaKey: true });
        const fitted = metrics();
        key(document.body, "1", { metaKey: true });
        await wait(() => get("#zoom-level").textContent === "100%", "100% preview zoom");
        check(JSON.stringify(metrics()) === JSON.stringify(fitted), "Preview zoom scaled or moved fixed labels");
      }
    } else if (scenario === "native-publication-undo") {
      get("#mode-transform").click(); await ready();
      get("#scale-x").value = "110";
      get("#scale-x").dispatchEvent(new Event("input", { bubbles: true }));
      get("#scale-x").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => get("#output-size-flow").textContent.includes("440"), "scaled output"); await ready();
      const published = await apply();
      send({ type: "apply-complete", generation, operation: "replace", targetNodeId: payload.targetNodeId });
      await refresh({ ...payload, ...published });
      // Desktop replays the browser text-history command before the plugin
      // shortcut, even when the number field no longer owns keyboard focus.
      get("#apply").focus();
      for (const inputType of ["historyUndo", "historyRedo"]) {
        const stale = new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });
        get("#scale-x").dispatchEvent(stale);
        check(stale.defaultPrevented, "A blurred field consumed document Undo/Redo");
        get("#scale-x").value = "9";
        get("#scale-x").dispatchEvent(new InputEvent("input", { inputType, bubbles: true }));
        check(get("#scale-x").value === "110", "A Desktop input-only history replay changed a blurred field");
      }
      undo();
      await wait(() => window.fixtureMessages.some(message => message.type === "trigger-undo"), "host Undo after own replacement refresh");
      get("#scale-x").focus();
      const typingUndo = new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true });
      get("#scale-x").dispatchEvent(typingUndo);
      check(!typingUndo.defaultPrevented, "The focused field lost its native text Undo");
      get("#scale-x").value = "100";
      get("#scale-x").dispatchEvent(new InputEvent("input", { inputType: "historyUndo", bubbles: true }));
      check(get("#scale-y").value === "100", "Focused text Undo did not update the linked recipe");
    } else if (scenario === "native-output-limits") {
      const raster = { ...payload, nativeTarget: undefined, renderWidth: 4000, renderHeight: 3200,
        placement: { x: 0, y: 0, width: 2000, height: 1600 } };
      await refresh(raster);
      get("#mode-transform").click(); await ready();
      get("#scale-x").value = "110";
      get("#scale-x").dispatchEvent(new Event("input", { bubbles: true }));
      get("#scale-x").dispatchEvent(new Event("change", { bubbles: true })); await ready();
      await wait(() => get("#output-size-flow").textContent.includes("4400"), "scaled HD dimensions");
      get("#more-options").click(); get("#output-policy-original").click();
      check(get("#apply").disabled, "Over-limit original-density image should be blocked");
      check(!get("#action-apply-editable").disabled, "HD raster policy blocked an in-bounds editable Frame");
      get("#action-apply-editable").click();
      await wait(() => window.fixtureMessages.some(message => message.type === "apply-native"), "native output independent of HD density");
      const native = window.fixtureMessages.findLast(message => message.type === "apply-native").payload;
      check(native.renderWidth <= 4096 && native.placement.width === 2200, "Native output changed logical bounds");
      send({ type: "apply-complete", generation, operation: "apply", targetNodeId: "native-copy" });
      get("#more-options").click(); get("#output-policy-fit").click();
      await refresh({ ...payload, targetNodeId: "large-native", renderWidth: 3000, renderHeight: 2400,
        placement: { x: 0, y: 0, width: 3000, height: 2400 } });
      get("#mode-transform").click(); await ready();
      get("#scale-x").value = "150";
      get("#scale-x").dispatchEvent(new Event("input", { bubbles: true }));
      get("#scale-x").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => get("#output-size-flow").textContent.includes("9000") && !get("#action-apply-copy").disabled, "fitted HD output");
      check(get("#action-apply-editable").disabled && get("#apply").disabled,
        "Raster fitting enabled an editable Frame larger than the native host limit");
    } else if (scenario === "output-workflow") {
      const perspective = structuredClone(payload);
      perspective.spec.destination.quad.tr = { x: .85, y: .1 };
      await refresh(perspective);
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type !== "request-source-raster") return;
        const fresh = document.createElement("canvas"); fresh.width = request.desiredWidth; fresh.height = request.desiredHeight;
        fresh.getContext("2d").drawImage(canvas, 0, 0, fresh.width, fresh.height);
        const pixels = Uint8Array.from(atob(fresh.toDataURL().split(",")[1]), character => character.charCodeAt(0));
        send({ type: "source-raster", generation: request.generation, requestId: request.requestId, bytes: pixels });
      });
      const publish = async (button, type, duplicate, operation) => {
        const start = window.fixtureMessages.length;
        check(!get(button).disabled && !get(button).hidden, `Unavailable output ${button}`);
        get(button).click();
        await wait(() => window.fixtureMessages.slice(start).some(message => message.type === type), `${button} -> ${type}`);
        const value = window.fixtureMessages.slice(start).find(message => message.type === type).payload;
        check(Boolean(value.duplicate) === duplicate, `${button} used wrong creation/replacement semantics`);
        if (type === "apply") {
          const png = await createImageBitmap(new Blob([value.bytes], { type: "image/png" }));
          check(png.width === value.renderWidth && png.height === value.renderHeight, "Encoded PNG disagrees with its saved dimensions");
          png.close();
        }
        send({ type: "apply-complete", generation, operation, targetNodeId: "published" });
        await wait(() => !get("#apply").disabled || !get("#action-apply-copy").disabled, "ready after publication"); return value;
      };
      // From a native result: update, independent Frame copy, independent HD image.
      check(get("#apply").textContent === "Update Frame", "Native replacement label");
      await publish("#apply", "apply-native", false, "replace");
      await publish("#action-apply-editable", "apply-native", true, "apply");
      const hd = await publish("#action-apply-copy", "apply", true, "apply");
      check(hd.renderWidth === 400 && hd.renderHeight === 320 && hd.placement.width === 200, "HD export lost 2x density or logical size");
      // Close/reopen equivalent: a new selection loads saved geometry and HD pixels.
      const raster = { ...payload, ...hd, bytes, targetNodeId: "hd-result" };
      delete raster.nativeTarget; delete raster.duplicate;
      await refresh(raster);
      check(get("#apply").textContent === "Update HD Image", "HD replacement label");
      for (let i = 0; i < 2; i++) {
        const updated = await publish("#apply", "apply", false, "replace");
        check(updated.renderWidth === 400 && updated.renderHeight === 320, "Repeated reopen increased raster density");
        check(JSON.stringify(updated.spec) === JSON.stringify(hd.spec), "Reopen double-applied the saved mapping");
        await refresh({ ...raster, ...updated, bytes });
      }
      await publish("#action-apply-copy", "apply", true, "apply");
      await publish("#action-apply-editable", "apply-native", true, "apply");
      // An original exposes just the two output types; it has no replacement.
      const original = { ...payload, sourceNodeId: "original" };
      delete original.targetNodeId; delete original.nativeTarget; delete original.spec;
      await refresh(original);
      check(get("#action-apply-copy").hidden && get("#apply").textContent === "New HD Image", "Original exposed a replacement or redundant image action");
      const first = await publish("#apply", "apply", false, "apply");
      check(first.renderWidth === 400 && !first.targetNodeId, "Original did not produce a fresh HD image");
      await publish("#action-apply-editable", "apply-native", true, "apply");
      // Optional effect availability and non-projective edits never block HD.
      await refresh({ ...original, nativeRenderer: undefined });
      const unavailable = get("#action-apply-editable");
      check(unavailable.getAttribute("aria-disabled") === "true" && !unavailable.disabled &&
        !get("#native-guidance").hidden &&
        get("#native-guidance").textContent.includes("HD images still work") &&
        !get("#copy-effect-listing").hidden &&
        unavailable.getAttribute("aria-describedby") === "native-guidance",
        "Unavailable native output hid its focusable recovery guidance");
      const nativeCalls = window.fixtureMessages.filter(message => message.type === "apply-native").length;
      unavailable.focus();
      check(document.activeElement === unavailable, "Unavailable editable output is not keyboard-reachable");
      unavailable.click();
      await wait(() => get("#status").textContent.length > 0, "Unavailable editable activation gave no feedback");
      check(window.fixtureMessages.filter(message => message.type === "apply-native").length === nativeCalls,
        "Unavailable editable activation attempted publication");
      check(!get("#apply").disabled, "Missing native effect blocked raster delivery");
      await publish("#apply", "apply", false, "apply");
      await refresh(payload);
      get("#mode-warp").click(); await ready();
      get("#warp-preset").value = "arc";
      get("#warp-preset").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => get("#action-apply-editable").disabled && !get("#action-apply-copy").disabled, "Warp raster-only outputs");
      const warped = await publish("#apply", "apply", false, "apply");
      check(Boolean(warped.spec.content.warp), "HD copy lost Warp");
      const warpAmount = get("#warp-amount").value;
      get("#apply").focus(); get("#warp-amount").value = "9";
      get("#warp-amount").dispatchEvent(new InputEvent("input", { inputType: "historyUndo", bubbles: true }));
      check(get("#warp-amount").value === warpAmount, "Blurred Warp history changed the published draft");
      await refresh({ ...original, sourceNodeId: "correction-source" });
      get("#mode-rectify").click(); await ready();
      for (const [id, value] of [["#rectify-width", "640"], ["#rectify-height", "320"]]) {
        get(id).value = value; get(id).dispatchEvent(new Event("input", { bubbles: true }));
      }
      const corrected = await publish("#apply", "apply", false, "apply");
      check(corrected.renderWidth === 640 && corrected.renderHeight === 320 && corrected.rectification,
        "Correct lost its explicitly entered pixel dimensions");
      const reads = window.fixtureMessages.filter(m => m.type === "request-source-raster").length;
      const correctedAgain = await publish("#apply", "apply", false, "apply");
      check(window.fixtureMessages.filter(m => m.type === "request-source-raster").length === reads &&
        corrected.bytes.length === correctedAgain.bytes.length && corrected.bytes.every((v, i) => v === correctedAgain.bytes[i]),
        "Repeated Correct output re-read its source or changed pixels");
      get("#apply").focus(); get("#rectify-width").value = "9";
      get("#rectify-width").dispatchEvent(new InputEvent("input", { inputType: "historyUndo", bubbles: true }));
      check(get("#rectify-width").value === "640", "Blurred Correct history changed the published draft");
    } else if (scenario === "pending-distort-commit" || scenario === "unpainted-distort-commit") {
      await moveCorner(); const first = label();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      corner().focus();
      corner().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      if (scenario === "pending-distort-commit") {
        await wait(() => label() !== first, "held arrow paints before release");
      }
      // Real keyup can arrive after the edit has painted. A host refresh in
      // that turn must not cancel the still-queued history commit.
      corner().dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
      await refresh();
      const second = label(); check(second !== first, "Refresh discarded the final corner edit");
      undo(); await wait(() => label() === first, "undo released edit across immediate refresh");
      await ready(); key(document.activeElement, "z", { metaKey: true, shiftKey: true });
      await wait(() => label() === second, "redo released edit across immediate refresh");
    } else if (scenario === "content-history") {
      await moveCorner(); const first = label(); await moveCorner(); const second = label();
      await refresh(); check(label() === second, "Pixel refresh moved the draft");
      undo(); await wait(() => label() === first, "undo after content refresh");
    } else if (scenario === "transform-controls") {
      get("#mode-transform").click(); await ready();
      for (const [id, value] of [["#rotation", "17"], ["#scale-x", "125"]]) {
        get(id).value = value; get(id).dispatchEvent(new Event("input", { bubbles: true }));
        get(id).dispatchEvent(new Event("change", { bubbles: true })); await ready();
      }
      await refresh();
      check(get("#rotation").value === "17" && get("#scale-x").value === "125", "Refresh reset affine controls");
      undo(); await wait(() => get("#scale-x").value === "100", "undo scale"); await ready();
      check(get("#rotation").value === "17", "Undo discarded the previous rotation");
      key(document.activeElement, "z", { metaKey: true, shiftKey: true });
      await wait(() => get("#scale-x").value === "125", "redo scale"); await ready();
      const published = await apply();
      check(published.placement.width > 250 && published.placement.height > 200, "Apply lost the retained composition");
    } else if (scenario === "dogfood-tasks") {
      // The roadmap's six designer dogfood tasks as one continuous working
      // session: screen placement, rotated poster, skewed label, repeated
      // package face, arced logo, and source replacement.
      const setNumber = async (id, value) => {
        get(id).value = value; get(id).dispatchEvent(new Event("input", { bubbles: true }));
        get(id).dispatchEvent(new Event("change", { bubbles: true })); await ready();
      };
      const selectSource = async (next, name) => {
        try { await refresh(next); } catch (error) {
          const errorBox = get("#error");
          throw new Error(`${name} selection: ${error.message}; apply=${get("#apply").disabled} error=${errorBox.hidden ? "none" : errorBox.textContent.slice(0, 90)} lastMessages=${window.fixtureMessages.slice(-4).map(m => m.type).join(",")}`);
        }
        // ready() only waits for Apply; the selection itself must land first.
        await wait(() => get("#source-name").textContent.includes(name), `${name} selection loaded`);
      };
      // This page applies many times; every wait must count only new messages,
      // and a click that lands during an in-flight compose is silently
      // swallowed and retried. A click is only repeated when the button never
      // disabled for it: an accepted publication disables its input soon, and
      // re-clicking then could start a second publication that the single
      // completion reply can never unblock.
      const publishWithRetry = async (selector, type, task) => {
        const seen = window.fixtureMessages.length;
        const arrived = () => window.fixtureMessages.slice(seen).some(m => m.type === type);
        const publish = () => {
          const button = get(selector);
          const describe = `${selector} disabled=${button.disabled} error=${get("#error").hidden ? "none" : get("#error").textContent.slice(0, 90)}`;
          check(performance.now() < deadline, `${task} ${type} never published (${describe})`);
          if (!button.disabled && button.getAttribute("aria-disabled") !== "true") button.click();
        };
        const deadline = performance.now() + 5000;
        while (!arrived()) {
          publish();
          const swallowWindow = performance.now() + 1000;
          while (!arrived() && !get(selector).disabled && performance.now() < swallowWindow) await delay(50);
          while (!arrived() && get(selector).disabled) await delay(50);
        }
        return window.fixtureMessages.findLast(m => m.type === type).payload;
      };
      const applyNative = task => publishWithRetry("#action-apply-editable", "apply-native", task);
      const complete = () => send({ type: "apply-complete", generation, operation: "apply", targetNodeId: "result" });

      // Task 1 - screen placement: Distort corners pulled into a receding plane.
      get("#mode-distort").click(); await ready();
      const cornerLabels = {};
      const nudgeCorner = async (id, direction) => {
        const labelOf = () => get(`[data-corner="${id}"]`).getAttribute("aria-label");
        for (let step = 0; step < 12; step++) {
          const before = labelOf();
          key(get(`[data-corner="${id}"]`), direction);
          await wait(() => labelOf() !== before, `${id} nudge ${step} reflected`);
        }
        cornerLabels[id] = labelOf();
      };
      // Pull the top corners inward and the bottom corners outward: a screen
      // receding behind its frame. The applied spec re-normalizes to the
      // result's tight bounds, so the trapezoid is asserted in that space.
      await nudgeCorner("tl", "ArrowRight");
      await nudgeCorner("tr", "ArrowLeft");
      await nudgeCorner("br", "ArrowRight");
      await nudgeCorner("bl", "ArrowLeft");
      const screen = await applyNative("screen"); complete(); await ready();
      const screenQuad = screen.spec.destination.quad;
      check(screenQuad.tl.x > screenQuad.bl.x + 0.02 && screenQuad.tr.x < screenQuad.br.x - 0.02,
        `Screen placement did not produce a receding trapezoid: applied ${JSON.stringify(screenQuad)} labels ${JSON.stringify(cornerLabels)}`);
      check(screen.placement.width > 200,
        `Tight bounds did not grow for the outward bottom corners: ${screen.placement.width}`);

      // Task 4 - repeated package face: the last transform applied to the next
      // source. Transform Again stays reachable from the Distort mode a fresh
      // selection opens in.
      await selectSource({ ...payload, sourceNodeId: "package-face-b", targetNodeId: undefined, sourceName: "Package face B" }, "Package face B");
      get("#more-options").click();
      check(!get("#settings-popover").hidden, "More popover did not open for Transform Again");
      // Transform Again stages the repeat into the editor; publish follows
      // through the primary editable action like any other draft.
      get("#action-transform-again").click();
      await ready();
      const repeat = await applyNative("repeat"); complete(); await ready();
      check(JSON.stringify(repeat.spec) === JSON.stringify(screen.spec),
        "Transform Again rebased incorrectly for the same-size source");

      // Task 2 - rotated poster: numeric 17 degree rotation, center pivot.
      await selectSource({ ...payload, sourceNodeId: "poster", targetNodeId: undefined, sourceName: "Poster" }, "Poster");
      get("#mode-transform").click(); await ready();
      await setNumber("#rotation", "17");
      const poster = await applyNative("poster"); complete(); await ready();
      const posterQuad = poster.spec.destination.quad;
      // The applied quad is tight-bounds normalized; measure in that space.
      const px = corner => ({ x: corner.x * poster.placement.width, y: corner.y * poster.placement.height });
      const P = { tl: px(posterQuad.tl), tr: px(posterQuad.tr), br: px(posterQuad.br), bl: px(posterQuad.bl) };
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const topAngle = Math.abs(Math.atan2(P.tr.y - P.tl.y, P.tr.x - P.tl.x));
      check(Math.abs(topAngle - 17 * Math.PI / 180) < 0.02,
        `Rotated poster top edge is ${(topAngle * 180 / Math.PI).toFixed(1)} degrees instead of 17; quad ${JSON.stringify(posterQuad)} placement ${JSON.stringify(poster.placement)} rotationInput ${get("#rotation").value}`);
      check(Math.abs(dist(P.tl, P.tr) - 200) < 0.5 && Math.abs(dist(P.tl, P.bl) - 160) < 0.5 &&
        Math.abs(dist(P.tl, P.br) - dist(P.tr, P.bl)) < 0.5, "Rotation changed the poster's side lengths");

      // Task 3 - skewed label: skew X only, horizontal edges stay horizontal.
      await selectSource({ ...payload, sourceNodeId: "label", targetNodeId: undefined, sourceName: "Label" }, "Label");
      get("#mode-transform").click(); await ready();
      await setNumber("#skew-x", "12");
      const labelPayload = await applyNative("label");
      const labelSpec = labelPayload.spec; complete(); await ready();
      const skewed = labelSpec.destination.quad;
      check(Math.abs(skewed.tl.y - skewed.tr.y) < 1e-6 && Math.abs(skewed.bl.y - skewed.br.y) < 1e-6,
        "Skewed label did not keep horizontal edges");
      const lean = (skewed.tl.x - skewed.bl.x) * labelPayload.placement.width;
      check(Math.abs(Math.abs(lean) - Math.tan(12 * Math.PI / 180) * 160) < 1.5,
        `Skewed label leans ${lean.toFixed(1)} px instead of ${(Math.tan(12 * Math.PI / 180) * 160).toFixed(1)} px`);

      // Task 5 - arced logo: Warp preset through the primary image route; a
      // Warp operation cannot publish editable output, so on native-capable
      // files the primary Apply must stay the HD route instead of disabling.
      await selectSource({ ...payload, sourceNodeId: "logo", targetNodeId: undefined, sourceName: "Logo" }, "Logo");
      // HD density reacquisition asks the host for a denser source export;
      // answer it like the edge-quality scenario does.
      const rasterEncode = canvas => Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), character => character.charCodeAt(character));
      const rasterAnswer = event => {
        const request = event.data?.pluginMessage;
        if (request?.type !== "request-source-raster") return;
        const fresh = document.createElement("canvas");
        fresh.width = request.desiredWidth; fresh.height = request.desiredHeight;
        const freshContext = fresh.getContext("2d");
        freshContext.fillStyle = "#10466f"; freshContext.fillRect(0, 0, fresh.width, fresh.height);
        freshContext.fillStyle = "#ffd166"; freshContext.fillRect(fresh.width / 4, fresh.height / 4, fresh.width / 2, fresh.height / 2);
        send({ type: "source-raster", generation, requestId: request.requestId, bytes: rasterEncode(fresh) });
      };
      addEventListener("message", rasterAnswer);
      get("#mode-warp").click(); await ready();
      get("#warp-preset").value = "arc";
      get("#warp-preset").dispatchEvent(new Event("change", { bubbles: true }));
      get("#warp-amount").value = "25";
      get("#warp-amount").dispatchEvent(new Event("input", { bubbles: true }));
      get("#warp-amount").dispatchEvent(new Event("change", { bubbles: true })); await ready();
      get("#warp-mesh-continue").click();
      await wait(() => !get("#mesh-workspace").hidden &&
        get('#mesh-workspace [data-role="subdivisions"]').value === "16",
        "Warp continue did not seed the Arc preset as a 16×16 mesh");
      get("#workspace-tab-perspective").click();
      await wait(() => !get("#controls").hidden, "return from Mesh");
      get("#more-options").click();
      get("#workspace-menu-surface").click();
      await wait(() => !get("#surface-workspace").hidden &&
        get('#surface-workspace [data-role="patches"]').value === "1x1" &&
        get('#surface-workspace [data-role="subdivisions"]').value === "12",
        "Split Warp did not open a 1×1 envelope on a 12×12 mesh");
      get("#workspace-tab-perspective").click();
      await wait(() => !get("#controls").hidden, "return from Split Warp");
      await ready();
      const arced = await publishWithRetry("#apply", "apply", "arced"); complete(); await ready();
      check(arced.spec.content.warp && arced.spec.content.warp.preset === "arc" &&
        Math.abs(arced.spec.content.warp.amount - 0.25) < 1e-6, "Arced logo lost its Warp preset or amount");
      check(arced.bytes.length > 0, "Arced logo published no output");
      // After a Warp HD publication the footer keeps the primary HD route and
      // never offers editable output for an operation that cannot publish it.
      check(get("#apply").disabled === false && (get("#action-apply-editable").disabled ||
        get("#action-apply-editable").getAttribute("aria-disabled") === "true"),
        "Footer offered editable output for a published Warp");
      // Reopen the arced result alone and update it in place: the saved Warp
      // must survive the round trip (the arc draft lives in content.warp,
      // while the Distort tab legitimately shows the unchanged rectangle).
      // A published HD image is a raster result: no native target to reopen.
      const arcedResult = { ...payload, sourceNodeId: "logo", targetNodeId: "arced-result",
        spec: arced.spec, placement: arced.placement, sourceName: "Logo" };
      delete arcedResult.nativeTarget;
      await selectSource(arcedResult, "Logo");
      check(get("#apply").textContent === "Update HD Image", "Reopened Warp result lost its update action");
      const arcedUpdate = await publishWithRetry("#apply", "apply", "arced-update");
      send({ type: "apply-complete", generation, operation: "replace", targetNodeId: "arced-result" });
      await ready();
      check(arcedUpdate.spec.content.warp && arcedUpdate.spec.content.warp.preset === "arc" &&
        Math.abs(arcedUpdate.spec.content.warp.amount - 0.25) < 1e-6,
        `Updating the reopened Warp result lost its arc: ${JSON.stringify(arcedUpdate.spec.content)}`);
      removeEventListener("message", rasterAnswer);

      // Task 6 - source replacement: select the saved result with new source
      // pixels; the reopened operation must republish the same placement.
      await selectSource({ ...payload, sourceNodeId: "replacement", sourceName: "Replacement artwork",
        spec: screen.spec, placement: screen.placement }, "Replacement artwork");
      const replaced = await applyNative("replaced"); complete();
      check(JSON.stringify(replaced.spec) === JSON.stringify(screen.spec),
        "Replacement republished a different placement");
    } else {
      await moveCorner(); const draft = label();
      key(document.activeElement, "1", { metaKey: true });
      const latest = structuredClone(spec); latest.destination.quad.tr = { x: .8, y: .1 };
      await refresh({ ...payload, spec: latest });
      check(label() !== draft, "External update revived the stale draft");
      check(document.body.innerText.includes("100%"), "Refresh reset manual zoom");
      const published = await apply();
      check(JSON.stringify(published.spec) === JSON.stringify(latest), "Apply overwrote the external operation");
      // Complete the simulated publication before testing ordinary local Undo.
      send({ type: "apply-error", generation, message: { key: "nativeApplyFailed" } });
      await ready(); undo(); await wait(() => label() === draft, "recover displaced local draft");
    }
    check(window.fixtureErrors.length === 0, window.fixtureErrors.join("\n"));
    window.__WORLDBEND_PARITY__ = { passed: scenario };
  } catch (error) {
    window.__WORLDBEND_PARITY__ = { error: error.stack ?? String(error) };
  }
}
