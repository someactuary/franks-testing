import { useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { LayoutResult, Ref } from "@/engraving/layout-types";
import { renderPages } from "@/render/svg";
import type { SmuflFontData } from "@/render/smufl/types";
import type { Cursor, Selection } from "@/input/types";
import { cursorX, findSystemForMeasure, staffY } from "./layout-utils";

export interface ScoreViewProps {
  layout: LayoutResult;
  font: SmuflFontData;
  /** Show data-id/data-role attributes for hit-testing. Default false. */
  idAttributes?: boolean;
  cursor?: Cursor;
  selection?: Selection;
  /** Fired when a click lands on (or inside) an element carrying a data-id. */
  onClickElement?: (id: string, role: Ref["role"]) => void;
  /** Fired when a click lands on empty page space; xSp/ySp are page-local staff-space coordinates. */
  onClickEmpty?: (pageIndex: number, xSp: number, ySp: number) => void;
}

const CURSOR_COLOR = "#1a73e8";
const CURSOR_WIDTH_SP = 0.2;
const CURSOR_OVERHANG_SP = 1;

function escapeAttrSelector(id: string): string {
  return id.replace(/["\\]/g, "\\$&");
}

/** Converts a client-space point to the SVG's own user-space (its viewBox units) via the screen CTM. */
function clientPointToSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

/**
 * Renders every page of a LayoutResult as inline SVG, stacked vertically,
 * each wrapped for a page-shadow look on screen (see app.css/print.css).
 * Overlays a cursor line and a selection-colouring <style> when `cursor`/
 * `selection` are provided; clicks resolve to either an element id (via the
 * closest ancestor carrying `data-id`) or a page-local point.
 */
export function ScoreView({ layout, font, idAttributes, cursor, selection, onClickElement, onClickEmpty }: ScoreViewProps) {
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const pageSvgs = useMemo(
    () =>
      renderPages(layout, {
        font,
        staffSpaceMm: layout.staffSpaceMm,
        unit: "px",
        idAttributes: idAttributes ?? false,
      }),
    [layout, font, idAttributes],
  );

  const cursorLine = useMemo(() => {
    if (!cursor) return null;
    const loc = findSystemForMeasure(layout, cursor.measureIndex);
    if (!loc) return null;
    const staff = loc.system.staves.find(
      (s) => s.partIndex === cursor.partIndex && s.staffIndex === cursor.staffIndex,
    );
    if (!staff) return null;
    const x = loc.system.x + cursorX(loc.measure, cursor.offset);
    const topY = loc.system.y + staffY(loc.system, cursor.partIndex, cursor.staffIndex) - CURSOR_OVERHANG_SP;
    const bottomY = loc.system.y + staff.y + (staff.lineCount - 1) + CURSOR_OVERHANG_SP;
    return { pageIndex: loc.page.index, x, y1: topY, y2: bottomY };
  }, [layout, cursor]);

  const selectionCss = useMemo(() => {
    if (!selection || selection.ids.length === 0) return "";
    const selector = selection.ids.map((id) => `[data-id="${escapeAttrSelector(id)}"]`).join(", ");
    return `${selector} { fill: ${CURSOR_COLOR}; stroke: ${CURSOR_COLOR}; }`;
  }, [selection]);

  function handlePageClick(event: ReactMouseEvent<HTMLDivElement>, pageIndex: number) {
    const target = event.target as Element | null;
    const withId = target?.closest("[data-id]") ?? null;
    if (withId) {
      const id = withId.getAttribute("data-id");
      const role = withId.getAttribute("data-role") as Ref["role"] | null;
      if (id && role) onClickElement?.(id, role);
      return;
    }
    if (!onClickEmpty) return;
    const container = pageRefs.current[pageIndex];
    const svg = container?.querySelector("svg") ?? null;
    if (!svg) return;
    const pt = clientPointToSvg(svg, event.clientX, event.clientY);
    if (pt) onClickEmpty(pageIndex, pt.x, pt.y);
  }

  return (
    <div className="page-stack">
      {selectionCss && <style>{selectionCss}</style>}
      {layout.pages.map((page, i) => (
        <div className="page-shadow" key={page.index}>
          <div
            className="page"
            ref={(el) => {
              pageRefs.current[i] = el;
            }}
            onClick={(e) => handlePageClick(e, i)}
          >
            {/* SVG string comes from the pure renderer (src/render/svg.ts), not user input. */}
            <div className="page-content" dangerouslySetInnerHTML={{ __html: pageSvgs[i]! }} />
            {cursorLine && cursorLine.pageIndex === page.index && (
              <svg
                className="editor-overlay"
                viewBox={`0 0 ${page.widthSp} ${page.heightSp}`}
                aria-hidden="true"
              >
                <line
                  x1={cursorLine.x}
                  y1={cursorLine.y1}
                  x2={cursorLine.x}
                  y2={cursorLine.y2}
                  stroke={CURSOR_COLOR}
                  strokeWidth={CURSOR_WIDTH_SP}
                />
              </svg>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
