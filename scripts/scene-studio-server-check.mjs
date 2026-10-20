// Real local API, durable core document, native media and cancellation checks.
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createSceneStudio } from "./scene-studio-server.mjs";
import { scene } from "../packages/web/examples/scene-shadow/scene.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const evidence = path.resolve(
  flag("--evidence") ?? ".worldbend-work/scene-studio-check",
);
await mkdir(evidence, { recursive: true });
const workspace = await mkdtemp(path.join(evidence, "workspace-"));
const config = {
  workspace,
  cli: path.resolve(flag("--cli") ?? "target/release/worldbend"),
  ffmpeg: flag("--ffmpeg"),
  ffprobe: flag("--ffprobe"),
};
let studio = await createSceneStudio(config),
  token;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect() {
  const html = await (await fetch(studio.url)).text();
  token = JSON.parse(
    /globalThis.studioSession=(\{[^<]+\})<\/script>/.exec(html)[1],
  ).token;
}
async function call(route, value, { raw = false, auth = true } = {}) {
  const response = await fetch(new URL(route, studio.url), {
    method: value === undefined ? "GET" : "POST",
    headers: {
      ...(auth ? { "x-worldbend-token": token } : {}),
      ...(!raw && value !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(value === undefined
      ? {}
      : { body: raw ? value : JSON.stringify(value) }),
  });
  return { status: response.status, value: await response.json() };
}
async function job(id) {
  for (let n = 0; n < 3000; n++) {
    const state = (await call("/api/jobs/" + id)).value;
    if (state.status !== "running") return state;
    await wait(20);
  }
  throw Error("Owned native job did not finish");
}
try {
  await connect();
  assert.equal(
    (await call("/api/work", undefined, { auth: false })).status,
    403,
  );
  assert.equal(
    await new Promise((resolve, reject) => {
      const req = request(
        studio.url,
        { headers: { host: "untrusted.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    }),
    403,
  );
  assert.equal(
    (
      await fetch(studio.url, {
        headers: { origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  const source = await readFile(
    path.join(root, "examples/worldbend-demo-source.png"),
  );
  const uploaded = await call("/api/asset", source, { raw: true });
  assert.equal(uploaded.status, 200);
  const sha = uploaded.value.sha;
  const motion = scene({ series: true });
  motion.planes[0].grid = { columns: 3, rows: 4 };
  motion.planes[0].measurement = { width: 21, height: 28, unit: "cm" };
  const work = {
    document: {
      schema: "worldbend.spatial-document",
      version: "0.1",
      assets: [{ id: "cover", contentVersion: sha }],
      expressions: [
        {
          kind: "temporal",
          id: "editable-edition",
          video: {
            schema: "worldbend.mockup-video",
            version: "0.1",
            backgroundRgb: [233, 229, 219],
            encoding: { format: "mp4H264", crf: 20 },
            mockupMotion: motion,
          },
          bindings: [{ role: "content", slotId: "cover", assetId: "cover" }],
        },
      ],
    },
    bindings: [
      {
        id: "cover",
        sha,
        originalSha: sha,
        fit: "contain",
        width: 600,
        height: 800,
      },
    ],
    view: { timeMs: 1200, paused: true, planeId: "cover-2" },
  };
  const first = await call("/api/save", { expectedRevision: 0, work });
  assert.equal(first.status, 200);
  assert.equal(first.value.state.revision, 1);
  const before = await readFile(path.join(workspace, "current.json"));
  assert.equal(
    (await call("/api/save", { expectedRevision: 0, work })).status,
    409,
  );
  assert.deepEqual(
    await readFile(path.join(workspace, "current.json")),
    before,
  );
  const bad = structuredClone(work);
  bad.bindings[0].sha = "0".repeat(64);
  assert.equal(
    (await call("/api/save", { expectedRevision: 1, work: bad })).status,
    400,
  );
  assert.deepEqual(
    await readFile(path.join(workspace, "current.json")),
    before,
  );
  const pending = structuredClone(work);
  pending.document.expressions[0].video.mockupMotion.planes[2].shadow.opacity = 0.4;
  const checkpoint = await call("/api/checkpoint", {
    work: pending,
    baseRevision: 1,
    generation: 1,
    instanceId: "first-client",
  });
  assert.equal(checkpoint.status, 200);
  assert.equal(
    (
      await call("/api/checkpoint", {
        work: work,
        baseRevision: 1,
        generation: 0,
        instanceId: "first-client",
        expectedToken: checkpoint.value.token,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/checkpoint", {
        work,
        baseRevision: 1,
        generation: 2,
        instanceId: "first-client",
        expectedToken: "stale",
      })
    ).status,
    409,
  );
  await studio.close();
  studio = await createSceneStudio(config);
  await connect();
  const reopened = await call("/api/work");
  assert.deepEqual(reopened.value.state.work, work);
  assert.deepEqual(reopened.value.pending.work, pending);
  assert.equal(reopened.value.pending.baseRevision, 1);
  const external = structuredClone(work);
  external.document.expressions[0].video.encoding.crf = 22;
  const updated = await call("/api/save", {
    expectedRevision: 1,
    work: external,
  });
  assert.equal(updated.status, 200);
  assert.equal(
    (
      await call("/api/checkpoint", {
        work: pending,
        baseRevision: 1,
        generation: 2,
        instanceId: "first-client",
      })
    ).status,
    409,
  );
  const copy = await call("/api/save-copy", { work: pending });
  assert.equal(copy.status, 200);
  assert.equal(
    (await call("/api/work")).value.state.work.document.expressions[0].video
      .encoding.crf,
    22,
  );
  assert.deepEqual(
    (await call("/api/work?work=" + copy.value.id)).value.state.work,
    pending,
  );
  const png = await call("/api/export", {
    work: pending,
    kind: "png",
    frame: 24,
  });
  assert.equal(png.status, 202);
  const still = await job(png.value.id);
  assert.equal(still.status, "complete", still.error);
  const pngBytes = Buffer.from(
    await (await fetch(new URL(still.url, studio.url))).arrayBuffer(),
  );
  assert(pngBytes.length > 1000);
  await writeFile(path.join(evidence, "authored-pose.png"), pngBytes);
  const submitted = await call("/api/export", {
    work: pending,
    kind: "mp4",
    frame: 0,
  });
  assert.equal(submitted.status, 202);
  const movie = await job(submitted.value.id);
  assert.equal(movie.status, "complete", movie.error);
  const movieBytes = Buffer.from(
    await (await fetch(new URL(movie.url, studio.url))).arrayBuffer(),
  );
  await writeFile(path.join(evidence, "authored-scene.mp4"), movieBytes);
  const probe = spawnSync(
    config.ffprobe,
    [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,nb_read_frames:format=duration",
      "-of",
      "json",
      path.join(evidence, "authored-scene.mp4"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(probe.status, 0);
  const facts = JSON.parse(probe.stdout);
  assert.equal(facts.streams[0].width, 960);
  assert.equal(facts.streams[0].height, 720);
  assert.equal(Number(facts.streams[0].nb_read_frames), 96);
  assert.equal(Number(facts.format.duration), 4);
  const long = structuredClone(pending);
  long.document.expressions[0].video.mockupMotion.frameCount = 240;
  for (const plane of long.document.expressions[0].video.mockupMotion.planes)
    plane.keyframes[2].frame = 239;
  const cancelling = await call("/api/export", {
    work: long,
    kind: "mp4",
    frame: 0,
  });
  assert.equal(cancelling.status, 202);
  await call("/api/jobs/" + cancelling.value.id + "/cancel", {});
  const cancelled = await job(cancelling.value.id);
  assert.equal(cancelled.status, "cancelled");
  assert(
    !(await readdir(path.join(workspace, "jobs"))).includes(
      cancelling.value.id,
    ),
  );
  const retry = await call("/api/export", {
    work: work,
    kind: "png",
    frame: 0,
  });
  assert.equal((await job(retry.value.id)).status, "complete");
  assert.equal(
    (await call("/api/work")).value.state.work.document.expressions[0].video
      .encoding.crf,
    22,
  );
  await writeFile(
    path.join(evidence, "server-result.json"),
    JSON.stringify(
      {
        ok: true,
        workspace,
        guardedSave: true,
        corruptSourceRetention: true,
        checkpointRestart: true,
        staleCheckpointRefusal: true,
        conflictCopy: true,
        nativePng: true,
        nativeMp4: facts,
        cancellationCleanup: true,
        retry: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Scene studio source API, durability, native output, cancellation and recovery passed.",
  );
} finally {
  await studio.close();
}
