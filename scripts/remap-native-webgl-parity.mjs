import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "examples", "worldbend-demo-source.png");
const webModulePath = path.join(root, "packages", "web", "dist", "index.js");
const WIDTH = 96;
const HEIGHT = 64;

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
    for (const testCase of cases) {
      const specPath = path.join(scratch, `${testCase.id}.json`);
      const outputPath = path.join(scratch, `${testCase.id}.png`);
      await writeFile(specPath, `${JSON.stringify(testCase.spec, null, 2)}\n`, "utf8");
      const args = [
        "run", "--quiet", "-p", "worldbend-cli", "--bin", "worldbend", "--",
        "remap-render", "--source", sourcePath,
        ...(testCase.map ? ["--map", sourcePath] : []),
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
  return [
    ...standard,
    ...standard.map((testCase) => ({
      ...testCase,
      id: testCase.id.replace("standard", "high"),
      quality: "high",
      tolerance: { maxChannelDelta: 6, meanChannelDelta: 0.5 },
    })),
  ];
}

async function startServer({ cases, scratch }) {
  const source = await readFile(sourcePath);
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
try {
  const { RemapWebGLRenderer } = await import("/web.js");
  const source = await load("/source.png");
  const measurements = [];
  for (const testCase of cases) {
    const expected = await load("/" + testCase.id + ".png");
    const renderer = new RemapWebGLRenderer();
    renderer.render(source, testCase.map ? source : undefined, testCase.spec, testCase.quality === "high");
    measurements.push({ id: testCase.id, ...compare(
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
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    ...extraArgs,
    "about:blank",
  ];
  const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
  const debugUrl = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Chrome debugging endpoint timed out: ${output}`)), 15_000);
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
  return { process: child, debugUrl: `http://${parsed.host}`, profile };
}

export async function closeChrome(browser) {
  const child = browser.process;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), unrefDelay(2_000)]);
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
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
  const deadline = Date.now() + 30_000;
  try {
    if (viewport) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false,
      });
      await send("Page.navigate", { url: viewport.url });
    }
    while (Date.now() < deadline) {
      const response = await send("Runtime.evaluate", {
        expression: "globalThis.__WORLDBEND_PARITY__ ?? null",
        returnByValue: true,
      });
      const value = response.result?.value;
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Browser did not finish Remap parity within 30 seconds");
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
