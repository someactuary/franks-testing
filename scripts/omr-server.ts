/**
 * Standalone OMR service for use outside the Vite dev server, listening on
 * 127.0.0.1 only. Serves exactly the same handler as the Vite plugin
 * (vite.config.ts) at /api/omr; see server/omr-service.ts and
 * docs/ARCHITECTURE.md "M4 contracts: PDF import (OMR)".
 *
 * Usage: npx tsx scripts/omr-server.ts [port]   (default 5174)
 */
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOmrService } from "../server/omr-service";

const MOUNT = "/api/omr";

function parsePort(arg: string | undefined): number {
  if (arg === undefined) return 5174;
  const n = Number(arg);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`invalid port "${arg}"`);
    process.exit(1);
  }
  return n;
}

const port = parsePort(process.argv[2]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const service = createOmrService({ jobsDir: path.join(repoRoot, ".omr-jobs") });

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  // Mimic connect's mount-prefix stripping so this behaves exactly like the
  // Vite plugin's `server.middlewares.use("/api/omr", service.handle)`.
  if (url === MOUNT || url.startsWith(`${MOUNT}/`)) {
    req.url = url.slice(MOUNT.length) || "/";
    service.handle(req, res, (err) => {
      if (err) {
        const message = err instanceof Error ? err.message : "internal error";
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: message }));
      }
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OMR service listening on http://127.0.0.1:${port}${MOUNT}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await service.shutdown();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
