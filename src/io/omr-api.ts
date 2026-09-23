/**
 * Contract between the local OMR service (server/omr-service.ts, runs Audiveris or homr)
 * and the browser client (src/io/omr-client.ts). Types only. See docs/ARCHITECTURE.md
 * "M4 contracts" and "Second OMR engine: homr".
 *
 * Endpoints (served by the Vite dev server plugin, localhost only):
 *   GET  /api/omr/status              -> OmrStatus
 *   POST /api/omr/jobs[?engine=homr]   body = raw PDF/PNG/JPEG bytes, header `X-Filename`
 *                                      engine defaults to "audiveris"
 *                                      -> 202 { id } | 400/413 OmrError
 *   GET  /api/omr/jobs/:id             -> OmrJob
 *   GET  /api/omr/jobs/:id/result[?index=N]
 *                                      -> 200 result N of OmrJob.resultCount (default 0):
 *                                         Audiveris: one .mxl (application/vnd.recordare.musicxml)
 *                                         homr: one .musicxml per page (…musicxml+xml)
 *                                      | 409 OmrError (not done) | 404
 *   DELETE /api/omr/jobs/:id           -> 204 (cancel if running, delete temp files)
 */
export type OmrEngine = "audiveris" | "homr";

export const OMR_ENGINES: readonly OmrEngine[] = ["audiveris", "homr"];

export interface OmrEngineStatus {
  available: boolean;
  /** Resolved executable, when found. */
  path?: string;
  version?: string;
  /** Human-readable setup hint when not available (or, for Audiveris, when OCR data is missing). */
  hint?: string;
}

export interface OmrStatus {
  /**
   * The top-level fields describe Audiveris (the original engine) and are kept for
   * compatibility; `engines` describes every engine, Audiveris included.
   */
  available: boolean;
  /** Resolved Audiveris executable, when found. */
  audiverisPath?: string;
  version?: string;
  /** Tesseract languages installed for Audiveris (e.g. ["eng"]). Empty = lyrics/text not read. */
  ocrLanguages: string[];
  /** Human-readable setup hint when not available or OCR data is missing. */
  hint?: string;
  engines: Record<OmrEngine, OmrEngineStatus>;
}

export type OmrJobState = "queued" | "running" | "done" | "error" | "cancelled";

export interface OmrJob {
  id: string;
  state: OmrJobState;
  filename: string;
  engine: OmrEngine;
  /** Sheets (pages) finished / total, when known from the engine's progress. */
  sheetsDone: number;
  sheetsTotal: number | null;
  /** Last meaningful log line, for the progress UI. */
  message?: string;
  error?: string;
  elapsedMs: number;
  /** Number of result files to fetch once done: 1 for Audiveris, one per recognized page for homr. */
  resultCount: number;
  /** Non-fatal problems, e.g. a page homr couldn't read (the other pages still import). */
  warnings?: string[];
}

export interface OmrError {
  error: string;
}

/** Upload limit enforced by the service (bytes). */
export const OMR_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
