import {createQaHttpFailureBoundary} from "./qa-http-failure-boundary.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  findChrome,
  launchChrome,
  closeChrome,
  createPage,
  readPageResult,
} from "./remap-native-webgl-parity.mjs";
const httpFailures=createQaHttpFailureBoundary("scene-three-receiving-check.mjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const example = path.join(root, "packages/scene-three/examples/paper-stage");
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const evidence = path.resolve(
  flag("--evidence") ?? path.join(root, ".task-notes/scene-three-receiving"),
);
await mkdir(path.join(evidence, "frames"), { recursive: true });
const docs = {};
for (const id of ["initial", "cover", "source", "timed"])
  docs[id] = JSON.parse(
    await readFile(path.join(example, id + ".json"), "utf8"),
  );
const selectedRecord = flag('--export-record');
if(selectedRecord){if(!['initial','cover','source','timed'].includes(selectedRecord))throw Error('Unknown source record');docs.exportDocument=docs[selectedRecord].document;}
const threeRoot = path.join(root, "packages/scene-three/node_modules/three");
const imports = {
  three: "/three/build/three.module.js",
  "three/addons/": "/three/examples/jsm/",
  "@worldbend/web": "/web/index.js",
  "@worldbend/web/spatial-document": "/web/spatial-document.js",
};
const html = `<!doctype html><style>body{margin:0;background:#ded8c1}#stage{width:960px}</style><div id="stage"></div><script type="importmap">${JSON.stringify({ imports })}</script><script type="module" src="/receiving.js"></script>`;
const mime = (p) =>
  p.endsWith(".js")
    ? "text/javascript"
    : p.endsWith(".json")
      ? "application/json"
      : p.endsWith(".png")
        ? "image/png"
        : "application/octet-stream";
const server = createServer(async (req, res) => {
  try {
    const route = new URL(req.url, "http://localhost").pathname;
    const frame = /^\/frame\/(\d{1,3})$/.exec(route);
    if (req.method === "POST" && frame) {
      const n = Number(frame[1]);
      if (n >= 240) throw Error("Invalid frame");
      const parts = [];
      let length = 0;
      for await (const part of req) {
        length += part.length;
        if (length > 16 * 1024 * 1024) throw Error("Excessive frame");
        parts.push(part);
      }
      await writeFile(
        path.join(evidence, "frames", String(n).padStart(4, "0") + ".png"),
        Buffer.concat(parts),
      );
      res.writeHead(200);
      res.end();
      return;
    }
    let body, type;
    if (route === "/") {
      body = html;
      type = "text/html";
    } else if (route === "/docs.json") {
      body = JSON.stringify(docs);
      type = "application/json";
    } else if (route === "/asset-index.json") {
      body = await readFile(path.join(example, "asset-index.json"));
      type = "application/json";
    } else {
      let base, tail;
      if (route === "/receiving.js" || route === "/skinned-scene.js") {
        base = path.join(root, "packages/scene-three/test-fixtures");
        tail = route.slice(1);
      } else if (route.startsWith("/three/")) {
        base = threeRoot;
        tail = route.slice(7);
      } else if (route.startsWith("/web/")) {
        base = path.join(root, "packages/web/dist");
        tail = route.slice(5);
      } else if (route.startsWith("/scene/")) {
        base = path.join(root, "packages/scene-three/dist");
        tail = route.slice(7);
      } else if (route.startsWith("/assets/")) {
        base = path.join(example, "assets");
        tail = route.slice(8);
      } else throw Error("Missing fixture");
      const file = path.resolve(base, tail);
      if (!file.startsWith(path.resolve(base) + path.sep))
        throw Error("Invalid fixture path");
      body = await readFile(file);
      type = mime(file);
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  } catch (error) {
    httpFailures.respond(req,res,error,400);
  }
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port + "/";
  browser = await launchChrome(await findChrome());
  const target = await createPage(browser.debugUrl, url);
  const result = await readPageResult(target.webSocketDebuggerUrl, {
    width: 1000,
    height: 760,
    url,
    timeoutMs: 60000,
  });
  if (result.error) throw Error(result.error);
  for (const [id, png] of Object.entries(result.images))
    await writeFile(
      path.join(evidence, id + ".png"),
      Buffer.from(png, "base64"),
    );
  delete result.images;
  await writeFile(
    path.join(evidence, "receiving.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  const receipt = result.receipt;
  await new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      receipt.timebase.numerator + "/" + receipt.timebase.denominator,
      "-i",
      path.join(evidence, "frames/%04d.png"),
      "-frames:v",
      String(receipt.frameCount),
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      path.join(evidence, "paper-theatre.mp4"),
    ];
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (part) => (error += part));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(Error(error))));
  });
  console.log(JSON.stringify(result, null, 2));
} catch(error){throw httpFailures.decorate(error)} finally {
  if (browser) await closeChrome(browser);
  await new Promise((resolve) => server.close(resolve));
}
