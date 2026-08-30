import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    assetsInlineLimit: 10_000_000,
    lib: {
      entry: path.join(directory, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    sourcemap: false,
    emptyOutDir: true,
  },
});
