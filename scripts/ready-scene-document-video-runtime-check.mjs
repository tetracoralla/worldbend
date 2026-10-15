#!/usr/bin/env node
/**
 * Development runtime: ready-scene rasters through a temporal
 * Spatial Document — inspect → revise → stills+MP4 revision loop.
 *
 *   cargo build --release -p worldbend-cli
 *   node scripts/ready-scene-document-video-runtime-check.mjs \
 *     --ffmpeg /abs/ffmpeg --ffprobe /abs/ffprobe \
 *     --evidence .task-notes/ready-scene-video-check
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const ffmpeg = flag("--ffmpeg");
const ffprobe = flag("--ffprobe");
const evidence = resolve(
  flag("--evidence", join(root, ".task-notes/ready-scene-video-check")),
);
const cli = flag("--cli", join(root, "target/release/worldbend"));
if (!ffmpeg || !ffprobe) {
  console.error("require --ffmpeg and --ffprobe absolute paths");
  process.exit(2);
}
if (!existsSync(cli)) {
  console.error(`missing CLI ${cli}; build with cargo build --release -p worldbend-cli`);
  process.exit(2);
}

mkdirSync(evidence, { recursive: true });
mkdirSync(join(evidence, "v1"), { recursive: true });
mkdirSync(join(evidence, "v2"), { recursive: true });

const rasters = join(root, "examples/ready-scene-rasters");
const paths = {
  "hanging-fabric": join(rasters, "hanging-fabric.png"),
  "carton-label": join(rasters, "carton-label.png"),
  "studio-poster": join(rasters, "studio-poster.png"),
  "desktop-screen": join(rasters, "desktop-screen.png"),
  "studio-can": join(rasters, "studio-can.png"),
};
for (const [id, p] of Object.entries(paths)) {
  if (!existsSync(p)) {
    console.error(`missing ready-scene raster ${id}: ${p}`);
    process.exit(2);
  }
  copyFileSync(p, join(evidence, `${id}.png`));
}

const docPath = join(root, "examples/ready-scene-document-video.worldbend.json");
const deliveryPath = join(root, "examples/ready-scene-document-video-delivery.worldbend.json");
const updatePath = join(root, "examples/ready-scene-document-video-update.worldbend.json");

function run(bin, argv) {
  const result = spawnSync(bin, argv, { encoding: "utf8", maxBuffer: 32 << 20 });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function digest(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function encodePass({ label, outDir, sourceMap, videoSpecPath }) {
  const movie = join(outDir, `${label}.mp4`);
  const sourceArgs = [];
  for (const [id, file] of Object.entries(sourceMap)) {
    sourceArgs.push("--source", `${id}=${file}`);
  }
  const rendered = JSON.parse(
    run(cli, [
      "mockup-video-render",
      ...sourceArgs,
      "--spec",
      videoSpecPath,
      "--output",
      movie,
      "--ffmpeg",
      ffmpeg,
      "--ffprobe",
      ffprobe,
      "--json",
    ]),
  );
  if (!rendered.ok) throw new Error(`${label} render failed`);
  writeFileSync(join(outDir, "result.json"), JSON.stringify(rendered, null, 2));
  for (const [still, seconds] of [
    ["still-000", "0"],
    ["still-mid", "0.5"],
    ["still-last", "0.966"],
  ]) {
    run(ffmpeg, ["-y", "-ss", seconds, "-i", movie, "-frames:v", "1", join(outDir, `${still}.png`)]);
  }
  return {
    movieSha256: digest(movie),
    movieBytes: readFileSync(movie).length,
    decodedFrameCount: rendered.result.decodedFrameCount,
    rasterFrameCount: rendered.result.frames.length,
    stills: {
      "still-000.png": digest(join(outDir, "still-000.png")),
      "still-mid.png": digest(join(outDir, "still-mid.png")),
      "still-last.png": digest(join(outDir, "still-last.png")),
    },
  };
}

const inspected = JSON.parse(run(cli, ["document-inspect", "--spec", docPath, "--json"]));
if (!inspected.ok) throw new Error("document-inspect failed");
writeFileSync(join(evidence, "inspect-v1.json"), JSON.stringify(inspected, null, 2));

const delivery = JSON.parse(
  run(cli, ["document-delivery-plan", "--spec", deliveryPath, "--json"]),
);
if (!delivery.ok) throw new Error("document-delivery-plan failed");
writeFileSync(join(evidence, "delivery-v1.json"), JSON.stringify(delivery, null, 2));
const temporal = delivery.result.deliveries.find((d) => d.id === "ready-scene-showcase-video");
if (!temporal || temporal.kind !== "temporal") throw new Error("missing temporal delivery");
const videoSpecV1 = join(evidence, "video-spec-v1.worldbend.json");
writeFileSync(videoSpecV1, JSON.stringify(temporal.video, null, 2));

const v1 = encodePass({
  label: "ready-scene-v1",
  outDir: join(evidence, "v1"),
  sourceMap: {
    "hanging-fabric": paths["hanging-fabric"],
    "carton-label": paths["carton-label"],
  },
  videoSpecPath: videoSpecV1,
});

const updated = JSON.parse(run(cli, ["document-update-plan", "--spec", updatePath, "--json"]));
if (!updated.ok) throw new Error("document-update-plan failed");
writeFileSync(join(evidence, "update-plan.json"), JSON.stringify(updated, null, 2));
const revisedDoc = updated.result.document;
if (!revisedDoc) throw new Error("update produced no document");
const revisedDocPath = join(evidence, "document-v2.worldbend.json");
writeFileSync(revisedDocPath, JSON.stringify(revisedDoc, null, 2));

const inspectV2 = JSON.parse(run(cli, ["document-inspect", "--spec", revisedDocPath, "--json"]));
if (!inspectV2.ok) throw new Error("document-inspect v2 failed");
writeFileSync(join(evidence, "inspect-v2.json"), JSON.stringify(inspectV2, null, 2));

const deliveryV2Input = join(evidence, "delivery-v2-input.worldbend.json");
writeFileSync(
  deliveryV2Input,
  JSON.stringify({ document: revisedDoc, expressionIds: ["ready-scene-showcase-video"] }, null, 2),
);
const deliveryV2 = JSON.parse(
  run(cli, ["document-delivery-plan", "--spec", deliveryV2Input, "--json"]),
);
if (!deliveryV2.ok) throw new Error("document-delivery-plan v2 failed");
writeFileSync(join(evidence, "delivery-v2.json"), JSON.stringify(deliveryV2, null, 2));
const temporalV2 = deliveryV2.result.deliveries.find((d) => d.id === "ready-scene-showcase-video");
const videoSpecV2 = join(evidence, "video-spec-v2.worldbend.json");
writeFileSync(videoSpecV2, JSON.stringify(temporalV2.video, null, 2));

// Carrier resolves revised carton-label identity to studio-poster.png (distinct N2 raster).
const v2 = encodePass({
  label: "ready-scene-v2",
  outDir: join(evidence, "v2"),
  sourceMap: {
    "hanging-fabric": paths["hanging-fabric"],
    "carton-label": paths["studio-poster"],
  },
  videoSpecPath: videoSpecV2,
});

const exprV1 = inspected.result.expressions[0];
const exprV2 = inspectV2.result.expressions[0];
const summary = {
  assetsV1: inspected.result.assets,
  assetsV2: inspectV2.result.assets,
  documentFingerprintV1: inspected.result.fingerprint,
  documentFingerprintV2: inspectV2.result.fingerprint,
  videoFingerprintV1: exprV1.videoFingerprint,
  videoFingerprintV2: exprV2.videoFingerprint,
  sourceIds: exprV1.sourceIds,
  revision: {
    assetId: "carton-label",
    from: "n2-ready-v1",
    to: "n2-ready-v2",
    changed: updated.result.revisions?.[0]?.changed ?? null,
    affectedExpressions: updated.result.affectedExpressions,
  },
  rasters: Object.fromEntries(
    Object.entries(paths).map(([id, p]) => [id, { path: `examples/ready-scene-rasters/${id}.png`, sha256: digest(p) }]),
  ),
  encodeV1: v1,
  encodeV2: v2,
  movieChanged: v1.movieSha256 !== v2.movieSha256,
  documentFingerprintChanged: inspected.result.fingerprint !== inspectV2.result.fingerprint,
  // Geometry Spec unchanged by contentVersion-only revision — videoFingerprint
  // stays equal while carrier-resolved raster bytes change the movie.
  videoFingerprintUnchangedByAssetRevision:
    exprV1.videoFingerprint === exprV2.videoFingerprint,
  cli,
  ffmpeg,
  ffprobe,
};

if (!summary.movieChanged) throw new Error("expected revised raster to change movie digest");
if (!summary.documentFingerprintChanged) {
  throw new Error("expected asset revision to change document fingerprint");
}
if (!summary.videoFingerprintUnchangedByAssetRevision) {
  throw new Error("contentVersion-only revision must not change mockup-video Spec fingerprint");
}

writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ok: true, summary }, null, 2));
