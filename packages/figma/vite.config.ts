import { defineConfig, type UserConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {figmaRuntimeLicenseBanner} from "../../scripts/figma-runtime-license.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, "../..");
const figmaWasmBindings = path.join(
  workspace,
  "packages/wasm/pkg-figma/worldbend_wasm.js",
);
const figmaWasmBinary = path.join(
  workspace,
  "packages/wasm/pkg-figma/worldbend_wasm_bg.wasm",
);
const compressedWasmModule = "\0virtual:worldbend-figma-wasm-gzip";

export function figmaRuntimeLicensePlugin() {
  return {name:"worldbend-figma-runtime-license",enforce:"post" as const,
    generateBundle(_options:unknown,bundle:Record<string,{type:string;code?:string}>) {
      const banner=figmaRuntimeLicenseBanner();
      for(const entry of Object.values(bundle))if(entry.type==="chunk"&&entry.code!==undefined)
        entry.code=`${banner}\n${entry.code}`;
    }};
}

export function figmaCompressedWasmPlugin() {
  return {
    name: "worldbend-figma-compressed-wasm",
    enforce: "pre" as const,
    resolveId(id: string) {
      return id === "virtual:worldbend-figma-wasm-gzip" ? compressedWasmModule : undefined;
    },
    load(id: string) {
      if (id !== compressedWasmModule) return undefined;
      const compressed = gzipSync(readFileSync(figmaWasmBinary), { level: 9 });
      return `export default ${JSON.stringify(compressed.toString("base64"))};`;
    },
    transform(code: string, id: string) {
      if (path.resolve(id.split("?")[0] ?? "") !== figmaWasmBindings) return undefined;
      const fallback = `if (module_or_path === undefined) {\n        module_or_path = new URL('worldbend_wasm_bg.wasm', import.meta.url);\n    }`;
      if (!code.includes(fallback)) {
        throw new Error("Generated Figma WASM loader fallback changed; compressed carrier build stopped");
      }
      return code.replace(
        fallback,
        `if (module_or_path === undefined) {\n        throw new Error('The Figma carrier requires its compressed WASM payload');\n    }`,
      );
    },
  };
}

export function figmaBuildConfig(buildTarget: string): UserConfig {
  return buildTarget === "main"
    ? {
        plugins:[figmaRuntimeLicensePlugin()],
        build: {
          outDir: path.join(directory, "dist"),
          emptyOutDir: false,
          target: "es2020",
          minify: "esbuild",
          lib: {
            entry: path.join(directory, "src/main.ts"),
            formats: ["iife"],
            name: "WorldbendFigmaPlugin",
            fileName: () => "main.js",
          },
          rollupOptions: { output: { inlineDynamicImports: true } },
        },
      }
    : {
        root: directory,
        base: "./",
        // Add legal text after minification, before the single-file inliner.
        plugins: [figmaCompressedWasmPlugin(),figmaRuntimeLicensePlugin(), viteSingleFile()],
        resolve: {
          alias: {
            // Compile the carrier against source modules so Rollup can retain
            // only the Figma surface and route its WASM import through the
            // compressed single-file loader below.
            "@worldbend/web/mockup-motion": path.join(workspace,"packages/web/src/mockup-motion.ts"),
            "@worldbend/web/card-state": path.join(workspace, "packages/web/src/card-state.ts"),
            "@worldbend/web/perspective": path.join(workspace, "packages/web/src/perspective.ts"),
            "@worldbend/web": path.join(workspace, "packages/web/src/index.ts"),
            "@worldbend/wasm/perspective": path.join(directory, "src/figma-perspective-runtime.ts"),
            "@worldbend/wasm": path.join(directory, "src/figma-wasm-runtime.ts"),
            "@worldbend/wasm-bindings": figmaWasmBindings,
          },
        },
        build: {
          assetsInlineLimit: 10_000_000,
          outDir: path.join(directory, "dist"),
          // The installed development manifest resolves main.js and ui.html
          // directly from this shared directory. Never erase the sibling
          // entrypoint while rebuilding one half of a live plugin.
          emptyOutDir: false,
          target: "es2022",
          minify: "esbuild",
          chunkSizeWarningLimit: 12_000,
          rollupOptions: { input: path.join(directory, "ui.html") },
        },
        server: { fs: { allow: [workspace] } },
      };
}

export default defineConfig(({ mode }) => figmaBuildConfig(mode === "main" ? "main" : "ui"));
