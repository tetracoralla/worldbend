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
        effects: path.join(directory, "src/effects.ts"),
        appearance: path.join(directory, "src/appearance.ts"),
        "appearance-receiving": path.join(directory, "src/appearance-receiving.ts"),
        texture: path.join(directory, "src/texture.ts"),
        foil: path.join(directory, "src/foil.ts"),
        "foil-receiving": path.join(directory, "src/foil-receiving.ts"),
        "mesh-gradient": path.join(directory, "src/mesh-gradient.ts"),
        "mesh-gradient-receiving": path.join(directory, "src/mesh-gradient-receiving.ts"),
        "document-motion": path.join(directory, "src/document-motion.ts"),
        "spatial-document": path.join(directory, "src/spatial-document.ts"),
        "mockup-motion": path.join(directory, "src/mockup-motion.ts"),
        "material-document": path.join(directory, "src/material-document.ts"),
        "material-preference": path.join(directory, "src/material-preference.ts"),
        "card-state": path.join(directory, "src/card-state.ts"),
        card: path.join(directory, "src/card-entry.ts"),
        "surface-window": path.join(directory, "src/surface-window.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: false,
    emptyOutDir: true,
  },
});
