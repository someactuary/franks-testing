/**
 * Tuplet brackets and numbers.
 *
 * Durations are already scaled by `traverse.ts`, so nothing here touches time:
 * noteheads, flags and beams come from the NOTATED duration (semantic.ts) and
 * the columns come from the SOUNDING length (spacing.ts). What is left is the
 * ornament that says "these notes are a tuplet".
 *
 * Like beams, this needs resolved x positions and the final stem tips, so it
 * runs from `emitMeasure` after the events of a staff-measure have been placed.
 *
 * Rules (docs/ARCHITECTURE.md, M2 "Tuplets"):
 *  - bracket and number sit on the stem / beam side of the group;
 *  - the bracket clears the outermost stem tip by `tupletBracketGapSp`, with
 *    hooks of `tupletHookSp` pointing back towards the notes;
 *  - the number sits in a gap in the bracket, centred on the group;
 *  - the bracket is omitted when the whole tuplet is exactly one beam group
 *    (number only) or when `bracket: "hide"`;
 *  - `showNumber`: "actual" (the default) / "ratio" ("3:2") / "none".
 */
import type { Id } from "@/model/ids";
import type { StemDirection, TupletGroup } from "@/model/score";
import type { EngravingDefaults, SmuflFontData } from "@/render/smufl/types";
import { ENGRAVING } from "./constants";
import { glyphBox } from "./geometry";
import type { Primitive, Ref } from "./layout-types";
import type { EventLayout, StaffMeasureLayout } from "./semantic";

/** One tuplet as it appears in a single staff-measure. */
export interface TupletSpan {
  tuplet: TupletGroup;
  /** Nesting depth: 0 = outermost. */
  depth: number;
  /** Indices into the staff-measure's `events`, ascending. */
  members: number[];
}

/** Every tuplet that has events in this staff-measure, outermost first. */
export function tupletSpans(events: EventLayout[]): TupletSpan[] {
  const byId = new Map<Id, TupletSpan>();
  for (const [i, ev] of events.entries()) {
    for (const [depth, t] of ev.tuplets.entries()) {
      const existing = byId.get(t.id);
      if (existing) existing.members.push(i);
      else byId.set(t.id, { tuplet: t, depth, members: [i] });
    }
  }
  return [...byId.values()].sort((a, b) => a.depth - b.depth);
}

/** SMuFL glyph names for the digits of a tuplet number. */
export function tupletDigitGlyphs(n: number): string[] {
  return String(Math.abs(Math.trunc(n)))
    .split("")
    .map((d) => `tuplet${d}`);
}

/** The glyphs of a span's number, or [] when no number is shown. */
function numberGlyphs(t: TupletGroup): string[] {
  const mode = t.showNumber ?? "auto";
  if (mode === "none") return [];
  if (mode === "ratio") {
    return [
      ...tupletDigitGlyphs(t.ratio.actual),
      "tupletColon",
      ...tupletDigitGlyphs(t.ratio.normal),
    ];
  }
  return tupletDigitGlyphs(t.ratio.actual);
}

/**
 * True when every member of the span is beamed and they are exactly the members
 * of one beam group — the case where convention drops the bracket.
 */
function isOneBeamGroup(span: TupletSpan, staff: StaffMeasureLayout): boolean {
  const first = staff.events[span.members[0]!];
  const gi = first?.beamIndex;
  if (gi === undefined) return false;
  for (const i of span.members) {
    if (staff.events[i]?.beamIndex !== gi) return false;
  }
  const group = staff.beams[gi];
  return group !== undefined && group.members.length === span.members.length;
}

/** Stem side the bracket and number belong on. */
function spanSide(span: TupletSpan, staff: StaffMeasureLayout): StemDirection {
  const first = staff.events[span.members[0]!];
  const gi = first?.beamIndex;
  if (gi !== undefined && isOneBeamGroup(span, staff)) {
    return staff.beams[gi]?.dir ?? "up";
  }
  let up = 0;
  let down = 0;
  for (const i of span.members) {
    const dir = staff.events[i]?.stem?.dir;
    if (dir === "up") up++;
    else if (dir === "down") down++;
  }
  return down > up ? "down" : "up";
}

interface Extent {
  left: number;
  right: number;
  outer: number;
}

/** Horizontal ink edges and the outermost ink on `side` of one event. */
function eventExtent(
  ev: EventLayout,
  x: number,
  side: StemDirection,
  tip: number | undefined,
  defaults: EngravingDefaults,
): Extent {
  const lefts: number[] = [];
  const rights: number[] = [];
  const outers: number[] = [];
  for (const n of ev.notes) {
    lefts.push(x + n.x);
    rights.push(x + n.x + n.width);
    outers.push(side === "up" ? n.y - 0.5 : n.y + 0.5);
  }
  if (ev.stem) {
    lefts.push(x + ev.stem.x - defaults.stemThickness / 2);
    rights.push(x + ev.stem.x + defaults.stemThickness / 2);
  }
  if (ev.rest) {
    lefts.push(x);
    rights.push(x + ev.rest.width);
    outers.push(side === "up" ? ev.rest.y - 1 : ev.rest.y + 1);
  }
  const stemTip = tip ?? ev.stem?.yTip;
  if (stemTip !== undefined) outers.push(stemTip);
  if (outers.length === 0) outers.push(2);
  return {
    left: lefts.length > 0 ? Math.min(...lefts) : x,
    right: rights.length > 0 ? Math.max(...rights) : x,
    outer: side === "up" ? Math.min(...outers) : Math.max(...outers),
  };
}

export interface TupletEmitInput {
  font: SmuflFontData;
  defaults: EngravingDefaults;
  staff: StaffMeasureLayout;
  /** y of the staff's top line in system coordinates. */
  staffY: number;
  /** Absolute x of an event's column origin. */
  xOf: (eventIndex: number) => number;
  /** Final stem tips from `beamGeometry`, keyed by event index. */
  stemTips: Map<number, number>;
}

/** Draw every tuplet bracket and number of one staff-measure. */
export function emitTuplets(out: Primitive[], input: TupletEmitInput): void {
  const { font, defaults, staff, staffY } = input;
  const spans = tupletSpans(staff.events);
  if (spans.length === 0) return;
  const maxDepth = Math.max(...spans.map((s) => s.depth));

  for (const span of spans) {
    if (span.members.length === 0) continue;
    const t = span.tuplet;
    const side = spanSide(span, staff);
    const up = side === "up";
    const ref: Ref = { id: t.id, role: "tuplet" };

    const extents = span.members.map((i) =>
      eventExtent(staff.events[i]!, input.xOf(i), side, input.stemTips.get(i), defaults),
    );
    const x1 = extents[0]!.left;
    const x2 = extents[extents.length - 1]!.right;
    const outer = up
      ? Math.min(...extents.map((e) => e.outer))
      : Math.max(...extents.map((e) => e.outer));

    // Nested tuplets stack outwards: the innermost sits closest to the notes.
    const nest = (maxDepth - span.depth) * ENGRAVING.tupletNestStepSp;
    const gap = ENGRAVING.tupletBracketGapSp + nest;
    const lineY = staffY + (up ? outer - gap : outer + gap);

    const glyphNames = numberGlyphs(t);
    const numberWidth = glyphNames.reduce((w, g) => w + glyphBox(font, g).width, 0);
    const numberHeight = glyphNames.length > 0 ? glyphBox(font, glyphNames[0]!).up : 0;
    const centre = (x1 + x2) / 2;

    const mode = t.bracket ?? "auto";
    const showBracket =
      mode === "show" ? true : mode === "hide" ? false : !isOneBeamGroup(span, staff);

    // Without a bracket the number floats clear of the beam instead.
    const numberBaseline = showBracket
      ? lineY + numberHeight / 2
      : up
        ? lineY
        : lineY + numberHeight;

    if (showBracket) {
      const thickness = defaults.tupletBracketThickness;
      const hook = up ? ENGRAVING.tupletHookSp : -ENGRAVING.tupletHookSp;
      const half = numberWidth > 0 ? numberWidth / 2 + ENGRAVING.tupletNumberGapSp : 0;
      const segments: [number, number][] =
        half > 0
          ? [
              [x1, centre - half],
              [centre + half, x2],
            ]
          : [[x1, x2]];
      for (const [a, b] of segments) {
        if (b - a <= 0) continue;
        out.push({ type: "line", x1: a, y1: lineY, x2: b, y2: lineY, thickness, ref });
      }
      for (const x of [x1, x2]) {
        out.push({ type: "line", x1: x, y1: lineY, x2: x, y2: lineY + hook, thickness, ref });
      }
    }

    let nx = centre - numberWidth / 2;
    for (const g of glyphNames) {
      out.push({ type: "glyph", glyph: g, x: nx, y: numberBaseline, ref });
      nx += glyphBox(font, g).width;
    }
  }
}
