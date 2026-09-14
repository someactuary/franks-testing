/**
 * Attachments: everything that hangs off a single point in time — articulations,
 * fermatas, dynamics, tempo marks, expression text, fingering and pedal marks.
 *
 * Runs after the note/beam/tie passes, once every x position is final, so it can
 * read the already-emitted primitives as a skyline (see skyline.ts) and stack
 * itself outside them. Every item it places is added back to the skyline, so the
 * spanner pass (spanners.ts) automatically clears it too.
 *
 * This file also owns the bits both expressive passes need: the system/measure/
 * event index, anchor resolution, and the dynamics lane.
 */
import { fracToString, toNumber, type Fraction } from "@/model/duration";
import type { Id } from "@/model/ids";
import type { Anchor, Articulation, Attachment, Ornament, Score } from "@/model/score";
import type { NotatedDuration } from "@/model/duration";
import type { EngravingDefaults, SmuflFontData } from "@/render/smufl/types";
import { glyphBox, STAFF_HEIGHT } from "./geometry";
import { staffHasLyrics } from "./lyrics";
import type { GlyphPrim, Primitive, Ref, TextPrim } from "./layout-types";
import { stemDirectionForSteps, type EventLayout } from "./semantic";
import type { MeasureSpacing } from "./spacing";
import {
  addAbove,
  addBelow,
  buildSkyline,
  clearanceAbove,
  clearanceBelow,
  type StaffSkyline,
  type SystemSkyline,
} from "./skyline";
import type { StaffSlot } from "./vertical";

// ---------------------------------------------------------------------------
// Tunables (kept out of constants.ts so the expressive passes merge cleanly)
// ---------------------------------------------------------------------------

export const EXPRESSIVE = {
  /** Gap between a notehead and the first articulation on the other side. */
  articGapSp: 0.5,
  /** Gap between two stacked articulations. */
  articStackSp: 0.25,
  /** Half-height of the zone around a staff line an articulation must avoid. */
  articLineAvoidSp: 0.3,

  /** Gap between the staff (or the ink below it) and a fermata. */
  fermataGapSp: 0.6,

  /** Font size of a dynamic; SMuFL dynamics are drawn at natural size at 4 sp. */
  dynamicSizeSp: 4,
  /** Distance from the bottom staff line to the top of the dynamics lane. */
  dynamicsLaneSp: 1.2,
  /** Extra clearance between the ink below a staff and the dynamics lane. */
  dynamicsClearSp: 0.5,
  /** Height of a dynamic glyph; hairpins centre themselves on it. */
  dynamicHeightSp: 1.7,

  /** Expression / technique / plain text. */
  expressionSizeSp: 1.8,
  plainSizeSp: 1.6,
  textGapSp: 0.8,

  /** Tempo mark. */
  tempoSizeSp: 1.9,
  tempoGapSp: 1.6,
  /** Metronome note glyphs are full staff size; a tempo mark wants them smaller. */
  tempoNoteScale: 0.62,
  tempoItemGapSp: 0.3,

  /** Fingering digits. */
  fingeringSizeSp: 1.3,
  fingeringGapSp: 0.5,
  fingeringStackSp: 0.25,

  /** Pedal marks and the pedal line. */
  pedalLaneSp: 2.5,
  pedalClearSp: 0.5,

  /** Gap between the ink above the staff and the first ornament. */
  ornamentGapSp: 0.8,
  /** Gap between two stacked ornaments. */
  ornamentStackSp: 0.3,

  /** Gap between an arpeggio wiggle and the chord's leftmost ink. */
  arpeggioGapSp: 0.45,
  /** Shortest span an arpeggio is drawn over, however close the chord's notes are. */
  arpeggioMinSpanSp: 2.0,
  /** Distance the wiggle reaches past the outer noteheads at each end. */
  arpeggioOvershootSp: 0.6,

  /** Gap between the edge of a notehead and the tremolo strokes on its stem. */
  tremoloNoteGapSp: 0.6,
  /** Gap the strokes keep from the free end of the stem. */
  tremoloTipGapSp: 0.15,
  /** Gap between a stemless notehead and its tremolo strokes. */
  tremoloStemlessGapSp: 0.7,
} as const;

// ---------------------------------------------------------------------------
// The shape of a system, as the expressive passes see it
// ---------------------------------------------------------------------------

/**
 * The slice of engrave.ts's per-system state these passes need. Declared
 * structurally (like ties.ts's `TieSystem`) so engrave.ts keeps its own type.
 */
export interface EmitSystem {
  plan: { measures: number[] };
  width: number;
  spacings: MeasureSpacing[];
  primitives: Primitive[];
}

export interface EmitContext {
  score: Score;
  font: SmuflFontData;
  defaults: EngravingDefaults;
  slots: StaffSlot[];
}

/** Ink a pass added, in the same convention as engrave.ts's `verticalExtent`. */
export interface SystemExtent {
  /** Distance reached above the first staff's top line (>= 0). */
  above: number;
  /** Distance reached below the first staff's top line. */
  below: number;
}

function record(ext: SystemExtent, minY: number, maxY: number): void {
  if (-minY > ext.above) ext.above = -minY;
  if (maxY > ext.below) ext.below = maxY;
}

// ---------------------------------------------------------------------------
// Locating events and measures
// ---------------------------------------------------------------------------

export interface EventSite {
  systemIndex: number;
  slotIndex: number;
  staffY: number;
  ev: EventLayout;
  /** System-coordinate x of the event's column origin. */
  x: number;
  spacing: MeasureSpacing;
}

export interface MeasureSite {
  systemIndex: number;
  spacing: MeasureSpacing;
}

export interface SiteIndex {
  byEvent: Map<Id, EventSite>;
  byMeasure: Map<number, MeasureSite>;
}

/** Index every laid-out event and measure of every system by id. */
export function buildSites(systems: readonly EmitSystem[], slots: readonly StaffSlot[]): SiteIndex {
  const byEvent = new Map<Id, EventSite>();
  const byMeasure = new Map<number, MeasureSite>();
  for (const [systemIndex, sys] of systems.entries()) {
    for (const spacing of sys.spacings) {
      byMeasure.set(spacing.measureIndex, { systemIndex, spacing });
      const columnX = new Map<string, number>();
      for (const c of spacing.columns) columnX.set(fracToString(c.offset), spacing.x + c.x);
      for (const [slotIndex, staff] of spacing.staves.entries()) {
        const slot = slots[slotIndex];
        if (!slot) continue;
        for (const ev of staff.events) {
          byEvent.set(ev.event.id, {
            systemIndex,
            slotIndex,
            staffY: slot.y,
            ev,
            x: columnX.get(fracToString(ev.offset)) ?? spacing.x + spacing.head,
            spacing,
          });
        }
      }
    }
  }
  return { byEvent, byMeasure };
}

export function slotIndexOf(
  slots: readonly StaffSlot[],
  partIndex: number,
  staffIndex: number,
): number {
  return slots.findIndex((s) => s.partIndex === partIndex && s.staffIndex === staffIndex);
}

/** Index of the last staff slot of a part — where pedal marks live. */
export function bottomSlotOfPart(slots: readonly StaffSlot[], partIndex: number): number {
  let found = -1;
  for (const [i, s] of slots.entries()) if (s.partIndex === partIndex) found = i;
  return found;
}

/**
 * System-coordinate x of a time offset inside a measure: the column at that
 * offset, or a linear interpolation between the columns around it. An offset
 * past the last column sits on the last column (the barline is not a column).
 */
export function offsetX(spacing: MeasureSpacing, offset: Fraction): number {
  const cols = spacing.columns;
  if (cols.length === 0) return spacing.x + spacing.head;
  const key = fracToString(offset);
  const exact = cols.find((c) => fracToString(c.offset) === key);
  if (exact) return spacing.x + exact.x;

  const t = toNumber(offset);
  let prev: (typeof cols)[number] | undefined;
  let next: (typeof cols)[number] | undefined;
  for (const c of cols) {
    if (toNumber(c.offset) <= t) prev = c;
    else {
      next = c;
      break;
    }
  }
  if (!prev) return spacing.x + cols[0]!.x;
  if (!next) return spacing.x + prev.x;
  const a = toNumber(prev.offset);
  const b = toNumber(next.offset);
  const f = b === a ? 0 : (t - a) / (b - a);
  return spacing.x + prev.x + f * (next.x - prev.x);
}

/** Where an anchor lands: a system, a staff lane, an x, and the event if any. */
export interface AnchorSite {
  systemIndex: number;
  slotIndex: number;
  staffY: number;
  x: number;
  event?: EventSite;
}

export function resolveAnchor(
  index: SiteIndex,
  slots: readonly StaffSlot[],
  anchor: Anchor,
  partIndex: number,
  staffIndex: number,
): AnchorSite | undefined {
  const declared = slotIndexOf(slots, partIndex, staffIndex);
  if (anchor.kind === "event") {
    const site = index.byEvent.get(anchor.eventId);
    if (!site) return undefined;
    const slotIndex = declared >= 0 ? declared : site.slotIndex;
    return {
      systemIndex: site.systemIndex,
      slotIndex,
      staffY: slots[slotIndex]?.y ?? site.staffY,
      x: site.x,
      event: site,
    };
  }
  const loc = index.byMeasure.get(anchor.measureIndex);
  if (!loc || declared < 0) return undefined;
  return {
    systemIndex: loc.systemIndex,
    slotIndex: declared,
    staffY: slots[declared]?.y ?? 0,
    x: offsetX(loc.spacing, anchor.offset),
  };
}

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

/** y of the top of the dynamics lane below a staff over [x1, x2]. */
export function dynamicsLaneTop(sk: StaffSkyline, x1: number, x2: number): number {
  return Math.max(
    sk.staffY + STAFF_HEIGHT + EXPRESSIVE.dynamicsLaneSp,
    clearanceBelow(sk, x1, x2) + EXPRESSIVE.dynamicsClearSp,
  );
}

/** Width of a dynamic rendered as SMuFL glyphs (the renderer maps p/f/m/s/z/r). */
export function dynamicWidth(font: SmuflFontData, text: string, size: number): number {
  const scale = size / 4;
  let w = 0;
  for (const ch of text.toLowerCase()) w += glyphBox(font, DYNAMIC_LETTER_GLYPHS[ch] ?? "dynamicForte").width;
  return w * scale;
}

const DYNAMIC_LETTER_GLYPHS: Record<string, string> = {
  p: "dynamicPiano",
  f: "dynamicForte",
  m: "dynamicMezzo",
  s: "dynamicSforzando",
  z: "dynamicZ",
  r: "dynamicRinforzando",
};

/** Extent of a dynamic above and below its baseline, at the given size. */
function dynamicBox(font: SmuflFontData, text: string, size: number): { up: number; down: number } {
  const scale = size / 4;
  let up = 0;
  let down = 0;
  for (const ch of text.toLowerCase()) {
    const box = glyphBox(font, DYNAMIC_LETTER_GLYPHS[ch] ?? "dynamicForte");
    up = Math.max(up, box.up);
    down = Math.max(down, box.down);
  }
  return { up: up * scale, down: down * scale };
}

/** Rough width of a text run; only used to space a tempo mark's parts. */
export function textWidth(text: string, size: number): number {
  return text.length * size * 0.55;
}

// ---------------------------------------------------------------------------
// Glyph tables
// ---------------------------------------------------------------------------

const ARTICULATION_GLYPHS: Record<Articulation, { above: string; below: string }> = {
  staccato: { above: "articStaccatoAbove", below: "articStaccatoBelow" },
  staccatissimo: { above: "articStaccatissimoAbove", below: "articStaccatissimoBelow" },
  tenuto: { above: "articTenutoAbove", below: "articTenutoBelow" },
  accent: { above: "articAccentAbove", below: "articAccentBelow" },
  marcato: { above: "articMarcatoAbove", below: "articMarcatoBelow" },
  // Portato is a tenuto line with a staccato dot inside it.
  portato: { above: "articTenutoStaccatoAbove", below: "articTenutoStaccatoBelow" },
};

/**
 * SMuFL's ornament names do not line up with the model's: `ornamentMordent` is
 * the mordent *with* a stroke (the lower mordent) and `ornamentShortTrill` is the
 * strokeless upper — i.e. inverted — mordent.
 */
const ORNAMENT_GLYPHS: Record<Ornament, string> = {
  trill: "ornamentTrill",
  mordent: "ornamentMordent",
  invertedMordent: "ornamentShortTrill",
  turn: "ornamentTurn",
  invertedTurn: "ornamentTurnInverted",
};

/**
 * Arpeggio wiggles. Bravura's repeatable `wiggleArpeggiato*` segments are not in
 * the generated font subset, so the legacy single-glyph arpeggios are used and
 * scaled to the chord's span; `arpeggiatoUp` / `arpeggiatoDown` carry the arrowhead.
 */
const ARPEGGIO_GLYPHS: Record<"up" | "down" | "straight", string> = {
  up: "arpeggiatoUp",
  down: "arpeggiatoDown",
  straight: "arpeggiato",
};

/** Metronome note glyph for a beat unit (dots are drawn separately). */
export function metronomeGlyph(unit: NotatedDuration): string {
  switch (unit.base) {
    case 1:
      return "metNoteWhole";
    case 2:
      return "metNoteHalfUp";
    case 8:
      return "metNote8thUp";
    case 16:
      return "metNote16thUp";
    default:
      return "metNoteQuarterUp";
  }
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
}

/**
 * Draw every attachment of the score plus the articulations and fingerings that
 * live on the events themselves. Returns, per system, how far the new ink
 * reaches above and below the system origin.
 */
export function emitAttachments(systems: EmitSystem[], ctx: EmitContext): SystemExtent[] {
  const pass: Pass = {
    ctx,
    index: buildSites(systems, ctx.slots),
    skylines: systems.map((s) => buildSkyline(s.primitives, ctx.slots, ctx.font)),
    extents: systems.map(() => ({ above: 0, below: 0 })),
    systems,
  };

  // Nearest the notes first, so everything later stacks outside it.
  for (const [systemIndex, sys] of systems.entries()) {
    for (const spacing of sys.spacings) {
      for (const [slotIndex, staff] of spacing.staves.entries()) {
        const sk = pass.skylines[systemIndex]?.[slotIndex];
        if (!sk) continue;
        for (const ev of staff.events) {
          const x = pass.index.byEvent.get(ev.event.id)?.x ?? spacing.x + spacing.head;
          emitArticulations(pass, systemIndex, sk, ev, x);
        }
        for (const ev of staff.events) {
          const x = pass.index.byEvent.get(ev.event.id)?.x ?? spacing.x + spacing.head;
          emitOrnaments(pass, systemIndex, sk, ev, x);
        }
        for (const ev of staff.events) {
          const x = pass.index.byEvent.get(ev.event.id)?.x ?? spacing.x + spacing.head;
          emitFingerings(pass, systemIndex, sk, ev, x, slotIndex);
        }
        for (const ev of staff.events) {
          const x = pass.index.byEvent.get(ev.event.id)?.x ?? spacing.x + spacing.head;
          emitTremolo(pass, systemIndex, sk, ev, x);
          emitArpeggio(pass, systemIndex, sk, ev, x);
        }
      }
    }
  }

  for (const attachment of ctx.score.attachments) {
    emitAttachment(pass, attachment);
  }

  return pass.extents;
}

function push(pass: Pass, systemIndex: number, prim: Primitive): void {
  pass.systems[systemIndex]?.primitives.push(prim);
}

// --- articulations ---------------------------------------------------------

function emitArticulations(
  pass: Pass,
  systemIndex: number,
  sk: StaffSkyline,
  ev: EventLayout,
  columnX: number,
): void {
  const event = ev.event;
  if (event.kind !== "note") return;
  const list = event.articulations ?? [];
  if (list.length === 0 || ev.notes.length === 0) return;

  // Opposite the stem; a whole note uses the direction it would have had.
  const dir = ev.stem?.dir ?? stemDirectionForSteps(ev.notes.map((n) => n.step));
  const highest = ev.notes[ev.notes.length - 1]!;
  const lowest = ev.notes[0]!;

  // Marcato is always above, whatever the stem does.
  const above = list.filter((a) => a === "marcato" || dir === "down");
  const below = list.filter((a) => a !== "marcato" && dir === "up");

  const ext = pass.extents[systemIndex]!;
  const font = pass.ctx.font;

  let edge = sk.staffY + highest.y - 0.5 - EXPRESSIVE.articGapSp;
  for (const artic of above) {
    const glyph = ARTICULATION_GLYPHS[artic].above;
    const box = glyphBox(font, glyph);
    const bottom = avoidStaffLine(sk, edge, box.up + box.down, "above");
    const x = columnX + highest.x + highest.width / 2 - box.width / 2;
    const y = bottom - box.down;
    push(pass, systemIndex, {
      type: "glyph",
      glyph,
      x,
      y,
      ref: { id: event.id, role: "articulation" },
    } satisfies GlyphPrim);
    addAbove(sk, x, x + box.width, y - box.up);
    record(ext, y - box.up, y + box.down);
    edge = y - box.up - EXPRESSIVE.articStackSp;
  }

  edge = sk.staffY + lowest.y + 0.5 + EXPRESSIVE.articGapSp;
  for (const artic of below) {
    const glyph = ARTICULATION_GLYPHS[artic].below;
    const box = glyphBox(font, glyph);
    const top = avoidStaffLine(sk, edge, box.up + box.down, "below");
    const x = columnX + lowest.x + lowest.width / 2 - box.width / 2;
    const y = top + box.up;
    push(pass, systemIndex, {
      type: "glyph",
      glyph,
      x,
      y,
      ref: { id: event.id, role: "articulation" },
    } satisfies GlyphPrim);
    addBelow(sk, x, x + box.width, y + box.down);
    record(ext, y - box.up, y + box.down);
    edge = y + box.down + EXPRESSIVE.articStackSp;
  }
}

/**
 * Nudge an articulation off a staff line: inside the staff its centre must sit
 * in a space, so a mark that lands on a line moves outwards by half a space.
 * `edge` is the glyph's inner edge (its bottom above the staff, its top below).
 */
function avoidStaffLine(
  sk: StaffSkyline,
  edge: number,
  height: number,
  side: "above" | "below",
): number {
  const dir = side === "above" ? -1 : 1;
  let e = edge;
  for (let attempt = 0; attempt < 2; attempt++) {
    const centre = e + (dir * height) / 2;
    const p = centre - sk.staffY;
    const inStaff = p >= -0.4 && p <= STAFF_HEIGHT + 0.4;
    if (!inStaff || Math.abs(p - Math.round(p)) >= EXPRESSIVE.articLineAvoidSp) return e;
    e += dir * 0.5;
  }
  return e;
}

// --- fingering -------------------------------------------------------------

function emitFingerings(
  pass: Pass,
  systemIndex: number,
  sk: StaffSkyline,
  ev: EventLayout,
  columnX: number,
  slotIndex: number,
): void {
  const event = ev.event;
  if (event.kind !== "note") return;
  const fingered = ev.notes.filter((n) => n.note.fingering);
  if (fingered.length === 0) return;

  // Fingering sits above the notehead, except on the bottom staff of a part
  // (the pianist's left hand), where it hangs below.
  const below = slotIndex === bottomSlotOfPart(pass.ctx.slots, ev.partIndex);
  const size = EXPRESSIVE.fingeringSizeSp;
  const ext = pass.extents[systemIndex]!;
  const left = columnX + Math.min(...ev.notes.map((n) => n.x));
  const right = columnX + Math.max(...ev.notes.map((n) => n.x + n.width));

  // A chord stacks outwards, the lowest note's finger nearest the staff.
  let edge = below
    ? clearanceBelow(sk, left, right) + EXPRESSIVE.fingeringGapSp
    : clearanceAbove(sk, left, right) - EXPRESSIVE.fingeringGapSp;

  const order = below ? [...fingered].reverse() : fingered;
  for (const n of order) {
    const x = columnX + n.x + n.width / 2;
    const baseline = below ? edge + size * 0.8 : edge;
    push(pass, systemIndex, {
      type: "text",
      text: n.note.fingering!,
      x,
      y: baseline,
      size,
      style: "fingering",
      anchor: "middle",
      ref: { id: n.note.id, role: "fingering" },
    } satisfies TextPrim);
    const top = baseline - size * 0.8;
    const bottom = baseline + size * 0.2;
    const halfWidth = Math.max(size * 0.4, (n.note.fingering!.length * size * 0.55) / 2);
    if (below) {
      addBelow(sk, x - halfWidth, x + halfWidth, bottom);
      edge = bottom + EXPRESSIVE.fingeringStackSp;
    } else {
      addAbove(sk, x - halfWidth, x + halfWidth, top);
      edge = top - EXPRESSIVE.fingeringStackSp;
    }
    record(ext, top, bottom);
  }
}

// --- ornaments -------------------------------------------------------------

/**
 * Ornaments sit above the staff whatever the stem does — a trill belongs to the
 * note as a whole, not to one side of it — and outside everything already there,
 * so a trill over a high note clears its leger lines and its articulation.
 */
function emitOrnaments(
  pass: Pass,
  systemIndex: number,
  sk: StaffSkyline,
  ev: EventLayout,
  columnX: number,
): void {
  const event = ev.event;
  if (event.kind !== "note") return;
  const list = event.ornaments ?? [];
  if (list.length === 0 || ev.notes.length === 0) return;

  const left = columnX + Math.min(...ev.notes.map((n) => n.x));
  const right = columnX + Math.max(...ev.notes.map((n) => n.x + n.width));
  const centre = (left + right) / 2;
  const ext = pass.extents[systemIndex]!;

  // clearanceAbove never reports below the top staff line, so this is already
  // "above the staff, outside the skyline".
  let edge = clearanceAbove(sk, left, right) - EXPRESSIVE.ornamentGapSp;
  for (const ornament of list) {
    const glyph = ORNAMENT_GLYPHS[ornament];
    const box = glyphBox(pass.ctx.font, glyph);
    const x = centre - box.width / 2;
    const y = edge - box.down;
    push(pass, systemIndex, {
      type: "glyph",
      glyph,
      x,
      y,
      ref: { id: event.id, role: "ornament" },
    } satisfies GlyphPrim);
    addAbove(sk, x, x + box.width, y - box.up);
    record(ext, y - box.up, y + box.down);
    edge = y - box.up - EXPRESSIVE.ornamentStackSp;
  }
}

// --- tremolo ---------------------------------------------------------------

/**
 * Tremolo strokes: centred across the stem, kept clear of both the notehead and
 * the stem's free end. A stemless note (a whole note) carries them beside the
 * notehead, on the side the stem would have been.
 */
function emitTremolo(
  pass: Pass,
  systemIndex: number,
  sk: StaffSkyline,
  ev: EventLayout,
  columnX: number,
): void {
  const event = ev.event;
  if (event.kind !== "note" || !event.tremolo || ev.notes.length === 0) return;
  const glyph = `tremolo${event.tremolo}`;
  const box = glyphBox(pass.ctx.font, glyph);
  // The tremolo glyphs are drawn about their own centre, both ways.
  const half = (box.up + box.down) / 2;
  const ext = pass.extents[systemIndex]!;
  const ref: Ref = { id: event.id, role: "other" };
  const staffY = sk.staffY;

  let x: number;
  let y: number;
  if (ev.stem) {
    const attach = staffY + ev.stem.yAttach;
    const tip = staffY + ev.stem.yTip;
    const sign = tip > attach ? 1 : -1;
    const length = Math.abs(tip - attach);
    // `yAttach` sits on the notehead's centre line, so the gap is measured from
    // half a space further out — the notehead's own edge.
    const near = half + 0.5 + EXPRESSIVE.tremoloNoteGapSp;
    const far = Math.max(near, length - half - EXPRESSIVE.tremoloTipGapSp);
    x = columnX + ev.stem.x;
    y = attach + sign * Math.min(Math.max(length / 2, near), far);
  } else {
    const dir = stemDirectionForSteps(ev.notes.map((n) => n.step));
    const outer = dir === "up" ? ev.notes[ev.notes.length - 1]! : ev.notes[0]!;
    const sign = dir === "up" ? -1 : 1;
    x = columnX + outer.x + outer.width / 2;
    y = staffY + outer.y + sign * (0.5 + EXPRESSIVE.tremoloStemlessGapSp + half);
  }

  push(pass, systemIndex, { type: "glyph", glyph, x, y, ref } satisfies GlyphPrim);
  addAbove(sk, x + box.left, x + box.right, y - box.up);
  addBelow(sk, x + box.left, x + box.right, y + box.down);
  record(ext, y - box.up, y + box.down);
}

// --- arpeggio --------------------------------------------------------------

/**
 * The arpeggio wiggle, left of everything the chord owns (accidentals included —
 * spacing.ts reserved `ENGRAVING.arpeggioLeadSp` there for it), spanning the
 * chord from its lowest to its highest notehead.
 *
 * Bravura's repeatable `wiggleArpeggiato*` segments are outside the generated
 * font subset, so the single-glyph arpeggios are scaled to the span instead of
 * being tiled; `arpeggiatoUp` / `arpeggiatoDown` bring their own arrowhead.
 */
function emitArpeggio(
  pass: Pass,
  systemIndex: number,
  sk: StaffSkyline,
  ev: EventLayout,
  columnX: number,
): void {
  const event = ev.event;
  if (event.kind !== "note" || !event.arpeggio || ev.notes.length === 0) return;
  const glyph = ARPEGGIO_GLYPHS[event.arpeggio];
  const box = glyphBox(pass.ctx.font, glyph);
  const natural = box.up + box.down;
  if (natural <= 0) return;

  const staffY = sk.staffY;
  const over = EXPRESSIVE.arpeggioOvershootSp;
  const top = staffY + ev.notes[ev.notes.length - 1]!.y - over;
  const bottom = staffY + ev.notes[0]!.y + over;
  const span = Math.max(bottom - top, EXPRESSIVE.arpeggioMinSpanSp);
  const scale = span / natural;
  const width = box.width * scale;
  const x = columnX - ev.left - EXPRESSIVE.arpeggioGapSp - width;
  // The glyph's ink runs from `y - up * scale` to `y + down * scale`.
  const y = bottom - box.down * scale;

  push(pass, systemIndex, {
    type: "glyph",
    glyph,
    x,
    y,
    scale,
    ref: { id: event.id, role: "other" },
  } satisfies GlyphPrim);
  addAbove(sk, x, x + width, y - box.up * scale);
  addBelow(sk, x, x + width, y + box.down * scale);
  record(pass.extents[systemIndex]!, y - box.up * scale, y + box.down * scale);
}

// --- score-level attachments ----------------------------------------------

function emitAttachment(pass: Pass, attachment: Attachment): void {
  const site = resolveAnchor(
    pass.index,
    pass.ctx.slots,
    attachment.anchor,
    attachment.partIndex,
    attachment.staffIndex,
  );
  if (!site) return;
  const sk = pass.skylines[site.systemIndex]?.[site.slotIndex];
  if (!sk) return;

  switch (attachment.kind) {
    case "fermata":
      emitFermata(pass, attachment, site, sk);
      break;
    case "dynamic":
      emitDynamic(pass, attachment, site, sk);
      break;
    case "tempo":
      emitTempo(pass, attachment, site);
      break;
    case "text":
      emitText(pass, attachment, site, sk);
      break;
    case "pedalMark":
      emitPedalMark(pass, attachment, site);
      break;
  }
}

/** Horizontal ink range of the anchored event, or a thin slice at the anchor. */
function anchorSpan(site: AnchorSite): { x1: number; x2: number } {
  if (!site.event) return { x1: site.x - 0.5, x2: site.x + 0.5 };
  return { x1: site.x - site.event.ev.left, x2: site.x + site.event.ev.right };
}

function emitFermata(
  pass: Pass,
  attachment: Attachment & { kind: "fermata" },
  site: AnchorSite,
  sk: StaffSkyline,
): void {
  const { x1, x2 } = anchorSpan(site);
  const below = attachment.placement === "below";
  const glyph = below ? "fermataBelow" : "fermataAbove";
  const box = glyphBox(pass.ctx.font, glyph);
  const centre = site.event
    ? site.x + site.event.ev.notes.reduce((a, n) => a + n.x + n.width / 2, 0) / Math.max(1, site.event.ev.notes.length)
    : site.x;
  const x = (site.event?.ev.notes.length ? centre : site.x) - box.width / 2;
  const y = below
    ? clearanceBelow(sk, x1, x2) + EXPRESSIVE.fermataGapSp + box.up
    : clearanceAbove(sk, x1, x2) - EXPRESSIVE.fermataGapSp - box.down;
  push(pass, site.systemIndex, {
    type: "glyph",
    glyph,
    x,
    y,
    ref: { id: attachment.id, role: "articulation" },
  } satisfies GlyphPrim);
  if (below) addBelow(sk, x, x + box.width, y + box.down);
  else addAbove(sk, x, x + box.width, y - box.up);
  record(pass.extents[site.systemIndex]!, y - box.up, y + box.down);
}

function emitDynamic(
  pass: Pass,
  attachment: Attachment & { kind: "dynamic" },
  site: AnchorSite,
  sk: StaffSkyline,
): void {
  const size = EXPRESSIVE.dynamicSizeSp;
  const width = dynamicWidth(pass.ctx.font, attachment.text, size);
  const box = dynamicBox(pass.ctx.font, attachment.text, size);
  const x = site.x;
  // Vocal convention: on a staff that carries words, the words own everything
  // below the staff, so the dynamics move above it unless told otherwise.
  const sys = pass.systems[site.systemIndex];
  const above =
    attachment.placement === "above" ||
    (attachment.placement === undefined &&
      sys !== undefined &&
      staffHasLyrics(sys, site.slotIndex));
  const laneTop = above
    ? clearanceAbove(sk, x, x + width) - EXPRESSIVE.dynamicsClearSp - (box.up + box.down)
    : dynamicsLaneTop(sk, x, x + width);
  const baseline = laneTop + box.up;
  push(pass, site.systemIndex, {
    type: "text",
    text: attachment.text,
    x,
    y: baseline,
    size,
    style: "dynamic",
    anchor: "start",
    ref: { id: attachment.id, role: "dynamic" },
  } satisfies TextPrim);
  addBelow(sk, x, x + width, baseline + box.down);
  addAbove(sk, x, x + width, baseline - box.up);
  record(pass.extents[site.systemIndex]!, baseline - box.up, baseline + box.down);
}

function emitText(
  pass: Pass,
  attachment: Attachment & { kind: "text" },
  site: AnchorSite,
  sk: StaffSkyline,
): void {
  const style = attachment.style ?? "expression";
  const size = style === "expression" ? EXPRESSIVE.expressionSizeSp : EXPRESSIVE.plainSizeSp;
  const primStyle: TextPrim["style"] = style === "expression" ? "expression" : "plain";
  const width = textWidth(attachment.text, size);
  const x = site.x;
  const below = attachment.placement === "below";
  const baseline = below
    ? clearanceBelow(sk, x, x + width) + EXPRESSIVE.textGapSp + size * 0.8
    : clearanceAbove(sk, x, x + width) - EXPRESSIVE.textGapSp;
  push(pass, site.systemIndex, {
    type: "text",
    text: attachment.text,
    x,
    y: baseline,
    size,
    style: primStyle,
    anchor: "start",
    ref: { id: attachment.id, role: "text" },
  } satisfies TextPrim);
  const top = baseline - size * 0.8;
  const bottom = baseline + size * 0.2;
  if (below) addBelow(sk, x, x + width, bottom);
  else addAbove(sk, x, x + width, top);
  record(pass.extents[site.systemIndex]!, top, bottom);
}

/**
 * "Andante ♩ = 76", bold, above the *top* staff of the system whatever staff the
 * attachment names — a tempo mark belongs to the whole system.
 */
function emitTempo(pass: Pass, attachment: Attachment & { kind: "tempo" }, site: AnchorSite): void {
  const topSk = pass.skylines[site.systemIndex]?.[0];
  if (!topSk) return;
  const font = pass.ctx.font;
  const size = EXPRESSIVE.tempoSizeSp;
  const ext = pass.extents[site.systemIndex]!;
  const ref: Ref = { id: attachment.id, role: "tempo" };

  const hasMetronome = attachment.beatUnit !== undefined && attachment.bpm !== undefined;
  const noteGlyph = attachment.beatUnit ? metronomeGlyph(attachment.beatUnit) : "metNoteQuarterUp";
  const noteBox = glyphBox(font, noteGlyph);
  const dotBox = glyphBox(font, "metAugmentationDot");
  const scale = EXPRESSIVE.tempoNoteScale;
  const dots = attachment.beatUnit?.dots ?? 0;

  const textPart = attachment.text ?? "";
  // SVG collapses a leading space, so the gap before "=" is spacing, not text.
  const bpmText = hasMetronome ? `= ${attachment.bpm}` : "";
  const width =
    (textPart ? textWidth(textPart, size) + EXPRESSIVE.tempoItemGapSp * 2 : 0) +
    (hasMetronome
      ? noteBox.width * scale +
        dots * (dotBox.width * scale + 0.1) +
        EXPRESSIVE.tempoItemGapSp * 2 +
        textWidth(bpmText, size)
      : 0);

  const x0 = site.x;
  const baseline =
    Math.min(clearanceAbove(topSk, x0, x0 + width), topSk.staffY) - EXPRESSIVE.tempoGapSp;
  let x = x0;
  let minY = baseline - size * 0.8;

  if (textPart) {
    push(pass, site.systemIndex, {
      type: "text",
      text: textPart,
      x,
      y: baseline,
      size,
      style: "tempo",
      anchor: "start",
      ref,
    } satisfies TextPrim);
    x += textWidth(textPart, size) + EXPRESSIVE.tempoItemGapSp * 2;
  }

  if (hasMetronome) {
    const noteY = baseline - noteBox.down * scale;
    push(pass, site.systemIndex, {
      type: "glyph",
      glyph: noteGlyph,
      x,
      y: noteY,
      scale,
      ref,
    } satisfies GlyphPrim);
    minY = Math.min(minY, noteY - noteBox.up * scale);
    x += noteBox.width * scale;
    for (let d = 0; d < dots; d++) {
      push(pass, site.systemIndex, {
        type: "glyph",
        glyph: "metAugmentationDot",
        x: x + 0.1,
        y: noteY - noteBox.up * scale * 0.55,
        scale,
        ref,
      } satisfies GlyphPrim);
      x += dotBox.width * scale + 0.1;
    }
    x += EXPRESSIVE.tempoItemGapSp * 2;
    push(pass, site.systemIndex, {
      type: "text",
      text: bpmText,
      x,
      y: baseline,
      size,
      style: "tempo",
      anchor: "start",
      ref,
    } satisfies TextPrim);
  }

  addAbove(topSk, x0, x0 + width, minY);
  record(ext, minY, baseline);
}

function emitPedalMark(
  pass: Pass,
  attachment: Attachment & { kind: "pedalMark" },
  site: AnchorSite,
): void {
  const slotIndex = bottomSlotOfPart(pass.ctx.slots, attachment.partIndex);
  const sk = pass.skylines[site.systemIndex]?.[slotIndex];
  if (!sk) return;
  const glyph = attachment.mark === "ped" ? "keyboardPedalPed" : "keyboardPedalUp";
  const box = glyphBox(pass.ctx.font, glyph);
  const x = site.x;
  const top = pedalLaneTop(sk, x, x + box.width);
  const y = top + box.up;
  push(pass, site.systemIndex, {
    type: "glyph",
    glyph,
    x,
    y,
    ref: { id: attachment.id, role: "pedal" },
  } satisfies GlyphPrim);
  addBelow(sk, x, x + box.width, y + box.down);
  record(pass.extents[site.systemIndex]!, y - box.up, y + box.down);
}

/** y of the top of the pedal lane below the bottom staff over [x1, x2]. */
export function pedalLaneTop(sk: StaffSkyline, x1: number, x2: number): number {
  return Math.max(
    sk.staffY + STAFF_HEIGHT + EXPRESSIVE.pedalLaneSp,
    clearanceBelow(sk, x1, x2) + EXPRESSIVE.pedalClearSp,
  );
}
