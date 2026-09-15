/**
 * "Compare with PDF" side panel (docs/ARCHITECTURE.md "M4 contracts: PDF import
 * (OMR)"). Renders one page of the original PDF (pdf.js) scaled to the panel's
 * width, plus the OMR review list. Follows the editor cursor by default;
 * Prev/Next pin to a page until "Follow cursor" is re-enabled.
 */
import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
// Vite resolves this to a hashed asset URL (see docs/ARCHITECTURE.md); pdf.js
// needs the worker served as a real file, not bundled inline.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { OmrReviewItem } from "@/io/omr-cleanup";
import { pdfPageForMeasure } from "./layout-utils";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface ComparePanelProps {
  /** The original PDF's bytes (never mutated; pdf.js gets its own copy). */
  pdfBytes: ArrayBuffer;
  /** `score.layout.pageBreaks` — measure indices where a new PDF page starts. */
  pageBreaks: readonly number[];
  cursorMeasureIndex: number;
  review: OmrReviewItem[];
  /** A review item was clicked: move the cursor there and clear the selection. */
  onReviewClick: (item: OmrReviewItem) => void;
  onClose: () => void;
}

const RESIZE_DEBOUNCE_MS = 150;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export function ComparePanel({
  pdfBytes,
  pageBreaks,
  cursorMeasureIndex,
  review,
  onReviewClick,
  onClose,
}: ComparePanelProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [followCursor, setFollowCursor] = useState(true);
  const [manualPage, setManualPage] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the document once per `pdfBytes`. pdf.js may transfer/detach a typed
  // array passed as `data`, so it gets a copy — `pdfBytes` itself is kept by
  // the caller for the whole session and must stay intact.
  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ data: pdfBytes.slice(0) });
    task.promise
      .then((pdf) => {
        if (cancelled) return;
        setDoc(pdf);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDoc(null);
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [pdfBytes]);

  // Tracks the panel's own width (not the window's) so the page fits it exactly.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined) return;
      if (resizeTimer.current !== null) clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => setContainerWidth(width), RESIZE_DEBOUNCE_MS);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeTimer.current !== null) clearTimeout(resizeTimer.current);
    };
  }, []);

  const numPages = doc?.numPages ?? 0;
  const cursorPage = pdfPageForMeasure(pageBreaks, cursorMeasureIndex);
  const displayPage = clamp(followCursor ? cursorPage : manualPage, 0, Math.max(0, numPages - 1));

  useEffect(() => {
    if (!doc || containerWidth <= 0) return;
    let cancelled = false;
    void doc.getPage(displayPage + 1).then(async (page) => {
      if (cancelled) return;
      const unscaled = page.getViewport({ scale: 1 });
      const scale = containerWidth / unscaled.width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx || cancelled) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
    });
    return () => {
      cancelled = true;
    };
  }, [doc, displayPage, containerWidth]);

  function goPrev() {
    setFollowCursor(false);
    setManualPage(clamp(displayPage - 1, 0, Math.max(0, numPages - 1)));
  }

  function goNext() {
    setFollowCursor(false);
    setManualPage(clamp(displayPage + 1, 0, Math.max(0, numPages - 1)));
  }

  return (
    <aside className="compare-panel">
      <div className="compare-panel-header">
        <strong>Compare with PDF</strong>
        <button type="button" onClick={onClose} aria-label="Close compare panel">
          &times;
        </button>
      </div>
      <label className="compare-panel-follow">
        <input type="checkbox" checked={followCursor} onChange={(e) => setFollowCursor(e.target.checked)} />
        Follow cursor
      </label>
      <div className="compare-panel-page" ref={containerRef}>
        {loadError ? <p className="compare-panel-error">{loadError}</p> : <canvas ref={canvasRef} />}
      </div>
      <div className="compare-panel-nav">
        <button type="button" onClick={goPrev} disabled={displayPage <= 0}>
          Prev
        </button>
        <span>
          Page {numPages === 0 ? "-" : displayPage + 1} of {numPages || "-"}
        </span>
        <button type="button" onClick={goNext} disabled={numPages === 0 || displayPage >= numPages - 1}>
          Next
        </button>
      </div>
      <div className="compare-panel-review">
        <h4>Review</h4>
        {review.length === 0 ? (
          <p className="compare-panel-review-empty">Nothing flagged.</p>
        ) : (
          <ul>
            {review.map((item, i) => (
              <li key={i}>
                <button type="button" onClick={() => onReviewClick(item)}>
                  {`Measure ${item.measureIndex + 1}, staff ${item.staffIndex + 1}: ${item.detail}`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
