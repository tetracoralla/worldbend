#!/usr/bin/env node
// Prepare one bounded Figma MCP call. This process itself never writes to Figma.
import { readFile, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseArgs } from "node:util";
import { build } from "vite";
import { initSync, solve_json } from "../packages/wasm/pkg-figma/worldbend_wasm.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  "file-key": { type: "string" }, "page-id": { type: "string" }, "node-id": { type: "string" },
  snapshot: { type: "string" }, spec: { type: "string" }, width: { type: "string" }, height: { type: "string" },
} });
  let call;
  let fileKey;
  let pageId;
  if (positionals.length !== 1) throw new Error("Use inspect or apply");
  if (positionals[0] === "inspect") {
    fileKey = required(values["file-key"], "file-key");
    pageId = required(values["page-id"], "page-id");
    const nodeId = required(values["node-id"], "node-id");
    call = `inspect(${JSON.stringify(nodeId)},${JSON.stringify(fileKey)},${JSON.stringify(pageId)})`;
  } else if (positionals[0] === "apply") {
    const snapshot = await readJson(required(values.snapshot, "snapshot"), 16384);
    const spec = await readJson(required(values.spec, "spec"), 4096);
    if (snapshot.schema !== "worldbend.figma.handoff" || snapshot.version !== "0.1" ||
      typeof snapshot.expected !== "string" || snapshot.expected.length > 8192) throw new Error("Invalid handoff snapshot");
    fileKey = required(snapshot.fileKey, "snapshot fileKey");
    pageId = required(snapshot.pageId, "snapshot pageId");
    const nodeId = required(snapshot.nodeId, "snapshot nodeId");
    const width = Number(values.width ?? snapshot.placement?.width);
    const height = Number(values.height ?? snapshot.placement?.height);
    if (![width, height].every((n) => Number.isFinite(n) && n >= .01 && n <= 4096) ||
      (values.width !== undefined && !Number.isSafeInteger(width)) ||
      (values.height !== undefined && !Number.isSafeInteger(height)) || spec.content?.warp) {
      throw new Error("Explicit native dimensions must be integers in 1..4096; omitted dimensions preserve the current frame. Warp is unsupported");
    }
    const renderWidth = Math.ceil(width), renderHeight = Math.ceil(height);
    initSync({ module: await readFile(path.join(root, "packages/wasm/pkg-figma/worldbend_wasm_bg.wasm")) });
    const solved = JSON.parse(solve_json(JSON.stringify(spec), renderWidth, renderHeight));
    call = `apply(${JSON.stringify({ fileKey, pageId, nodeId, expected: snapshot.expected, spec,
      inverse: solved.homography.inverse, width, height, renderWidth, renderHeight })})`;
  } else throw new Error("Use inspect or apply");
  const bundle = await build({ configFile: false, logLevel: "silent", build: {
    write: false, target: "es2020", minify: "esbuild",
    lib: { entry: path.join(root, "packages/figma/src/agent-handoff.ts"), name: "WorldbendFigmaHandoff", formats: ["iife"] },
  } });
  const output = Array.isArray(bundle) ? bundle[0].output : bundle.output;
  const runtime = output.find((entry) => entry.type === "chunk")?.code;
  if (!runtime) throw new Error("Handoff runtime did not build");
  const code = `const grantedPage=await figma.getNodeByIdAsync(${JSON.stringify(pageId)});if(!grantedPage||grantedPage.type!=="PAGE")throw Error("E_FIGMA_SCOPE");await figma.setCurrentPageAsync(grantedPage);\n${runtime}\nconst state=await WorldbendFigmaHandoff.${call};const result=await figma.getNodeByIdAsync(state.nodeId);return {...state,preview:await result.screenshot({scale:Math.min(1,1024/Math.max(state.placement.width,state.placement.height))})};`;
  const packet = { fileKey, skillNames: "figma-use", description: positionals[0] === "inspect"
    ? "Read a Worldbend editable result and its current source" : "Apply a core-validated transform to the same editable result", code };
  if (Buffer.byteLength(JSON.stringify(packet)) > 49152) throw new Error("Handoff packet exceeds 48 KiB");
  process.stdout.write(JSON.stringify(packet));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function required(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) throw new Error(`Missing or invalid ${label}`);
  return value;
}
async function readJson(file, limit) {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error(`Input must be a regular file within ${limit} bytes`);
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit) throw new Error(`Input exceeds ${limit} bytes`);
    return JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
  } finally { await handle.close(); }
}
