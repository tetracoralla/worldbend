import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    assetsInlineLimit: 10_000_000,
    lib: {
      entry: {
        index: path.join(directory, "src/index.ts"),
        perspective: path.join(directory, "src/perspective.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: false,
    emptyOutDir: true,
  },
});
