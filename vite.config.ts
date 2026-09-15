import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createOmrService } from "./server/omr-service";

/**
 * Mounts the local OMR service (server/omr-service.ts) at /api/omr, localhost only
 * (the Vite dev server already binds to localhost by default). See
 * docs/ARCHITECTURE.md "M4 contracts: PDF import (OMR)".
 */
function omrPlugin(): Plugin {
  return {
    name: "pmn-omr-service",
    configureServer(server) {
      const service = createOmrService({ jobsDir: path.resolve(__dirname, ".omr-jobs") });
      // connect strips the "/api/omr" mount prefix before calling `handle`, so the
      // handler itself only ever sees paths like "/status" or "/jobs/:id".
      server.middlewares.use("/api/omr", service.handle);
      server.httpServer?.once("close", () => {
        void service.shutdown();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), omrPlugin()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  publicDir: "public",
});
