// Local first-party studio carrier. Geometry/document/media semantics stay in
// the existing core/CLI. All mutable resources live in one explicit workspace.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  lstat,
  realpath,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mime = (file) =>
  file.endsWith(".js")
    ? "text/javascript"
    : file.endsWith(".wasm")
      ? "application/wasm"
      : file.endsWith(".json")
        ? "application/json"
        : file.endsWith(".png")
          ? "image/png"
          : file.endsWith(".mp4")
            ? "video/mp4"
            : "text/html";
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

export async function createSceneStudio({
  workspace,
  cli = path.join(root, "target/release/worldbend"),
  ffmpeg,
  ffprobe,
  port = 0,
} = {}) {
  if (!workspace || !ffmpeg || !ffprobe)
    throw Error("Provide a task workspace and configured encoder paths");
  await mkdir(workspace, { recursive: true });
  workspace = await realpath(workspace);
  if (!workspace.startsWith((await realpath(root)) + path.sep))
    throw Error("Studio workspace must remain in this project");
  for (const name of ["assets", "jobs", "copies"]) {
    const directory = path.join(workspace, name);
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink())
      throw Error("Studio resource directories cannot be links");
  }
  const token = randomUUID(),
    jobs = new Map(),
    commands = new Set();
  let closing = false,
    writing = false,
    exportStarting = false;
  let serial = Promise.resolve();
  const transaction = (operation) => {
    const next = serial.then(operation, operation);
    serial = next.catch(() => {});
    return next;
  };
  const validateId = (id) => {
    if (
      id !== undefined &&
      id !== null &&
      id !== "" &&
      !/^[a-f0-9-]{36}$/.test(id)
    )
      throw Error("Unknown work identity");
    return id || "";
  };
  const statePath = (id) =>
    validateId(id)
      ? path.join(workspace, "copies", id + ".json")
      : path.join(workspace, "current.json");
  const pendingPath = (id) => statePath(id) + ".pending";
  async function readState(id) {
    const file = statePath(id);
    try {
      if ((await lstat(file)).isSymbolicLink())
        throw Error("Studio work cannot be a link");
      const value = JSON.parse(await readFile(file, "utf8"));
      if (
        !Number.isSafeInteger(value.revision) ||
        value.revision < 1 ||
        !/^sha256:[a-f0-9]{64}$/.test(value.fingerprint)
      )
        throw Error("Saved work is incomplete; preserve it and reopen a copy");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async function atomic(file, value) {
    const temporary = file + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
        flag: "wx",
      });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  function command(args, onChild) {
    return new Promise((resolve, reject) => {
      if (closing) return reject(Error("Studio is closing"));
      if (commands.size >= 4)
        return reject(Error("Another studio operation is still running"));
      const child = spawn(cli, args, {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      commands.add(child);
      onChild?.(child);
      let stdout = [],
        stderr = [],
        bytes = 0;
      const collect = (target, data) => {
        bytes += data.length;
        if (bytes > 8 * 1024 * 1024) {
          child.kill("SIGTERM");
          return;
        }
        target.push(data);
      };
      child.stdout.on("data", (data) => collect(stdout, data));
      child.stderr.on("data", (data) => collect(stderr, data));
      child.once("error", reject);
      child.once("close", (code, signal) => {
        commands.delete(child);
        const output = Buffer.concat(stdout).toString("utf8"),
          errors = Buffer.concat(stderr).toString("utf8");
        if (code !== 0) {
          let message = errors || "Native execution ended: " + signal;
          try {
            message = JSON.parse(output).error?.message ?? message;
          } catch {}
          return reject(Error(message));
        }
        try {
          const value = JSON.parse(output);
          if (!value.ok) throw Error(JSON.stringify(value));
          resolve(value.result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  async function withInput(name, value, args) {
    const directory = path.join(workspace, "jobs", randomUUID());
    await mkdir(directory);
    const file = path.join(directory, name + ".json");
    await atomic(file, value);
    try {
      return await command([...args, "--spec", file, "--json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  async function validateWork(work) {
    if (
      !exact(work, ["document", "bindings", "view"]) ||
      !work.document ||
      !Array.isArray(work.bindings) ||
      work.bindings.length < 1 ||
      work.bindings.length > 16
    )
      throw Error("Use a complete Spatial Document and source bindings");
    const inspection = await withInput("document", work.document, [
      "document-inspect",
    ]);
    if (
      work.document.expressions.length !== 1 ||
      work.document.expressions[0].kind !== "temporal"
    )
      throw Error("This studio receives one temporal scene");
    const expression = work.document.expressions[0],
      ids = new Set();
    for (const binding of work.bindings) {
      if (
        !exact(binding, [
          "id",
          "sha",
          "originalSha",
          "fit",
          "width",
          "height",
        ]) ||
        typeof binding.id !== "string" ||
        ids.has(binding.id) ||
        !/^([a-f0-9]{64})$/.test(binding.sha) ||
        (binding.originalSha !== undefined &&
          !/^[a-f0-9]{64}$/.test(binding.originalSha)) ||
        ![binding.width, binding.height].every(
          (n) => Number.isSafeInteger(n) && n > 0 && n <= 8192,
        ) ||
        !["contain", "cover"].includes(binding.fit)
      )
        throw Error("Invalid source binding");
      ids.add(binding.id);
      for (const sha of new Set(
        [binding.sha, binding.originalSha].filter(Boolean),
      )) {
        const file = path.join(workspace, "assets", sha + ".png");
        if (
          !(await lstat(file)).isFile() ||
          digest(await readFile(file)) !== sha
        )
          throw Error("Source bytes changed; import the artwork again");
      }
    }
    const sourceIds = [
      ...new Set(expression.video.mockupMotion.planes.map((p) => p.sourceId)),
    ];
    if (sourceIds.length !== ids.size || sourceIds.some((id) => !ids.has(id)))
      throw Error("Source bindings do not match the scene");
    if (
      expression.bindings.length !== ids.size ||
      expression.bindings.some(
        (b) =>
          b.role !== "content" || b.assetId !== b.slotId || !ids.has(b.slotId),
      )
    )
      throw Error("Keep exact scene asset identities");
    for (const asset of work.document.assets) {
      const binding = work.bindings.find((b) => b.id === asset.id);
      if (!binding || asset.contentVersion !== binding.sha)
        throw Error("Asset version does not match its registered image");
    }
    if (
      work.view !== undefined &&
      (!exact(work.view, ["timeMs", "paused", "planeId"]) ||
        !Number.isFinite(work.view.timeMs) ||
        work.view.timeMs < 0 ||
        typeof work.view.paused !== "boolean" ||
        !expression.video.mockupMotion.planes.some(
          (p) => p.id === work.view.planeId,
        ))
    )
      throw Error("Invalid authoring view");
    return inspection;
  }
  async function body(req, max = 4 * 1024 * 1024) {
    const chunks = [];
    let bytes = 0;
    for await (const data of req) {
      bytes += data.length;
      if (bytes > max)
        throw Error("Request exceeds the admitted source/work size");
      chunks.push(data);
    }
    return Buffer.concat(chunks);
  }
  function json(res, status, value) {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  }
  function authorize(req, url) {
    return (
      req.headers["x-worldbend-token"] === token ||
      url.searchParams.get("token") === token
    );
  }
  async function serveBytes(req, res, file) {
    const bytes = await readFile(file);
    res.setHeader("content-type", mime(file));
    res.setHeader("accept-ranges", "bytes");
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const start = Number(range[1]),
        end = Math.min(
          bytes.length - 1,
          range[2] ? Number(range[2]) : bytes.length - 1,
        );
      if (start > end || start >= bytes.length) {
        res.writeHead(416, { "content-range": "bytes */" + bytes.length });
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader(
        "content-range",
        "bytes " + start + "-" + end + "/" + bytes.length,
      );
      res.setHeader("content-length", end - start + 1);
      res.end(bytes.subarray(start, end + 1));
      return;
    }
    res.setHeader("content-length", bytes.length);
    res.end(bytes);
  }
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (
        host !== "127.0.0.1:" + server.address().port ||
        (req.headers.origin && req.headers.origin !== "http://" + host)
      ) {
        json(res, 403, {
          error: "This request is outside the local studio origin",
        });
        return;
      }
      const url = new URL(req.url, "http://" + host);
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader("x-content-type-options", "nosniff");
      if (url.pathname === "/") {
        let html = await readFile(
          path.join(root, "packages/web/examples/scene-studio/index.html"),
          "utf8",
        );
        html = html.replace(
          "<!--studio-session-->",
          "<script>globalThis.studioSession=" +
            JSON.stringify({ token }) +
            "</script>",
        );
        res.setHeader("content-type", "text/html");
        res.end(html);
        return;
      }
      if (url.pathname.startsWith("/packages/web/")) {
        const file = path.resolve(root, "." + url.pathname);
        if (
          !file.startsWith(path.join(root, "packages/web") + path.sep) ||
          ![".js", ".wasm", ".json", ".html"].includes(path.extname(file))
        )
          throw Error("Unknown studio resource");
        await serveBytes(req, res, file);
        return;
      }
      if (!authorize(req, url)) {
        json(res, 403, {
          error: "This studio session does not grant that action",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/work") {
        const id = validateId(url.searchParams.get("work"));
        let pending = null;
        try {
          const file = pendingPath(id);
          if ((await lstat(file)).isSymbolicLink())
            throw Error("Draft cannot be a link");
          pending = JSON.parse(await readFile(file, "utf8"));
          pending.token = digest(Buffer.from(JSON.stringify(pending)));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        json(res, 200, { state: await readState(id), pending });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/asset") {
        const bytes = await body(req, 64 * 1024 * 1024);
        if (
          bytes.length < 24 ||
          !bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          throw Error("Import a PNG image");
        if (
          bytes.subarray(12, 16).toString() !== "IHDR" ||
          bytes.readUInt32BE(16) < 1 ||
          bytes.readUInt32BE(20) < 1 ||
          bytes.readUInt32BE(16) > 8192 ||
          bytes.readUInt32BE(20) > 8192 ||
          bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 64 * 1024 * 1024
        )
          throw Error("Artwork exceeds the admitted image size");
        const sha = digest(bytes),
          file = path.join(workspace, "assets", sha + ".png");
        try {
          await writeFile(file, bytes, { flag: "wx" });
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (
            !(await lstat(file)).isFile() ||
            digest(await readFile(file)) !== sha
          )
            throw Error("Registered source bytes do not match");
        }
        json(res, 200, { sha });
        return;
      }
      if (
        req.method === "GET" &&
        /^\/assets\/[a-f0-9]{64}\.png$/.test(url.pathname)
      ) {
        await serveBytes(
          req,
          res,
          path.join(workspace, "assets", path.basename(url.pathname)),
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/save") {
        const input = JSON.parse((await body(req)).toString("utf8"));
        await transaction(async () => {
          writing = true;
          try {
            if (!exact(input, ["expectedRevision", "work", "workId"]))
              throw Error("Invalid save");
            const id = validateId(input.workId),
              current = await readState(id);
            if (input.expectedRevision !== (current?.revision ?? 0)) {
              json(res, 409, {
                error: "Saved work changed; reload before replacing it",
              });
              return;
            }
            const inspection = await validateWork(input.work);
            const state = {
              revision: (current?.revision ?? 0) + 1,
              fingerprint: inspection.fingerprint,
              work: input.work,
            };
            await atomic(statePath(id), state);
            await rm(pendingPath(id), { force: true });
            json(res, 200, { state });
          } finally {
            writing = false;
          }
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/checkpoint") {
        const input = JSON.parse((await body(req)).toString("utf8"));
        await transaction(async () => {
          if (
            !exact(input, [
              "work",
              "workId",
              "baseRevision",
              "generation",
              "instanceId",
              "expectedToken",
            ]) ||
            !Number.isSafeInteger(input.generation) ||
            input.generation < 1 ||
            typeof input.instanceId !== "string"
          )
            throw Error("Invalid draft checkpoint");
          const id = validateId(input.workId),
            current = await readState(id);
          if (input.baseRevision !== (current?.revision ?? 0)) {
            json(res, 409, {
              error: "Saved work changed; keep these edits as a copy",
            });
            return;
          }
          let previous;
          try {
            previous = JSON.parse(await readFile(pendingPath(id), "utf8"));
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          if (previous) {
            const expected = digest(Buffer.from(JSON.stringify(previous)));
            if (
              input.expectedToken !== expected ||
              (previous.instanceId === input.instanceId &&
                previous.generation >= input.generation)
            ) {
              json(res, 409, {
                error: "Another draft arrived; keep these edits as a copy",
              });
              return;
            }
          }
          const inspection = await validateWork(input.work),
            record = {
              work: input.work,
              baseRevision: input.baseRevision,
              generation: input.generation,
              instanceId: input.instanceId,
              fingerprint: inspection.fingerprint,
            };
          await atomic(pendingPath(id), record);
          json(res, 200, {
            token: digest(Buffer.from(JSON.stringify(record))),
            generation: record.generation,
          });
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/save-copy") {
        const input = JSON.parse((await body(req)).toString("utf8"));
        if (!exact(input, ["work"])) throw Error("Invalid work copy");
        const inspection = await validateWork(input.work),
          id = randomUUID(),
          state = {
            revision: 1,
            fingerprint: inspection.fingerprint,
            work: input.work,
          };
        await atomic(statePath(id), state);
        json(res, 200, { id, state });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/export") {
        if (
          exportStarting ||
          [...jobs.values()].some((job) => job.status === "running")
        ) {
          json(res, 409, { error: "An export is already running" });
          return;
        }
        exportStarting = true;
        try {
          const input = JSON.parse((await body(req)).toString("utf8"));
          if (
            !exact(input, ["work", "kind", "frame"]) ||
            !["png", "mp4"].includes(input.kind)
          )
            throw Error("Invalid export");
          await validateWork(input.work);
          const spec = input.work.document.expressions[0].video,
            id = randomUUID(),
            directory = path.join(workspace, "jobs", id);
          await mkdir(directory);
          const job = {
            id,
            status: "running",
            kind: input.kind,
            cancelled: false,
            child: undefined,
          };
          jobs.set(id, job);
          const run = async () => {
            try {
              const sources = input.work.bindings.flatMap((binding) => [
                "--source",
                binding.id +
                  "=" +
                  path.join(workspace, "assets", binding.sha + ".png"),
              ]);
              let output;
              if (input.kind === "mp4") {
                await atomic(path.join(directory, "video.json"), spec);
                output = await command(
                  [
                    "mockup-video-render",
                    ...sources,
                    "--spec",
                    path.join(directory, "video.json"),
                    "--output",
                    path.join(directory, "output.mp4"),
                    "--ffmpeg",
                    ffmpeg,
                    "--ffprobe",
                    ffprobe,
                    "--json",
                  ],
                  (child) => {
                    job.child = child;
                    if (job.cancelled) child.kill("SIGTERM");
                  },
                );
              } else {
                if (
                  !Number.isSafeInteger(input.frame) ||
                  input.frame < 0 ||
                  input.frame >= spec.mockupMotion.frameCount
                )
                  throw Error("Choose a frame inside the scene");
                await atomic(path.join(directory, "video.json"), spec);
                const plan = await command([
                  "mockup-video-inspect",
                  "--spec",
                  path.join(directory, "video.json"),
                  "--json",
                ]);
                await atomic(
                  path.join(directory, "still.json"),
                  plan.mockupMotion.frameSpecs[input.frame],
                );
                if (job.cancelled) throw Error("Export cancelled");
                output = await command(
                  [
                    "mockup-render",
                    ...sources,
                    "--spec",
                    path.join(directory, "still.json"),
                    "--output",
                    path.join(directory, "output.png"),
                    "--json",
                  ],
                  (child) => {
                    job.child = child;
                    if (job.cancelled) child.kill("SIGTERM");
                  },
                );
              }
              if (job.cancelled) throw Error("Export cancelled");
              const evidenceSources =
                input.kind === "mp4" ? output.sources : output.evidence.sources;
              for (const source of evidenceSources) {
                if (
                  input.work.bindings.find((b) => b.id === source.sourceId)
                    ?.sha !== source.sourceSha256
                )
                  throw Error("Source changed during export");
              }
              job.status = "complete";
              job.result = output;
              job.url =
                "/media/" +
                id +
                "." +
                input.kind +
                "?token=" +
                encodeURIComponent(token);
            } catch (error) {
              job.status = job.cancelled ? "cancelled" : "failed";
              job.error = error.message;
              await rm(directory, { recursive: true, force: true });
            } finally {
              job.child = undefined;
            }
          };
          job.promise = run();
          json(res, 202, { id, status: "running" });
          return;
        } finally {
          exportStarting = false;
        }
      }
      const jobMatch = /^\/api\/jobs\/([a-f0-9-]{36})(\/cancel)?$/.exec(
        url.pathname,
      );
      if (jobMatch) {
        const job = jobs.get(jobMatch[1]);
        if (!job) throw Error("Unknown export");
        if (req.method === "POST" && jobMatch[2]) {
          if (job.status === "running") {
            job.cancelled = true;
            job.child?.kill("SIGTERM");
          }
          json(res, 200, { status: job.status });
          return;
        }
        if (req.method === "GET") {
          const { promise, child, ...summary } = job;
          json(res, 200, summary);
          return;
        }
      }
      const media = /^\/media\/([a-f0-9-]{36})\.(png|mp4)$/.exec(url.pathname);
      if (req.method === "GET" && media) {
        const job = jobs.get(media[1]);
        if (!job || job.status !== "complete" || job.kind !== media[2])
          throw Error("Export is not ready");
        await serveBytes(
          req,
          res,
          path.join(workspace, "jobs", job.id, "output." + job.kind),
        );
        return;
      }
      json(res, 404, { error: "Unknown studio action" });
    } catch (error) {
      if (!res.headersSent)
        json(res, 400, {
          error:
            error.code === "ENOENT"
              ? "This source is unavailable; import it again"
              : error.message,
        });
      else res.destroy(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: "http://127.0.0.1:" + server.address().port + "/",
    workspace,
    async close() {
      closing = true;
      for (const job of jobs.values())
        if (job.status === "running") {
          job.cancelled = true;
          job.child?.kill("SIGTERM");
        }
      await serial;
      for (const child of commands) child.kill("SIGTERM");
      await Promise.allSettled([...jobs.values()].map((job) => job.promise));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const flag = (name) => {
    const i = process.argv.indexOf(name);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const studio = await createSceneStudio({
    workspace: path.resolve(flag("--workspace") ?? ".task-notes/scene-studio"),
    cli: flag("--cli") ? path.resolve(flag("--cli")) : undefined,
    ffmpeg: flag("--ffmpeg"),
    ffprobe: flag("--ffprobe"),
    port: Number(flag("--port") ?? 0),
  });
  process.stdout.write(studio.url + "\n");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void studio.close().then(() => process.exit(0));
    });
}
