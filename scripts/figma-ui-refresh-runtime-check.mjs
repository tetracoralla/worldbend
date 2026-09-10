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
  const scenarios = ["content-history", "pending-distort-commit", "unpainted-distort-commit", "transform-controls", "external-operation", "output-workflow", "native-output-limits", "native-publication-undo", "fixed-preview-labels", "late-native-renderer", "hd-source-reuse", "projective-edge-quality", "selection-entry", "dogfood-tasks"];
  const requested = process.argv.slice(2);
  for (const scenario of requested) assert(scenarios.includes(scenario), `Unknown Figma UI scenario: ${scenario}`);
  for (const scenario of requested.length ? requested : scenarios) {
    const target = await createPage(browser.debugUrl, `http://127.0.0.1:${address.port}/?case=${scenario}`);
    const result = await readPageResult(target.webSocketDebuggerUrl);
    assert(!result.error, `${scenario}: ${result.error}`);
    console.log(`Built Figma UI refresh passed: ${scenario}`);
  }
  const compactScenarios = requested.length
    ? requested.filter((name) => name === "selection-entry")
    : ["selection-entry"];
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
    if (scenario === "selection-entry") {
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
        get("#native-guidance").textContent === "Editable output requires a supported Frame and a configured perspective effect in this file." &&
        unavailable.getAttribute("aria-describedby") === "native-guidance",
        "Unavailable native output hid its focusable recovery guidance");
      const nativeCalls = window.fixtureMessages.filter(message => message.type === "apply-native").length;
      unavailable.focus();
      check(document.activeElement === unavailable, "Unavailable editable output is not keyboard-reachable");
      unavailable.click();
      check(!get("#error").hidden, "Unavailable editable activation gave no feedback");
      check(window.fixtureMessages.filter(message => message.type === "apply-native").length === nativeCalls,
        "Unavailable editable activation attempted publication");
      check(!get("#apply").disabled, "Missing native effect blocked raster delivery");
      await publish("#apply", "apply", false, "apply");
      await refresh(payload);
      get("#mode-warp").click(); await ready();
      get("#warp-preset").value = "arc";
      get("#warp-preset").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => get("#action-apply-editable").disabled && !get("#action-apply-copy").disabled, "Warp raster-only outputs");
      const warped = await publish("#action-apply-copy", "apply", true, "apply");
      check(Boolean(warped.spec.content.warp), "HD copy lost Warp");
      const warpAmount = get("#warp-amount").value;
      get("#action-apply-copy").focus(); get("#warp-amount").value = "9";
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
      // Roadmap designer dogfood as one continuous working session. Covered
      // here: screen placement, rotated poster, skewed label, and source
      // replacement. Transform Again and the Warp preset route remain
      // follow-ups (Warp output is separately covered by edge-quality).
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
