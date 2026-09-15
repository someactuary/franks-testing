// @vitest-environment jsdom
/**
 * One real, end-to-end run of the OMR pipeline against the actual Audiveris
 * binary and a real sample PDF: upload -> poll -> download -> importMusicXml
 * -> cleanupOmrScore (both modes). Skipped wherever either is missing (CI,
 * another dev's machine) via describe.skipIf; see docs/ARCHITECTURE.md "M4
 * contracts: PDF import (OMR)".
 *
 * This asserts structure and counts only. It must never read or assert on any
 * lyric text or other text extracted from the sample PDF or its OMR output.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createOmrService } from "./omr-service";
import { importMusicXml } from "../src/io/musicxml";
import { cleanupOmrScore } from "../src/io/omr-cleanup";
import { validateScore } from "../src/io/validate";
import type { OmrJob } from "../src/io/omr-api";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SAMPLE_PATH = path.join(REPO_ROOT, "sample_sheet_music", "the_spirit_of_god_eng.pdf");

/**
 * A cheap, synchronous stand-in for the service's own (async) Audiveris
 * resolution, good enough to gate the suite at collection time. The actual
 * run below still goes through createOmrService's real resolution.
 */
function findAudiverisSync(): string | undefined {
  const candidates = [
    process.env["PMN_AUDIVERIS"],
    path.join(homedir(), "Applications", "Audiveris.app", "Contents", "MacOS", "Audiveris"),
    "/Applications/Audiveris.app/Contents/MacOS/Audiveris",
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p));
}

const hasAudiveris = findAudiverisSync() !== undefined;
const hasSample = existsSync(SAMPLE_PATH);

async function listenEphemeral(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function pollJob(baseUrl: string, id: string, onUpdate: (job: OmrJob) => void, timeoutMs: number): Promise<OmrJob> {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${baseUrl}/jobs/${id}`);
    const job = (await res.json()) as OmrJob;
    onUpdate(job);
    if (job.state === "done" || job.state === "error" || job.state === "cancelled") return job;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for job ${id}: ${JSON.stringify(job)}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe.skipIf(!hasAudiveris || !hasSample)("OMR real run: the_spirit_of_god_eng.pdf", () => {
  it(
    "runs the real Audiveris pipeline end to end and cleans up the result",
    async () => {
      const jobsDir = mkdtempSync(path.join(tmpdir(), "pmn-omr-real-"));
      const service = createOmrService({ jobsDir, timeoutMs: 5 * 60 * 1000 });
      const server = createServer((req, res) => service.handle(req, res));
      const baseUrl = await listenEphemeral(server);

      try {
        const status = await service.status();
        expect(status.available).toBe(true);

        const pdfBytes = readFileSync(SAMPLE_PATH);
        const uploadStart = Date.now();
        const uploadRes = await fetch(`${baseUrl}/jobs`, {
          method: "POST",
          body: pdfBytes as unknown as BodyInit,
          headers: { "X-Filename": "the_spirit_of_god_eng.pdf" },
        });
        expect(uploadRes.status).toBe(202);
        const { id } = (await uploadRes.json()) as { id: string };

        const progressLog: string[] = [];
        let lastKey = "";
        const job = await pollJob(
          baseUrl,
          id,
          (j) => {
            const key = `${j.state}:${j.sheetsDone}/${j.sheetsTotal}:${j.message ?? ""}`;
            if (key !== lastKey) {
              progressLog.push(key);
              lastKey = key;
            }
          },
          5 * 60 * 1000,
        );
        const elapsedMs = Date.now() - uploadStart;

        console.log(`[omr real run] elapsed ${elapsedMs}ms, ${progressLog.length} distinct progress updates:`);
        for (const line of progressLog) console.log(`[omr real run]   ${line}`);

        expect(job.state).toBe("done");
        expect(job.sheetsTotal).toBe(2); // known from the real Audiveris log for this sample (count only)
        expect(job.sheetsDone).toBe(2);

        const resultRes = await fetch(`${baseUrl}/jobs/${id}/result`);
        expect(resultRes.status).toBe(200);
        expect(resultRes.headers.get("content-type")).toBe("application/vnd.recordare.musicxml");
        const resultBytes = new Uint8Array(await resultRes.arrayBuffer());
        expect(resultBytes.length).toBeGreaterThan(1000);
        expect(resultBytes[0]).toBe(0x50); // .mxl is a zip: "PK"
        expect(resultBytes[1]).toBe(0x4b);

        const score = importMusicXml(resultBytes.buffer.slice(resultBytes.byteOffset, resultBytes.byteOffset + resultBytes.byteLength));
        expect(score.parts.length).toBeGreaterThanOrEqual(1);
        expect(score.measures.length).toBeGreaterThan(0);
        const validationIssues = validateScore(score);
        console.log(`[omr real run] parts=${score.parts.length} measures=${score.measures.length} validateScore issues=${validationIssues.length}`);

        const essentials = cleanupOmrScore(score, { keep: "essentials", keepLayout: true });
        const all = cleanupOmrScore(score, { keep: "all", keepLayout: true });
        console.log(
          `[omr real run] review items: essentials=${essentials.review.length} all=${all.review.length}; ` +
            `reasons=${JSON.stringify([...new Set(essentials.review.map((r) => r.reason))])}`,
        );

        expect(essentials.score.spanners).toEqual([]);
        expect(essentials.score.attachments).toEqual([]);
        // "all" mode keeps whatever the real export produced (could legitimately be zero).
        expect(all.score.spanners.length).toBe(score.spanners.length);
        expect(all.score.attachments.length).toBe(score.attachments.length);

        // Review items are sorted by measure.
        const measureIndices = essentials.review.map((r) => r.measureIndex);
        expect(measureIndices).toEqual([...measureIndices].sort((a, b) => a - b));
      } finally {
        await service.shutdown();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(jobsDir, { recursive: true, force: true });
      }
    },
    3 * 60 * 1000,
  );
});
