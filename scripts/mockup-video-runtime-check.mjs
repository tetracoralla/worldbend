#!/usr/bin/env node
/**
 * Development runtime for mockup-video.
 *   cargo build --release -p worldbend-cli
 *   node scripts/mockup-video-runtime-check.mjs \
 *     --ffmpeg /abs/ffmpeg --ffprobe /abs/ffprobe \
 *     --evidence .task-notes/mockup-video-check
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  flag("--evidence", join(root, ".task-notes/mockup-video-check")),
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

function solidPng(path, w, h, rgb) {
  const py = `
import struct, zlib, sys
w, h = ${w}, ${h}
r, g, b = ${rgb[0]}, ${rgb[1]}, ${rgb[2]}
rows = []
for y in range(h):
    row = bytearray([0])
    for x in range(w):
        row += bytes((min(255, r + (x * 40)//w), min(255, g + (y * 30)//h), b, 255))
    rows.append(bytes(row))
raw = b"".join(rows)
def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
png = b"\\x89PNG\\r\\n\\x1a\\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
`;
  const result = spawnSync("python3", ["-c", py, path], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
}

const backdrop = join(evidence, "backdrop.png");
const device = join(evidence, "device.png");
solidPng(backdrop, 320, 240, [40, 60, 90]);
solidPng(device, 200, 280, [220, 220, 230]);

const specPath = join(root, "examples/device-scene-video.worldbend.json");
function run(bin, argv) {
  const result = spawnSync(bin, argv, { encoding: "utf8", maxBuffer: 16 << 20 });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const planned = JSON.parse(run(cli, ["mockup-video-inspect", "--spec", specPath, "--json"]));
if (!planned.ok) throw new Error("inspect failed");
writeFileSync(join(evidence, "plan.json"), JSON.stringify(planned, null, 2));

const movie = join(evidence, "device-scene.mp4");
const rendered = JSON.parse(
  run(cli, [
    "mockup-video-render",
    "--source",
    `backdrop=${backdrop}`,
    "--source",
    `device=${device}`,
    "--spec",
    specPath,
    "--output",
    movie,
    "--ffmpeg",
    ffmpeg,
    "--ffprobe",
    ffprobe,
    "--json",
  ]),
);
if (!rendered.ok) throw new Error("render failed");
writeFileSync(join(evidence, "result.json"), JSON.stringify(rendered, null, 2));

for (const [label, seconds] of [
  ["still-000", "0"],
  ["still-mid", "0.5"],
  ["still-last", "0.966"],
]) {
  const out = join(evidence, `${label}.png`);
  run(ffmpeg, ["-y", "-ss", seconds, "-i", movie, "-frames:v", "1", out]);
}

const digest = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const summary = {
  planDuration: planned.result.duration,
  sourceIds: planned.result.mockupMotion.sourceIds,
  frameCount: planned.result.mockupMotion.frames.length,
  movieSha256: digest(movie),
  movieBytes: readFileSync(movie).length,
  stills: {
    "still-000.png": digest(join(evidence, "still-000.png")),
    "still-mid.png": digest(join(evidence, "still-mid.png")),
    "still-last.png": digest(join(evidence, "still-last.png")),
  },
  decodedFrameCount: rendered.result.decodedFrameCount,
  rasterFrameCount: rendered.result.frames.length,
  cli,
  ffmpeg,
  ffprobe,
};
writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ok: true, summary }, null, 2));
