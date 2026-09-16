/**
 * Applies manual positional offsets (docs/ARCHITECTURE.md, "Selectable markings":
 * `score.layout.nudges`, set via drag in ScoreView.tsx or `setNudge`/`clearNudge`) as
 * one last translation of every primitive belonging to a nudged id.
 *
 * Deliberately a single post-processing pass over the fully-built primitives, rather
 * than threading a nudge into each of the dozen attachment/spanner kinds' own
 * placement math in attachments.ts/spanners.ts: every `Primitive` variant already
 * carries its geometry in a small, fixed set of fields (or, for a path, in its `d`
 * string), so one generic translate-by-id-and-offset function covers all of them.
 *
 * Known limitation: this runs after the system's vertical extent has already been
 * measured (engrave.ts calls it once the final `above`/`below` are set), so a large
 * nudge can push a marking outside the space that was reserved for it and overlap
 * neighbouring content. Nudges are meant for small position tweaks, not relocating a
 * marking freely around the page — for that, re-anchor it to a different note instead.
 */
import type { Id } from "@/model/ids";
import type { GlyphPrim, LinePrim, PathPrim, PolygonPrim, Primitive, TextPrim } from "./layout-types";

export interface Nudge {
  dx: number;
  dy: number;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Shifts every (x, y) coordinate pair in an SVG path `d` string by (dx, dy). Only
 * needs to handle what our own path generators emit (ties.ts, spanners.ts): the
 * absolute commands M, L, C and the no-argument Z, space-separated, no commas — so
 * every number in the string is genuinely part of an (x, y) pair in that order, and a
 * running parity flag (reset to "x next" at each command letter) is all that's needed
 * to tell which half of the pair a given number is.
 */
export function translatePathD(d: string, dx: number, dy: number): string {
  let expectX = true;
  return d
    .split(/\s+/)
    .filter((tok) => tok.length > 0)
    .map((tok) => {
      if (/^[A-Za-z]/.test(tok)) {
        expectX = true;
        return tok;
      }
      const n = Number(tok);
      const shifted = round(expectX ? n + dx : n + dy);
      expectX = !expectX;
      return String(shifted);
    })
    .join(" ");
}

/** Translates one primitive's own geometry by (dx, dy); `staffLines` never carries a `ref` so it's never a nudge target and is returned unchanged. */
function translatePrimitive(prim: Primitive, dx: number, dy: number): Primitive {
  switch (prim.type) {
    case "glyph":
      return { ...prim, x: round(prim.x + dx), y: round(prim.y + dy) } satisfies GlyphPrim;
    case "text":
      return { ...prim, x: round(prim.x + dx), y: round(prim.y + dy) } satisfies TextPrim;
    case "line":
      return {
        ...prim,
        x1: round(prim.x1 + dx),
        y1: round(prim.y1 + dy),
        x2: round(prim.x2 + dx),
        y2: round(prim.y2 + dy),
      } satisfies LinePrim;
    case "polygon":
      return { ...prim, points: prim.points.map(([x, y]) => [round(x + dx), round(y + dy)]) } satisfies PolygonPrim;
    case "path":
      return { ...prim, d: translatePathD(prim.d, dx, dy) } satisfies PathPrim;
    case "staffLines":
      return prim;
  }
}

/**
 * Returns `primitives` with every primitive whose `ref.id` has a recorded nudge
 * translated by that nudge's (dx, dy); primitives with no nudged id pass through
 * unchanged (same reference, so this is cheap when `nudges` is empty or irrelevant).
 */
export function applyNudges(primitives: Primitive[], nudges: Readonly<Record<Id, Nudge>>): Primitive[] {
  if (Object.keys(nudges).length === 0) return primitives;
  return primitives.map((prim) => {
    if (prim.type === "staffLines" || !prim.ref) return prim;
    const nudge = nudges[prim.ref.id];
    if (!nudge) return prim;
    return translatePrimitive(prim, nudge.dx, nudge.dy);
  });
}
