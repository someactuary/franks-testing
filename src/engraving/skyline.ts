/**
 * Skylines: the top and bottom ink profile of each staff of a system.
 *
 * Attachments and spanners are placed *outside* the music that is already on the
 * page, so they need to know how far the ink reaches above and below each staff
 * over a given horizontal range. `buildSkyline` derives that from the primitives
 * the note/beam/tie passes have already emitted; every item placed afterwards
 * adds itself back (`addAbove` / `addBelow`) so the next one stacks outward
 * instead of overlapping.
 *
 * A skyline is deliberately a plain list of `{x1, x2, y}` segments rather than a
 * fixed-resolution array: the number of items per system is small, the queries
 * are range queries, and an unquantised list keeps the geometry exact.
 *
 * Coordinates are system coordinates (sp, y down), exactly like the primitives.
 */
import type { SmuflFontData } from "@/render/smufl/types";
import { glyphBox, pathBounds, STAFF_HEIGHT } from "./geometry";
import type { Primitive, Ref } from "./layout-types";
import type { StaffSlot } from "./vertical";

export interface SkylineSegment {
  x1: number;
  x2: number;
  /** y of the ink's outer edge over [x1, x2]. */
  y: number;
}

export interface StaffSkyline {
  partIndex: number;
  staffIndex: number;
  /** y of the staff's top line. */
  staffY: number;
  /** Vertical band this staff owns; ink outside it belongs to a neighbour. */
  zoneTop: number;
  zoneBottom: number;
  /** Ink above the staff: the smallest y wins. */
  top: SkylineSegment[];
  /** Ink below the staff: the largest y wins. */
  bottom: SkylineSegment[];
}

/** One entry per staff slot of the system, in `slots` order. */
export type SystemSkyline = StaffSkyline[];

export interface Ink {
  x1: number;
  x2: number;
  minY: number;
  maxY: number;
}

/**
 * Roles that belong to the system rather than to one staff: a barline runs from
 * the top staff to the bottom one and a measure number floats above everything,
 * so neither says anything about how far a staff's *music* reaches.
 */
const IGNORED_ROLES: ReadonlySet<Ref["role"]> = new Set<Ref["role"]>(["barline", "measure"]);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The highest ink (smallest y) over [x1, x2], never below the staff's top line.
 * Place an item above the staff at `clearanceAbove(...) - gap`.
 */
export function clearanceAbove(sk: StaffSkyline, x1: number, x2: number): number {
  let y = sk.staffY;
  for (const s of sk.top) {
    if (s.x2 > x1 && s.x1 < x2 && s.y < y) y = s.y;
  }
  return y;
}

/**
 * The lowest ink (largest y) over [x1, x2], never above the staff's bottom line.
 * Place an item below the staff at `clearanceBelow(...) + gap`.
 */
export function clearanceBelow(sk: StaffSkyline, x1: number, x2: number): number {
  let y = sk.staffY + STAFF_HEIGHT;
  for (const s of sk.bottom) {
    if (s.x2 > x1 && s.x1 < x2 && s.y > y) y = s.y;
  }
  return y;
}

/** Record ink whose top edge is `y` over [x1, x2]. */
export function addAbove(sk: StaffSkyline, x1: number, x2: number, y: number): void {
  sk.top.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y });
}

/** Record ink whose bottom edge is `y` over [x1, x2]. */
export function addBelow(sk: StaffSkyline, x1: number, x2: number, y: number): void {
  sk.bottom.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y });
}

/** Record a whole ink rectangle on both profiles. */
export function addInk(sk: StaffSkyline, ink: Ink): void {
  addAbove(sk, ink.x1, ink.x2, Math.max(ink.minY, sk.zoneTop));
  addBelow(sk, ink.x1, ink.x2, Math.min(ink.maxY, sk.zoneBottom));
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** Rough ink box of a text primitive; only its own emitters know the exact one. */
function textInk(p: Extract<Primitive, { type: "text" }>): Ink {
  // Serif/sans digits and letters average a little over half their size in width;
  // dynamics are drawn as SMuFL glyphs, which are wider.
  const perChar = p.style === "dynamic" ? 0.36 : 0.55;
  const width = Math.max(p.size * 0.5, p.text.length * p.size * perChar);
  const anchor = p.anchor ?? "start";
  const x1 = anchor === "middle" ? p.x - width / 2 : anchor === "end" ? p.x - width : p.x;
  return { x1, x2: x1 + width, minY: p.y - p.size * 0.8, maxY: p.y + p.size * 0.25 };
}

/** Ink box of one primitive, or undefined when it carries no useful ink. */
export function primitiveInk(p: Primitive, font: SmuflFontData): Ink | undefined {
  if ("ref" in p && p.ref && IGNORED_ROLES.has(p.ref.role)) return undefined;
  switch (p.type) {
    case "glyph": {
      const box = glyphBox(font, p.glyph);
      const s = p.scale ?? 1;
      return {
        x1: p.x + box.left * s,
        x2: p.x + Math.max(box.right, box.width) * s,
        minY: p.y - box.up * s,
        maxY: p.y + box.down * s,
      };
    }
    case "line": {
      const half = p.thickness / 2;
      return {
        x1: Math.min(p.x1, p.x2) - half,
        x2: Math.max(p.x1, p.x2) + half,
        minY: Math.min(p.y1, p.y2) - half,
        maxY: Math.max(p.y1, p.y2) + half,
      };
    }
    case "polygon": {
      if (p.points.length === 0) return undefined;
      const xs = p.points.map(([x]) => x);
      const ys = p.points.map(([, y]) => y);
      return { x1: Math.min(...xs), x2: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    case "path": {
      const b = pathBounds(p.d);
      return b ? { x1: b.minX, x2: b.maxX, minY: b.minY, maxY: b.maxY } : undefined;
    }
    case "text":
      return textInk(p);
    default:
      // staffLines: the staff itself is the skyline's baseline.
      return undefined;
  }
}

/** The staff each piece of ink belongs to: the one whose zone holds its middle. */
function zoneOf(skylines: SystemSkyline, midY: number): StaffSkyline | undefined {
  for (const sk of skylines) {
    if (midY >= sk.zoneTop && midY < sk.zoneBottom) return sk;
  }
  return skylines[skylines.length - 1];
}

/**
 * Top/bottom ink profile of every staff of one system.
 *
 * Each staff owns the band that reaches half way to its neighbours (and to
 * infinity outwards for the first and last staff); ink is attributed to the
 * staff whose band contains its vertical middle and clipped to that band, so a
 * long stem between two staves cannot make its neighbour's skyline lie.
 */
export function buildSkyline(
  primitives: readonly Primitive[],
  slots: readonly StaffSlot[],
  font: SmuflFontData,
): SystemSkyline {
  const skylines: SystemSkyline = slots.map((slot, i) => {
    const prev = slots[i - 1];
    const next = slots[i + 1];
    return {
      partIndex: slot.partIndex,
      staffIndex: slot.staffIndex,
      staffY: slot.y,
      zoneTop: prev ? (prev.y + STAFF_HEIGHT + slot.y) / 2 : -Infinity,
      zoneBottom: next ? (slot.y + STAFF_HEIGHT + next.y) / 2 : Infinity,
      top: [],
      bottom: [],
    };
  });

  for (const p of primitives) {
    const ink = primitiveInk(p, font);
    if (!ink) continue;
    const sk = zoneOf(skylines, (ink.minY + ink.maxY) / 2);
    if (sk) addInk(sk, ink);
  }
  return skylines;
}

/** The skyline of the staff at `slotIndex`, for callers that hold a slot index. */
export function staffSkyline(skyline: SystemSkyline, slotIndex: number): StaffSkyline | undefined {
  return skyline[slotIndex];
}
