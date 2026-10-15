import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "examples", "worldbend-demo-source.png");
const webModulePath = path.join(root, "packages", "web", "dist", "index.js");
const WIDTH = 96;
const HEIGHT = 64;
const activeBrowsers = new Set();
const browserSignalHandlers = new Map();
let browserCleanupInstalled = false;
let browserSignalCleanupStarted = false;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runParityCheck();
}

export async function runParityCheck() {
  await access(webModulePath).catch(() => {
    throw new Error("Build the Web carrier before running Remap parity: pnpm build:web");
  });
  const chrome = await findChrome();
  const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-remap-parity-"));
  let browser;
  let server;
  try {
    const cases = parityCases();
    await writeFile(path.join(scratch, "alpha-source.png"), alphaFixture());
    for (const testCase of cases) {
      const specPath = path.join(scratch, `${testCase.id}.json`);
      const outputPath = path.join(scratch, `${testCase.id}.png`);
      await writeFile(specPath, `${JSON.stringify(testCase.spec, null, 2)}\n`, "utf8");
      const args = [
        "run", "--quiet", "-p", "worldbend-cli", "--bin", "worldbend", "--",
        "remap-render", "--source", testCase.alpha ? path.join(scratch, "alpha-source.png") : sourcePath,
        ...(testCase.map ? ["--map", testCase.alpha ? path.join(scratch, "alpha-source.png") : sourcePath] : []),
        "--spec", specPath, "--output", outputPath,
        "--quality", testCase.quality, "--overwrite", "--json",
      ];
      await run("cargo", args, { cwd: root });
    }

    server = await startServer({ cases, scratch });
    browser = await launchChrome(chrome);
    const target = await createPage(browser.debugUrl, `http://127.0.0.1:${server.port}/`);
    const result = await readPageResult(target.webSocketDebuggerUrl);
    if (result.error) throw new Error(`Browser Remap parity failed: ${result.error}`);
    try {
      for (const testCase of cases) {
        const measurement = result.measurements.find((entry) => entry.id === testCase.id);
        if (!measurement) throw new Error(`Missing browser measurement for ${testCase.id}`);
        assertParity(measurement, testCase.tolerance);
      }
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ measurements: result.measurements }, null, 2)}\n`);
      throw error;
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      browser: chrome,
      dimensions: { width: WIDTH, height: HEIGHT },
      measurements: result.measurements,
    }, null, 2)}\n`);
  } finally {
    await server?.close();
    if (browser) await closeChrome(browser);
    await rm(scratch, { recursive: true, force: true });
  }
}

export function compareRgba(actual, expected, width, height, inset = 2) {
  if (actual.length !== expected.length || actual.length !== width * height * 4) {
    throw new Error("RGBA buffers must have the same declared dimensions");
  }
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  let differentChannels = 0;
  let comparedChannels = 0;
  let maxAt;
  for (let y = inset; y < height - inset; y += 1) {
    for (let x = inset; x < width - inset; x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(actual[offset + channel] - expected[offset + channel]);
        if (delta > maxChannelDelta) {
          maxChannelDelta = delta;
          maxAt = { x, y, channel, actual: actual[offset + channel], expected: expected[offset + channel] };
        }
        totalChannelDelta += delta;
        comparedChannels += 1;
        if (delta !== 0) differentChannels += 1;
      }
    }
  }
  return {
    maxChannelDelta,
    meanChannelDelta: totalChannelDelta / comparedChannels,
    differentChannelRatio: differentChannels / comparedChannels,
    comparedChannels,
    inset,
    maxAt,
  };
}

function assertParity(measurement, tolerance) {
  if (
    measurement.maxChannelDelta > tolerance.maxChannelDelta ||
    measurement.meanChannelDelta > tolerance.meanChannelDelta
  ) {
    throw new Error(
      `${measurement.id} Native/WebGL drift: max=${measurement.maxChannelDelta} ` +
      `(limit ${tolerance.maxChannelDelta}), mean=${measurement.meanChannelDelta.toFixed(4)} ` +
      `(limit ${tolerance.meanChannelDelta})`,
    );
  }
}

function parityCases() {
  const standard = [
    {
      id: "lens-standard",
      quality: "standard",
      map: false,
      tolerance: { maxChannelDelta: 4, meanChannelDelta: 0.35 },
      spec: {
        schema: "worldbend.remap",
        version: "0.1",
        output: { width: WIDTH, height: HEIGHT },
        operation: {
          kind: "lens",
          coefficients: { k1: -0.08, k2: 0.02, k3: -0.003, p1: 0.001, p2: -0.001 },
          center: { x: 0.5, y: 0.5 },
          scale: { x: 0.5, y: 0.5 },
        },
      },
    },
    {
      id: "displacement-standard",
      quality: "standard",
      map: true,
      tolerance: { maxChannelDelta: 4, meanChannelDelta: 0.35 },
      spec: {
        schema: "worldbend.remap",
        version: "0.1",
        output: { width: WIDTH, height: HEIGHT },
        operation: {
          kind: "displacement",
          xChannel: "red",
          yChannel: "green",
          scaleXPixels: 24,
          scaleYPixels: -18,
          neutral: 128,
          boundary: "clamp",
        },
      },
    },
  ];
  const alpha = [
    { id: "lens-transparent", map: false, operation: { kind: "lens", coefficients: { k1: .2 } } },
    ...["transparent", "clamp", "wrap"].map(boundary => ({
      id: `displacement-alpha-${boundary}`, map: true,
      operation: { kind: "displacement", xChannel: "red", yChannel: "green",
        scaleXPixels: 72, scaleYPixels: -48, neutral: 128, boundary },
    })),
  ].flatMap(testCase => ["standard", "high"].map(quality => ({
    ...testCase, id: `${testCase.id}-${quality}`, quality, alpha: true,
    tolerance: { maxChannelDelta: 4, meanChannelDelta: .35 },
    spec: { schema: "worldbend.remap", version: "0.1",
      output: { width: WIDTH, height: HEIGHT }, operation: testCase.operation },
  })));
  return [
    ...standard,
    ...standard.map((testCase) => ({
      ...testCase,
      id: testCase.id.replace("standard", "high"),
      quality: "high",
      tolerance: { maxChannelDelta: 6, meanChannelDelta: 0.5 },
    })),
    ...alpha,
  ];
}

// Distinct RGB survives beneath half/zero alpha. This challenges map-channel
// reads separately from premultiplied source filtering and all source edges.
function alphaFixture() {
  const width = 48, height = 32;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 4) + 1 + x * 4;
    rows.set([x < 24 ? 220 : 40, y < 16 ? 80 : 200, (x + y) % 2 ? 160 : 64,
      x < 16 ? 255 : x < 32 ? 128 : 0], offset);
  }
  const chunk = (kind, bytes) => {
    const tag = Buffer.from(kind), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([tag, bytes])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, tag, bytes, checksum]);
  };
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

export function compareCompositedRgba(actual, expected, width, height) {
  // Browser PNG/canvas unpremultiplication can change invisible RGB greatly.
  // Compare visible channels on both black and white, with no edge exclusion.
  const measurements = [0, 255].map(background => {
    const composite = rgba => Uint8Array.from(rgba, (value, index) => index % 4 === 3 ? value :
      Math.round(value * rgba[index - index % 4 + 3] / 255 + background * (1 - rgba[index - index % 4 + 3] / 255)));
    return compareRgba(composite(actual), composite(expected), width, height, 0);
  });
  return { ...measurements[0],
    maxChannelDelta: Math.max(...measurements.map(value => value.maxChannelDelta)),
    meanChannelDelta: Math.max(...measurements.map(value => value.meanChannelDelta)),
    composites: measurements };
}

async function startServer({ cases, scratch }) {
  const source = await readFile(sourcePath);
  const alphaSource = await readFile(path.join(scratch, "alpha-source.png"));
  const module = await readFile(webModulePath);
  // Rollup can extract shared modules across the Web package's public entries.
  // Serve the built JS inventory so relative chunk imports reach real code.
  const modules = new Map(await Promise.all((await readdir(path.dirname(webModulePath), { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith(".js"))
    .map(async entry => ["/" + entry.name, await readFile(path.join(path.dirname(webModulePath), entry.name))])));
  const native = new Map();
  for (const testCase of cases) {
    native.set(`/${testCase.id}.png`, await readFile(path.join(scratch, `${testCase.id}.png`)));
  }
  const html = parityPage(cases);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/") return send(response, 200, "text/html; charset=utf-8", html);
    if (pathname === "/web.js") return send(response, 200, "text/javascript; charset=utf-8", module);
    if (modules.has(pathname)) return send(response, 200, "text/javascript; charset=utf-8", modules.get(pathname));
    if (pathname === "/source.png") return send(response, 200, "image/png", source);
    if (pathname === "/alpha-source.png") return send(response, 200, "image/png", alphaSource);
    const nativeImage = native.get(pathname);
    if (nativeImage) return send(response, 200, "image/png", nativeImage);
    return send(response, 404, "text/plain; charset=utf-8", "Not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind parity server");
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function parityPage(cases) {
  return `<!doctype html><meta charset="utf-8"><title>Worldbend Remap parity</title><script type="module">
const cases = ${JSON.stringify(cases)};
const load = (url) => new Promise((resolve, reject) => {
  const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url;
});
const rgba = (source, width, height) => {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, width, height); context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, width, height).data;
};
const compare = ${compareRgba.toString()};
const compareRgba = compare;
const compareComposited = ${compareCompositedRgba.toString()};
try {
  const { RemapWebGLRenderer } = await import("/web.js");
  const source = await load("/source.png");
  const alphaSource = await load("/alpha-source.png");
  const measurements = [];
  for (const testCase of cases) {
    const expected = await load("/" + testCase.id + ".png");
    const renderer = new RemapWebGLRenderer();
    const input = testCase.alpha ? alphaSource : source;
    renderer.render(input, testCase.map ? input : undefined, testCase.spec, testCase.quality === "high");
    const comparePixels = testCase.alpha ? compareComposited : compare;
    measurements.push({ id: testCase.id, ...comparePixels(
      rgba(renderer.canvas, ${WIDTH}, ${HEIGHT}), rgba(expected, ${WIDTH}, ${HEIGHT}),
      ${WIDTH}, ${HEIGHT}, 2,
    ) });
    renderer.dispose();
  }
  globalThis.__WORLDBEND_PARITY__ = { measurements };
} catch (error) {
  globalThis.__WORLDBEND_PARITY__ = { error: error instanceof Error ? error.stack ?? error.message : String(error) };
}
</script>`;
}

export async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error("Chrome or Chromium is required for Native/WebGL Remap parity; set CHROME_BIN");
}

export async function launchChrome(executable, extraArgs = []) {
  const profile = await mkdtemp(path.join(tmpdir(), "worldbend-parity-chrome-"));
  const args = [
    "--headless=new",
    // A display-less Linux runner can otherwise report no pointing device.
    // Use Chromium's real desktop settings (also used by Playwright); coarse
    // cases override this with native CDP touch emulation and assert the result.
    // https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts
    "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    ...extraArgs,
    "about:blank",
  ];
  const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
  const browser = { process: child, debugUrl: undefined, profile };
  registerActiveBrowser(browser);
  try {
    const debugUrl = await new Promise((resolve, reject) => {
      let output = "";
      // Cold browser startup under concurrent compiler load can exceed 15 s.
      // Keep this bounded while allowing the same isolated host to become ready.
      const timeout = setTimeout(() => reject(new Error(`Chrome debugging endpoint timed out: ${output}`)), 30_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Chrome exited before startup (${code}): ${output}`)); });
    });
    const parsed = new URL(debugUrl);
    browser.debugUrl = `http://${parsed.host}`;
    return browser;
  } catch (error) {
    await closeChrome(browser).catch(() => {});
    throw error;
  }
}

export async function closeChrome(browser) {
  const child = browser.process;
  try {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), unrefDelay(2_000)]);
    }
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  } finally {
    // Failed retirement still owns a live browser for the signal/exit retry.
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) activeBrowsers.delete(browser);
  }
  // A crash/helper process may inherit Chrome's stderr descriptor. The leader
  // exit does not close that pipe, so Node otherwise stays alive after every
  // assertion/server has completed. Retire only our owned streams, and only
  // after the browser leader is confirmed exited (or never spawned).
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    for (const stream of child.stdio ?? []) stream?.destroy();
  }
  // Chrome's helper processes can finish flushing profile files just after
  // the browser process exits. Let fs.rm retry transient ENOTEMPTY/EBUSY
  // races instead of turning a successful browser contract into a CI failure.
  await rm(browser.profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

function registerActiveBrowser(browser) {
  activeBrowsers.add(browser);
  installBrowserCleanup();
}

function installBrowserCleanup() {
  if (browserCleanupInstalled) return;
  browserCleanupInstalled = true;
  process.once("exit", () => terminateBrowserProcessesSync(activeBrowsers));
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    const handler = () => { void closeBrowsersForSignal(signal); };
    browserSignalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
}

async function closeBrowsersForSignal(signal) {
  if (browserSignalCleanupStarted) {
    terminateBrowserProcessesSync(activeBrowsers);
    process.exit(1);
  }
  browserSignalCleanupStarted = true;
  await Promise.allSettled([...activeBrowsers].map((browser) => closeChrome(browser)));
  const handler = browserSignalHandlers.get(signal);
  if (handler) process.removeListener(signal, handler);
  try {
    process.kill(process.pid, signal);
  } catch {
    process.exit(1);
  }
}

export function terminateBrowserProcessesSync(browsers) {
  let terminated = 0;
  for (const browser of browsers) {
    const child = browser?.process;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) continue;
    try {
      if (child.kill("SIGTERM")) terminated += 1;
    } catch {
      // Process shutdown must stay best-effort; async cleanup reports normal-run failures.
    }
  }
  return terminated;
}

function unrefDelay(milliseconds) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref();
  });
}

export async function createPage(debugUrl, url) {
  const response = await fetch(`${debugUrl}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Chrome could not create parity page: ${response.status}`);
  return response.json();
}

export async function readPageResult(webSocketUrl, viewport) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const timeoutMs = viewport?.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  try {
    if (viewport) {
      if (viewport.pointerDevice !== undefined) {
        assert(["fine", "coarse"].includes(viewport.pointerDevice), "Unknown QA pointer device");
        // Native device emulation, not a matchMedia mock. Tests must still
        // observe and assert the resulting hover/pointer media queries.
        await send("Emulation.setTouchEmulationEnabled", { enabled: viewport.pointerDevice === "coarse" });
      }
      await send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false,
      });
      if (viewport.focus) await send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await send("Page.navigate", { url: viewport.url });
    }
    while (Date.now() < deadline) {
      if (viewport?.trustedInput) {
        const command = await send("Runtime.evaluate", {
          expression: "(() => { const c = globalThis.__WORLDBEND_INPUT__; delete globalThis.__WORLDBEND_INPUT__; return c; })()",
          returnByValue: true,
        });
        const input = command.result?.value;
        if (input) {
          const inputMethod = ["Input.dispatchMouseEvent", "Input.dispatchKeyEvent"].includes(input.method);
          const emulationMethod = viewport.allowEmulation === true &&
            ["Emulation.setEmulatedMedia", "Emulation.setDeviceMetricsOverride"].includes(input.method);
          assert(inputMethod || emulationMethod);
          if (emulationMethod && input.method === "Emulation.setEmulatedMedia") {
            assert(input.params.features?.length === 1 &&
              input.params.features[0].name === "prefers-reduced-motion" &&
              ["reduce", "no-preference"].includes(input.params.features[0].value));
          }
          if (emulationMethod && input.method === "Emulation.setDeviceMetricsOverride") {
            assert([input.params.width, input.params.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 4096));
            assert(input.params.deviceScaleFactor === 1 && typeof input.params.mobile === "boolean");
          }
          await send(input.method, input.params);
          if (input.screenshot && viewport.screenshotDirectory) {
            assert(/^[a-z-]+$/.test(input.screenshot));
            const captured = await send("Page.captureScreenshot", { format: "png" });
            await writeFile(path.join(viewport.screenshotDirectory, input.screenshot + ".png"), Buffer.from(captured.data, "base64"));
          }
          await send("Runtime.evaluate", { expression: "globalThis.__WORLDBEND_INPUT_DONE__ = true" });
        }
      }
      const response = await send("Runtime.evaluate", {
        expression: "globalThis.__WORLDBEND_PARITY__ ?? null",
        returnByValue: true,
      });
      const value = response.result?.value;
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Browser did not finish runtime check within ${timeoutMs} ms`);
  } finally {
    socket.close();
  }
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(body);
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stderr}\n${stdout}`));
    });
  });
}
