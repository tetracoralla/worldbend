import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasm = await import(
  new URL("../packages/wasm/pkg-figma/worldbend_wasm.js", import.meta.url)
);
const wasmBytes = await readFile(
  path.join(root, "packages", "wasm", "pkg-figma", "worldbend_wasm_bg.wasm"),
);
wasm.initSync({ module: new WebAssembly.Module(wasmBytes) });

const spec = {
  schema: "worldbend.transform",
  version: "0.1",
  destination: {
    space: "normalized",
    quad: {
      tl: { x: 0, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    },
  },
  content: { fit: "stretch" },
};

const solved = JSON.parse(wasm.solve_json(JSON.stringify(spec), 640, 480));
assert.deepEqual(solved.resolvedDestination.reference, { width: 640, height: 480 });

let cssFailure;
try {
  wasm.css_json(JSON.stringify(spec), 640, 480, 640, 480);
} catch (error) {
  cssFailure = error;
}
assert.equal(typeof cssFailure, "string", "Figma CSS closure must return structured JSON");
assert.deepEqual(JSON.parse(cssFailure), {
  code: "E_SCHEMA",
  message: "CSS embedding is not included in this carrier build",
});

process.stdout.write(
  `Figma WASM profile smoke passed (wasmBytes=${wasmBytes.length}, css=E_SCHEMA)\n`,
);
