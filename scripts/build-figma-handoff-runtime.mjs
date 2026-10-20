import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { runInNewContext } from "node:vm";
import {figmaRuntimeLicenseBanner} from "./figma-runtime-license.mjs";

// Select exact first-party scene data at build time. Creation carries its
// chosen scene; discovery and the designer retain the whole catalog. This
// prevents unrelated asset detail from consuming a connector packet's budget.
const catalogFile = fileURLToPath(new URL("../packages/figma/src/ready-scene-definitions.ts", import.meta.url));
const catalogBundle = await build({ configFile: false, logLevel: "silent", build: {
  write: false, target: "es2020", minify: "esbuild",
  lib: { entry: catalogFile, name: "SceneCatalog", formats: ["iife"] },
} });
const catalogOutput = Array.isArray(catalogBundle) ? catalogBundle[0].output : catalogBundle.output;
const catalogCode = catalogOutput.find(entry => entry.type === "chunk")?.code;
if (!catalogCode) throw Error("Scene catalog has no code");
const catalog = runInNewContext(catalogCode + "\nSceneCatalog;", Object.create(null));
const readyVariants = catalog.READY_SCENES.map(scene => ({
  entry: "../packages/figma/src/agent-scene-create-ready.ts",
  output: `../crates/worldbend-mcp/src/figma-runtime-scene-ready-create-${scene.id}.js`,
  scene, details: catalog.readySceneDetails(scene),
}));

// Each prepared request embeds only the runtime variant it calls: the
// document publishers, or the native material families. The hard packet cap
// is the 48 KiB Figma request limit enforced on the Rust side; keep each
// first-party decoded variant below 128 KiB. Ordinary requests can use an
// exact executable envelope; the small decoder itself stays below 46 KiB,
// reserving overhead. This preflight does not certify any call's arguments. Measure escaping
// rather than estimating it from raw size. Rust checks every request at 48 KiB;
// its request tests also exercise the longest supported scene arguments.
const ENCODED_VARIANT_LIMIT_BYTES = 46 * 1024;
const variants = [
  {entry:"../packages/figma/src/agent-embedded-runtime.ts",output:"../crates/worldbend-mcp/src/figma-runtime-embedded.js",name:"WorldbendFigmaEmbedded"},
  {entry:"../packages/figma/src/agent-publication-stage.ts",output:"../crates/worldbend-mcp/src/figma-runtime-publication-stage.js",name:"WorldbendFigmaMedia"},
  {entry:"../packages/figma/src/agent-foil.ts",output:"../crates/worldbend-mcp/src/figma-runtime-foil.js"},
  {entry:"../packages/figma/src/agent-mesh-gradient-read.ts",output:"../crates/worldbend-mcp/src/figma-runtime-mesh-gradient-read.js"},
  {entry:"../packages/figma/src/agent-mesh-gradient-resources.ts",output:"../crates/worldbend-mcp/src/figma-runtime-mesh-gradient-resources.js"},
  {entry:"../packages/figma/src/agent-mesh-gradient-edit.ts",output:"../crates/worldbend-mcp/src/figma-runtime-mesh-gradient-edit.js"},
  {entry:"../packages/figma/src/agent-native-continuation-revise-frame.ts",output:"../crates/worldbend-mcp/src/figma-runtime-native-continuation-revise-frame.js"},
  {entry:"../packages/figma/src/agent-native-continuation-revise-vector.ts",output:"../crates/worldbend-mcp/src/figma-runtime-native-continuation-revise-vector.js"},
  {entry:"../packages/figma/src/agent-native-continuation-frame.ts",output:"../crates/worldbend-mcp/src/figma-runtime-native-continuation-frame.js"},
  {entry:"../packages/figma/src/agent-native-continuation-vector.ts",output:"../crates/worldbend-mcp/src/figma-runtime-native-continuation-vector.js"},
  {entry:"../packages/figma/src/agent-vector-create.ts",output:"../crates/worldbend-mcp/src/figma-runtime-vector-create.js"},
  {entry:"../packages/figma/src/agent-vector-initialize.ts",output:"../crates/worldbend-mcp/src/figma-runtime-vector-initialize.js",transportedRuntime:true},
  {entry:"../packages/figma/src/agent-vector-read-page.ts",output:"../crates/worldbend-mcp/src/figma-runtime-vector-read-page.js"},
  {entry:"../packages/figma/src/agent-vector-read.ts",output:"../crates/worldbend-mcp/src/figma-runtime-vector-read.js",transportedRuntime:true},
  {entry:"../packages/figma/src/agent-vector-state.ts",output:"../crates/worldbend-mcp/src/figma-runtime-vector-state.js"},
  // Complete native capture now makes the inline publisher larger than a
  // connector packet. PublicationCache always replaces this oversize candidate
  // with payload chunks + the separately bounded validate/finalize variants.
  {entry:"../packages/figma/src/agent-vector-publish.ts",output:"../crates/worldbend-mcp/src/figma-runtime-vector-publish.js",transportedRuntime:true},
  {entry:"../packages/figma/src/agent-vector-finalize.ts",output:"../crates/worldbend-mcp/src/figma-runtime-vector-finalize.js",transportedRuntime:true},
  {entry:"../packages/figma/src/agent-vector-validate.ts",output:"../crates/worldbend-mcp/src/figma-runtime-vector-validate.js",transportedRuntime:true},
  {entry:"../packages/figma/src/agent-native-create.ts",output:"../crates/worldbend-mcp/src/figma-runtime-native-create.js"},
  {entry:"../packages/figma/src/agent-work-revise-read.ts",output:"../crates/worldbend-mcp/src/figma-runtime-work-revise-read.js"},
  {entry:"../packages/figma/src/agent-work-revision-read-entry.ts",output:"../crates/worldbend-mcp/src/figma-runtime-work-revision-read.js"},
  {entry:"../packages/figma/src/agent-work-state-entry.ts",output:"../crates/worldbend-mcp/src/figma-runtime-work-state.js"},
  {entry:"../packages/figma/src/agent-work-revise-publish.ts",output:"../crates/worldbend-mcp/src/figma-runtime-work-revise-publish.js",transportedRuntime:true},
  {entry:"../packages/figma/src/agent-work-revise-finalize.ts",output:"../crates/worldbend-mcp/src/figma-runtime-work-revise-finalize.js",transportedRuntime:true},
  {
    entry: "../packages/figma/src/agent-work-create.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-work-create.js",
  },
  {
    entry: "../packages/figma/src/agent-linked-update-finalize.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-linked-finalize.js",
    transportedRuntime: true,
  },
  {
    entry: "../packages/figma/src/agent-linked-update-read.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-linked-update.js",
  },
  {
    entry: "../packages/figma/src/agent-linked-update-publish.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-linked-publish.js",
    transportedRuntime: true,
  },
  {
    entry: "../packages/figma/src/agent-handoff-effect-sources.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-effect-sources.js",
  },
  {
    entry: "../packages/figma/src/agent-effect-create.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-effect-create.js",
  },
  {
    entry: "../packages/figma/src/agent-scene-create-native.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-scene-create.js",
  },
  ...readyVariants,
  {
    entry: "../packages/figma/src/agent-handoff-scenes.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-scenes.js",
  },
  {
    entry: "../packages/figma/src/agent-handoff-image-publishers.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-image-publishers.js",
  },
  {
    entry: "../packages/figma/src/agent-handoff-media-entry.ts",
    name: "WorldbendFigmaMedia",
    output: "../crates/worldbend-mcp/src/figma-runtime-media.js",
  },
  { entry: "../packages/figma/src/agent-publication-runtime.ts", output: "../crates/worldbend-mcp/src/figma-runtime-publication-runtime.js", name: "WorldbendFigmaRuntimeTransport" },
  {
    entry: "../packages/figma/src/agent-handoff-publishers.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime.js",
  },
  {entry:"../packages/figma/src/agent-handoff-transform-entry.ts",output:"../crates/worldbend-mcp/src/figma-runtime-transform.js"},
  {
    entry: "../packages/figma/src/agent-handoff-materials.ts",
    output: "../crates/worldbend-mcp/src/figma-runtime-materials.js",
  },
];
let stale = false;
for (const variant of variants) {
  const outputFile = new URL(variant.output, import.meta.url);
  const bundle = await build({ configFile: false, logLevel: "silent",
    plugins: variant.scene ? [{ name: "worldbend-selected-scene", enforce: "pre",
      load(id) {
        if (id !== catalogFile) return;
        return `export const READY_SCENE_IDS=${JSON.stringify([variant.scene.id])};\n` +
          `export const READY_SCENES=${JSON.stringify([variant.scene])};\n` +
          `export function readySceneDetails(){return ${JSON.stringify(variant.details)}}\n`;
      },
    }] : [], build: {
    // Vite's bundled minifier keeps executable handoffs compact, including
    // their JSON representation. Keep the existing packet caps unchanged.
    write: false, target: "es2020", minify: "oxc",
    lib: { entry: fileURLToPath(new URL(variant.entry, import.meta.url)),
      name: variant.name ?? "WorldbendFigmaHandoff", formats: ["iife"] },
  } });
  const output = Array.isArray(bundle) ? bundle[0].output : bundle.output;
  const chunk=output.find(entry=>entry.type==="chunk");
  const code=chunk?.code;
  if (!code) throw new Error(`Figma handoff runtime ${variant.output} has no code`);
  const hasCodec=Object.keys(chunk.modules).some(id=>/[\\/]fflate[\\/]/.test(id));
  const generated = "// Generated by scripts/build-figma-handoff-runtime.mjs from the shared Figma publisher.\n" + (hasCodec?figmaRuntimeLicenseBanner()+"\n":"") + code;
  if(process.argv.includes("--measure")) { console.log(`${Buffer.byteLength(JSON.stringify(generated))} ${variant.output}`); continue; }
  if (Buffer.byteLength(generated)>128*1024 || (variant.name==="WorldbendFigmaEmbedded"&&Buffer.byteLength(JSON.stringify(generated))>ENCODED_VARIANT_LIMIT_BYTES)) {
    throw new Error(`Figma handoff runtime ${variant.output} is ${Buffer.byteLength(JSON.stringify(generated))} bytes, exceeding 128 KiB trusted executable source`);
  }
  if (process.argv.includes("--check")) {
    if (await readFile(outputFile, "utf8") !== generated) {
      stale = true;
      console.error(`Figma handoff runtime ${variant.output} is stale; regenerate it before building the Agent`);
    }
  } else await writeFile(outputFile, generated);
}
if (stale) throw new Error("Stale Figma handoff runtime");
