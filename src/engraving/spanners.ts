/**
 * Spanners: everything drawn between two points in time — slurs, hairpins,
 * pedal lines, ottavas, trill lines and glissandi.
 *
 * Runs after attachments.ts, so the skyline it reads already contains the
 * articulations, fingerings and dynamics that pass placed: a slur clears them,
 * and a hairpin knows where the dynamics lane ended up.
 *
 * A spanner whose ends fall on different systems is cut into one piece per
 * system, following the two-piece rule ties.ts uses: the first piece runs to the
 * right edge of its system, the last starts just after the next system's prefix,
 * and any system in between is crossed at full width.
 */
import type { Spanner } from "@/model/score";
import type { EngravingDefaults } from "@/render/smufl/types";
import { ENGRAVING } from "./constants";
import { glyphBox } from "./geometry";
import type { GlyphPrim, LinePrim, PathPrim, Primitive, Ref } from "./layout-types";
import {
  buildSites,
  bottomSlotOfPart,
  dynamicsLaneTop,
  EXPRESSIVE,
  pedalLaneTop,
  resolveAnchor,
  type AnchorSite,
  type EmitContext,
  type EmitSystem,
  type SiteIndex,
  type SystemExtent,
} from "./attachments";
import { stemDirectionForSteps, type NoteLayout } from "./semantic";
import {
  addAbove,
  addBelow,
  buildSkyline,
  clearanceAbove,
  clearanceBelow,
  type StaffSkyline,
  type SystemSkyline,
} from "./skyline";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const SPANNER = {
  /** Gap between a notehead and a slur endpoint. */
  slurEndGapSp: 0.9,
  /** Slur arc height: `min + ratio * length`, clamped. */
  slurHeightRatio: 0.11,
  slurMinHeightSp: 0.5,
  slurMaxHeightSp: 2.5,
  /** Clearance a slur keeps from the ink under (or over) its arc. */
  slurClearSp: 0.35,
  /** Hard ceiling on the arc height once the skyline has been cleared. */
  slurClearedMaxHeightSp: 4.5,
  /** Horizontal inset of the slur's control points, as a fraction of its length. */
  slurShoulderRatio: 0.26,

  /** Total opening of a hairpin at its wide end. */
  hairpinOpeningSp: 1.2,
  /** A dynamic this close to a hairpin's end stops it short. */
  hairpinDynamicWindowSp: 1.2,
  /** Gap the hairpin leaves before that dynamic. */
  hairpinDynamicGapSp: 0.5,

  /** Upward hooks at each end of a pedal line. */
  pedalHookSp: 1.0,

  /** Gap between the staff (or the ink beside it) and an ottava line. */
  ottavaGapSp: 0.8,
  ottavaDash: [0.5, 0.4] as number[],
  /** Downward (or upward) hook that closes an ottava. */
  ottavaHookSp: 0.75,
  /** Gap between the ottava glyph and the start of its dashed line. */
  ottavaGlyphGapSp: 0.3,
  /** Shortest dashed line an ottava draws, so the hook never lands on the glyph. */
  ottavaMinLineSp: 1.2,

  /** Gap between the staff and a trill line. */
  trillGapSp: 0.8,

  /** Gap between a notehead and the end of a glissando line. */
  glissGapSp: 0.3,
  glissThicknessSp: 0.16,

  /** Margin between a broken spanner's first piece and the system's right edge. */
  breakMarginSp: 0.6,
} as const;

// ---------------------------------------------------------------------------
// Slur shape
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * A filled slur between two points: the outer edge out and the inner edge back,
 * `slurEndpointThickness` at the ends and `slurMidpointThickness` in the middle.
 * Unlike a tie the arc height is supplied by the caller, which has already
 * checked it against the skyline.
 */
export function slurPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  side: "above" | "below",
  height: number,
  defaults: EngravingDefaults,
): string {
  const dir = side === "above" ? -1 : 1;
  const len = Math.max(x2 - x1, ENGRAVING.tieMinLengthSp);
  const sx = Math.min(len * SPANNER.slurShoulderRatio, len / 2);
  const end = defaults.slurEndpointThickness / 2;
  const mid = defaults.slurMidpointThickness / 2;
  // The curve reaches about 3/4 of its control-point height, so aim higher.
  const h = (height * 4) / 3;
  const outer = dir * (h + mid);
  const inner = dir * (h - mid);
  const n = (v: number) => String(round(v));
  return [
    `M ${n(x1)} ${n(y1 + dir * end)}`,
    `C ${n(x1 + sx)} ${n(y1 + outer)} ${n(x2 - sx)} ${n(y2 + outer)} ${n(x2)} ${n(y2 + dir * end)}`,
    `L ${n(x2)} ${n(y2 - dir * end)}`,
    `C ${n(x2 - sx)} ${n(y2 + inner)} ${n(x1 + sx)} ${n(y1 + inner)} ${n(x1)} ${n(y1 - dir * end)}`,
    "Z",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Splitting across systems
// ---------------------------------------------------------------------------

export interface SpannerPiece {
  systemIndex: number;
  x1: number;
  x2: number;
  /** True when this piece carries the spanner's real start (resp. end). */
  first: boolean;
  last: boolean;
}

/** x at which a continuation piece may start on a system: after its prefix. */
function resumeX(sys: EmitSystem): number {
  const first = sys.spacings[0];
  return (first ? first.x + first.prefix.width : 0) + ENGRAVING.tieAfterPrefixSp;
}

export function splitPieces(
  systems: readonly EmitSystem[],
  from: AnchorSite,
  to: AnchorSite,
): SpannerPiece[] {
  if (from.systemIndex === to.systemIndex) {
    return [{ systemIndex: from.systemIndex, x1: from.x, x2: to.x, first: true, last: true }];
  }
  const out: SpannerPiece[] = [];
  for (let i = from.systemIndex; i <= to.systemIndex; i++) {
    const sys = systems[i];
    if (!sys) continue;
    const first = i === from.systemIndex;
    const last = i === to.systemIndex;
    const x1 = first ? from.x : resumeX(sys);
    const x2 = last ? to.x : sys.width - SPANNER.breakMarginSp;
    if (x2 - x1 < ENGRAVING.tieMinLengthSp) continue;
    out.push({ systemIndex: i, x1, x2, first, last });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

interface Pass {
  ctx: EmitContext;
  index: SiteIndex;
  skylines: SystemSkyline[];
  extents: SystemExtent[];
  systems: readonly EmitSystem[];
  /** Where every dynamic ended up, so hairpins can stop short of one. */
  dynamics: { systemIndex: number; slotIndex: number; x: number }[];
}

function record(ext: SystemExtent, minY: number, maxY: number): void {
  if (-minY > ext.above) ext.above = -minY;
  if (maxY > ext.below) ext.below = maxY;
}

function push(pass: Pass, systemIndex: number, prim: Primitive): void {
  pass.systems[systemIndex]?.primitives.push(prim);
}

/**
 * Draw every spanner of the score. Returns, per system, how far the new ink
 * reaches above and below the system origin.
 */
export function emitSpanners(systems: EmitSystem[], ctx: EmitContext): SystemExtent[] {
  const index = buildSites(systems, ctx.slots);
  const pass: Pass = {
    ctx,
    index,
    // Rebuilt here, so it already contains everything attachments.ts drew.
    skylines: systems.map((s) => buildSkyline(s.primitives, ctx.slots, ctx.font)),
    extents: systems.map(() => ({ above: 0, below: 0 })),
    systems,
    dynamics: [],
  };

  for (const a of ctx.score.attachments) {
    if (a.kind !== "dynamic") continue;
    const site = resolveAnchor(index, ctx.slots, a.anchor, a.partIndex, a.staffIndex);
    if (site) pass.dynamics.push({ systemIndex: site.systemIndex, slotIndex: site.slotIndex, x: site.x });
  }

  for (const spanner of ctx.score.spanners) {
    const from = resolveAnchor(index, ctx.slots, spanner.start, spanner.partIndex, spanner.staffIndex);
    const to = resolveAnchor(index, ctx.slots, spanner.end, spanner.partIndex, spanner.staffIndex);
    if (!from || !to) continue;
    if (to.systemIndex < from.systemIndex) continue;
    switch (spanner.kind) {
      case "slur":
        emitSlur(pass, spanner, from, to);
        break;
      case "hairpin":
        emitHairpin(pass, spanner, from, to);
        break;
      case "pedal":
        emitPedal(pass, spanner, from, throughNote(to));
        break;
      case "ottava":
        emitOttava(pass, spanner, from, throughNote(to));
        break;
      case "trillLine":
        emitTrillLine(pass, spanner, from, throughNote(to));
        break;
      case "glissando":
        emitGlissando(pass, spanner, from, to);
        break;
    }
  }

  return pass.extents;
}

function skylineOf(pass: Pass, systemIndex: number, slotIndex: number): StaffSkyline | undefined {
  return pass.skylines[systemIndex]?.[slotIndex];
}

/**
 * A bracket-shaped spanner (pedal, ottava, trill) covers its last note whole,
 * so its end moves from the note's column origin to the right edge of its ink.
 */
function throughNote(site: AnchorSite): AnchorSite {
  return site.event ? { ...site, x: site.x + site.event.ev.right } : site;
}

// --- slurs -----------------------------------------------------------------

function outerNote(notes: NoteLayout[], side: "above" | "below"): NoteLayout | undefined {
  if (notes.length === 0) return undefined;
  return side === "above" ? notes[notes.length - 1] : notes[0];
}

function emitSlur(
  pass: Pass,
  spanner: Spanner & { kind: "slur" },
  from: AnchorSite,
  to: AnchorSite,
): void {
  const defaults = pass.ctx.defaults;
  const ref: Ref = { id: spanner.id, role: "slur" };

  // Opposite the stems; above when the two ends disagree.
  const dirs = [from.event, to.event]
    .filter((s) => s !== undefined)
    .map((s) => s.ev.stem?.dir ?? stemDirectionForSteps(s.ev.notes.map((n) => n.step)));
  const side: "above" | "below" =
    spanner.placement === "above"
      ? "above"
      : spanner.placement === "below"
        ? "below"
        : dirs.length > 0 && dirs.every((d) => d === "up")
          ? "below"
          : "above";
  const dir = side === "above" ? -1 : 1;

  const endY = (site: AnchorSite): number => {
    const note = site.event ? outerNote(site.event.ev.notes, side) : undefined;
    if (!note) return site.staffY + 2;
    return site.staffY + note.y + dir * (0.5 + SPANNER.slurEndGapSp);
  };
  const endX = (site: AnchorSite): number => {
    const note = site.event ? outerNote(site.event.ev.notes, side) : undefined;
    return note ? site.x + note.x + note.width / 2 : site.x;
  };

  const y1 = endY(from);
  const y2 = endY(to);
  const pieces = splitPieces(pass.systems, { ...from, x: endX(from) }, { ...to, x: endX(to) });

  for (const piece of pieces) {
    const sk = skylineOf(pass, piece.systemIndex, from.slotIndex);
    const a = piece.first ? y1 : y2;
    const b = piece.last ? y2 : y1;
    drawSlurPiece(pass, piece, sk, a, b, side, ref, defaults);
  }
}

function drawSlurPiece(
  pass: Pass,
  piece: SpannerPiece,
  sk: StaffSkyline | undefined,
  y1: number,
  y2: number,
  side: "above" | "below",
  ref: Ref,
  defaults: EngravingDefaults,
): void {
  const dir = side === "above" ? -1 : 1;
  const len = piece.x2 - piece.x1;
  if (len < ENGRAVING.tieMinLengthSp) return;

  let height = Math.min(
    SPANNER.slurMaxHeightSp,
    Math.max(SPANNER.slurMinHeightSp, len * SPANNER.slurHeightRatio),
  );
  let a = y1;
  let b = y2;

  if (sk) {
    // Anything already placed over the notehead — a fingering, an articulation —
    // sits *inside* the slur, so each endpoint first clears its own column...
    const clearAt = (x: number, y: number): number => {
      const limit =
        side === "above"
          ? clearanceAbove(sk, x - 0.6, x + 0.6) - SPANNER.slurClearSp
          : clearanceBelow(sk, x - 0.6, x + 0.6) + SPANNER.slurClearSp;
      return side === "above" ? Math.min(y, limit) : Math.max(y, limit);
    };
    a = clearAt(piece.x1, a);
    b = clearAt(piece.x2, b);

    // ... and then the arc deepens until it clears everything in between.
    const limit =
      side === "above"
        ? clearanceAbove(sk, piece.x1, piece.x2) - SPANNER.slurClearSp
        : clearanceBelow(sk, piece.x1, piece.x2) + SPANNER.slurClearSp;
    const base = side === "above" ? Math.min(a, b) : Math.max(a, b);
    const need = side === "above" ? base - height - limit : limit - (base + height);
    if (need > 0) height = Math.min(SPANNER.slurClearedMaxHeightSp, height + need);
  }
  push(pass, piece.systemIndex, {
    type: "path",
    d: slurPath(piece.x1, a, piece.x2, b, side, height, defaults),
    fill: true,
    ref,
  } satisfies PathPrim);

  const apexY = (side === "above" ? Math.min(a, b) : Math.max(a, b)) + dir * height;
  if (sk) {
    if (side === "above") addAbove(sk, piece.x1, piece.x2, apexY);
    else addBelow(sk, piece.x1, piece.x2, apexY);
  }
  const ext = pass.extents[piece.systemIndex]!;
  record(ext, Math.min(a, b, apexY), Math.max(a, b, apexY));
}

// --- hairpins --------------------------------------------------------------

function emitHairpin(
  pass: Pass,
  spanner: Spanner & { kind: "hairpin" },
  from: AnchorSite,
  to: AnchorSite,
): void {
  const ref: Ref = { id: spanner.id, role: "hairpin" };
  const thickness = pass.ctx.defaults.hairpinThickness;
  const pieces = splitPieces(pass.systems, from, to);

  for (const piece of pieces) {
    const sk = skylineOf(pass, piece.systemIndex, from.slotIndex);
    if (!sk) continue;
    let x2 = piece.x2;
    if (piece.last) {
      // Stop short of a dynamic sitting at (or just after) the hairpin's end.
      for (const d of pass.dynamics) {
        if (d.systemIndex !== piece.systemIndex || d.slotIndex !== from.slotIndex) continue;
        if (Math.abs(d.x - x2) > SPANNER.hairpinDynamicWindowSp) continue;
        x2 = Math.min(x2, d.x - SPANNER.hairpinDynamicGapSp);
      }
    }
    if (x2 - piece.x1 < ENGRAVING.tieMinLengthSp) continue;

    const centre = dynamicsLaneTop(sk, piece.x1, x2) + EXPRESSIVE.dynamicHeightSp / 2;
    const half = SPANNER.hairpinOpeningSp / 2;
    // A crescendo opens to the right; a diminuendo opens to the left. A piece
    // that carries neither end of the spanner stays fully open.
    const openLeft = spanner.shape === "dim" ? piece.first : false;
    const openRight = spanner.shape === "cresc" ? piece.last : false;
    const y1a = openLeft ? centre - half : centre;
    const y1b = openLeft ? centre + half : centre;
    const y2a = openRight ? centre - half : centre;
    const y2b = openRight ? centre + half : centre;
    const line = (ya: number, yb: number): LinePrim => ({
      type: "line",
      x1: piece.x1,
      y1: ya,
      x2,
      y2: yb,
      thickness,
      ref,
    });
    push(pass, piece.systemIndex, line(y1a, y2a));
    push(pass, piece.systemIndex, line(y1b, y2b));
    addBelow(sk, piece.x1, x2, centre + half);
    record(pass.extents[piece.systemIndex]!, centre - half, centre + half);
  }
}

// --- pedal -----------------------------------------------------------------

function emitPedal(
  pass: Pass,
  spanner: Spanner & { kind: "pedal" },
  from: AnchorSite,
  to: AnchorSite,
): void {
  const ref: Ref = { id: spanner.id, role: "pedal" };
  const slotIndex = bottomSlotOfPart(pass.ctx.slots, spanner.partIndex);
  const font = pass.ctx.font;
  const pieces = splitPieces(pass.systems, from, to);

  for (const piece of pieces) {
    const sk = skylineOf(pass, piece.systemIndex, slotIndex);
    if (!sk) continue;
    const lane = pedalLaneTop(sk, piece.x1, piece.x2);

    if (spanner.style === "text") {
      if (piece.first) {
        const box = glyphBox(font, "keyboardPedalPed");
        const y = lane + box.up;
        push(pass, piece.systemIndex, {
          type: "glyph",
          glyph: "keyboardPedalPed",
          x: piece.x1,
          y,
          ref,
        } satisfies GlyphPrim);
        addBelow(sk, piece.x1, piece.x1 + box.width, y + box.down);
        record(pass.extents[piece.systemIndex]!, y - box.up, y + box.down);
      }
      if (piece.last) {
        const box = glyphBox(font, "keyboardPedalUp");
        const y = lane + box.up;
        const x = piece.x2 - box.width / 2;
        push(pass, piece.systemIndex, {
          type: "glyph",
          glyph: "keyboardPedalUp",
          x,
          y,
          ref,
        } satisfies GlyphPrim);
        addBelow(sk, x, x + box.width, y + box.down);
        record(pass.extents[piece.systemIndex]!, y - box.up, y + box.down);
      }
      continue;
    }

    // Line style: a horizontal line with an upward hook at each real end.
    const thickness = pass.ctx.defaults.pedalLineThickness;
    const y = lane + SPANNER.pedalHookSp;
    push(pass, piece.systemIndex, {
      type: "line",
      x1: piece.x1,
      y1: y,
      x2: piece.x2,
      y2: y,
      thickness,
      ref,
    } satisfies LinePrim);
    if (piece.first) {
      push(pass, piece.systemIndex, {
        type: "line",
        x1: piece.x1,
        y1: y,
        x2: piece.x1,
        y2: y - SPANNER.pedalHookSp,
        thickness,
        ref,
      } satisfies LinePrim);
    }
    if (piece.last) {
      push(pass, piece.systemIndex, {
        type: "line",
        x1: piece.x2,
        y1: y,
        x2: piece.x2,
        y2: y - SPANNER.pedalHookSp,
        thickness,
        ref,
      } satisfies LinePrim);
    }
    addBelow(sk, piece.x1, piece.x2, y + thickness / 2);
    record(pass.extents[piece.systemIndex]!, y - SPANNER.pedalHookSp, y + thickness / 2);
  }
}

// --- ottava ----------------------------------------------------------------

function ottavaGlyphName(shift: 8 | 15 | -8 | -15): string {
  // Bravura has no 15ma/15mb pair in the generated subset; fall back to 8va/8vb.
  return shift > 0 ? "ottavaAlta" : "ottavaBassa";
}

function emitOttava(
  pass: Pass,
  spanner: Spanner & { kind: "ottava" },
  from: AnchorSite,
  to: AnchorSite,
): void {
  const ref: Ref = { id: spanner.id, role: "ottava" };
  const above = spanner.shift > 0;
  const dir = above ? -1 : 1;
  const glyph = ottavaGlyphName(spanner.shift);
  const box = glyphBox(pass.ctx.font, glyph);
  const thickness = pass.ctx.defaults.octaveLineThickness;
  const pieces = splitPieces(pass.systems, from, to);

  for (const piece of pieces) {
    const sk = skylineOf(pass, piece.systemIndex, from.slotIndex);
    if (!sk) continue;
    const edge = above
      ? clearanceAbove(sk, piece.x1, piece.x2) - SPANNER.ottavaGapSp
      : clearanceBelow(sk, piece.x1, piece.x2) + SPANNER.ottavaGapSp;
    const glyphY = above ? edge - box.down : edge + box.up;
    let lineX = piece.x1;
    // The dashed line runs from the glyph's optical middle height.
    const lineY = above ? glyphY - box.up / 2 : glyphY + box.down - box.up / 2;

    if (piece.first) {
      push(pass, piece.systemIndex, {
        type: "glyph",
        glyph,
        x: piece.x1,
        y: glyphY,
        ref,
      } satisfies GlyphPrim);
      lineX = piece.x1 + box.width + SPANNER.ottavaGlyphGapSp;
    }
    // A span shorter than the glyph still gets a stub of line, so its hook does
    // not land on top of the "8va".
    const lineEnd = Math.max(piece.x2, lineX + SPANNER.ottavaMinLineSp);
    push(pass, piece.systemIndex, {
      type: "line",
      x1: lineX,
      y1: lineY,
      x2: lineEnd,
      y2: lineY,
      thickness,
      dash: [...SPANNER.ottavaDash],
      ref,
    } satisfies LinePrim);
    if (piece.last) {
      push(pass, piece.systemIndex, {
        type: "line",
        x1: lineEnd,
        y1: lineY,
        // The hook turns back towards the staff: down for 8va, up for 8vb.
        x2: lineEnd,
        y2: lineY - dir * SPANNER.ottavaHookSp,
        thickness,
        ref,
      } satisfies LinePrim);
    }
    const hookY = lineY - dir * SPANNER.ottavaHookSp;
    const top = Math.min(glyphY - box.up, lineY, hookY);
    const bottom = Math.max(glyphY + box.down, lineY, hookY);
    if (above) addAbove(sk, piece.x1, lineEnd, top);
    else addBelow(sk, piece.x1, lineEnd, bottom);
    record(pass.extents[piece.systemIndex]!, top, bottom);
  }
}

// --- trill line ------------------------------------------------------------

function emitTrillLine(
  pass: Pass,
  spanner: Spanner & { kind: "trillLine" },
  from: AnchorSite,
  to: AnchorSite,
): void {
  const ref: Ref = { id: spanner.id, role: "other" };
  const font = pass.ctx.font;
  const trill = glyphBox(font, "ornamentTrill");
  const wiggle = glyphBox(font, "wiggleTrill");
  const step = font.glyphs["wiggleTrill"]?.anchors?.["repeatOffset"]?.[0] ?? wiggle.width;
  const below = spanner.placement === "below";
  const pieces = splitPieces(pass.systems, from, to);

  for (const piece of pieces) {
    const sk = skylineOf(pass, piece.systemIndex, from.slotIndex);
    if (!sk) continue;
    const baseline = below
      ? clearanceBelow(sk, piece.x1, piece.x2) + SPANNER.trillGapSp + trill.up
      : clearanceAbove(sk, piece.x1, piece.x2) - SPANNER.trillGapSp - trill.down;
    let x = piece.x1;
    if (piece.first) {
      push(pass, piece.systemIndex, {
        type: "glyph",
        glyph: "ornamentTrill",
        x,
        y: baseline,
        ref,
      } satisfies GlyphPrim);
      x += trill.width + 0.1;
    }
    while (x + step <= piece.x2) {
      push(pass, piece.systemIndex, {
        type: "glyph",
        glyph: "wiggleTrill",
        x,
        y: baseline,
        ref,
      } satisfies GlyphPrim);
      x += step;
    }
    const top = baseline - trill.up;
    const bottom = baseline + trill.down;
    if (below) addBelow(sk, piece.x1, piece.x2, bottom);
    else addAbove(sk, piece.x1, piece.x2, top);
    record(pass.extents[piece.systemIndex]!, top, bottom);
  }
}

// --- glissando -------------------------------------------------------------

function emitGlissando(
  pass: Pass,
  spanner: Spanner & { kind: "glissando" },
  from: AnchorSite,
  to: AnchorSite,
): void {
  if (!from.event || !to.event) return;
  if (from.systemIndex !== to.systemIndex) return;
  const start = from.event.ev.notes[from.event.ev.notes.length - 1];
  const end = to.event.ev.notes[to.event.ev.notes.length - 1];
  if (!start || !end) return;

  const x1 = from.x + start.x + start.width + SPANNER.glissGapSp;
  const y1 = from.staffY + start.y;
  const x2 = to.x + end.x - SPANNER.glissGapSp;
  const y2 = to.staffY + end.y;
  if (x2 - x1 < ENGRAVING.tieMinLengthSp) return;
  push(pass, from.systemIndex, {
    type: "line",
    x1,
    y1,
    x2,
    y2,
    thickness: SPANNER.glissThicknessSp,
    ref: { id: spanner.id, role: "other" },
  } satisfies LinePrim);
  record(pass.extents[from.systemIndex]!, Math.min(y1, y2), Math.max(y1, y2));
}
