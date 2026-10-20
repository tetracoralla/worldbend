import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseOptions(process.argv.slice(2));
const wasm = await import(
  new URL("../packages/wasm/pkg/worldbend_wasm.js", import.meta.url)
);
const wasmBytes = await readFile(
  path.join(root, "packages", "wasm", "pkg", "worldbend_wasm_bg.wasm"),
);
wasm.initSync({ module: new WebAssembly.Module(wasmBytes) });

const spec = {
  schema: "worldbend.transform",
  version: "0.1",
  destination: {
    space: "normalized",
    quad: {
      tl: { x: 0.04, y: 0.03 },
      tr: { x: 0.96, y: 0.08 },
      br: { x: 0.9, y: 0.94 },
      bl: { x: 0.08, y: 0.9 },
    },
  },
  content: { fit: "stretch" },
};
const transform = {
  scale: { x: 1.2, y: 0.92 },
  rotationDegrees: 17.5,
  skew: { xDegrees: 8, yDegrees: -4 },
  translation: { x: 37.25, y: -19.5 },
  pivot: { x: 0.25, y: 0.75 },
  flip: { x: true, y: false },
};
const targetSize = { width: 1440, height: 900 };

function composeRaw() {
  return wasm.compose_json(
    JSON.stringify(spec),
    JSON.stringify(transform),
    targetSize.width,
    targetSize.height,
  );
}

function composeRoundTrip() {
  return JSON.parse(composeRaw());
}

function previewFrameRoundTrip() {
  const composition = composeRoundTrip();
  return JSON.parse(
    wasm.solve_json(
      JSON.stringify(composition.spec),
      composition.canvas.size.width,
      composition.canvas.size.height,
    ),
  );
}

const warpedSpec = {
  ...spec,
  content: { fit: "stretch", warp: { preset: "arc", amount: 0.75 } },
};

function warpMeshRaw() {
  return wasm.warp_mesh_json(JSON.stringify(warpedSpec.content.warp));
}

function warpMeshRoundTrip() {
  return JSON.parse(warpMeshRaw());
}

const referenceRaw = composeRaw();
const reference = JSON.parse(referenceRaw);
assert.deepEqual(
  Object.keys(reference).sort(),
  ["canvas", "diagnostics", "matrix", "rawBounds", "rawQuad", "spec"].sort(),
  "compose benchmark no longer exercises the full six-artifact result",
);
assert.equal(reference.spec.content.orientation, "flipHorizontal");
// Benchmark integrity: timings over stable-but-numerically-wrong output would
// measure the wrong kernel. Pin finiteness and structural sanity of the
// reference composition and of the solve half of the preview frame.
assert.ok(
  reference.matrix.every((value) => Number.isFinite(value)),
  "compose matrix contains non-finite values",
);
assert.ok(reference.matrix[0] !== 0 && reference.matrix[4] !== 0, "compose matrix is degenerate");
for (const corner of Object.values(reference.rawQuad)) {
  assert.ok(Number.isFinite(corner.x) && Number.isFinite(corner.y), "rawQuad is not finite");
}
assert.ok(
  Number.isFinite(reference.canvas.size.width) && reference.canvas.size.width > 0,
  "canvas width must be a positive finite number",
);
assert.ok(
  Number.isFinite(reference.canvas.size.height) && reference.canvas.size.height > 0,
  "canvas height must be a positive finite number",
);
const referenceFrame = previewFrameRoundTrip();
assert.equal(referenceFrame.spec.schema, "worldbend.transform");
assert.ok(
  referenceFrame.homography.matrix.every((value) => Number.isFinite(value)),
  "preview-frame solve matrix contains non-finite values",
);
assert.ok(
  referenceFrame.diagnostics.reprojection.max <= referenceFrame.diagnostics.reprojection.limit,
  "preview-frame solve exceeds its own reprojection limit",
);
const referenceWarpRaw = warpMeshRaw();
const referenceWarp = JSON.parse(referenceWarpRaw);
assert.equal(referenceWarp.subdivisions, 16);
assert.equal(referenceWarp.vertices.length, 17 * 17);
assert.deepEqual(referenceWarp.vertices[8 * 17 + 8].source, { x: 0.5, y: 0.5 });
for (let index = 0; index < Math.min(options.iterations, 2_000); index += 1) {
  assert.equal(composeRaw(), referenceRaw, "repeated WASM compose output drifted");
  assert.equal(warpMeshRaw(), referenceWarpRaw, "repeated WASM Warp mesh output drifted");
}

const metrics = [
  measure("jsonParse", () => JSON.parse(referenceRaw), options),
  measure("composeRoundTrip", composeRoundTrip, options),
  measure("previewFrameRoundTrip", previewFrameRoundTrip, options),
  measure("warpMeshRoundTrip", warpMeshRoundTrip, options),
];

const report = {
  kind: "worldbend.performance-observation.v1",
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    wasmBytes: wasmBytes.length,
  },
  method: {
    clock: "process.hrtime.bigint",
    iterations: options.iterations,
    warmup: options.warmup,
    realWasm: true,
    timingGate: false,
  },
  metrics,
};

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `Worldbend real-WASM performance observation (${options.iterations} iterations, ${options.warmup} warmup)`,
  );
  for (const metric of metrics) {
    console.log(
      `${metric.name}: mean=${metric.meanMicroseconds.toFixed(2)}us ` +
        `p50=${metric.p50Microseconds.toFixed(2)}us ` +
        `p95=${metric.p95Microseconds.toFixed(2)}us ` +
        `p99=${metric.p99Microseconds.toFixed(2)}us ` +
        `throughput=${metric.operationsPerSecond.toFixed(0)}/s ` +
        `rssDelta=${formatBytes(metric.rssDeltaBytes)}`,
    );
  }
  console.log("Timing is observational; no SLO or regression threshold is asserted.");
}

function measure(name, operation, { iterations, warmup }) {
  for (let index = 0; index < warmup; index += 1) operation();
  globalThis.gc?.();
  const rssBefore = process.memoryUsage().rss;
  const samples = new Float64Array(iterations);
  const started = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) {
    const itemStarted = process.hrtime.bigint();
    operation();
    samples[index] = Number(process.hrtime.bigint() - itemStarted) / 1_000;
  }
  const elapsedNanoseconds = Number(process.hrtime.bigint() - started);
  globalThis.gc?.();
  const rssAfter = process.memoryUsage().rss;
  const sorted = Array.from(samples).sort((left, right) => left - right);
  const totalMicroseconds = sorted.reduce((sum, value) => sum + value, 0);
  return {
    name,
    iterations,
    meanMicroseconds: totalMicroseconds / iterations,
    p50Microseconds: percentile(sorted, 0.5),
    p95Microseconds: percentile(sorted, 0.95),
    p99Microseconds: percentile(sorted, 0.99),
    maxMicroseconds: sorted.at(-1),
    operationsPerSecond: (iterations * 1_000_000_000) / elapsedNanoseconds,
    rssDeltaBytes: rssAfter - rssBefore,
  };
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function parseOptions(arguments_) {
  let iterations = 20_000;
  let warmup = 2_000;
  let json = false;
  for (const argument of arguments_) {
    if (argument === "--") {
      continue;
    } else if (argument === "--json") {
      json = true;
    } else if (argument.startsWith("--iterations=")) {
      iterations = positiveInteger(argument.slice("--iterations=".length), "iterations");
    } else if (argument.startsWith("--warmup=")) {
      warmup = positiveInteger(argument.slice("--warmup=".length), "warmup");
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { iterations, warmup, json };
}

function positiveInteger(raw, name) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
    throw new Error(`${name} must be an integer between 1 and 1000000`);
  }
  return value;
}

function formatBytes(value) {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${(Math.abs(value) / (1024 * 1024)).toFixed(2)}MiB`;
}
