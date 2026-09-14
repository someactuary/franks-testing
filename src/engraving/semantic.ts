/**
 * Semantic pass: everything about a measure that does not depend on horizontal
 * spacing — notehead placement, stem direction and length, accidentals, dots,
 * leger lines, rest positions and beam grouping.
 *
 * All coordinates produced here are *staff-local*:
 *   - y is measured from the staff's top line, downwards (middle line = 2).
 *   - x is measured from the column ("onset") origin; the principal notehead of
 *     an event sits at x = 0, so accidentals and left-displaced noteheads have
 *     negative x.
 *
 * Beam *geometry* needs real x positions and therefore happens after spacing;
 * see `beamGeometry`.
 */
import {
  add,
  cmp,
  eq,
  frac,
  lt,
  measureLength as timeSigLength,
  toNumber,
  type Fraction,
  type TimeSignature,
} from "@/model/duration";
import type { Id } from "@/model/ids";
import { diatonic, keyAlter, type Alter, type KeySignature, type Step } from "@/model/pitch";
import type { ClefKind, Note, StemDirection, Voice } from "@/model/score";
import { positionedEvents, type Event } from "@/model/traverse";
import type { EngravingDefaults, SmuflFontData } from "@/render/smufl/types";
import { ENGRAVING } from "./constants";
import {
  accidentalGlyph,
  beamCount,
  flagGlyph,
  glyphAnchor,
  glyphBox,
  noteheadGlyph,
  restGlyph,
  staffStep,
  stepToY,
} from "./geometry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccidentalPart {
  glyph: string;
  /** Left edge of the glyph, relative to the column origin (negative). */
  x: number;
}

export interface AccidentalLayout {
  noteId: Id;
  parts: AccidentalPart[];
  /** Leftmost edge, relative to the column origin (negative). */
  left: number;
  y: number;
}

export interface NoteLayout {
  note: Note;
  /** Diatonic step from the middle line, positive up. */
  step: number;
  /** Staff-local y of the notehead centre. */
  y: number;
  /** Left edge of the notehead relative to the column origin. */
  x: number;
  glyph: string;
  width: number;
  /** True when the note was displaced to the far side of the stem (a second). */
  displaced: boolean;
  accidental?: AccidentalLayout;
}

export interface StemLayout {
  dir: StemDirection;
  /** Centre line of the stem, relative to the column origin. */
  x: number;
  thickness: number;
  /** Staff-local y where the stem meets its notehead. */
  yAttach: number;
  /** Staff-local y of the free end. Replaced for beamed notes by `beamGeometry`. */
  yTip: number;
}

export interface FlagLayout {
  glyph: string;
  x: number;
  y: number;
}

export interface DotLayout {
  x: number;
  y: number;
}

export interface LedgerLayout {
  /** Staff step of the leger line (always even, |step| >= 6). */
  step: number;
  y: number;
  x1: number;
  x2: number;
}

export interface RestLayout {
  glyph: string;
  y: number;
  width: number;
  /** Whole-measure rests are centred in the measure rather than placed on their column. */
  centred: boolean;
}

export interface EventLayout {
  event: Event;
  partIndex: number;
  staffIndex: number;
  voiceIndex: number;
  offset: Fraction;
  length: Fraction;
  notes: NoteLayout[];
  stem?: StemLayout;
  flag?: FlagLayout;
  dots: DotLayout[];
  ledgers: LedgerLayout[];
  rest?: RestLayout;
  /** Index into `StaffMeasureLayout.beams`, when this event is beamed. */
  beamIndex?: number;
  /** How far the event's ink reaches left of the column origin (>= 0). */
  left: number;
  /** How far the event's ink reaches right of the column origin (>= 0). */
  right: number;
}

export interface BeamGroup {
  dir: StemDirection;
  /** Indices into `StaffMeasureLayout.events`. */
  members: number[];
  /** Number of beams for each member, parallel to `members`. */
  counts: number[];
}

export interface StaffMeasureLayout {
  partIndex: number;
  staffIndex: number;
  clef: ClefKind;
  events: EventLayout[];
  beams: BeamGroup[];
}

// ---------------------------------------------------------------------------
// Stem direction
// ---------------------------------------------------------------------------

/**
 * Direction from the note farthest from the middle line: below the middle line
 * points up, above points down, and the middle line itself (or a tie between the
 * outer notes) points down.
 */
export function stemDirectionForSteps(steps: number[], override?: StemDirection): StemDirection {
  if (override) return override;
  if (steps.length === 0) return "down";
  let maxAbs = 0;
  for (const s of steps) maxAbs = Math.max(maxAbs, Math.abs(s));
  return steps.some((s) => s === maxAbs) ? "down" : "up";
}

// ---------------------------------------------------------------------------
// Accidental state (per staff, per measure)
// ---------------------------------------------------------------------------

/** Remembers which alteration is currently sounding for each written pitch in a measure. */
export class AccidentalMemory {
  private readonly byDiatonic = new Map<number, Alter>();

  constructor(private readonly key: KeySignature) {}

  /** The alteration currently in force for this diatonic position. */
  effective(d: number, step: Step): Alter {
    const remembered = this.byDiatonic.get(d);
    return remembered ?? keyAlter(this.key, step);
  }

  set(d: number, alter: Alter): void {
    this.byDiatonic.set(d, alter);
  }
}

function accidentalDecision(note: Note, memory: AccidentalMemory): { show: boolean; parens: boolean } {
  const d = diatonic(note.pitch);
  const differs = note.pitch.alter !== memory.effective(d, note.pitch.step);
  const mode = note.accidental ?? "auto";
  memory.set(d, note.pitch.alter);
  switch (mode) {
    case "none":
      return { show: false, parens: false };
    case "force":
    case "courtesy":
      return { show: true, parens: false };
    case "cautionary-parens":
      return { show: true, parens: true };
    default:
      return { show: differs, parens: false };
  }
}

// ---------------------------------------------------------------------------
// One measure of one staff
// ---------------------------------------------------------------------------

export interface StaffMeasureInput {
  font: SmuflFontData;
  partIndex: number;
  staffIndex: number;
  clef: ClefKind;
  key: KeySignature;
  timeSig: TimeSignature;
  /** Notated length of the measure (respects `actualLength` pickups). */
  measureLength: Fraction;
  voices: Voice[];
}

/** A positioned event plus the staff steps of its notes — the input to beam grouping. */
export interface RawEvent {
  event: Event;
  voiceIndex: number;
  offset: Fraction;
  length: Fraction;
  steps: number[];
}

export function layoutStaffMeasure(input: StaffMeasureInput): StaffMeasureLayout {
  const { font, clef, key } = input;
  const defaults = font.engravingDefaults;

  const raw: RawEvent[] = [];
  for (const voice of input.voices) {
    for (const pe of positionedEvents(voice)) {
      const steps =
        pe.event.kind === "note" ? pe.event.notes.map((n) => staffStep(n.pitch, clef)) : [];
      raw.push({
        event: pe.event,
        voiceIndex: voice.index,
        offset: pe.offset,
        length: pe.length,
        steps,
      });
    }
  }
  raw.sort((a, b) => cmp(a.offset, b.offset) || a.voiceIndex - b.voiceIndex);

  // Beam grouping first: a group fixes one stem direction for all its members,
  // which in turn decides notehead displacement and accidental positions.
  const beams = buildBeamGroups(raw, input.timeSig, input.measureLength);
  const forcedDir = new Map<number, StemDirection>();
  const beamOf = new Map<number, number>();
  for (const [gi, g] of beams.entries()) {
    for (const m of g.members) {
      forcedDir.set(m, g.dir);
      beamOf.set(m, gi);
    }
  }

  const memory = new AccidentalMemory(key);
  const events: EventLayout[] = raw.map((r, i) => {
    const layout = layoutEvent({
      font,
      defaults,
      clef,
      memory,
      partIndex: input.partIndex,
      staffIndex: input.staffIndex,
      voiceIndex: r.voiceIndex,
      event: r.event,
      offset: r.offset,
      length: r.length,
      steps: r.steps,
      ...(forcedDir.has(i) ? { forcedDir: forcedDir.get(i)! } : {}),
      beamed: beamOf.has(i),
    });
    const gi = beamOf.get(i);
    if (gi !== undefined) layout.beamIndex = gi;
    return layout;
  });

  return { partIndex: input.partIndex, staffIndex: input.staffIndex, clef, events, beams };
}

interface EventInput {
  font: SmuflFontData;
  defaults: EngravingDefaults;
  clef: ClefKind;
  memory: AccidentalMemory;
  partIndex: number;
  staffIndex: number;
  voiceIndex: number;
  event: Event;
  offset: Fraction;
  length: Fraction;
  steps: number[];
  forcedDir?: StemDirection;
  beamed: boolean;
}

function layoutEvent(input: EventInput): EventLayout {
  return input.event.kind === "rest" ? layoutRest(input) : layoutNoteEvent(input);
}

// --- rests -----------------------------------------------------------------

function layoutRest(input: EventInput): EventLayout {
  const { font, event } = input;
  if (event.kind !== "rest") throw new Error("not a rest");
  const isMeasureRest = event.measureRest === true;
  const glyph = isMeasureRest ? "restWhole" : restGlyph(event.duration.base);
  const box = glyphBox(font, glyph);

  // Whole (and measure) rests hang from the 4th line from the bottom; everything
  // else sits on / is centred about the middle line.
  const lineY = glyph === "restWhole" ? 1 : 2;
  const y = lineY - (event.yOffsetSteps ?? 0) * 0.5;

  const dotBox = glyphBox(font, "augmentationDot");
  const dots: DotLayout[] = [];
  let x = box.width + ENGRAVING.dotGapSp;
  for (let i = 0; i < event.duration.dots; i++) {
    dots.push({ x, y: y - 0.5 }); // the space immediately above the rest's line
    x += dotBox.width + ENGRAVING.dotSpacingSp;
  }
  const right = dots.length > 0 ? dots[dots.length - 1]!.x + dotBox.width : box.width;

  return {
    event,
    partIndex: input.partIndex,
    staffIndex: input.staffIndex,
    voiceIndex: input.voiceIndex,
    offset: input.offset,
    length: input.length,
    notes: [],
    dots,
    ledgers: [],
    rest: { glyph, y, width: box.width, centred: isMeasureRest },
    left: 0,
    right,
  };
}

// --- notes and chords ------------------------------------------------------

/**
 * Seconds are drawn on opposite sides of the stem: with the stem up the upper
 * note of the pair moves right, with the stem down the lower note moves left.
 * `notes` must be sorted ascending by pitch.
 */
export function secondDisplacement(steps: number[], dir: StemDirection): boolean[] {
  const displaced = new Array<boolean>(steps.length).fill(false);
  if (dir === "up") {
    for (let i = 1; i < steps.length; i++) {
      if (steps[i]! - steps[i - 1]! === 1 && !displaced[i - 1]) displaced[i] = true;
    }
  } else {
    for (let i = steps.length - 2; i >= 0; i--) {
      if (steps[i + 1]! - steps[i]! === 1 && !displaced[i + 1]) displaced[i] = true;
    }
  }
  return displaced;
}

function layoutNoteEvent(input: EventInput): EventLayout {
  const { font, defaults, event } = input;
  if (event.kind !== "note") throw new Error("not a note event");

  const order = event.notes
    .map((note, i) => ({ note, step: input.steps[i]! }))
    .sort((a, b) => diatonic(a.note.pitch) - diatonic(b.note.pitch));
  const steps = order.map((o) => o.step);
  const dir = input.forcedDir ?? stemDirectionForSteps(steps, event.stem);

  const headGlyph = noteheadGlyph(event.duration.base);
  const headWidth = glyphBox(font, headGlyph).width;
  const displacement = headWidth - defaults.stemThickness;
  const displaced = secondDisplacement(steps, dir);

  const notes: NoteLayout[] = order.map((o, i) => ({
    note: o.note,
    step: o.step,
    y: stepToY(0, o.step),
    x: displaced[i] ? (dir === "up" ? displacement : -displacement) : 0,
    glyph: headGlyph,
    width: headWidth,
    displaced: displaced[i] === true,
  }));

  assignAccidentals(notes, input.memory, font);

  // Augmentation dots: one per notehead, all aligned to the right of the chord.
  const dotBox = glyphBox(font, "augmentationDot");
  const dots: DotLayout[] = [];
  if (event.duration.dots > 0) {
    const chordRight = Math.max(...notes.map((n) => n.x + n.width));
    const used = new Set<number>();
    for (const n of notes) {
      // A dot for a note on a line moves to the space above.
      let dotStep = n.step % 2 === 0 ? n.step + 1 : n.step;
      while (used.has(dotStep)) dotStep += 2;
      used.add(dotStep);
      let x = chordRight + ENGRAVING.dotGapSp;
      for (let d = 0; d < event.duration.dots; d++) {
        dots.push({ x, y: stepToY(0, dotStep) });
        x += dotBox.width + ENGRAVING.dotSpacingSp;
      }
    }
  }

  let stem: StemLayout | undefined;
  let flag: FlagLayout | undefined;
  if (event.duration.base >= 2) {
    stem = buildStem(notes, dir, headGlyph, font, defaults);
    if (!input.beamed) {
      const fg = flagGlyph(event.duration.base, dir);
      if (fg) flag = buildFlag(fg, stem, font, defaults);
    }
  }

  const ledgers = buildLedgers(notes, defaults);

  let right = Math.max(0, ...notes.map((n) => n.x + n.width));
  for (const d of dots) right = Math.max(right, d.x + dotBox.width);
  let left = 0;
  for (const n of notes) {
    left = Math.max(left, -n.x);
    if (n.accidental) left = Math.max(left, -n.accidental.left);
  }

  const layout: EventLayout = {
    event,
    partIndex: input.partIndex,
    staffIndex: input.staffIndex,
    voiceIndex: input.voiceIndex,
    offset: input.offset,
    length: input.length,
    notes,
    dots,
    ledgers,
    left,
    right,
  };
  if (stem) layout.stem = stem;
  if (flag) layout.flag = flag;
  return layout;
}

function buildStem(
  notes: NoteLayout[],
  dir: StemDirection,
  headGlyph: string,
  font: SmuflFontData,
  defaults: EngravingDefaults,
): StemLayout {
  const thickness = defaults.stemThickness;
  const lowest = notes[0]!;
  const highest = notes[notes.length - 1]!;
  if (dir === "up") {
    const a = glyphAnchor(font, headGlyph, "stemUpSE") ?? { x: glyphBox(font, headGlyph).width, y: 0 };
    return {
      dir,
      x: lowest.x + a.x - thickness / 2,
      thickness,
      yAttach: lowest.y + a.y,
      // Standard length from the outer notehead, extended to the middle line for
      // notes past the first leger line.
      yTip: Math.min(highest.y - ENGRAVING.stemLengthSp, 2),
    };
  }
  const a = glyphAnchor(font, headGlyph, "stemDownNW") ?? { x: 0, y: 0 };
  return {
    dir,
    x: highest.x + a.x + thickness / 2,
    thickness,
    yAttach: highest.y + a.y,
    yTip: Math.max(lowest.y + ENGRAVING.stemLengthSp, 2),
  };
}

function buildFlag(
  glyph: string,
  stem: StemLayout,
  font: SmuflFontData,
  defaults: EngravingDefaults,
): FlagLayout {
  const a = glyphAnchor(font, glyph, stem.dir === "up" ? "stemUpNW" : "stemDownSW") ?? { x: 0, y: 0 };
  const stemLeft = stem.x - defaults.stemThickness / 2;
  return { glyph, x: stemLeft - a.x, y: stem.yTip - a.y };
}

function buildLedgers(notes: NoteLayout[], defaults: EngravingDefaults): LedgerLayout[] {
  const ext = defaults.legerLineExtension;
  const out: LedgerLayout[] = [];
  const maxStep = Math.max(...notes.map((n) => n.step));
  const minStep = Math.min(...notes.map((n) => n.step));
  const emit = (step: number) => {
    const covering = notes.filter((n) => (step > 0 ? n.step >= step : n.step <= step));
    if (covering.length === 0) return;
    out.push({
      step,
      y: stepToY(0, step),
      x1: Math.min(...covering.map((n) => n.x)) - ext,
      x2: Math.max(...covering.map((n) => n.x + n.width)) + ext,
    });
  };
  for (let s = 6; s <= maxStep; s += 2) emit(s);
  for (let s = -6; s >= minStep; s -= 2) emit(s);
  return out;
}

// --- accidental columns ----------------------------------------------------

interface PendingAccidental {
  note: NoteLayout;
  glyphs: string[];
  width: number;
  top: number;
  bottom: number;
}

function assignAccidentals(notes: NoteLayout[], memory: AccidentalMemory, font: SmuflFontData): void {
  const pending: PendingAccidental[] = [];
  // Decide top-down: a chord is read from the top note downwards.
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]!;
    const decision = accidentalDecision(n.note, memory);
    if (!decision.show) continue;
    const core = accidentalGlyph(n.note.pitch.alter);
    const glyphs = decision.parens ? ["accidentalParensLeft", core, "accidentalParensRight"] : [core];
    const width = glyphs.reduce((w, g) => w + glyphBox(font, g).width, 0);
    const box = glyphBox(font, core);
    pending.push({
      note: n,
      glyphs,
      width,
      top: n.y - box.up - ENGRAVING.accidentalClearanceSp,
      bottom: n.y + box.down + ENGRAVING.accidentalClearanceSp,
    });
  }
  if (pending.length === 0) return;

  // Greedy packing: take the first (rightmost) column in which this accidental
  // does not overlap one already placed.
  const columns: PendingAccidental[][] = [];
  for (const p of pending) {
    let col = 0;
    for (;;) {
      const existing = columns[col];
      if (!existing) {
        columns[col] = [p];
        break;
      }
      if (!existing.some((q) => p.top < q.bottom && q.top < p.bottom)) {
        existing.push(p);
        break;
      }
      col++;
    }
  }

  let edge = Math.min(...notes.map((n) => n.x)) - ENGRAVING.accidentalGapSp;
  for (const column of columns) {
    const colWidth = Math.max(...column.map((p) => p.width));
    const colLeft = edge - colWidth;
    for (const p of column) {
      let x = colLeft;
      const parts: AccidentalPart[] = p.glyphs.map((g) => {
        const part = { glyph: g, x };
        x += glyphBox(font, g).width;
        return part;
      });
      p.note.accidental = { noteId: p.note.note.id, parts, left: colLeft, y: p.note.y };
    }
    edge = colLeft - ENGRAVING.accidentalColumnGapSp;
  }
}

// ---------------------------------------------------------------------------
// Beam grouping
// ---------------------------------------------------------------------------

/**
 * Beat unit for beam grouping: compound meters (numerator a multiple of 3
 * greater than 3, denominator 8 or shorter) group by dotted beats, everything
 * else by the denominator's note value.
 */
export function beatUnit(ts: TimeSignature): Fraction {
  const compound = ts.numerator % 3 === 0 && ts.numerator > 3 && ts.denominator >= 8;
  return compound ? frac(3, ts.denominator) : frac(1, ts.denominator);
}

/**
 * Coarser grouping used when a span contains nothing shorter than an eighth: in
 * 4/4 eighths are beamed by half-measure. `undefined` = no merging.
 */
export function coarseBeamUnit(ts: TimeSignature): Fraction | undefined {
  return ts.denominator === 4 && ts.numerator === 4 ? frac(1, 2) : undefined;
}

function segmentIndex(offset: Fraction, unit: Fraction): number {
  return Math.floor(toNumber(offset) / toNumber(unit) + 1e-9);
}

function isBeamable(r: RawEvent): boolean {
  if (r.event.kind !== "note") return false;
  if (beamCount(r.event.duration.base) === 0) return false;
  return r.event.beam !== "none";
}

/** Automatic beam groups, honouring per-event `beam` overrides. */
export function buildBeamGroups(
  raw: RawEvent[],
  ts: TimeSignature,
  measureLength: Fraction,
): BeamGroup[] {
  const unit = beatUnit(ts);
  const groups: number[][] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]!;
    if (!isBeamable(r)) {
      flush();
      continue;
    }
    const override = r.event.kind === "note" ? (r.event.beam ?? "auto") : "auto";
    const prevIndex = current[current.length - 1];
    const prev = prevIndex === undefined ? undefined : raw[prevIndex]!;
    let startNew: boolean;
    if (override === "begin" || prev === undefined) startNew = true;
    else if (override === "continue") startNew = false;
    else {
      const contiguous = eq(add(prev.offset, prev.length), r.offset);
      const sameSegment = segmentIndex(prev.offset, unit) === segmentIndex(r.offset, unit);
      startNew = !contiguous || !sameSegment;
    }
    if (startNew) flush();
    current.push(i);
    if (override === "end") flush();
  }
  flush();

  const merged = mergeCoarseGroups(groups, raw, ts, measureLength);

  const out: BeamGroup[] = [];
  for (const members of merged) {
    if (members.length < 2) continue;
    const counts = members.map((i) => {
      const ev = raw[i]!.event;
      return ev.kind === "note" ? beamCount(ev.duration.base) : 1;
    });
    const steps: number[] = [];
    for (const i of members) steps.push(...raw[i]!.steps);
    let override: StemDirection | undefined;
    for (const i of members) {
      const ev = raw[i]!.event;
      if (ev.kind === "note" && ev.stem) {
        override = ev.stem;
        break;
      }
    }
    out.push({ dir: stemDirectionForSteps(steps, override), members, counts });
  }
  return out;
}

/** In 4/4, join two beat groups of plain eighths into a half-measure group. */
function mergeCoarseGroups(
  groups: number[][],
  raw: RawEvent[],
  ts: TimeSignature,
  measureLength: Fraction,
): number[][] {
  const coarse = coarseBeamUnit(ts);
  if (!coarse) return groups;
  const out: number[][] = [];
  for (const g of groups) {
    const prev = out[out.length - 1];
    if (prev && canMerge(prev, g, raw, coarse, measureLength)) out[out.length - 1] = [...prev, ...g];
    else out.push(g);
  }
  return out;
}

function canMerge(
  a: number[],
  b: number[],
  raw: RawEvent[],
  coarse: Fraction,
  measureLength: Fraction,
): boolean {
  const last = raw[a[a.length - 1]!]!;
  const first = raw[b[0]!]!;
  if (!eq(add(last.offset, last.length), first.offset)) return false;
  const all = [...a, ...b].map((i) => raw[i]!);
  for (const r of all) {
    const ev = r.event;
    if (ev.kind !== "note") return false;
    if (ev.duration.base !== 8 || ev.duration.dots !== 0) return false;
    if (ev.beam && ev.beam !== "auto") return false;
  }
  // The merged span must stay inside one coarse unit and inside the measure.
  const start = all[0]!.offset;
  const lastMember = all[all.length - 1]!;
  const end = add(lastMember.offset, lastMember.length);
  if (segmentIndex(start, coarse) !== segmentIndex(lastMember.offset, coarse)) return false;
  return !lt(measureLength, end);
}

// ---------------------------------------------------------------------------
// Beam geometry (needs resolved x positions)
// ---------------------------------------------------------------------------

export interface BeamSegment {
  level: number;
  x1: number;
  x2: number;
  /** y of the beam's stem-tip edge at x1 and x2 (staff-local). */
  y1: number;
  y2: number;
  thickness: number;
}

export interface BeamResult {
  segments: BeamSegment[];
  /** Final stem tips, keyed by the member's index into the measure's event list. */
  stemTips: Map<number, number>;
}

/**
 * Beam polygons and the stem lengths that reach them.
 * `xOf(i)` returns the absolute x of event `i`'s column origin.
 */
export function beamGeometry(
  group: BeamGroup,
  events: EventLayout[],
  xOf: (eventIndex: number) => number,
  defaults: EngravingDefaults,
): BeamResult {
  const up = group.dir === "up";
  const thickness = defaults.beamThickness;
  const levelPitch = thickness + defaults.beamSpacing;
  const n = group.members.length;

  const stemXs = group.members.map((i) => xOf(i) + (events[i]!.stem?.x ?? 0));
  // The outer notehead in the stem direction is what stem length is measured from.
  const outerYs = group.members.map((i) => {
    const ys = events[i]!.notes.map((nl) => nl.y);
    return ys.length === 0 ? 2 : up ? Math.min(...ys) : Math.max(...ys);
  });
  const naturalTips = outerYs.map((y) => (up ? y - ENGRAVING.stemLengthSp : y + ENGRAVING.stemLengthSp));

  const x0 = stemXs[0]!;
  const xN = stemXs[n - 1]!;
  const span = xN - x0;

  // Slope follows the melodic direction of the outer notes, limited over the group.
  let delta = outerYs[0]! === outerYs[n - 1]! ? 0 : naturalTips[n - 1]! - naturalTips[0]!;
  const limit = ENGRAVING.maxBeamSlopeSp;
  delta = Math.max(-limit, Math.min(limit, delta));
  const mid = (naturalTips[0]! + naturalTips[n - 1]!) / 2;
  const lineAt = (x: number): number => (span === 0 ? mid : mid - delta / 2 + ((x - x0) / span) * delta);

  // Push the beam outwards until every stem is at least the minimum length.
  let shift = 0;
  for (let k = 0; k < n; k++) {
    const needed = up
      ? lineAt(stemXs[k]!) - (outerYs[k]! - ENGRAVING.minBeamStemSp)
      : outerYs[k]! + ENGRAVING.minBeamStemSp - lineAt(stemXs[k]!);
    if (needed > shift) shift = needed;
  }
  const offset = shift > 0 ? (up ? -shift : shift) : 0;
  const yAt = (x: number) => lineAt(x) + offset;

  const segments: BeamSegment[] = [];
  const halfStem = defaults.stemThickness / 2;
  const levelOffset = (level: number) => (up ? (level - 1) * levelPitch : -(level - 1) * levelPitch);
  const push = (level: number, a: number, b: number) => {
    const off = levelOffset(level);
    segments.push({ level, x1: a, x2: b, y1: yAt(a) + off, y2: yAt(b) + off, thickness });
  };

  const maxLevel = Math.max(...group.counts);
  for (let level = 1; level <= maxLevel; level++) {
    if (level === 1) {
      push(1, x0 - halfStem, xN + halfStem);
      continue;
    }
    let k = 0;
    while (k < n) {
      if (group.counts[k]! < level) {
        k++;
        continue;
      }
      let end = k;
      while (end + 1 < n && group.counts[end + 1]! >= level) end++;
      if (end > k) {
        push(level, stemXs[k]! - halfStem, stemXs[end]! + halfStem);
      } else {
        // Fractional beam, pointing back towards the previous note unless this
        // is the first note of the group.
        const x = stemXs[k]!;
        if (k === 0) push(level, x - halfStem, x + ENGRAVING.partialBeamSp);
        else push(level, x - ENGRAVING.partialBeamSp, x + halfStem);
      }
      k = end + 1;
    }
  }

  const stemTips = new Map<number, number>();
  for (let k = 0; k < n; k++) stemTips.set(group.members[k]!, yAt(stemXs[k]!));
  return { segments, stemTips };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Notated length of a measure, honouring a pickup's `actualLength`. */
export function effectiveMeasureLength(ts: TimeSignature, actual?: Fraction): Fraction {
  return actual ?? timeSigLength(ts);
}
