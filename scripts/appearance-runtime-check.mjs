import {createQaHttpFailureBoundary} from "./qa-http-failure-boundary.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import checkSpatialAppearance from "./appearance-browser-check.js";
import checkDocumentWork from "./document-work-browser-check.js";
import { closeChrome, createPage, findChrome, launchChrome } from "./remap-native-webgl-parity.mjs";

const httpFailures=createQaHttpFailureBoundary("appearance-runtime-check.mjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(root, "packages", "web");
const entry = path.join(webRoot, "dist", "effects.js");
const marker = '<script type="module" src="appearance-demo.js"></script>';
const startupProbe = `<script>
(() => {
  const controls = [...document.querySelectorAll('#play,#pointer-x,#pointer-y,[data-focus],#reset')];
  const views = [...document.querySelectorAll('.viewport')];
  const record = globalThis.__WORLDBEND_APPEARANCE_STARTUP__ = {
    controlCount: controls.length,
    everyControlDisabled: controls.every(control => control.disabled),
    everyViewDisabled: views.every(view => view.getAttribute('aria-disabled') === 'true'),
    mainBusy: document.querySelector('main')?.getAttribute('aria-busy') === 'true',
    focusAttempted: false,
    focusDisabledAtAttempt: false,
    focusClickBlocked: false,
  };
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    original.call(this, type, listener, options);
    if (record.focusAttempted || type !== 'click' || this?.dataset?.focus !== '1500') return;
    record.focusAttempted = true;
    queueMicrotask(() => {
      const target = document.querySelector('[data-focus="650"]');
      const before = target?.getAttribute('aria-pressed');
      record.focusDisabledAtAttempt = target?.disabled === true;
      target?.click();
      record.focusClickBlocked = before === target?.getAttribute('aria-pressed');
      EventTarget.prototype.addEventListener = original;
    });
  };
})();
</script>`;

const compileDocument = (operation, spec) => {
  const command = spawnSync("cargo", [
    "run", "--quiet", "--locked", "-p", "worldbend-cli", "--bin", "worldbend", "--",
    operation, "--spec", spec, "--json",
  ], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(command.status, 0, command.stderr || `Unable to run ${operation}`);
  return JSON.parse(command.stdout).result;
};
const compiledDelivery = compileDocument("document-delivery-plan", "examples/spatial-document-showcase-delivery.worldbend.json");
const packagedDelivery = JSON.parse(await readFile(path.join(webRoot, "examples", "document-showcase-plan.json"), "utf8"));
assert.deepEqual(packagedDelivery, compiledDelivery, "The Web showcase must use the current core-compiled delivery plan");
const revisionScratch = await mkdtemp(path.join(tmpdir(), "worldbend-document-revision-"));
try {
  const document = JSON.parse(await readFile(path.join(root, "examples", "spatial-document-showcase.worldbend.json"), "utf8"));
  const updateSpec = path.join(revisionScratch, "update.json");
  await writeFile(updateSpec, JSON.stringify({document,expectedFingerprint:compiledDelivery.documentFingerprint,revisions:[{assetId:"showcase-product",contentVersion:"release-02"}]}));
  const update = compileDocument("document-update-plan", updateSpec);
  assert.equal(update.changed, true, "The second release must revise the canonical document");
  assert.deepEqual(update.affectedExpressions.map(expression => expression.id), ["showcase-hero"], "The revised asset must affect the interactive expression");
  const deliverySpec = path.join(revisionScratch, "delivery.json");
  await writeFile(deliverySpec, JSON.stringify({document:update.document,expressionIds:["showcase-hero"]}));
  const revisedDelivery = compileDocument("document-delivery-plan", deliverySpec);
  const packagedRevision = JSON.parse(await readFile(path.join(webRoot, "examples", "document-showcase-plan-release02.json"), "utf8"));
  assert.deepEqual(packagedRevision, revisedDelivery, "The second release must use the core-planned document revision");
  assert.notEqual(revisedDelivery.documentFingerprint, compiledDelivery.documentFingerprint, "The document identity must advance with its content version");
  assert.deepEqual(revisedDelivery.deliveries, compiledDelivery.deliveries, "A content revision must preserve the accepted expression and bindings");
} finally {
  await rm(revisionScratch, {recursive:true,force:true});
}

await access(entry).catch(() => {
  throw new Error("Build the Web carrier before running Spatial Appearance acceptance: pnpm build:web");
});

const evidenceDirectory = await mkdtemp(path.join(tmpdir(), "worldbend-appearance-check-"));
let browser;
let server;
let page;
let documentPage;
let chrome;
try {
  server = await startStaticServer();
  chrome = await findChrome();
  browser = await launchChrome(chrome);
  const target = await createPage(browser.debugUrl, `http://127.0.0.1:${server.port}/examples/appearance.html`);
  page = await connectPage(target.webSocketDebuggerUrl);
  const result = await checkSpatialAppearance(page, evidenceDirectory);
  const readiness = await page.evaluate(() => ({
    startup: globalThis.__WORLDBEND_APPEARANCE_STARTUP__,
    mainBusy: document.querySelector("main")?.getAttribute("aria-busy"),
    controlsEnabled: [...document.querySelectorAll("#play,#pointer-x,#pointer-y,[data-focus],#reset")]
      .every(control => !control.disabled),
    viewsEnabled: [...document.querySelectorAll(".viewport")]
      .every(view => view.getAttribute("aria-disabled") === "false"),
    plans: globalThis.worldbendAppearance?.getPlans().length,
  }));
  assert.equal(readiness.startup?.controlCount, 7, "Startup probe must reach every interactive control");
  assert.equal(readiness.startup?.everyControlDisabled, true, "Controls must be disabled before the first accepted render");
  assert.equal(readiness.startup?.everyViewDisabled, true, "Direct-manipulation surfaces must be disabled while loading");
  assert.equal(readiness.startup?.mainBusy, true, "The initial loading state must be exposed to assistive technology");
  assert.equal(readiness.startup?.focusAttempted, true, "The startup race probe must reach a registered focus action");
  assert.equal(readiness.startup?.focusDisabledAtAttempt, true, "A focus change must remain disabled during initial construction");
  assert.equal(readiness.startup?.focusClickBlocked, true, "An early focus click must not interrupt initial construction");
  assert.equal(readiness.mainBusy, "false", "The accepted fixture must leave its busy state");
  assert.equal(readiness.controlsEnabled, true, "Every control must become available after readiness");
  assert.equal(readiness.viewsEnabled, true, "Every viewport must become interactive after readiness");
  assert.equal(readiness.plans, 3, "The startup interruption probe must preserve all three accepted candidates");
  assert.deepEqual(page.runtimeErrors(), [], "The browser acceptance path must not emit uncaught exceptions or console errors");
  result.checks.unshift("cold-start input is gated until all three candidates are accepted");
  const documentTarget = await createPage(browser.debugUrl, `http://127.0.0.1:${server.port}/examples/document.html`);
  documentPage = await connectPage(documentTarget.webSocketDebuggerUrl);
  const documentResult = await checkDocumentWork(documentPage, evidenceDirectory);
  assert.deepEqual(documentPage.runtimeErrors(), [], "The document-work path must not emit uncaught exceptions or console errors");
  process.stdout.write(`${JSON.stringify({ outcome:"PASS", appearance:result, document:documentResult, browser:chrome }, null, 2)}\n`);
} catch(error){throw httpFailures.decorate(error)} finally {
  documentPage?.close();
  page?.close();
  if (browser) await closeChrome(browser);
  if (server?.listening) await server.close();
  await rm(evidenceDirectory, { recursive: true, force: true });
}

async function startStaticServer() {
  const instance = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      const candidate = path.resolve(webRoot, `.${pathname}`);
      if (candidate !== webRoot && !candidate.startsWith(`${webRoot}${path.sep}`)) {
        return send(response, 403, "text/plain; charset=utf-8", "Forbidden");
      }
      let body = await readFile(candidate);
      if (pathname === "/examples/appearance.html") {
        const html = body.toString("utf8");
        if (!html.includes(marker)) throw new Error("Spatial Appearance entry marker is missing");
        body = Buffer.from(html.replace(marker, `${startupProbe}\n${marker}`));
      }
      send(response, 200, contentType(candidate), body);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "EISDIR") return send(response, 404, "text/plain; charset=utf-8", "Not found");
      httpFailures.respond(request,response,error,500);
    }
  });
  await new Promise((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", resolve);
  });
  const address = instance.address();
  assert(address && typeof address !== "string", "Unable to bind Spatial Appearance server");
  return {
    port: address.port,
    get listening() { return instance.listening; },
    close: () => new Promise((resolve, reject) => instance.close(error => error ? reject(error) : resolve())),
  };
}

function contentType(file) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
  })[path.extname(file)] ?? "application/octet-stream";
}

function send(response, status, type, body) {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(body);
}

async function connectPage(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const runtimeErrors = [];
  let nextId = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? "Uncaught browser exception");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      runtimeErrors.push(message.params.args?.map(value => value.value ?? value.description).join(" ") ?? "Browser console error");
    }
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const sendCommand = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await Promise.all([sendCommand("Page.enable"), sendCommand("Runtime.enable")]);
  const evaluate = async (callback, argument, hasArgument = false) => {
    const expression = `(${callback.toString()})(${hasArgument ? JSON.stringify(argument) : ""})`;
    const response = await sendCommand("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Browser evaluation failed");
    }
    return response.result?.value;
  };
  const publicEvaluate = function(callback, argument) {
    return evaluate(callback, argument, arguments.length > 1);
  };
  const waitForFunction = async (callback, argument) => {
    const deadline = Date.now() + 15_000;
    let lastError;
    while (Date.now() < deadline) {
      try {
        if (await publicEvaluate(callback, argument)) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Browser condition did not settle within 15 seconds${lastError ? `: ${lastError.message}` : ""}`);
  };
  return {
    evaluate: publicEvaluate,
    waitForFunction,
    async setViewportSize({ width, height }) {
      await sendCommand("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 1, mobile: false,
        screenWidth: width, screenHeight: height,
      });
    },
    async reload() {
      await sendCommand("Page.reload", { ignoreCache: true });
    },
    locator(selector) {
      return {
        focus: () => publicEvaluate(value => {
          const element = document.querySelector(value);
          if (!element) throw new Error(`Missing element: ${value}`);
          element.focus();
        }, selector),
        textContent: () => publicEvaluate(value => {
          const element = document.querySelector(value);
          if (!element) throw new Error(`Missing element: ${value}`);
          return element.textContent;
        }, selector),
      };
    },
    getByRole(role, { name }) {
      if (role !== "button") throw new Error(`Unsupported CDP fixture role: ${role}`);
      return {
        click: () => publicEvaluate(label => {
          const element = [...document.querySelectorAll("button")]
            .find(button => (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() === label);
          if (!element) throw new Error(`Missing button: ${label}`);
          element.click();
        }, name),
      };
    },
    keyboard: {
      async press(key) {
        const codes = { ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35 };
        const code = codes[key];
        if (!code) throw new Error(`Unsupported CDP fixture key: ${key}`);
        const params = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
        await sendCommand("Input.dispatchKeyEvent", { type: "keyDown", ...params });
        await sendCommand("Input.dispatchKeyEvent", { type: "keyUp", ...params });
      },
    },
    mouse: {
      async press(x, y) {
        await sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      },
      async move(x, y) {
        await sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      },
      async release(x, y) {
        await sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      },
    },
    emulateMedia({ reducedMotion }) {
      return sendCommand("Emulation.setEmulatedMedia", {
        media: "",
        features: [{ name: "prefers-reduced-motion", value: reducedMotion }],
      });
    },
    async screenshot({ path: output, fullPage = false }) {
      await mkdir(path.dirname(output), { recursive: true });
      const result = await sendCommand("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: fullPage,
      });
      await writeFile(output, Buffer.from(result.data, "base64"));
    },
    runtimeErrors: () => [...runtimeErrors],
    close() {
      for (const request of pending.values()) request.reject(new Error("Browser page closed"));
      pending.clear();
      socket.close();
    },
  };
}
