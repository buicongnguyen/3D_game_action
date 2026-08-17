import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 4210,
    strictPort: true,
  },
  preview: {
    port: 4211,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        // Vite 8 bundles with rolldown, which only accepts the function form.
        // Splitting three into its own chunk keeps the game code separately
        // cacheable across rebuilds; the engine never changes between them.
        manualChunks(id: string) {
          if (id.includes("node_modules/three")) return "three";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
