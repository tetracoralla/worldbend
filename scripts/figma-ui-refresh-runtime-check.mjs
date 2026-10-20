import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
  const sceneBundle = await build({ configFile: false, logLevel: "silent", build: {
    write: false, minify: "esbuild", lib: { entry: path.join(root, "packages/figma/src/ready-scenes.ts"),
      name: "FixtureReadyScenes", formats: ["iife"] },
  } });
  const sceneCode = (Array.isArray(sceneBundle) ? sceneBundle[0] : sceneBundle).output.find(entry => entry.type === "chunk").code;
  const boundaryBundles=await Promise.all([
    ["native-vector-operation.ts","FixtureVector"],["messages.ts","FixtureMessages"],
  ].map(async([entry,name])=>{const bundle=await build({configFile:false,logLevel:"silent",build:{write:false,minify:"esbuild",
    lib:{entry:path.join(root,"packages/figma/src",entry),name,formats:["iife"]}}});
    return (Array.isArray(bundle)?bundle[0]:bundle).output.find(part=>part.type==="chunk").code;}));
  const bootstrap = `<script>
    ${boundaryBundles.join("\n")}
    window.fixtureVector=FixtureVector;window.fixtureMessageGuard=FixtureMessages.isUiToMainMessage;
    ${sceneCode}
    window.fixtureReadyScenes = FixtureReadyScenes.readySceneRecords();
    if(new URL(location.href).searchParams.get("case")==="composition-motion")Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true});
    window.fixtureMessages = [];
    window.fixtureErrors = [];
    if (new URL(location.href).searchParams.get("case") === "psd-curve-import-fallback") {
      window.Worker = class { constructor() { throw new DOMException("Worker refused", "SecurityError"); } };
    }
    if (new URL(location.href).searchParams.get("case") === "psd-curve-import-worker-refused") {
      window.Worker = class extends EventTarget {
        constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event("error"))); }
        postMessage() {}
        terminate() {}
      };
    }
    addEventListener('error', event => window.fixtureErrors.push(event.message));
    addEventListener('unhandledrejection', event => window.fixtureErrors.push(String(event.reason)));
    addEventListener('message', event => {
      const message = event.data?.pluginMessage;
      if(message?.type==="apply-native-vector"&&!window.fixtureMessageGuard(message))window.fixtureErrors.push("Invalid actual Native Vector apply message");
      if(message?.type==="apply-designer"&&!window.fixtureMessageGuard(message))window.fixtureErrors.push("Invalid actual designer apply message");
      if (message) window.fixtureMessages.push(message);
    });
    if (window.parent !== window) window.parent.addEventListener('message', event => {
      const message = event.data?.pluginMessage;
      if (event.source === window && message) window.fixtureMessages.push(message);
    });
  </script>`;
  const fixture = `<script>(${runFixture.toString()})();</script>`;
  const html = ui.replace("<head>", `<head>${bootstrap}`).replace("</body>", `${fixture}</body>`);
  const needsGeometry = process.argv.length === 2 || process.argv.includes("fitted-authoring") || process.argv.includes("native-shape-fit");
  const geometryFiles = new Map(await Promise.all((needsGeometry ? await readdir(path.join(root, "packages/web/dist")) : [])
    .filter(name => name.endsWith(".js")).map(async name => ["/geometry/" + name,
      await readFile(path.join(root, "packages/web/dist", name))])));
  server = createServer((request, response) => {
    const geometry = geometryFiles.get(request.url);
    if (geometry) { response.writeHead(200, {"Content-Type":"text/javascript"}); response.end(geometry); return; }
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    const url = new URL(request.url, "http://localhost");
    response.end(url.pathname === "/host" ? `<!doctype html><style>
      *{box-sizing:border-box}body{margin:0}#host{width:100vw;height:100vh;overflow:hidden}
      header{height:40px}iframe{display:block;border:0;width:100vw;height:100vh}
      </style><div id="host"><header>Figma host title</header><iframe src="${escapeHtmlAttribute('/'+url.search)}"></iframe></div>
      <script>(${runHostFixture.toString()})();</script>` : html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  browser = await launchChrome(await findChrome(), ["--window-size=820,660"]);
  const scenarios = ["content-history", "pending-distort-commit", "unpainted-distort-commit", "transform-controls", "external-operation", "output-workflow", "native-output-limits", "native-publication-undo", "native-vector-status", "fixed-preview-labels", "late-native-renderer", "hd-source-reuse", "projective-edge-quality", "selection-entry", "designer-workflows", "designer-history", "designer-publication", "designer-projection", "designer-refresh", "workpiece-continuation", "designer-template", "surface-authoring", "liquify-brush", "deformation-plane-roundtrip", "linked-batch", "fit-to-shape", "appearance-workspace", "texture-workspace", "card-workspace", "designer-experience", "spatial-workspace", "mockup-agent-conflict", "composition-continuation", "scene-draft", "linked-results", "visual-footer"];
  scenarios.push("composition-motion");
  scenarios.push("foil-workspace");
  scenarios.push("linked-dependencies");
  scenarios.push("native-linked-batch");
  scenarios.push("canvas-continuation");
  scenarios.push("canvas-names");
  scenarios.push("composition-publication-undo");
  scenarios.push("workspace-publication-undo");
  scenarios.push("deformation-published-view");
  scenarios.push("task-action-switch");
  scenarios.push("spatial-agent-continuation");
  scenarios.push("composition-layer-warp");
  scenarios.push("composition-surfaces");
  scenarios.push("ready-scene-previews");
  scenarios.push("warp-precision");
  scenarios.push("preset-effects");
  scenarios.push("fitted-authoring");
  scenarios.push("native-shape-fit");
  scenarios.push("preview-drag-chrome");
  scenarios.push("host-visible-layout");
  scenarios.push("unchanged-raster-fidelity");
  scenarios.push("deformation-hd-output");
  scenarios.push("output-families");
  scenarios.push("nonlinear-vector-flow");
  scenarios.push("pointer-release-compat");
  scenarios.push("native-source-view");
  scenarios.push("native-output-position");
  scenarios.push("transform-control-commit-queue");
  scenarios.push("free-outline");
  scenarios.push("psd-curve-import");
  scenarios.push("psd-curve-import-fallback");
  scenarios.push("psd-curve-import-worker-refused");
  const requested = process.argv.slice(2);
  for (const scenario of requested) assert(scenarios.includes(scenario), `Unknown Figma UI scenario: ${scenario}`);
  const pageIds = async () => (await (await fetch(`${browser.debugUrl}/json/list`)).json())
    .filter(target => target.type === "page").map(target => target.id);
  const initialPageIds = new Set(await pageIds());
  let releasedPages = 0;
  for (const scenario of requested.length ? requested : scenarios) {
    // Window size includes Chrome's own chrome even in headless mode. Set the
    // content viewport explicitly to cover the laptop-sized initial UI before inputs.
    const target = await createPage(browser.debugUrl, "about:blank");
    let scenarioError;
    try {
      const result = await readPageResult(target.webSocketDebuggerUrl, {
      width: 820, height: 660, focus: true, url: `http://127.0.0.1:${address.port}/${scenario === "host-visible-layout" ? "host" : ""}?case=${scenario}&width=820`,
      trustedInput: ["preview-drag-chrome","pointer-release-compat","foil-workspace","composition-motion","free-outline"].includes(scenario), timeoutMs: ["preview-drag-chrome","pointer-release-compat","composition-motion"].includes(scenario) ? 60_000 : 30_000,
      screenshotDirectory: process.env.WORLDBEND_FIGMA_DRAG_EVIDENCE,
      });
      assert(!result.error, `${scenario}: ${result.error}`);
    } catch (error) { scenarioError = error; throw error; }
    finally {
      // Each page owns a WASM instance and can retain focused animation work.
      // Retire only this scenario's page before the next case starts.
      try {
        const response = await fetch(`${browser.debugUrl}/json/close/${encodeURIComponent(target.id)}`);
        assert(response.ok, `Could not close owned fixture page: ${response.status}`);
        const deadline = Date.now() + 5000;
        while ((await pageIds()).includes(target.id) && Date.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 20));
        assert((await pageIds()).every(id => initialPageIds.has(id)), "Fixture pages accumulated between scenarios");
        releasedPages++;
      } catch (error) {
        if (scenarioError) throw new AggregateError([scenarioError, error], `${scenario}: scenario and page cleanup failed`);
        throw error;
      }
    }
    console.log(`Built Figma UI refresh passed: ${scenario}`);
  }
  console.log(`Figma UI fixture pages released: ${releasedPages}; remaining pages: ${(await pageIds()).length}`);
  const compactScenarios = requested.length
    ? requested.filter((name) => name.startsWith("psd-curve-import") || ["selection-entry", "designer-experience", "native-vector-status", "visual-footer", "appearance-workspace", "texture-workspace", "foil-workspace", "card-workspace", "preset-effects", "workpiece-continuation", "linked-dependencies", "native-linked-batch", "composition-layer-warp", "composition-surfaces", "composition-motion", "ready-scene-previews", "canvas-names", "preview-drag-chrome", "free-outline", "task-action-switch"].includes(name))
    : ["selection-entry", "designer-experience", "native-vector-status", "visual-footer", "appearance-workspace", "texture-workspace", "foil-workspace", "card-workspace", "preset-effects", "workpiece-continuation", "linked-dependencies", "native-linked-batch", "composition-layer-warp", "composition-surfaces", "composition-motion", "ready-scene-previews", "canvas-names", "preview-drag-chrome", "free-outline", "task-action-switch", "psd-curve-import"];
  if ((!requested.length || requested.includes("output-families"))) compactScenarios.push("output-families");
  if ((!requested.length || requested.includes("pointer-release-compat"))) compactScenarios.push("pointer-release-compat");
  if ((!requested.length || requested.includes("host-visible-layout")) && !compactScenarios.includes("host-visible-layout")) compactScenarios.push("host-visible-layout");
  for (const scenario of compactScenarios) {
    // Plugin windows shrink to Figma's 300 px minimum; the selection entry
    // must survive that width too, not only the comfortable default.
    const compact = await launchChrome(await findChrome(), ["--window-size=300,520"]);
    try {
      // Chrome clamps its window to 500 px; set the content viewport before
      // navigation so this really exercises Figma's narrower plugin surface.
      const target = await createPage(compact.debugUrl, "about:blank");
      const result = await readPageResult(target.webSocketDebuggerUrl, {
        width: 300, height: 520, focus: true, url: `http://127.0.0.1:${address.port}/${scenario === "host-visible-layout" ? "host" : ""}?case=${scenario}&width=300`,
        screenshotDirectory: process.env.WORLDBEND_FIGMA_DRAG_EVIDENCE,
        trustedInput: ["preview-drag-chrome","pointer-release-compat","foil-workspace","composition-motion","free-outline"].includes(scenario), timeoutMs: ["preview-drag-chrome","pointer-release-compat","composition-motion"].includes(scenario) ? 60_000 : 30_000,
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

// Vite's programmatic build can retain its esbuild service after this one-shot
// probe has closed every resource it owns. Flush the observable result, then
// exit explicitly so a successful check cannot stall the enclosing gate.
await new Promise((resolve) => process.stdout.write("", resolve));
process.exit(0);

// Figma can crop the inner iframe below its native title while leaving
// innerHeight unchanged. Standalone browser viewports cannot catch that.
async function runHostFixture() {
  const check = (value, message) => { if (!value) throw Error(message); };
  const wait = async predicate => {
    const deadline = performance.now() + 10000;
    while (!predicate()) {
      if (performance.now() > deadline) throw Error("Host viewport did not settle");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    const frame = document.querySelector("iframe"), host = document.querySelector("#host");
    await wait(() => frame.contentWindow.__WORLDBEND_PARITY__);
    const inner = frame.contentWindow, doc = frame.contentDocument;
    check(!inner.__WORLDBEND_PARITY__.error, inner.__WORLDBEND_PARITY__.error);
    const initialHeight = inner.innerHeight;
    const assertVisible = async (height, width = inner.innerWidth) => {
      await wait(() => doc.body.clientHeight === height && doc.body.clientWidth === width);
      await new Promise(resolve => inner.requestAnimationFrame(() => inner.requestAnimationFrame(resolve)));
      for (const selector of ["#apply", "#action-apply-editable", "#reset", ".window-resize"]) {
        const box = doc.querySelector(selector).getBoundingClientRect();
        check(box.top >= 0 && box.bottom <= height + 1 && box.left >= 0 && box.right <= doc.body.clientWidth + 1,
          `${selector} clipped at visible ${doc.body.clientWidth}x${height}: ${JSON.stringify(box)}`);
      }
      check(doc.body.scrollWidth <= doc.body.clientWidth, "Host viewport scrolls horizontally");
    };
    await assertVisible(initialHeight - 40);
    // A native horizontal resize changes both the iframe's width and its
    // visible width equally: the intersection ratio can stay unchanged.
    if (inner.innerWidth > 380) {
      const initialWidth = inner.innerWidth;
      host.style.width = frame.style.width = `${initialWidth - 80}px`;
      await assertVisible(initialHeight - 40, initialWidth - 80);
      host.style.width = frame.style.width = "100vw";
      await assertVisible(initialHeight - 40, initialWidth);
    }
    const corner = doc.querySelector('[data-corner="tl"]');
    const draft = corner.getAttribute("aria-label");
    inner.dispatchEvent(new inner.MessageEvent("message", {data:{pluginMessage:{type:"locale",preference:"zh-CN",locale:"zh-CN"}}}));
    await assertVisible(initialHeight - 40);
    host.style.height = `${initialHeight - 60}px`;
    await assertVisible(initialHeight - 100);
    check(inner.innerHeight === initialHeight, "Fixture resized the iframe instead of clipping it");
    host.style.height = `${initialHeight}px`;
    await assertVisible(initialHeight - 40);
    check(corner.getAttribute("aria-label").match(/x ([\d.]+)%/)[1] === draft.match(/x ([\d.]+)%/)[1], "Host resize changed the transform draft");
    window.__WORLDBEND_PARITY__ = {passed:"host-visible-layout",visibleHeight:doc.body.clientHeight,iframeHeight:initialHeight};
  } catch (error) { window.__WORLDBEND_PARITY__ = {error:error.stack ?? String(error)}; }
}

async function runFixture() {
  const delay = () => new Promise(resolve => setTimeout(resolve, 10));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (predicate, label, timeoutMs = 5000) => {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(`Timed out: ${label}; global=${document.querySelector("#error-text")?.textContent}; messages=${window.fixtureMessages.slice(-4).map(m=>m.type).join(",")}`);
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
  const send = message => {
    if(message.type==="native-vector-projection"){
      const request=window.fixtureMessages.findLast(item=>item.type==="request-native-vector-projection"&&item.payload.generation===message.generation)?.payload;
      if(!request)throw Error("Missing actual native projection request");
      message={...message,sourceFingerprint:message.sourceFingerprint?.startsWith("source32x2:")?message.sourceFingerprint:"source32x2:100:0123456789abcdef",sourceView:{policy:"logical",bounds:message.inputs[0].sourceBounds},
        operationExpected:window.fixtureVector.nativeVectorOperationDigest(request.operation??{kind:"transform",spec:request.spec})};
    }
    dispatchEvent(new MessageEvent("message", { data: { pluginMessage: message } }));
  };
  const ready = () => wait(() => !get("#apply").disabled, "ready to apply");
  try {
    const expectedWidth = new URL(location.href).searchParams.get("width");
    if (expectedWidth) {
      check(innerWidth === Number(expectedWidth), `Expected ${expectedWidth}px viewport, received ${innerWidth}px`);
      const expectedHeight = Number(expectedWidth) === 300 ? 520 : 660;
      check(innerHeight === expectedHeight, `Expected ${expectedHeight}px viewport height, received ${innerHeight}px`);
    }
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
      nativeFrameSource: true, vectorSource: true, artworkSource: true,
      nativeRenderer: { id: "fixture", propertyIds: Array.from({ length: 9 }, (_, i) => String(i)), extentPropertyIds: ["9", "10"] } };
    const scenario = new URL(location.href).searchParams.get("case");
    // The real Figma boundary re-exports source pixels for HD publication.
    // Cases with custom capture/recovery assertions supply their own response.
    if (!["workpiece-continuation", "native-shape-fit", "deformation-plane-roundtrip", "canvas-names",
      "canvas-continuation", "unchanged-raster-fidelity", "projective-edge-quality", "hd-source-reuse",
      "native-vector-status", "output-workflow", "warp-precision", "designer-workflows", "deformation-hd-output"].includes(scenario)) {
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type !== "request-source-raster") return;
        const fresh = document.createElement("canvas"); fresh.width = request.desiredWidth; fresh.height = request.desiredHeight;
        fresh.getContext("2d").drawImage(canvas, 0, 0, fresh.width, fresh.height);
        send({ type: "source-raster", generation: request.generation, requestId: request.requestId,
          bytes: Uint8Array.from(atob(fresh.toDataURL().split(",")[1]), character => character.charCodeAt(0)) });
      });
    }
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
      const previous=window.fixtureMessages.filter(message=>message.type==="apply-native").length;
      get("#apply").click();
      await wait(() => window.fixtureMessages.filter(message=>message.type==="apply-native").length>previous, "new native apply");
      return window.fixtureMessages.findLast(message => message.type === "apply-native").payload;
    };
    if (scenario === "pointer-release-compat") {
      // Trusted browser press/release, with a separate injected anomalous MOVE.
      // This is compatibility evidence, not an ordinary-human event trace.
      const input = async (method, params) => {
        window.__WORLDBEND_INPUT_DONE__ = false; window.__WORLDBEND_INPUT__ = { method, params };
        await wait(() => window.__WORLDBEND_INPUT_DONE__, "trusted compatibility input");
      };
      const mouse = (type, point) => input("Input.dispatchMouseEvent", { type, ...point,
        button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
      const center = node => { const b=node.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2}; };
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const settle = async () => { await frames(); await wait(()=>get(".worldbend-editor").getAnimations({subtree:true}).every(animation=>animation.playState!=="running"),"settled compatibility artwork"); await frames(); };
      let pointerId;
      addEventListener("pointerdown", event => { pointerId=event.pointerId; }, true);
      const zero = (node, point) => node.dispatchEvent(new PointerEvent("pointermove", {
        ...{clientX:point.x,clientY:point.y},pointerId,buttons:0,bubbles:true,
      }));
      const fresh = { ...payload, targetNodeId:undefined, nativeTarget:undefined, nativeRenderer:undefined,
        nativeFrameSource:undefined, vectorSource:undefined, artworkSource:undefined };
      await refresh({...fresh,sourceNodeId:"distort-compat"});
      get("#mode-distort").click(); await ready(); await settle();
      const handle=get('[data-corner="tl"]'), p=center(handle), label=handle.getAttribute("aria-label");
      await mouse("mousePressed",p);
      window.dispatchEvent(new PointerEvent("pointerup", {pointerId:pointerId+1000,pointerType:"touch",isPrimary:true}));
      window.dispatchEvent(new MouseEvent("mouseup", {button:0,clientX:p.x+80,clientY:p.y+60}));
      check(get(".worldbend-editor").dataset.dragging==="true","Foreign compatibility mouseup ended Distort ownership");
      zero(handle,{x:p.x+80,y:p.y+60});
      check(handle.getAttribute("aria-label")===label&&get(".worldbend-editor").dataset.dragging==="true",
        "No-button Distort hover changed geometry or ended ownership");
      await mouse("mouseReleased",{x:p.x+5,y:p.y+4});
      await wait(()=>handle.getAttribute("aria-label")!==label&&!get(".worldbend-editor").dataset.dragging,"Distort final release"); await ready();

      await refresh({...fresh,sourceNodeId:"transform-compat"});
      get("#mode-transform").click(); await ready(); await settle();
      const scale=get("#scale-x").value, transformHandle=get('[data-corner="br"]'), t=center(transformHandle);
      await mouse("mousePressed",t); zero(get("#editor"),{x:t.x+80,y:t.y+60});
      check(get("#scale-x").value===scale&&get(".worldbend-editor").dataset.dragging==="true",
        `No-button Transform hover changed the recipe or ended ownership: ${JSON.stringify({scale,before:get("#scale-x").value,dragging:get(".worldbend-editor").dataset.dragging,hit:document.elementFromPoint(t.x,t.y)?.className})}`);
      await mouse("mouseReleased",{x:t.x+5,y:t.y+4});
      await wait(()=>get("#scale-x").value!==scale&&!get(".worldbend-editor").dataset.dragging,"Transform final release"); await ready();

      get("#mode-distort").click(); await ready(); await settle();
      const mount=get("#editor"), element=get(".worldbend-editor"), labels=()=>["tl","tr","br","bl"].map(id=>get(`[data-corner="${id}"]`).getAttribute("aria-label"));
      const geometry=JSON.stringify(labels()), camera=element.style.transform;
      get('[data-corner="tr"]').focus();
      await input("Input.dispatchKeyEvent",{type:"rawKeyDown",key:" ",code:"Space",windowsVirtualKeyCode:32});
      const pan=center(mount); await mouse("mousePressed",pan); zero(mount,{x:pan.x+100,y:pan.y+80});
      check(element.style.transform===camera&&mount.dataset.panning==="true",`No-button pan hover moved or ended camera ownership: ${JSON.stringify({pan:mount.dataset.pan,panning:mount.dataset.panning,before:camera,after:element.style.transform})}`);
      await mouse("mouseReleased",{x:pan.x+12,y:pan.y+8});
      check(!mount.dataset.panning&&element.style.transform!==camera&&JSON.stringify(labels())===geometry,"Pan lost its release endpoint or changed geometry");
      await input("Input.dispatchKeyEvent",{type:"keyUp",key:" ",code:"Space",windowsVirtualKeyCode:32});

      await refresh({...fresh,sourceNodeId:"mesh-compat"}); get("#workspace-tab-mesh").click();
      const mesh=get("#mesh-workspace"), meshApply=mesh.querySelector('[data-role="apply"]');
      await wait(()=>!mesh.hidden&&!meshApply.disabled&&mesh.querySelector('.direct-point'),"Mesh compatibility entry");
      const point=mesh.querySelector('.direct-point'), m=center(point), position=point.style.left, pixels=mesh.querySelector("canvas").toDataURL();
      await mouse("mousePressed",m);
      const ownedPointer=point.dataset.activePointerId, foreign=mesh.querySelectorAll('.direct-point')[1];
      foreign.dispatchEvent(new PointerEvent("pointerdown", {pointerId:pointerId+1000,pointerType:"touch",button:0,buttons:1,bubbles:true}));
      point.dispatchEvent(new PointerEvent("pointerdown", {pointerId:Number(ownedPointer),button:2,buttons:2,bubbles:true}));
      check(point.dataset.activePointerId===ownedPointer&&!foreign.dataset.activePointerId,
        "A foreign or secondary-button press replaced the Mesh owner");
      // Synthetic foreign presses are not the host's active mouse pointer.
      pointerId=Number(ownedPointer);
      zero(point,{x:m.x+80,y:m.y+60});
      check(point.style.left===position,"No-button Mesh hover moved the point");
      await mouse("mouseReleased",{x:m.x+5,y:m.y+4});
      await wait(()=>point.style.left!==position&&!meshApply.disabled&&mesh.querySelector("canvas").toDataURL()!==pixels,"Mesh final release pixels");
      const committedPosition=point.style.left, nextGrab=center(point);
      await mouse("mousePressed",nextGrab);
      await mouse("mouseMoved",{x:nextGrab.x+4,y:nextGrab.y+3});
      await wait(()=>point.style.left!==committedPosition,"Mesh cancellable pointer preview");
      await input("Input.dispatchKeyEvent",{type:"rawKeyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
      await input("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
      await mouse("mouseReleased",{x:nextGrab.x+8,y:nextGrab.y+6});
      await wait(()=>point.style.left===committedPosition&&!meshApply.disabled,"Mesh Escape origin restoration");
      check(!mesh.hidden&&!point.dataset.activePointerId,"Escape left the workspace or retained a stale point owner");
      const seen=window.fixtureMessages.length; meshApply.click();
      await wait(()=>window.fixtureMessages.slice(seen).some(message=>message.type==="apply-designer"),"Mesh compatibility publication");
      const meshOutput=window.fixtureMessages.findLast(message=>message.type==="apply-designer").payload;
      check(meshOutput.task.spec.meshEdits.length===1,"Mesh final release was not retained in the published task");
      send({type:"apply-designer-complete",generation,targetNodeId:"mesh-output",operation:"apply"});

      await refresh({...fresh,sourceNodeId:"brush-compat"}); get("#workspace-tab-surface").click();
      const pin=get("#surface-workspace"), pinApply=pin.querySelector('[data-role="apply"]');
      await wait(()=>!pin.hidden&&!pinApply.disabled&&pin.querySelector('.direct-point'),"Pin compatibility entry");
      pin.querySelector('[data-role="tool-liquify"]').click(); await frames();
      const canvas=pin.querySelector("canvas"), b=canvas.getBoundingClientRect(), start={x:b.left+b.width*.4,y:b.top+b.height*.4}, before=canvas.toDataURL();
      await mouse("mousePressed",start); zero(canvas,{x:start.x+80,y:start.y+60}); await frames();
      check(canvas.toDataURL()===before,"No-button brush hover painted a stroke");
      await mouse("mouseReleased",{x:start.x+6,y:start.y});
      await wait(()=>!pinApply.disabled&&canvas.toDataURL()!==before,"Liquify final release pixels");
      const brushSeen=window.fixtureMessages.length; pinApply.click();
      await wait(()=>window.fixtureMessages.slice(brushSeen).some(message=>message.type==="apply-designer"),"Liquify compatibility publication");
      const brushOutput=window.fixtureMessages.findLast(message=>message.type==="apply-designer").payload;
      check(brushOutput.task.spec.liquify.strokes.length===1&&brushOutput.task.spec.liquify.strokes[0].samples.length===1,
        "Brush lost or duplicated the real release sample");
      send({type:"apply-designer-complete",generation,targetNodeId:"brush-output",operation:"apply"});

      // Brush capture may be refused for a host-delivered pointer. Exercise a
      // dropped-UP recovery, foreign input, cancellation, and the next normal
      // stroke through the built canvas/task publication boundary.
      await refresh({...fresh,sourceNodeId:"brush-recovery"});
      await wait(()=>!pin.hidden&&!pinApply.disabled,"Brush recovery source");
      pin.querySelector('[data-role="tool-liquify"]').click(); await frames();
      const recoveryBox=canvas.getBoundingClientRect(), rx=recoveryBox.left+recoveryBox.width*.4,
        ry=recoveryBox.top+recoveryBox.height*.4;
      const brushPointer=(type,offset,buttons,id=71)=>canvas.dispatchEvent(new PointerEvent(type,{
        clientX:rx+offset,clientY:ry,pointerId:id,pointerType:"mouse",button:0,buttons,bubbles:true,
      }));
      brushPointer("pointerdown",0,1); brushPointer("pointermove",4,1); await frames();
      brushPointer("pointermove",80,0); // No release: next press owns recovery.
      brushPointer("pointerdown",4,1); brushPointer("pointermove",8,1); await frames();
      brushPointer("pointerdown",20,1,72); brushPointer("pointercancel",80,0,72);
      brushPointer("pointercancel",80,0); await frames(); await frames();
      const retainedPixels=canvas.toDataURL();
      brushPointer("pointerdown",0,1); brushPointer("pointermove",4,1); await frames();
      key(pin.querySelector('[data-role="tool-liquify"]'),"Escape"); await frames(); await frames();
      check(!pin.hidden&&canvas.toDataURL()===retainedPixels,"Brush Escape did not restore the retained two-stroke draft");
      brushPointer("pointerdown",0,1); brushPointer("pointerup",4,0); await frames(); await frames();
      const recoveredSeen=window.fixtureMessages.length; pinApply.click();
      await wait(()=>window.fixtureMessages.slice(recoveredSeen).some(message=>message.type==="apply-designer"),"Recovered brush publication");
      const recovered=window.fixtureMessages.findLast(message=>message.type==="apply-designer").payload.task.spec.liquify.strokes;
      check(recovered.length===3&&recovered.every(stroke=>stroke.samples.length===1),
        "Missing-UP recovery, foreign cancellation or Escape lost/duplicated a completed brush stroke");
      check(window.fixtureErrors.length===0,`fixture errors: ${window.fixtureErrors.join("; ")}`);
    } else if(scenario==="nonlinear-vector-flow"){
      const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const plain={...payload,nativeTarget:undefined,nativeRenderer:undefined,targetNodeId:undefined,nativeVector:true};
      await refresh(plain);get("#workspace-tab-mesh").click();const mesh=get("#mesh-workspace"),role=n=>mesh.querySelector(`[data-role="${n}"]`);
      await wait(()=>!mesh.hidden&&!role("apply").disabled&&mesh.querySelector(".direct-point"),"native Mesh entry");
      key(mesh.querySelector('.direct-point[data-point-id="12"]')??mesh.querySelector('.direct-point'),"ArrowRight");await frames();
      check(!role("output-kind").hidden,"native output selector missing");role("output-kind").value="vector";role("output-kind").dispatchEvent(new Event("change",{bubbles:true}));
      check(role("apply").textContent==="New Native Vector","fresh native action mislabeled");
      const geometry=request=>({schema:"worldbend.vector-projection",version:"0.1",path:{vertices:[{x:0,y:0},{x:200,y:0},{x:200,y:160},{x:100,y:80},{x:0,y:160}],
        segments:Array.from({length:5},(_,i)=>({start:i,end:(i+1)%5})),regions:[{windingRule:"NONZERO",loops:[[0,1,2,3,4]]}]},
        sourceTransform:[1,0,0,0,1,0],sourceBounds:{x:0,y:0,width:200,height:160},homography:request.matrix,
        reference:{width:request.renderWidth,height:request.renderHeight},placement:{width:request.placement.width,height:request.placement.height},tolerancePx:.25});
      const publish=async()=>{const seen=window.fixtureMessages.length;role("apply").click();await wait(()=>window.fixtureMessages.slice(seen).some(m=>m.type==="request-native-vector-projection"),"complete native request");
        const request=window.fixtureMessages.findLast(m=>m.type==="request-native-vector-projection").payload;
        check(request.operation?.task?.kind==="deformation"&&request.operation.task.spec.meshEdits.length===1,"Mesh work truncated before projection");
        send({type:"native-vector-projection",generation:request.generation,inputs:[geometry(request)],placement:request.placement});
        await wait(()=>window.fixtureMessages.slice(seen).some(m=>m.type==="apply-native-vector"),"core nonlinear native apply");
        const output=window.fixtureMessages.findLast(m=>m.type==="apply-native-vector").payload;
        check(window.fixtureMessageGuard({type:"apply-native-vector",payload:output}),"native message violates actual Main admission");
        check(JSON.stringify(output.operation)===JSON.stringify(request.operation),"whole work changed at UI relay");return output;};
      const first=await publish();send({type:"apply-designer-complete",generation,targetNodeId:"nonlinear-vector",operation:"apply",vectorFidelity:{class:"outlined",reasons:["textOutlined"]}});await frames();
      check(!role("status").textContent.includes("Image applied")&&role("status").textContent.includes("outline"),"native completion claims image or hides outlined text");
      await refresh({...plain,task:first.operation.task,nativeVectorTarget:true,targetNodeId:"nonlinear-vector",targetPlacement:first.placement});
      await wait(()=>!mesh.hidden&&!role("apply").disabled,"cold owning Mesh reopen");check(role("output-kind").value==="vector"&&role("apply").textContent==="Update Native Vector","cold native family not retained");
      const second=await publish();check(second.targetNodeId==="nonlinear-vector"&&!second.duplicate&&JSON.stringify(second.operation)===JSON.stringify(first.operation),"cold native update changed carrier/controls");
      send({type:"apply-designer-complete",generation,targetNodeId:"nonlinear-vector",operation:"replace",vectorFidelity:{class:"exact",reasons:[]}});await frames();
      check(window.fixtureErrors.length===0,window.fixtureErrors.join("; "));
    } else if (scenario === "output-families") {
      const frame = get("#action-apply-editable"), vector = get("#action-apply-vector");
      const fresh = { ...payload, targetNodeId: undefined, nativeTarget: undefined, nativeVector: undefined };
      const publishFrame = async selected => {
        await refresh(selected);
        check(frame.textContent === "New Editable Frame" && !frame.disabled && !frame.hidden,
          "Mixed artwork promises a Vector instead of its live-content Frame");
        const seen = window.fixtureMessages.length;
        frame.click();
        await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-native"), "explicit Frame publication");
        check(!window.fixtureMessages.slice(seen).some(m => m.type === "request-native-vector-projection"),
          "Vector capability stole the explicit Frame request");
        send({ type: "apply-complete", generation, operation: "apply", targetNodeId: "new-frame" });
        await ready();
      };
      await publishFrame(fresh);
      check(vector.disabled, "Mixed artwork advertises unsupported native vectors");
      await publishFrame({ ...fresh, nativeVector: true });
      // Both capabilities: Frame and Vector are distinct requests, while Update
      // stays with the saved family even if its source supports both.
      await refresh({ ...fresh, nativeVector: true });
      const seen = window.fixtureMessages.length;
      vector.click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "request-native-vector-projection"), "explicit Vector request");
      check(!window.fixtureMessages.slice(seen).some(m => m.type === "apply-native"), "Vector request silently produced Frame");
      const request = window.fixtureMessages.findLast(m => m.type === "request-native-vector-projection").payload;
      const input = {schema:"worldbend.vector-projection",version:"0.1",path:{
        vertices:[{x:0,y:0},{x:200,y:0},{x:200,y:160},{x:0,y:160}],
        segments:[{start:0,end:1},{start:1,end:2},{start:2,end:3},{start:3,end:0}],
        regions:[{windingRule:"NONZERO",loops:[[0,1,2,3]]}]},
        sourceTransform:[1,0,0,0,1,0],sourceBounds:{x:0,y:0,width:200,height:160},
        homography:request.matrix,reference:{width:200,height:160},
        placement:{width:request.placement.width,height:request.placement.height},tolerancePx:.25};
      send({type:"native-vector-projection",generation:request.generation,inputs:[input],placement:request.placement,sourceFingerprint:"fixture-proof"});
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-native-vector"), "real core Vector publication");
      const projected = window.fixtureMessages.findLast(m => m.type === "apply-native-vector").payload.projection.outputs[0];
      check(projected.network.vertices.length===4, "Native Vector publication dropped actual geometry");
      send({type:"apply-complete",generation,operation:"apply",targetNodeId:"new-vector",vectorFidelity:{class:"exact",reasons:[]}});
      await ready();
      await refresh({ ...payload, nativeVector: true });
      const frameUpdateStart = window.fixtureMessages.length;
      get("#apply").click();
      await wait(() => window.fixtureMessages.slice(frameUpdateStart).some(m => m.type === "apply-native"), "Frame result Update retains family");
      check(!window.fixtureMessages.slice(frameUpdateStart).some(m => m.type === "request-native-vector-projection"), "Frame Update converted the saved result");
      send({type:"apply-complete",generation,operation:"replace",targetNodeId:payload.targetNodeId}); await ready();
      await refresh({ ...payload, nativeVector:true, nativeVectorTarget:true, nativeTarget:undefined });
      const vectorUpdateStart = window.fixtureMessages.length;
      get("#apply").click();
      await wait(() => window.fixtureMessages.slice(vectorUpdateStart).some(m => m.type === "request-native-vector-projection"), "Vector Update retains family");
      send({type:"native-vector-projection-error",generation,message:{key:"nativeVectorApplyFailed"}}); await ready();
      generation += 1;
      send({type:"selection-loading",generation,nodeIds:["stored-vector"]});
      send({type:"source",generation,payload:{...fresh,targetNodeId:"stored-vector",nativeVectorTarget:true}});
      await wait(() => get("#apply").textContent === "Update Native Vector" && get("#apply").disabled,
        "Unavailable Vector Update is not converted into a different family");
      check(!frame.disabled && !get("#action-apply-copy").disabled,
        "Unsupported Vector update trapped independent Frame/HD creation");
      await refresh({ ...fresh, nativeRenderer:undefined, nativeRendererPending:true });
      check(frame.disabled && frame.title.includes("Preparing"), "Pending companion advertises completed Frame access");
      await refresh({ ...fresh, nativeRenderer:undefined });
      check(frame.getAttribute("aria-disabled") === "true" && !frame.disabled && !frame.hidden && !get("#native-help").hidden,
        "Eligible mixed Frame lost keyboard-reachable companion recovery");
      check(!get("#apply").disabled && vector.disabled, "Missing companion changed HD or vector eligibility");
      send({type:"source-renderer",generation,sourceNodeId:fresh.sourceNodeId,renderer:payload.nativeRenderer});
      await wait(() => !frame.disabled && frame.getAttribute("aria-disabled") !== "true", "late companion enables Frame only");
      check(vector.disabled, "Late companion falsely enabled native vectors");
      await refresh({ ...fresh,nativeFrameSource:undefined,nativeRenderer:undefined,artworkSource:undefined,nativeVector:true });
      check(frame.hidden && !vector.disabled && get("#native-help").hidden, "Group/shape falsely promises a native-content Frame");
      send({ type:"locale", preference:"zh-CN", locale:"zh-CN" });
      check(vector.textContent === "新建原生矢量", "Vector choice lost localized identity");
      await refresh({ ...fresh, nativeVector:true });
      check(frame.textContent === "新建可编辑 Frame", "Frame choice lost localized identity");
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for(const button of [frame,vector,get("#apply")]) {
        const box=button.getBoundingClientRect();
        check(box.width > 0 && box.left>=0 && box.right<=innerWidth+1 && box.bottom<=innerHeight+1,
          "Output choice is clipped or unreachable at actual plugin width");
      }
      check(document.body.scrollWidth<=innerWidth, "Output choices introduce horizontal overflow");
      check(window.fixtureErrors.length===0, `Output family errors: ${window.fixtureErrors.join('; ')}`);
    } else if (scenario === "host-visible-layout") {
      await moveCorner();
    } else if (scenario === "deformation-hd-output") {
      const plain = { ...payload, nativeTarget: undefined, nativeRenderer: undefined, targetNodeId: undefined };
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const requests = [], publications = () => window.fixtureMessages.filter(m => m.type === "apply-designer");
      let fail = true, hold = false, held;
      const respond = request => {
        const fresh = document.createElement("canvas"); fresh.width = request.desiredWidth; fresh.height = request.desiredHeight;
        const ctx = fresh.getContext("2d"); ctx.scale(fresh.width/200, fresh.height/160);
        const gradient = ctx.createLinearGradient(0,0,200,160); gradient.addColorStop(0,"#14466b"); gradient.addColorStop(1,"#d85638");
        ctx.fillStyle=gradient; ctx.fillRect(0,0,200,160); ctx.fillStyle="white"; ctx.font="9px sans-serif";
        for(let i=0;i<10;i++) ctx.fillText("Dense text: source detail survives.",8,20+i*12);
        ctx.clearRect(170,0,30,16);
        const freshBytes=Uint8Array.from(atob(fresh.toDataURL().split(",")[1]),char=>char.charCodeAt(0));
        send(request.type==="export-batch-source"
          ? {type:"batch-source",generation:request.generation,batchRunId:request.batchRunId,requestId:request.requestId,
            resultNodeId:request.resultNodeId,nodeId:request.nodeId,
            bytes:freshBytes,renderWidth:fresh.width,renderHeight:fresh.height}
          : {type:"source-raster",generation:request.generation,requestId:request.requestId,bytes:freshBytes});
      };
      addEventListener("message",event=>{
        const request=event.data?.pluginMessage; if(request?.type!=="request-source-raster")return;
        requests.push(request); if(hold){held=request;return;}
        if(fail)send({type:"source-raster-error",generation:request.generation,requestId:request.requestId,message:{key:"sourceExportTimedOut"}});
        else respond(request);
      });
      await refresh(plain); get("#workspace-tab-mesh").click();
      const mesh = get("#mesh-workspace"), role = name => mesh.querySelector(`[data-role="${name}"]`);
      await wait(()=>!mesh.hidden&&!role("apply").disabled&&mesh.querySelector('.direct-point'),"Mesh entry");
      const point=mesh.querySelector('.direct-point[data-point-id="12"]')??mesh.querySelector('.direct-point');
      key(point,"ArrowRight",{shiftKey:true}); await frames();
      const preview=mesh.querySelector("canvas"), previewPixels=preview.toDataURL();
      role("apply").click(); await wait(()=>requests.length===1&&!role("error").hidden&&!role("apply").disabled,"failed capture recovery");
      check(publications().length===0&&preview.toDataURL()===previewPixels,"capture failure published or changed preview");
      fail=false; role("apply").click(); await wait(()=>publications().length===1,"HD Mesh publication");
      const first=publications()[0].payload;
      const pngSize=bytes=>({width:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16),height:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20)});
      check(first.renderWidth===400&&first.renderHeight===320&&pngSize(first.bytes).width===400&&pngSize(first.bytes).height===320,"HD PNG dimensions disagree");
      check(first.placement.width===200&&first.placement.height===160&&first.task.spec.targetSize.width===200,"HD pixels changed placement or work coordinates");
      check(requests[1].desiredWidth>400&&first.task.spec.meshEdits.length===1,"deformed density was not requested");
      send({type:"apply-designer-complete",generation,targetNodeId:"hd-result",operation:"apply"}); await frames();
      const warm=requests.length; role("apply").click(); await wait(()=>publications().length===2,"warm Mesh publication");
      check(requests.length===warm,"unchanged full source was exported again");
      send({type:"apply-designer-complete",generation,targetNodeId:"hd-result",operation:"apply"}); await frames();
      await refresh({...plain,task:first.task,targetNodeId:"hd-result",targetRasterSize:{width:400,height:320}});
      await wait(()=>!mesh.hidden&&!role("apply").disabled,"cold Mesh reopen"); role("apply").click();
      await wait(()=>publications().length===3,"cold HD update"); const cold=publications()[2].payload;
      check(cold.renderWidth===400&&cold.renderHeight===320&&JSON.stringify(cold.task)===JSON.stringify(first.task),"reopen doubled density or lost work");
      send({type:"apply-designer-complete",generation,targetNodeId:"hd-result",operation:"replace"}); await frames();
      get("#workspace-tab-surface").click(); const pin=get("#surface-workspace"), pinApply=pin.querySelector('[data-role="apply"]');
      await wait(()=>!pin.hidden&&!pinApply.disabled,"Pin view"); pinApply.click(); await wait(()=>publications().length===4,"Pin HD update");
      const pinOutput=publications()[3].payload;
      check(pinOutput.renderWidth===400&&pinOutput.renderHeight===320&&pinOutput.task.spec.meshEdits.length===1,"Pin view lost HD or mesh");
      send({type:"apply-designer-complete",generation,targetNodeId:"hd-result",operation:"replace"}); await frames();
      await refresh({...plain,sourceNodeId:"cancelled-art"}); get("#workspace-tab-mesh").click(); await wait(()=>!role("apply").disabled,"cancellable source");
      hold=true; role("apply").click(); await wait(()=>held,"pending source capture");
      await refresh({...plain,sourceNodeId:"next-art"}); respond(held); await frames();
      check(publications().length===4,"stale source export published after selection changed");
      const batchPublications=[];
      addEventListener("message",event=>{
        const request=event.data?.pluginMessage;
        if(request?.type==="prepare-linked-batch")send({type:"linked-batch",generation:request.generation,items:[{
          nodeId:"hd-result",name:"HD Mesh",revision:4,kind:"deformation",width:400,height:320,
          placement:{x:300,y:20,width:200,height:160},sourceNodeIds:["linked-art"],dependencyNodeIds:[],
          operationKind:"task",operationJson:JSON.stringify(first.task),batchRunId:1,
        }]});
        if(request?.type==="export-batch-source")respond(request);
        if(request?.type==="apply-linked-batch-item"){
          batchPublications.push(request.payload);
          send({type:"apply-complete",generation:request.payload.generation,batchResultId:request.payload.nodeId,
            batchRunId:request.payload.batchRunId,targetNodeId:"hd-result",operation:"replace"});
        }
      });
      await refresh({...plain,sourceNodeId:"linked-art",linkedResults:{total:1,items:[{
        nodeId:"hd-result",name:"HD Mesh",revision:4,kind:"deformation",position:{x:300,y:20},
      }]}});
      await wait(()=>!get("#linked-results-trigger").hidden&&!get("#linked-results-trigger").disabled,"HD linked refresh entry");
      get("#linked-results-trigger").click();get("#linked-batch-action").click();
      await wait(()=>batchPublications.length===1,"stored HD batch refresh");
      const batchOutput=batchPublications[0],batchSize=pngSize(batchOutput.bytes);
      check(batchSize.width===400&&batchSize.height===320&&batchOutput.renderWidth===400&&batchOutput.renderHeight===320,
        "linked refresh shrank the stored HD raster to work coordinates");
      check(JSON.stringify(batchOutput.storedOperation.task)===JSON.stringify(first.task),"linked HD refresh changed normalized work");
      check(window.fixtureMessages.some(m=>m.type==="export-batch-source"&&m.nodeId==="linked-art"&&m.desiredWidth>400),
        "linked HD refresh did not capture full source detail");
      check(window.fixtureErrors.length===0,`HD deformation errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "preset-effects") {
      check(get("#workspace-tab-perspective").getAttribute("aria-selected") === "true", "Presets displaced the default Perspective entry");
      const tabs=[...document.querySelectorAll('[role="tab"]')];
      check(tabs.indexOf(get("#workspace-tab-presets"))>tabs.indexOf(get("#workspace-tab-mesh")), "Presets precede the primary transform tools");
      const root=get("#presets-workspace"), role=name=>get(`#presets-workspace [data-role="${name}"]`);
      const amount=root.querySelector('input[type="range"]');
      const png=canvas.toDataURL("image/png").split(",")[1];
      let saved, original="native-artwork-v1";
      addEventListener("message",event=>{
        const m=event.data?.pluginMessage;
        if(m?.type==="request-preset-state")send({type:"preset-state",generation,node:{nodeId:"artwork",name:"My original",...(saved?{spec:saved,resultNodeId:"workpiece"}:{})}});
        if(m?.type==="request-preset-source")send({type:"preset-source",generation:m.generation,requestId:m.requestId,bytes:png,width:200,height:160,sourceState:original});
      });
      get("#workspace-tab-presets").click();
      await wait(()=>!root.hidden&&!role("apply").disabled,"selected-artwork static preview");
      check(root.querySelectorAll('[data-effect]').length===4,"Missing visible preset choices");
      const preview=root.querySelector("canvas");
      const first=preview.toDataURL();await new Promise(resolve=>setTimeout(resolve,100));
      check(preview.toDataURL()===first,"The static illustration animates without a designer action");
      const images=new Set();
      for(const id of ["pointer-tilt","idle-tilt","card-turn","fold-screen"]) {
        root.querySelector(`[data-effect="${id}"]`).click();
        await wait(()=>!role("apply").disabled,`${id} still`);
        images.add(preview.toDataURL());
        const pixels=preview.getContext("2d").getImageData(0,0,preview.width,preview.height).data;
        check(pixels.some((value,index)=>index%4===3&&value>0),`${id} preview is empty`);
        if(id==="fold-screen") {
          // This opaque fixture ends at the content plane. The lifted glass
          // extends above it; without a finish those UVs disappear and the
          // whole fold looks like an ordinary rectangle with local blur.
          const opaqueRow=Array.from({length:preview.height},(_,y)=>y).find(y=>{
            for(let x=0;x<preview.width;x++)if(pixels[(y*preview.width+x)*4+3]>250)return true;
            return false;
          });
          check(opaqueRow!==undefined&&opaqueRow>35,"Fold fixture has no distinct upper glass margin");
          let glassPixels=0;
          for(let y=0;y<opaqueRow-4;y++)for(let x=0;x<preview.width;x++)if(pixels[(y*preview.width+x)*4+3]>20)glassPixels++;
          check(glassPixels>80,"Fold glass silhouette disappears outside the source artwork");
        }
      }
      check(images.size===4,"Preset stills do not express distinct effects");
      check(!window.fixtureMessages.some(m=>m.type==="apply-preset-effect"),"Choosing a preset changed the document before Apply");
      for(let value=1;value<=63;value++){amount.value=String(value);amount.dispatchEvent(new Event("input",{bubbles:true}));}
      await wait(()=>!role("apply").disabled,"coalesced final still");
      role("apply").click();
      await wait(()=>window.fixtureMessages.some(m=>m.type==="apply-preset-effect"),"one workpiece publication");
      const output=window.fixtureMessages.findLast(m=>m.type==="apply-preset-effect");
      check(output.spec.effect==="fold-screen"&&output.spec.amount===.63&&output.sourceState===original,"Apply used superseded controls or artwork");
      check(output.raster.baseWidth===100&&output.raster.layers.length===1&&output.raster.layers[0].name==="fold-inner","Fold omitted its fixed native base or visible face");
      check(role("apply").disabled&&amount.disabled,"Publication allows a concurrent write");
      saved=output.spec;send({type:"preset-applied",generation,nodeId:"workpiece"});
      generation+=1;
      send({type:"selection-loading",generation,nodeIds:["workpiece"]});
      send({type:"source",generation,payload:{...payload,presetResult:true,sourceNodeId:"workpiece",targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined}});
      await wait(()=>!root.hidden&&!role("apply").disabled&&amount.value==="63","saved preset continuation");
      await wait(()=>!get("#workspace-tab-mesh").disabled&&!get("#workspace-tab-presets").disabled,"tool navigation after preset publication");
      amount.value="0";amount.dispatchEvent(new Event("input",{bubbles:true}));
      await wait(()=>!role("apply").disabled,"unfolded still");
      const zero=preview.toDataURL();check(zero!==first,"Fold zero preview did not refresh");
      role("cancel").click();await wait(()=>!role("apply").disabled&&amount.value==="63","cancel to saved amount");
      amount.value="41";amount.dispatchEvent(new Event("input",{bubbles:true}));
      await wait(()=>!role("apply").disabled,"unpublished preset before editing artwork");
      const seen=window.fixtureMessages.length;role("edit-source").click();
      await wait(()=>window.fixtureMessages.slice(seen).some(m=>m.type==="edit-preset-source"),"native original editing");
      original="native-artwork-v2";
      generation+=1;send({type:"selection-loading",generation,nodeIds:["artwork"]});
      send({type:"source",generation,payload:{...payload,presetResult:true,sourceNodeId:"artwork",targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined}});
      await wait(()=>!role("apply").disabled&&amount.value==="41","changed original retains unpublished preset");
      role("apply").click();await wait(()=>window.fixtureMessages.findLast(m=>m.type==="apply-preset-effect")?.sourceState===original,"Apply after native source edit");
      send({type:"preset-error",generation:generation-1,message:{key:"presetApplyFailed"}});
      check(role("apply").disabled,"Old error unlocked a current publication");
      send({type:"preset-error",generation,message:{key:"presetApplyFailed"}});
      await wait(()=>!role("apply").disabled&&!root.querySelector('[role="alert"]').hidden,"recoverable publication failure");
      root.querySelector('[data-effect="card-turn"]').click();
      await wait(()=>!role("apply").disabled&&root.querySelector('[role="alert"]').hidden,"error clears after a new choice");
      const bounds=root.getBoundingClientRect(),button=role("apply").getBoundingClientRect();
      check(button.left>=bounds.left-1&&button.right<=bounds.right+1&&button.bottom<=innerHeight,"Apply overflows the visible workspace");
      check(document.elementFromPoint((button.left+button.right)/2,(button.top+button.bottom)/2)===role("apply"),"Apply cannot be reached by a pointer");
    } else if (scenario === "linked-results") {
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["content"] });
      send({ type: "source", generation, payload: { ...payload, targetNodeId: undefined, nativeTarget: undefined,
        nativeRenderer: undefined, linkedResults: { total: 2, items: [
          { nodeId: "result-a", name: "Poster pass", revision: 2, kind: "mockup", position: { x: 120, y: 40 } },
          { nodeId: "result-b", name: "", revision: 1, kind: "transform" },
        ] } } });
      await wait(() => !get("#linked-results-trigger").hidden && !get("#linked-results-trigger").disabled, "linked results entry");
      check(get("#linked-results-trigger").textContent === "Results: 2", "Wrong linked result count label");
      check(get("#linked-results-trigger").getAttribute("aria-expanded") === "false", "Wrong initial expanded state");
      get("#linked-results-trigger").click();
      check(!get("#linked-results-popover").hidden && get("#linked-results-trigger").getAttribute("aria-expanded") === "true", "Popover did not open");
      const items = [...get("#linked-results-list").querySelectorAll("button")];
      check(items.length === 2, "Linked result items missing");
      check(items[0].textContent.includes("Poster pass") && items[0].textContent.includes("Composition") && items[0].textContent.includes("At 120, 40"), "Result name/kind/position detail missing");
      check(items[0].title === "Poster pass · Composition · At 120, 40", "Result tooltip should explain the row without a node id");
      check(items[1].textContent.includes("Perspective"), "Transform result kind label missing");
      check(items[1].title === "Perspective", "Unnamed result tooltip should use its operation");
      check(document.activeElement === items[0], "Open did not focus the first result");
      key(items[0], "ArrowDown");
      check(document.activeElement === items[1], "ArrowDown did not move menu focus");
      key(document.activeElement, "Escape");
      check(get("#linked-results-popover").hidden && document.activeElement === get("#linked-results-trigger"), "Escape did not close and restore focus");
      get("#linked-results-trigger").click();
      const seen = window.fixtureMessages.length;
      items[1].click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "select-linked-result"), "result selection");
      const chosen = window.fixtureMessages.findLast(m => m.type === "select-linked-result");
      check(chosen.generation === generation && chosen.sourceNodeId === "content" && chosen.resultNodeId === "result-b", "Wrong result selection message");
    } else if (scenario === "workpiece-continuation") {
      check(!document.querySelector('[data-workspace="stack"]'), "Batch still occupies human navigation");
      const plain = { ...payload, targetNodeId: undefined, nativeTarget: undefined, nativeRenderer: undefined };
      const artworks=new Map([["a",canvas],["whole",canvas]]);
      addEventListener("message", event => {
        const request=event.data?.pluginMessage;if(request?.type!=="request-source-raster")return;
        const artwork=artworks.get(request.sourceNodeId);check(!!artwork,"HD capture requested another workpiece");
        const fresh=document.createElement("canvas");fresh.width=request.desiredWidth;fresh.height=request.desiredHeight;
        fresh.getContext("2d").drawImage(artwork,0,0,fresh.width,fresh.height);
        send({type:"source-raster",generation:request.generation,requestId:request.requestId,bytes:Uint8Array.from(atob(fresh.toDataURL().split(",")[1]),c=>c.charCodeAt(0))});
      });
      await refresh({ ...plain, sourceNodeId: "a", sourceName: "A" });
      get("#workspace-tab-mesh").click();
      const root = get("#mesh-workspace");
      const point = () => root.querySelector('.direct-point[data-point-id="12"]');
      await wait(() => point() && !root.querySelector('[data-role="apply"]').disabled, "A mesh ready");
      const original = point().style.left;
      key(point(), "ArrowRight", { shiftKey: true });
      await wait(() => point().style.left !== original && !root.querySelector('[data-role="apply"]').disabled, "A edit");
      const startA = window.fixtureMessages.length;
      root.querySelector('[data-role="apply"]').click();
      try{await wait(() => window.fixtureMessages.slice(startA).some(m => m.type === "apply-designer"), "A output");}catch(error){throw Error(error.message+"; feedback="+root.querySelector('[data-role="error"]').textContent+"; messages="+JSON.stringify(window.fixtureMessages.slice(startA).map(m=>({type:m.type,desiredWidth:m.desiredWidth,desiredHeight:m.desiredHeight})))+"; uncaught="+window.fixtureErrors.join(";"));}
      const a = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check(a.sourceNodeIds.join() === "a" && a.task.spec.meshEdits.length === 1, "A effect has wrong source");
      send({ type: "apply-designer-complete", generation, targetNodeId: "a-result", operation: "apply" });
      // Move attention to B without re-launching or choosing the tool again.
      const bPixels = document.createElement("canvas"); bPixels.width = 300; bPixels.height = 90;
      bPixels.getContext("2d").drawImage(canvas, 0, 0, 300, 90);
      artworks.set("b",bPixels);
      const bBytes = Uint8Array.from(atob(bPixels.toDataURL().split(",")[1]), c => c.charCodeAt(0));
      await refresh({ ...plain, sourceNodeId: "b", sourceName: "B", bytes: bBytes,
        renderWidth: 300, renderHeight: 90, placement: { x: 750, y: 200, width: 300, height: 90 } });
      await wait(() => !root.hidden && !root.querySelector('[data-role="apply"]').disabled, "B continues Mesh");
      const bCanvas = root.querySelector("canvas").getBoundingClientRect();
      const bPoint = point().getBoundingClientRect();
      check(Math.abs((bPoint.left + bPoint.width / 2 - bCanvas.left) / bCanvas.width - .5) < .005,
        "A's mesh draft leaked into B");
      check(root.querySelector('[data-role="title"]').textContent === "B", "B is not the visible target");
      check(root.querySelector('[data-role="apply"]').textContent === "New Linked Image", "B has wrong output action");
      key(point(), "ArrowLeft", { shiftKey: true });
      await wait(() => point().style.left !== original && !root.querySelector('[data-role="apply"]').disabled, "B own edit");
      const startB = window.fixtureMessages.length;
      root.querySelector('[data-role="apply"]').click();
      await wait(() => window.fixtureMessages.slice(startB).some(m => m.type === "apply-designer"), "B output");
      const b = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      const encodedB=new DataView(b.bytes.buffer,b.bytes.byteOffset,b.bytes.byteLength);
      check(b.task.spec.targetSize.width === 300 && b.task.spec.targetSize.height === 90 &&
        b.placement.width===300&&b.placement.height===90&&b.renderWidth>=300&&b.renderHeight>=90&&
        b.renderWidth/b.renderHeight===300/90&&encodedB.getUint32(16)===b.renderWidth&&encodedB.getUint32(20)===b.renderHeight,
        "B lost its own logical size or declared HD pixel dimensions "+JSON.stringify({render:[b.renderWidth,b.renderHeight],target:b.task.spec.targetSize,placement:b.placement,source:b.sourceNodeIds}));
      check(b.sourceNodeIds.join() === "b" && b.task.spec.meshEdits[0].warped.x < a.task.spec.meshEdits[0].warped.x,
        "B did not retain its independent effect");
      send({ type: "apply-designer-complete", generation, targetNodeId: "b-result", operation: "apply" });
      // Selecting one containing Frame uses its flattened visible appearance;
      // child operation records do not become per-object assignments.
      get("#workspace-tab-perspective").click();
      await refresh({ ...plain, sourceNodeId: "whole", sourceName: "A + B" });
      check(!get("#controls").hidden && get("#source-name").textContent === "A + B", "Whole Frame is not the visible target");
      get("#mode-distort").click();
      await moveCorner();
      const startWhole = window.fixtureMessages.length;
      await ready(); get("#apply").click();
      await wait(() => window.fixtureMessages.slice(startWhole).some(m => m.type === "apply"), "whole output");
      const whole = window.fixtureMessages.findLast(m => m.type === "apply").payload;
      check(whole.sourceNodeId === "whole" && whole.spec.destination.quad.tl.x > 0, "Whole effect lost target or edit");
      send({ type: "apply-complete", generation, targetNodeId: "whole-result", operation: "apply" });
      // Saved A restores A's own edit, and update remains distinguishable from
      // producing a separate version after locale or content refresh.
      await refresh({ ...plain, sourceNodeId: "a", sourceName: "A", targetNodeId: "a-result", task: a.task });
      await wait(() => !root.hidden && !root.querySelector('[data-role="apply"]').disabled, "reopen A");
      check(point().style.left !== original, "Reopening A lost its mesh");
      check(root.querySelector('[data-role="apply"]').textContent === "Update Linked Image", "Reopened A offers ambiguous Apply");
      send({ type: "locale", preference: "zh-CN", locale: "zh-CN" });
      check(root.querySelector('[data-role="apply"]').textContent === "更新关联图像", "Localized update label lost target meaning");
      check(root.querySelector('[data-role="apply-new"]').textContent === "新建关联图像", "New version duplicates update action");
      send({ type: "locale", preference: "en", locale: "en" });
      await refresh({ ...plain, sourceNodeId: "whole", sourceName: "A + B", targetNodeId: "whole-result", spec: whole.spec });
      check(!get("#controls").hidden && root.hidden && get("#apply").textContent === "Update Linked HD Image",
        "Returning from a child to the saved whole keeps the child's tool instead of reopening Perspective");
      check(label().includes("x 0.50%"), "Whole lost its saved transform");
      check(window.fixtureErrors.length === 0, `workpiece errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "mockup-agent-conflict") {
      const { spec: _spec, nativeTarget: _nativeTarget, nativeRenderer: _nativeRenderer, targetNodeId: _targetNodeId, ...first } = payload;
      const second = { ...first, sourceNodeId: "scene", sourceName: "Scene" };
      const sources = [first, second];
      const published = { kind: "mockup", spec: {
        schema: "worldbend.mockup", version: "0.1", canvas: { width: 200, height: 160 },
        background: { kind: "transparent" }, seams: [],
        planes: [
          { id: "artwork", sourceId: "source-1", transform: spec, opacity: 1 },
          { id: "scene", sourceId: "source-2", transform: spec, opacity: 1 },
        ],
      } };
      const changed = opacity => ({ ...published, spec: { ...published.spec, planes: [
        { ...published.spec.planes[0], opacity }, published.spec.planes[1],
      ] } });
      const staged = opacity => ({ schema: "worldbend.figma.mockup-draft", version: "0.1", baseRevision: 1, task: changed(opacity) });
      const composePayload = draft => ({ ...first, sources, targetNodeId: "result", task: published, mockupDraft: draft });
      const sendComposition = draft => {
        generation += 1;
        send({ type: "selection-loading", generation, nodeIds: ["result"] });
        send({ type: "source", generation, payload: composePayload(draft) });
      };
      const sendUnavailable = () => {
        generation += 1;
        send({ type: "selection-loading", generation, nodeIds: ["result"] });
        send({ type: "source", generation, payload: {
          ...first, sources, targetNodeId: "result", task: published, mockupDraftUnavailable: true,
        } });
      };
      sendComposition(staged(.4));
      const panel = "#mockup-workspace";
      const opacity = () => get(`${panel} [data-role="opacity"]`);
      const applyButton = () => get(`${panel} [data-role="apply"]`);
      await wait(() => !get(panel).hidden && !applyButton().disabled && opacity().value === "40", "staged Composition preview");
      check(!get(`${panel} [data-role="agent-conflict"]`).hidden &&
        get(`${panel} [data-role="agent-conflict-text"]`).textContent.includes("Agent draft") &&
        get(`${panel} [data-role="agent-conflict-actions"]`).hidden,
      "Staged Agent Composition was not labeled in the designer workspace");
      sendUnavailable();
      await wait(() => opacity().value === "100" &&
        get(`${panel} [data-role="agent-conflict-text"]`).textContent.includes("published Composition is loaded"),
      "unavailable untouched Agent draft did not restore the published Composition");
      sendComposition(staged(.4));
      await wait(() => opacity().value === "40", "restaged Composition preview");
      opacity().value = "30"; opacity().dispatchEvent(new Event("input", { bubbles: true }));
      opacity().dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => opacity().value === "30", "local Composition edit");
      sendUnavailable();
      await wait(() => opacity().value === "30" &&
        get(`${panel} [data-role="agent-conflict-text"]`).textContent.includes("unsaved edit"),
      "unavailable Agent draft discarded or mislabeled the designer's unsaved edit");
      sendComposition(staged(.7));
      await wait(() => !get(`${panel} [data-role="agent-conflict-actions"]`).hidden, "Agent/local Composition conflict");
      check(opacity().value === "30" && applyButton().disabled, "Agent stage overwrote a local edit or allowed ambiguous Apply");
      check(!get(`${panel} [data-role="review-agent"]`).disabled, "Agent review choice is disabled");
      get(`${panel} [data-role="review-agent"]`).click();
      try {
        await wait(() => get(`${panel} [data-role="agent-conflict-actions"]`).hidden && !applyButton().disabled && opacity().value === "70", "review the Agent Composition version");
      } catch (error) {
        throw new Error(`${error.message}; actionsHidden=${get(`${panel} [data-role="agent-conflict-actions"]`).hidden}, applyDisabled=${applyButton().disabled}, opacity=${opacity().value}`);
      }
      opacity().value = "20"; opacity().dispatchEvent(new Event("input", { bubbles: true }));
      opacity().dispatchEvent(new Event("change", { bubbles: true }));
      sendComposition(staged(.8));
      await wait(() => !get(`${panel} [data-role="agent-conflict-actions"]`).hidden, "second Composition conflict");
      check(opacity().value === "20" && applyButton().disabled, "second Agent stage overwrote the designer's edit");
      get(`${panel} [data-role="keep-mine"]`).click();
      await wait(() => get(`${panel} [data-role="agent-conflict"]`).hidden && !applyButton().disabled, "keep local Composition edit");
      const seen = window.fixtureMessages.length;
      applyButton().click();
      await wait(() => window.fixtureMessages.slice(seen).some(message => message.type === "apply-designer"), "chosen Composition publication");
      const publishedTask = window.fixtureMessages.findLast(message => message.type === "apply-designer").payload.task;
      check(publishedTask.spec.planes[0].opacity === .2, "Apply did not keep the designer's chosen edit");
      send({ type: "apply-designer-complete", generation, targetNodeId: "result", operation: "replace" });
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["result"] });
      send({ type: "source", generation, payload: {
        ...first, sources, targetNodeId: "result", task: publishedTask, mockupDraftUnavailable: true,
      } });
      await wait(() => !get(`${panel} [data-role="agent-conflict"]`).hidden && !applyButton().disabled,
        "unusable Agent draft recovery");
      check(get(`${panel} [data-role="agent-conflict-actions"]`).hidden &&
        get(`${panel} [data-role="agent-conflict-text"]`).textContent.includes("unavailable"),
      "Unusable Agent draft did not explain designer recovery");
    } else if (scenario === "spatial-workspace") {
      const layerBytes = color => {
        const layer = document.createElement("canvas"); layer.width = 600; layer.height = 400;
        const layerContext = layer.getContext("2d");
        layerContext.fillStyle = color; layerContext.fillRect(0, 0, 600, 400);
        layerContext.fillStyle = "rgba(255,255,255,.75)"; layerContext.fillRect(120, 90, 360, 220);
        return Uint8Array.from(atob(layer.toDataURL().split(",")[1]), character => character.charCodeAt(0));
      };
      generation++;
      const spatialSources = [
        { ...payload, bytes: layerBytes("#18304c"), sourceNodeId: "source-1", sourceName: "Far skyline", renderWidth: 600, renderHeight: 400, placement: { x: 0, y: 0, width: 600, height: 400 } },
        { ...payload, bytes: layerBytes("#287c75"), sourceNodeId: "source-2", sourceName: "Distant buildings", renderWidth: 600, renderHeight: 400, placement: { x: 0, y: 0, width: 600, height: 400 } },
        { ...payload, bytes: layerBytes("#b98446"), sourceNodeId: "source-3", sourceName: "Street props", renderWidth: 600, renderHeight: 400, placement: { x: 0, y: 0, width: 600, height: 400 } },
        { ...payload, bytes: layerBytes("#9a344f"), sourceNodeId: "source-4", sourceName: "Character group", renderWidth: 600, renderHeight: 400, placement: { x: 0, y: 0, width: 600, height: 400 } },
        { ...payload, bytes: layerBytes("#6f42c1"), sourceNodeId: "source-5", sourceName: "Near frame", renderWidth: 600, renderHeight: 400, placement: { x: 0, y: 0, width: 600, height: 400 } },
      ].map(({ targetNodeId, nativeTarget, nativeRenderer, spec, ...item }) => item);
      send({ type: "selection-loading", generation, nodeIds: spatialSources.map(item => item.sourceNodeId) });
      send({ type: "source", generation, payload: { ...spatialSources[0], sources: spatialSources } });
      await wait(() => !get("#workspace-tab-spatial").disabled, "five-layer Spatial entry");
      get("#workspace-tab-spatial").click();
      const root = get("#spatial-workspace");
      try {
        await wait(() => !root.hidden && (!root.querySelector('[data-role="apply"]').disabled || !root.querySelector('[data-role="error"]').hidden), "Spatial preview planned");
      } catch (error) {
        const preview = root.querySelector('canvas');
        const inputs = [...root.querySelectorAll('input')].map(input => `${input.dataset.role ?? input.dataset.distance}:${input.value}:${input.validity.valid}`).join('|');
        const alpha = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data.some((value, index) => index % 4 === 3 && value > 0);
        throw new Error(`${error.message}; hidden=${root.hidden}; applyDisabled=${root.querySelector('[data-role="apply"]').disabled}; errorHidden=${root.querySelector('[data-role="error"]').hidden}; error=${root.querySelector('[data-role="error"]').textContent}; roles=${root.querySelectorAll('.spatial-role-row').length}; canvas=${preview.width}x${preview.height}; alpha=${alpha}; inputs=${inputs}`);
      }
      check(root.querySelector('[data-role="error"]').hidden, `Spatial preview failed: ${root.querySelector('[data-role="error"]').textContent}`);
      const roleNames = [...root.querySelectorAll('.spatial-role-row select')].map(select => select.selectedOptions[0]?.textContent);
      check(JSON.stringify(roleNames) === JSON.stringify(["Far skyline", "Distant buildings", "Street props", "Character group", "Near frame"]), `Spatial role bindings changed order: ${roleNames}`);
      check([...root.querySelectorAll('input[data-distance]')].every(input => input.step === "any" && input.validity.valid),
        "Canonical fractional layer distances were rejected by the native number controls");
      const preview = root.querySelector("canvas");
      check(preview.width > 0 && preview.height > 0 && preview.getContext("2d").getImageData(0, 0, preview.width, preview.height).data.some((value, index) => index % 4 === 3 && value > 0), "Spatial preview rendered no pixels");
      const before = preview.toDataURL();
      const x = root.querySelector('[data-role="preview-x"]');
      x.value = "80"; x.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(() => preview.toDataURL() !== before, "shared-camera viewpoint update");
      const reduced = root.querySelector('[data-role="reduced-motion"]');
      reduced.checked = true; reduced.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => root.querySelector('[data-role="preview-x"]').value === "80", "reduced-motion state retained explicit input");
      const travel = root.querySelector('[data-role="travel"]');
      const settledTravel = travel.value;
      travel.value = String(Number(settledTravel) + 2);
      travel.dispatchEvent(new Event("input", { bubbles: true }));
      travel.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => root.querySelector('[data-role="travel"]').value !== settledTravel, "travel slider edit");
      key(root.querySelector('[data-role="preview-x"]'), "z", { metaKey: true });
      await wait(() => root.querySelector('[data-role="travel"]').value === settledTravel, "travel slider release enters undo history");
      const firstSource = root.querySelector('.spatial-role-row select');
      firstSource.value = "source-5"; firstSource.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => [...root.querySelectorAll('.spatial-role-row select')].map(select => select.value).join(",") === "source-5,source-2,source-3,source-4,source-1", "role-source swap");
      const settledDistance = root.querySelector('input[data-distance="layer-1"]').value;
      // renderControls rebuilds the role rows, so each step re-queries the
      // live input instead of holding a detached element reference.
      const distanceInput = () => root.querySelector('input[data-distance="layer-1"]');
      distanceInput().value = "2400";
      distanceInput().dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => distanceInput().value === "2400", "distance edit");
      // Undo must not fire from the number field itself, where the keystroke
      // belongs to native text-edit history; a sibling slider carries it.
      key(root.querySelector('[data-role="preview-x"]'), "z", { metaKey: true });
      await wait(() => distanceInput().value === settledDistance, "distance edit undo restores the control");
      distanceInput().value = "500";
      distanceInput().dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !root.querySelector('[data-role="error"]').hidden && root.querySelector('[data-role="apply"]').disabled, "invalid distance ordering blocks Apply with a visible reason");
      await new Promise(resolve => setTimeout(resolve, 180));
      check(!root.querySelector('[data-role="error"]').hidden && root.querySelector('[data-role="apply"]').disabled, "a stale async preview cleared the invalid-controls state");
      distanceInput().value = settledDistance;
      distanceInput().dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => root.querySelector('[data-role="error"]').hidden && !root.querySelector('[data-role="apply"]').disabled, "restored ordering clears the block");
      const depthOfField = root.querySelector('[data-role="depth-of-field"]');
      const focusRange = root.querySelector('[data-role="focus-range"]');
      focusRange.value = "0";
      focusRange.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !root.querySelector('[data-role="error"]').hidden, "invalid enabled depth control blocks Apply");
      depthOfField.checked = false;
      depthOfField.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => root.querySelector('[data-role="error"]').hidden && !root.querySelector('[data-role="apply"]').disabled, "disabling depth ignores its inactive invalid field");
      const seen = window.fixtureMessages.length;
      root.querySelector('[data-role="apply"]').click();
      await wait(() => window.fixtureMessages.slice(seen).some(message => message.type === "apply-designer"), "Spatial publication request");
      const published = window.fixtureMessages.findLast(message => message.type === "apply-designer").payload;
      check(published.task.kind === "effect" && published.task.recipe.schema === "worldbend.effect-recipe" && published.task.recipe.version === "3", "Spatial publication lost the canonical recipe");
      check(JSON.stringify(published.sourceNodeIds) === JSON.stringify(["source-5", "source-2", "source-3", "source-4", "source-1"]), "Spatial publication lost explicit role order");
      check(published.task.state.reducedMotion === true && published.task.state.pointerX === .8, "Spatial publication lost the reference state");
      check(published.bytes.length > 8 && published.renderWidth === 600 && published.renderHeight === 400, "Spatial publication produced no full-size PNG");
      // The fixture has no main thread; answer the publication so the
      // workspace leaves its busy state before the reset check.
      send({ type: "apply-designer-complete", generation, targetNodeId: "result", operation: "apply" });
      root.querySelector('[data-role="reset"]').click();
      await wait(() => root.querySelector('[data-role="preview-x"]').value === "0", "reset re-syncs controls to the baseline");
      check(window.fixtureErrors.length === 0, `fixture errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "ready-scene-previews") {
      send({ type: "template-library", templates: window.fixtureReadyScenes });
      get("#workspace-tab-templates").click();
      const preview = id => document.querySelector(`[data-template-id="ready-${id}"] svg image`);
      await wait(() => window.fixtureReadyScenes.every(record => preview(record.readyScene)), "all actual-artwork scene previews");
      const href = id => preview(id).getAttribute("href");
      const sample = async (url, x, y) => {
        const image = new Image(); image.src = url; await image.decode();
        const pixels = document.createElement("canvas"); pixels.width = image.naturalWidth; pixels.height = image.naturalHeight;
        const ctx = pixels.getContext("2d"); ctx.drawImage(image, 0, 0);
        return ctx.getImageData(x, y, 1, 1).data;
      };
      const old = href("studio-can");
      check((await sample(old, 160, 186))[3] > 200, "Cover thumbnail has a gap at the can label edge");
      // Check the complete rendered scene, rather than only its projected
      // artwork or the presence of SVG attributes. Native lighting must also
      // illuminate replacement designs without affecting the backdrop.
      const canSvg = preview("studio-can").closest("svg");
      const unlitSvg = canSvg.cloneNode(true);
      const reflection = unlitSvg.querySelector('[style*="mix-blend-mode:screen"]');
      check(!!reflection, "Can preview has no editable reflection layer");
      reflection.remove();
      const svgUrl = svg => {
        const copy = svg.cloneNode(true);
        copy.setAttribute("width", "1200"); copy.setAttribute("height", "900");
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
      };
      const lit = svgUrl(canSvg), unlit = svgUrl(unlitSvg);
      const reflectionPixel = await sample(lit, 508, 500);
      const unlitPixel = await sample(unlit, 508, 500);
      check(reflectionPixel[0] > unlitPixel[0] + 5 && reflectionPixel[1] > unlitPixel[1] + 5,
        "Can reflection did not illuminate the rendered artwork");
      check(JSON.stringify(Array.from(await sample(lit, 100, 100))) === JSON.stringify(Array.from(await sample(unlit, 100, 100))),
        "Can reflection changed pixels outside its native surface");
      const plainLidSvg = canSvg.cloneNode(true);
      const groove = plainLidSvg.querySelector('path[fill-rule="evenodd"]');
      check(!!groove, "Can lid has no hollow groove");
      groove.remove();
      const plainLid = svgUrl(plainLidSvg);
      check(JSON.stringify(Array.from(await sample(lit, 500, 170))) === JSON.stringify(Array.from(await sample(plainLid, 500, 170))),
        "Can groove incorrectly darkened the whole inset lid");
      const grooveEdge = await sample(lit, 439, 170), lidEdge = await sample(plainLid, 439, 170);
      check(grooveEdge[0] < lidEdge[0] - 10, "Can groove ring did not render around its hollow center");

      const fabricSvg = preview("hanging-fabric").closest("svg");
      const multiplyPaths = [...fabricSvg.querySelectorAll('path[style*="mix-blend-mode:multiply"]')];
      check(multiplyPaths.length >= 2, "Fabric preview missing contact and rail cast Multiply layers");
      const castPath = multiplyPaths.find(node => (node.getAttribute("fill") || "").startsWith("url("));
      check(!!castPath, "Fabric preview has no rail cast Multiply path");
      const plainFabricSvg = fabricSvg.cloneNode(true);
      const plainCast = [...plainFabricSvg.querySelectorAll('path[style*="mix-blend-mode:multiply"]')]
        .find(node => (node.getAttribute("fill") || "").startsWith("url("));
      check(!!plainCast, "Fabric cast clone missing before removal");
      plainCast.remove();
      const litFabric = svgUrl(fabricSvg), plainFabric = svgUrl(plainFabricSvg);
      const castSample = await sample(litFabric, 600, 230);
      const plainSample = await sample(plainFabric, 600, 230);
      const castLuma = castSample[0] + castSample[1] + castSample[2];
      const plainLuma = plainSample[0] + plainSample[1] + plainSample[2];
      check(plainLuma - castLuma > 15,
        "Fabric rail cast did not darken the upper artwork");
      check(JSON.stringify(Array.from(await sample(litFabric, 600, 520))) === JSON.stringify(Array.from(await sample(plainFabric, 600, 520))),
        "Fabric rail cast changed mid-cloth pixels outside its shade");

      const cartonSvg = preview("carton-label").closest("svg");
      const cartonMultiply = [...cartonSvg.querySelectorAll('path[style*="mix-blend-mode:multiply"]')];
      check(cartonMultiply.length >= 2, "Carton preview missing floor contact and top cast Multiply layers");
      const cartonCast = cartonMultiply.find(node => (node.getAttribute("fill") || "").startsWith("url("));
      check(!!cartonCast, "Carton preview has no top cast Multiply path");
      const plainCartonSvg = cartonSvg.cloneNode(true);
      const plainCartonCast = [...plainCartonSvg.querySelectorAll('path[style*="mix-blend-mode:multiply"]')]
        .find(node => (node.getAttribute("fill") || "").startsWith("url("));
      check(!!plainCartonCast, "Carton cast clone missing before removal");
      plainCartonCast.remove();
      const litCarton = svgUrl(cartonSvg), plainCarton = svgUrl(plainCartonSvg);
      const cartonCastSample = await sample(litCarton, 520, 300);
      const cartonPlainSample = await sample(plainCarton, 520, 300);
      const cartonCastLuma = cartonCastSample[0] + cartonCastSample[1] + cartonCastSample[2];
      const cartonPlainLuma = cartonPlainSample[0] + cartonPlainSample[1] + cartonPlainSample[2];
      check(cartonPlainLuma - cartonCastLuma > 12,
        "Carton top cast did not darken the upper label artwork");
      check(JSON.stringify(Array.from(await sample(litCarton, 520, 500))) === JSON.stringify(Array.from(await sample(plainCarton, 520, 500))),
        "Carton top cast changed mid-label pixels outside its shade");
      const cartonFloorRemoved = cartonSvg.cloneNode(true);
      const cartonFloor = [...cartonFloorRemoved.querySelectorAll('path[style*="mix-blend-mode:multiply"]')]
        .find(node => !(node.getAttribute("fill") || "").startsWith("url("));
      check(!!cartonFloor, "Carton preview has no floor contact Multiply path");
      cartonFloor.remove();
      const litCartonFloor = svgUrl(cartonSvg), plainCartonFloor = svgUrl(cartonFloorRemoved);
      const floorLit = await sample(litCartonFloor, 600, 710);
      const floorPlain = await sample(plainCartonFloor, 600, 710);
      const floorLitLuma = floorLit[0] + floorLit[1] + floorLit[2];
      const floorPlainLuma = floorPlain[0] + floorPlain[1] + floorPlain[2];
      check(floorPlainLuma - floorLitLuma > 8,
        "Carton floor contact did not darken the backdrop under the box");

      const posterSvg = preview("studio-poster").closest("svg");
      const posterMultiply = [...posterSvg.querySelectorAll('path[style*="mix-blend-mode:multiply"]')];
      check(posterMultiply.length >= 2, "Poster preview missing wall contact and clip cast Multiply layers");
      const posterCast = posterMultiply.find(node => (node.getAttribute("fill") || "").startsWith("url("));
      check(!!posterCast, "Poster preview has no clip cast Multiply path");
      const plainPosterSvg = posterSvg.cloneNode(true);
      const plainPosterCast = [...plainPosterSvg.querySelectorAll('path[style*="mix-blend-mode:multiply"]')]
        .find(node => (node.getAttribute("fill") || "").startsWith("url("));
      check(!!plainPosterCast, "Poster cast clone missing before removal");
      plainPosterCast.remove();
      const litPoster = svgUrl(posterSvg), plainPoster = svgUrl(plainPosterSvg);
      const posterCastSample = await sample(litPoster, 600, 200);
      const posterPlainSample = await sample(plainPoster, 600, 200);
      const posterCastLuma = posterCastSample[0] + posterCastSample[1] + posterCastSample[2];
      const posterPlainLuma = posterPlainSample[0] + posterPlainSample[1] + posterPlainSample[2];
      check(posterPlainLuma - posterCastLuma > 12,
        "Poster clip cast did not darken the upper artwork");
      check(JSON.stringify(Array.from(await sample(litPoster, 600, 480))) === JSON.stringify(Array.from(await sample(plainPoster, 600, 480))),
        "Poster clip cast changed mid-poster pixels outside its shade");

      const desktopSvg = preview("desktop-screen").closest("svg");
      const desktopMultiply = [...desktopSvg.querySelectorAll('path[style*="mix-blend-mode:multiply"]')];
      check(desktopMultiply.length >= 2, "Desktop preview missing desk contact and bezel cast Multiply layers");
      const desktopCast = desktopMultiply.find(node => (node.getAttribute("fill") || "").startsWith("url("));
      check(!!desktopCast, "Desktop preview has no bezel cast Multiply path");
      const plainDesktopSvg = desktopSvg.cloneNode(true);
      const plainDesktopCast = [...plainDesktopSvg.querySelectorAll('path[style*="mix-blend-mode:multiply"]')]
        .find(node => (node.getAttribute("fill") || "").startsWith("url("));
      check(!!plainDesktopCast, "Desktop cast clone missing before removal");
      plainDesktopCast.remove();
      const litDesktop = svgUrl(desktopSvg), plainDesktop = svgUrl(plainDesktopSvg);
      const desktopCastSample = await sample(litDesktop, 600, 240);
      const desktopPlainSample = await sample(plainDesktop, 600, 240);
      const desktopCastLuma = desktopCastSample[0] + desktopCastSample[1] + desktopCastSample[2];
      const desktopPlainLuma = desktopPlainSample[0] + desktopPlainSample[1] + desktopPlainSample[2];
      check(desktopPlainLuma - desktopCastLuma > 12,
        "Desktop bezel cast did not darken the upper screen artwork");
      check(JSON.stringify(Array.from(await sample(litDesktop, 600, 450))) === JSON.stringify(Array.from(await sample(plainDesktop, 600, 450))),
        "Desktop bezel cast changed mid-screen pixels outside its shade");
      const desktopDeskRemoved = desktopSvg.cloneNode(true);
      const desktopDesk = [...desktopDeskRemoved.querySelectorAll('path[style*="mix-blend-mode:multiply"]')]
        .find(node => !(node.getAttribute("fill") || "").startsWith("url("));
      check(!!desktopDesk, "Desktop preview has no desk contact Multiply path");
      desktopDesk.remove();
      const litDesktopDesk = svgUrl(desktopSvg), plainDesktopDesk = svgUrl(desktopDeskRemoved);
      const deskLit = await sample(litDesktopDesk, 760, 820);
      const deskPlain = await sample(plainDesktopDesk, 760, 820);
      const deskLitLuma = deskLit[0] + deskLit[1] + deskLit[2];
      const deskPlainLuma = deskPlain[0] + deskPlain[1] + deskPlain[2];
      check(deskPlainLuma - deskLitLuma > 8,
        "Desktop desk contact did not darken the backdrop under the stand");

      const fit = get("#templates-workspace select");
      fit.value = "contain"; fit.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => preview("studio-can") && href("studio-can") !== old, "Contain updates preview before Use");
      const contained = href("studio-can");
      check((await sample(contained, 160, 186))[3] === 0, "Contain thumbnail cropped instead of retaining the full design");
      context.fillStyle = "#a74fae"; context.fillRect(0, 0, 200, 160);
      const purple = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), c => c.charCodeAt(0));
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["new-design"] });
      send({ type: "source", generation, payload: { ...payload, sourceNodeId: "new-design", targetNodeId: undefined,
        nativeTarget: undefined, nativeRenderer: undefined, bytes: purple } });
      await wait(() => preview("studio-can") && href("studio-can") !== contained, "new artwork replaces old thumbnail");
      let color;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        color = await sample(href("studio-can"), 160, 120);
        if (color[0] > 100 && color[2] > color[0] && color[1] < color[0] * .6) break;
        await delay();
      }
      check(color[0] > 100 && color[2] > color[0] && color[1] < color[0] * .6, "Thumbnail did not render the fresh purple artwork");
      check(!get("#templates-workspace").hidden, "Selecting new artwork unexpectedly left Templates");
      get('[data-template-id="ready-hanging-fabric"]').click();
      await wait(() => !get('#templates-workspace [data-role="apply"]').disabled, "new artwork ready for scene Use");
      const seen = window.fixtureMessages.length;
      get('#templates-workspace [data-role="apply"]').click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "use-ready-scene"), "Use curved scene");
      check(window.fixtureMessages.findLast(m => m.type === "use-ready-scene").fit === "contain", "Use lost the displayed fit");
      check(window.fixtureErrors.length === 0, `scene errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "composition-surfaces") {
      const scene = {schema:"worldbend.mockup",version:"0.1",canvas:{width:200,height:160},background:{kind:"transparent"},seams:[],planes:[
        {id:"art",sourceId:"source-1",transform:structuredClone(spec),opacity:1},
        {id:"guide",sourceId:"source-2",transform:structuredClone(spec),opacity:0},
      ]};
      const plain = {...payload,targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined};
      const sources = [{...plain,sourceNodeId:"art",sourceName:"Printed artwork",placement:{x:0,y:0,width:200,height:160}},
        {...plain,sourceNodeId:"guide",sourceName:"Surface guide",placement:{x:0,y:0,width:200,height:160}}];
      const root = get("#mockup-workspace"), role = name => get(`#mockup-workspace [data-role="${name}"]`);
      const open = async task => {
        generation += 1; send({type:"selection-loading",generation,nodeIds:["surface-result"]});
        send({type:"source",generation,payload:{...sources[0],sources,targetNodeId:"surface-result",task}});
        await wait(() => !root.hidden && !role("apply").disabled,"surface authoring entry");
      };
      await open({kind:"mockup",spec:scene});
      const preview = root.querySelector("canvas"), identity = preview.toDataURL();
      check(role("surface").selectedOptions[0].textContent === "Flat" && role("surface-controls").hidden,"flat default discovery");
      const change = (name,value) => { role(name).value = value; role(name).dispatchEvent(new Event("change",{bubbles:true})); };
      change("surface","cylinder"); change("surface-amount-number","80");
      await wait(() => !role("apply").disabled && preview.toDataURL() !== identity,"cylinder geometry and lighting");
      check(!role("surface-tilt-field").hidden && role("surface-fabric-fields").hidden,"shape-specific controls");
      const cylinder = preview.toDataURL();
      change("surface-amount-number","60");
      await wait(() => !role("apply").disabled && preview.toDataURL() !== cylinder,"later curvature edit");
      key(role("surface-amount"),"z",{metaKey:true});
      await wait(() => role("surface-amount-number").value === "80" && preview.toDataURL() === cylinder,"surface Undo restores pixels and controls");
      const publish = async () => {
        const seen = window.fixtureMessages.length; role("apply").click();
        await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"),"surface publication");
        const output = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
        send({type:"apply-designer-complete",generation,targetNodeId:"surface-result",operation:"apply"}); return output;
      };
      const cylindrical = await publish();
      check(cylindrical.task.spec.planes[0].surface.curvature === .8 && !cylindrical.task.spec.planes[1].surface,"surface changed another layer");
      check(JSON.stringify(cylindrical.task.spec.planes[0].transform.destination) === JSON.stringify(scene.planes[0].transform.destination),"surface discarded placement");
      const pixels = async raw => {
        const image = await createImageBitmap(new Blob([raw],{type:"image/png"}));
        const c = document.createElement("canvas"); c.width=image.width; c.height=image.height;
        const ctx=c.getContext("2d"); ctx.drawImage(image,0,0); image.close(); return ctx.getImageData(0,0,c.width,c.height).data;
      };
      const cylinderPixels = await pixels(cylindrical.bytes);
      check(cylinderPixels[3] === 0 && cylinderPixels[(80*200+100)*4+3] === 255,"curved silhouette and intact interior alpha");
      change("surface-light-number","0"); await wait(() => !role("apply").disabled && preview.toDataURL() !== cylinder,"unlit surface");
      const unlit = await publish(), unlitPixels = await pixels(unlit.bytes);
      check(cylinderPixels.every((v,i) => i%4!==3 || v===unlitPixels[i]),"lighting changed alpha");
      change("surface-amount-number","101");
      await wait(() => role("apply").disabled && !role("error").hidden,"invalid surface blocks publication");
      check(role("apply-new").disabled && role("save-template").disabled && role("copy-parameters").disabled,"invalid surface admitted stale output");
      role("planes").querySelectorAll("button")[1].click();
      await wait(() => !role("apply").disabled && role("surface").value === "","layer switch recovers accepted controls");
      role("planes").querySelectorAll("button")[0].click();
      check(role("surface").value === "cylinder" && role("surface-amount-number").value === "80","layer surface was lost or invalid value returned");
      change("surface","fabric"); change("surface-folds","3"); change("surface-amount-number","70"); change("surface-phase","20"); change("surface-light-number","65");
      // Another accepted shape edit consumes pending numeric fields too.
      // Its sliders must reflect the same state that will be published.
      role("surface-amount-number").value = "72";
      change("surface-phase","21");
      check(role("surface-amount").value === "72","shape edit left the amount slider at stale numeric state");
      change("surface-amount-number","70"); change("surface-phase","20");
      check(role("surface-amount").value === "70" && role("surface-light").value === "65","surface numeric/slider agreement");
      change("layer-warp","arc"); change("layer-warp-amount-number","40");
      await wait(() => !role("apply").disabled && preview.toDataURL() !== cylinder,"fabric and preceding Warp");
      check(role("surface-tilt-field").hidden && !role("surface-fabric-fields").hidden,"fabric control discovery");
      const fabric = await publish();
      check(fabric.task.spec.planes[0].surface.kind === "fabric" && fabric.task.spec.planes[0].surface.folds === 3 && fabric.task.spec.planes[0].transform.content.warp.amount === .4,"fabric publication lost shape or Warp");
      await open(fabric.task); check(role("surface").value === "fabric" && role("surface-phase").value === "20","surface saved reopen");
      role("shadow-label").click();check(role("shadow-label").closest("details").open,"shadow controls were not discoverable");
      check(role("shadow-opacity").getAttribute("aria-label")&&role("shadow-opacity").getAttribute("aria-label")===role("shadow-opacity-number").getAttribute("aria-label"),"paired shadow controls lost their accessible name");
      const noShadow=preview.toDataURL();change("shadow-opacity-number","35");change("shadow-x","12");change("shadow-y","18");change("shadow-blur","6");change("shadow-color","#341b18");
      await wait(()=>!role("apply").disabled&&preview.toDataURL()!==noShadow,"authored fabric shadow pixels");
      const shadowed=await publish();
      check(shadowed.task.spec.planes[0].shadow.opacity===.35&&shadowed.task.spec.planes[0].shadow.blurSigmaPx===6&&!shadowed.task.spec.planes[1].shadow,"shadow publication changed another layer");
      await open(shadowed.task);check(role("shadow-opacity-number").value==="35"&&role("shadow-color").value==="#341b18","shadow reopen lost controls");
      change("shadow-blur","65");await wait(()=>role("apply").disabled&&!role("error").hidden,"invalid shadow blocks output");
      role("planes").querySelectorAll("button")[1].click();await wait(()=>!role("apply").disabled,"shadow invalid-state recovery");role("planes").querySelectorAll("button")[0].click();
      check(role("shadow-blur").value==="6","invalid shadow replaced accepted value");
      const precise = structuredClone(shadowed.task); precise.spec.planes[0].surface.depth=1/3;
      await open(precise); change("surface-direction-number","25");
      const continued = await publish(); check(continued.task.spec.planes[0].surface.depth === 1/3,"unrelated surface edit rounded Agent strength");
      const published = [];
      addEventListener("message",event => {
        const request=event.data?.pluginMessage;
        if(request?.type === "prepare-linked-batch") send({type:"linked-batch",generation:request.generation,items:[{nodeId:"surface-result",name:"Fabric",revision:1,kind:"mockup",width:200,height:160,placement:{x:0,y:0,width:200,height:160},operationKind:"task",operationJson:JSON.stringify(continued.task),batchRunId:1,sourceNodeIds:["art","guide"],dependencyNodeIds:[]}]});
        if(request?.type === "export-batch-source") send({type:"batch-source",generation:request.generation,batchRunId:request.batchRunId,requestId:request.requestId,resultNodeId:request.resultNodeId,nodeId:request.nodeId,bytes,renderWidth:200,renderHeight:160});
        if(request?.type === "apply-linked-batch-item") {published.push(request.payload);send({type:"apply-complete",generation:request.payload.generation,batchResultId:request.payload.nodeId,batchRunId:request.payload.batchRunId,targetNodeId:"surface-result",operation:"replace"});}
      });
      generation+=1; send({type:"selection-loading",generation,nodeIds:["art"]});
      send({type:"source",generation,payload:{...sources[0],linkedResults:{total:1,items:[{nodeId:"surface-result",name:"Fabric",revision:1,kind:"mockup"}]}}});
      await wait(() => !get("#linked-results-trigger").disabled && !get("#linked-results-trigger").hidden,"surface refresh entry");
      get("#linked-results-trigger").click();get("#linked-batch-action").click();
      try{await wait(() => published.length===1 && get("#status").textContent.includes("1 of 1"),"surface linked refresh")}catch(error){throw Error(error.message+"; status="+get("#status").textContent+"; errors="+window.fixtureErrors.join("; ")+"; last="+JSON.stringify(window.fixtureMessages.slice(-4)))};
      const expected=await pixels(continued.bytes),actual=await pixels(published[0].bytes);
      check(expected.length===actual.length && expected.every((v,i)=>v===actual[i]),"batch lost surface/lighting/Warp pixels");
      check(document.documentElement.scrollWidth <= innerWidth,"surface controls overflow the plugin width");
      check(window.fixtureErrors.length===0,`surface errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "composition-layer-warp") {
      const scene = { schema: "worldbend.mockup", version: "0.1", canvas: { width: 200, height: 160 },
        background: { kind: "transparent" }, seams: [], planes: [
          { id: "art", sourceId: "source-1", transform: structuredClone(spec), opacity: 1 },
          { id: "guide", sourceId: "source-2", transform: structuredClone(spec), opacity: 0 },
        ] };
      const plain = { ...payload, targetNodeId: undefined, nativeTarget: undefined, nativeRenderer: undefined };
      const sources = [{ ...plain, sourceNodeId: "art", sourceName: "Printed artwork", placement: { x: 0, y: 0, width: 200, height: 160 } },
        { ...plain, sourceNodeId: "guide", sourceName: "Surface", placement: { x: 0, y: 0, width: 200, height: 160 } }];
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["art", "guide"] });
      send({ type: "source", generation, payload: { ...sources[0], sources, task: { kind: "mockup", spec: scene } } });
      const root = get("#mockup-workspace");
      const role = name => get(`#mockup-workspace [data-role="${name}"]`);
      await wait(() => !root.hidden && !role("apply").disabled, "layer Warp authoring");
      check(role("layer-warp").selectedOptions[0]?.textContent === "None" && role("layer-warp").selectedOptions[0]?.value === "",
        "unwarped layer must visibly select None");
      const preview = root.querySelector("canvas");
      const identity = preview.toDataURL();
      const corner=root.querySelector('.direct-point[data-point-id="tl"]'), cornerBox=corner.getBoundingClientRect(),
        cx=cornerBox.left+cornerBox.width/2,cy=cornerBox.top+cornerBox.height/2,originPosition=corner.style.left;
      const cornerPointer=(type,dx,buttons)=>corner.dispatchEvent(new PointerEvent(type,{
        clientX:cx+dx,clientY:cy,pointerId:91,pointerType:"mouse",button:0,buttons,bubbles:true,
      }));
      cornerPointer("pointerdown",0,1);cornerPointer("pointermove",4,1);
      await wait(()=>corner.style.left!==originPosition,"Composition point preview before cancellation");
      key(corner,"Escape");cornerPointer("pointerup",10,0);
      await wait(()=>!role("apply").disabled&&preview.toDataURL()===identity,"Composition Escape restores the layer origin");
      check(!root.hidden&&!corner.dataset.activePointerId,"Composition cancellation left the workspace or retained a stale owner");
      role("layer-warp").value = "arc";
      role("layer-warp-amount-number").value = "60";
      role("layer-warp-amount-number").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => preview.toDataURL() !== identity && !role("apply").disabled, "canonical single-layer Warp pixels");
      const warped = preview.toDataURL();
      role("layer-warp-amount-number").value = "101";
      role("layer-warp-amount-number").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !role("error").hidden && role("apply").disabled && role("apply-new").disabled,
        "invalid layer Warp blocks publication");
      check(role("error").textContent.includes("-100% to 100%"), "invalid strength must explain its valid range");
      const invalidSeen = window.fixtureMessages.length; role("apply").click();
      check(!window.fixtureMessages.slice(invalidSeen).some(m => m.type === "apply-designer"), "invalid controls published the previous task");
      check(role("save-template").disabled && role("copy-parameters").disabled, "invalid controls admitted stale saved/copied parameters");
      role("planes").querySelectorAll("button")[1].click();
      await wait(() => role("error").hidden && !role("apply").disabled, "switching layers restores accepted controls after invalid input");
      role("planes").querySelectorAll("button")[0].click();
      check(role("layer-warp-amount-number").value === "60", "switching back resurrected the invalid value");
      role("layer-warp-amount-number").value = "101";
      role("layer-warp-amount-number").dispatchEvent(new Event("change", { bubbles: true }));
      role("layer-warp-amount-number").value = "60";
      role("layer-warp-amount-number").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => role("error").hidden && !role("apply").disabled, "layer Warp recovery");
      const publish = async () => {
        const seen = window.fixtureMessages.length; role("apply").click();
        await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), "warped layer publication");
        const output = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
        send({ type: "apply-designer-complete", generation, targetNodeId: "warped-result", operation: "apply" });
        return output;
      };
      const single = await publish();
      check(single.task.spec.planes[0].transform.content.warp.amount === .6 &&
        !single.task.spec.planes[1].transform.content.warp, "layer Warp changed the other layer");
      check(JSON.stringify(single.task.spec.planes[0].transform.destination) === JSON.stringify(scene.planes[0].transform.destination),
        "layer Warp replaced the outer plane");
      role("planes").querySelectorAll("button")[1].click();
      check(role("layer-warp").value === "" && role("layer-warp-amount-number").value === "50", "another layer inherited the Warp controls");
      check(role("layer-warp").selectedOptions[0]?.textContent === "None", "another layer showed an empty Warp picker");
      check(role("layer-warp-amount-number").disabled, "None left an inactive bend field editable");
      role("planes").querySelectorAll("button")[0].click();
      check(role("layer-warp").value === "arc" && role("layer-warp-amount-number").value === "60", "returning lost the layer Warp");
      role("layer-warp-amount-number").value = "30";
      role("layer-warp-amount-number").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => preview.toDataURL() !== warped, "later layer adjustment");
      key(role("layer-warp-amount"), "z", { metaKey: true });
      await wait(() => role("layer-warp-amount-number").value === "60" && preview.toDataURL() === warped,
        "layer Warp Undo restores both parameters and preview");
      role("edit-target").value = "whole";
      role("edit-target").dispatchEvent(new Event("change", { bubbles: true }));
      role("warp").value = "wave"; role("warp-amount-number").value = "-101";
      role("warp-amount-number").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !role("error").hidden && role("apply").disabled && role("apply-new").disabled,
        "invalid whole Warp blocks publication");
      role("warp").value = "wave"; role("warp-amount-number").value = "20";
      role("warp-amount-number").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !role("apply").disabled && preview.toDataURL() !== warped, "independent whole-result Warp");
      const combined = await publish();
      check(combined.task.kind === "composition" && combined.task.template.operation.composition.planes[0].transform.content.warp.amount === .6 &&
        combined.task.template.operation.postprocess.stages[0].spec.content.warp.amount === .2,
        "whole Warp overwrote the layer Warp");
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["warped-result"] });
      send({ type: "source", generation, payload: { ...sources[0], sources, targetNodeId: "warped-result", task: combined.task } });
      await wait(() => role("warp").value === "wave" && role("warp-amount-number").value === "20" && !role("apply").disabled,
        "saved whole Warp reopen");
      role("edit-target").value = "layers";
      role("edit-target").dispatchEvent(new Event("change", { bubbles: true }));
      check(role("layer-warp").value === "arc" && role("layer-warp-amount-number").value === "60", "saved layer Warp reopen");
      // Real built batch renderer must reproduce the same high-quality pixels,
      // including BOTH the source-layer Warp and the whole-result Warp.
      const published = [];
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type === "prepare-linked-batch") send({ type: "linked-batch", generation: request.generation, items: [{
          nodeId: "warped-result", name: "Warped composition", revision: 1, kind: "composition", width: 200, height: 160,
          placement: { x: 0, y: 0, width: 200, height: 160 }, operationKind: "task", operationJson: JSON.stringify(combined.task),
          batchRunId: 1, sourceNodeIds: ["art", "guide"], dependencyNodeIds: [],
        }] });
        if (request?.type === "export-batch-source") send({ type: "batch-source", generation: request.generation,
          batchRunId: request.batchRunId, requestId: request.requestId,
          resultNodeId: request.resultNodeId, nodeId: request.nodeId, bytes, renderWidth: 200, renderHeight: 160 });
        if (request?.type === "apply-linked-batch-item") {
          published.push(request.payload);
          send({ type: "apply-complete", generation: request.payload.generation, batchResultId: request.payload.nodeId,
            batchRunId: request.payload.batchRunId, targetNodeId: "warped-result", operation: "replace" });
        }
      });
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["art"] });
      send({ type: "source", generation, payload: { ...sources[0], linkedResults: { total: 1,
        items: [{ nodeId: "warped-result", name: "Warped composition", revision: 1, kind: "composition" }] } } });
      await wait(() => !get("#linked-results-trigger").disabled && !get("#linked-results-trigger").hidden, "warped result refresh entry");
      get("#linked-results-trigger").click(); get("#linked-batch-action").click();
      await wait(() => published.length === 1 && get("#status").textContent.includes("1 of 1"), "warped composition linked refresh");
      const pixels = async raw => {
        const image = await createImageBitmap(new Blob([raw], { type: "image/png" }));
        const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
        const ctx = c.getContext("2d"); ctx.drawImage(image, 0, 0); image.close();
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const expected = await pixels(combined.bytes), actual = await pixels(published[0].bytes);
      check(expected.length === actual.length && expected.every((value, i) => value === actual[i]),
        "batch refresh lost the source-layer Warp or whole-result Warp pixels");
      const precise = structuredClone(combined.task);
      precise.template.operation.composition.planes[0].transform.content.warp.amount = 1 / 3;
      precise.template.operation.postprocess.stages[0].spec.content.warp.amount = -.123456789;
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["warped-result"] });
      send({ type: "source", generation, payload: { ...sources[0], sources, targetNodeId: "warped-result", task: precise } });
      await wait(() => !root.hidden && !role("apply").disabled, "precise Agent-authored Warp reopen");
      check(role("warp-amount-number").value === "-12.3457",
        `precise whole field projection: ${role("warp-amount-number").value}; ${role("error").textContent}`);
      role("warp").value = "flag"; role("warp").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !role("apply").disabled, "whole preset-only edit");
      role("edit-target").value = "layers"; role("edit-target").dispatchEvent(new Event("change", { bubbles: true }));
      check(role("layer-warp-amount-number").value === "33.3333", "precise layer field projection");
      role("layer-warp").value = "arch"; role("layer-warp").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !role("apply").disabled, "layer preset-only edit");
      const presetOnly = await publish();
      check(presetOnly.task.template.operation.composition.planes[0].transform.content.warp.amount === 1 / 3 &&
        presetOnly.task.template.operation.postprocess.stages[0].spec.content.warp.amount === -.123456789,
        "preset-only edit rounded precise saved strengths");
      role("layer-warp").value = ""; role("layer-warp").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !role("apply").disabled, "None removes layer Warp");
      const removed = await publish();
      check(!removed.task.template.operation.composition.planes[0].transform.content.warp &&
        removed.task.template.operation.postprocess.stages[0].spec.content.warp.amount === -.123456789,
        "removing layer Warp changed the independent whole Warp");
      check(document.documentElement.scrollWidth <= innerWidth, "layer Warp controls overflow the plugin width");
    } else if (scenario === "composition-motion") {
      const base={...payload,targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined};
      const sources=[{...base,sourceNodeId:"background",sourceName:"Back artwork",placement:{x:20,y:20,width:200,height:160}},{...base,sourceNodeId:"cover",sourceName:"Cover",placement:{x:80,y:40,width:180,height:140}}];
      generation++;send({type:"selection-loading",generation,nodeIds:sources.map(s=>s.sourceNodeId)});send({type:"source",generation,payload:{...sources[0],sources}});
      const root=get("#mockup-workspace"),role=name=>get('#mockup-workspace [data-role="'+name+'"]'),motion=name=>get('#mockup-workspace [data-motion="'+name+'"]');
      await wait(()=>!root.hidden&&!role("apply").disabled,"motion source workspace");
      check(!motion("enable").disabled,"animation is inaccessible on first entry");
      const change=(node,value)=>{node.value=value;node.dispatchEvent(new Event("change",{bubbles:true}))};
      change(role("edit-target"),"whole");await wait(()=>!role("apply").disabled,"complete Composition ready");
      role("whole-width").value="400";change(role("whole-height"),"240");change(role("warp"),"arch");change(role("warp-amount-number"),"20");
      await wait(()=>!role("apply").disabled,"whole transform before animation");
      const publish=async()=>{const seen=window.fixtureMessages.length;role("apply").click();await wait(()=>window.fixtureMessages.slice(seen).some(m=>m.type==="apply-designer"),"animated poster publication");const result=window.fixtureMessages.findLast(m=>m.type==="apply-designer").payload;send({type:"apply-designer-complete",generation,targetNodeId:"animation-result",operation:"replace"});return result};
      motion("enable").checked=true;motion("enable").dispatchEvent(new Event("change",{bubbles:true}));
      await wait(()=>!motion("editor").hidden&&!role("apply").disabled,"animation enabled");
      const initial=await publish();check(initial.task.motion.spec.frameCount===96&&initial.task.motion.frame===0,"timed program not persisted");
      check(initial.task.motion.spec.presentation.size.width===400&&initial.task.motion.spec.presentation.size.height===240&&initial.task.motion.spec.presentation.transform.content.warp.preset==="arch","complete temporal presentation not persisted");
      check(initial.task.template.operation.postprocess.stages[0].spec.content.warp.preset==="arch"&&initial.renderWidth===400&&initial.renderHeight===240,"animation discarded whole-result processing");
      const seek=async f=>{motion("position").value=String(f);motion("position").dispatchEvent(new Event("input",{bubbles:true}));await wait(()=>!role("apply").disabled&&Number(motion("position").value)===f,"timeline frame "+f)};
      await seek(24);change(role("edit-target"),"layers");await wait(()=>root.querySelector('.direct-point[data-point-id="tl"]')&&!role("apply").disabled,"pose overlay");
      const point=root.querySelector('.direct-point[data-point-id="tl"]');point.focus();key(point,"ArrowRight");
      await wait(()=>!role("apply").disabled&&!motion("remove").disabled,"pose revision and inspector ready");const edited=await publish();
      check(edited.task.motion.frame===24&&edited.task.motion.spec.planes.some(p=>p.keyframes.some(k=>k.frame===24)),"edited pose absent from full program");
      check(edited.task.motion.spec.planes.every(p=>p.keyframes[0].frame===0&&p.keyframes.at(-1).frame===95),"pose edit dropped another time");
      change(role("edit-target"),"whole");await seek(48);
      const corner=get('#mockup-workspace [data-role="whole-corners"] > div:nth-child(2) input');
      check(Boolean(corner),"whole view corner input missing");change(corner,"0.88");
      await wait(()=>!role("apply").disabled&&!motion("remove").disabled,"whole-view key pose saved");
      const wholeEdited=await publish();check(wholeEdited.task.motion.spec.presentation.keyframes.some(k=>k.frame===48&&k.quad.tr.x===.88),"whole view pose absent from saved work");
      check(wholeEdited.task.motion.spec.planes.every((p,index)=>JSON.stringify(p.keyframes)===JSON.stringify(edited.task.motion.spec.planes[index].keyframes)),"whole view edit changed layer poses");
      await seek(0);const firstView=await publish();check(firstView.task.template.operation.postprocess.stages[0].spec.destination.quad.tr.x!==.88,"whole view edit replaced all times");
      await seek(48);change(role("edit-target"),"layers");
      motion("position").value="30";motion("position").dispatchEvent(new Event("input",{bubbles:true}));motion("position").value="36";motion("position").dispatchEvent(new Event("input",{bubbles:true}));
      await wait(()=>!role("apply").disabled&&motion("position").value==="36","latest timeline intent");
      motion("capture").click();await wait(()=>!role("apply").disabled&&!motion("remove").disabled,"captured scene pose");
      const captured=await publish();check(captured.task.motion.spec.planes.every(p=>p.keyframes.some(k=>k.frame===36)),"capture missed a plane");
      motion("remove").click();await wait(()=>!role("apply").disabled&&motion("remove").disabled,"remove selected pose");
      const removed=await publish();check(removed.task.motion.spec.planes.filter(p=>p.keyframes.some(k=>k.frame===36)).length===1,"remove discarded another layer pose");
      change(motion("duration"),"6");await wait(()=>!role("apply").disabled&&motion("position").max==="143","retime all poses");
      const retimed=await publish();check(retimed.task.motion.spec.frameCount===144&&retimed.task.template.operation.postprocess.stages[0].spec.content.warp.preset==="arch","retime lost complete work");
      // The receiving clock paints prepared core frames; pause saves that exact pose.
      motion("play").click();await wait(()=>motion("play").getAttribute("aria-pressed")==="true","play prepared motion");
      const before=motion("position").value;check(!root.querySelector(".direct-point")?.checkVisibility(),"editing handles remain active during playback");await wait(()=>motion("position").value!==before,"actual motion clock advances");
      motion("play").click();await wait(()=>motion("play").getAttribute("aria-pressed")==="false"&&!role("apply").disabled,"pause keeps editable pose");
      const paused=await publish();check(paused.task.motion.frame>retimed.task.motion.frame,"pause lost playhead");
      await seek(143);motion("play").click();await wait(()=>motion("play").getAttribute("aria-pressed")==="true"&&Number(motion("position").value)<20,"replay from final frame");
      motion("play").click();await wait(()=>!role("apply").disabled,"replay pause");await seek(paused.task.motion.frame);
      get("#workspace-tab-perspective").click();generation++;send({type:"selection-loading",generation,nodeIds:["animation-result"]});send({type:"source",generation,payload:{...sources[0],sources,targetNodeId:"animation-result",task:paused.task}});
      await wait(()=>!root.hidden&&!role("apply").disabled&&motion("enable").checked,"cold reopen animated work");
      const reopened=await publish();check(JSON.stringify(reopened.task)===JSON.stringify(paused.task),"reopen changed timed or outer work");
      change(role("template-name"),"Animated cover");const seen=window.fixtureMessages.length;role("save-template").click();
      await wait(()=>window.fixtureMessages.slice(seen).some(m=>m.type==="save-template"),"save animated template");
      const saved=window.fixtureMessages.findLast(m=>m.type==="save-template");check(JSON.stringify(saved.template.motion)===JSON.stringify(paused.task.motion),"template save discarded animation");
      send({type:"template-library",templates:[{id:"animated-cover",name:"Animated cover",template:saved.template}],mutation:{kind:"save",workspace:"mockup",requestId:saved.requestId}});
      check(document.documentElement.scrollWidth<=innerWidth,"animation workspace overflows");
      motion("enable").closest("details").open=true;
      window.__WORLDBEND_INPUT_DONE__=false;
      window.__WORLDBEND_INPUT__={method:"Input.dispatchKeyEvent",params:{type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9},screenshot:innerWidth<400?"animation-narrow":"animation-desktop"};
      await wait(()=>window.__WORLDBEND_INPUT_DONE__,"rendered animation screenshot");
      change(motion("duration"),"20");await wait(()=>!role("apply").disabled,"invalid duration recovery retains valid program");
      check(role("error").textContent.length>0,"invalid motion feedback disappeared during repaint");
      const retained=await publish();check(retained.task.motion.spec.frameCount===144,"invalid retiming damaged accepted animation");
      // Transport is simulated; the real core prepares all streamed pixels.
      // Native graph copying, masks and encoding are separately host-verified.
      generation++;send({type:"selection-loading",generation,nodeIds:["animation-result"]});
      send({type:"source",generation,payload:{...sources[0],sources,targetNodeId:"animation-result",task:retained.task,sceneContext:true}});
      const scene=name=>get('#mockup-workspace [data-scene-animation="'+name+'"]');
      await wait(()=>!role("apply").disabled&&scene("create").checkVisibility()&&!scene("create").disabled,"complete scene authoring restored");
      let hold=true,held,frames=[],beginTask;
      const reply=(request,stage,extra={})=>send({type:"scene-animation-reply",generation:request.generation,requestId:request.requestId,stage,...extra});
      addEventListener("message",event=>{const request=event.data?.pluginMessage;
        if(request?.type==="scene-animation-begin"){beginTask=request.task;frames=[];reply(request,"ready");}
        if(request?.type==="scene-animation-frame"){
          if(hold){held=request;return;}frames.push(request.index);reply(request,"frame",{index:request.index});
        }
        if(request?.type==="scene-animation-finish")reply(request,"complete",{bytes:new Uint8Array([1,2,3]),nodeId:"native-animation",name:"Complete scene.mp4"});
      });
      // Cancellation while source decoding is pending must retire that exact
      // bitmap, even if the designer has already started a newer generation.
      const previousBitmap=globalThis.createImageBitmap;let blockedBitmap,releaseBitmap;
      globalThis.createImageBitmap=async(...args)=>{const bitmap=await previousBitmap(...args);if(!blockedBitmap){blockedBitmap=bitmap;await new Promise(resolve=>releaseBitmap=resolve);}return bitmap;};
      scene("create").click();await wait(()=>blockedBitmap&&scene("cancel").checkVisibility(),"scene source decode pending");
      scene("cancel").click();await wait(()=>!scene("create").disabled,"decode cancellation releases editor");
      globalThis.createImageBitmap=previousBitmap;
      scene("create").click();await wait(()=>held&&scene("cancel").checkVisibility(),"new generation starts before old decode resolves");
      releaseBitmap();await wait(()=>blockedBitmap.width===0,"cancelled source bitmap is retired");
      check(scene("cancel").checkVisibility(),"old decode retired the current generation");
      check(!scene("cancel").disabled,"busy state prevents cancellation");scene("cancel").click();
      await wait(()=>!scene("create").disabled,"cancel releases scene for retry");
      reply(held,"frame",{index:held.index});check(!scene("download").checkVisibility(),"late reply published cancelled work");
      // Every source frame is really prepared; the simulated host replies do
      // not make a multi-frame job fit a single-control five-second deadline.
      const expectedFrames=retained.task.motion.spec.frameCount;
      let completedFrames=0,lastFrameAt=performance.now();
      hold=false;scene("create").click();
      await wait(()=>{
        if(frames.length!==completedFrames){completedFrames=frames.length;lastFrameAt=performance.now();}
        if(!scene("download").checkVisibility()&&performance.now()-lastFrameAt>5000)
          throw Error("Scene frame stream stalled after "+completedFrames+"/"+expectedFrames+" frames; status="+scene("create").disabled);
        return scene("download").checkVisibility();
      },"complete native movie link",Math.max(5000,expectedFrames*250));
      check(frames.length===144&&frames.every((value,index)=>value===index),"complete scene skipped or repeated a canonical frame");
      check(JSON.stringify(beginTask.motion)===JSON.stringify(retained.task.motion),"scene animation changed the retained authoring programme");
      check(scene("download").download==="Complete scene.mp4"&&scene("download").href.startsWith("blob:"),"native movie bytes were not exposed as a file");
      check(!scene("create").disabled&&!scene("cancel").checkVisibility(),"successful encoding did not release editor");
    } else if (scenario === "composition-continuation") {
      const sourceBase = {
        ...payload,
        targetNodeId: undefined,
        nativeTarget: undefined,
        nativeRenderer: undefined,
      };
      const sources = [
        { ...sourceBase, sourceNodeId: "atmosphere", sourceName: "Atmosphere Plate", placement: { x: 40, y: 20, width: 200, height: 160 } },
        { ...sourceBase, sourceNodeId: "product", sourceName: "Product Plane", placement: { x: 80, y: 45, width: 180, height: 130 } },
        { ...sourceBase, sourceNodeId: "type", sourceName: "Type Overlay", placement: { x: 55, y: 35, width: 190, height: 140 } },
      ];
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: sources.map(source => source.sourceNodeId) });
      send({ type: "source", generation, payload: { ...sources[0], sources } });
      const root = get("#mockup-workspace");
      const role = name => get(`#mockup-workspace [data-role="${name}"]`);
      await wait(() => !root.hidden && root.querySelectorAll('[data-role="planes"] button').length === 3,
        "three-source Composition auto-route");

      const editTarget = role("edit-target");
      editTarget.value = "whole";
      editTarget.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !role("whole-panel").hidden && !role("apply").disabled,
        "whole-result Composition workspace");

      role("whole-width").value = "640";
      role("whole-height").value = "360";
      const cornerDisclosure = role("whole-corners-disclosure");
      // Chromium retains descendant layout boxes for closed native details;
      // visibility, rather than those cached dimensions, observes disclosure.
      check(!cornerDisclosure.open && !role("whole-corners").querySelector("input").checkVisibility(),
        "precision coordinates occupy the frequent warp/output controls");
      const cornerSummary = role("whole-corners-label");
      cornerSummary.focus();
      check(document.activeElement === cornerSummary, "perspective coordinates are not keyboard reachable");
      cornerSummary.click();
      check(cornerDisclosure.open && role("whole-corners").querySelector("input").checkVisibility(),
        "precision coordinates cannot be expanded");
      const corners = [...role("whole-corners").querySelectorAll("input")];
      ["0.04", "0.03", "0.94", "0.08", "0.98", "0.95", "0.08", "0.98"]
        .forEach((value, index) => { corners[index].value = value; });
      corners.at(-1).dispatchEvent(new Event("change", { bubbles: true }));
      cornerSummary.click();
      check(!cornerDisclosure.open && corners[0].value === "0.04", "collapsing precision controls lost an edit");
      role("warp").value = "arch";
      role("warp-amount-number").value = "40";
      role("warp-amount-number").dispatchEvent(new Event("change", { bubbles: true }));

      role("output-mode").value = "canvasSet";
      role("output-mode").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !role("variant-panel").hidden && role("variant").options.length === 1,
        "Composition Canvas Set output");
      role("variant-id").value = "wide";
      role("variant-operation").value = "cover";
      role("output-width").value = "900";
      role("output-height").value = "500";
      role("variant-id").dispatchEvent(new Event("change", { bubbles: true }));
      role("add-variant").click();
      await wait(() => role("variant").options.length === 2 && role("variant").value === "output-2",
        "second Composition output");
      role("variant-id").value = "square";
      role("variant-operation").value = "contain";
      role("output-width").value = "600";
      role("output-height").value = "600";
      role("variant-id").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !role("apply").disabled && root.querySelector("canvas").width === 600 &&
        root.querySelector("canvas").height === 600, "combined-result preview");

      const applySeen = window.fixtureMessages.length;
      role("apply").click();
      await wait(() => window.fixtureMessages.slice(applySeen).some(message => message.type === "apply-designer"),
        "continued Composition Apply");
      const publication = window.fixtureMessages.findLast(message => message.type === "apply-designer").payload;
      const publishedTask = publication.task;
      const publishedStage = publishedTask.template.operation.postprocess.stages[0];
      check(publishedTask.kind === "composition" &&
        publishedTask.template.operation.kind === "compositionProgram" &&
        publishedTask.template.operation.composition.planes.length === 3,
      "Apply lost the Composition Program or ordered sources");
      check(publishedStage.kind === "transform" && publishedStage.id === "whole-result" &&
        publishedStage.target_size.width === 640 && publishedStage.target_size.height === 360 &&
        publishedStage.spec.content.warp.preset === "arch" && publishedStage.spec.content.warp.amount === .4,
      "Apply lost the whole-result Perspective or Arch");
      check(publishedTask.previewOutputId === "square" &&
        JSON.stringify(publishedTask.template.output.spec.variants.map(variant => variant.id)) === JSON.stringify(["wide", "square"]) &&
        publication.renderWidth === 600 && publication.renderHeight === 600 && publication.bytes.length > 8,
      "Apply lost the selected output or named variants");
      send({ type: "apply-designer-complete", generation, targetNodeId: "composition-result", operation: "apply" });

      const routedUndoSeen = window.fixtureMessages.length;
      role("warp-amount-number").value = "45";
      role("warp-amount-number").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => role("warp-amount-number").value === "45", "post-Apply whole-result edit");
      key(role("warp-amount"), "z", { metaKey: true });
      await wait(() => role("warp-amount-number").value === "40", "whole-result local Undo");
      check(!window.fixtureMessages.slice(routedUndoSeen).some(message => message.type === "trigger-undo"),
        "Whole-result edit incorrectly routed Undo to the Figma document");

      get("#workspace-tab-perspective").click();
      const reopenedPayload = {
        ...sources[0],
        sources,
        targetNodeId: "composition-result",
        task: publishedTask,
        placement: { x: 300, y: 180, width: 600, height: 600 },
      };
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["composition-result"] });
      send({ type: "source", generation, payload: reopenedPayload });
      await wait(() => !root.hidden && role("edit-target").value === "whole" &&
        role("warp").value === "arch" && role("warp-amount-number").value === "40" &&
        role("variant").options.length === 2 && role("variant").value === "square",
      "reopened continued Composition");

      const replacement = {
        ...sources[1],
        sourceNodeId: "replacement-product",
        sourceName: "Replacement Product Asset",
        renderWidth: 240,
        renderHeight: 180,
        placement: { x: 72, y: 38, width: 240, height: 180 },
      };
      const replacedSources = [sources[0], replacement, sources[2]];
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["composition-result"] });
      send({ type: "source", generation, payload: { ...reopenedPayload, sources: replacedSources } });
      await wait(() => !root.hidden && role("warp-amount-number").value === "40", "replacement refresh");
      editTarget.value = "layers";
      editTarget.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => [...root.querySelectorAll('[data-role="planes"] button')]
        .some(button => button.textContent.includes("Replacement Product Asset")),
      "replacement retained the Composition relationship");
      editTarget.value = "whole";
      editTarget.dispatchEvent(new Event("change", { bubbles: true }));

      const stagedTask = structuredClone(publishedTask);
      stagedTask.template.operation.postprocess.stages[0].spec.content.warp.amount = .65;
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["composition-result"] });
      send({ type: "source", generation, payload: {
        ...reopenedPayload,
        sources: replacedSources,
        mockupDraft: {
          schema: "worldbend.figma.mockup-draft",
          version: "0.1",
          baseRevision: 2,
          task: stagedTask,
        },
      } });
      await wait(() => !root.hidden && role("warp-amount-number").value === "65" &&
        !role("agent-conflict").hidden && role("apply").disabled === false,
      "Agent-staged continued Composition");
      check(window.fixtureErrors.length === 0, `fixture errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "scene-draft") {
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
      get("#workspace-tab-mesh").click();
      await wait(() => !get("#mesh-workspace").hidden, "Mesh workspace entered");
      await settle();
      const hiddenDraftCount = drafts().length;
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: [payload.targetNodeId] });
      send({ type: "source", generation, payload });
      await wait(() => !get('#mesh-workspace [data-role="apply"]').disabled, "Mesh source refreshed");
      await settle();
      check(drafts().length === hiddenDraftCount, "A hidden Perspective refresh revived its canvas preview over Mesh");
      get("#workspace-tab-perspective").click(); await ready();
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
      const backdrop = { ...art, sourceNodeId: "backdrop", sourceName: "Studio scene", placement: { x: 800, y: 200, width: 600, height: 400 }, quadGuide: {
        tl: { x: 860, y: 240 }, tr: { x: 1340, y: 220 }, br: { x: 1310, y: 560 }, bl: { x: 890, y: 580 },
      } };
      send({ type: "source", generation, payload: { ...art, targetNodeId: undefined, nativeTarget: undefined, nativeRenderer: undefined, sources: [art, backdrop] } });
      await wait(() => !get("#workspace-tab-mockup").disabled, "scene selection");
      get("#workspace-tab-mockup").click();
      await wait(() => get("#mockup-workspace").querySelectorAll('[data-role="planes"] button').length === 2, "scene layers");
      const draftsBeforeCompositionEdit = drafts().length;
      await settle();
      check(drafts().length === draftsBeforeCompositionEdit,
        "Opening Composition mutated the document before an edit");
      const fitQuad = get("#mockup-workspace").querySelector('[data-role="fit-quad"]');
      check(!fitQuad.hidden && fitQuad.textContent === "Fit artwork to quad", "explicit Vector quad did not expose Fit artwork to quad");
      fitQuad.click();
      await wait(() => get("#mockup-workspace").querySelector('[data-role="width"]').value === "600", "fit artwork to quad");
      get("#mockup-workspace").querySelectorAll('[data-role="planes"] button')[0].click();
      check(get("#mockup-workspace").querySelector('[data-role="opacity"]').value === "0",
        "Fit artwork to quad rendered the guide Vector into the result");
      get('#mockup-workspace [data-role="reset"]').click();
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
    } else if (scenario === "fit-to-shape") {
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["art", "badge"] });
      const art = { ...payload, sourceNodeId: "art", sourceName: "Poster artwork" };
      // A smooth elliptical badge outline assembled from four cubics, closed,
      // in a 600x400 document box at (800, 200).
      const k = 0.5522847498307936;
      const shapeGuide = {
        contours: [{
          start: { x: 1100, y: 200 },
          segments: [
            { kind: "cubic", to: { x: 1400, y: 400 }, c1: { x: 1100 + 300 * k, y: 200 }, c2: { x: 1400, y: 400 - 200 * k } },
            { kind: "cubic", to: { x: 1100, y: 600 }, c1: { x: 1400, y: 400 + 200 * k }, c2: { x: 1100 + 300 * k, y: 600 } },
            { kind: "cubic", to: { x: 800, y: 400 }, c1: { x: 1100 - 300 * k, y: 600 }, c2: { x: 800, y: 400 + 200 * k } },
            { kind: "cubic", to: { x: 1100, y: 200 }, c1: { x: 800, y: 400 - 200 * k }, c2: { x: 1100 - 300 * k, y: 200 } },
          ],
        }],
        fillRule: "evenOdd",
        bounds: { x: 800, y: 200, width: 600, height: 400 },
      };
      const boxContour = (x0, y0, x1, y1) => ({ start: { x: x0, y: y0 }, segments: [
        { kind: "line", to: { x: x1, y: y0 } }, { kind: "line", to: { x: x1, y: y1 } },
        { kind: "line", to: { x: x0, y: y1 } }, { kind: "line", to: { x: x0, y: y0 } },
      ] });
      shapeGuide.contours.push(boxContour(1040, 340, 1160, 460), boxContour(1100, 300, 1220, 500));
      shapeGuide.regions = [{ contourIndices: [0, 1], fillRule: "evenOdd" }, { contourIndices: [2], fillRule: "nonZero" }];
      const badge = { ...art, sourceNodeId: "badge", sourceName: "Badge outline",
        renderWidth: 600, renderHeight: 400, placement: { x: 800, y: 200, width: 600, height: 400 }, shapeGuide };
      send({ type: "source", generation, payload: { ...art, targetNodeId: undefined, nativeTarget: undefined, nativeRenderer: undefined, sources: [art, badge] } });
      await wait(() => !get("#workspace-tab-mockup").disabled, "scene selection");
      get("#workspace-tab-mockup").click();
      const root = get("#mockup-workspace");
      await wait(() => root.querySelectorAll('[data-role="planes"] button').length === 2, "scene layers");
      const fitShape = root.querySelector('[data-role="fit-shape"]');
      check(!fitShape.hidden && fitShape.textContent === "Clip artwork to shape", "closed Vector outline did not expose Fit artwork to shape");
      check(root.querySelector('[data-role="fit-quad"]').hidden, "a curved outline must not offer the quad affordance");
      fitShape.click();
      await wait(() => root.querySelector('[data-role="width"]').value === "600", "fit artwork to shape");
      root.querySelectorAll('[data-role="planes"] button')[0].click();
      check(root.querySelector('[data-role="opacity"]').value === "0",
        "Fit artwork to shape rendered the outline Vector into the result");
      await wait(() => !root.querySelector('[data-role="apply"]').disabled, "shape fit ready");
      const preview = root.querySelector(".designer-preview canvas");
      const alphaAt = (x, y) => {
        const pixels = preview.getContext("2d").getImageData(0, 0, preview.width, preview.height).data;
        return pixels[(y * preview.width + x) * 4 + 3];
      };
      // The default two-layer canvas (900x400) renders first; wait for the
      // clipped 600x400 fit to land before probing pixels.
      await wait(() => Math.abs(preview.width / preview.height - 1.5) < 0.01 && preview.width !== 900,
        "fit artwork to shape preview canvas");
      await wait(() => alphaAt(2, 2) === 0 && alphaAt(preview.width - 3, preview.height - 3) === 0 &&
        alphaAt(Math.floor(preview.width / 2), Math.floor(preview.height / 2)) > 200,
        `the elliptical clip did not mask the canvas corners (tl=${alphaAt(2, 2)}, ` +
        `br=${alphaAt(preview.width - 3, preview.height - 3)}, ` +
        `c=${alphaAt(Math.floor(preview.width / 2), Math.floor(preview.height / 2))})`);
      await wait(() => alphaAt(Math.floor(preview.width * .45), Math.floor(preview.height * .5)) === 0 &&
        alphaAt(Math.floor(preview.width * .65), Math.floor(preview.height * .5)) > 200,
        "independent clip regions lost their hole or cancelled overlapping fills");
      const applySeen = window.fixtureMessages.length;
      root.querySelector('[data-role="apply"]').click();
      await wait(() => window.fixtureMessages.slice(applySeen).some(m => m.type === "apply-designer"), "shape publication request");
      const applied = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check(applied.task.kind === "mockup" && applied.task.spec.clip?.contours?.length === 3 &&
        applied.task.spec.clip.fillRule === "evenOdd" && applied.task.spec.clip.contours[0].segments.length === 4 &&
        applied.task.spec.clip.regions?.length === 2 && applied.task.spec.clip.regions[1].fillRule === "nonZero",
        "the published task lost its explicit clip");
      check(applied.renderWidth === 600 && applied.renderHeight === 400, "published shape canvas size");
      send({ type: "apply-designer-complete", generation, targetNodeId: "result", operation: "apply" });
      // Reopen leg: the main thread re-reads the stored task from the result
      // node and replays it into the workspace with its bound sources.
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["result"] });
      send({ type: "source", generation, payload: { ...art, targetNodeId: "result",
        nativeTarget: undefined, nativeRenderer: undefined, sources: [art, badge], task: applied.task } });
      await wait(() => get("#workspace-tab-mockup").disabled === false, "reopen selection");
      const reopened = get("#mockup-workspace");
      await wait(() => !reopened.hidden, "reopen routed back to Composition");
      await wait(() => reopened.querySelector('[data-role="width"]').value === "600", "reopen restored the fitted canvas");
      check(reopened.querySelector('[data-role="planes"] button[aria-selected="true"]').textContent === "Poster artwork",
        "reopening a fitted workpiece selected its invisible guide instead of editable artwork");
      reopened.querySelectorAll('[data-role="planes"] button')[0].click();
      check(reopened.querySelector('[data-role="opacity"]').value === "0",
        "reopen lost the hidden guide plane");
      const reopenedPreview = reopened.querySelector(".designer-preview canvas");
      await wait(() => Math.abs(reopenedPreview.width / reopenedPreview.height - 1.5) < 0.01 && reopenedPreview.width !== 900,
        "reopen preview canvas");
      const reopenedAlpha = (x, y) => {
        const pixels = reopenedPreview.getContext("2d").getImageData(0, 0, reopenedPreview.width, reopenedPreview.height).data;
        return pixels[(y * reopenedPreview.width + x) * 4 + 3];
      };
      await wait(() => reopenedAlpha(2, 2) === 0 && reopenedAlpha(reopenedPreview.width - 3, 2) === 0 &&
        reopenedAlpha(Math.floor(reopenedPreview.width / 2), Math.floor(reopenedPreview.height / 2)) > 200,
        "reopen lost the clip mask");
      check(!reopened.querySelector('[data-role="apply-new"]').hidden,
        "reopen lost the in-place update affordance");
      check(window.fixtureErrors.length === 0, `fixture errors: ${window.fixtureErrors.join("; ")}`);
    } else if(scenario==='foil-workspace') {
      generation+=1;
      const root=get('#appearance-workspace');
      const recipe={schema:'worldbend.foil@0.1',version:'0.1',recipeId:'warm-foil',recipeVersion:1,
        material:{visible:true,baseColor:{r:.72,g:.71,b:.68,a:.85},highlightColor:{r:.98,g:.92,b:.78,a:.6},lightAngle:120,intensity:.55,roughness:.23,flowSpeed:.25}};
      const resource={importId:'current/build',paintId:'current-paint/build',sourceSha256:'source-checked-current'};
      let foil={nodeId:'panel',name:'Foil panel',eligible:true,state:'untagged-native',live:structuredClone(recipe.material),provenance:null,customized:[],
        profile:'worldbend.foil.rgba@0.1',resource,available:resource,canChoose:true,canAdopt:false,warnings:[]};
      let second={...structuredClone(foil),nodeId:'copy',name:'Local copy',live:{...structuredClone(recipe.material),baseColor:{r:.1,g:.2,b:.3,a:.4}}};
      let selected=[foil,second];
      const sendStates=()=>{
        const absent=selected.map(n=>({nodeId:n.nodeId,name:n.name,eligible:false,reason:'no-effects',state:'absent',customized:[]}));
        send({type:'appearance-state',generation,nodes:absent.map(n=>({...n,glassCount:0}))});
        send({type:'texture-state',generation,nodes:absent.map(n=>({...n,noiseCount:0,textureCount:0}))});
        send({type:'foil-state',generation,nodes:JSON.parse(JSON.stringify(selected))});
      };
      const enter=async()=>{
        send({type:'selection-loading',generation,nodeIds:selected.map(n=>n.nodeId)});
        send({type:'source',generation,payload:{...payload,sourceNodeId:'panel',sourceName:'Foil panel',targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined}});
        await wait(()=>!get('#workspace-tab-appearance').disabled,'Foil entry');get('#workspace-tab-appearance').click();sendStates();
      };
      const nativeInput=async(method,params,screenshot)=>{
        window.__WORLDBEND_INPUT_DONE__=false;window.__WORLDBEND_INPUT__={method,params,screenshot};
        await wait(()=>window.__WORLDBEND_INPUT_DONE__,'trusted Foil input');
      };
      const latestTrial=()=>window.fixtureMessages.findLast(m=>m.type==='request-material-trial');
      const acceptTrial=(request)=>send({type:'material-trial',generation,requestId:request.requestId,ok:true,canvas:false,previews:[]});
      const inputValue=(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));};
      await enter();send({type:'material-library',materials:[]});
      root.querySelector('[data-family="foil"]').click();
      for(const id of ['warm-foil','silver-foil','rose-foil'])check(root.querySelector(`[data-recipe="${id}"]`)?.parentElement.hidden===false,'Foil card missing: '+id);
      root.querySelector('[data-action="tune-foil"]').click();
      const color=()=>root.querySelector('input[data-field="base-color"][data-channel="rgb"]');
      const alpha=()=>root.querySelector('input[data-field="base-color"][data-channel="alpha"]');
      check(alpha().value===''&&alpha().placeholder,'mixed opacity is not exposed');
      alpha().focus();alpha().select();await nativeInput('Input.dispatchKeyEvent',{type:'char',text:'25'});
      await wait(()=>latestTrial()?.edit.colorChannels?.['base-color']?.join()==='a','opacity-only Foil trial');
      let request=latestTrial();
      check(request.edit.fields.join()==='base-color'&&request.edit.material.baseColor.a===.25,'RGBA field edit missing');
      check(color().dataset.mixed==='true','opacity edit erased the mixed RGB state');
      acceptTrial(request);check(!root.querySelector('[data-role="apply"]').disabled,'Foil Apply stayed locked after preview');
      root.querySelector('[data-role="apply"]').click();
      await wait(()=>window.fixtureMessages.some(m=>m.type==='apply-material'),'Foil apply request');
      const apply=window.fixtureMessages.findLast(m=>m.type==='apply-material');
      check(JSON.stringify(apply.edit)===JSON.stringify(request.edit),'Apply changed the previewed edit');
      foil.live.baseColor.a=second.live.baseColor.a=.25;
      send({type:'material-applied',generation,results:selected.map(n=>({nodeId:n.nodeId,outcome:'applied'}))});sendStates();
      check(root.querySelector('.material-save button').disabled,'mixed colors were saved as one look');
      inputValue(color(),'#123456');
      await wait(()=>latestTrial()?.edit.colorChannels?.['base-color']?.join()==='r,g,b','RGB-only Foil trial');
      request=latestTrial();check(request.edit.material.baseColor.a===.25,'RGB input changed untouched opacity');
      root.querySelector('[data-role="reset"]').click();
      check(root.querySelector('footer').hidden,'Cancel left a pending Foil candidate');
      // Current renderer presets travel as a complete RGBA recipe.
      const card=root.querySelector('[data-recipe="silver-foil"]');card.scrollIntoView({block:'nearest'});
      const box=card.getBoundingClientRect(),point={x:box.x+box.width/2,y:box.y+box.height/2,button:'left',clickCount:1};
      await nativeInput('Input.dispatchMouseEvent',{type:'mousePressed',buttons:1,...point});
      await nativeInput('Input.dispatchMouseEvent',{type:'mouseReleased',buttons:0,...point});
      await wait(()=>latestTrial()?.edit.recipe.recipeId==='silver-foil','Foil preset');request=latestTrial();
      check(!request.edit.fields&&!request.edit.colorChannels&&!request.edit.adopt,'preset retained field/adoption state');
      await nativeInput('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8},innerWidth===300?'foil-controls-narrow':'foil-controls-wide');
      root.querySelector('[data-role="reset"]').click();
      // Late previews cannot restore a candidate invalidated by a native edit.
      inputValue(alpha(),30);await wait(()=>latestTrial()?.edit.material.baseColor.a===.3,'pending Foil candidate');request=latestTrial();
      foil.live.intensity=.35;sendStates();acceptTrial(request);
      check(root.querySelector('footer').hidden&&root.querySelector('[data-role="apply"]').disabled,'stale native edit allowed late Apply');
      // Save, serialized storage, reopen and reapply the declared current look.
      selected=[foil];generation+=1;await enter();root.querySelector('[data-action="tune-foil"]').click();
      const name=root.querySelector('.material-save input');name.value='Local warm foil';
      root.querySelector('.material-save').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      await wait(()=>window.fixtureMessages.some(m=>m.type==='save-material'),'Foil save request');
      const save=window.fixtureMessages.findLast(m=>m.type==='save-material');
      check(save?.material.edit.family==='foil'&&JSON.stringify(save.material.edit.recipe.material)===JSON.stringify(save.material.edit.material),'RGBA save did not retain the complete declared look');
      const stored=JSON.parse(JSON.stringify([save.material]));send({type:'material-library',materials:stored});
      generation+=1;await enter();send({type:'material-library',materials:stored});
      root.querySelector(`[data-recipe="${save.material.edit.recipe.recipeId}"]`).click();
      await wait(()=>latestTrial()?.edit.recipe.recipeId===save.material.edit.recipe.recipeId,'reopened saved Foil');
      check(JSON.stringify(latestTrial().edit.material)===JSON.stringify(save.material.edit.material),'saved RGBA changed on reopen');
      root.querySelector('[data-role="reset"]').click();
      // Earlier optics remain editable but cannot masquerade as current presets.
      foil={...foil,profile:'worldbend.foil.prototype@0.1',canChoose:false,canAdopt:false,warnings:['explicit-renderer-adoption-required']};
      selected=[foil];sendStates();root.querySelector('[data-family="foil"]').click();root.querySelector('[data-action="tune-foil"]').click();
      check(root.querySelector('[data-recipe="warm-foil"]').disabled,'legacy renderer silently accepted a current preset');
      check(root.querySelector('.material-save button').disabled,'legacy optical look saved under current profile');
      check(root.querySelector('input[data-field="highlight-color"][data-channel="alpha"]').disabled,'legacy ignored highlight alpha exposed as supported');
      check(root.querySelector('.appearance-status').textContent.includes('Earlier Foil renderer'),'legacy state not explained');
      foil.canAdopt=true;foil.available=resource;sendStates();
      root.querySelector('[data-action="adopt-foil"]').click();
      await wait(()=>latestTrial()?.edit.adopt===true,'explicit renderer adoption preview');
      check(!latestTrial().edit.fields,'renderer adoption became an ordinary field edit');
      root.querySelector('[data-role="reset"]').click();
      foil={...foil,eligible:false,reason:'unavailable',live:null,available:null,canAdopt:false,warnings:[]};selected=[foil];sendStates();
      check(root.querySelector('.appearance-status').textContent.includes('not ready'),'unavailable resource did not remain recoverable');
      check(!root.querySelector('[data-action="tune-foil"]'),'failed capture appeared as a live default look');
    } else if (scenario === "appearance-workspace" || scenario === "texture-workspace") {
      generation += 1;
      send({type:"selection-loading",generation,nodeIds:["panel","caption"]});
      send({type:"source",generation,payload:{...payload,sourceNodeId:"panel",sourceName:"Material panel",targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined}});
      await wait(()=>!get("#workspace-tab-appearance").disabled,"material entry");
      get("#workspace-tab-appearance").click();
      const root=get("#appearance-workspace"), texture=scenario==="texture-workspace";
      const glassSeed={schema:"worldbend.appearance@0.1",version:"0.1",recipeId:"clear-lens",recipeVersion:1,
        material:{visible:true,lightIntensity:0.5,lightAngle:90,refraction:0.35,depth:2,dispersion:0,radius:12}};
      const paperSeed={schema:"worldbend.texture@0.1",version:"0.1",recipeId:"warm-paper",recipeVersion:1,
        material:{visible:true,grain:0.35,grainSize:3,grainColor:"#8a7f72",etch:1.5,etchSize:4,clipToShape:true}};
      const glass={nodeId:"panel",name:"Material panel",eligible:true,glassCount:1,state:"customized",live:{...glassSeed.material,radius:31},provenance:glassSeed,customized:["radius"]};
      const paper={nodeId:"panel",name:"Material panel",eligible:true,noiseCount:1,textureCount:1,state:"untagged-native",live:{...paperSeed.material,grain:0.62},customized:[]};
      const unsupported={nodeId:"caption",name:"Caption",eligible:false,reason:"no-effects",state:"absent",customized:[]};
      const sendStates=()=>{send({type:"appearance-state",generation,nodes:[glass,{...unsupported,glassCount:0}]});send({type:"texture-state",generation,nodes:[paper,{...unsupported,noiseCount:0,textureCount:0}]});};
      sendStates(); send({type:"material-library",materials:[]});
      const nativePng="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      await wait(()=>window.fixtureMessages.some(m=>m.type==="request-material-preview"),"native artwork preview request");
      const nativeRequest=window.fixtureMessages.findLast(m=>m.type==="request-material-preview");
      send({type:"material-preview",generation,requestId:nativeRequest.requestId,previews:[{bytes:nativePng,width:200,height:160}]});
      check(root.querySelector(".material-stage-images img")?.src.endsWith(nativePng),"large preview did not show actual native artwork");
      const thumb=root.querySelector(".material-card").getBoundingClientRect(), stage=root.querySelector(".material-stage").getBoundingClientRect();
      check(thumb.width<=110&&stage.width>thumb.width*2&&stage.height>thumb.height*2,"thumbnail choice replaced the large viewing area");
      const grip=get(".window-resize");grip.focus();key(grip,"ArrowRight");
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="resize-ui")?.width===innerWidth+20,"keyboard window resize route");
      await wait(()=>root.querySelector("h1").textContent==="2 selected","workpiece scope");
      for(const id of ['clear-lens','frosted-panel','prism-edge','warm-paper','etched-card','frosted-plastic','warm-foil','silver-foil','rose-foil'])
        check(root.querySelector(`[data-recipe="${id}"] img`)?.hidden===false,'material thumbnail missing: '+id);
      check(root.querySelector(".material-tuning").hidden,"parameters open before a design choice");
      check(root.querySelector(".material-stage")&&!root.querySelector(".designer-preview"),"material browser missing its artwork preview area");
      check(!window.fixtureMessages.some(m=>m.type==="request-material-trial"),"entering the browser changed the canvas");
      const help=root.querySelector('[data-role="preview-help"]');help.focus();key(help,"Enter");
      check(help.getAttribute("aria-expanded")==="true","material help cannot open by keyboard");
      key(help,"Escape");check(!root.hidden,"help Escape left the material browser");
      const family=texture?"texture":"glass", preset=texture?"warm-paper":"clear-lens";
      const visible=root.querySelector(`[data-action="toggle-${family}"]`);
      visible.click();
      check(!root.querySelector(`[data-action="toggle-${family}"]`).checked,"visibility toggle reverted before Apply");
      check(!root.querySelector('.appearance-visible input').checked,"tuning visibility disagrees with the applied-state toggle");
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-material-trial")?.edit.fields?.includes("visible"),"visibility trial");
      check(window.fixtureMessages.findLast(m=>m.type==="request-material-trial").edit.material.visible===false,"visibility control did not disable its own material");
      root.querySelector('[data-role="reset"]').click();
      check(root.querySelector(`[data-action="toggle-${family}"]`).checked,"Cancel did not restore native visibility");
      root.querySelector(`[data-action="tune-${family}"]`).click();
      check(!root.querySelector(".material-tuning").hidden,"applied effect tuning missing");
      const field=texture?"grain":"radius", nativeValue=texture?"0.62":"31";
      check(root.querySelector(`input[data-field="${field}"]`).value===nativeValue,"native edits were replaced by a seed");
      const card=root.querySelector(`[data-recipe="${preset}"]`);card.focus();card.click();
      await wait(()=>{const trial=window.fixtureMessages.findLast(m=>m.type==="request-material-trial");return trial?.edit.recipe.recipeId===preset&&!trial.edit.fields;},"in-place trial request");
      let request=window.fixtureMessages.findLast(m=>m.type==="request-material-trial");
      check(request.edit.family===family&&!request.edit.fields,"a chosen card did not replace its own look");
      if(!texture)check(request.edit.recipe.recipeVersion===2&&request.edit.material.radius===1,"clear lens card does not use its native clear recipe");
      check(root.querySelectorAll('.material-card[aria-pressed="true"]').length===1,"multiple candidate cards selected");
      check(document.activeElement===card,"re-render lost card keyboard focus");
      check(root.querySelector('[data-role="apply"]').disabled,"Apply enabled before a visible trial");
      send({type:"material-trial",generation,requestId:request.requestId,ok:false});
      await wait(()=>root.querySelector(".material-feedback").dataset.state==="failed","trial failure feedback");
      root.querySelector(".material-feedback button").click();
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-material-trial").requestId!==request.requestId,"retry the same look");
      let retry=window.fixtureMessages.findLast(m=>m.type==="request-material-trial");
      send({type:"material-trial",generation,requestId:request.requestId,ok:true});
      check(root.querySelector('[data-role="apply"]').disabled,"late preview unlocked a different trial");
      send({type:"material-trial",generation,requestId:retry.requestId,ok:true,previews:[{bytes:nativePng,width:200,height:160},{bytes:nativePng,width:200,height:160}]});
      check(!root.querySelector('[data-role="apply"]').disabled,"successful trial did not enable Apply");
      check(root.querySelectorAll(".material-stage-images img").length===2,"only the first selected scene was previewed");
      const previewBeforeCancel=window.fixtureMessages.findLast(m=>m.type==="request-material-preview");
      root.querySelector('[data-role="reset"]').click();
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-material-preview").requestId!==previewBeforeCancel.requestId,"Cancel did not resume native context observation");
      check(root.querySelectorAll(".material-stage-images img").length===1,"Cancel did not restore the applied native preview");
      check(root.querySelector("footer").hidden&&root.querySelector(`input[data-field="${field}"]`).value===nativeValue,"Cancel lost native values");
      send({type:"material-trial",generation,requestId:retry.requestId,ok:true});
      check(root.querySelector("footer").hidden,"late trial resurrected cancelled work");
      root.querySelector(`[data-action="tune-${family}"]`).click();
      const number=root.querySelector(texture?'input[data-value-for="grain"]':'input[data-field="radius"]');
      number.value=texture?"0.4701":"40";number.dispatchEvent(new Event("input",{bubbles:true}));
      root.querySelector('.material-filter [data-family="glass"]').click();root.querySelector('.material-filter [data-family="texture"]').click();
      send({type:"locale",preference:"zh-CN",locale:"zh-CN"});send({type:"locale",preference:"en",locale:"en"});
      check(number.value===(texture?"0.4701":"40"),"filter or locale discarded exact tuning");
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-material-trial").edit.fields?.includes(field),"selective native tuning trial");
      request=window.fixtureMessages.findLast(m=>m.type==="request-material-trial");
      check(request.edit.fields.length===1,"one field edit replaced other native fields");
      if(!texture)check(request.edit.recipe.recipeVersion===1&&request.edit.recipe.material.radius===12,"legacy native provenance overwritten on reopen");
      send({type:"material-trial",generation,requestId:request.requestId,ok:true});
      number.value="";number.dispatchEvent(new Event("input",{bubbles:true}));
      check(root.querySelector('[data-role="apply"]').disabled,"blank numeric draft permits Apply");
      number.value=texture?"0.4701":"40";number.dispatchEvent(new Event("input",{bubbles:true}));
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-material-trial").requestId!==request.requestId,"restored number retried preview");
      request=window.fixtureMessages.findLast(m=>m.type==="request-material-trial");send({type:"material-trial",generation,requestId:request.requestId,ok:true});
      check(root.querySelector('[data-role="apply"]').textContent.includes("1/2"),"unsupported layer scope was hidden");
      root.querySelector('[data-role="apply"]').click();
      await wait(()=>window.fixtureMessages.some(m=>m.type==="apply-material"),"material apply request");
      const apply=window.fixtureMessages.findLast(m=>m.type==="apply-material");
      check(apply.generation===generation&&JSON.stringify(apply.edit.fields)===JSON.stringify([field]),"apply lost native selective edit");
      send({type:"material-applied",generation:generation-1,results:[]});check(root.querySelector('[data-role="apply"]').disabled,"stale apply unlocked outstanding work");
      send({type:"material-applied",generation,results:[{nodeId:"panel",outcome:"applied",replacedUntagged:false},{nodeId:"caption",outcome:"skipped",reason:"no-effects"}]});
      if(texture)paper.live.grain=0.4701;else glass.live.radius=40;sendStates();
      check(root.querySelector('[data-role="status"]').textContent==="Appearance applied.","apply announcement missing");
      root.querySelector(`[data-action="tune-${family}"]`).click();
      // Figma's sandbox supplies getRandomValues, but not secure-context randomUUID.
      Object.defineProperty(crypto,"randomUUID",{configurable:true,value:undefined});
      const name=root.querySelector(".material-save input");name.value="My look";root.querySelector(".material-save").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
      await wait(()=>window.fixtureMessages.some(m=>m.type==="save-material"),"save a reusable look");
      const saved=window.fixtureMessages.findLast(m=>m.type==="save-material").material;
      check(saved.name==="My look"&&!saved.edit.fields&&saved.edit.recipe.recipeId.startsWith(`user-${family}-`),"saved look carries a field patch");
      check(saved.edit.material[field]===Number(texture?"0.4701":"40"),"saved look lost actual native values");
      send({type:"material-library",materials:[saved]});
      check(root.querySelector(`[data-recipe="${saved.edit.recipe.recipeId}"]`),"saved look not available for later work");
      root.querySelector('.material-filter [data-family="all"]').click();
      root.querySelector(`[data-recipe="${saved.edit.recipe.recipeId}"]`).click();
      root.querySelector('[data-role="tune-trial"]').click();
      check(root.querySelector('.material-tuning h2').textContent==="My look","saved variation name lost during tuning");
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-material-trial").edit.recipe.recipeId===saved.edit.recipe.recipeId,"saved look trial");
      const beforeContext=window.fixtureMessages.findLast(m=>m.type==="request-material-trial");
      send({type:"material-context-changed",generation});
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-material-trial").requestId!==beforeContext.requestId,"context change did not re-render pending look");
      check(root.querySelector(`[data-recipe="${saved.edit.recipe.recipeId}"]`).getAttribute("aria-pressed")==="true","backdrop change discarded the material choice");
      check(window.fixtureMessages.findLast(m=>m.type==="request-material-trial").edit.material[field]===saved.edit.material[field],"context refresh changed tuned values");

      root.querySelector('[data-role="reset"]').click();
      root.querySelector(`[data-recipe="${saved.edit.recipe.recipeId}"]`).parentElement.querySelector(".material-delete").click();
      await wait(()=>window.fixtureMessages.some(m=>m.type==="delete-material"),"saved look has no removal route");
      send({type:texture?"texture-state":"appearance-state",generation,nodes:[{...(texture?paper:glass),provenance:saved.edit.recipe}]});
      send({type:"material-library",materials:[]});
      check(!root.textContent.includes(saved.edit.recipe.recipeId),"deleting a library entry exposed an internal id on the applied artwork");
      sendStates();
      // Mixed tuning changes only the field acted on, with a visible Mixed state.
      const second=texture?{...paper,nodeId:"second",live:{...paper.live,grain:0.8,grainSize:9}}:{...glass,nodeId:"second",live:{...glass.live,radius:80,depth:99}};
      send({type:texture?"texture-state":"appearance-state",generation,nodes:[texture?paper:glass,second]});
      root.querySelector(`[data-action="tune-${family}"]`).click();
      const mixed=root.querySelector(texture?'input[data-value-for="grain"]':'input[data-field="radius"]');
      check(mixed.value===""&&mixed.placeholder==="Mixed","mixed native fields are represented as a made-up common value");
      const selective=root.querySelector(texture?'input[data-field="grain-size"]':'input[data-field="depth"]');selective.value="7";selective.dispatchEvent(new Event("input",{bubbles:true}));
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-material-trial").edit.fields?.includes(texture?"grain-size":"depth"),"mixed selective field trial");
      check(window.fixtureMessages.findLast(m=>m.type==="request-material-trial").edit.fields.length===1,"mixed field change overwrites other values");
      send({type:"selection-loading",generation:++generation,nodeIds:["next"]});
      check(root.querySelector("footer").hidden,"switching workpieces retained an old trial");
      check(window.fixtureErrors.length===0,`fixture errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "card-workspace") {
      generation += 1;
      send({type:"selection-loading",generation,nodeIds:["card"]});
      send({type:"source",generation,payload:{...payload,sourceNodeId:"card",sourceName:"Hero card",cardResult:true,targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined}});
      await wait(()=>!get("#workspace-tab-card").disabled,"card entry");
      const root=get("#card-workspace");
      await wait(()=>!root.hidden && get("#workspace-tab-card").getAttribute("aria-selected")==="true","saved view did not reopen its owning card workspace");
      await wait(()=>window.fixtureMessages.some(m=>m.type==="request-card-state"),"card state read");
      send({type:"card-state",generation,nodes:[{nodeId:"card",name:"Hero card",width:320,height:200}]});
      await wait(()=>window.fixtureMessages.some(m=>m.type==="request-card-source"),"card source request");
      const sourceRequest=window.fixtureMessages.findLast(m=>m.type==="request-card-source");
      const art=document.createElement("canvas"); art.width=640;art.height=400;
      const ctx=art.getContext("2d");ctx.fillStyle="#123456";ctx.beginPath();ctx.roundRect(0,0,640,400,40);ctx.fill();ctx.fillStyle="white";ctx.font="24px sans-serif";ctx.fillText("Sharp original · 012345",36,100);
      const png=art.toDataURL("image/png").split(",")[1];
      send({type:"card-source",generation,requestId:sourceRequest.requestId,bytes:png,width:640,height:400});
      const front=root.querySelector("[data-role=front-image]");
      await wait(()=>!front.hidden,"front artwork visible");
      await wait(()=>front.style.transform.includes("perspective("),"live rest pose painted");
      const cardStage = root.querySelector('[data-role="stage"]');
      const cardCanvas = root.querySelector('.card-raster-preview');
      await wait(()=>cardStage.classList.contains('has-raster-preview') && cardCanvas.width > 1,
        "shared raster preview painted");
      const cardGl = cardCanvas.getContext('webgl2');
      check(cardGl && cardGl.getError() === cardGl.NO_ERROR, "card preview did not use a healthy WebGL renderer");
      const loseCardContext = cardGl.getExtension('WEBGL_lose_context');
      check(loseCardContext, "context loss fixture unavailable");
      loseCardContext.loseContext();
      await wait(()=>!cardStage.classList.contains('has-raster-preview'), "context loss did not recover the CSS preview");
      loseCardContext.restoreContext();
      try {
        await wait(()=>cardStage.classList.contains('has-raster-preview'), "context restore did not recover the shared raster preview");
      } catch (error) {
        throw new Error(`${error}; contextLost=${cardGl.isContextLost()}, glError=${cardGl.getError()}, ` +
          `status=${root.querySelector('[data-role="status"]').textContent}, errors=${window.fixtureErrors.join(';')}`);
      }
      check(!root.querySelector('[data-role="turn"]').disabled,"turn unavailable after initial artwork load");
      const turnButton = root.querySelector('[data-role="turn"]');
      turnButton.click();
      await wait(()=>turnButton.disabled, "active turn did not lock its trigger");
      await wait(()=>root.querySelector('[data-role="stage-status"]').textContent.includes('Back'),
        "live mirrored back was not presented during a full turn");
      await wait(()=>!turnButton.disabled && root.querySelector('[data-role="stage-status"]').textContent.includes('1.00'),
        "turn did not complete with its retained revolution count");
      check(cardStage.classList.contains('has-raster-preview'), "turn abandoned the shared raster preview");
      check(root.querySelector('[data-role="apply"]').textContent==="Save behavior","behavior button falsely promises image output");
      const direction = root.querySelector('select[data-field="direction"]');
      check([...direction.options].map(option=>option.textContent).join(',')==='Forward,Reverse',
        "turn direction exposed internal signs instead of usable choices");
      direction.value='-1';direction.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>[...root.querySelectorAll('.card-view button')].some(button=>button.textContent.includes('-180°')),
        "reverse direction did not update the turn poses");
      direction.value='1';direction.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>front.style.transform.includes('perspective('), "forward direction preview was not ready");
      const previewScale=front.clientWidth/320;
      const perspective=Number(front.style.transform.match(/perspective\(([^p]+)px\)/)?.[1]);
      check(Math.abs(perspective-1000*previewScale)<.01,"live rest pose did not preserve artwork-relative perspective");
      check(root.querySelectorAll(".card-view").length===10,"derived views missing rest, tilt extrema and turn samples");
      check(root.querySelector(".material-tuning")===null,"card authoring must not reuse the material tuning shell");
      // Direct precise pose editing drives the preview through the same core pose.
      const rotateY=root.querySelector('input[data-field="rotate-y"]');
      rotateY.value="24";rotateY.dispatchEvent(new Event("input",{bubbles:true}));
      await wait(()=>front.style.transform.includes("rotateY(24deg)"),"direct pose edit did not reach the preview");
      const tiltMax=root.querySelector('input[data-field="max-tilt-y"]');
      tiltMax.value="22";tiltMax.dispatchEvent(new Event("input",{bubbles:true}));
      check(window.fixtureMessages.every(m=>m.type!=="apply-card-rig"),"the workspace wrote state before Apply");
      // Derived turn views preview through core card_pose; the edge-on sample refuses a still.
      for (const [field,value] of [["pivot-x",.25],["pivot-y",.7]]) {
        const input = root.querySelector(`[data-field="${field}"]`);
        input.value = value; input.dispatchEvent(new Event("input",{bubbles:true}));
      }
      const rest24 = root.querySelector('input[data-field="rotate-y"]');
      rest24.value="0";rest24.dispatchEvent(new Event("input",{bubbles:true}));
      const turn50=[...root.querySelectorAll(".card-view button")].find(button=>button.textContent.includes("180°"));
      turn50.click();
      await wait(()=>front.style.transform.includes("rotateY(180deg)"),"turn sample did not preview the half turn");
      await wait(()=>{
        const area = cardStage.getBoundingClientRect(), image = front.getBoundingClientRect();
        return image.left >= area.left+15 && image.top >= area.top+15 && image.right <= area.right-15 && image.bottom <= area.bottom-15;
      }, "off-center back pose was clipped or its input layer lost the fitted position");
      const fittedImage = front.getBoundingClientRect();
      check(document.elementFromPoint((fittedImage.left+fittedImage.right)/2,(fittedImage.top+fittedImage.bottom)/2)===front,
        "fitted raster artwork cannot be reached by the pointer");
      // A 90-degree pose is edge-on when the camera and pivot share their
      // center. The off-center case above intentionally changes that geometry.
      for (const field of ["pivot-x","pivot-y"]) {
        const input = root.querySelector(`[data-field="${field}"]`);
        input.value = .5; input.dispatchEvent(new Event("input",{bubbles:true}));
      }
      const edgeView=root.querySelectorAll(".card-view button")[6];edgeView.click();
      await wait(()=>root.querySelector('[data-role="publish-current"]').disabled,"edge-on view must not offer a still");
      const restViewForOutput=root.querySelectorAll(".card-view button")[0];restViewForOutput.click();
      await wait(()=>!root.querySelector('[data-role="publish-current"]').disabled,"rest still available");
      await wait(()=>cardStage.classList.contains('has-raster-preview') && cardCanvas.width > 1,
        "raster preview did not recover from an edge view");
      root.querySelector('[data-role="publish-current"]').click();
      try { await wait(()=>window.fixtureMessages.some(m=>m.type==="publish-card-still"),"still render request"); }
      catch (error) {throw new Error(`${error}; error=${root.querySelector('.designer-error').textContent}, ` +
        `pose=${front.style.transform}, disabled=${root.querySelector('[data-role="publish-current"]').disabled}`);}
      const still=window.fixtureMessages.findLast(m=>m.type==="publish-card-still");
      check(still.bytes.length>100&&(still.view.rotateY??0)===0,"still lost its view identity");
      check(still.rig.schema==="worldbend.card"&&still.rig.tilt.maxRotateY===22,"still did not carry the authored rig");
      send({type:"card-still-published",generation,nodeId:"still-1"});
      await wait(()=>root.querySelector('[data-role="status"]').textContent.includes("View saved")||root.querySelector('[data-role="status"]').textContent.includes("still"),"still publication feedback");
      await wait(()=>root.querySelector('[data-role="publish-current"]').textContent==="Update view","saved view update action missing");
      root.querySelector('[data-role="save-copy"]').click();
      await wait(()=>window.fixtureMessages.filter(m=>m.type==="publish-card-still").length===2,"save a distinct new view");
      const savedCopy=window.fixtureMessages.findLast(m=>m.type==="publish-card-still");
      check(savedCopy.viewId!==still.viewId&&savedCopy.sample.kind==="pose","new view overwrote the prior view or lost sample provenance");
      send({type:"card-still-published",generation,requestId:savedCopy.requestId-1,nodeId:"stale"});
      await new Promise(resolve=>requestAnimationFrame(resolve));
      check(root.querySelector('[data-role="publish-current"]').disabled,"stale publication completion released a new job");
      send({type:"card-still-published",generation,requestId:savedCopy.requestId,nodeId:"still-2"});
      await wait(()=>!root.querySelector('[data-role="publish-current"]').disabled,"save-copy completion");
      // Scrubbing suspends the live controller and drives explicit progress.
      const scrub=root.querySelector('[data-role="scrub"]');
      scrub.value="75";scrub.dispatchEvent(new Event("input",{bubbles:true}));
      await wait(()=>root.querySelector('[data-role="stage-status"]').textContent.includes("Scrub")||root.querySelector('[data-role="stage-status"]').textContent.includes("浏览"),"scrub status");
      await wait(()=>front.style.transform.includes("rotateY("),"scrub pose did not render");
      root.querySelector('[data-role="publish-current"]').click();
      await wait(()=>window.fixtureMessages.filter(m=>m.type==="publish-card-still").length===3,"scrubbed view save");
      const scrubbed=window.fixtureMessages.findLast(m=>m.type==="publish-card-still");
      check(scrubbed.sample.kind==="turn"&&scrubbed.sample.progress===.75,"scrub time provenance lost");
      check((scrubbed.view.rotateY??0)>270,"scrub ignored the authored easing curve");
      send({type:"card-still-published",generation,requestId:scrubbed.requestId,nodeId:"still-3"});
      await wait(()=>!root.querySelector('[data-role="publish-current"]').disabled,"scrub save completion");
      // Escape while scrubbing cancels the scrub and restores the live stage.
      get("#workspace-tab-card").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
      await wait(()=>!front.style.transform.includes("rotateY(270deg)"),"escape did not cancel the scrub");
      // A selected static view keeps owning the stage even with idle motion on;
      // the live controller must not repaint over the override each frame.
      const idleToggle=root.querySelector('[data-role="idle-toggle"]');
      idleToggle.click();
      const restView=[...root.querySelectorAll(".card-view button")].find(button=>button.textContent.trim()==="Rest");
      restView.click();
      await wait(()=>front.style.transform.includes("rotateZ(0deg) rotateY(0deg) rotateX(0deg)"),"rest view did not take over the stage");
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      check(front.style.transform.includes("rotateZ(0deg) rotateY(0deg) rotateX(0deg)"),"idle motion stomped the selected static view");
      // Pressing the shown view again returns to the live preview.
      restView.click();
      await wait(()=>{const status=root.querySelector('[data-role="stage-status"]').textContent;return status.includes("Front")||status.includes("正面")||status.includes("rev");},"toggling the view did not restore the live preview");
      // Apply stores the accepted rig; a second node offers the explicit back face.
      root.querySelector('[data-role="apply"]').click();
      await wait(()=>window.fixtureMessages.some(m=>m.type==="apply-card-rig"),"apply request");
      const applied=window.fixtureMessages.findLast(m=>m.type==="apply-card-rig");
      check(applied.generation===generation&&applied.rig.tilt.maxRotateY===22,"apply lost the authored envelope");
      check(applied.rig.elementSize.width===320,"apply did not retain the artwork size");
      send({type:"card-rig-applied",generation});
      await wait(()=>root.querySelector('[data-role="status"]').textContent.length>0,"apply announcement");
      const refreshStart=window.fixtureMessages.filter(m=>m.type==="publish-card-still").length;
      const beforeFreshSource=window.fixtureMessages.findLast(m=>m.type==="request-card-source"&&!m.back).requestId;
      send({type:"card-state",generation,nodes:[{nodeId:"card",name:"Hero card",width:320,height:200,rig:applied.rig,stills:[{viewId:still.viewId,view:still.view}]},{nodeId:"back",name:"Back art",width:320,height:200}]});
      await wait(()=>!root.querySelector('[data-role="back-assign"]').hidden,"second selection did not offer a back face");
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-card-source"&&!m.back).requestId>beforeFreshSource,"new source request after behavior save");
      const freshSource=window.fixtureMessages.findLast(m=>m.type==="request-card-source"&&!m.back);
      send({type:"card-source",generation,requestId:freshSource.requestId,bytes:png,width:640,height:400});
      await wait(()=>cardStage.classList.contains('has-raster-preview') && root.querySelector('.designer-error').hidden,
        "source refresh did not recover the raster preview without errors");
      const refreshedCanvas = root.querySelector('.card-raster-preview');
      check(refreshedCanvas.getContext('webgl2') && !refreshedCanvas.getContext('webgl2').isContextLost(),
        "source refresh reused a released graphics context");
      await wait(()=>window.fixtureMessages.filter(m=>m.type==="publish-card-still").length===refreshStart+1,"existing view refresh after behavior save");
      const freshStill=window.fixtureMessages.findLast(m=>m.type==="publish-card-still");
      send({type:"card-still-published",generation,requestId:freshStill.requestId,nodeId:"still-1"});
      await wait(()=>!root.querySelector('[data-role="apply"]').disabled,"initial linked refresh completion");
      root.querySelector('[data-role="back-assign"]').click();
      await wait(()=>window.fixtureMessages.some(m=>m.type==="request-card-source"&&m.nodeId==="back"),"back source request");
      send({type:"card-source",generation,requestId:window.fixtureMessages.findLast(m=>m.type==="request-card-source").requestId,bytes:png,width:640,height:400,back:true});
      await wait(()=>!root.querySelector('[data-role="back-image"]').hidden,"authored back layer missing");
      check(root.querySelector('[data-role="back-image"]').style.transform.includes("rotateY(180deg)"),"back layer is not pre-rotated");
      // Removing an authored back must immediately repaint a held static
      // view with the mirrored front, rather than hiding both layers.
      root.querySelectorAll('.card-view button')[7].click();
      await wait(()=>front.style.backfaceVisibility==='hidden' && front.style.transform.includes('rotateY(180deg)'), "authored static back ready");
      root.querySelector('[data-role="back-assign"]').click();
      await wait(()=>front.style.backfaceVisibility==='visible', "removing the authored back left the held view invisible");
      root.querySelector('[data-role="back-assign"]').click();
      const backAgain=window.fixtureMessages.findLast(m=>m.type==='request-card-source'&&m.back);
      send({type:'card-source',generation,requestId:backAgain.requestId,bytes:png,width:640,height:400,back:true});
      await wait(()=>front.style.backfaceVisibility==='hidden', "reassigned back did not repaint the held view");
      get('#workspace-tab-card').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      // Accepted pose survives host refresh and Reset remains reversible with Cancel.
      const currentY=root.querySelector('[data-field="rotate-y"]'); currentY.value="18";currentY.dispatchEvent(new Event("input",{bubbles:true}));
      root.querySelector('[data-role="apply"]').click();
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="apply-card-rig")?.rig.rest?.rotateY===18,"rest pose not persisted");
      const accepted=window.fixtureMessages.findLast(m=>m.type==="apply-card-rig").rig;
      send({type:"card-rig-applied",generation});
      const beforeRefresh=window.fixtureMessages.filter(m=>m.type==="publish-card-still").length;
      const beforeAcceptedSource=window.fixtureMessages.findLast(m=>m.type==="request-card-source"&&!m.back).requestId;
      send({type:"card-state",generation,nodes:[{nodeId:"card",name:"Hero card",width:320,height:200,rig:accepted,backNodeId:"back",
        stills:[{viewId:"derived-1",view:{rotateX:-10}},{viewId:"custom-keep",view:{rotateX:5,rotateY:13},sample:{kind:"pose"}}],
        selectedStill:{viewId:"derived-6",view:{rotateY:90}}}]});
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-card-source"&&!m.back).requestId>beforeAcceptedSource,"accepted source refresh");
      const req=window.fixtureMessages.findLast(m=>m.type==="request-card-source"&&!m.back);
      send({type:"card-source",generation,requestId:req.requestId,bytes:png,width:640,height:400});
      send({type:"card-source",generation,requestId:req.requestId,bytes:png,width:640,height:400,back:true});
      await wait(()=>window.fixtureMessages.filter(m=>m.type==="publish-card-still").length===beforeRefresh+1,"linked derived view refresh");
      const refreshed=window.fixtureMessages.findLast(m=>m.type==="publish-card-still");
      check(refreshed.viewId==="derived-1"&&refreshed.view.rotateY===18&&refreshed.view.rotateX===-10,"derived view was not rebuilt from accepted rest");
      send({type:"card-still-published",generation,requestId:refreshed.requestId,nodeId:"existing-derived"});
      await wait(()=>window.fixtureMessages.filter(m=>m.type==="publish-card-still").length===beforeRefresh+2,"linked custom view refresh");
      const refreshedCustom=window.fixtureMessages.findLast(m=>m.type==="publish-card-still");
      check(refreshedCustom.viewId==="custom-keep"&&refreshedCustom.view.rotateY===13,"refresh replaced a custom pose with a derived pose");
      send({type:"card-still-published",generation,requestId:refreshedCustom.requestId,nodeId:"existing-custom"});
      await wait(()=>!root.querySelector('[data-role="apply"]').disabled,"linked refresh completion");
      check(Number(root.querySelector('[data-field="rotate-y"]').value)===18,"old selected still overwrote the accepted pose");
      root.querySelector('[data-role="reset"]').click();
      check(Number(root.querySelector('[data-field="rotate-y"]').value)===0,"Reset did not restore defaults");
      const beforeRecovery=window.fixtureMessages.findLast(m=>m.type==="request-card-source").requestId;
      root.querySelector('[data-role="cancel"]').click();
      check(Number(root.querySelector('[data-field="rotate-y"]').value)===18,"Cancel did not recover the accepted pose after Reset");
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==="request-card-source").requestId>beforeRecovery,"fresh back recovery request");
      const recoveryRequest=window.fixtureMessages.findLast(m=>m.type==="request-card-source");
      check(recoveryRequest.back===true,"Cancel did not reacquire the accepted authored back");
      send({type:"card-source",generation,requestId:recoveryRequest.requestId,bytes:png,width:640,height:400,back:true});
      await wait(()=>!root.querySelector('[data-role="back-image"]').hidden,"accepted back did not recover after Reset");
      let delivery;
      Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{delivery=JSON.parse(text)}}});
      root.querySelector('[data-role="copy-json"]').click();
      await wait(()=>delivery!==undefined,"card delivery export");
      check(delivery.schema==="worldbend.card-delivery"&&delivery.rig.rest.rotateY===18&&delivery.front.pngBase64===png&&delivery.back.pngBase64===png,"delivery envelope lost artwork or accepted pose");
      // Refine a derived pose into a chosen still, then save the behavior.
      // Its old derived ID cannot erase that deliberate refinement.
      root.querySelectorAll('.card-view button')[7].click();
      const refinedY=root.querySelector('[data-field="rotate-y"]');
      refinedY.value='205';refinedY.dispatchEvent(new Event('input',{bubbles:true}));
      await wait(()=>front.style.transform.includes('rotateY(205deg)'), 'refined static turn ready');
      const beforeRefinedSave=window.fixtureMessages.filter(m=>m.type==='publish-card-still').length;
      root.querySelector('[data-role="publish-current"]').click();
      await wait(()=>window.fixtureMessages.filter(m=>m.type==='publish-card-still').length===beforeRefinedSave+1, 'refined static turn saved');
      const refined=window.fixtureMessages.findLast(m=>m.type==='publish-card-still');
      check(refined.view.rotateY===205&&refined.sample.kind==='pose', 'refined view retained incorrect derived provenance');
      send({type:'card-still-published',generation,requestId:refined.requestId,nodeId:'refined-view'});
      await wait(()=>!root.querySelector('[data-role="apply"]').disabled, 'refined view save completed');
      root.querySelector('[data-role="apply"]').click();
      send({type:'card-rig-applied',generation});
      const beforeRefinedRefresh=window.fixtureMessages.findLast(m=>m.type==='request-card-source').requestId;
      send({type:'card-state',generation,nodes:[{nodeId:'card',name:'Hero card',width:320,height:200,rig:accepted,backNodeId:'back',
        stills:[{viewId:refined.viewId,view:refined.view,sample:refined.sample}]}]});
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==='request-card-source').requestId>beforeRefinedRefresh, 'refined view fresh artwork');
      const refinedRequest=window.fixtureMessages.findLast(m=>m.type==='request-card-source');
      send({type:'card-source',generation,requestId:refinedRequest.requestId,bytes:png,width:640,height:400});
      send({type:'card-source',generation,requestId:refinedRequest.requestId,bytes:png,width:640,height:400,back:true});
      await wait(()=>window.fixtureMessages.filter(m=>m.type==='publish-card-still').length===beforeRefinedSave+2, 'refined view refreshed');
      const refinedRefresh=window.fixtureMessages.findLast(m=>m.type==='publish-card-still');
      check(refinedRefresh.view.rotateY===205, 'behavior save erased the refined static turn');
      send({type:'card-still-published',generation,requestId:refinedRefresh.requestId,nodeId:'refined-view'});
      await wait(()=>!root.querySelector('[data-role="publish-current"]').disabled, 'refined refresh complete');
      // A workspace round trip during an outstanding save remains usable;
      // a late acknowledgement cannot restore the abandoned job.
      root.querySelector('[data-role="publish-current"]').click();
      await wait(()=>window.fixtureMessages.filter(m=>m.type==='publish-card-still').length===beforeRefinedSave+3, 'pending round-trip publication');
      const abandoned=window.fixtureMessages.findLast(m=>m.type==='publish-card-still');
      get('#workspace-tab-perspective').click();
      await wait(()=>root.hidden, 'leave card during publication');
      const beforeResumeRequest=window.fixtureMessages.findLast(m=>m.type==='request-card-source').requestId;
      const beforeResumeState=window.fixtureMessages.filter(m=>m.type==='request-card-state').length;
      get('#workspace-tab-card').click();
      await wait(()=>!root.hidden&&window.fixtureMessages.filter(m=>m.type==='request-card-state').length>beforeResumeState, 'reenter card after publication');
      send({type:'card-state',generation,nodes:[{nodeId:'card',name:'Hero card',width:320,height:200,rig:accepted}]});
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==='request-card-source').requestId>beforeResumeRequest, 'resumed card source request');
      const resumedRequest=window.fixtureMessages.findLast(m=>m.type==='request-card-source');
      send({type:'card-source',generation,requestId:resumedRequest.requestId,bytes:png,width:640,height:400});
      send({type:'card-still-published',generation,requestId:abandoned.requestId,nodeId:'abandoned-view'});
      try {await wait(()=>!root.hidden&&!root.querySelector('[data-role="apply"]').disabled&&!root.querySelector('[data-role="publish-current"]').disabled, 'card stayed locked after leaving a save');}
      catch(error) {throw new Error(`${error}; hidden=${root.hidden}, apply=${root.querySelector('[data-role="apply"]').disabled}, publish=${root.querySelector('[data-role="publish-current"]').disabled}, frontHidden=${front.hidden}, status=${root.querySelector('[data-role="stage-status"]').textContent}, error=${root.querySelector('.designer-error').textContent}, messages=${JSON.stringify(window.fixtureMessages.slice(-8).map(m=>({type:m.type,requestId:m.requestId,generation:m.generation})))}`);}
      check(root.querySelector('.designer-error').hidden, 'abandoned save left a stale error on the reopened card');
      // Encoding can outlive a workspace round trip even before the host
      // receives a publication. Reentering the same generation is not enough
      // to grant that abandoned job ownership again.
      const beforeEncodingSave=window.fixtureMessages.filter(m=>m.type==='publish-card-still').length;
      const encode=HTMLCanvasElement.prototype.toBlob;
      let releaseEncoding, abandonedBytesRead=false;
      HTMLCanvasElement.prototype.toBlob=function(callback,...args) {
        encode.call(this,blob=>{
          const read=blob.arrayBuffer.bind(blob);
          blob.arrayBuffer=async()=>{const bytes=await read();abandonedBytesRead=true;return bytes;};
          releaseEncoding=()=>callback(blob);
        },...args);
      };
      root.querySelector('[data-role="publish-current"]').click();
      await wait(()=>releaseEncoding!==undefined, 'save held during encoding');
      HTMLCanvasElement.prototype.toBlob=encode;
      get('#workspace-tab-perspective').click();
      await wait(()=>root.hidden, 'leave card during encoding');
      const beforeEncodingState=window.fixtureMessages.filter(m=>m.type==='request-card-state').length;
      const beforeEncodingSource=window.fixtureMessages.findLast(m=>m.type==='request-card-source').requestId;
      get('#workspace-tab-card').click();
      await wait(()=>!root.hidden&&window.fixtureMessages.filter(m=>m.type==='request-card-state').length>beforeEncodingState, 'reenter card during encoding');
      send({type:'card-state',generation,nodes:[{nodeId:'card',name:'Hero card',width:320,height:200,rig:accepted}]});
      await wait(()=>window.fixtureMessages.findLast(m=>m.type==='request-card-source').requestId>beforeEncodingSource, 'reentered card fresh source');
      const encodingSource=window.fixtureMessages.findLast(m=>m.type==='request-card-source');
      send({type:'card-source',generation,requestId:encodingSource.requestId,bytes:png,width:640,height:400});
      await wait(()=>!root.querySelector('[data-role="publish-current"]').disabled, 'reentered card usable before encoding finishes');
      releaseEncoding();
      await wait(()=>abandonedBytesRead, 'abandoned encoded result completed');
      await delay();
      check(window.fixtureMessages.filter(m=>m.type==='publish-card-still').length===beforeEncodingSave, 'abandoned encoding published into the reopened workspace');
      const boundaryY=root.querySelector('[data-field="rotate-y"]');
      boundaryY.value='3600';boundaryY.dispatchEvent(new Event('input',{bubbles:true}));
      root.querySelectorAll('.card-view button')[7].click();
      await wait(()=>front.style.transform.includes('rotateY(180deg)')&&!root.querySelector('[data-role="publish-current"]').disabled, 'derived turn exhausted the legal resting-angle domain');
      const boundaryScrub=root.querySelector('[data-role="scrub"]');
      boundaryScrub.value='75';boundaryScrub.dispatchEvent(new Event('input',{bubbles:true}));
      await wait(()=>{
        const angle=Number(root.querySelector('[data-field="rotate-y"]').value);
        return angle>270&&angle<=360;
      }, 'eased scrub exhausted the legal resting-angle domain');
      check(root.querySelector('.designer-error').hidden, 'composed boundary pose produced a core schema error');
      check(window.fixtureErrors.length===0,`fixture errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "designer-experience") {
      get("#mode-warp").click();
      await wait(() => !get("#warp-picker-trigger").disabled, "visual preset entry");
      get("#warp-picker-trigger").click();
      await wait(() => document.querySelectorAll("#warp-picker-options svg").length === 11, "core-generated preset thumbnails");
      check(!get("#warp-picker-options").hidden, "Preset picker closed while thumbnails loaded");
      get('[data-warp-preset="arc"]').click();
      await wait(() => get("#warp-picker-trigger").textContent === "Arc" && get("#apply").textContent === "New Linked HD Image" && !get("#apply").disabled, "Arc selection");
      check(get("#apply").textContent === "New Linked HD Image" && get("#action-apply-copy").hidden, "Warp falsely offers native replacement or duplicates image action");
      get("#warp-picker-trigger").click();
      get("#warp-picker-options").dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}));
      check(get("#warp-picker-options").hidden && document.activeElement === get("#warp-picker-trigger"), "Escape did not restore picker focus");
      generation++;
      send({type:"selection-loading",generation,nodeIds:["art","backdrop"]});
      const art = {...payload, sourceNodeId:"art",sourceName:"Poster artwork",targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined};
      const backdrop = {...art,sourceNodeId:"backdrop",sourceName:"Studio scene",placement:{x:800,y:200,width:600,height:400}};
      send({type:"source",generation,payload:{...art,sources:[art,backdrop]}});
      await wait(() => !get("#workspace-tab-mockup").disabled, "scene selection");
      get("#workspace-tab-mockup").click();
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
      check(saved.slots?.length === 2 && saved.slots[0].name === "Poster artwork" && saved.slots[1].name === "Studio scene",
        "the saved scene lost its editable slot descriptors");
      send({type:"template-library",templates:[{id:"studio",name:saved.name,template:saved.template,slots:saved.slots,
        appearance:{supported:["perspective","opacity"],unsupported:["clip","masking","occlusion","lighting"]}}],
        mutation:{kind:"save",workspace:"mockup",requestId:saved.requestId}});
      get("#workspace-tab-templates").click();
      await wait(() => get('.template-item-preview').querySelector('svg'), "reusable scene thumbnail");
      check(get(".template-item-detail").textContent.includes("Poster artwork") &&
        get(".template-item-detail").textContent.includes("200×160"),
        "template list hid the saved slot dimensions");
      check(get(".template-item-detail").textContent.includes("No scene masking"),
        "template list hid the appearance boundary");
      get('.template-item').click();
      get('#templates-workspace [data-role="apply"]').click();
      await wait(() => !root.hidden && !root.querySelector('[data-role="apply"]').disabled, "reopen scene template");
      const seen = window.fixtureMessages.length;
      root.querySelector('[data-role="apply"]').click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), "scene output");
      const published = window.fixtureMessages.findLast(m => m.type === "apply-designer");
      check(published.payload.task.spec.planes[0].sourceId === "source-2", "Publication lost backdrop source mapping");
    } else if (scenario === "free-outline") {
      const {nativeTarget:_nt,nativeRenderer:_nr,targetNodeId:_target,...plain}=payload;
      await refresh(plain);
      get("#workspace-tab-surface").click();
      const pin="#surface-workspace",mesh="#mesh-workspace";
      const readyPanel=async panel=>{try{await wait(()=>!get(panel).hidden&&!get(`${panel} [data-role="apply"]`).disabled,"ready "+panel);}catch(error){throw Error(error.message+" hidden="+get(panel).hidden+" panelError="+get(`${panel} [data-role="error"]`).textContent+" global="+get("#error-text").textContent+" messages="+JSON.stringify(window.fixtureMessages.slice(-4).map(m=>({type:m.type,message:m.message}))));}};
      await readyPanel(pin);
      check(!document.querySelector(`${pin} [data-point-id="1"]`),"legacy fixed boundary became editable");
      const choose=(panel,value)=>{const field=get(`${panel} [data-role="deformation-boundary"]`);field.value=value;field.dispatchEvent(new Event("change",{bubbles:true}));};
      // Navigate away in the planning turn, then resume the same unpublished work.
      choose(pin,"free");
      get("#workspace-tab-remap").click();
      get("#workspace-tab-surface").click();
      await readyPanel(pin);
      check(!get(`${pin} [data-role="deformation-boundary"]`).disabled,"interrupted boundary choice left Pin locked");
      choose(pin,"free");
      check(get(`${pin} [data-role="deformation-boundary"]`).disabled && get(`${pin} [data-role="reset"]`).disabled,"boundary planning did not isolate pending edits");
      await wait(()=>document.querySelector(`${pin} [data-point-id="1"]`)&&!get(`${pin} [data-role="apply"]`).disabled,"free cubic controls");
      const tangent=()=>get(`${pin} [data-point-id="7"]`),tangentBefore=tangent().style.top;
      key(tangent(),"ArrowDown");
      await wait(()=>tangent().style.top!==tangentBefore&&!get(`${pin} [data-role="apply"]`).disabled,"right-edge tangent edit stays in bounds");
      key(tangent(),"z",{metaKey:true});
      await wait(()=>tangent().style.top===tangentBefore&&!get(`${pin} [data-role="apply"]`).disabled,"right-edge tangent undo");
      const point=()=>get(`${pin} [data-point-id="1"]`);
      const original=point().style.top,originalHeight=get(`${pin} canvas`).height;
      const native=async(method,params,screenshot)=>{window.__WORLDBEND_INPUT_DONE__=false;window.__WORLDBEND_INPUT__={method,params,...(screenshot?{screenshot}:{})};await wait(()=>window.__WORLDBEND_INPUT_DONE__,"outline pointer input");};
      let box=point().getBoundingClientRect(),preview=get(`${pin} canvas`).getBoundingClientRect();
      const x=box.left+box.width/2,y=box.top+box.height/2;
      await native("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",buttons:1,clickCount:1});
      await native("Input.dispatchMouseEvent",{type:"mouseMoved",x,y:y-preview.height*.12,button:"left",buttons:1});
      await native("Input.dispatchMouseEvent",{type:"mouseReleased",x,y:y-preview.height*.12,button:"left",buttons:0,clickCount:1});
      await wait(()=>point().style.top!==original&&get(`${pin} canvas`).height>originalHeight&&!get(`${pin} [data-role="apply"]`).disabled,"dragged cubic outline");
      const curved=point().style.top;
      key(point(),"z",{metaKey:true});
      await wait(()=>point().style.top===original,"outline undo");
      key(point(),"z",{metaKey:true,shiftKey:true});
      await wait(()=>point().style.top===curved&&!get(`${pin} [data-role="apply"]`).disabled,"outline redo");
      choose(pin,"fixed");
      await wait(()=>!get(`${pin} [data-role="deformation-boundary"]`).disabled,"rejected lossy lock");
      check(get(`${pin} [data-role="deformation-boundary"]`).value==="free","invalid lock discarded cubic geometry");
      check(!get(`${pin} [data-role="error"]`).hidden,"invalid lock has no reason");
      check(/Undo.*Reset/.test(get(`${pin} [data-role="error"]`).textContent),"Pin boundary refusal has no editing recovery");
      get("#workspace-tab-mesh").click();await readyPanel(mesh);
      check(get(`${mesh} [data-role="deformation-boundary"]`).value==="free","Mesh lost free boundary policy");
      const edge=()=>get(`${mesh} [data-point-id="6"]`),edgeBefore=edge().style.top;
      key(edge(),"ArrowDown");
      await wait(()=>edge().style.top!==edgeBefore&&!get(`${mesh} [data-role="apply"]`).disabled,"mesh edge nudge");
      const publish=async()=>{const count=window.fixtureMessages.length;get(`${mesh} [data-role="apply"]`).click();await wait(()=>window.fixtureMessages.slice(count).some(m=>m.type==="apply-designer"),"free outline publication");return window.fixtureMessages.findLast(m=>m.type==="apply-designer").payload;};
      const first=await publish();
      check(first.task.spec.boundary==="free"&&first.task.spec.surface.envelope.points[1].y<0,"publication lost cubic outline");
      check(first.task.spec.meshEdits.some(e=>e.row===0),"publication lost edge edit");
      check(window.fixtureMessageGuard({type:"apply-designer",payload:first}),"free work failed real host message guard");
      send({type:"apply-designer-complete",generation,targetNodeId:"free-result",operation:"apply"});
      const saved=JSON.parse(JSON.stringify(first.task));
      await refresh({...plain,sourceNodeId:"other",targetNodeId:undefined});
      await refresh({...plain,targetNodeId:"free-result",task:saved,placement:first.placement,
        targetRasterSize:{width:first.renderWidth,height:first.renderHeight}});await readyPanel(mesh);
      check(get(`${mesh} [data-role="deformation-boundary"]`).value==="free","cold reopen lost outline mode");
      const second=await publish();check(JSON.stringify(second.task)===JSON.stringify(saved),"cold reopen altered saved curve or edge intent");
      send({type:"apply-designer-complete",generation,targetNodeId:"free-result",operation:"replace",
        publication:{placement:second.placement,renderWidth:second.renderWidth,renderHeight:second.renderHeight}});
      get("#workspace-tab-perspective").click();await ready();
      check(get("#output-size-flow").textContent.includes(`${second.renderWidth} × ${second.renderHeight}`),"Plane size label differs from complete saved canvas");
      const beforePlanePublish=window.fixtureMessages.length;
      get("#apply").click();
      await wait(()=>window.fixtureMessages.slice(beforePlanePublish).some(m=>m.type==="apply-designer"),"outward Plane publication");
      const planePublished=window.fixtureMessages.findLast(m=>m.type==="apply-designer").payload;
      check(JSON.stringify(planePublished.task.spec)===JSON.stringify(saved.spec),"Plane publication changed the authored outward frame");
      check(planePublished.renderWidth===second.renderWidth&&planePublished.renderHeight===second.renderHeight,"Plane publication clipped or resized the outward canvas");
      check(planePublished.bytes.length===second.bytes.length&&planePublished.bytes.every((b,i)=>b===second.bytes[i]),"Plane and Mesh exported different outward pixels");
      send({type:"apply-designer-complete",generation,targetNodeId:"free-result",operation:"replace",
        publication:{placement:planePublished.placement,renderWidth:planePublished.renderWidth,renderHeight:planePublished.renderHeight}});
      await ready();
      const beforeRepeat=window.fixtureMessages.length;
      get("#apply").click();
      await wait(()=>window.fixtureMessages.slice(beforeRepeat).some(m=>m.type==="apply-designer"),"repeat outward Plane publication");
      const repeated=window.fixtureMessages.findLast(m=>m.type==="apply-designer").payload;
      check(repeated.renderWidth===second.renderWidth&&repeated.renderHeight===second.renderHeight&&
        JSON.stringify(repeated.placement)===JSON.stringify(second.placement),"Repeated Plane update accumulated canvas or density");
      send({type:"apply-designer-complete",generation,targetNodeId:"free-result",operation:"replace",
        publication:{placement:repeated.placement,renderWidth:repeated.renderWidth,renderHeight:repeated.renderHeight}});
      get("#workspace-tab-surface").click();await readyPanel(pin);
      await readyPanel(pin);
      check(!get(`${pin} [data-role="apply"]`).disabled,"Plane roundtrip lost outward authoring controls");
      const beforePinPublish=window.fixtureMessages.length;
      get(`${pin} [data-role="apply"]`).click();
      await wait(()=>window.fixtureMessages.slice(beforePinPublish).some(m=>m.type==="apply-designer"),"Pin roundtrip publication");
      check(JSON.stringify(window.fixtureMessages.findLast(m=>m.type==="apply-designer").payload.task.spec)===JSON.stringify(saved.spec),"Plane roundtrip changed raw outward controls");
      send({type:"apply-designer-complete",generation,targetNodeId:"free-result",operation:"replace"});
      await native("Input.dispatchMouseEvent",{type:"mouseMoved",x:2,y:2,buttons:0},"free-outline-editor-"+(window.innerWidth<400?"compact":"desktop"));
      // A mesh-only work has no cubic envelope to catch an accidental lossy lock.
      await refresh({...plain,sourceNodeId:"mesh-only-source",targetNodeId:undefined});
      get("#workspace-tab-mesh").click();await readyPanel(mesh);
      choose(mesh,"free");
      await wait(()=>document.querySelector(`${mesh} [data-point-id="2"]`)&&!get(`${mesh} [data-role="apply"]`).disabled,"free mesh-only boundary");
      const meshEdge=()=>get(`${mesh} [data-point-id="2"]`),before=meshEdge().style.top;
      key(meshEdge(),"ArrowDown");
      await wait(()=>meshEdge().style.top!==before&&!get(`${mesh} [data-role="apply"]`).disabled,"mesh-only edge edit");
      const moved=meshEdge().style.top;
      choose(mesh,"fixed");
      await wait(()=>!get(`${mesh} [data-role="deformation-boundary"]`).disabled,"mesh-only lock validation");
      check(get(`${mesh} [data-role="deformation-boundary"]`).value==="free"&&meshEdge().style.top===moved,"fixed mode discarded an unpublished Mesh edge");
      check(!get(`${mesh} [data-role="error"]`).hidden,"rejected Mesh lock has no reason");
      check(/Undo.*Reset/.test(get(`${mesh} [data-role="error"]`).textContent),"Mesh boundary refusal has no editing recovery");
      key(meshEdge(),"z",{metaKey:true});
      await wait(()=>meshEdge().style.top===before&&!get(`${mesh} [data-role="apply"]`).disabled,"mesh-only recovery undo");
      choose(mesh,"fixed");
      await wait(()=>get(`${mesh} [data-role="deformation-boundary"]`).value==="fixed"&&!get(`${mesh} [data-role="apply"]`).disabled,"lossless return to fixed");
      check(window.fixtureErrors.length===0,`free outline errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario.startsWith("psd-curve-import")) {
      // A synthetic warpCustom 4×4 PSD (authored through the same writer the
      // interop tests use) flows through the real import worker and WASM in
      // the built single-file UI, then adopts onto the selected artwork.
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      get("#workspace-tab-templates").click();
      await wait(() => !get("#templates-workspace").hidden, "templates workspace");
      get(".template-import-trigger").click();
      const psdBytes = Uint8Array.from(atob("OEJQUwABAAAAAAAAAAMAAABkAAAAZAAIAAMAAAAAAAAAAAAADVAAAA1IAAEAAAASAAAAEgAAAFIAAAByAAMAAAAAAQIAAQAAAQIAAgAAAQI4QklNbm9ybf8ACAAAAAoMAAAAAAAAAAANRml4dHVyZSBjdXJ2ZQAAOEJJTWx1bmkAAAAgAAAADQBGAGkAeAB0AHUAcgBlACAAYwB1AHIAdgBlAAA4QklNbHlpZAAAAAQAAAAHOEJJTVBsTGQAAAOEcGxjTAAAAAMkYWFhYWFhYWEtYmJiYi1jY2NjLWRkZGQtZWVlZWVlZWVlZWVlAAAAAQAAAAEAAAAQAAAAAkAyAAAAAAAAQDIAAAAAAABAVIAAAAAAAEA0AAAAAAAAQFQAAAAAAABAVIAAAAAAAEA0AAAAAAAAQFQAAAAAAAAAAAAAAAAAEAAAAAEAAAAAAAR3YXJwAAAACQAAAAl3YXJwU3R5bGVlbnVtAAAACXdhcnBTdHlsZQAAAAp3YXJwQ3VzdG9tAAAACXdhcnBWYWx1ZWRvdWIAAAAAAAAAAAAAAA93YXJwUGVyc3BlY3RpdmVkb3ViAAAAAAAAAAAAAAAUd2FycFBlcnNwZWN0aXZlT3RoZXJkb3ViAAAAAAAAAAAAAAAKd2FycFJvdGF0ZWVudW0AAAAAT3JudAAAAABIcnpuAAAABmJvdW5kc09iamMAAAABAAAAAAAOY2xhc3NGbG9hdFJlY3QAAAAEAAAAAFRvcCBVbnRGI1B4bAAAAAAAAAAAAAAAAExlZnRVbnRGI1B4bAAAAAAAAAAAAAAAAEJ0b21VbnRGI1B4bEBQAAAAAAAAAAAAAFJnaHRVbnRGI1B4bEBYAAAAAAAAAAAABnVPcmRlcmxvbmcAAAAEAAAABnZPcmRlcmxvbmcAAAAEAAAAEmN1c3RvbUVudmVsb3BlV2FycE9iamMAAAABAAAAAAASY3VzdG9tRW52ZWxvcGVXYXJwAAAAAQAAAAptZXNoUG9pbnRzT2JBcgAAABAAAAABAAAAAAANcmF0aW9uYWxQb2ludAAAAAIAAAAASHJ6blVuRmwjUHhsAAAAEAAAAAAAAAAAQD////////5AUAAAAAAAAEBYAAAAAAAAAAAAAAAAAABARgAAAAAAAEBQAAAAAAAAQFgAAAAAAAAAAAAAAAAAAEA////////+QE0AAAAAAABAWAAAAAAAAAAAAAAAAAAAQD////////5AUAAAAAAAAEBYAAAAAAAAAAAAAFZydGNVbkZsI1B4bAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEA1VVVVVVVVQDoAAAAAAABANVVVVVVVVUA1VVVVVVVVQEVVVVVVVVVARVVVVVVVVUBEAAAAAAAAQEVVVVVVVVVAUAAAAAAAAEBQAAAAAAAAQFAAAAAAAABAUAAAAAAAAAAAOEJJTVNvTGQAAAYcc29MRAAAAAQAAAAQAAAAAQAAAAAAAG51bGwAAAAOAAAAAElkbnRURVhUAAAAJQBhAGEAYQBhAGEAYQBhAGEALQBiAGIAYgBiAC0AYwBjAGMAYwAtAGQAZABkAGQALQBlAGUAZQBlAGUAZQBlAGUAZQBlAGUAZQAAAAAABnBsYWNlZFRFWFQAAAAlAGEAYQBhAGEAYQBhAGEAYQAtAGIAYgBiAGIALQBjAGMAYwBjAC0AZABkAGQAZAAtAGUAZQBlAGUAZQBlAGUAZQBlAGUAZQBlAAAAAAAAUGdObWxvbmcAAAABAAAACnRvdGFsUGFnZXNsb25nAAAAAQAAAAlmcmFtZVN0ZXBPYmpjAAAAAQAAAAAAAG51bGwAAAACAAAACW51bWVyYXRvcmxvbmcAAAAAAAAAC2Rlbm9taW5hdG9ybG9uZwAAAlgAAAAIZHVyYXRpb25PYmpjAAAAAQAAAAAAAG51bGwAAAACAAAACW51bWVyYXRvcmxvbmcAAAAAAAAAC2Rlbm9taW5hdG9ybG9uZwAAAlgAAAAKZnJhbWVDb3VudGxvbmcAAAAAAAAAAEFubnRsb25nAAAAEAAAAABUeXBlbG9uZwAAAAIAAAAAVHJuZlZsTHMAAAAIZG91YkAyAAAAAAAAZG91YkAyAAAAAAAAZG91YkBUgAAAAAAAZG91YkA0AAAAAAAAZG91YkBUAAAAAAAAZG91YkBUgAAAAAAAZG91YkA0AAAAAAAAZG91YkBUAAAAAAAAAAAAEm5vbkFmZmluZVRyYW5zZm9ybVZsTHMAAAAIZG91YkAyAAAAAAAAZG91YkAyAAAAAAAAZG91YkBUgAAAAAAAZG91YkA0AAAAAAAAZG91YkBUAAAAAAAAZG91YkBUgAAAAAAAZG91YkA0AAAAAAAAZG91YkBUAAAAAAAAAAAABHdhcnBPYmpjAAAAAQAAAAAABHdhcnAAAAAJAAAACXdhcnBTdHlsZWVudW0AAAAJd2FycFN0eWxlAAAACndhcnBDdXN0b20AAAAJd2FycFZhbHVlZG91YgAAAAAAAAAAAAAAD3dhcnBQZXJzcGVjdGl2ZWRvdWIAAAAAAAAAAAAAABR3YXJwUGVyc3BlY3RpdmVPdGhlcmRvdWIAAAAAAAAAAAAAAAp3YXJwUm90YXRlZW51bQAAAABPcm50AAAAAEhyem4AAAAGYm91bmRzT2JqYwAAAAEAAAAAAA5jbGFzc0Zsb2F0UmVjdAAAAAQAAAAAVG9wIFVudEYjUHhsAAAAAAAAAAAAAAAATGVmdFVudEYjUHhsAAAAAAAAAAAAAAAAQnRvbVVudEYjUHhsQFAAAAAAAAAAAAAAUmdodFVudEYjUHhsQFgAAAAAAAAAAAAGdU9yZGVybG9uZwAAAAQAAAAGdk9yZGVybG9uZwAAAAQAAAASY3VzdG9tRW52ZWxvcGVXYXJwT2JqYwAAAAEAAAAAABJjdXN0b21FbnZlbG9wZVdhcnAAAAABAAAACm1lc2hQb2ludHNPYkFyAAAAEAAAAAEAAAAAAA1yYXRpb25hbFBvaW50AAAAAgAAAABIcnpuVW5GbCNQeGwAAAAQAAAAAAAAAABAP////////kBQAAAAAAAAQFgAAAAAAAAAAAAAAAAAAEBGAAAAAAAAQFAAAAAAAABAWAAAAAAAAAAAAAAAAAAAQD////////5ATQAAAAAAAEBYAAAAAAAAAAAAAAAAAABAP////////kBQAAAAAAAAQFgAAAAAAAAAAAAAVnJ0Y1VuRmwjUHhsAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQDVVVVVVVVVAOgAAAAAAAEA1VVVVVVVVQDVVVVVVVVVARVVVVVVVVUBFVVVVVVVVQEQAAAAAAABARVVVVVVVVUBQAAAAAAAAQFAAAAAAAABAUAAAAAAAAEBQAAAAAAAAAAAAAFN6ICBPYmpjAAAAAQAAAAAAAFBudCAAAAACAAAAAFdkdGhsb25nAAAAYAAAAABIZ2h0bG9uZwAAAEAAAAAAUnNsdFVudEYjUnNsQFIAAAAAAAAAAAABAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAKh/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/wABAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAKh/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/wABAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAKh/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/wAAAAAAAQACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAp3/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+d/w=="), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([psdBytes], "curve.psd", { type: "image/vnd.adobe.photoshop" }));
      const fileField = get(".psd-curve-import-file");
      fileField.files = transfer.files;
      fileField.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => document.querySelector(".psd-curve-import-object"), "imported object list");
      check(get(".template-list").hidden && get("#templates-workspace .designer-footer").hidden,
        "saved template actions remained active during import");
      const row = get(".psd-curve-import-object");
      check(!row.disabled, "the curve object is not selectable");
      check(row.textContent.includes("Fixture curve") && row.textContent.includes("Curve"),
        `unexpected object row: ${row.textContent}`);
      get(".psd-curve-import .primary").click();
      await wait(() => !get("#surface-workspace").hidden && document.querySelector("#surface-workspace .direct-point"),
        "adopted curve opened the Pin workspace with live controls");
      const control = () => get("#surface-workspace .direct-point");
      const original = control().style.left;
      key(control(), "ArrowRight", { shiftKey: true });
      await wait(() => control().style.left !== original, "imported envelope control did not move");
      get("#workspace-tab-mesh").click();
      await wait(() => !get("#mesh-workspace").hidden && !get("#mesh-workspace [data-role=\"apply\"]").disabled,
        "adopted curve entered Mesh");
      get("#workspace-tab-surface").click();
      await wait(() => !get("#surface-workspace").hidden && !get("#surface-workspace [data-role=\"apply\"]").disabled,
        "adopted curve returned to Pin");
      // Leaving and re-entering keeps the adopted work; the ordinary Pin
      // editing contract applies to an imported curve without special cases.
      get("#workspace-tab-perspective").click();
      get("#workspace-tab-surface").click();
      await wait(() => !get("#surface-workspace").hidden && !get("#surface-workspace [data-role=\"apply\"]").disabled,
        "re-entered Pin workspace with the adopted curve");
      const previousPublications = window.fixtureMessages.filter(message => message.type === "apply-designer").length;
      key(control(), "ArrowRight");
      get("#surface-workspace [data-role=\"apply-new\"]").click();
      await wait(() => window.fixtureMessages.filter(message => message.type === "apply-designer").length > previousPublications,
        "edited imported curve reached ordinary publication");
      const published = window.fixtureMessages.findLast(message => message.type === "apply-designer").payload;
      check(published.task.kind === "deformation" && published.task.spec.surface.envelope.points.length === 16 && published.bytes.length > 0,
        "curve publication lost editable controls or rendered pixels");
      check(published.task.psdAdoption?.source.sha256?.length === 64,
        "switching Pin/Mesh/Plane lost the PSD source provenance");
      check(window.fixtureMessageGuard({ type: "apply-designer", payload: published }),
        "imported curve publication violates actual Main admission");
      send({ type: "apply-error", generation, message: { key: "unexpectedError" } });
      await wait(() => !get('#surface-workspace [data-role="apply-new"]').disabled &&
        !get('#surface-workspace [data-role="error"]').hidden, "Pin recovers from a Main admission error");
      const retrySeen = window.fixtureMessages.length;
      get('#surface-workspace [data-role="apply-new"]').click();
      await wait(() => window.fixtureMessages.slice(retrySeen).some(message => message.type === "apply-designer"),
        "Pin retries publication after a Main error");
      send({ type: "apply-designer-complete", generation, targetNodeId: "curve-result", operation: "apply" });
      await frames();
      for (const [view, storedView] of [["surface", "pin"], ["mesh", "mesh"]]) {
        const stored = { ...payload, targetNodeId: "curve-result", nativeTarget: undefined,
          nativeRenderer: undefined, task: { ...published.task, view: storedView } };
        await refresh(stored);
        get(`#workspace-tab-${view}`).click();
        const panel = `#${view}-workspace`;
        const point = () => get(`${panel} .direct-point`);
        await wait(() => !get(panel).hidden && !get(`${panel} [data-role="apply"]`).disabled,
          `${view} reopened the saved PSD result`);
        key(point(), "ArrowRight");
        const seen = window.fixtureMessages.length;
        get(`${panel} [data-role="apply"]`).click();
        await wait(() => window.fixtureMessages.slice(seen).some(message => message.type === "apply-designer"),
          `${view} updated the saved PSD result`);
        const continued = window.fixtureMessages.findLast(message => message.type === "apply-designer").payload;
        send({ type: "apply-designer-complete", generation, targetNodeId: "curve-result", operation: "replace" });
        await frames();
        const previous = point().style.left;
        key(point(), "ArrowRight");
        await wait(() => point().style.left !== previous, `${view} edited again after updating`);
        const unsaved = point().style.left;
        await refresh({ ...stored, task: continued.task });
        await frames();
        check(point().style.left === unsaved,
          `${view} discarded the next edit on a pixel refresh after updating a PSD result`);
      }
      await refresh({ ...payload, sourceNodeId: "unrelated-artwork", targetNodeId: undefined,
        nativeTarget: undefined, nativeRenderer: undefined });
      for (const view of ["mesh", "surface"]) {
        get(`#workspace-tab-${view}`).click();
        const panel = `#${view}-workspace`;
        await wait(() => !get(panel).hidden && !get(`${panel} [data-role="apply-new"]`).disabled,
          `${view} ready for unrelated artwork`);
        const seen = window.fixtureMessages.length;
        get(`${panel} [data-role="apply-new"]`).click();
        await wait(() => window.fixtureMessages.slice(seen).some(message => message.type === "apply-designer"),
          `${view} published unrelated artwork`);
        const ordinary = window.fixtureMessages.findLast(message => message.type === "apply-designer").payload;
        check(ordinary.task.psdAdoption === undefined, `${view} leaked PSD provenance onto unrelated artwork`);
        send({ type: "apply-error", generation, message: { key: "unexpectedError" } });
        await wait(() => !get(`${panel} [data-role="apply-new"]`).disabled &&
          !get(`${panel} [data-role="error"]`).hidden, `${view} recovers from a Main admission error`);
        const retry = window.fixtureMessages.length;
        get(`${panel} [data-role="apply-new"]`).click();
        await wait(() => window.fixtureMessages.slice(retry).some(message => message.type === "apply-designer"),
          `${view} retries publication after a Main error`);
        send({ type: "apply-designer-complete", generation, targetNodeId: `${view}-unrelated`, operation: "apply" });
        await frames();
      }
    } else if (scenario === "surface-authoring") {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      get("#workspace-tab-surface").click();
      const panel = "#surface-workspace";
      await wait(() => !get(panel).hidden && document.querySelector(`${panel} .direct-point`), "Pin Warp handles");
      await frames();
      const control = () => get(`${panel} .direct-point`);
      const original = control().style.left;
      key(control(), "ArrowRight", { shiftKey: true }); await frames();
      check(control().style.left !== original, "Pin Warp handle did not move");
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
        field.dispatchEvent(new Event("input", { bubbles: true }));
        check(!get(`${panel} [data-role="save-template"]`).disabled, `surface template unexpectedly disabled: ${get(`${panel} [data-role="status"]`).textContent}`);
        get(`${panel} [data-role="save-template"]`).click();
        try { await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "save-template"), "saved surface spec"); }
        catch(error) {throw new Error(`${error}: ${JSON.stringify({seen,errors:window.fixtureErrors,messages:window.fixtureMessages.slice(-4).map(m=>({type:m.type,requestId:m.requestId})),status:get(`${panel} [data-role="status"]`).textContent,feedback:get(`${panel} [data-role="error"]`).textContent})}`); }
        const request = window.fixtureMessages.findLast(m => m.type === "save-template");
        send({ type: "template-library", templates: [], mutation: { kind: "save", workspace: "surface", requestId: request.requestId } });
        check(request.template.operation.kind === "deformation" && request.template.operation.view === "pin", "Pin template did not save the complete work");
        return request.template.operation.spec.surface;
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
      const pinBeforeSwitch = await save();
      get("#workspace-tab-mesh").click();
      const meshPanel = "#mesh-workspace";
      await wait(() => !get(meshPanel).hidden && document.querySelector(`${meshPanel} .direct-point`) &&
        !get(`${meshPanel} [data-role="apply"]`).disabled, "Pin work continued in Mesh");
      await frames();
      const meshPoint = get(`${meshPanel} .direct-point`);
      const meshPointBefore = meshPoint.style.left;
      key(meshPoint, "ArrowRight", { shiftKey: true }); await frames();
      check(meshPoint.style.left !== meshPointBefore, "Mesh view did not edit the shared work");
      get("#workspace-tab-surface").click();
      await wait(() => !get(panel).hidden && !get(`${panel} [data-role="apply"]`).disabled,
        "Mesh work returned to Pin");
      await frames();
      const pinAfterSwitch = await save();
      check(JSON.stringify(pinAfterSwitch.envelope) === JSON.stringify(pinBeforeSwitch.envelope) &&
        JSON.stringify(pinAfterSwitch.anchors) === JSON.stringify(pinBeforeSwitch.anchors) &&
        JSON.stringify(pinAfterSwitch.strokes) === JSON.stringify(pinBeforeSwitch.strokes),
      "Pin → Mesh → Pin changed Pin controls");
      check(get(`${panel} [data-role="patches"]`).disabled && density.disabled,
        "Pin density controls remained active after a Mesh edit could be lost");
      const seen = window.fixtureMessages.length;
      get(`${panel} [data-role="apply"]`).click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), "surface publication");
      const published = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check(published.task.kind === "deformation" && published.task.view === "pin" &&
        published.task.spec.surface.strokes.length === 1 && published.task.spec.meshEdits.length === 1 &&
        published.bytes.length > 0, "Shared deformation output lost Pin or Mesh edits");
      send({ type: "apply-designer-complete", generation, targetNodeId: "surface-result", operation: "apply" });
      await frames();
      const seenUndo = window.fixtureMessages.length;
      pointer("pointerdown", 0, 1); pointer("pointerup", 5, 0); await frames();
      key(get(`${panel} [data-role="tool-brush"]`), "z", { metaKey: true }); await frames();
      check(!window.fixtureMessages.slice(seenUndo).some(m => m.type === "trigger-undo"), "New brush edit incorrectly routed Undo to the host");
      check((await save()).strokes.length === 1, "Undo after publication did not retain the previous stroke");
      get(`${panel} [data-role="reset"]`).click(); await frames();
      const resetWork=await save();
      check(resetWork.strokes.length===1 && get(`${panel} [data-role="subdivisions"]`).value==="8" &&
        get(`${panel} [data-role="error"]`).hidden,"Reset mixed an old Pin baseline with the newer Mesh work");
      // Capacity is a separate blank-work task. A cross-view handoff now
      // establishes the complete current work as Reset's valid baseline.
      await refresh({...payload,sourceNodeId:"brush-capacity",targetNodeId:undefined});await frames();
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
    } else if (scenario === "liquify-brush") {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      get("#workspace-tab-surface").click();
      const panel = "#surface-workspace";
      await wait(() => !get(panel).hidden && document.querySelector(`${panel} .direct-point`), "Pin Warp handles");
      await frames();
      const preview = get(`${panel} canvas`);
      const modes = () => get(`${panel} [data-role="liquify-modes"]`);
      const error = () => get(`${panel} [data-role="error"]`);
      const box = preview.getBoundingClientRect(), x = box.left + box.width * .4, y = box.top + box.height * .4;
      const pointer = (type, offset, buttons, pointerId = 11) => preview.dispatchEvent(new PointerEvent(type, {
        clientX: x + offset, clientY: y, pointerId, button: 0, buttons, bubbles: true,
      }));
      get(`${panel} [data-role="tool-liquify"]`).click(); await frames();
      check(!modes().hidden, "Liquify mode picker did not appear");
      check(!get(`${panel} [data-role="radius-field"]`).hidden, "Liquify tool hid the radius control");
      check(get(`${panel} [data-role="mode-push"]`).getAttribute("aria-pressed") === "true",
        "Push is not the default Liquify mode");
      const nameField = get(`${panel} [data-role="template-name"]`);
      nameField.value = "Liquify fixture";
      nameField.dispatchEvent(new Event("input", { bubbles: true })); await frames();
      preview.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, pointerId: 11, buttons: 0, bubbles: true }));
      await frames();
      check(Boolean(document.querySelector(`${panel} .direct-point-lattice path`)),
        "Liquify tool shows no brush footprint");
      // Escape still cancels just the in-flight stroke.
      pointer("pointerdown", 0, 1); pointer("pointermove", 6, 1); await frames();
      key(get(`${panel} [data-role="tool-liquify"]`), "Escape"); await frames(); await frames();
      const rest = preview.toDataURL();
      // A push stroke displaces along the drag; Undo and Redo keep the same
      // history contract as the surface brush.
      pointer("pointerdown", 0, 1); pointer("pointermove", 6, 1); pointer("pointerup", 8, 0);
      await frames(); await frames();
      const pushed = preview.toDataURL();
      check(pushed !== rest, "Liquify push stroke did not change the preview");
      get(`${panel} [data-role="mode-twirl"]`).click(); await frames();
      check(get(`${panel} [data-role="mode-twirl"]`).getAttribute("aria-pressed") === "true",
        "Liquify mode did not switch");
      pointer("pointerdown", 0, 1); pointer("pointermove", 5, 1); pointer("pointerup", 5, 0);
      await frames(); await frames();
      const twirled = preview.toDataURL();
      check(twirled !== pushed, "Liquify twirl stroke did not change the preview");
      key(get(`${panel} [data-role="tool-liquify"]`), "z", { metaKey: true }); await frames(); await frames();
      check(preview.toDataURL() === pushed, "Liquify Undo did not restore the previous strokes");
      key(get(`${panel} [data-role="tool-liquify"]`), "z", { metaKey: true, shiftKey: true }); await frames(); await frames();
      check(preview.toDataURL() === twirled, "Liquify Redo lost the radial stroke");
      // The per-stroke capacity explains itself and clears on release. The
      // loop stays in push mode: a same-spot twirl would fold the mesh and
      // the plan error would legitimately replace the capacity guidance.
      get(`${panel} [data-role="mode-push"]`).click(); await frames();
      pointer("pointerdown", 0, 1);
      for (let sample = 0; sample < 257; sample += 1) {
        pointer("pointermove", sample % 2 ? .02 : .01, 1);
      }
      await frames();
      check(!error().hidden && error().textContent.includes("sample limit"),
        `Liquify per-stroke capacity did not explain itself (hidden=${error().hidden} text=${JSON.stringify(error().textContent)})`);
      pointer("pointerup", .03, 0); await frames();
      check(error().hidden, "Finished Liquify stroke retained capacity feedback");
      // Reset clears the complete Liquify draft and leaves saving usable.
      get(`${panel} [data-role="reset"]`).click(); await frames(); await frames();
      check(!get(`${panel} [data-role="save-template"]`).disabled,
        "Reset did not clear the Liquify draft");
      get(`${panel} [data-role="tool-handles"]`).click(); await frames();
      check(modes().hidden, "Liquify mode picker stayed visible with the Handles tool");
      // One publication carries the typed block: push mode, push-only delta,
      // and no leakage into the Pin surface strokes.
      get(`${panel} [data-role="tool-liquify"]`).click(); await frames();
      pointer("pointerdown", 0, 1); pointer("pointermove", 4, 1); pointer("pointerup", 8, 0);
      await frames(); await frames();
      const seen = window.fixtureMessages.length;
      get(`${panel} [data-role="apply"]`).click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"),
        "Liquify publication");
      const published = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check(published.task.kind === "deformation" && published.task.view === "pin",
        "Liquify publication lost the shared task");
      const strokes = published.task.spec.liquify?.strokes ?? [];
      check(strokes.length === 1 && strokes[0].mode === "push" && strokes[0].samples[0].delta.x > 0,
        "publication lost the push stroke");
      check(published.task.spec.surface.strokes.length === 0,
        "Liquify strokes leaked into the Pin surface block");
      send({ type: "apply-designer-complete", generation, targetNodeId: "surface-result", operation: "apply" });
      await frames();
      // The library retains Liquify as authored state, together with Pin.
      check(!get(`${panel} [data-role="save-template"]`).disabled,
        "Template save refused a complete Liquify work");
      const seenTemplate = window.fixtureMessages.length;
      get(`${panel} [data-role="save-template"]`).click();
      await wait(() => window.fixtureMessages.slice(seenTemplate).some(m => m.type === "save-template"), "Liquify template saved");
      const liquifyTemplate = window.fixtureMessages.findLast(m => m.type === "save-template");
      check(liquifyTemplate.template.operation.kind === "deformation" &&
        JSON.stringify(liquifyTemplate.template.operation.spec) === JSON.stringify(published.task.spec),
        "Liquify template lost or baked the authored state");
      send({type:"template-library",templates:[],mutation:{kind:"save",workspace:"surface",requestId:liquifyTemplate.requestId}});await frames();
      // The Mesh view measures new edits against the post-Liquify baseline:
      // one moved vertex becomes exactly one explicit edit, and the block
      // survives the round trip.
      get("#workspace-tab-mesh").click();
      const meshPanel = "#mesh-workspace";
      await wait(() => !get(meshPanel).hidden && document.querySelector(`${meshPanel} .direct-point`) &&
        !get(`${meshPanel} [data-role="apply"]`).disabled, "Liquify work continued in Mesh");
      await frames();
      // A density change keeps the Liquify block live: the new baseline is
      // the pre-edit replay re-planned at the new density, so the visible
      // deformation is re-expressed without baking the stroke region into
      // the explicit edit list.
      const density = get(`${meshPanel} [data-role="subdivisions"]`);
      density.value = "8";
      density.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => document.querySelectorAll(`${meshPanel} .direct-point`).length === 49,
        "density adoption did not resample the editable grid");
      await frames();
      const seenDensity = window.fixtureMessages.length;
      get(`${meshPanel} [data-role="apply"]`).click();
      await wait(() => window.fixtureMessages.slice(seenDensity).some(m => m.type === "apply-designer"),
        "Mesh publication after the density change");
      const densityPublished = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check(densityPublished.task.spec.meshSubdivisions === 8, "density change did not commit");
      check((densityPublished.task.spec.liquify?.strokes ?? []).length === 1,
        "density change lost the Liquify strokes");
      const densityEditCount = densityPublished.task.spec.meshEdits.length;
      check(densityEditCount <= 12,
        `density change re-expressed the whole stroke region as explicit edits (edits=${densityEditCount})`);
      send({ type: "apply-designer-complete", generation, targetNodeId: "surface-result", operation: "apply" });
      await frames();
      const meshPoint = get(`${meshPanel} .direct-point`);
      const meshPointBefore = meshPoint.style.left;
      key(meshPoint, "ArrowRight", { shiftKey: true }); await frames();
      check(meshPoint.style.left !== meshPointBefore, "Mesh view did not edit the Liquify work");
      const seenMesh = window.fixtureMessages.length;
      get(`${meshPanel} [data-role="apply"]`).click();
      await wait(() => window.fixtureMessages.slice(seenMesh).some(m => m.type === "apply-designer"),
        "Mesh publication over Liquify");
      const meshPublished = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check(meshPublished.task.spec.meshEdits.length === densityEditCount + 1,
        `Mesh edits were measured against a pre-Liquify baseline (edits=${meshPublished.task.spec.meshEdits.length} ` +
        `expected=${densityEditCount + 1} ` +
        `liquify=${(meshPublished.task.spec.liquify?.strokes ?? []).length} ` +
        `samples=${(meshPublished.task.spec.liquify?.strokes ?? []).map(s => s.samples.length).join(",")})`);
      check((meshPublished.task.spec.liquify?.strokes ?? []).length === 1,
        "Mesh view lost the Liquify strokes");
      send({ type: "apply-designer-complete", generation, targetNodeId: "surface-result", operation: "apply" });
      await frames();
      get("#workspace-tab-surface").click();
      await wait(() => !get(panel).hidden && !get(`${panel} [data-role="apply"]`).disabled,
        "Liquify work returned to Pin");
      await frames();
      const seenBack = window.fixtureMessages.length;
      get(`${panel} [data-role="apply"]`).click();
      await wait(() => window.fixtureMessages.slice(seenBack).some(m => m.type === "apply-designer"),
        "Pin republish over the carried work");
      const republished = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check((republished.task.spec.liquify?.strokes ?? []).length === 1 &&
        republished.task.spec.meshEdits.length === densityEditCount + 1,
        "Pin → Mesh → Pin lost Liquify strokes or the Mesh edit");
      send({ type: "apply-designer-complete", generation, targetNodeId: "surface-result", operation: "apply" });
    } else if (scenario === "native-shape-fit") {
      let capturedSourceUrl;
      addEventListener("message",event=>{
        const request=event.data?.pluginMessage;
        if(request?.type!=="request-source-raster") return;
        check(request.sourceNodeId==="art","Plane requested the guide raster");
        const fresh=document.createElement("canvas");fresh.width=request.desiredWidth;fresh.height=request.desiredHeight;
        fresh.getContext("2d").drawImage(canvas,0,0,fresh.width,fresh.height);
        capturedSourceUrl=fresh.toDataURL();
        const pixels=Uint8Array.from(atob(capturedSourceUrl.split(",")[1]),char=>char.charCodeAt(0));
        send({type:"source-raster",generation:request.generation,requestId:request.requestId,bytes:pixels});
      });
      const {planDeformationWork,TransformWebGLRenderer,shapeFitDomains}=await import("/geometry/index.js");
      const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const contour=points=>({start:{x:points[0][0],y:points[0][1]},segments:points.slice(1).map(([x,y])=>({kind:"line",to:{x,y}}))});
      const outer=contour([[0,0],[200,0],[200,64],[80,64],[80,160],[0,160]]);
      const hole=contour([[20,90],[60,90],[60,130],[20,130]]);
      const documentContour=value=>({start:{x:value.start.x+800,y:value.start.y+300},segments:value.segments.map(segment=>({...segment,to:{x:segment.to.x+800,y:segment.to.y+300}}))});
      const shapeGuide={contours:[documentContour(hole),documentContour(outer)],fillRule:"evenOdd",bounds:{x:800,y:300,width:200,height:160}};
      const {targetNodeId:_target,nativeTarget:_native,nativeRenderer:_renderer,spec:_spec,...plain}=payload;
      const guideCanvas=document.createElement("canvas");guideCanvas.width=200;guideCanvas.height=160;
      const guideContext=guideCanvas.getContext("2d");guideContext.fillStyle="blue";guideContext.fillRect(0,0,200,160);
      const guideBytes=Uint8Array.from(atob(guideCanvas.toDataURL().split(",")[1]),char=>char.charCodeAt(0));
      const art={...plain,sourceNodeId:"art",sourceName:"Artwork",renderWidth:360,renderHeight:240,placement:{...plain.placement,width:360,height:240}};
      const guide={...plain,bytes:guideBytes,sourceNodeId:"guide",sourceName:"Native L with hole",placement:{...shapeGuide.bounds},shapeGuide};
      const openPair=async sources=>{
        generation++;send({type:"selection-loading",generation,nodeIds:sources.map(value=>value.sourceNodeId)});
        send({type:"source",generation,payload:{...sources[0],sources}});
        await wait(()=>!get("#workspace-tab-mockup").disabled,"native shape pair");get("#workspace-tab-mockup").click();
        await wait(()=>!get('#mockup-workspace [data-role="bend-shape"]').disabled,"native fitting domains");
      };
      let published;
      for(const guideIndex of [0,1]) {
        const sources=guideIndex===0 ? [guide,art] : [art,guide];
        await openPair(sources);
        check(get('#mockup-workspace [data-role="fit-guide"]').value==="guide","native guide identity was lost");
        const options=get('#mockup-workspace [data-role="fit-domain"]').options;
        check(options[0].textContent==="Original outline" && options[options.length-1].textContent==="Rectangle (clip only)","fitting domains were not honest");
        const mark=window.fixtureMessages.length;get('#mockup-workspace [data-role="bend-shape"]').click();
        await wait(()=>window.fixtureMessages.slice(mark).some(value=>value.type==="prepare-shape-fit"),"native fit preparation");
        const task=window.fixtureMessages.findLast(value=>value.type==="prepare-shape-fit").task;
        check(task.shapeGuideSourceIndex===guideIndex && task.spec.shapeFit.clip.contours.length===2,"native role or hole was dropped");
        check(task.spec.shapeFit.contour.start.x===0 && task.spec.shapeFit.contour.start.y===0,"the hole was selected as the fitting boundary");
        send({type:"source",generation,payload:{...art,sources,deformationDraft:task}});
        await wait(()=>!get("#mesh-workspace").hidden && !get('#mesh-workspace [data-role="apply"]').disabled,"native fit Mesh preview");await frames();
        const mesh=get("#mesh-workspace canvas");
        check(mesh.width===200&&mesh.height===160,"native guide bounds were not retained");
        key(get('#mesh-workspace [data-point-id="6"]'),"ArrowRight");await frames();
        const fitPosition=get('#mesh-workspace [data-role="fit-position-0"]');
        const originalPosition=Number(fitPosition.value);
        fitPosition.value=String(originalPosition+1);fitPosition.dispatchEvent(new Event("change",{bubbles:true}));
        await wait(()=>!get('#mesh-workspace [data-role="apply"]').disabled,"corner correspondence changed");await frames();
        check(Number(fitPosition.value)===originalPosition+1,"corner correspondence was not shown");
        get("#mesh-workspace").focus();key(get("#mesh-workspace"),"z",{metaKey:true});await frames();
        await wait(()=>Number(fitPosition.value)===originalPosition,"corner correspondence Undo");
        key(get("#mesh-workspace"),"z",{metaKey:true,shiftKey:true});await frames();
        await wait(()=>Number(fitPosition.value)===originalPosition+1,"corner correspondence Redo");
        get("#workspace-tab-surface").click();
        await wait(()=>!get('#surface-workspace [data-role="apply"]').disabled,"native fit Pin continuation");
        get('#surface-workspace [data-role="apply"]').click();
        await wait(()=>window.fixtureMessages.slice(mark).some(value=>value.type==="apply-designer"),"native fit publication");
        published=window.fixtureMessages.findLast(value=>value.type==="apply-designer").payload;
        check(published.task.shapeGuideSourceIndex===guideIndex && published.sourceNodeIds.join()===sources.map(value=>value.sourceNodeId).join(),"publication reordered or dropped source roles");
        check(published.task.spec.meshEdits?.length===1,"the Mesh edit disappeared in Pin");
        check(Math.abs(published.task.spec.shapeFit.cornerPositions[0]-(originalPosition+1)/100)<1e-12,"corner correspondence disappeared in Pin");
        const bitmap=await createImageBitmap(new Blob([published.bytes],{type:"image/png"}));
        const actual=document.createElement("canvas");actual.width=bitmap.width;actual.height=bitmap.height;actual.getContext("2d").drawImage(bitmap,0,0);bitmap.close();
        const pixels=actual.getContext("2d").getImageData(0,0,actual.width,actual.height).data;
        check(actual.width===400&&actual.height===320&&published.placement.width===200&&published.placement.height===160,
          "native fitted HD pixels changed document size");
        const sample=(x,y)=>{const i=(Math.round(y*actual.height/160)*actual.width+Math.round(x*actual.width/200))*4;return Array.from(pixels.slice(i,i+4));};
        check(sample(40,110)[3]===0 && sample(150,120)[3]===0 && sample(30,25)[3]===255,"native hole/notch/fill was not preserved");
        check(sample(30,25)[2]!==255,"the guide was rendered as artwork");
        const expectedPlan=await planDeformationWork({...published.task.spec,targetSize:{width:actual.width,height:actual.height}});
        const expected=new TransformWebGLRenderer(document.createElement("canvas"),{preserveDrawingBuffer:true});
        const image=new Image();image.src=capturedSourceUrl;await image.decode();
        expected.render(image,expectedPlan.meshWarp.solve,expectedPlan.meshWarp.spec.mesh,"high",expectedPlan.clip);
        const expectedBitmap=await createImageBitmap(expected.canvas);
        const read=document.createElement("canvas");read.width=actual.width;read.height=actual.height;read.getContext("2d").drawImage(expectedBitmap,0,0);expectedBitmap.close();
        const expectedPixels=read.getContext("2d").getImageData(0,0,read.width,read.height).data;
        check(pixels.every((value,index)=>value===expectedPixels[index]),"publication differs from the canonical artwork render");expected.dispose();
        send({type:"apply-designer-complete",generation,targetNodeId:"fit-result",operation:"apply"});
        generation++;send({type:"selection-loading",generation,nodeIds:["fit-result"]});
        send({type:"source",generation,payload:{...art,sources,task:published.task,targetNodeId:"fit-result",placement:published.placement}});
        await wait(()=>!get('#surface-workspace [data-role="apply"]').disabled,"native fit saved reopen");
        get("#workspace-tab-perspective").click();await ready();
        const before=window.fixtureMessages.length;get("#apply").click();
        await wait(()=>window.fixtureMessages.slice(before).some(value=>value.type==="apply-designer"),"native fit Plane publication");
        const plane=window.fixtureMessages.findLast(value=>value.type==="apply-designer").payload;
        check(plane.task.spec.targetSize.width===200 && plane.task.spec.targetSize.height===160,"Plane changed the fitted work size to its artwork dimensions");
        check(plane.task.shapeGuideSourceIndex===guideIndex && plane.sourceNodeIds.length===2 && plane.task.spec.meshEdits.length===1,"Plane lost the native fitting work");
        send({type:"apply-designer-complete",generation,targetNodeId:"fit-result",operation:"replace"});
        get("#workspace-tab-mesh").click();await wait(()=>!get('#mesh-workspace [data-role="apply"]').disabled,"native guide refresh draft");await frames();
        key(get('#mesh-workspace [data-point-id="7"]'),"ArrowRight");await frames();
        const changed=structuredClone(guide);
        changed.shapeGuide.contours[1].segments[2].to.x=900;
        changed.shapeGuide.contours[1].segments[3].to.x=900;
        const changedSources=guideIndex===0 ? [changed,art] : [art,changed];
        generation++;send({type:"selection-loading",generation,nodeIds:["fit-result"]});
        send({type:"source",generation,payload:{...art,sources:changedSources,task:plane.task,targetNodeId:"fit-result",placement:plane.placement}});
        await wait(()=>!get('#mesh-workspace [data-role="apply"]').disabled,"changed guide preview");await frames();
        const changedMark=window.fixtureMessages.length;get('#mesh-workspace [data-role="apply"]').click();
        await wait(()=>window.fixtureMessages.slice(changedMark).some(value=>value.type==="apply-designer"),"changed guide publication");
        const updated=window.fixtureMessages.findLast(value=>value.type==="apply-designer").payload;
        check(updated.task.spec.shapeFit.contour.segments[2].to.x===.5,"guide contour did not refresh");
        check(updated.task.spec.shapeFit.clip.contours.length===2 && updated.task.shapeGuideDomain.contourIndex===1,"guide policy or hole disappeared");
        check(updated.task.spec.meshEdits.length===2,"guide refresh discarded an unpublished interior edit");
        check(JSON.stringify(updated.task.spec.shapeFit.cornerPositions)===JSON.stringify(plane.task.spec.shapeFit.cornerPositions),"guide refresh reset corner correspondence");
        check(updated.targetNodeId==="fit-result" && updated.sourceNodeIds.join()===sources.map(value=>value.sourceNodeId).join(),"guide refresh changed target or source roles");
        const updatedBitmap=await createImageBitmap(new Blob([updated.bytes],{type:"image/png"}));
        const updatedRead=document.createElement("canvas");updatedRead.width=200;updatedRead.height=160;updatedRead.getContext("2d").drawImage(updatedBitmap,0,0,200,160);updatedBitmap.close();
        check(updatedRead.getContext("2d").getImageData(90,120,1,1).data[3]===255,"updated pixels still use the old guide");
        send({type:"apply-designer-complete",generation,targetNodeId:"fit-result",operation:"replace"});
      }
      // Independent filled parts need a connected envelope; all original regions remain the mask.
      const parts=structuredClone(guide);parts.shapeGuide.contours=[documentContour(contour([[0,0],[60,0],[60,160],[0,160]])),documentContour(contour([[140,0],[200,0],[200,80],[140,80]]))];
      parts.shapeGuide.regions=[{contourIndices:[0],fillRule:"nonZero"},{contourIndices:[1],fillRule:"evenOdd"}];
      await openPair([art,parts]);
      check(get('#mockup-workspace [data-role="fit-domain"]').options[0].textContent==="Enclose all parts","independent parts were silently reduced to one region");
      const started=window.fixtureMessages.length;get('#mockup-workspace [data-role="bend-shape"]').click();
      await wait(()=>window.fixtureMessages.slice(started).some(value=>value.type==="prepare-shape-fit"),"multi-region native fit");
      const multi=window.fixtureMessages.findLast(value=>value.type==="prepare-shape-fit").task;
      check(multi.spec.shapeFit.clip.regions.length===2,"compound region rules were lost");
      send({type:"shape-fit-error",generation,message:{key:"selectionChanged"}});await frames();
      check(!get('#mockup-workspace .designer-error').hidden && !get('#mockup-workspace [data-role="bend-shape"]').disabled,"rejected fit did not allow recovery");
    } else if (scenario === "fitted-authoring") {
      const {planDeformationWork, createMeshCoordinateMap, mapWarpMesh} = await import("/geometry/index.js");
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const lineContour = points => ({start:{x:points[0][0],y:points[0][1]}, segments:points.slice(1).map(([x,y])=>({kind:"line",to:{x,y}}))});
      const contour = lineContour([[0,0],[1,0],[1,.4],[.4,.4],[.4,1],[0,1]]);
      const hole = lineContour([[.12,.6],[.3,.6],[.3,.8],[.12,.8]]);
      const shapeFit = {contour,clip:{contours:[contour,hole],fillRule:"evenOdd"}};
      const points=Array.from({length:16},(_,i)=>({x:(i%4)/3,y:Math.floor(i/4)/3}));
      points[5]={x:-.05,y:1/3};
      let work={schema:"worldbend.deformation-work",version:"0.1",transform:spec,targetSize:{width:200,height:160},
        meshSubdivisions:4,shapeFit,surface:{envelope:{columns:1,rows:1,points},anchors:[],strokes:[]},
        meshEdits:[{column:2,row:2,warped:{x:.52,y:.49}}],
        liquify:{strokes:[{id:"fitted-push",mode:"push",samples:[{position:{x:.5,y:.25},delta:{x:.005,y:0},radius:.2,strength:.15}]}]}};
      const {nativeTarget:_target,nativeRenderer:_renderer,spec:_spec,...plain}=payload;
      const open=async view=>{
        generation+=1;send({type:"selection-loading",generation,nodeIds:["result"]});
        send({type:"source",generation,payload:{...plain,task:{kind:"deformation",view,spec:work}}});
        await wait(()=>!get(`#${view==="mesh"?"mesh":"surface"}-workspace`).hidden &&
          !get(`#${view==="mesh"?"mesh":"surface"}-workspace [data-role="apply"]`).disabled,"fitted view ready");
        await frames();
      };
      const publish=async panel=>{
        const seen=window.fixtureMessages.length;get(`${panel} [data-role="apply"]`).click();
        await wait(()=>window.fixtureMessages.slice(seen).some(m=>m.type==="apply-designer"),"fitted publication");
        const result=window.fixtureMessages.findLast(m=>m.type==="apply-designer").payload;
        check(result.task.kind==="deformation" && JSON.stringify(result.task.spec.shapeFit)===JSON.stringify(shapeFit),"fitting recipe was lost");
        check(result.bytes.length>0,"fitted publication has no pixels");
        send({type:"apply-designer-complete",generation,targetNodeId:"result",operation:"replace"});await frames();
        work=result.task.spec;return result;
      };
      const position=(panel,id,expected)=>{
        const preview=get(`${panel} canvas`),host=get(`${panel} .designer-preview`);
        const button=get(`${panel} [data-point-id="${id}"]`),box=preview.getBoundingClientRect(),parent=host.getBoundingClientRect();
        check(Math.abs(box.width/box.height-preview.width/preview.height)<.001,"preview CSS stretched the fitted artwork");
        const x=box.left-parent.left+expected.x*box.width,y=box.top-parent.top+expected.y*box.height;
        check(Math.abs(parseFloat(button.style.left)-x)<.01 && Math.abs(parseFloat(button.style.top)-y)<.01,`control ${panel}/${id} is not at its fitted coordinate: ${JSON.stringify({actual:[button.style.left,button.style.top],expected:[x,y],point:expected,box:{left:box.left,top:box.top,width:box.width,height:box.height},parent:{left:parent.left,top:parent.top}})}`);
        return button;
      };
      await open("mesh");
      let plan=await planDeformationWork(work), fit=await createMeshCoordinateMap(plan.shapeFitView.fit.mesh);
      const meshPanel="#mesh-workspace",pinPanel="#surface-workspace";
      const beforeMesh=JSON.stringify(work.meshEdits);
      const meshPoint=position(meshPanel,"6",fit.map(plan.shapeFitView.interiorMesh.vertices[6].warped));
      key(meshPoint,"ArrowRight");await frames();
      await wait(()=>!get(`${meshPanel} [data-role="apply"]`).disabled,"fitted Mesh nudge planned");
      const grabbed=get(`${meshPanel} [data-point-id="6"]`),grab=grabbed.getBoundingClientRect();
      const grabX=grab.left+grab.width/2,grabY=grab.top+grab.height/2,displayed=[parseFloat(grabbed.style.left),parseFloat(grabbed.style.top)];
      const drag=(type,dx,dy,buttons)=>grabbed.dispatchEvent(new PointerEvent(type,{clientX:grabX+dx,clientY:grabY+dy,pointerId:51,button:0,buttons,bubbles:true}));
      drag("pointerdown",0,0,1);drag("pointermove",1,1,1);drag("pointerup",1,1,0);await frames();
      check(Math.abs(parseFloat(grabbed.style.left)-displayed[0]-1)<.01 && Math.abs(parseFloat(grabbed.style.top)-displayed[1]-1)<.01,"fitted Mesh drag did not follow the pointer");
      await publish(meshPanel);
      check(JSON.stringify(work.meshEdits)!==beforeMesh && work.meshEdits.some(e=>e.column===2 && e.row===2 && e.warped.x===.52),"Mesh nudge lost a previous edit");
      fit.dispose();
      get("#workspace-tab-surface").click();
      await wait(()=>!get(pinPanel).hidden && !get(`${pinPanel} [data-role="apply"]`).disabled,"fitted Pin continuation");await frames();
      plan=await planDeformationWork(work);fit=await createMeshCoordinateMap(plan.shapeFitView.fit.mesh);
      let control=position(pinPanel,"5",fit.mapControl(work.surface.envelope.points[5],{x:1/3,y:1/3}));
      key(control,"ArrowRight");await frames();
      await wait(()=>!get(`${pinPanel} [data-role="apply"]`).disabled,"exterior control planned");
      const faultCanvas=get(`${pinPanel} canvas`),stablePreview=faultCanvas.toDataURL(),encode=faultCanvas.toBlob;
      const beforeFailure=window.fixtureMessages.length;
      faultCanvas.toBlob=callback=>callback(null);
      get(`${pinPanel} [data-role="apply"]`).click();
      await wait(()=>!get(`${pinPanel} [data-role="error"]`).hidden && !get(`${pinPanel} [data-role="apply"]`).disabled,"PNG failure recovery");
      faultCanvas.toBlob=encode;
      check(faultCanvas.toDataURL()===stablePreview && !window.fixtureMessages.slice(beforeFailure).some(m=>m.type==="apply-designer"),"PNG failure changed the editing preview or published a result");
      await publish(pinPanel);
      check(get(`${pinPanel} [data-role="error"]`).hidden,"successful retry retained a stale export error");
      check(work.surface.envelope.points[5].x<0 && work.surface.envelope.points[5].x!==-.05,"exterior cubic control was clamped or did not move");
      plan=await planDeformationWork(work);
      get(`${pinPanel} [data-role="tool-pin"]`).click();await frames();
      position(pinPanel,"2,2",fit.map(plan.pinView.resolvedMesh.vertices[12].warped));
      get(`${pinPanel} [data-role="tool-brush"]`).click();await frames();
      const preview=get(`${pinPanel} canvas`),beforeBrush=preview.toDataURL(),box=preview.getBoundingClientRect();
      const visible=uv=>fit.map(mapWarpMesh(plan.shapeFitView.interiorMesh,uv));
      const pointer=(type,uv,buttons)=>{const p=visible(uv);preview.dispatchEvent(new PointerEvent(type,{clientX:box.left+p.x*box.width,clientY:box.top+p.y*box.height,pointerId:41,button:0,buttons,bubbles:true}));};
      pointer("pointerdown",{x:.35,y:.3},1);pointer("pointerup",{x:.36,y:.3},0);await frames();
      await wait(()=>!get(`${pinPanel} [data-role="apply"]`).disabled,"fitted brush planned");
      const brushedPixels=preview.toDataURL();
      key(get(`${pinPanel} [data-role="tool-brush"]`),"z",{metaKey:true});await frames();
      check(preview.toDataURL()===beforeBrush,"fitted brush Undo did not restore pixels");
      key(get(`${pinPanel} [data-role="tool-brush"]`),"z",{metaKey:true,shiftKey:true});await frames();
      check(preview.toDataURL()===brushedPixels,"fitted brush Redo changed pixels");
      const brushed=await publish(pinPanel),sample=work.surface.strokes[0]?.samples[0];
      check(sample && Math.abs(sample.position.x-.36)<1e-6 && Math.abs(sample.position.y-.3)<1e-6,"brush did not invert the visible fitted interior");
      const image=await createImageBitmap(new Blob([Uint8Array.from(brushed.bytes)],{type:"image/png"}));
      const pixels=document.createElement("canvas");pixels.width=image.width;pixels.height=image.height;
      const pixelsContext=pixels.getContext("2d");pixelsContext.drawImage(image,0,0);image.close();
      // Export density is independent of the logical fitting coordinates.
      // A 2x publication needs 2x sample positions, not old 200x160 pixels.
      const alpha=(x,y)=>pixelsContext.getImageData(Math.floor(pixels.width*x),Math.floor(pixels.height*y),1,1).data[3];
      check(alpha(.2,.7)===0 && alpha(.8,.8)===0,"fitted publication lost its hole or concave notch");
      check(alpha(.75,.2)===255,"fitted publication erased the solid fitted artwork");
      get(`${pinPanel} [data-role="tool-handles"]`).click();await frames();
      control=position(pinPanel,"5",fit.mapControl(work.surface.envelope.points[5],{x:1/3,y:1/3}));
      const savedPosition=[control.style.left,control.style.top],savedPixels=preview.toDataURL();
      get(`${pinPanel} [data-role="back"]`).click();await ready();
      await refresh({...plain,targetNodeId:undefined,sourceNodeId:"other"});await open("pin");
      control=position(pinPanel,"5",fit.mapControl(work.surface.envelope.points[5],{x:1/3,y:1/3}));
      check(control.style.left===savedPosition[0] && control.style.top===savedPosition[1] && get(`${pinPanel} canvas`).toDataURL()===savedPixels,"reopen changed controls or fitted pixels");
      const resizedPanel=get(pinPanel),previewHost=get(`${pinPanel} .designer-preview`);
      resizedPanel.style.height="420px";await frames();await frames();
      const resizedCanvas=get(`${pinPanel} canvas`),resizedBox=resizedCanvas.getBoundingClientRect(),hostBox=previewHost.getBoundingClientRect();
      check(resizedBox.top>=hostBox.top && resizedBox.bottom<=hostBox.bottom+.01,"resizing clipped the fitted artwork");
      position(pinPanel,"5",fit.mapControl(work.surface.envelope.points[5],{x:1/3,y:1/3}));
      check(resizedCanvas.toDataURL()===savedPixels,"resizing changed fitted pixels");
      resizedPanel.style.height="";await frames();await frames();
      // A notch has no image coordinates and must not create a new stroke.
      get(`${pinPanel} [data-role="tool-brush"]`).click();await frames();
      const reopened=get(`${pinPanel} canvas`),reopenedBox=reopened.getBoundingClientRect();
      for(const type of ["pointerdown","pointerup"])reopened.dispatchEvent(new PointerEvent(type,{clientX:reopenedBox.left+.8*reopenedBox.width,clientY:reopenedBox.top+.8*reopenedBox.height,pointerId:42,button:0,buttons:type==="pointerdown"?1:0,bubbles:true}));
      await frames();await publish(pinPanel);
      check(work.surface.strokes.length===1,"painting in a concave notch created a stroke");
      fit.dispose();
      // Both views save one complete recipe. A cold library round trip must
      // retain its mask, strokes, landmarks and placements without baking.
      const savedWork=structuredClone(work),savedPreview=get(`${pinPanel} canvas`).toDataURL();
      for (const view of ["pin","mesh"]) {
        const workspace=view==="pin"?"surface":"mesh",panel=`#${workspace}-workspace`;
        get(`#workspace-tab-${workspace}`).click();
        await wait(()=>!get(panel).hidden&&!get(`${panel} [data-role="apply"]`).disabled,"template view ready");await frames();
        const name=get(`${panel} [data-role="template-name"]`);name.value=`Fitted ${view}`;
        name.dispatchEvent(new Event("input",{bubbles:true}));
        const seenSave=window.fixtureMessages.length;get(`${panel} [data-role="save-template"]`).click();
        await wait(()=>window.fixtureMessages.slice(seenSave).some(m=>m.type==="save-template"),"complete fitted template saved");
        const saved=window.fixtureMessages.findLast(m=>m.type==="save-template");
        check(saved.template.operation.kind==="deformation"&&saved.template.operation.view===view,"template saved one legacy view");
        for (const block of ["shapeFit","surface","liquify","meshEdits","transform"]) {
          check(JSON.stringify(saved.template.operation.spec[block])===JSON.stringify(savedWork[block]),`template lost ${block}`);
        }
        const record=JSON.parse(JSON.stringify({id:`fit-${view}`,name:`Fitted ${view}`,template:saved.template,slots:saved.slots}));
        send({type:"template-library",templates:[record],mutation:{kind:"save",workspace,requestId:saved.requestId}});await frames();
        get(`${panel} [data-role="back"]`).click();await ready();
        await refresh({...plain,targetNodeId:undefined,sourceNodeId:`replacement-${view}`});
        get("#workspace-tab-templates").click();
        await wait(()=>!get("#templates-workspace").hidden&&document.querySelector(`[data-template-id="fit-${view}"]`),"cold fitted library visible");
        const item=get(`[data-template-id="fit-${view}"]`);
        await wait(()=>item.querySelector("svg path"),"fitted thumbnail with mask");
        const thumbnail=item.querySelector("svg");
        check(thumbnail.querySelector('path[fill-rule="evenodd"]'),"template thumbnail lost the compound fill");
        const thumbnailImage=new Image();
        thumbnailImage.src="data:image/svg+xml;base64,"+btoa(new XMLSerializer().serializeToString(thumbnail));
        await thumbnailImage.decode();
        const thumb=document.createElement("canvas");thumb.width=120;thumb.height=80;
        const tc=thumb.getContext("2d");tc.drawImage(thumbnailImage,0,0,120,80);
        const size=savedWork.targetSize,scale=Math.min(96/size.width,56/size.height);
        const alpha=(x,y)=>tc.getImageData(Math.round(60+(x-.5)*size.width*scale),Math.round(40+(y-.5)*size.height*scale),1,1).data[3];
        check(alpha(.1,.1)>20 && alpha(.21,.7)===0 && alpha(.8,.8)===0,"template thumbnail misrepresented the hole, notch or bounds");
        item.click();get('#templates-workspace [data-role="apply"]').click();
        await wait(()=>!get(panel).hidden&&!get(`${panel} [data-role="apply"]`).disabled,"fitted template reused");await frames();
        check(get(`${panel} canvas`).toDataURL()===savedPreview,"reusing the fitted template changed pixels");
        const reused=await publish(panel);
        check(reused.sourceNodeIds[0]===`replacement-${view}`,"template retained the old artwork binding");
        check(JSON.stringify(reused.task.spec.shapeFit)===JSON.stringify(savedWork.shapeFit)&&
          JSON.stringify(reused.task.spec.liquify)===JSON.stringify(savedWork.liquify),"template publication lost fitted painting");
        // Direct manipulation continues after Use and local Undo recovers the
        // exact complete template baseline, including the mask.
        if(view==="pin") {get(`${panel} [data-role="tool-handles"]`).click();await frames();}
        const handle=get(`${panel} .direct-point`);key(handle,"ArrowRight");await frames();
        key(handle,"z",{metaKey:true});await frames();
        check(get(`${panel} canvas`).toDataURL()===savedPreview,"continued template editing did not undo to its baseline");
        // A different aspect ratio changes output size, not normalized authored
        // coordinates. Restore the original selection for the next view case.
        get(`${panel} [data-role="back"]`).click();await ready();
        await refresh({...plain,targetNodeId:undefined,sourceNodeId:`wide-${view}`,renderWidth:300,renderHeight:100,
          placement:{...plain.placement,width:300,height:100}});
        get("#workspace-tab-templates").click();await wait(()=>!get("#templates-workspace").hidden,"wide template list");
        get(`[data-template-id="fit-${view}"]`).click();get('#templates-workspace [data-role="apply"]').click();
        await wait(()=>!get(panel).hidden&&!get(`${panel} [data-role="apply"]`).disabled,"wide fitted template opened");await frames();
        const wide=await publish(panel);
        check(wide.renderWidth===600 && wide.renderHeight===200 && wide.task.spec.targetSize.width===300 && wide.task.spec.targetSize.height===100,
          `template did not preserve logical replacement size and HD density: ${JSON.stringify({render:[wide.renderWidth,wide.renderHeight],logical:wide.task.spec.targetSize})}`);
        for (const block of ["shapeFit","surface","liquify","meshEdits"]) check(JSON.stringify(wide.task.spec[block])===JSON.stringify(savedWork[block]),`wide template changed ${block}`);
        get(`${panel} [data-role="back"]`).click();await ready();
        await refresh({...plain,targetNodeId:undefined,sourceNodeId:`restored-${view}`});
        get("#workspace-tab-templates").click();await wait(()=>!get("#templates-workspace").hidden,"restored template list");
        get(`[data-template-id="fit-${view}"]`).click();get('#templates-workspace [data-role="apply"]').click();
        await wait(()=>!get(panel).hidden&&!get(`${panel} [data-role="apply"]`).disabled,"restored fitted template opened");await frames();
        work=structuredClone(savedWork);

      }
      const completeTemplate={schema:"worldbend.figma-task-template",version:"0.1",operation:{kind:"deformation",view:"mesh",spec:savedWork}};
      const record={id:"fit-cancel",name:"Complete fit",template:completeTemplate};
      send({type:"template-library",templates:[record]});get("#workspace-tab-templates").click();
      await wait(()=>!get("#templates-workspace").hidden,"cancellable template list");
      get('[data-template-id="fit-cancel"]').click();get('#templates-workspace [data-role="apply"]').click();
      get("#workspace-tab-perspective").click();await ready();await frames();
      check(get(meshPanel).hidden && get(pinPanel).hidden,"a late template use switched back after leaving");
      get("#workspace-tab-templates").click();await frames();
      get('[data-template-id="fit-cancel"]').click();get('#templates-workspace [data-role="apply"]').click();
      generation+=1;send({type:"selection-loading",generation,nodeIds:["cancelled-replacement"]});
      send({type:"source",generation,payload:{...plain,targetNodeId:undefined,sourceNodeId:"cancelled-replacement"}});
      await wait(()=>!get('#templates-workspace [data-role="apply"]').disabled,"selection cancelled pending Use");await frames();
      check(get(meshPanel).hidden && get(pinPanel).hidden,"pending Use overwrote the newer selection view");
      // A wire-valid but folded recipe fails before it replaces a workspace.
      const invalid=structuredClone(record);invalid.id="folded-fit";invalid.template.operation.spec.meshEdits[0].warped={x:2,y:2};
      send({type:"template-library",templates:[invalid]});await frames();
      get('[data-template-id="folded-fit"]').click();const seenInvalid=window.fixtureMessages.length;
      get('#templates-workspace [data-role="apply"]').click();
      await wait(()=>!get('#templates-workspace [data-role="error"]').hidden&&!get('#templates-workspace [data-role="apply"]').disabled,"failed template Use recovery");
      check(get(meshPanel).hidden && get(pinPanel).hidden && !window.fixtureMessages.slice(seenInvalid).some(m=>m.type==="apply-designer"),"invalid template changed the work or published pixels");
      send({type:"template-library",templates:[record]});await frames();
      get('[data-template-id="fit-cancel"]').click();get('#templates-workspace [data-role="apply"]').click();
      await wait(()=>!get(meshPanel).hidden&&!get(`${meshPanel} [data-role="apply"]`).disabled,"template retry succeeded");await frames();
      check(get(`${meshPanel} canvas`).toDataURL()===savedPreview,"retry after failed Use lost the complete template");
      work=structuredClone(savedWork);

    } else if (scenario === "deformation-plane-roundtrip") {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // The Plane editor's publication may request a higher-resolution source
      // raster, exactly like its ordinary HD route.
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type !== "request-source-raster") return;
        const fresh = document.createElement("canvas");
        fresh.width = request.desiredWidth; fresh.height = request.desiredHeight;
        fresh.getContext("2d").drawImage(canvas, 0, 0, fresh.width, fresh.height);
        const pixels = Uint8Array.from(atob(fresh.toDataURL().split(",")[1]), character => character.charCodeAt(0));
        send({ type: "source-raster", generation: request.generation, requestId: request.requestId, bytes: pixels });
      });
      const { spec: _spec, nativeTarget: _nativeTarget, nativeRenderer: _nativeRenderer, ...plain } = payload;
      const workQuad = { tl: { x: .1, y: .05 }, tr: { x: .95, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: .9 } };
      const work = {
        schema: "worldbend.deformation-work", version: "0.1",
        transform: {
          schema: "worldbend.transform", version: "0.1",
          destination: { space: "normalized", quad: workQuad }, content: { fit: "stretch" },
        },
        targetSize: { width: 200, height: 160 },
        meshSubdivisions: 4,
        meshEdits: [{ column: 1, row: 1, warped: { x: .3, y: .35 } }],
      };
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["result"] });
      send({ type: "source", generation, payload: {
        ...plain, targetNodeId: "result", task: { kind: "deformation", view: "mesh", spec: work },
      } });
      const panel = "#mesh-workspace";
      await wait(() => !get(panel).hidden && document.querySelector(`${panel} .direct-point`) &&
        !get(`${panel} [data-role="apply"]`).disabled, "stored deformation work opened in Mesh");
      await frames();
      const saveMesh = async () => {
        const seen = window.fixtureMessages.length;
        const field = get(`${panel} [data-role="template-name"]`); field.value = "Roundtrip fixture";
        field.dispatchEvent(new Event("input", { bubbles: true }));
        get(`${panel} [data-role="save-template"]`).click();
        await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "save-template"), "saved mesh spec");
        const request = window.fixtureMessages.findLast(m => m.type === "save-template");
        send({ type: "template-library", templates: [], mutation: { kind: "save", workspace: "mesh", requestId: request.requestId } });
        return request.template.operation.spec;
      };

      // Returning to the Plane editor loads the work's plane as the continued
      // editing basis instead of an unrelated identity frame.
      get(`${panel} [data-role="back"]`).click();
      await ready();
      const carriedLabel = () => corner().getAttribute("aria-label");
      await wait(() => carriedLabel().includes("x 10.00%") && carriedLabel().includes("y 5.00%"),
        "carried deformation plane did not load into the Plane editor");

      // Plane edits compose over the carried work; the re-based history keeps
      // Undo inside the carried session and restores its exact baseline.
      await moveCorner();
      const editedLabel = carriedLabel();
      undo();
      await wait(() => carriedLabel().includes("x 10.00%") && carriedLabel().includes("y 5.00%"),
        "plane Undo did not restore the carried baseline");
      key(document.activeElement, "z", { metaKey: true, shiftKey: true });
      await wait(() => carriedLabel() === editedLabel, "plane Redo lost the carried edit");

      // Re-entering Mesh composes the live plane into the same work while the
      // interior edit and its density stay exactly as authored.
      get("#workspace-tab-mesh").click();
      await wait(() => !get(panel).hidden && !get(`${panel} [data-role="apply"]`).disabled, "Mesh re-entered over the carried work");
      await frames();
      const composed = await saveMesh();
      check(composed.meshSubdivisions === 4 &&
        composed.meshEdits.some(edit => edit.column === 1 && edit.row === 1 && edit.warped.x === .3 && edit.warped.y === .35),
        "plane edits disturbed the carried interior deformation");
      check(composed.transform.destination.quad.tl.x !== .1,
        "composed Mesh view lost the live plane edit");

      // The Pin view recognizes the same work: its density controls lock
      // because explicit Mesh edits exist.
      get("#workspace-tab-surface").click();
      await wait(() => !get("#surface-workspace").hidden &&
        !get("#surface-workspace [data-role=\"apply\"]").disabled, "Pin view opened over the shared work");
      await frames();
      check(get("#surface-workspace [data-role=\"patches\"]").disabled,
        "Pin view did not recognize Mesh edits from the shared work");
      get("#surface-workspace [data-role=\"back\"]").click();
      await ready();

      // A preset Warp cannot compose with the carried interior: the switch is
      // refused with its reason, and clearing the Warp restores the route.
      get("#mode-warp").click(); await frames();
      const preset = get("#warp-preset");
      preset.value = "arc"; preset.dispatchEvent(new Event("change", { bubbles: true }));
      const amount = get("#warp-amount");
      amount.value = "50"; amount.dispatchEvent(new Event("change", { bubbles: true }));
      await frames(); await delay();
      get("#workspace-tab-mesh").click(); await frames(); await delay();
      check(!get("#error").hidden && get("#error-text").textContent.includes("preset Warp"),
        "Warp composition did not explain its refusal");
      check(get(panel).hidden, "Warp refusal still entered the Mesh view");
      amount.value = "0"; amount.dispatchEvent(new Event("change", { bubbles: true }));
      await frames(); await delay();
      get("#workspace-tab-mesh").click();
      await wait(() => !get(panel).hidden && !get(`${panel} [data-role="apply"]`).disabled,
        "clearing Warp did not restore the deformation route");
      get(`${panel} [data-role="back"]`).click();
      await ready();

      // Publishing from the Plane editor emits one deformation task carrying
      // both the plane edit and the interior, never a plane-only result.
      const seen = window.fixtureMessages.length;
      get("#apply").click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"),
        "Plane editor deformation publication");
      check(!window.fixtureMessages.slice(seen).some(m => m.type === "apply" || m.type === "apply-native"),
        "Plane editor published a plane-only result over a carried deformation");
      const published = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check(published.task.kind === "deformation" && published.task.view === "mesh",
        "Plane publication lost the shared deformation task");
      check(published.task.spec.meshEdits.length === 1 &&
        published.task.spec.meshEdits[0].warped.x === .3 && published.task.spec.meshEdits[0].warped.y === .35,
        "Plane publication lost the interior edit");
      check(published.task.spec.transform.destination.quad.tl.x !== .1,
        "Plane publication lost the plane edit");
      check(published.bytes.length > 0, "Plane publication produced no output");
      send({ type: "apply-designer-complete", generation, targetNodeId: "result", operation: "replace" });
      await frames();

      // Undo after publication routes to the host document history.
      const seenUndo = window.fixtureMessages.length;
      get("#mode-distort").focus();
      key(document.activeElement, "z", { metaKey: true });
      await wait(() => window.fixtureMessages.slice(seenUndo).some(m => m.type === "trigger-undo"),
        "applied Plane publication did not route Undo to the host");
    } else if (scenario === "native-linked-batch") {
      const ids=["native-a","native-b","whole-image"];
      await refresh({...payload,targetNodeId:undefined,nativeTarget:undefined,nativeRenderer:undefined,
        linkedResults:{total:3,items:ids.map(nodeId=>({nodeId,name:nodeId,revision:1,kind:"transform"}))}});
      const applied=[],exports=[];let rejectB=true,hold=false,held,runId=0;
      const planeB=structuredClone(spec);planeB.destination.quad.tr.y=.12;
      const nativeReply=p=>({type:"native-vector-projection",generation:p.generation,batchResultId:p.batchResultId,batchRunId:p.batchRunId,placement:p.placement,
        inputs:[{schema:"worldbend.vector-projection",version:"0.1",path:{
          vertices:[{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}],
          segments:[{start:0,end:1},{start:1,end:2},{start:2,end:3},{start:3,end:0}],
          regions:[{windingRule:"NONZERO",loops:[[0,1,2,3]]}]},sourceTransform:[1,0,0,0,1,0],
          sourceBounds:{x:0,y:0,width:100,height:80},homography:p.matrix,reference:{width:p.renderWidth,height:p.renderHeight},
          placement:{width:p.placement.width,height:p.placement.height},tolerancePx:.25}]});
      addEventListener("message",event=>{const m=event.data?.pluginMessage;
        if(m?.type==="prepare-linked-batch"){runId++;send({type:"linked-batch",generation:m.generation,items:ids.map((id,i)=>({
          nodeId:id,name:id,revision:1,kind:"transform",width:200,height:160,placement:{x:300+i*240,y:200,width:200,height:160},
          operationKind:"transform",operationJson:JSON.stringify(i===1?planeB:spec),sourceNodeIds:[i===2?"assembly":"content"],
          dependencyNodeIds:i===2?["native-a"]:[],batchRunId:runId,...(i<2?{nativeVector:true}:{})}))});}
        if(m?.type==="request-native-vector-projection"){
          if(hold){held=nativeReply(m.payload);return;}
          if(m.payload.batchResultId==="native-b"&&rejectB){send({type:"native-vector-projection-error",generation:m.payload.generation,
            batchResultId:"native-b",batchRunId:m.payload.batchRunId,message:{key:"resultChanged"}});return;}
          // A late response for a different item cannot resolve this relay.
          send({...nativeReply(m.payload),batchResultId:"retired-native-result"});
          const retired=nativeReply(m.payload);retired.batchRunId-=1;retired.inputs[0].path.vertices=[];send(retired);
          send({type:"apply-error",generation:m.payload.generation,batchResultId:m.payload.batchResultId,batchRunId:m.payload.batchRunId-1,message:{key:"unexpectedError"}});
          send(nativeReply(m.payload));
        }
        if(m?.type==="apply-native-vector"){
          check(window.fixtureMessageGuard(m),"native batch sent an invalid publication");
          check(m.payload.projection.outputs.length===1&&m.payload.projection.outputs[0].network.vertices.length>=4,"missing actual core vectors");
          applied.push(m);send({type:"apply-complete",generation:m.payload.generation,batchResultId:m.payload.batchResultId,batchRunId:m.payload.batchRunId,
            targetNodeId:m.payload.targetNodeId,operation:"replace"});
        }
        if(m?.type==="export-batch-source"){
          check(applied.some(a=>a.payload.batchResultId==="native-a"),"dependent exported before native publication");
          exports.push(m.nodeId);send({type:"batch-source",generation:m.generation,batchRunId:m.batchRunId,requestId:m.requestId,
            resultNodeId:m.resultNodeId,nodeId:m.nodeId,
            bytes,renderWidth:200,renderHeight:160});
        }
        if(m?.type==="apply-linked-batch-item"){
          check(m.payload.nodeId==="whole-image","native output was silently rasterized");applied.push(m);
          send({type:"apply-complete",generation:m.payload.generation,batchResultId:m.payload.nodeId,
            batchRunId:m.payload.batchRunId,targetNodeId:m.payload.nodeId,operation:"replace"});
        }
      });
      get("#linked-results-trigger").click();get("#linked-batch-action").click();
      await wait(()=>get("#status").textContent.includes("2 of 3"),"native batch partial outcome");
      check(get("#error").hidden,"retired batch reply changed ordinary editor state");
      check(applied.map(m=>m.payload.batchResultId??m.payload.nodeId).join() === "native-a,whole-image","native partial-failure isolation");
      check(exports.includes("assembly"),"downstream source was not exported freshly");
      check(JSON.stringify(applied[0].payload.operation.spec)===JSON.stringify(spec),"native update changed the saved transform");
      rejectB=false;get("#linked-results-trigger").click();get("#linked-batch-action").click();
      await wait(()=>get("#status").textContent.includes("3 of 3"),"native batch retry");
      check(get("#error").hidden,"retired reply escaped retry isolation");
      const second=applied.find(m=>m.payload.batchResultId==="native-b");
      check(second&&JSON.stringify(second.payload.operation.spec)===JSON.stringify(planeB),"distinct native transform was replaced");
      hold=true;const publishedBefore=applied.length;
      get("#linked-results-trigger").click();get("#linked-batch-action").click();await wait(()=>held,"held native capture");
      get("#linked-batch-action").click();send(held);
      await wait(()=>get("#status").textContent.includes("0 of 3"),"native preparation cancellation");
      check(applied.length===publishedBefore,"cancelled native preparation published a result");
    } else if (scenario === "linked-dependencies") {
      const ids = ["local", "selfsample", "whole", "independent"];
      await refresh({ ...payload, targetNodeId: undefined, nativeTarget: false, linkedResults: { total: 4,
        items: ids.map(nodeId => ({ nodeId, name: nodeId, revision: 1, kind: "transform" })) } });
      let failLocal = true;
      let damageLocal = false;
      let localPublished = false;
      let runNumber = 0;
      let holdPrepare = false;
      let heldPrepare;
      let holdLocal = false;
      let heldLocal;
      let holdExport = false;
      const heldExports = [];
      const freshCanvas = document.createElement("canvas"); freshCanvas.width = 200; freshCanvas.height = 160;
      freshCanvas.getContext("2d").fillStyle = "#a933cc";
      freshCanvas.getContext("2d").fillRect(0, 0, 200, 160);
      const freshBytes = Uint8Array.from(atob(freshCanvas.toDataURL().split(",")[1]), char => char.charCodeAt(0));
      const published = [];
      const exportedSources = [];
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type === "prepare-linked-batch") {
          runNumber += 1; localPublished = false;
          const reply = { type: "linked-batch", generation: request.generation, items: ids.map(nodeId => ({
            nodeId, name: nodeId, revision: 1, kind: damageLocal && nodeId === "local" ? "invalid" : "transform", width: 200, height: 160,
            placement: { x: 0, y: 0, width: 200, height: 160 }, operationKind: "transform", operationJson: JSON.stringify(spec),
            batchRunId: runNumber,
            sourceNodeIds: [nodeId === "whole" ? "assembly" : "content"],
            dependencyNodeIds: nodeId === "whole" || nodeId === "selfsample" ? ["local"] : [],
            ...(damageLocal && nodeId === "local" ? { updatable: false } : {}),
          })) };
          if (holdPrepare) heldPrepare = reply;
          else send(reply);
        }
        if (request?.type === "export-batch-source") {
          const downstream = request.resultNodeId === "whole" || request.resultNodeId === "selfsample";
          if (downstream) check(localPublished, "assembled source exported before its local update succeeded");
          check(request.nodeId === "assembly" || request.nodeId === "content", "wrong downstream source");
          exportedSources.push({ runNumber, nodeId: request.nodeId });
          const raster = document.createElement("canvas"); raster.width = request.desiredWidth; raster.height = request.desiredHeight;
          raster.getContext("2d").drawImage(downstream ? freshCanvas : canvas,0,0,raster.width,raster.height);
          const rasterBytes = Uint8Array.from(atob(raster.toDataURL().split(",")[1]), char => char.charCodeAt(0));
          if (holdExport) { heldExports.push({ request, rasterBytes }); return; }
          send({ type: "batch-source", generation: request.generation, batchRunId: request.batchRunId, requestId: request.requestId,
            resultNodeId: request.resultNodeId,
            nodeId: request.nodeId, bytes: rasterBytes, renderWidth: raster.width, renderHeight: raster.height });
        }
        if (request?.type === "apply-linked-batch-item") {
          const id = request.payload.nodeId;
          if (id === "local" && holdLocal) { heldLocal = request.payload; return; }
          if (id === "local" && failLocal) {
            failLocal = false;
            send({ type: "apply-error", generation: request.payload.generation, batchResultId: id,
              batchRunId: request.payload.batchRunId, message: { key: "resultChanged" } });
          } else {
            if (id === "local") localPublished = true;
            published.push({ runNumber, ...request.payload });
            send({ type: "apply-complete", generation: request.payload.generation, batchResultId: id,
              batchRunId: request.payload.batchRunId, targetNodeId: id, operation: "replace" });
          }
        }
      });
      get("#linked-results-trigger").click(); get("#linked-batch-action").click();
      await wait(() => get("#status").textContent.includes("1 of 4"), "partial dependency outcome");
      check(published.length === 1 && published[0].nodeId === "independent", "failed local output did not isolate its dependent");
      get("#linked-results-trigger").click();
      check(get("#linked-results-list").textContent.includes("Update the earlier result successfully"), "blocked whole lacks recovery reason");
      get("#linked-batch-action").click();
      await wait(() => get("#status").textContent.includes("4 of 4"), "dependency retry completion");
      check(published.filter(item => item.runNumber === 2).map(item => item.nodeId).join() === ids.join(), "retry publication order");
      const whole = published.find(item => item.nodeId === "whole");
      check(whole.sourceNodeIds.join() === "assembly", "whole binding replaced with original source");
      const image = await createImageBitmap(new Blob([whole.bytes], { type: "image/png" }));
      const sample = document.createElement("canvas"); sample.width = 200; sample.height = 160;
      const ctx = sample.getContext("2d"); ctx.drawImage(image, 0, 0); image.close();
      const rgba = ctx.getImageData(100, 80, 1, 1).data;
      check(Math.abs(rgba[0] - 169) < 3 && Math.abs(rgba[1] - 51) < 3 && Math.abs(rgba[2] - 204) < 3,
        `whole used stale original pixels instead of fresh assembled pixels: ${[...rgba]}`);
      // A dependent item sampling the SELECTED source itself must also export
      // freshly after its prerequisite publishes inside that source.
      check(exportedSources.some(item => item.runNumber === 2 && item.nodeId === "content"),
        "dependent item reused the stale selection raster of its own source");
      const selfsample = published.find(item => item.nodeId === "selfsample");
      const selfImage = await createImageBitmap(new Blob([selfsample.bytes], { type: "image/png" }));
      ctx.drawImage(selfImage, 0, 0); selfImage.close();
      const selfRgba = ctx.getImageData(100, 80, 1, 1).data;
      check(Math.abs(selfRgba[0] - 169) < 3 && Math.abs(selfRgba[1] - 51) < 3 && Math.abs(selfRgba[2] - 204) < 3,
        `dependent item used stale selection pixels: ${[...selfRgba]}`);
      damageLocal = true;
      const beforeDamaged = published.length;
      get("#linked-batch-action").click();
      await wait(() => get("#status").textContent.includes("1 of 4"), "damaged prerequisite outcome");
      check(published.length === beforeDamaged + 1 && published.at(-1).nodeId === "independent",
        "damaged prerequisite or its stale consumers were published");
      get("#linked-results-trigger").click();
      check(get("#linked-results-list").textContent.includes("Needs repair"), "damaged result vanished from the report");
      check(get("#linked-results-list").textContent.includes("The saved operation needs repair"), "damaged operation is misreported as a transient conflict");
      check(get("#linked-results-list").textContent.includes("Update the earlier result successfully"), "damaged dependency lacks recovery reason");
      damageLocal = false;
      // Preparing is also an owned request: repeated clicks cannot replace
      // its resolver, and an old selection's late reply cannot start a new run.
      holdPrepare = true;
      get("#linked-batch-action").click();
      await wait(() => heldPrepare, "held prepare");
      const stalePrepare = heldPrepare;
      const prepares = window.fixtureMessages.filter(m => m.type === "prepare-linked-batch").length;
      check(get("#linked-batch-action").disabled, "prepare remains reentrant");
      get("#linked-batch-action").click();
      check(window.fixtureMessages.filter(m => m.type === "prepare-linked-batch").length === prepares, "repeated click posted another prepare");
      await refresh({ ...payload, targetNodeId: undefined, nativeTarget: false, linkedResults: { total: 4,
        items: ids.map(nodeId => ({ nodeId, name: nodeId, revision: 2, kind: "transform" })) } });
      heldPrepare = undefined;
      get("#linked-results-trigger").click(); get("#linked-batch-action").click();
      await wait(() => heldPrepare, "new prepare after selection refresh");
      const beforeLate = published.length;
      send(stalePrepare);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      check(get("#linked-batch-action").disabled && published.length === beforeLate, "late old prepare consumed the new request");
      send(heldPrepare); holdPrepare = false;
      await wait(() => published.length === beforeLate + 4, "new prepare completion");
      await wait(() => get("#status").textContent.includes("4 of 4"), "new prepare report");
      // Changing the artwork during an in-flight publication finishes that
      // item but cancels the remaining chain and preserves the new UI status.
      holdLocal = true;
      const holdStart = window.fixtureMessages.length;
      get("#linked-batch-action").click();
      await wait(() => heldLocal, "held local publication");
      const staleGeneration = heldLocal.generation;
      await refresh({ ...payload, targetNodeId: undefined, nativeTarget: false,
        sourceNodeId: "next-artwork", sourceName: "Next artwork" });
      const newStatus = get("#status").textContent;
      // The in-flight publication completes with its own run identity; the
      // untagged editor completion that follows must not touch the batch.
      send({ type: "apply-complete", generation: staleGeneration, batchResultId: "local",
        batchRunId: heldLocal.batchRunId, targetNodeId: "local", operation: "replace" });
      send({ type: "apply-complete", generation: staleGeneration, targetNodeId: "local", operation: "replace" });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      check(window.fixtureMessages.slice(holdStart).filter(m => m.type === "apply-linked-batch-item" && m.payload.generation === staleGeneration).length === 1,
        "selection change published the remaining old chain");
      check(get("#status").textContent === newStatus, "old batch report replaced the new artwork status");
      // Execution includes results beyond the 32-row discovery menu. A failure
      // there must remain identifiable and reopenable in the completed report.
      holdLocal = false; failLocal = true;
      ids.splice(0, ids.length, ...Array.from({ length: 32 }, (_, index) => `overflow-${index}`), "local");
      await refresh({ ...payload, targetNodeId: undefined, nativeTarget: false, linkedResults: { total: ids.length,
        items: ids.slice(0, 32).map(nodeId => ({ nodeId, name: nodeId, revision: 3, kind: "transform" })) } });
      get("#linked-results-trigger").click(); get("#linked-batch-action").click();
      await wait(() => get("#status").textContent.includes("32 of 33"), "overflow failure summary");
      const overflowRows = [...get("#linked-results-list").querySelectorAll("button")];
      const failedRow = overflowRows.find(row => row.textContent.includes("local"));
      check(failedRow?.textContent.includes("Changed elsewhere") && failedRow.textContent.includes("changed"),
        "the failed 33rd result is hidden behind the discovery limit");
      check(get("#linked-results-more").hidden, "complete batch report still advertises hidden results");
      failedRow.focus();
      failedRow.scrollIntoView({ block: "nearest" });
      const failedBounds = failedRow.getBoundingClientRect();
      const reportBounds = get("#linked-results-popover").getBoundingClientRect();
      check(document.activeElement === failedRow && failedBounds.top >= reportBounds.top &&
        failedBounds.bottom <= Math.min(reportBounds.bottom, innerHeight) && failedBounds.left >= 0 && failedBounds.right <= innerWidth,
        "overflow failure cannot be reached in the visible report");
      const beforeReopen = window.fixtureMessages.length;
      failedRow.click();
      await wait(() => window.fixtureMessages.slice(beforeReopen).some(m => m.type === "select-linked-result" &&
        m.resultNodeId === "local"), "failed overflow result cannot reopen for recovery");
      // A late bound-source reply from a retired attempt cannot satisfy the
      // current request: while one export is pending, a reply with another
      // attempt's identity is dropped and the run stays put.
      ids.splice(0, ids.length, "local", "selfsample", "whole", "independent");
      await refresh({ ...payload, targetNodeId: undefined, nativeTarget: false, linkedResults: { total: ids.length,
        items: ids.map(nodeId => ({ nodeId, name: nodeId, revision: 4, kind: "transform" })) } });
      holdExport = true;
      get("#linked-results-trigger").click();
      get("#linked-batch-action").click();
      await wait(() => heldExports.length === 1, "held bound-source export");
      const pending = heldExports[0];
      const appliesBeforeStale = published.length;
      send({ type: "batch-source", generation: pending.request.generation, batchRunId: pending.request.batchRunId,
        requestId: pending.request.requestId - 1, resultNodeId: pending.request.resultNodeId,
        nodeId: pending.request.nodeId, bytes: pending.rasterBytes, renderWidth: 200, renderHeight: 160 });
      send({ type: "batch-source", generation: pending.request.generation, batchRunId: pending.request.batchRunId + 7,
        requestId: pending.request.requestId, resultNodeId: pending.request.resultNodeId,
        nodeId: pending.request.nodeId, bytes: pending.rasterBytes, renderWidth: 200, renderHeight: 160 });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      check(published.length === appliesBeforeStale, "a retired attempt's export reply advanced the batch");
      holdExport = false;
      send({ type: "batch-source", generation: pending.request.generation, batchRunId: pending.request.batchRunId,
        requestId: pending.request.requestId, resultNodeId: pending.request.resultNodeId,
        nodeId: pending.request.nodeId, bytes: pending.rasterBytes, renderWidth: 200, renderHeight: 160 });
      await wait(() => published.length > appliesBeforeStale, "current attempt's reply did not advance the batch");
    } else if (scenario === "linked-batch") {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const { spec: _spec, nativeTarget: _nativeTarget, nativeRenderer: _nativeRenderer, targetNodeId: _targetNodeId, ...plain } = payload;
      const plane = { schema: "worldbend.transform", version: "0.1", destination: {
        space: "normalized", quad: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } },
      }, content: { fit: "stretch" } };
      const deformationTask = { kind: "deformation", view: "mesh", spec: {
        schema: "worldbend.deformation-work", version: "0.1", transform: plane,
        targetSize: { width: 200, height: 160 }, meshSubdivisions: 4,
        meshEdits: [{ column: 1, row: 1, warped: { x: .3, y: .3 } }],
      } };
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["content"] });
      send({ type: "source", generation, payload: { ...plain, sourceNodeId: "content",
        linkedResults: { total: 5, items: [
          { nodeId: "result-deform", name: "Poster · Worldbend", revision: 2, kind: "deformation", position: { x: 700, y: 200 } },
          { nodeId: "result-plane", name: "Label · Worldbend", revision: 1, kind: "transform", position: { x: 700, y: 420 } },
          { nodeId: "result-correct", name: "Sign · Worldbend", revision: 4, kind: "rectify", position: { x: 700, y: 640 } },
          { nodeId: "result-scene", name: "Scene · Worldbend", revision: 1, kind: "mockup", position: { x: 700, y: 860 } },
          { nodeId: "result-composition", name: "Campaign · Worldbend", revision: 2, kind: "composition", position: { x: 700, y: 1060 } },
        ] } } });
      await wait(() => !get("#linked-results-trigger").hidden && !get("#linked-results-trigger").disabled, "linked results entry");
      get("#linked-results-trigger").click();
      await wait(() => !get("#linked-results-popover").hidden, "popover open");
      // The batch prepare answer with the correlated stored operations.
      let failNextBatchItem = true;
      let holdBatchItem = false;
      const mockupTask = { kind: "mockup", spec: {
        schema: "worldbend.mockup", version: "0.1",
        canvas: { width: 200, height: 160 }, background: { kind: "transparent" },
        planes: [
          { id: "plane-1", sourceId: "source-1", transform: plane, opacity: 0 },
          { id: "plane-2", sourceId: "source-2", transform: plane, opacity: 1 },
        ],
        seams: [],
      } };
      const compositionTask = { kind: "composition", previewOutputId: "square", template: {
        schema: "worldbend.spatial-template", version: "0.1", operation: {
          kind: "compositionProgram", composition: mockupTask.spec,
          postprocess: { schema: "worldbend.raster-program", version: "0.1", stages: [{
            kind: "transform", id: "whole", canvas: "reference", target_size: { width: 200, height: 160 },
            spec: { ...plane, content: { fit: "stretch", warp: { preset: "arch", amount: .3 } } },
          }] },
        }, output: { kind: "canvasSet", spec: { schema: "worldbend.canvas-set", version: "0.1", variants: [
          { id: "wide", operation: { kind: "stretch", output: { width: 200, height: 160 } } },
          { id: "square", operation: { kind: "contain", output: { width: 200, height: 200 }, anchor: { x: .5, y: .5 }, background: { kind: "transparent" } } },
        ] } },
      } };
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type === "prepare-linked-batch") {
          send({ type: "linked-batch", generation: request.generation, items: [
            { nodeId: "result-deform", name: "Poster · Worldbend", revision: 2, kind: "deformation",
              width: 200, height: 160, placement: { x: 700, y: 200, width: 200, height: 160 },
              operationKind: "task", operationJson: JSON.stringify(deformationTask), batchRunId: 1 },
            { nodeId: "result-plane", name: "Label · Worldbend", revision: 1, kind: "transform",
              width: 200, height: 160, placement: { x: 700, y: 420, width: 200, height: 160 },
              operationKind: "transform", operationJson: JSON.stringify(plane), batchRunId: 1 },
            { nodeId: "result-correct", name: "Sign · Worldbend", revision: 4, kind: "rectify",
              width: 200, height: 160, placement: { x: 700, y: 640, width: 200, height: 160 },
              operationKind: "task", operationJson: "", batchRunId: 1 },
            { nodeId: "result-scene", name: "Scene · Worldbend", revision: 1, kind: "mockup",
              width: 200, height: 160, placement: { x: 700, y: 860, width: 200, height: 160 },
              operationKind: "task", operationJson: JSON.stringify(mockupTask), batchRunId: 1,
              sourceNodeIds: ["content", "badge"] },
            { nodeId: "result-composition", name: "Campaign · Worldbend", revision: 2, kind: "composition",
              width: 200, height: 200, placement: { x: 700, y: 1060, width: 200, height: 200 },
              operationKind: "task", operationJson: JSON.stringify(compositionTask), batchRunId: 1, sourceNodeIds: ["content", "badge"] },
          ] });
        }
        if (request?.type === "export-batch-source") {
          send({ type: "batch-source", generation: request.generation, batchRunId: request.batchRunId,
            requestId: request.requestId, resultNodeId: request.resultNodeId, nodeId: request.nodeId,
            bytes, renderWidth: 200, renderHeight: 160 });
        }
        if (request?.type === "apply-linked-batch-item") {
          const fail = request.payload.nodeId === "result-plane" && failNextBatchItem;
          if (fail) failNextBatchItem = false;
          if (request.payload.nodeId === "result-deform" && holdBatchItem) return; // held for the Stop check
          send(fail
            ? { type: "apply-error", generation: request.payload.generation, batchResultId: request.payload.nodeId,
              batchRunId: request.payload.batchRunId, message: { key: "resultChanged" } }
            : { type: "apply-complete", generation: request.payload.generation, batchResultId: request.payload.nodeId,
              batchRunId: request.payload.batchRunId, targetNodeId: request.payload.nodeId, operation: "replace" });
        }
      });
      const rowLabel = nodeId => [...get("#linked-results-list").querySelectorAll("button")]
        .find(button => button.textContent.includes(nodeId === "result-deform" ? "Poster" : nodeId === "result-plane" ? "Label" : nodeId === "result-scene" ? "Scene" : nodeId === "result-composition" ? "Campaign" : "Sign"));
      get("#linked-batch-action").click();
      await wait(() => window.fixtureMessages.filter(m => m.type === "apply-linked-batch-item").length === 4,
        "four supported items published");
      const posts = window.fixtureMessages.filter(m => m.type === "apply-linked-batch-item");
      check(posts[0].payload.storedOperation.task.kind === "deformation" &&
        posts[0].payload.storedOperation.task.spec.meshEdits.length === 1,
        "deformation item lost its shared work");
      check(posts[1].payload.storedOperation.kind === "transform", "plane item lost its stored transform");
      const scenePost = posts.find(post => post.payload.nodeId === "result-scene");
      check(scenePost && scenePost.payload.storedOperation.task.kind === "mockup" &&
        scenePost.payload.sourceNodeIds?.length === 2 && scenePost.payload.sourceNodeIds[0] === "content" &&
        scenePost.payload.sourceNodeIds[1] === "badge" && scenePost.payload.bytes.length > 0,
        "the multi-source Composition item lost its binding or recomputed bytes");
      check(window.fixtureMessages.some(m => m.type === "export-batch-source" && m.nodeId === "badge"),
        "the bound non-selected source was never exported");
      check(posts.every(post => post.payload.bytes.length > 0 && post.payload.renderWidth === 200),
        "batch items published without recomputed bytes");
      const compositionPost = posts.find(post => post.payload.nodeId === "result-composition");
      check(compositionPost && JSON.stringify(compositionPost.payload.storedOperation.task) === JSON.stringify(compositionTask),
        "Composition batch lost the whole-result warp or selected named output");
      const png = await createImageBitmap(new Blob([compositionPost.payload.bytes], { type: "image/png" }));
      check(png.width === 200 && png.height === 200, "Composition batch did not render its selected square output");
      png.close();
      await wait(() => get("#status").textContent.includes("3 of 5") && get("#status").textContent.includes("2 need"),
        `summary status missing: ${get("#status").textContent}`);
      check(rowLabel("result-deform").textContent.includes("Updated"), "updated row missing its outcome");
      check(rowLabel("result-correct").textContent.includes("Not updatable"), "unsupported row missing its report");
      check(rowLabel("result-plane").textContent.includes("Changed elsewhere"), "conflicted row missing its report");
      check(rowLabel("result-scene").textContent.includes("Updated"), "multi-source row missing its outcome");
      // The same saved work must produce the same pixels when reopened and
      // applied singly; a success toast and matching task JSON cannot prove it.
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["result-composition"] });
      send({ type: "source", generation, payload: { ...plain, sourceNodeId: "content",
        targetNodeId: "result-composition", task: compositionTask,
        placement: compositionPost.payload.placement,
        sources: [{ ...plain, sourceNodeId: "content" }, { ...plain, sourceNodeId: "badge" }] } });
      const compositionRoot = get("#mockup-workspace");
      await wait(() => !compositionRoot.hidden && !compositionRoot.querySelector('[data-role="apply"]').disabled,
        "batch result reopened for a single apply");
      const singleSeen = window.fixtureMessages.length;
      compositionRoot.querySelector('[data-role="apply"]').click();
      await wait(() => window.fixtureMessages.slice(singleSeen).some(m => m.type === "apply-designer"),
        "single Composition publication after batch");
      const single = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      async function decodedPixels(encoded) {
        const bitmap = await createImageBitmap(new Blob([encoded], { type: "image/png" }));
        const sample = document.createElement("canvas"); sample.width = bitmap.width; sample.height = bitmap.height;
        const context = sample.getContext("2d"); context.drawImage(bitmap, 0, 0); bitmap.close();
        return context.getImageData(0, 0, sample.width, sample.height).data;
      }
      const [batchPixels, singlePixels] = await Promise.all([decodedPixels(compositionPost.payload.bytes), decodedPixels(single.bytes)]);
      check(batchPixels.length === singlePixels.length && batchPixels.every((value, index) => value === singlePixels[index]),
        "Composition batch and single apply rendered different pixels");
      send({ type: "apply-designer-complete", generation, targetNodeId: "result-composition", operation: "replace" });
      // A stop never interrupts an in-flight publication; held and remaining items are skipped.
      generation += 1;
      send({ type: "selection-loading", generation, nodeIds: ["content"] });
      send({ type: "source", generation, payload: { ...plain, sourceNodeId: "content",
        linkedResults: { total: 2, items: [
          { nodeId: "result-deform", name: "Poster · Worldbend", revision: 3, kind: "deformation" },
          { nodeId: "result-plane", name: "Label · Worldbend", revision: 2, kind: "transform" },
        ] } } });
      await wait(() => !get("#linked-results-trigger").disabled, "results reloaded");
      get("#linked-results-trigger").click();
      await wait(() => !get("#linked-results-popover").hidden, "popover reopened");
      holdBatchItem = true;
      get("#linked-batch-action").click();
      await wait(() => window.fixtureMessages.some(m => m.type === "apply-linked-batch-item" &&
        m.payload.nodeId === "result-deform" && m.payload.generation === generation), "held item posted");
      const heldPayload = window.fixtureMessages.findLast(m => m.type === "apply-linked-batch-item").payload;
      // A concurrent plane Apply would race the batch's completion routing
      // for this generation; it is refused with its reason instead.
      const beforeConcurrentApply = window.fixtureMessages.length;
      get("#apply").click();
      await frames();
      check(!get("#error").hidden && get("#error-text").textContent.includes("Stop the update"),
        "plane Apply during the batch was not refused with its reason");
      check(window.fixtureMessages.length === beforeConcurrentApply,
        "refused plane Apply still posted a publication");
      get("#linked-batch-action").click(); // Stop
      send({ type: "apply-complete", generation, batchResultId: "result-deform",
        batchRunId: heldPayload.batchRunId, targetNodeId: "result-deform", operation: "replace" });
      await wait(() => get("#linked-batch-action").textContent.includes("Update all results"),
        "stopped batch did not return to its idle action");
      const lateCount = window.fixtureMessages.filter(m => m.type === "apply-linked-batch-item" && m.payload.generation === generation).length;
      check(lateCount === 1, `stop still published remaining items (${lateCount})`);
      check(rowLabel("result-plane").textContent.includes("Skipped"), "stopped run did not mark remaining items");
    } else if (scenario === "task-action-switch") {
      const clean = { ...payload, nativeTarget: undefined, nativeRenderer: undefined };
      await refresh(clean);
      get("#workspace-tab-mesh").click();
      await wait(() => !get('#mesh-workspace [data-role="apply"]').disabled, "Mesh on a plane result");
      check(get('#mesh-workspace [data-role="apply"]').textContent === "New Linked Image" &&
        get('#mesh-workspace [data-role="apply-new"]').hidden, "Mesh offered an incompatible plane update");
      const publish = async workspace => {
        const seen = window.fixtureMessages.length;
        get(`#${workspace}-workspace [data-role="apply"]`).click();
        await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), `${workspace} output`);
        return window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      };
      const mesh = await publish("mesh");
      check(mesh.duplicate === true && mesh.targetNodeId === "result", "Mesh overwrote the selected plane instead of making its named new result");
      send({ type: "apply-designer-complete", generation, targetNodeId: "mesh-result", operation: "duplicate" });
      await refresh({ ...clean, targetNodeId: "mesh-result", task: mesh.task });
      await wait(() => !get('#mesh-workspace [data-role="apply"]').disabled, "reopened Mesh task");
      check(get('#mesh-workspace [data-role="apply"]').textContent === "Update Linked Image" &&
        !get('#mesh-workspace [data-role="apply-new"]').hidden, "Reopened Mesh lacks update and copy choices");
      const meshFooter = get('#mesh-workspace .designer-footer').getBoundingClientRect();
      const meshNew = get('#mesh-workspace [data-role="apply-new"]');
      const meshUpdate = get('#mesh-workspace [data-role="apply"]');
      const meshNewBox = meshNew.getBoundingClientRect(), meshUpdateBox = meshUpdate.getBoundingClientRect();
      check([meshNewBox, meshUpdateBox].every(box => box.left >= meshFooter.left && box.right <= meshFooter.right) &&
        Math.abs(meshNewBox.top - meshUpdateBox.top) <= 1 &&
        meshNew.scrollWidth <= meshNew.clientWidth + 1 && meshUpdate.scrollWidth <= meshUpdate.clientWidth + 1,
      `Reopened Mesh actions are clipped: ${JSON.stringify({footer:meshFooter.toJSON(),new:meshNewBox.toJSON(),update:meshUpdateBox.toJSON(),newScroll:meshNew.scrollWidth,newClient:meshNew.clientWidth,updateScroll:meshUpdate.scrollWidth,updateClient:meshUpdate.clientWidth})}`);
      get("#workspace-tab-remap").click();
      await wait(() => !get('#remap-workspace [data-role="apply"]').disabled, "Lens on saved Mesh source");
      check(get('#remap-workspace [data-role="apply"]').textContent === "Apply as New Image" &&
        get('#remap-workspace [data-role="apply-new"]').hidden, "Lens offered an incompatible Mesh update");
      const lens = await publish("remap");
      check(lens.duplicate === true && lens.sourceNodeIds[0] === "content", "Lens did not preserve the bound editable source");
      send({ type: "apply-designer-complete", generation, targetNodeId: "lens-result", operation: "duplicate" });
      await refresh({ ...clean, targetNodeId: "lens-result", task: lens.task });
      await wait(() => !get('#remap-workspace [data-role="apply"]').disabled, "reopened Lens task");
      check(get('#remap-workspace [data-role="apply"]').textContent === "Update Linked Image", "Reopened Lens lacks an honest update action");
      const update = await publish("remap");
      check(update.duplicate === undefined && update.targetNodeId === "lens-result", "Lens update created an unintended copy");
    } else if (scenario === "deformation-published-view") {
      const clean = { ...payload, nativeTarget: undefined, nativeRenderer: undefined, targetNodeId: undefined };
      await refresh(clean);
      get("#workspace-tab-mesh").click();
      await wait(() => !get('#mesh-workspace [data-role="apply"]').disabled, "Mesh seed ready");
      const publish = async workspace => {
        const seen = window.fixtureMessages.length;
        get(`#${workspace}-workspace [data-role="apply"]`).click();
        await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), `${workspace} publication`);
        return window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      };
      const load = async next => {
        generation += 1;
        send({ type: "selection-loading", generation, nodeIds: ["shared-result"] });
        send({ type: "source", generation, payload: { ...clean, targetNodeId: "shared-result", task: next } });
        const workspace = next.view === "pin" ? "surface" : "mesh";
        try {
          await wait(() => !get(`#${workspace}-workspace`).hidden && !get(`#${workspace}-workspace [data-role="apply"]`).disabled,
            `reopened saved ${workspace} view`);
        } catch (error) {
          throw new Error(`${error.message}; hidden=${get(`#${workspace}-workspace`).hidden}; error=${get(`#${workspace}-workspace [data-role="error"]`).textContent}; errors=${window.fixtureErrors}`);
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      };
      const seed = await publish("mesh");
      send({ type: "apply-designer-complete", generation, targetNodeId: "shared-result", operation: "apply" });
      await load(seed.task);
      get("#workspace-tab-surface").click();
      await wait(() => document.querySelector('#surface-workspace .direct-point') &&
        !get('#surface-workspace [data-role="apply"]').disabled, "Pin view ready");
      const point = () => get('#surface-workspace .direct-point');
      point().focus(); key(point(), "ArrowRight");
      const pin = await publish("surface");
      check(pin.task.spec.surface.envelope.points[5].x !== 1 / 3, "Pin fixture was not edited");
      send({ type: "apply-designer-complete", generation, targetNodeId: "shared-result", operation: "replace" });
      await load(pin.task); // Host refreshes the own-write before native Undo.
      await load(seed.task); // Undo switches back to the saved Mesh view.
      await load(pin.task); // Redo switches to Pin while Mesh plans asynchronously.
      point().focus(); key(point(), "ArrowRight");
      get('#surface-workspace [data-role="reset"]').click();
      const afterReset = await publish("surface");
      check(JSON.stringify(afterReset.task) === JSON.stringify(pin.task),
        "Saved-view routing overwrote the restored Pin publication or its Reset baseline");
      send({ type: "apply-designer-complete", generation, targetNodeId: "shared-result", operation: "replace" });
      get("#workspace-tab-mesh").click();
      await wait(() => !get('#mesh-workspace [data-role="apply"]').disabled, "restored Mesh view ready");
      const mesh = await publish("mesh");
      check(JSON.stringify(mesh.task.spec.surface) === JSON.stringify(pin.task.spec.surface),
        "Explicit view switching lost the restored Pin surface");
      send({ type: "apply-designer-complete", generation, targetNodeId: "shared-result", operation: "replace" });
      await load(pin.task);
      await load(mesh.task); // Exercise the reverse saved-view switch as well.
      const meshRestored = await publish("mesh");
      check(JSON.stringify(meshRestored.task) === JSON.stringify(mesh.task), "Reverse saved-view routing altered the shared work");
    } else if (scenario === "spatial-agent-continuation") {
      const clean = { ...payload, nativeTarget: undefined, nativeRenderer: undefined, targetNodeId: undefined };
      const sources = [clean, { ...clean, sourceNodeId: "second", sourceName: "Near artwork" }];
      const root = get("#spatial-workspace");
      const role = name => get(`#spatial-workspace [data-role="${name}"]`);
      const load = async (task, nextSources = sources) => {
        generation += 1;
        send({ type: "selection-loading", generation, nodeIds: [task ? "result" : clean.sourceNodeId] });
        send({ type: "source", generation, payload: { ...nextSources[0], sources: nextSources, ...(task ? { task, targetNodeId: "result" } : {}) } });
        await wait(() => !get("#controls").dataset.loading, "Depth source decoded");
        get("#workspace-tab-spatial").click();
        await wait(() => !root.hidden && !role("apply").disabled, "Depth ready");
      };
      const publish = async () => {
        const seen = window.fixtureMessages.length;
        role("apply").click();
        await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), "Depth publication");
        const task = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload.task;
        send({ type: "apply-designer-complete", generation, targetNodeId: "result", operation: "replace" });
        await wait(() => !role("apply").disabled, "Depth publication complete");
        return task;
      };
      const edit = async (name, value, type = "change") => {
        role(name).value = value;
        role(name).dispatchEvent(new Event(type, { bubbles: true }));
        if (type === "input") role(name).dispatchEvent(new Event("change", { bubbles: true }));
        await wait(() => !role("apply").disabled, `Depth ${name} preview`);
      };
      const phoneSources = sources.map(item => ({ ...item, renderWidth: 375, renderHeight: 812,
        placement: { ...item.placement, width: 375, height: 812 } }));
      await load(undefined, phoneSources);
      const phone = await publish();
      check(phone.recipe.viewport.width === 375 && phone.recipe.viewport.height === 812 &&
        phone.recipe.layers.every(layer => layer.surface.size.width === 450 && layer.surface.size.height === 974.4),
        "A common phone viewport could not create Depth with exact fractional overscan");
      await load(phone, phoneSources);
      check(JSON.stringify(await publish()) === JSON.stringify(phone), "Phone Depth changed geometry after reopening");
      await load();
      const custom = structuredClone(await publish());
      custom.recipe.origin = null;
      custom.recipe.camera = { focalLength: 1320.5, focusDistance: 1234.5, travel: { x: 17.23, y: 8.91 } };
      custom.recipe.appearance = { depthOfField: { focusDistance: 1100.25, focusRange: 300.5, maxBlurRadius: 11.2 },
        motionBlur: { exposureFraction: .653, maxBlurRadius: 25.6 } };
      custom.recipe.layers.forEach((layer, index) => {
        layer.offset = { x: -23.5 - index, y: -14.25 - index };
        layer.surface.size = { width: 250.25 + index * 10, height: 210.75 + index * 10 };
      });
      custom.state = { progress: .73, pointerX: .1234, pointerY: -.2345, reducedMotion: false };
      await load(custom);
      await edit("focal-length", "1400.75");
      const expected = structuredClone(custom); expected.recipe.camera.focalLength = 1400.75;
      check(JSON.stringify(await publish()) === JSON.stringify(expected),
        "Editing only focal length altered the Agent's geometry, focus, travel, appearance or state");
      check(role("convergence").selectedOptions[0].textContent.includes("1234.5") &&
        role("optical-focus").selectedOptions[0].textContent.includes("1100.25"), "Custom focus distances were mislabeled as a nearby layer");
      await edit("preview-x", "40", "input"); expected.state.pointerX = .4;
      check(JSON.stringify(await publish()) === JSON.stringify(expected), "Editing horizontal viewpoint rounded the untouched vertical viewpoint");
      role("reduced-motion").checked = true;
      role("reduced-motion").dispatchEvent(new Event("change", { bubbles: true }));
      expected.state.reducedMotion = true;
      check(JSON.stringify(await publish()) === JSON.stringify(expected), "Reduced motion rebuilt the saved recipe");
      await edit("convergence", expected.recipe.layers[0].id);
      expected.recipe.camera.focusDistance = expected.recipe.layers[0].surface.distance;
      check(JSON.stringify(await publish()) === JSON.stringify(expected), "Choosing a focus layer changed unrelated recipe fields");
      const distance = root.querySelector('input[data-distance]');
      distance.value = String(expected.recipe.layers[0].surface.distance + 100.5);
      distance.dispatchEvent(new Event("change", { bubbles: true }));
      expected.recipe.layers[0].surface.distance += 100.5;
      expected.recipe.camera.focusDistance = expected.recipe.layers[0].surface.distance;
      check(JSON.stringify(await publish()) === JSON.stringify(expected), "Focused layer distance edit did not preserve the custom recipe");
      const oldWidth = expected.recipe.viewport.width;
      await edit("width", String(oldWidth + 1));
      const scale = (oldWidth + 1) / oldWidth;
      expected.recipe.origin = null;
      expected.recipe.viewport.width += 1;
      expected.recipe.camera.travel.x *= scale;
      expected.recipe.layers.forEach(layer => { layer.offset.x *= scale; layer.surface.size.width *= scale; });
      check(JSON.stringify(await publish()) === JSON.stringify(expected), "Viewport resize rounded fractional logical plane geometry");
      // Imported tasks can use the complete carrier bounds even though the
      // initial preset leaves room for overscan. Reopening is not authoring a
      // new preset and must not clamp a valid small or wide viewport.
      expected.recipe.viewport = { width: 3500, height: 8 };
      expected.recipe.layers.forEach(layer => { layer.surface.size = { width: 3500, height: 8 }; });
      await load(expected);
      check(JSON.stringify(await publish()) === JSON.stringify(expected), "A valid imported viewport was clamped or blocked");
      await edit("width", "1750");
      expected.recipe.viewport.width = 1750;
      expected.recipe.camera.travel.x *= .5;
      expected.recipe.layers.forEach(layer => { layer.offset.x *= .5; layer.surface.size.width = 1750; });
      check(JSON.stringify(await publish()) === JSON.stringify(expected), "Explicit viewport resize replaced custom layout instead of scaling it");
      await load(custom);
      role("width").value = "4096";
      role("width").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => role("apply").disabled && !role("error").hidden, "Oversized resized planes rejected");
      role("preview-x").value = "40";
      role("preview-x").dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 120));
      check(role("apply").disabled && !role("error").hidden, "Viewpoint rendering enabled an invalid resized layout");
      await edit("width", String(custom.recipe.viewport.width));
      check(!role("apply").disabled && role("error").hidden, "Resize rejection did not recover");
    } else if (scenario === "workspace-publication-undo") {
      const clean = { ...payload, nativeTarget: undefined, nativeRenderer: undefined, targetNodeId: undefined };
      const sourceItems = [clean, { ...clean, sourceNodeId: "second", sourceName: "Near artwork" }];
      for (const workspace of ["remap", "mesh", "surface", "spatial"]) {
        const root = get(`#${workspace}-workspace`);
        const role = name => get(`#${workspace}-workspace [data-role="${name}"]`);
        const load = async next => {
          generation += 1;
          send({ type: "selection-loading", generation, nodeIds: [next.targetNodeId ?? next.sourceNodeId] });
          send({ type: "source", generation, payload: next });
          await wait(() => !get("#controls").dataset.loading, `${workspace} source decoded`);
          get(`#workspace-tab-${workspace}`).click();
          await wait(() => !root.hidden && !role("apply").disabled, `${workspace} loaded`);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        };
        const publish = async duplicate => {
          const seen = window.fixtureMessages.length;
          role(duplicate ? "apply-new" : "apply").click();
          await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), `${workspace} published`);
          return window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
        };
        // Obtain a real canonical task from the built workspace and planner,
        // then begin the test as a reopened linked result.
        await load(workspace === "spatial" ? { ...clean, sources: sourceItems } : clean);
        const seed = await publish(false);
        send({ type: "apply-designer-complete", generation, targetNodeId: "seed", operation: "apply" });
        const original = { ...clean, targetNodeId: `${workspace}-result`, task: seed.task,
          ...(workspace === "spatial" ? { sources: sourceItems } : {}) };
        await load(original);
        const value = () => workspace === "remap" ? role("k1").value
          : workspace === "spatial" ? role("preview-x").value
          : `${root.querySelector('.direct-point').style.left},${root.querySelector('.direct-point').style.top}`;
        const edit = async () => {
          const before = value();
          if (workspace === "mesh" || workspace === "surface") {
            const point = root.querySelector('.direct-point');
            point.focus(); key(point, "ArrowRight");
          } else {
            const control = role(workspace === "remap" ? "k1" : "preview-x");
            control.value = String(Number(control.value) + (workspace === "remap" ? .2 : 20));
            control.dispatchEvent(new Event("input", { bubbles: true }));
            control.dispatchEvent(new Event("change", { bubbles: true }));
          }
          await wait(() => value() !== before && !role("apply").disabled, `${workspace} edited`);
        };
        const originalValue = value();
        if (workspace === "spatial") {
          const first = root.querySelector('.spatial-role-row select');
          first.value = "second"; first.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await edit();
        const editedValue = value();
        const accepted = await publish(false);
        send({ type: "apply-designer-complete", generation: generation - 1,
          targetNodeId: original.targetNodeId, operation: "replace" });
        check(role("apply").disabled, `${workspace} accepted an uncorrelated completion`);
        send({ type: "apply-designer-complete", generation,
          targetNodeId: original.targetNodeId, operation: "replace" });
        await edit();
        role("reset").click();
        await wait(() => value() === editedValue && !role("apply").disabled,
          `${workspace} Reset to accepted publication without a source refresh`);
        const repeated = await publish(false);
        check(JSON.stringify(repeated.task) === JSON.stringify(accepted.task), `${workspace} accumulated deformation on repeated Apply`);
        check(JSON.stringify(repeated.sourceNodeIds) === JSON.stringify(accepted.sourceNodeIds), `${workspace} lost published role order`);
        send({ type: "apply-designer-complete", generation, targetNodeId: original.targetNodeId, operation: "replace" });
        await load(original); // Native Undo arrives before any own-write refresh.
        check(value() === originalValue, `${workspace} native Undo retained the stale applied draft`);
        const published = { ...original, task: accepted.task,
          ...(workspace === "spatial" ? { sources: accepted.sourceNodeIds.map(id => sourceItems.find(s => s.sourceNodeId === id)) } : {}) };
        await load(published); // Native Redo loads the saved publication.
        check(value() === editedValue, `${workspace} native Redo did not restore the saved operation`);
        const resumed = await publish(false);
        check(JSON.stringify(resumed.task) === JSON.stringify(accepted.task), `${workspace} reopened publication changed its task`);
        send({ type: "apply-designer-complete", generation, targetNodeId: original.targetNodeId, operation: "replace" });
        await edit();
        const retainedValue = value();
        await load(published);
        check(value() === retainedValue, `${workspace} source-only refresh discarded a later draft`);
        role("reset").click();
        await wait(() => value() === editedValue && !role("apply").disabled, `${workspace} Reset after source refresh`);
        await edit();
        await publish(true);
        send({ type: "apply-designer-complete", generation, targetNodeId: "duplicate", operation: "duplicate" });
        role("reset").click();
        await wait(() => value() === editedValue && !role("apply").disabled, `${workspace} duplicate preserved the current target baseline`);
        await edit();
        await publish(false);
        send({ type: "apply-designer-error", generation, message: "Publication rejected" });
        role("reset").click();
        await wait(() => value() === editedValue && !role("apply").disabled, `${workspace} failed Apply preserved the current target baseline`);
      }
    } else if (scenario === "composition-publication-undo") {
      const spec = { schema: "worldbend.mockup", version: "0.1", canvas: { width: 200, height: 160 },
        background: { kind: "transparent" }, seams: [], planes: [{ id: "artwork", sourceId: "source-1", opacity: 1,
          transform: { schema: "worldbend.transform", version: "0.1", destination: { space: "normalized", quad: {
            tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } } }, content: { fit: "stretch" } } }] };
      const original = { ...payload, nativeTarget: undefined, nativeRenderer: undefined, targetNodeId: "composition-result",
        task: { kind: "mockup", spec }, sources: [{ ...payload, sourceNodeId: "source" }] };
      const root = get("#mockup-workspace");
      const role = name => get(`#mockup-workspace [data-role="${name}"]`);
      const load = async source => {
        generation += 1;
        send({ type: "selection-loading", generation, nodeIds: ["composition-result"] });
        send({ type: "source", generation, payload: source });
        await wait(() => !root.hidden && !role("apply").disabled, "Composition refresh");
      };
      await load(original);
      role("opacity").value = "80";
      role("opacity").dispatchEvent(new Event("input", { bubbles: true }));
      await load(original);
      check(role("opacity").value === "80", "Source-only refresh discarded the Composition draft");
      const seen = window.fixtureMessages.length;
      role("apply").click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-designer"), "Composition replacement");
      const applied = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload;
      check(applied.task.spec.planes[0].opacity === .8, "Publication lost opacity");
      send({ type: "apply-designer-complete", generation, targetNodeId: "composition-result", operation: "replace" });
      // The host may deliver Undo without first refreshing the UI after its
      // own publication. The completion must advance the saved baseline.
      await load(original);
      check(role("opacity").value === "100", "Native Undo left stale Composition controls");
      const published = { ...original, task: applied.task };
      await load(published);
      check(role("opacity").value === "80", "Native Redo left stale Composition controls");
      role("opacity").value = "60";
      role("opacity").dispatchEvent(new Event("input", { bubbles: true }));
      role("reset").click();
      await wait(() => role("opacity").value === "80", "Reset to the current Composition publication");
      const contexts = () => window.fixtureMessages.filter(m => m.type === "request-scene-context");
      const contextCount = contexts().length;
      await load({ ...original, sceneContext: true, sceneContextReadOnly: true });
      await wait(() => contexts().length > contextCount, "read-only history preview");
      check(role("scene-sizes").textContent === "Continue to Sizes with complete scene",
        "Complete-scene handoff is not described as continuing the current work into Sizes");
      check(contexts().at(-1).readPublished === true && contexts().at(-1).showCanvas === false,
        "Restored saved task requested a temporary scene write");
      role("opacity").value = "60";
      role("opacity").dispatchEvent(new Event("input", { bubbles: true }));
      await wait(() => contexts().at(-1).showCanvas === true, "fresh scene draft after history");
      check(contexts().at(-1).readPublished === undefined, "A new draft reused obsolete published pixels");
    } else if (scenario === "canvas-names") {
      const source = { ...payload, nativeTarget: undefined, nativeRenderer: undefined,
        targetNodeId: undefined, sourceNodeId: "plain-artwork", canvas: undefined, canvasOutputId: undefined };
      const load = async () => {
        generation += 1;
        send({ type: "selection-loading", generation, nodeIds: ["plain-artwork"] });
        send({ type: "source", generation, payload: source });
      };
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type === "request-source-raster") send({ type: "source-raster",
          generation: request.generation, requestId: request.requestId, bytes });
      });
      await load();
      await wait(() => !get("#workspace-tab-canvas").disabled, "Sizes entry on artwork");
      get("#workspace-tab-canvas").click();
      await wait(() => !get("#canvas-apply").disabled, "Sizes ready");
      get("#canvas-add-variant").click();
      await wait(() => !get("#canvas-apply").disabled, "Second size ready");
      const name = get("#canvas-variant-id");
      const typeName = value => { name.value = value; name.dispatchEvent(new Event("input", { bubbles: true })); };
      typeName("x".repeat(129));
      name.dispatchEvent(new Event("change", { bubbles: true }));
      check(name.value === "x".repeat(129) && name.getAttribute("aria-invalid") === "true",
        "Invalid size name was silently discarded");
      check(get("#canvas-apply").disabled && get("#canvas-save-template").disabled &&
        get("#canvas-error").textContent.includes("1–128"), "Size name error lacked format and publication guard");
      get('#canvas-operation-choices [data-operation="cover"]').click();
      await load();
      await wait(() => !get("#canvas-workspace").hidden, "Source refresh with invalid name");
      await wait(() => !get("#canvas-status").textContent.includes("Updating"), "Refreshed source plan with invalid name");
      check(name.value === "x".repeat(129) && get("#canvas-apply").disabled,
        "Another control or current source refresh lost the pending invalid name");
      typeName("output-1");
      name.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !get("#canvas-apply").disabled, "Duplicate human label with distinct renderer identities");
      typeName("书封 · 横版 / 2026 🎨");
      name.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !get("#canvas-apply").disabled, "Corrected size name recovery");
      check(name.value === "书封 · 横版 / 2026 🎨" && name.getAttribute("aria-invalid") === "false" && get("#canvas-error").hidden,
        "Corrected name left a stale failure");
      const seen = window.fixtureMessages.length;
      get("#canvas-apply").click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-canvas"), "Named sizes publication");
      const applied = window.fixtureMessages.findLast(m => m.type === "apply-canvas").payload;
      check(applied.outputs.map(output => output.id).join() === "output-1,output-2" &&
        applied.outputs[1].name === "书封 · 横版 / 2026 🎨" && !JSON.stringify(applied.setSpec).includes("书封"),
        "Human label changed renderer identities or was lost at publication");
    } else if (scenario === "canvas-continuation") {
      const original = { schema: "worldbend.canvas", version: "0.1", operation: { kind: "cover",
        output: { width: 180, height: 180 }, anchor: { x: .5, y: .5 }, background: { kind: "transparent" } } };
      const source = { ...payload, nativeTarget: undefined, nativeRenderer: undefined, canvas: original,
        canvasOutputId: "square" };
      const load = async next => {
        generation += 1;
        send({ type: "selection-loading", generation, nodeIds: ["result"] });
        send({ type: "source", generation, payload: next });
        await wait(() => !get("#canvas-workspace").hidden && !get("#canvas-apply").disabled, "Sizes source refresh");
      };
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type === "request-source-raster") send({ type: "source-raster",
          generation: request.generation, requestId: request.requestId, bytes });
      });
      await load(source);
      const anchor = (x, y) => get(`#canvas-anchor-grid [data-anchor="${x},${y}"]`);
      check(get("#canvas-variant-id").value === "square", "Saved size name missing");
      anchor(0, .5).click();
      get("#canvas-variant-id").value = "square-left";
      get("#canvas-variant-id").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !get("#canvas-apply").disabled, "local Sizes edit");
      await load(source);
      check(anchor(0, .5).getAttribute("aria-pressed") === "true" && get("#canvas-variant-id").value === "square-left",
        "Source-only refresh discarded local Sizes edits");
      const seen = window.fixtureMessages.length;
      get("#canvas-apply").click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply-canvas"), "Canvas replacement publication");
      const applied = window.fixtureMessages.findLast(m => m.type === "apply-canvas").payload;
      check(applied.targetNodeId === "result" && applied.outputs.length === 1 && applied.outputs[0].id === "square" && applied.outputs[0].name === "square-left",
        "Replacement lost its named output");
      send({ type: "apply-canvas-complete", generation, targetNodeIds: ["result"], operation: "replace" });
      const published = { ...source, canvas: { ...original, operation: applied.setSpec.variants[0].operation },
        canvasOutputId: "square", canvasOutputName: "square-left" };
      await load(published);
      get("#canvas-apply").focus();
      const seenUndo = window.fixtureMessages.length;
      key(document.activeElement, "z", { metaKey: true });
      await wait(() => window.fixtureMessages.slice(seenUndo).some(m => m.type === "trigger-undo"), "Canvas host Undo");
      await load(source);
      check(anchor(.5, .5).getAttribute("aria-pressed") === "true" && get("#canvas-variant-id").value === "square",
        "Native Undo left stale Sizes controls");
      await load(published); // Native Redo or external publication.
      check(anchor(0, .5).getAttribute("aria-pressed") === "true" && get("#canvas-variant-id").value === "square-left",
        "Native Redo left stale Sizes controls");
      anchor(1, .5).click();
      await wait(() => !get("#canvas-apply").disabled, "continued local edit");
      get("#canvas-reset").click();
      await wait(() => anchor(0, .5).getAttribute("aria-pressed") === "true", "Reset to current publication");
    } else if (scenario?.startsWith("designer-")) {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (const workspace of (scenario === "designer-publication" ? ["mesh", "surface", "mockup", "remap"] : ["mesh", "surface"])) {
        const panel = `#${workspace}-workspace`;
        get(`#workspace-tab-${workspace}`).click();
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
          get(`#workspace-tab-${workspace}`).click();
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
          const publishedTask = window.fixtureMessages.findLast(m => m.type === "apply-designer").payload.task;
          const published = publishedTask.spec;
          check(publishedTask.kind === "deformation" &&
            publishedTask.view === (workspace === "surface" ? "pin" : "mesh") &&
            published.targetSize.width === 200 && published.targetSize.height === 160,
            `${workspace} template lost its current source dimensions`);
          if (workspace === "mesh") {
            check(published.meshSubdivisions === 2 && published.meshEdits[0].warped.x === .37 &&
              published.meshEdits[0].warped.y === .62, "Mesh template lost its authored grid");
          } else {
            check(published.surface.envelope.points[5].x === .38 && published.surface.envelope.points[5].y === .42 &&
              published.surface.anchors[0].id === "pin-6-6" && published.surface.strokes[0].samples.length === 1,
            "Pin Warp template lost its envelope, pin, or brush stroke");
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
          get(`#workspace-tab-${workspace}`).click();
          await frames();
          check(!get(panel).hidden, `${workspace} navigation was blocked by a pending preview`);
          check(point().style.left === moved, `${workspace} round trip discarded draft (${moved} -> ${point().style.left})`);
          key(get(`${panel} [data-role="reset"]`), "z", { metaKey: true });
          await wait(() => point().style.left === original, `${workspace} round trip retained Undo`);
          key(get(`${panel} [data-role="reset"]`), "z", { metaKey: true, shiftKey: true });
          await wait(() => point().style.left === moved, `${workspace} round trip retained Redo`);
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
          get(`#workspace-tab-${workspace}`).click();
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
    } else if (scenario === "visual-footer") {
      const visual = { ...payload, sourceNodeId: "visual-original", sourceName: "Campaign card" };
      delete visual.targetNodeId;
      delete visual.nativeTarget;
      delete visual.nativeRenderer;
      await refresh(visual);
      await moveCorner();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const footer = get("#action-dock");
      const guidance = get("#native-guidance");
      const listing = get("#open-effect-listing");
      const reset = get("#reset");
      const editable = get("#action-apply-editable");
      const applyButton = get("#apply");
      const help = get("#native-help"), disclosure = get(`#${help.getAttribute("aria-describedby")}`);
      check(!help.hidden && disclosure.hidden && !guidance.hidden && !listing.hidden,
        "Visual footer did not expose editable-output guidance");
      help.focus();
      check(!disclosure.hidden, "Editable setup help was not keyboard reachable");
      help.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      check(document.activeElement === listing, "Help did not give keyboard access to effect acquisition");
      const listingMessages = window.fixtureMessages.length;
      listing.click();
      await wait(() => window.fixtureMessages.slice(listingMessages)
        .some(message => message.type === "open-native-effect-listing"),
      "Visual footer did not request the fixed effect listing");
      check(!applyButton.disabled, "Visual footer blocked the HD image route");
      if (innerWidth === 300) {
        await wait(() => {
          const artwork = get(".worldbend-editor").getBoundingClientRect();
          const source = get("#source-name").getBoundingClientRect();
          const size = get("#output-size").getBoundingClientRect();
          return source.bottom <= artwork.top + 1 && size.top >= artwork.bottom - 1;
        }, "compact labels settle outside the artwork");
        const footerBox = footer.getBoundingClientRect();
        const listingBox = help.getBoundingClientRect();
        const resetBox = reset.getBoundingClientRect();
        const editableBox = editable.getBoundingClientRect();
        const applyBox = applyButton.getBoundingClientRect();
        const artworkBox = get(".worldbend-editor").getBoundingClientRect();
        const sourceBox = get("#source-name").getBoundingClientRect();
        const sizeBox = get("#output-size").getBoundingClientRect();
        const sizeFlow = get("#output-size-flow");
        check(footer.scrollWidth <= footer.clientWidth + 1, "Compact footer scrolls horizontally");
        check(Math.abs(listingBox.top - resetBox.top) <= 2,
          "Compact recovery link is detached from Reset");
        const vector = get("#action-apply-vector");
        const vectorBox = vector.getBoundingClientRect();
        const nativeWidth = vector.hidden ? editableBox.width :
          Math.max(editableBox.right, vectorBox.right) - Math.min(editableBox.left, vectorBox.left);
        check(nativeWidth >= footerBox.width - 25 && applyBox.width >= footerBox.width - 25,
          `Compact output actions do not use the available width: ${JSON.stringify({nativeWidth,footerWidth:footerBox.width,editable:editableBox.toJSON(),vector:vector.getBoundingClientRect().toJSON(),vectorHidden:vector.hidden,apply:applyBox.toJSON()})}`);
        check(footerBox.height < 140, "Compact output footer still spends a row on instructions");
        check(get("#editor").getBoundingClientRect().height >= 140,
          "Compact footer crowds out the transform preview");
        check(sourceBox.bottom <= artworkBox.top + 1,
          "Compact source label overlaps the artwork");
        check(sizeBox.top >= artworkBox.bottom - 1,
          "Compact output size overlaps the artwork");
        check(sizeFlow.scrollWidth <= sizeFlow.clientWidth + 1,
          "Compact output size is visibly truncated");
      }
    } else if (scenario === "selection-entry") {
      const state = get("#selection-state");
      const visible = node => node.getBoundingClientRect().height > 0;
      const navigation = get("#workspace-navigation").getBoundingClientRect();
      const compactShell = innerWidth <= 680;
      check(get("#workspace-items").getAttribute("aria-orientation") === (compactShell ? "horizontal" : "vertical"),
        "Workspace navigation orientation does not match its rendered shell");
      if (compactShell) {
        check(navigation.height === 50 && navigation.width === innerWidth && !visible(get("#workpiece-context")),
          "Narrow workspace navigation did not return to the compact top strip");
      } else {
        check(navigation.width === 156 && navigation.height === innerHeight && visible(get("#workpiece-context")),
          "Default workspace navigation is not the persistent workpiece rail");
        check([...document.querySelectorAll(".workspace-group-label")].map(node => node.textContent).join("|") === "Shape|Compose|Finish|Library",
          "Workspace intent families are missing or out of order");
      }
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
      check(get("#workpiece-name").textContent === "选择作品" &&
        [...document.querySelectorAll(".workspace-group-label")].map(node => node.textContent).join("|") === "变形|编排|完成|资源",
        "Workpiece rail did not localize with the rest of the shell");
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
      check(get("#workpiece-name").textContent === payload.sourceName,
        "The persistent shell does not identify the selected workpiece");
      generation++;
      send({ type: "selection-loading", generation, nodeIds: ["saved-result"] });
      send({ type: "source", generation, payload: { ...payload, targetNodeId: "saved-result",
        workpieceName: "Saved two-slot scene",
        sources: [payload, { ...payload, sourceNodeId: "second", sourceName: "Second slot" }] } });
      await wait(() => get("#workpiece-name").textContent === "Saved two-slot scene",
        "saved multi-source workpiece identity");
      check(get("#workpiece-name").title === "Saved two-slot scene",
        "A reopened multi-source result loses its saved workpiece tooltip");
    } else if (scenario === "unchanged-raster-fidelity") {
      let lastCapture, mismatch = false, reads = 0;
      const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type !== "request-source-raster") return;
        reads++;
        const fresh = document.createElement("canvas");
        fresh.width = request.desiredWidth + (mismatch ? 1 : 0); fresh.height = request.desiredHeight;
        const ctx = fresh.getContext("2d"), gradient = ctx.createLinearGradient(0, 0, fresh.width, 0);
        gradient.addColorStop(0, "rgba(10,40,190,.35)"); gradient.addColorStop(1, "rgba(250,60,80,1)");
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, fresh.width, fresh.height);
        ctx.clearRect(0, 0, 32, 32); ctx.fillStyle = "white"; ctx.font = "16px sans-serif";
        ctx.fillText("FIELD NOTES", 20, 85); ctx.font = "9px sans-serif";
        for (let y = 105; y < 160; y += 12) ctx.fillText("Dense text keeps its alpha and source layout. 0123456789", 20, y);
        lastCapture = Uint8Array.from(atob(fresh.toDataURL().split(",")[1]), ch => ch.charCodeAt(0));
        send({ type: "source-raster", generation: request.generation, requestId: request.requestId, bytes: lastCapture });
      });
      const source = { ...payload, targetNodeId: undefined, nativeTarget: undefined, nativeRenderer: undefined };
      const publish = async () => {
        const start = window.fixtureMessages.length;
        get("#apply").click();
        await wait(() => window.fixtureMessages.slice(start).some(m => m.type === "apply"), "mixed artwork image publication");
        const result = window.fixtureMessages.slice(start).find(m => m.type === "apply").payload;
        const png = await createImageBitmap(new Blob([result.bytes], { type: "image/png" }));
        check(png.width === result.renderWidth && png.height === result.renderHeight, "PNG and publication dimensions differ");
        png.close();
        send({ type: "apply-complete", generation, operation: "apply", targetNodeId: "raster-fidelity-result" }); await ready();
        return result;
      };
      await refresh({ ...source, sourceNodeId: "unchanged-source" });
      const original = await publish();
      check(original.renderWidth === 400 && original.renderHeight === 320 && equal(original.bytes, lastCapture),
        "Unchanged HD output resampled the native source PNG");
      const warm = await publish();
      check(reads === 1 && equal(warm.bytes, original.bytes), "Warm output changed source bytes or repeated the capture");
      for (const [id, content] of [
        ["flipped-source", { fit: "stretch", orientation: "flipHorizontal" }],
        ["warped-source", { fit: "stretch", warp: { preset: "arc", amount: .25 } }],
      ]) {
        await refresh({ ...source, sourceNodeId: id, spec: { ...spec, content } });
        const changed = await publish();
        check(!equal(changed.bytes, lastCapture), `${id} bypassed its changed mapping`);
      }
      mismatch = true;
      await refresh({ ...source, sourceNodeId: "overflow-source" });
      const startReads = reads, overflow = await publish();
      check(reads === startReads + 2 && !equal(overflow.bytes, lastCapture) && overflow.renderWidth === 400,
        "Mismatched native dimensions were published as an unchanged PNG");
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
      const unsupportedHelp = get("#action-apply-editable").title;
      check(get("#action-apply-editable").disabled && !unsupportedHelp.includes("Preparing") &&
        unsupportedHelp.includes("HD image for Correct") && unsupportedHelp.includes("Native Vector"),
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
      await wait(() => get("#output-size-flow").textContent === "Editable Frame · 300 × 240" &&
        get("#action-apply-copy").title.includes("600 × 480 px"), "larger native and HD output preview"); await ready();
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
    } else if (scenario === "preview-drag-chrome") {
      get("#mode-distort").click(); await ready();
      const chrome = ["#source-name", "#output-size", "#distort-options"];
      const assertChrome = (visible) => {
        for (const selector of chrome) {
          const element = get(selector), css = getComputedStyle(element);
          check(!element.hidden && css.visibility === (visible ? "visible" : "hidden"), `${selector} did not ${visible ? "restore" : "hide"}`);
          if (!visible) check(css.pointerEvents === "none", `${selector} can intercept the drag`);
        }
      };
      const center = (element) => { const b = element.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
      const input = async (method, params, screenshot) => {
        window.__WORLDBEND_INPUT_DONE__ = false;
        window.__WORLDBEND_INPUT__ = { method, params, screenshot };
        await wait(() => window.__WORLDBEND_INPUT_DONE__, "trusted pointer input");
      };
      const mouse = (type, point, screenshot) => input("Input.dispatchMouseEvent", { type, ...point,
        button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 }, screenshot);
      const space = (type, screenshot) => input("Input.dispatchKeyEvent", { type, key: " ", code: "Space", windowsVirtualKeyCode: 32 }, screenshot);
      const dragged = () => document.querySelector('.worldbend-editor[data-dragging="true"]');
      let pointerId, pressLayout, hiddenLayout, lastMove;
      const captureLog = [];
      for (const type of ["pointerdown", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture"]) {
        get("#editor").addEventListener(type, event => { captureLog.push({type, target:event.target.className || event.target.id, pointerId:event.pointerId, captured:get("#editor").hasPointerCapture(event.pointerId), panning:get("#editor").dataset.panning}); }, true);
      }
      get("#editor").addEventListener("pointermove", event => { lastMove = { buttons: event.buttons, pointerId: event.pointerId }; }, true);
      get("#editor").addEventListener("pointerdown", event => {
        pointerId = event.pointerId;
        pressLayout = get(".worldbend-editor__canvas").getBoundingClientRect().toJSON();
      }, true);
      get("#editor").addEventListener("pointerdown", () => {
        hiddenLayout = get(".worldbend-editor__canvas").getBoundingClientRect().toJSON();
      });
      assertChrome(true);
      // Keyboard nudges and merely holding Space leave the chrome readable.
      const tr = () => get('[data-corner="tr"]');
      const beforeNudge = tr().getAttribute("aria-label");
      tr().focus(); key(tr(), "ArrowLeft");
      await wait(() => tr().getAttribute("aria-label") !== beforeNudge, "keyboard nudge"); await ready(); assertChrome(true);
      await wait(() => get(".worldbend-editor").getAnimations({ subtree: true }).every(a => a.playState !== "running"), "settled nudge");
      const buttonState = get("#distort-perspective").getAttribute("aria-pressed");
      const start = center(tr()), destination = center(get("#distort-perspective"));
      await mouse("mousePressed", start); check(dragged(), "Trusted corner drag did not begin"); assertChrome(false);
      check(getComputedStyle(tr()).visibility === "visible", "Active corner disappeared with the chrome");
      check(JSON.stringify(hiddenLayout) === JSON.stringify(pressLayout), "Hiding chrome moved the artwork during pointer-down");
      await mouse("mouseMoved", destination, "preview-drag-hidden"); assertChrome(false);
      const hit = document.elementFromPoint(destination.x, destination.y);
      check(!hit?.closest("#distort-options"), "Hidden corner mode still intercepts the pointer");
      await mouse("mouseReleased", destination, "preview-drag-restored"); assertChrome(true);
      check(!dragged() && get("#distort-perspective").getAttribute("aria-pressed") === buttonState, "Release over a hidden mode activated it");
      // The actual gesture must close on cancellation, capture loss, focus loss
      // and source replacement too, even if the iframe misses pointer-up.
      for (const close of ["pointercancel", "lostpointercapture", "blur", "refresh"]) {
        await refresh({ ...payload, sourceName: `Interruption ${close}`, targetNodeId: `drag-${close}` });
        await wait(() => get("#source-name").textContent === `Interruption ${close}`, "fresh interruption source");
        get("#mode-distort").click(); await ready();
        await wait(() => get(".worldbend-editor").getAnimations({ subtree: true }).every(a => a.playState !== "running"), "settled corner position");
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const p = center(corner()), hit = document.elementFromPoint(p.x, p.y);
        check(hit?.closest('[data-corner="tl"]'), `${close} corner is covered by ${hit?.outerHTML}`);
        await mouse("mousePressed", p);
        check(dragged(), `${close} test missed its corner at ${JSON.stringify(p)}`); assertChrome(false);
        if (close === "blur") dispatchEvent(new Event("blur"));
        else if (close === "refresh") await refresh({ ...payload, sourceName: "Refreshed source" });
        else corner().dispatchEvent(new PointerEvent(close, { pointerId, bubbles: true }));
        assertChrome(true); check(!dragged(), `${close} left an active drag`);
        await mouse("mouseReleased", p); assertChrome(true);
      }
      get("#mode-transform").click(); await ready();
      const surface = get("#editor"), p = center(surface);
      await mouse("mousePressed", p); check(dragged(), "Transform surface drag did not begin");
      check(getComputedStyle(get("#source-name")).visibility === "hidden", "Transform drag left chrome visible");
      await mouse("mouseReleased", p);
      await wait(() => !get("#mode-distort").disabled, "completed Transform release");
      get("#mode-distort").click();
      await wait(() => get("#mode-distort").getAttribute("aria-pressed") === "true" && !tr().disabled, "Distort ready for pan");
      await ready(); tr().focus();
      await wait(() => get(".worldbend-editor").getAnimations({ subtree: true }).every(a => a.playState !== "running"), "settled pan controls");
      const cornerLabels = () => ["tl", "tr", "br", "bl"].map(id => get(`[data-corner="${id}"]`).getAttribute("aria-label"));
      const beforePan = JSON.stringify(cornerLabels());
      await space("rawKeyDown"); assertChrome(true);
      check(surface.dataset.pan === "true", `Space did not arm pan; focus=${document.activeElement?.outerHTML}`);
      const panPoint = center(surface), panHit = document.elementFromPoint(panPoint.x, panPoint.y);
      await mouse("mousePressed", panPoint);
      check(surface.dataset.panning === "true", `Space drag did not begin a pan: ${panHit?.outerHTML}; ${JSON.stringify(captureLog.slice(-4))}`); assertChrome(false);
      await mouse("mouseMoved", { x: panPoint.x + 20, y: panPoint.y + 15 });
      check(surface.dataset.panning === "true", `Pan closed after move: ${JSON.stringify({lastMove, pan:surface.dataset.pan, captureLog:captureLog.slice(-8)})}`); assertChrome(false);
      await mouse("mouseReleased", panPoint); assertChrome(true);
      check(!surface.dataset.panning, "Released pan did not clear its state");
      await space("keyUp");
      tr().focus(); await space("rawKeyDown");
      check(surface.dataset.pan === "true", `Second Space did not arm pan; focus=${document.activeElement?.outerHTML}`);
      const secondPan = center(surface), secondHit = document.elementFromPoint(secondPan.x, secondPan.y);
      await mouse("mousePressed", secondPan);
      check(surface.dataset.panning === "true", `Second pan missed its canvas: ${secondHit?.outerHTML}`); assertChrome(false);
      dispatchEvent(new Event("blur")); assertChrome(true);
      check(!surface.dataset.panning, "Interrupted pan did not clear its state");
      await mouse("mouseReleased", center(surface)); await space("keyUp");
      check(JSON.stringify(cornerLabels()) === beforePan, "Space-pan changed the plane geometry");
      key(document.body, "0", { metaKey: true });
      await wait(() => get(".worldbend-editor").getAnimations({ subtree: true }).every(a => a.playState !== "running"), "fitted restored preview");
      await space("keyUp", "preview-drag-restored");
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
    } else if (scenario === "native-output-position") {
      for(const basis of [[[0,-1,500],[1,0,200]],[[-1.2585249,.2368865,500],[-.281683,.5297686,200]]]) {
        await refresh({...payload,nativeComponentTarget:true,nativeSourceSize:{width:250,height:200},nativeOutputBasis:basis});
        get("#mode-transform").click();await ready();
        await wait(()=>!get("#position-x").disabled&&!get("#position-y").disabled,"native placement controls initialized");
        for(const [axis,value] of [["x",513],["y",193]]) {
          const input=get("#position-"+axis);input.value=String(value);input.dispatchEvent(new Event("change",{bubbles:true}));await ready();
          await wait(()=>Math.abs(Number(input.value)-value)<1e-6,"native page position field "+axis+" actual "+input.value);
        }
        const published=await apply();
        const x=published.placement.x-500,y=published.placement.y-200;
        const page={x:500+basis[0][0]*x+basis[0][1]*y,y:200+basis[1][0]*x+basis[1][1]*y};
        check(Math.abs(page.x-513)<1e-6&&Math.abs(page.y-193)<1e-6,"native position changed the wrong page axes "+JSON.stringify({page,placement:published.placement,basis}));
        check(published.placement.width===200&&published.placement.height===160,"native page position expanded the intrinsic output");
        send({type:"apply-complete",generation,operation:"replace",targetNodeId:"result"});
      }
    } else if (scenario === "native-source-view") {
      const native={...payload,nativeComponentTarget:true,nativeSourceSize:{width:250,height:200},nativeRevision:1,nativeRenderer:undefined};
      await refresh(native);
      check(!get("#edit-native-source").hidden,"native source editing is undiscoverable");
      get("#edit-native-source").click();
      await wait(()=>window.fixtureMessages.some(m=>m.type==="edit-native-source"),"source editing request");
      const editing=window.fixtureMessages.findLast(m=>m.type==="edit-native-source");
      check(window.fixtureMessageGuard(editing)&&editing.targetNodeId==="result"&&JSON.stringify(editing.spec)===JSON.stringify(spec),"source entry lost the accepted transform or target");
      await refresh({...native,sourceNodeId:"master-content",nativeSourceEditing:true,nativeSourceSize:{width:350,height:220},nativeRevision:2});
      check(!get("#native-source-editing").hidden&&get("#apply").textContent==="Return to result","source editing has no return path");
      check(get("#action-apply-editable").hidden&&get("#action-apply-copy").hidden,"source editing offers a stale publication route");
      get("#apply").click();
      await wait(()=>window.fixtureMessages.some(m=>m.type==="apply-native"),"return to result");
      const returned=window.fixtureMessages.findLast(m=>m.type==="apply-native");
      check(window.fixtureMessageGuard(returned),"return publication violates the native wire contract");
      check(returned.payload.sourceNodeId==="master-content"&&returned.payload.nativePlan.sourceSize.width===350&&returned.payload.nativePlan.sourceSize.height===220,"return ignored resized instance source dimensions");
      check(returned.payload.placement.width===200&&returned.payload.placement.height===160,"source edit changed the target dimensions");
      send({type:"apply-complete",generation,operation:"replace",targetNodeId:"result",nativeRevision:3});
      await refresh({...native,nativeRevision:3});
      check(get("#native-source-editing").hidden&&get("#apply").textContent==="Update Frame","return lost the native work context");
      const beforeUndo=window.fixtureMessages.filter(m=>m.type==="trigger-undo").length;
      get("#apply").focus();key(document.activeElement,"z",{metaKey:true});
      await wait(()=>window.fixtureMessages.filter(m=>m.type==="trigger-undo").length>beforeUndo,"native Undo after source view");
    } else if (scenario === "native-publication-undo") {
      get("#mode-transform").click(); await ready();
      get("#scale-x").value = "110";
      get("#scale-x").dispatchEvent(new Event("input", { bubbles: true }));
      get("#scale-x").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => get("#output-size-flow").textContent === "Editable Frame · 220 × 176", "scaled native bounds"); await ready();
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
      get("#apply").focus();
      const documentRedo=new KeyboardEvent("keydown",{key:"z",metaKey:true,shiftKey:true,bubbles:true,cancelable:true});
      get("#apply").dispatchEvent(documentRedo);
      check(!documentRedo.defaultPrevented,"An exhausted local history swallowed Figma document Redo");
      get("#scale-x").focus();
      const typingUndo = new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true });
      get("#scale-x").dispatchEvent(typingUndo);
      check(!typingUndo.defaultPrevented, "The focused field lost its native text Undo");
      get("#scale-x").value = "100";
      get("#scale-x").dispatchEvent(new InputEvent("input", { inputType: "historyUndo", bubbles: true }));
      check(get("#scale-y").value === "100", "Focused text Undo did not update the linked recipe");
    } else if (scenario === "native-vector-status") {
      await refresh({ ...payload, nativeTarget: undefined, nativeRenderer: undefined,
        nativeVectorTarget: true, nativeVector: true, vectorSource: true });
      check(get("#output-size-flow").textContent === "Native Vector · 200 × 160" &&
        !get("#output-size").getAttribute("aria-label").includes("pixels"),
      "Native Vector continuation incorrectly promises HD raster pixels");
      await refresh();
      // The live region is the fidelity channel for a published native
      // Vector: every completion class announces its own copy — including
      // the exact projection that previously fell through to the outlined
      // message — in both carrier languages, while staying visually hidden.
      const statusCases = [
        { fidelity: { class: "exact", reasons: [] }, text: "Native Vector applied exactly." },
        { fidelity: { class: "approximated", maxError: 0.246, reasons: ["curveSubdivision"] },
          text: "Native Vector applied as an approximation within 0.25 px." },
        { fidelity: { class: "outlined", reasons: ["strokeOutlined"] },
          text: "Native Vector applied with the stroke converted to fill outlines." },
        {
          fidelity: {
            class: "outlined",
            maxError: 0.244,
            reasons: ["strokeOutlined", "strokeApproximated"],
          },
          text:
            "Native Vector applied with the stroke converted to fill outlines; approximation within 0.24 px.",
        },
      ];
      for (const statusCase of statusCases) {
        await apply();
        send({
          type: "apply-complete", generation, operation: "replace",
          targetNodeId: payload.targetNodeId, vectorFidelity: statusCase.fidelity,
        });
        await wait(() => get("#status").textContent === statusCase.text,
          `native Vector status: ${statusCase.text}`);
        check(get("#status").getAttribute("role") === "status" &&
          get("#status").classList.contains("sr-only"), "status left the screen-reader live region");
      }
      send({ type: "locale", preference: "zh-CN", locale: "zh-CN" });
      await apply();
      send({
        type: "apply-complete", generation, operation: "replace",
        targetNodeId: payload.targetNodeId, vectorFidelity: statusCases[3].fidelity,
      });
      await wait(() => get("#status").textContent ===
        "原生矢量已应用，描边已转换为填充轮廓，近似误差不超过 0.24 像素。", "localized native Vector status");

      // A malformed-source negative still proves real WASM refusal rather
      // than a mocked rejection. A valid stroke-fidelity negative below also
      // protects the continuation workflow of an already published Vector.
      send({ type: "locale", preference: "en", locale: "en" });
      const k = 27.6;
      const refusedInput = tolerance => ({
        schema: "worldbend.vector-projection", version: "0.1",
        path: {
          vertices: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
          segments: [
            { start: 0, end: 1, tangentStart: { x: k, y: 0 }, tangentEnd: { x: 0, y: -k } },
            { start: 1, end: 2, tangentStart: { x: 0, y: k }, tangentEnd: { x: k, y: 0 } },
            { start: 2, end: 3, tangentStart: { x: -k, y: 0 }, tangentEnd: { x: 0, y: k } },
            { start: 3, end: 0, tangentStart: { x: 0, y: -k }, tangentEnd: { x: -k, y: 0 } },
          ],
          regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }],
        },
        sourceTransform: [1, 0, 0, 0, 1, 0],
        sourceBounds: { x: 0, y: 0, width: 100, height: 100 },
        homography: [140, 12, -6, 8, 90, 4, 0.05, 0.02, 1],
        reference: { width: 100, height: 100 },
        placement: { width: 200, height: 160 },
        tolerancePx: tolerance,
      });
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type !== "request-source-raster") return;
        const fresh = document.createElement("canvas");
        fresh.width = request.desiredWidth; fresh.height = request.desiredHeight;
        fresh.getContext("2d").drawImage(canvas, 0, 0, fresh.width, fresh.height);
        const pixels = Uint8Array.from(atob(fresh.toDataURL().split(",")[1]), character => character.charCodeAt(0));
        send({ type: "source-raster", generation: request.generation, requestId: request.requestId, bytes: pixels });
      });
      await refresh({ ...payload, sourceNodeId: "curve-node", sourceName: "Curved plate",
        nativeVector: true, vectorSource: true, targetNodeId: undefined, nativeTarget: undefined,
        nativeRenderer: undefined });
      get("#action-apply-vector").click();
      await wait(() => window.fixtureMessages.some(message => message.type === "request-native-vector-projection"),
        "native Vector relay request");
      const relayRequest = window.fixtureMessages.findLast(message => message.type === "request-native-vector-projection").payload;
      // The complete-artwork operation now owns the single .25px tolerance;
      // a discarded legacy per-part tolerance is not a refusal discriminator.
      // Exercise an actually invalid geometry reference through the real core.
      const invalidGeometry = refusedInput(.25);
      invalidGeometry.path.regions[0].loops[0][3] = 4;
      send({
        type: "native-vector-projection",
        generation: relayRequest.generation,
        inputs: [invalidGeometry],
        placement: relayRequest.placement,
        sourceFingerprint: relayRequest.sourceFingerprint,
      });
      await wait(() => window.fixtureMessages.some(message => message.type === "apply" &&
        message.payload.nativeVectorFallback === true), "marked raster fallback apply");
      const fallbackApply = window.fixtureMessages.findLast(message => message.type === "apply");
      check(fallbackApply.payload.bytes instanceof Uint8Array && fallbackApply.payload.bytes.length > 0,
        "fallback raster publication lost its pixels");
      check(!window.fixtureMessages.some(message => message.type === "apply-native-vector"),
        "refused relay still published a native result");
      send({ type: "apply-complete", generation: relayRequest.generation, operation: "apply", targetNodeId: "fallback-result" });
      await wait(() => get("#status").textContent ===
        "Native Vector can't project this path faithfully, so an HD image was created instead.",
      "fallback completion status");
      await refresh({ ...payload, sourceNodeId: "acute-stroked-path", sourceName: "Sharp outlined plate",
        targetNodeId: "retained-native-vector", nativeTarget: undefined, nativeRenderer: undefined,
        nativeVector: true, nativeVectorTarget: true, vectorSource: true });
      const seen=window.fixtureMessages.length;
      get("#apply").click();
      await wait(()=>window.fixtureMessages.slice(seen).some(m=>m.type==="request-native-vector-projection"),"existing Vector update relay");
      const sharpRequest=window.fixtureMessages.findLast(m=>m.type==="request-native-vector-projection").payload;
      const sharp={...refusedInput(.25),path:{
        vertices:[{x:0,y:0},{x:100,y:0},{x:.01,y:.001}],
        segments:[{start:0,end:1},{start:1,end:2},{start:2,end:0}],
        regions:[{windingRule:"NONZERO",loops:[[0,1,2]]}]},
        stroke:{weight:1,cap:"NONE",join:"MITER",miterLimit:4}};
      send({type:"native-vector-projection",generation:sharpRequest.generation,inputs:[sharp],
        placement:sharpRequest.placement,sourceFingerprint:sharpRequest.sourceFingerprint});
      await wait(()=>window.fixtureMessages.slice(seen).some(m=>m.type==="apply"&&m.payload.nativeVectorFallback===true),"valid stroke-fidelity HD fallback");
      const sharpFallback=window.fixtureMessages.findLast(m=>m.type==="apply").payload;
      check(sharpFallback.targetNodeId==="retained-native-vector"&&sharpFallback.sourceNodeId==="acute-stroked-path"&&
        sharpFallback.bytes instanceof Uint8Array&&sharpFallback.bytes.length>0,"fallback lost the original Vector/source identity or HD pixels");
      check(!window.fixtureMessages.slice(seen).some(m=>m.type==="apply-native-vector"),"valid but refused stroke was falsely published as Vector");
      send({type:"apply-complete",generation:sharpRequest.generation,operation:"apply",targetNodeId:"separate-hd-result"});
      await wait(()=>get("#status").textContent===
        "Native Vector can't project this path faithfully, so an HD image was created instead.","existing Vector fallback status");
      await refresh(); // A fresh selection must not inherit a pending native attempt.
      check(window.fixtureErrors.length === 0, `fixture errors: ${window.fixtureErrors.join("; ")}`);
    } else if (scenario === "native-output-limits") {
      check(get("#output-size-flow").textContent === "Editable Frame · 200 × 160" &&
        !get("#output-size").getAttribute("aria-label").includes("pixels"),
        "Editable Frame continuation incorrectly promises HD raster pixels");
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
      await wait(() => get("#output-size-flow").textContent === "Editable Frame · 4500 × 3600" &&
        get("#output-size").dataset.blocked === "true" &&
        get("#output-size-note").textContent.includes("4096") && !get("#action-apply-copy").disabled,
        "native bounds and available fitted HD output");
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
      check(get("#apply").textContent === "Update Linked HD Image", "HD replacement label");
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
      check(get("#action-apply-copy").hidden && get("#apply").textContent === "New Linked HD Image", "Original exposed a replacement or redundant image action");
      const first = await publish("#apply", "apply", false, "apply");
      check(first.renderWidth === 400 && !first.targetNodeId, "Original did not produce a fresh HD image");
      await publish("#action-apply-editable", "apply-native", true, "apply");
      // Optional effect availability and non-projective edits never block HD.
      await refresh({ ...original, nativeRenderer: undefined });
      const unavailable = get("#action-apply-editable");
      check(unavailable.getAttribute("aria-disabled") === "true" && !unavailable.disabled &&
        !get("#native-guidance").hidden &&
        get("#native-guidance").textContent.includes("HD images still work") &&
        !get("#open-effect-listing").hidden &&
        unavailable.getAttribute("aria-describedby") === get("#native-help").getAttribute("aria-describedby"),
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
    } else if (scenario === "warp-precision") {
      const preciseSpec = structuredClone(spec); preciseSpec.content.warp = { preset: "arc", amount: 1 / 3 };
      await refresh({ ...payload, nativeTarget: undefined, nativeRenderer: undefined, spec: preciseSpec });
      get("#mode-warp").click(); await ready();
      check(get("#warp-amount").value === "33.3333" && get("#warp-amount").validity.valid, "precise strength did not reopen in a usable numeric field");
      get("#warp-preset").value = "arch"; get("#warp-preset").dispatchEvent(new Event("change", { bubbles: true }));
      await ready();
      get("#warp-amount").value = "200"; get("#warp-amount").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => get("#apply").disabled, "invalid Warp blocks publication");
      get("#warp-amount").value = "33.3333"; get("#warp-amount").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => !get("#apply").disabled && get("#error").hidden, "returning to the accepted strength recovers Warp");
      addEventListener("message", event => {
        const request = event.data?.pluginMessage;
        if (request?.type !== "request-source-raster") return;
        const fresh = document.createElement("canvas"); fresh.width = request.desiredWidth; fresh.height = request.desiredHeight;
        fresh.getContext("2d").drawImage(canvas, 0, 0, fresh.width, fresh.height);
        const png = Uint8Array.from(atob(fresh.toDataURL().split(",")[1]), c => c.charCodeAt(0));
        send({ type: "source-raster", generation, requestId: request.requestId, bytes: png });
      });
      const seen = window.fixtureMessages.length; get("#apply").click();
      await wait(() => window.fixtureMessages.slice(seen).some(m => m.type === "apply"), "precise Warp publication");
      const output = window.fixtureMessages.findLast(m => m.type === "apply").payload;
      check(output.spec.content.warp.preset === "arch" && output.spec.content.warp.amount === 1 / 3,
        "preset-only edit rounded the saved Warp strength");
    } else if (scenario === "content-history") {
      const choice = get("#distort-options");
      const choiceBox = choice.getBoundingClientRect();
      const editorBox = get("#editor").getBoundingClientRect();
      check(!choice.hidden && get("#distort-perspective").textContent === "Symmetric", "Symmetric corner control missing");
      check(choiceBox.top < editorBox.top + 48 && choiceBox.right > editorBox.right - 28, "Corner control is not in the empty top-right of the editor");
      check(get("#operation-cluster").querySelector("#distort-options") === null, "Distort choice returned to the operation bar");
      const nameMax = getComputedStyle(get("#source-name")).maxWidth;
      const nameYields = nameMax.includes("148px") ||
        (Number.parseFloat(nameMax) <= editorBox.width - 140);
      check(nameYields, `Source name did not yield space to the corner control (${nameMax})`);
      await moveCorner(); const first = label(); await moveCorner(); const second = label();
      await refresh(); check(label() === second, "Pixel refresh moved the draft");
      undo(); await wait(() => label() === first, "undo after content refresh");
    } else if (scenario === "transform-control-commit-queue") {
      get("#mode-transform").click();await ready();
      const edit=(id,value)=>{const input=get(id);input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));};
      edit("#rotation","17");edit("#scale-x","125");await ready();await refresh();
      undo();await wait(()=>get("#scale-x").value==="100","undo queued scale");await ready();
      check(Number(get("#rotation").value)===17,"queued scale Undo lost prior rotation");
      undo();await wait(()=>Number(get("#rotation").value)===0,"undo queued rotation");await ready();
      key(document.activeElement,"z",{metaKey:true,shiftKey:true});await wait(()=>Number(get("#rotation").value)===17,"redo queued rotation");await ready();
      check(get("#scale-x").value==="100","redo rotation consumed the later scale");
      key(document.activeElement,"z",{metaKey:true,shiftKey:true});await wait(()=>get("#scale-x").value==="125","redo queued scale");await ready();
      check(Number(get("#rotation").value)===17,"redo scale lost rotation");
    } else if (scenario === "transform-controls") {
      get("#mode-transform").click(); await ready();
      check(get("#distort-options").hidden, "Symmetric corner control stayed visible outside Distort");
      get("#mode-distort").click(); await ready();
      check(!get("#distort-options").hidden, "Symmetric corner control did not return with Distort");
      get("#mode-transform").click(); await ready();
      for (const [id, value] of [["#rotation", "17"], ["#scale-x", "125"]]) {
        get(id).value = value; get(id).dispatchEvent(new Event("input", { bubbles: true }));
        get(id).dispatchEvent(new Event("change", { bubbles: true })); await ready();
      }
      await refresh();
      check(get("#rotation").value === "17" && get("#scale-x").value === "125", "Refresh reset affine controls");
      undo(); await wait(() => get("#scale-x").value === "100", "undo scale"); await ready();
      check(get("#rotation").value === "17", "Undo discarded the previous rotation "+JSON.stringify({rotation:get("#rotation").value,scale:get("#scale-x").value,corner:label()}));
      key(document.activeElement, "z", { metaKey: true, shiftKey: true });
      await wait(() => get("#scale-x").value === "125", "redo scale"); await ready();
      window.fixtureClipboard = "";
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async value => { window.fixtureClipboard = value; },
      } });
      get("#more-options").click();
      get("#action-copy-css").click();
      await wait(() => window.fixtureClipboard.includes("matrix3d("), "Copy CSS uses the built Figma core");
      check(window.fixtureClipboard.includes("transform-origin:"), "Copy CSS omitted its transform origin");
      const published = await apply();
      check(published.placement.width > 250 && published.placement.height > 200, "Apply lost the retained composition");
    } else if (scenario === "designer-workflows") {
      // A continuous designer workflow: screen placement, rotated poster, skewed label, repeated
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
      get("#workspace-tab-surface").click();
      await wait(() => !get("#surface-workspace").hidden &&
        get('#surface-workspace [data-role="patches"]').value === "1x1" &&
        get('#surface-workspace [data-role="subdivisions"]').value === "12",
        "Pin Warp did not open a 1×1 envelope on a 12×12 mesh");
      get("#workspace-tab-perspective").click();
      await wait(() => !get("#controls").hidden, "return from Pin Warp");
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
      check(get("#apply").textContent === "Update Linked HD Image", "Reopened Warp result lost its update action");
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

function escapeHtmlAttribute(value){return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
