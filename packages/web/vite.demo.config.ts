import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(directory, "demo"),
  base: "./",
  publicDir: path.join(directory, "../../examples"),
  build: {
    assetsInlineLimit: 10_000_000,
    outDir: path.join(directory, "demo-dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
