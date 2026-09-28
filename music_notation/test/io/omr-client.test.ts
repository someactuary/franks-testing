import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelOmrJob, fetchOmrResult, fetchOmrResults, getOmrStatus, pollOmrJob, submitOmrJob } from "@/io/omr-client";
import type { OmrJob, OmrStatus } from "@/io/omr-api";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function job(partial: Partial<OmrJob>): OmrJob {
  return {
    id: "job-1",
    state: "running",
    filename: "scan.pdf",
    engine: "audiveris",
    sheetsDone: 0,
    sheetsTotal: null,
    elapsedMs: 0,
    resultCount: 0,
    ...partial,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getOmrStatus", () => {
  it("resolves with the parsed status on success", async () => {
    const status: OmrStatus = {
      available: true,
      ocrLanguages: ["eng"],
      engines: { audiveris: { available: true }, homr: { available: false, hint: "install it" } },
    };
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/api/omr/status");
      return jsonResponse(status);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOmrStatus()).resolves.toEqual(status);
  });

  it("surfaces the server's { error } text on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Audiveris not found" }, { status: 503, statusText: "Service Unavailable" })),
    );

    await expect(getOmrStatus()).rejects.toThrow("Audiveris not found");
  });

  it("falls back to the HTTP status line when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500, statusText: "Internal Server Error" })),
    );

    await expect(getOmrStatus()).rejects.toThrow(/500/);
  });
});

describe("submitOmrJob", () => {
  it("posts the file with an X-Filename header and resolves with the new job's id", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/omr/jobs?engine=audiveris");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("X-Filename")).toBe("scan.pdf");
      return jsonResponse({ id: "job-1" }, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]);
    await expect(submitOmrJob(blob, "scan.pdf")).resolves.toBe("job-1");
  });

  it("names the chosen engine in the upload URL", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/api/omr/jobs?engine=homr");
      return jsonResponse({ id: "job-2" }, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitOmrJob(new Blob(["x"]), "photo.jpg", "homr")).resolves.toBe("job-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's { error } text on a rejected upload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "File too large" }, { status: 413 })));

    await expect(submitOmrJob(new Blob(["x"]), "scan.pdf")).rejects.toThrow("File too large");
  });
});

describe("pollOmrJob", () => {
  it("calls onProgress for every poll and resolves with the final 'done' job", async () => {
    const sequence: OmrJob[] = [
      job({ state: "queued", sheetsDone: 0, sheetsTotal: null }),
      job({ state: "running", sheetsDone: 1, sheetsTotal: 2, message: "Sheet 1 of 2" }),
      job({ state: "done", sheetsDone: 2, sheetsTotal: 2 }),
    ];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("/api/omr/jobs/job-1");
        return jsonResponse(sequence[Math.min(call++, sequence.length - 1)]);
      }),
    );

    const seen: OmrJob[] = [];
    const result = await pollOmrJob("job-1", { intervalMs: 0, onProgress: (j) => seen.push(j) });

    expect(result.state).toBe("done");
    expect(seen.map((j) => j.state)).toEqual(["queued", "running", "done"]);
  });

  it("rejects with the job's error message when the job ends in 'error'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(job({ state: "error", error: "Audiveris crashed" }))));

    await expect(pollOmrJob("job-1")).rejects.toThrow("Audiveris crashed");
  });

  it("rejects when the AbortSignal fires while waiting between polls", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => jsonResponse(job({ state: "running" })));
    vi.stubGlobal("fetch", fetchMock);

    const promise = pollOmrJob("job-1", { intervalMs: 50, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toThrow(/abort/i);
    // Only the first poll should have gone out; the abort fired during the delay before a second.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(async () => jsonResponse(job({ state: "running" })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollOmrJob("job-1", { signal: controller.signal })).rejects.toThrow(/abort/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchOmrResult", () => {
  it("resolves with the result bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200 })));

    const buf = await fetchOmrResult("job-1");
    expect(new Uint8Array(buf)).toEqual(bytes);
  });

  it("surfaces the server's { error } text when the job isn't done yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Job is not finished" }, { status: 409 })));

    await expect(fetchOmrResult("job-1")).rejects.toThrow("Job is not finished");
  });

  it("fetches every page's result in order", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(new Uint8Array([urls.length]), { status: 200 });
      }),
    );

    const results = await fetchOmrResults(job({ state: "done", engine: "homr", resultCount: 3 }));
    expect(urls).toEqual([0, 1, 2].map((i) => `/api/omr/jobs/job-1/result?index=${i}`));
    expect(results.map((b) => new Uint8Array(b)[0])).toEqual([1, 2, 3]);
  });
});

describe("cancelOmrJob", () => {
  it("issues a DELETE and resolves on 204", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/omr/jobs/job-1");
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelOmrJob("job-1")).resolves.toBeUndefined();
  });

  it("treats an already-gone job (404) as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    await expect(cancelOmrJob("job-1")).resolves.toBeUndefined();
  });
});
