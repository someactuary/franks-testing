/**
 * Vertical layout: where the staves of a system sit relative to each other, and
 * where systems sit on pages.
 *
 * System coordinates have their origin at the top line of the system's first
 * staff, so the first staff always has y = 0.
 */
import type { EngravingSettings, Part } from "@/model/score";
import { ENGRAVING } from "./constants";
import { STAFF_HEIGHT } from "./geometry";

export interface StaffSlot {
  partIndex: number;
  staffIndex: number;
  /** y of the staff's top line in system coordinates. */
  y: number;
}

/**
 * Staff positions inside a system. Staves within a part are `grandStaffGapSp`
 * apart (measured between the facing staff lines); parts are separated by
 * `systemGapSp`.
 */
export function staffSlots(parts: Part[], settings: EngravingSettings): StaffSlot[] {
  const slots: StaffSlot[] = [];
  let y = 0;
  for (const [partIndex, part] of parts.entries()) {
    if (partIndex > 0) y += STAFF_HEIGHT + settings.systemGapSp;
    for (const [staffIndex] of part.staves.entries()) {
      if (staffIndex > 0) y += STAFF_HEIGHT + settings.grandStaffGapSp;
      slots.push({ partIndex, staffIndex, y });
    }
  }
  return slots;
}

/** Distance from the first staff's top line to the last staff's bottom line. */
export function staffSpan(slots: StaffSlot[]): number {
  if (slots.length === 0) return STAFF_HEIGHT;
  return slots[slots.length - 1]!.y + STAFF_HEIGHT;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export interface PageMetrics {
  widthSp: number;
  heightSp: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  contentWidth: number;
  contentHeight: number;
}

export function pageMetrics(settings: EngravingSettings): PageMetrics {
  const sp = settings.staffSpaceMm;
  const { widthMm, heightMm, marginMm } = settings.page;
  const widthSp = widthMm / sp;
  const heightSp = heightMm / sp;
  const left = marginMm.left / sp;
  const right = marginMm.right / sp;
  const top = marginMm.top / sp;
  const bottom = marginMm.bottom / sp;
  return {
    widthSp,
    heightSp,
    left,
    right,
    top,
    bottom,
    contentWidth: widthSp - left - right,
    contentHeight: heightSp - top - bottom,
  };
}

export interface SystemExtent {
  /** Ink reaching above the first staff's top line (>= 0). */
  above: number;
  /** Distance from the first staff's top line to the lowest ink. */
  below: number;
  /** Forced page break before this system. */
  startsPage: boolean;
}

export interface SystemPlacement {
  pageIndex: number;
  /** y of the system origin (first staff's top line) on the page. */
  y: number;
}

/**
 * Stack systems onto pages top to bottom, starting a new page when a system no
 * longer fits or when a page break was forced.
 */
export function paginate(
  extents: SystemExtent[],
  metrics: PageMetrics,
  settings: EngravingSettings,
  firstPageExtraTop: number,
): SystemPlacement[] {
  const out: SystemPlacement[] = [];
  let pageIndex = 0;
  let cursor = metrics.top + firstPageExtraTop;
  let placedAny = false;
  const limit = metrics.top + metrics.contentHeight;

  for (const e of extents) {
    // The very first system always goes where the cursor is; after that a system
    // moves to a fresh page when a break was forced or it no longer fits. A
    // system taller than the whole content area still gets placed (and overflows)
    // rather than looping forever.
    if (placedAny && (e.startsPage || cursor + e.above + e.below > limit)) {
      pageIndex++;
      cursor = metrics.top;
    }
    const y = cursor + e.above;
    out.push({ pageIndex, y });
    cursor = y + e.below + settings.systemGapSp;
    placedAny = true;
  }
  return out;
}

/** Default vertical allowance above and below a system's staves. */
export const STAFF_OVERHANG = ENGRAVING.staffOverhangSp;
