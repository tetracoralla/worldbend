import { defineConfig, type UserConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, "../..");

export function figmaBuildConfig(buildTarget: string): UserConfig {
  return buildTarget === "main"
    ? {
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
        plugins: [viteSingleFile()],
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
