import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  base: "./",
  root: path.join(directory, "examples/paper-stage"),
  build: {
    outDir: path.join(directory, "example-dist"),
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
  },
});
