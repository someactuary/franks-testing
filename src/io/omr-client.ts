/**
 * Browser client for the local OMR service (server/omr-service.ts). Plain `fetch`
 * against the relative `/api/omr/...` paths documented in `src/io/omr-api.ts`; no
 * dependency on how/where the service is mounted. See docs/ARCHITECTURE.md
 * "M4 contracts: PDF import (OMR)".
 */
import type { OmrEngine, OmrError, OmrJob, OmrStatus } from "./omr-api";

const BASE = "/api/omr";

/** Best-effort human-readable message for a non-ok response: the server's `{ error }` text, else status. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as Partial<OmrError> | null;
    if (body && typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Body wasn't JSON (or was empty) — fall through to the status line.
  }
  return `${res.status} ${res.statusText}`.trim() || `HTTP ${res.status}`;
}

async function checkOk(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(await errorMessage(res));
  return res;
}

function abortError(): Error {
  return new DOMException("Aborted", "AbortError");
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function getOmrStatus(signal?: AbortSignal): Promise<OmrStatus> {
  const res = await checkOk(await fetch(`${BASE}/status`, signal ? { signal } : {}));
  return (await res.json()) as OmrStatus;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Submits a file for recognition by `engine`. Resolves with the new job's id. */
export async function submitOmrJob(file: File | Blob, filename: string, engine: OmrEngine = "audiveris"): Promise<string> {
  const res = await checkOk(
    await fetch(`${BASE}/jobs?engine=${engine}`, {
      method: "POST",
      headers: { "X-Filename": filename },
      body: file,
    }),
  );
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Fetches the current state of one job. */
export async function fetchOmrJob(id: string, signal?: AbortSignal): Promise<OmrJob> {
  const res = await checkOk(await fetch(`${BASE}/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {}));
  return (await res.json()) as OmrJob;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;

export interface PollOmrJobOptions {
  /** Called after every poll with the job as it stood at that moment (queued/running included). */
  onProgress?: (job: OmrJob) => void;
  /** Aborts the poll (and rejects the returned promise) when triggered. */
  signal?: AbortSignal;
  /** Delay between polls, in ms. Default 1000. */
  intervalMs?: number;
}

/** Rejects (with an AbortError) if/when `signal` fires; otherwise resolves after `ms`. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Polls a job until it reaches a terminal state. Resolves with the final `OmrJob`
 * when `state === "done"`; rejects (with the job's `error`, or a generic message
 * for "cancelled", or an AbortError when `signal` fires) otherwise.
 */
export async function pollOmrJob(id: string, options: PollOmrJobOptions = {}): Promise<OmrJob> {
  const { onProgress, signal, intervalMs = DEFAULT_POLL_INTERVAL_MS } = options;
  for (;;) {
    if (signal?.aborted) throw abortError();
    const job = await fetchOmrJob(id, signal);
    onProgress?.(job);
    if (job.state === "done") return job;
    if (job.state === "error") throw new Error(job.error ?? "OMR recognition failed");
    if (job.state === "cancelled") throw new Error("OMR job was cancelled");
    await delay(intervalMs, signal);
  }
}

/**
 * Fetches one of the finished job's results (MusicXML or .mxl bytes; `index` < job.resultCount).
 * Only meaningful once the job is "done".
 */
export async function fetchOmrResult(id: string, index = 0): Promise<ArrayBuffer> {
  const res = await checkOk(await fetch(`${BASE}/jobs/${encodeURIComponent(id)}/result?index=${index}`));
  return await res.arrayBuffer();
}

/** Fetches every result of a finished job, in page order (one for Audiveris, one per page for homr). */
export async function fetchOmrResults(job: OmrJob): Promise<ArrayBuffer[]> {
  const results: ArrayBuffer[] = [];
  for (let i = 0; i < Math.max(1, job.resultCount); i++) results.push(await fetchOmrResult(job.id, i));
  return results;
}

/** Cancels a running/queued job and frees its temp files. A already-gone job (404) is not an error. */
export async function cancelOmrJob(id: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res));
}
