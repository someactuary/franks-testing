/**
 * Contract between the local OMR service (server/omr-service.ts, runs Audiveris) and the
 * browser client (src/io/omr-client.ts). Types only. See docs/ARCHITECTURE.md "M4 contracts".
 *
 * Endpoints (served by the Vite dev server plugin, localhost only):
 *   GET  /api/omr/status              -> OmrStatus
 *   POST /api/omr/jobs                 body = raw PDF/PNG/JPEG bytes, header `X-Filename`
 *                                      -> 202 { id } | 400/413/503 OmrError
 *   GET  /api/omr/jobs/:id             -> OmrJob
 *   GET  /api/omr/jobs/:id/result      -> 200 application/vnd.recordare.musicxml (.mxl bytes)
 *                                      | 409 OmrError (not done) | 404
 *   DELETE /api/omr/jobs/:id           -> 204 (cancel if running, delete temp files)
 */
export interface OmrStatus {
  available: boolean;
  /** Resolved Audiveris executable, when found. */
  audiverisPath?: string;
  version?: string;
  /** Tesseract languages installed for Audiveris (e.g. ["eng"]). Empty = lyrics/text not read. */
  ocrLanguages: string[];
  /** Human-readable setup hint when not available or OCR data is missing. */
  hint?: string;
}

export type OmrJobState = "queued" | "running" | "done" | "error" | "cancelled";

export interface OmrJob {
  id: string;
  state: OmrJobState;
  filename: string;
  /** Sheets (pages) finished / total, when known from the Audiveris log. */
  sheetsDone: number;
  sheetsTotal: number | null;
  /** Last meaningful log line, for the progress UI. */
  message?: string;
  error?: string;
  elapsedMs: number;
}

export interface OmrError {
  error: string;
}

/** Upload limit enforced by the service (bytes). */
export const OMR_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
