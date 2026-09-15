/**
 * Pure geometry/lookup helpers over a `LayoutResult`, shared by the editor
 * store and `ScoreView`. No DOM, no React — see docs/ARCHITECTURE.md
 * invariant 4 (engrave/render are pure); this module keeps that property for
 * the UI's own coordinate math.
 *
 * Coordinate systems, per src/engraving/layout-types.ts:
 *  - `MeasureLayout.columns[].x` and `StaffLayout.y` are SYSTEM-local.
 *  - `System.x`/`System.y` place a system on its Page.
 *  - `hitTestPoint` takes and everything it returns in system-local space is
 *    converted to PAGE-local sp, matching the SVG viewBox `ScoreView` clicks
 *    are measured against.
 */
import { eq, lt, sub, toNumber, ZERO, type Fraction } from "@/model/duration";
import type { Id, Score } from "@/model";
import { allEvents, type Event } from "@/model/traverse";
import type { GlyphPrim, LayoutResult, MeasureLayout, Page, System } from "@/engraving/layout-types";
import { glyphBBox } from "@/render/smufl";
import type { SmuflFontData } from "@/render/smufl/types";

// ---------------------------------------------------------------------------
// findSystemForMeasure
// ---------------------------------------------------------------------------

export interface MeasureLocation {
  page: Page;
  system: System;
  measure: MeasureLayout;
}

/** Finds the page/system/measure-layout for a given global measure index. */
export function findSystemForMeasure(layout: LayoutResult, measureIndex: number): MeasureLocation | null {
  for (const page of layout.pages) {
    for (const system of page.systems) {
      const measure = system.measures.find((m) => m.measureIndex === measureIndex);
      if (measure) return { page, system, measure };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// cursorX
// ---------------------------------------------------------------------------

/**
 * X (system-local sp) of a measure-relative time offset. Exact when `offset`
 * matches a column; otherwise linearly interpolated between the neighbouring
 * columns. An offset past the last column (e.g. the cursor sitting just after
 * the last event, before the barline) resolves to `measure.x + measure.width - 1`;
 * one before the first column (should not normally happen) resolves to the
 * first column's x. Both fall out of the same interpolation formula treating
 * the missing neighbour as coincident with `offset` itself.
 */
export function cursorX(measure: MeasureLayout, offset: Fraction): number {
  const cols = measure.columns;
  if (cols.length === 0) return measure.x;

  for (const c of cols) {
    if (eq(c.offset, offset)) return c.x;
  }

  const first = cols[0]!;
  if (lt(offset, first.offset)) return first.x;

  const last = cols[cols.length - 1]!;
  const endX = measure.x + measure.width - 1;
  if (lt(last.offset, offset)) {
    return endX;
  }

  for (let i = 0; i < cols.length - 1; i++) {
    const lo = cols[i]!;
    const hi = cols[i + 1]!;
    if (lt(lo.offset, offset) && lt(offset, hi.offset)) {
      const t = toNumber(sub(offset, lo.offset)) / toNumber(sub(hi.offset, lo.offset));
      return lo.x + t * (hi.x - lo.x);
    }
  }

  // Unreachable given the checks above, but keep TypeScript (and callers) safe.
  return last.x;
}

// ---------------------------------------------------------------------------
// staffY
// ---------------------------------------------------------------------------

/** Y (system-local sp) of the top line of a given part/staff in this system. */
export function staffY(system: System, partIndex: number, staffIndex: number): number {
  const staff = system.staves.find((s) => s.partIndex === partIndex && s.staffIndex === staffIndex);
  if (!staff) throw new Error(`staffY: no staff for part ${partIndex}, staff ${staffIndex} in this system`);
  return staff.y;
}

// ---------------------------------------------------------------------------
// locateEvent
// ---------------------------------------------------------------------------

export interface EventLocation {
  partIndex: number;
  measureIndex: number;
  staffIndex: number;
  voiceIndex: number;
  offset: Fraction;
}

function collectNoteIds(event: Event, out: Id[]): void {
  if (event.kind === "note") {
    for (const n of event.notes) out.push(n.id);
  }
  if (event.grace) {
    for (const g of event.grace.events) collectNoteIds(g, out);
  }
}

/**
 * Finds the location of an event or note id anywhere in the score. A note id
 * (inside a chord, or a grace note) resolves to its parent event's location —
 * the cursor and selection both operate at event/offset granularity.
 */
export function locateEvent(score: Score, id: Id): EventLocation | null {
  for (const e of allEvents(score)) {
    const event = e.positioned.event;
    if (event.id === id) {
      return {
        partIndex: e.partIndex,
        measureIndex: e.measureIndex,
        staffIndex: e.staffIndex,
        voiceIndex: e.voice.index,
        offset: e.positioned.offset,
      };
    }
    const noteIds: Id[] = [];
    collectNoteIds(event, noteIds);
    if (noteIds.includes(id)) {
      return {
        partIndex: e.partIndex,
        measureIndex: e.measureIndex,
        staffIndex: e.staffIndex,
        voiceIndex: e.voice.index,
        offset: e.positioned.offset,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// hitTestPoint
// ---------------------------------------------------------------------------

export interface HitTestResult {
  measureIndex: number;
  staffIndex: number;
  offset: Fraction;
}

/** Signed distance from `v` to the closed interval [lo, hi]; 0 if inside. */
function distanceToRange(v: number, lo: number, hi: number): number {
  if (v < lo) return lo - v;
  if (v > hi) return v - hi;
  return 0;
}

/**
 * Nearest measure/staff/column to a click at page-local (xSp, ySp) on page
 * `pageIndex`. Picks the vertically-nearest system, then the vertically-
 * nearest staff within it (by proximity to the staff's line block), then the
 * horizontally-nearest measure, then the nearest column (onset) within that
 * measure. Returns null only if the page has no systems/staves/measures.
 */
export function hitTestPoint(layout: LayoutResult, pageIndex: number, xSp: number, ySp: number): HitTestResult | null {
  const page = layout.pages[pageIndex];
  if (!page || page.systems.length === 0) return null;

  let system: System | null = null;
  let systemDist = Infinity;
  for (const sys of page.systems) {
    const d = distanceToRange(ySp, sys.y, sys.y + sys.height);
    if (d < systemDist) {
      systemDist = d;
      system = sys;
    }
  }
  if (!system || system.staves.length === 0 || system.measures.length === 0) return null;

  let staffIndex = system.staves[0]!.staffIndex;
  let staffDist = Infinity;
  for (const st of system.staves) {
    const top = system.y + st.y;
    const bottom = top + (st.lineCount - 1);
    const d = distanceToRange(ySp, top, bottom);
    if (d < staffDist) {
      staffDist = d;
      staffIndex = st.staffIndex;
    }
  }

  let measure = system.measures[0]!;
  let measureDist = Infinity;
  for (const m of system.measures) {
    const left = system.x + m.x;
    const right = left + m.width;
    const d = distanceToRange(xSp, left, right);
    if (d < measureDist) {
      measureDist = d;
      measure = m;
    }
  }

  let offset: Fraction = ZERO;
  let colDist = Infinity;
  for (const c of measure.columns) {
    const cx = system.x + c.x;
    const d = Math.abs(xSp - cx);
    if (d < colDist) {
      colDist = d;
      offset = c.offset;
    }
  }

  return { measureIndex: measure.measureIndex, staffIndex, offset };
}

// ---------------------------------------------------------------------------
// selectionBoxes / idsInRect
// ---------------------------------------------------------------------------

export interface SelectionBox {
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An axis-aligned rectangle in PAGE-local sp coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Page-space bounding box of a notehead/rest glyph primitive, from the SMuFL
 * font's glyph bbox. SMuFL bboxes are y UP relative to the glyph origin;
 * layout/page space is y DOWN, so the vertical extent is flipped: the bbox's
 * `ne` (max y up = visually highest point) becomes the smaller (top) page y.
 */
function glyphPrimPageBox(prim: GlyphPrim, system: System, font: SmuflFontData): { x: number; y: number; w: number; h: number } {
  const bbox = glyphBBox(font, prim.glyph);
  const scale = prim.scale ?? 1;
  const left = prim.x + bbox.sw[0] * scale;
  const right = prim.x + bbox.ne[0] * scale;
  const top = prim.y - bbox.ne[1] * scale;
  const bottom = prim.y - bbox.sw[1] * scale;
  return {
    x: system.x + left,
    y: system.y + top,
    w: right - left,
    h: bottom - top,
  };
}

/**
 * Bounding boxes (page sp coordinates) of the notehead/rest glyph for each
 * requested id. A note id yields the box of its notehead glyph; an event id
 * (a rest) yields the box of its rest glyph. An id with no matching
 * notehead/rest primitive (unknown id, or an id that only labels some other
 * kind of primitive) contributes no box.
 */
export function selectionBoxes(layout: LayoutResult, font: SmuflFontData, ids: Id[]): SelectionBox[] {
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  const boxes: SelectionBox[] = [];
  for (const page of layout.pages) {
    for (const system of page.systems) {
      for (const prim of system.primitives) {
        if (prim.type !== "glyph") continue;
        const ref = prim.ref;
        if (!ref || (ref.role !== "notehead" && ref.role !== "rest")) continue;
        if (!wanted.has(ref.id)) continue;
        boxes.push({ pageIndex: page.index, ...glyphPrimPageBox(prim, system, font) });
      }
    }
  }
  return boxes;
}

/**
 * Ids of every notehead/rest primitive on `pageIndex` whose page-space
 * bounding box intersects `rect` (edge-touching only doesn't count).
 * Noteheads contribute their note id, rests their event id; results are
 * deduplicated (a chord's notes are separate primitives/ids; a rest's dots
 * are not selectable and don't contribute).
 */
export function idsInRect(layout: LayoutResult, font: SmuflFontData, pageIndex: number, rect: Rect): Id[] {
  const page = layout.pages[pageIndex];
  if (!page) return [];
  const ids = new Set<Id>();
  for (const system of page.systems) {
    for (const prim of system.primitives) {
      if (prim.type !== "glyph") continue;
      const ref = prim.ref;
      if (!ref || (ref.role !== "notehead" && ref.role !== "rest")) continue;
      const box = glyphPrimPageBox(prim, system, font);
      const intersects =
        box.x < rect.x + rect.w && box.x + box.w > rect.x && box.y < rect.y + rect.h && box.y + box.h > rect.y;
      if (intersects) ids.add(ref.id);
    }
  }
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// pdfPageForMeasure
// ---------------------------------------------------------------------------

/**
 * Which page of the *original PDF* a given measure came from, for the OMR
 * compare panel (docs/ARCHITECTURE.md "M4 contracts"). `pageBreaks` is
 * `score.layout.pageBreaks` — measure indices where a new page starts, i.e.
 * a break entry `b` means "page increments at measure `b`". The result is
 * 0-based: the count of break entries at or before `measureIndex`.
 */
export function pdfPageForMeasure(pageBreaks: readonly number[], measureIndex: number): number {
  let page = 0;
  for (const b of pageBreaks) {
    if (b <= measureIndex) page++;
  }
  return page;
}
