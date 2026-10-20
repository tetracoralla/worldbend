#!/usr/bin/env node
/**
 * Figma temporal project/revise verification
 * (no live Figma host). Runs the MCP unit proof and writes a summary.
 *
 * Usage:
 *   node scripts/figma-temporal-continuation-runtime-check.mjs \
 *     --evidence .worldbend-work/verification/figma-temporal-continuation
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const evidenceIdx = args.indexOf("--evidence");
if (evidenceIdx < 0 || !args[evidenceIdx + 1]) {
  console.error("Required: --evidence <dir>");
  process.exit(2);
}
const evidence = resolve(args[evidenceIdx + 1]);
mkdirSync(evidence, { recursive: true });

const filter = "temporal";
const result = spawnSync(
  "cargo",
  [
    "test",
    "-p",
    "worldbend-mcp",
    "--bin",
    "worldbend-mcp",
    filter,
    "--",
    "--nocapture",
  ],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
);
writeFileSync(resolve(evidence, "cargo-test.log"), result.stdout + result.stderr);
const match = [...result.stdout.matchAll(/test result: ok\. (\d+) passed/g)].pop();
const passedCount = match ? Number(match[1]) : 0;
const ok = result.status === 0 && passedCount >= 3;
const summary = {
  schema: "worldbend.figma.temporal-continuation-runtime@0.1",
  action: "projectTemporal+revise",
  writeTarget: "worldbend.spatial-document temporal / worldbend.mockup-video@0.1",
  liveFigmaHost: false,
  cargoStatus: result.status,
  cargoSummary: match ? match[0] : null,
  passedCount,
  honestNonClaims: [
    "Not live Figma Desktop hand-check",
    "Not Figma-hosted MP4 encode or keyframe timeline UI",
    "Not MCP mockup_video_plan / mockup_video_render",
    "Not Depth workspace motion-blur export",
    "Not document-render",
  ],
};
writeFileSync(resolve(evidence, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
if (!ok) {
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(result.status || 1);
}
console.log(JSON.stringify(summary, null, 2));
