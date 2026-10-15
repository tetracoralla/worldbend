import {
  readFile,
  writeFile,
  cp,
  mkdir,
  readdir,
  stat,
  mkdtemp,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { writeSceneLegalMaterial } from "./generate-plugin-legal.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  example = path.join(root, "packages/scene-three/examples/paper-stage"),
  output = path.join(root, "packages/scene-three/example-dist");
await readFile(path.join(output, "index.html"));
const dir = path.join(root, ".task-notes/scene-three-delivery");
await mkdir(dir, { recursive: true });
const legal = await mkdtemp(path.join(dir, ".legal-"));
try {
  await writeSceneLegalMaterial({ destination: legal });
  for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "licenses", "sbom"])
    await cp(path.join(legal, name), path.join(output, name), { recursive: true });
} finally { await rm(legal, { recursive: true, force: true }); }
await mkdir(path.join(output, "licenses"), { recursive: true });
await cp(
  path.join(root, "packages/scene-three/node_modules/three/LICENSE"),
  path.join(output, "licenses/three-MIT.txt"),
);
const three = JSON.parse(await readFile(path.join(root, "packages/scene-three/node_modules/three/package.json"), "utf8"));
const notices = path.join(output, "THIRD_PARTY_NOTICES.md");
await writeFile(notices, (await readFile(notices, "utf8")) +
  `\n## JavaScript runtime\n\n- Three.js ${three.version} (MIT), including its glTF loader. Copyright held by the Three.js authors; full terms: licenses/three-MIT.txt.\n\nBuild tools and the ZIP encoder are not embedded runtime dependencies. Native-only Swift material implementations are not in this Web example.\n`);
const inventoryFile = path.join(output, "sbom/worldbend-scene-example.spdx.json");
const inventory = JSON.parse(await readFile(inventoryFile, "utf8"));
inventory.packages.push({ SPDXID: "SPDXRef-Package-Three", name: "three", versionInfo: three.version,
  downloadLocation: `https://www.npmjs.com/package/three/v/${three.version}`, filesAnalyzed: false,
  licenseDeclared: "MIT", licenseConcluded: "NOASSERTION", externalRefs: [{ referenceCategory: "PACKAGE-MANAGER",
    referenceType: "purl", referenceLocator: `pkg:npm/three@${three.version}` }] });
inventory.relationships.push({ spdxElementId: "SPDXRef-Package-Worldbend", relationshipType: "DEPENDS_ON", relatedSpdxElement: "SPDXRef-Package-Three" });
await writeFile(inventoryFile, JSON.stringify(inventory, null, 2) + "\n");

await cp(path.join(example, "assets"), path.join(output, "assets"), {
  recursive: true,
});
for (const file of [
  "document.json",
  "asset-index.json",
  "editions.json",
  "source-index.json",
  "author-versions.json",
  "initial.json",
  "cover.json",
  "source.json",
  "timed.json",
])
  await cp(path.join(example, file), path.join(output, file));
await writeFile(
  path.join(output, "README.txt"),
  "Field Notes · Worldbend\n\nServe this directory with a static HTTP server, then open index.html.\nFor example: python3 -m http.server 4187 --bind 127.0.0.1\n\nThe Blender sources embed authored print; open them directly in Blender.\nSaved .worldbend.json files reference the immutable assets in this package.\nVersion0.2 also saves the author baseline, explicit local choices and undo.\nPreview second/third author updates before applying; camera and rhythm conflicts retain local choices by default.\n\nThree.js, Web/WASM dependencies are bundled. No project checkout is needed.\nThis is a local example package, not a published installation or release.\n",
);
const files = {};
async function add(dir, prefix = "") {
  for (const entry of await readdir(dir)) {
    const p = path.join(dir, entry),
      name = prefix + entry;
    if ((await stat(p)).isDirectory()) await add(p, name + "/");
    else files[name] = new Uint8Array(await readFile(p));
  }
}
await add(output);
const zip = zipSync(files, { level: 6 });
await writeFile(path.join(dir, "field-notes.zip"), zip);
console.log(
  JSON.stringify({
    ok: true,
    files: Object.keys(files).length,
    bytes: zip.length,
    output: dir,
  }),
);
