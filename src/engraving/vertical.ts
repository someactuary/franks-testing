/**
 * Vertical layout: where the staves of a system sit relative to each other, and
 * where systems sit on pages.
 *
 * System coordinates have their origin at the top line of the system's first
 * staff, so the first staff always has y = 0.
 *
 * Staves are spaced by content (docs/ARCHITECTURE.md, "M4 contracts: Engraving
 * fix"): the gap between the facing lines of staff k and staff k+1 is
 *
 *     max(default gap, below(k) + above(k+1) + interStaffClearanceSp)
 *
 * where below/above are how far everything drawn for a staff reaches past its
 * own bottom/top line (see staff-spacing.ts). engrave.ts measures those extents
 * on a provisional layout (`provisionalSlots`) and then lays each system out
 * again at the positions `staffSlots` returns for them.
 */
import type { EngravingSettings, Part } from "@/model/score";
import { ENGRAVING } from "./constants";
import { STAFF_HEIGHT } from "./geometry";

export interface StaffSlot {
  partIndex: number;
  staffIndex: number;
  /** y of the staff's top line in system coordinates. */
  y: number;
  /**
   * The vertical band this staff owns for skyline purposes (skyline.ts). When
   * absent the band reaches half way to the neighbouring staves. Content-spaced
   * slots set it to the middle of the clear space between the two staves' ink,
   * so ink is always attributed to the staff it was drawn for.
   */
  zoneTop?: number;
  zoneBottom?: number;
}

/** How far a staff's ink reaches past its own lines, in sp (both >= 0). */
export interface StaffExtent {
  /** Above the top line. */
  above: number;
  /** Below the bottom line. */
  below: number;
}

/**
 * Staff positions inside a system. Without `extents`, staves within a part are
 * `grandStaffGapSp` apart (measured between the facing staff lines) and parts
 * `systemGapSp` apart. With `extents` (one per slot), a gap grows to
 * `below(k) + above(k+1) + interStaffClearanceSp` when that is larger, and each
 * slot's skyline zone ends in the middle of the clear space.
 */
export function staffSlots(
  parts: Part[],
  settings: EngravingSettings,
  extents?: readonly StaffExtent[],
): StaffSlot[] {
  const slots: StaffSlot[] = [];
  let y = 0;
  for (const [partIndex, part] of parts.entries()) {
    for (const [staffIndex] of part.staves.entries()) {
      const i = slots.length;
      if (i === 0) {
        slots.push({ partIndex, staffIndex, y });
        continue;
      }
      const fallback = staffIndex > 0 ? settings.grandStaffGapSp : settings.systemGapSp;
      if (!extents) {
        y += STAFF_HEIGHT + fallback;
        slots.push({ partIndex, staffIndex, y });
        continue;
      }
      const below = extents[i - 1]?.below ?? 0;
      const above = extents[i]?.above ?? 0;
      const need = below + above + ENGRAVING.interStaffClearanceSp;
      const gap = need > fallback ? need : fallback;
      const prevBottom = y + STAFF_HEIGHT;
      y += STAFF_HEIGHT + gap;
      // The boundary between the two staves' zones: the middle of the space that
      // neither staff's ink reaches into.
      const boundary = prevBottom + below + (gap - below - above) / 2;
      slots[i - 1]!.zoneBottom = boundary;
      slots.push({ partIndex, staffIndex, y, zoneTop: boundary });
    }
  }
  return slots;
}

/**
 * Staff positions for the provisional pass: staves so far apart that nothing
 * drawn for one can reach another, so every piece of ink is attributed to the
 * staff it belongs to and each staff's extents can be measured in isolation.
 */
export function provisionalSlots(parts: Part[]): StaffSlot[] {
  const slots: StaffSlot[] = [];
  for (const [partIndex, part] of parts.entries()) {
    for (const [staffIndex] of part.staves.entries()) {
      slots.push({ partIndex, staffIndex, y: slots.length * ENGRAVING.provisionalStaffPitchSp });
    }
  }
  return slots;
}

/** Distance from the first staff's top line to the last staff's bottom line. */
export function staffSpan(slots: readonly StaffSlot[]): number {
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
