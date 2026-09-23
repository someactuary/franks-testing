/**
 * Local OMR service: runs an OMR engine (Audiveris, or homr for photos) out-of-process
 * and exposes it over a small framework-free `(req, res, next)` HTTP handler. Mounted by the Vite dev server
 * plugin (vite.config.ts) and by scripts/omr-server.ts (standalone, same handler).
 * See docs/ARCHITECTURE.md "M4 contracts: PDF import (OMR)" and src/io/omr-api.ts
 * for the wire contract this implements.
 *
 * Security notes:
 *  - Uploads are sniffed by magic bytes; anything that isn't PDF/PNG/JPEG is
 *    rejected (400) before it is ever written to disk.
 *  - The request body is size-capped while streaming in: once the limit is
 *    exceeded we stop buffering and destroy the socket, we never accumulate an
 *    unbounded buffer.
 *  - `X-Filename` is attacker-controlled and is ONLY ever used for display
 *    (the `filename` field of an OmrJob); it is sanitized (path separators
 *    stripped, length capped) and never interpolated into a filesystem path.
 *    The on-disk name is always `<jobDir>/input.<ext>`, derived from the id we
 *    generate and the sniffed extension, never from client input.
 *  - Every engine (and the PDF page renderer homr needs) is spawned with an
 *    argument array (no shell), so upload content or the resolved paths can't
 *    inject shell syntax. The engine choice is checked against a fixed list.
 */
import { randomUUID } from "node:crypto";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import {
  OMR_ENGINES,
  OMR_MAX_UPLOAD_BYTES,
  type OmrEngine,
  type OmrEngineStatus,
  type OmrError,
  type OmrJob,
  type OmrJobState,
  type OmrStatus,
} from "../src/io/omr-api";

const INPUT_STEM = "input";
const LOG_TAIL_LINES = 40;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RETENTION_MS = 60 * 60 * 1000; // 1 hour
const SETUP_HINT = "Run `bash scripts/setup-omr.sh` to install it.";
const HOMR_SETUP_HINT = "Run `bash scripts/setup-omr.sh --homr` to install it.";
/** Page renders for homr: 300 dpi matches what Audiveris uses internally for PDFs. */
const PDF_RENDER_DPI = "300";

export interface OmrServiceOptions {
  /** Directory job subdirectories are created under. Created if missing. */
  jobsDir: string;
  /** Explicit Audiveris executable path, tried before the usual fallbacks. */
  audiverisPath?: string;
  /** Explicit homr executable path, tried before $PMN_HOMR and ~/.local/bin/homr. */
  homrPath?: string;
  /**
   * Command that renders a PDF's pages to PNGs for homr; the service appends
   * `<input.pdf> <outDir> <dpi>`. It must write page-001.png, page-002.png, ... into
   * outDir. Default: `swift scripts/pdf-to-png.swift`, resolved against the repo root.
   */
  pdfToPngCommand?: string[];
  /** Per-job wall-clock timeout in ms. Default 10 minutes. */
  timeoutMs?: number;
  /** How long a finished job's directory is kept before being swept, in ms. Default 1 hour. */
  retentionMs?: number;
  /** Override for node:child_process.spawn (tests only). */
  spawnImpl?: typeof nodeSpawn;
  /** Tesseract data directory Audiveris reads OCR languages from. */
  tessdataDir?: string;
  /** Override for the upload size limit in bytes (tests only). Default OMR_MAX_UPLOAD_BYTES. */
  maxUploadBytes?: number;
}

export interface OmrService {
  handle(req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void): void;
  status(): Promise<OmrStatus>;
  shutdown(): Promise<void>;
}

type InputExt = "pdf" | "png" | "jpg";

interface JobRecord {
  id: string;
  state: OmrJobState;
  filename: string;
  sheetsDone: number;
  sheetsTotal: number | null;
  message?: string;
  error?: string;
  createdAt: number;
  finishedAt?: number;
  dir: string;
  inputExt: InputExt;
  engine: OmrEngine;
  /** Result files in page order, set when the job is done. */
  resultPaths: string[];
  warnings: string[];
  logTail: string[];
  proc?: ChildProcess;
  timedOut?: boolean;
  timeoutHandle?: NodeJS.Timeout;
  retentionHandle?: NodeJS.Timeout;
}

// ---------------------------------------------------------------------------
// Audiveris discovery
// ---------------------------------------------------------------------------

function defaultTessdataDir(): string {
  return path.join(homedir(), "Library", "Application Support", "AudiverisLtd", "audiveris", "tessdata");
}

async function isExecutableFile(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolution order: opts.audiverisPath, then $PMN_AUDIVERIS, then ~/Applications, then /Applications. */
async function resolveAudiverisPath(opts: OmrServiceOptions): Promise<string | undefined> {
  const candidates = [
    opts.audiverisPath,
    process.env["PMN_AUDIVERIS"],
    path.join(homedir(), "Applications", "Audiveris.app", "Contents", "MacOS", "Audiveris"),
    "/Applications/Audiveris.app/Contents/MacOS/Audiveris",
  ].filter((p): p is string => !!p);
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

/** Resolution order: opts.homrPath, then $PMN_HOMR, then ~/.local/bin/homr (where `uv tool install` puts it). */
async function resolveHomrPath(opts: OmrServiceOptions): Promise<string | undefined> {
  const candidates = [opts.homrPath, process.env["PMN_HOMR"], path.join(homedir(), ".local", "bin", "homr")].filter(
    (p): p is string => !!p,
  );
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

function defaultPdfToPngCommand(): string[] {
  // server/ sits one level below the repo root in both the Vite plugin and the standalone server.
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  return ["/usr/bin/swift", path.join(repoRoot, "scripts", "pdf-to-png.swift")];
}

function isEngine(value: string): value is OmrEngine {
  return (OMR_ENGINES as readonly string[]).includes(value);
}

async function listOcrLanguages(tessdataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(tessdataDir);
    return entries
      .filter((f) => f.toLowerCase().endsWith(".traineddata"))
      .map((f) => f.slice(0, -".traineddata".length))
      .sort();
  } catch {
    return [];
  }
}

function parseVersion(stdout: string): string {
  const m = /Version:\s*(\S+)/i.exec(stdout);
  if (m) return m[1]!;
  const firstLine = stdout.trim().split("\n")[0]?.trim();
  return firstLine || "unknown";
}

function getVersion(spawnFn: typeof nodeSpawn, audiverisPath: string): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let proc: ChildProcess;
    try {
      proc = spawnFn(audiverisPath, ["-version"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve("unknown");
      return;
    }
    proc.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    proc.stderr?.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    proc.on("error", () => resolve("unknown"));
    proc.on("close", () => resolve(parseVersion(out)));
  });
}

// ---------------------------------------------------------------------------
// Upload handling
// ---------------------------------------------------------------------------

function sniffExtension(buf: Buffer): InputExt | undefined {
  if (buf.length >= 4 && buf.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return undefined;
}

/** X-Filename is display-only: strip path separators and cap length. Never used in a fs path. */
function sanitizeFilename(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const stripped = raw.replace(/[\\/]/g, "_").trim();
  const capped = stripped.slice(0, 200);
  return capped || fallback;
}

class UploadTooLargeError extends Error {}

/**
 * Reads the request body, refusing to buffer past `limit` bytes. Once the limit is
 * exceeded we stop accumulating chunks (so memory stays bounded) but keep draining
 * the socket instead of destroying it outright, so the 413 response we're about to
 * send actually reaches the client instead of racing a dropped connection.
 */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    let overLimit = false;

    const cleanup = () => {
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
    };
    const onData = (chunk: Buffer) => {
      if (overLimit) return; // still draining the socket; just discard.
      total += chunk.length;
      if (total > limit) {
        overLimit = true;
        settled = true;
        reject(new UploadTooLargeError());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

// ---------------------------------------------------------------------------
// Log-line progress parsing
//
// Derived from real `-batch -export` runs (see docs/ARCHITECTURE.md M4). Two
// patterns carry all the progress we need out of Audiveris's logback output:
//   "Book 560 | 9 sheets in /path/to/file.pdf"       -> sheetsTotal
//   "Book 2050 | End of Stub#3"                       -> sheetsDone (>= 3)
// Every other non-blank line's trailing "| message" segment (or the whole
// line, for the one two-line "Input "...""" continuation) becomes the last
// human-readable progress message, e.g. "StepMonitoring 98 | RHYTHMS".
// ---------------------------------------------------------------------------

const SHEETS_TOTAL_RE = /(\d+)\s+sheets?\s+in\b/i;
const SHEET_DONE_RE = /End of Stub#(\d+)/;
const TRAILING_MESSAGE_RE = /\|\s*(.+)$/;

function ingestLine(record: JobRecord, rawLine: string): void {
  const line = rawLine.replace(/\r$/, "");
  if (!line.trim()) return;

  record.logTail.push(line);
  if (record.logTail.length > LOG_TAIL_LINES) record.logTail.shift();

  const totalMatch = SHEETS_TOTAL_RE.exec(line);
  if (totalMatch && record.sheetsTotal == null) record.sheetsTotal = Number(totalMatch[1]);

  const doneMatch = SHEET_DONE_RE.exec(line);
  if (doneMatch) record.sheetsDone = Math.max(record.sheetsDone, Number(doneMatch[1]));

  const messageMatch = TRAILING_MESSAGE_RE.exec(line);
  record.message = (messageMatch ? messageMatch[1]! : line).trim();
}

/** Buffers partial lines across chunk boundaries and forwards complete ones. */
function makeLineFeeder(onLine: (line: string) => void): (chunk: Buffer) => void {
  let pending = "";
  return (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  };
}

// ---------------------------------------------------------------------------
// Process group control
// ---------------------------------------------------------------------------

function killGroup(proc: ChildProcess): void {
  if (proc.pid == null) return;
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    // Already exited; nothing to do.
  }
}

async function findResultFile(dir: string): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }
  const mxlFiles = entries.filter((f) => f.toLowerCase().endsWith(".mxl")).sort();
  if (mxlFiles.length === 0) return undefined;
  // Audiveris names its export after the input file's stem, which is always
  // "input" here. Prefer that exact match; if for some reason several .mxl
  // files exist and none matches, fall back to the alphabetically first one.
  const exact = `${INPUT_STEM}.mxl`;
  const chosen = mxlFiles.includes(exact) ? exact : mxlFiles[0]!;
  return path.join(dir, chosen);
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length });
  res.end(data);
}

function sendError(res: ServerResponse, status: number, error: string): void {
  const body: OmrError = { error };
  sendJson(res, status, body);
}

function elapsedMs(record: JobRecord): number {
  return (record.finishedAt ?? Date.now()) - record.createdAt;
}

function toWireJob(record: JobRecord): OmrJob {
  return {
    id: record.id,
    state: record.state,
    filename: record.filename,
    engine: record.engine,
    sheetsDone: record.sheetsDone,
    sheetsTotal: record.sheetsTotal,
    elapsedMs: elapsedMs(record),
    resultCount: record.state === "done" ? record.resultPaths.length : 0,
    ...(record.message !== undefined ? { message: record.message } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
    ...(record.warnings.length > 0 ? { warnings: record.warnings } : {}),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createOmrService(opts: OmrServiceOptions): OmrService {
  const jobsDir = opts.jobsDir;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
  const maxUploadBytes = opts.maxUploadBytes ?? OMR_MAX_UPLOAD_BYTES;
  const spawnFn = opts.spawnImpl ?? nodeSpawn;
  const tessdataDir = opts.tessdataDir ?? defaultTessdataDir();
  const pdfToPngCommand = opts.pdfToPngCommand ?? defaultPdfToPngCommand();

  const jobs = new Map<string, JobRecord>();
  const queue: string[] = [];
  let runningId: string | null = null;
  let runningExit: Promise<void> | undefined;
  let versionCache: { path: string; value: Promise<string> } | undefined;
  let shuttingDown = false;

  function jobDirOf(id: string): string {
    return path.join(jobsDir, id);
  }

  async function removeJobDir(id: string, dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    void id;
  }

  function scheduleRetention(record: JobRecord): void {
    const handle = setTimeout(() => {
      jobs.delete(record.id);
      void removeJobDir(record.id, record.dir);
    }, retentionMs);
    handle.unref();
    record.retentionHandle = handle;
  }

  function finishJob(record: JobRecord, state: "done" | "error", error?: string): void {
    record.state = state;
    record.finishedAt = Date.now();
    if (error !== undefined) record.error = error;
    if (record.timeoutHandle) clearTimeout(record.timeoutHandle);
    delete record.proc;
    if (runningId === record.id) runningId = null;
    scheduleRetention(record);
    pump();
  }

  function cachedVersion(audiverisPath: string): Promise<string> {
    if (!versionCache || versionCache.path !== audiverisPath) {
      versionCache = { path: audiverisPath, value: getVersion(spawnFn, audiverisPath) };
    }
    return versionCache.value;
  }

  async function homrStatus(): Promise<OmrEngineStatus> {
    const homrPath = await resolveHomrPath(opts);
    if (!homrPath) return { available: false, hint: `homr was not found. ${HOMR_SETUP_HINT}` };
    // homr has no version flag; the path is enough to show which install is used.
    return { available: true, path: homrPath };
  }

  async function status(): Promise<OmrStatus> {
    const audiverisPath = await resolveAudiverisPath(opts);
    const ocrLanguages = await listOcrLanguages(tessdataDir);
    const homr = await homrStatus();

    if (!audiverisPath) {
      const hint = `Audiveris was not found. ${SETUP_HINT}`;
      return { available: false, ocrLanguages, hint, engines: { audiveris: { available: false, hint }, homr } };
    }

    const version = await cachedVersion(audiverisPath);
    const hint =
      ocrLanguages.length === 0
        ? `No OCR language data is installed; lyrics and other text will be misread. ${SETUP_HINT}`
        : undefined;

    return {
      available: true,
      audiverisPath,
      version,
      ocrLanguages,
      ...(hint !== undefined ? { hint } : {}),
      engines: {
        audiveris: { available: true, path: audiverisPath, version, ...(hint !== undefined ? { hint } : {}) },
        homr,
      },
    };
  }

  async function startJob(record: JobRecord): Promise<void> {
    runningId = record.id;
    record.state = "running";
    if (record.engine === "homr") {
      await startHomrJob(record);
      return;
    }

    const audiverisPath = await resolveAudiverisPath(opts);
    if (!audiverisPath) {
      finishJob(record, "error", `Audiveris is not installed. ${SETUP_HINT}`);
      return;
    }

    const inputPath = path.join(record.dir, `${INPUT_STEM}.${record.inputExt}`);
    const args = ["-batch", "-export", "-output", record.dir, "--", inputPath];

    let proc: ChildProcess;
    try {
      proc = spawnFn(audiverisPath, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      finishJob(record, "error", `failed to start Audiveris: ${(e as Error).message}`);
      return;
    }
    record.proc = proc;

    let resolveExit = (): void => {};
    runningExit = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    proc.stdout?.on("data", makeLineFeeder((line) => ingestLine(record, line)));
    proc.stderr?.on("data", makeLineFeeder((line) => ingestLine(record, line)));

    const timeoutHandle = setTimeout(() => {
      record.timedOut = true;
      killGroup(proc);
    }, timeoutMs);
    timeoutHandle.unref();
    record.timeoutHandle = timeoutHandle;

    proc.on("error", (err) => {
      resolveExit();
      if (record.state !== "cancelled") finishJob(record, "error", `failed to run Audiveris: ${err.message}`);
    });

    proc.on("close", (code) => {
      resolveExit();
      if (record.state === "cancelled") return; // DELETE already handled this job.
      void (async () => {
        if (record.timedOut) {
          finishJob(record, "error", `Audiveris timed out after ${timeoutMs}ms\n${record.logTail.join("\n")}`);
          return;
        }
        const resultPath = await findResultFile(record.dir);
        if (code === 0 && resultPath) {
          record.resultPaths = [resultPath];
          if (record.sheetsTotal != null) record.sheetsDone = record.sheetsTotal;
          finishJob(record, "done");
          return;
        }
        const reason =
          code === 0 ? "Audiveris finished but produced no MusicXML output" : `Audiveris exited with code ${code}`;
        finishJob(record, "error", `${reason}\n${record.logTail.join("\n")}`);
      })();
    });
  }

  /**
   * Runs one child process of a multi-step job (homr's page renderer, then homr once per
   * page). Resolves with the exit code, or null when it was killed (timeout/cancel) or
   * failed to start; `record.proc` always points at the step in flight so cancel and
   * shutdown kill the right process group.
   */
  function runStep(record: JobRecord, command: string, args: string[], onLine: (line: string) => void): Promise<number | null> {
    return new Promise((resolve) => {
      let proc: ChildProcess;
      try {
        proc = spawnFn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        record.logTail.push(`failed to start ${path.basename(command)}: ${(e as Error).message}`);
        resolve(null);
        return;
      }
      record.proc = proc;
      let resolveExit = (): void => {};
      runningExit = new Promise<void>((r) => {
        resolveExit = r;
      });
      proc.stdout?.on("data", makeLineFeeder(onLine));
      proc.stderr?.on("data", makeLineFeeder(onLine));
      proc.on("error", (err) => {
        record.logTail.push(`failed to run ${path.basename(command)}: ${err.message}`);
        resolveExit();
        resolve(null);
      });
      proc.on("close", (code, signal) => {
        resolveExit();
        resolve(signal ? null : code);
      });
    });
  }

  /**
   * Remembers a homr/renderer log line. homr's CoreML backend prints long, harmless "E5RT"
   * warnings (skipped), and its text-reading step logs in color with a
   * "[INFO] <date> <time> [RapidOCR] file.py:63:" prefix (stripped for display).
   */
  function ingestHomrLine(record: JobRecord, rawLine: string, pagePrefix: string): void {
    const line = rawLine
      .replace(/\r$/, "")
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/^\[[A-Z]+\]\s+\S+\s+\S+\s+(\[[^\]]*\]\s+)?\S+:\d+:\s*/, "")
      .trim();
    if (!line || line.startsWith("E5RT") || line.startsWith("Downloaded ")) return;
    record.logTail.push(line);
    if (record.logTail.length > LOG_TAIL_LINES) record.logTail.shift();
    // homr prints its whole token stream on one "Writing XML" line; don't show that.
    const shown = line.length > 120 ? `${line.slice(0, 117)}...` : line;
    record.message = `${pagePrefix}${shown}`;
  }

  /**
   * homr reads one image at a time and writes `<image stem>.musicxml` beside it. A PDF is
   * first rendered to page PNGs; each page is then recognized in turn, and a page homr
   * can't read becomes a warning rather than failing the whole job.
   */
  async function startHomrJob(record: JobRecord): Promise<void> {
    const homrPath = await resolveHomrPath(opts);
    if (!homrPath) {
      finishJob(record, "error", `homr is not installed. ${HOMR_SETUP_HINT}`);
      return;
    }

    const timeoutHandle = setTimeout(() => {
      record.timedOut = true;
      if (record.proc) killGroup(record.proc);
    }, timeoutMs);
    timeoutHandle.unref();
    record.timeoutHandle = timeoutHandle;
    const stopped = () => record.state === "cancelled" || record.timedOut === true;
    const fail = (reason: string) => {
      if (record.state === "cancelled") return; // DELETE already handled this job.
      const why = record.timedOut ? `homr timed out after ${timeoutMs}ms` : reason;
      finishJob(record, "error", `${why}\n${record.logTail.join("\n")}`);
    };

    const inputPath = path.join(record.dir, `${INPUT_STEM}.${record.inputExt}`);
    let pages: string[];
    if (record.inputExt === "pdf") {
      const pagesDir = path.join(record.dir, "pages");
      record.message = "Rendering PDF pages";
      const [command, ...prefix] = pdfToPngCommand;
      const code = await runStep(record, command!, [...prefix, inputPath, pagesDir, PDF_RENDER_DPI], (line) => {
        const m = /^pages=(\d+)/.exec(line.trim());
        if (m) record.sheetsTotal = Number(m[1]);
        ingestHomrLine(record, line, "");
      });
      if (stopped() || code !== 0) {
        fail(`rendering the PDF's pages failed${code != null ? ` (exit code ${code})` : ""}`);
        return;
      }
      const files = await readdir(pagesDir).catch(() => [] as string[]);
      pages = files
        .filter((f) => /^page-\d+\.png$/.test(f))
        .sort()
        .map((f) => path.join(pagesDir, f));
      if (pages.length === 0) {
        fail("the PDF has no pages to recognize");
        return;
      }
    } else {
      pages = [inputPath];
    }
    record.sheetsTotal = pages.length;

    const results: string[] = [];
    for (const [i, page] of pages.entries()) {
      if (stopped()) {
        fail("homr was stopped");
        return;
      }
      const prefix = pages.length > 1 ? `Page ${i + 1}/${pages.length}: ` : "";
      record.message = `${prefix}starting homr`;
      const code = await runStep(record, homrPath, [page], (line) => ingestHomrLine(record, line, prefix));
      if (stopped()) {
        fail("homr was stopped");
        return;
      }
      const output = page.replace(/\.[^./]+$/, ".musicxml");
      const wrote = await access(output).then(
        () => true,
        () => false,
      );
      if (code === 0 && wrote) results.push(output);
      else record.warnings.push(`homr couldn't read page ${i + 1}${code ? ` (exit code ${code})` : ""}; it was skipped.`);
      record.sheetsDone = i + 1;
    }

    if (results.length === 0) {
      fail(pages.length > 1 ? "homr couldn't read any page" : "homr finished but produced no MusicXML output");
      return;
    }
    record.resultPaths = results;
    finishJob(record, "done");
  }

  function pump(): void {
    if (shuttingDown || runningId != null) return;
    const nextId = queue.shift();
    if (nextId == null) return;
    const record = jobs.get(nextId);
    if (!record) {
      pump();
      return;
    }
    void startJob(record);
  }

  async function cancelOrDelete(record: JobRecord): Promise<void> {
    if (record.state === "queued") {
      const idx = queue.indexOf(record.id);
      if (idx >= 0) queue.splice(idx, 1);
    } else if (record.state === "running" && record.proc) {
      killGroup(record.proc);
      if (record.timeoutHandle) clearTimeout(record.timeoutHandle);
      if (runningId === record.id) runningId = null;
    }
    record.state = "cancelled";
    record.finishedAt = Date.now();
    if (record.retentionHandle) clearTimeout(record.retentionHandle);
    jobs.delete(record.id);
    await removeJobDir(record.id, record.dir);
    pump();
  }

  async function handleCreateJob(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const engineParam = url.searchParams.get("engine") ?? "audiveris";
    if (!isEngine(engineParam)) {
      sendError(res, 400, `unknown OMR engine; expected one of ${OMR_ENGINES.join(", ")}`);
      return;
    }
    let body: Buffer;
    try {
      body = await readBody(req, maxUploadBytes);
    } catch (e) {
      if (e instanceof UploadTooLargeError) {
        sendError(res, 413, `upload exceeds the ${maxUploadBytes}-byte limit`);
      } else {
        sendError(res, 400, `failed to read upload: ${(e as Error).message}`);
      }
      return;
    }

    if (body.length === 0) {
      sendError(res, 400, "empty request body");
      return;
    }

    const ext = sniffExtension(body);
    if (!ext) {
      sendError(res, 400, "unrecognized file type; expected a PDF, PNG, or JPEG");
      return;
    }

    const id = randomUUID();
    const dir = jobDirOf(id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${INPUT_STEM}.${ext}`), body);

    const filenameHeader = req.headers["x-filename"];
    const rawFilename = Array.isArray(filenameHeader) ? filenameHeader[0] : filenameHeader;
    const filename = sanitizeFilename(rawFilename, `upload.${ext}`);

    const record: JobRecord = {
      id,
      state: "queued",
      filename,
      sheetsDone: 0,
      sheetsTotal: null,
      createdAt: Date.now(),
      dir,
      inputExt: ext,
      engine: engineParam,
      resultPaths: [],
      warnings: [],
      logTail: [],
    };
    jobs.set(id, record);
    queue.push(id);
    pump();

    sendJson(res, 202, { id });
  }

  async function handleGetResult(res: ServerResponse, id: string, url: URL): Promise<void> {
    const record = jobs.get(id);
    if (!record) {
      sendError(res, 404, "unknown job id");
      return;
    }
    if (record.state !== "done" || record.resultPaths.length === 0) {
      sendError(res, 409, `job is ${record.state}`);
      return;
    }
    const index = Number(url.searchParams.get("index") ?? "0");
    const resultPath = Number.isInteger(index) ? record.resultPaths[index] : undefined;
    if (resultPath === undefined) {
      sendError(res, 404, `no result ${url.searchParams.get("index")}; this job has ${record.resultPaths.length}`);
      return;
    }
    let data: Buffer;
    try {
      data = await readFile(resultPath);
    } catch (e) {
      sendError(res, 500, `failed to read result: ${(e as Error).message}`);
      return;
    }
    // .mxl is zipped MusicXML (Audiveris); homr writes plain .musicxml.
    const contentType = resultPath.endsWith(".mxl")
      ? "application/vnd.recordare.musicxml"
      : "application/vnd.recordare.musicxml+xml";
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": data.length });
    res.end(data);
  }

  function handle(req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void): void {
    void (async () => {
      try {
        const method = req.method ?? "GET";
        const url = new URL(req.url ?? "/", "http://localhost");
        const pathname = url.pathname;

        if (method === "GET" && pathname === "/status") {
          sendJson(res, 200, await status());
          return;
        }

        if (method === "POST" && pathname === "/jobs") {
          await handleCreateJob(req, res, url);
          return;
        }

        const resultMatch = /^\/jobs\/([^/]+)\/result$/.exec(pathname);
        if (resultMatch && method === "GET") {
          await handleGetResult(res, decodeURIComponent(resultMatch[1]!), url);
          return;
        }

        const jobMatch = /^\/jobs\/([^/]+)$/.exec(pathname);
        if (jobMatch) {
          const id = decodeURIComponent(jobMatch[1]!);
          if (method === "GET") {
            const record = jobs.get(id);
            if (!record) sendError(res, 404, "unknown job id");
            else sendJson(res, 200, toWireJob(record));
            return;
          }
          if (method === "DELETE") {
            const record = jobs.get(id);
            if (!record) {
              sendError(res, 404, "unknown job id");
              return;
            }
            await cancelOrDelete(record);
            res.writeHead(204);
            res.end();
            return;
          }
        }

        sendError(res, 404, "not found");
      } catch (err) {
        if (next) next(err);
        else sendError(res, 500, err instanceof Error ? err.message : "internal error");
      }
    })();
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true;
    for (const record of jobs.values()) {
      if (record.timeoutHandle) clearTimeout(record.timeoutHandle);
      if (record.retentionHandle) clearTimeout(record.retentionHandle);
    }
    if (runningId != null) {
      const record = jobs.get(runningId);
      if (record?.proc) killGroup(record.proc);
      if (runningExit) await Promise.race([runningExit, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    }
  }

  return { handle, status, shutdown };
}
