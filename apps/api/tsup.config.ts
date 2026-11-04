import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts", worker: "src/feed/worker.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  // Workspace packages ship TypeScript source, so they are bundled; npm dependencies stay external.
  noExternal: [/^@cricket\//],
  sourcemap: true, // server-side only; never served to browsers
  clean: true,
});
