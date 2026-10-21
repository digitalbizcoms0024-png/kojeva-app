// Builds the static, single-file preview (see scripts/inline-demo.ts).
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Embeds SQLite's wasm binary as base64, since the preview can't fetch files.
function sqlWasm(): Plugin {
  const id = "virtual:sql-wasm";
  return {
    name: "sql-wasm-base64",
    resolveId: (s) => (s === id ? `\0${id}` : null),
    load(s) {
      if (s !== `\0${id}`) return null;
      const file = createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm");
      return `export default ${JSON.stringify(readFileSync(file).toString("base64"))};`;
    },
  };
}

export default defineConfig({
  root: "demo",
  plugins: [react(), tailwindcss(), sqlWasm()],
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: { output: { codeSplitting: false } },
  },
});
