/**
 * Horizontal spacing.
 *
 * A measure is a sequence of *columns*, one per distinct onset across every
 * staff of the system, so simultaneous notes on both staves of a grand staff
 * line up. Each column gets an ideal width derived from the shortest duration
 * starting there (logarithmic, standard engraving practice) and a minimum width
 * derived from the real glyph extents around it.
 *
 * Measure-local coordinates: x = 0 is the measure's left edge, i.e. the barline
 * that precedes it.
 */
import { cmp, fracToString, lt, toNumber, type Fraction, type TimeSignature } from "@/model/duration";
import type { Id } from "@/model/ids";
import type { KeySignature } from "@/model/pitch";
import type { BarlineStyle, ClefKind } from "@/model/score";
import type { EngravingDefaults, SmuflFontData } from "@/render/smufl/types";
import { ENGRAVING } from "./constants";
import {
  clefGlyph,
  clefGlyphStep,
  glyphBox,
  keyCancellationLayout,
  keySignatureLayout,
  stepToY,
  timeSigDigitGlyphs,
} from "./geometry";
import type { StaffMeasureLayout } from "./semantic";

// ---------------------------------------------------------------------------
// Prefix (clef / key / time)
// ---------------------------------------------------------------------------

export interface PrefixGlyph {
  glyph: string;
  /** Measure-local x of the glyph origin. */
  x: number;
  /** Staff-local y of the glyph origin. */
  y: number;
  role: "clef" | "keysig" | "timesig";
}

export interface StaffPrefix {
  partIndex: number;
  staffIndex: number;
  glyphs: PrefixGlyph[];
}

export interface MeasurePrefix {
  showClef: boolean;
  showKey: boolean;
  showTime: boolean;
  /** Total width, from the measure's left edge to the end of the last prefix item. */
  width: number;
  staves: StaffPrefix[];
}

export interface PrefixSpec {
  showClef: boolean;
  /** The key signature to draw (the key in force at a system start, the new key at a change). */
  key?: KeySignature;
  /** Set only at a key change: the outgoing key, whose accidentals may need cancelling. */
  cancelKey?: KeySignature;
  timeSig?: TimeSignature;
  /** Clef in force for each staff of the system, in `staves` order. */
  clefs: ClefKind[];
}

/** One accidental of the key block (cancellation naturals first, then the new key). */
interface KeyBlockItem {
  glyph: string;
  staffStep: number;
  /** Gap to leave before this glyph. */
  gapBefore: number;
}

function keyBlock(spec: PrefixSpec, clef: ClefKind): KeyBlockItem[] {
  const out: KeyBlockItem[] = [];
  if (!spec.key) return out;
  const cancels = spec.cancelKey ? keyCancellationLayout(spec.cancelKey, spec.key, clef) : [];
  for (const a of cancels) {
    out.push({
      glyph: a.glyph,
      staffStep: a.staffStep,
      gapBefore: out.length === 0 ? 0 : ENGRAVING.keyAccidentalGapSp,
    });
  }
  for (const [i, a] of keySignatureLayout(spec.key, clef).entries()) {
    const gapBefore =
      out.length === 0 ? 0 : i === 0 ? ENGRAVING.keyCancelGapSp : ENGRAVING.keyAccidentalGapSp;
    out.push({ glyph: a.glyph, staffStep: a.staffStep, gapBefore });
  }
  return out;
}

function keyBlockWidth(font: SmuflFontData, items: KeyBlockItem[]): number {
  return items.reduce((w, it) => w + it.gapBefore + glyphBox(font, it.glyph).width, 0);
}

/** Lay out the clef / key / time block at the start of a measure. */
export function layoutPrefix(
  font: SmuflFontData,
  staves: { partIndex: number; staffIndex: number }[],
  spec: PrefixSpec,
): MeasurePrefix {
  const showClef = spec.showClef;
  const showTime = spec.timeSig !== undefined;

  const clefWidth = showClef
    ? Math.max(0, ...spec.clefs.map((c) => glyphBox(font, clefGlyph(c)).width))
    : 0;

  // The key block is the cancellation naturals (if any) followed by the new key's
  // accidentals; C major with nothing to cancel is empty and takes no width.
  const blocks = spec.clefs.map((clef) => keyBlock(spec, clef));
  const keyWidth = Math.max(0, ...blocks.map((b) => keyBlockWidth(font, b)));
  const showKey = blocks.some((b) => b.length > 0);

  let timeWidth = 0;
  if (showTime && spec.timeSig) {
    const num = timeSigDigitGlyphs(spec.timeSig.numerator);
    const den = timeSigDigitGlyphs(spec.timeSig.denominator);
    const w = (gs: string[]) => gs.reduce((a, g) => a + glyphBox(font, g).width, 0);
    timeWidth = Math.max(w(num), w(den));
  }

  let x = showClef || showKey || showTime ? ENGRAVING.prefixLeadSp : 0;
  const clefX = x;
  if (showClef) x += clefWidth + ENGRAVING.clefGapSp;
  const keyX = x;
  if (showKey) x += keyWidth + ENGRAVING.keyGapSp;
  const timeX = x;
  if (showTime) x += timeWidth + ENGRAVING.timeGapSp;
  const width = x;

  const out: StaffPrefix[] = staves.map((s, i) => {
    const clef = spec.clefs[i] ?? "treble";
    const glyphs: PrefixGlyph[] = [];
    if (showClef) {
      glyphs.push({
        glyph: clefGlyph(clef),
        x: clefX,
        y: stepToY(0, clefGlyphStep(clef)),
        role: "clef",
      });
    }
    if (showKey) {
      let kx = keyX;
      for (const item of blocks[i] ?? keyBlock(spec, clef)) {
        kx += item.gapBefore;
        glyphs.push({ glyph: item.glyph, x: kx, y: stepToY(0, item.staffStep), role: "keysig" });
        kx += glyphBox(font, item.glyph).width;
      }
    }
    if (showTime && spec.timeSig) {
      const num = timeSigDigitGlyphs(spec.timeSig.numerator);
      const den = timeSigDigitGlyphs(spec.timeSig.denominator);
      const w = (gs: string[]) => gs.reduce((a, g) => a + glyphBox(font, g).width, 0);
      // Numerator centred on the 2nd line from the top, denominator on the 4th.
      for (const [row, gs] of [
        [1, num],
        [3, den],
      ] as [number, string[]][]) {
        let tx = timeX + (timeWidth - w(gs)) / 2;
        for (const g of gs) {
          glyphs.push({ glyph: g, x: tx, y: row, role: "timesig" });
          tx += glyphBox(font, g).width;
        }
      }
    }
    return { partIndex: s.partIndex, staffIndex: s.staffIndex, glyphs };
  });

  return { showClef, showKey, showTime, width, staves: out };
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export interface SpacingColumn {
  offset: Fraction;
  /** Shortest event length starting at this onset, across all staves. */
  shortest: Fraction;
  /** Duration-derived ideal width. */
  ideal: number;
  /** Ink extent left of the column origin (>= 0). */
  left: number;
  /** Ink extent right of the column origin (>= 0). */
  right: number;
  /** Measure-local x, filled in by `assignMeasureColumns`. */
  x: number;
}

/**
 * Ideal width of a column, logarithmic in its shortest duration:
 * `quarterColumnSp + logStepSp * log2(d / quarter)`, floored.
 */
export function idealColumnWidth(shortest: Fraction): number {
  const d = toNumber(shortest);
  if (d <= 0) return ENGRAVING.minIdealColumnSp;
  const w = ENGRAVING.quarterColumnSp + ENGRAVING.logStepSp * Math.log2(d / 0.25);
  return Math.max(ENGRAVING.minIdealColumnSp, w);
}

export function buildColumns(staves: StaffMeasureLayout[]): SpacingColumn[] {
  const byOffset = new Map<string, SpacingColumn>();
  for (const staff of staves) {
    for (const ev of staff.events) {
      const key = fracToString(ev.offset);
      const existing = byOffset.get(key);
      // A centred whole-measure rest does not constrain its column's extents.
      const left = ev.rest?.centred ? 0 : ev.left;
      const right = ev.rest?.centred ? 0 : ev.right;
      if (!existing) {
        byOffset.set(key, {
          offset: ev.offset,
          shortest: ev.length,
          ideal: 0,
          left,
          right,
          x: 0,
        });
      } else {
        if (lt(ev.length, existing.shortest)) existing.shortest = ev.length;
        existing.left = Math.max(existing.left, left);
        existing.right = Math.max(existing.right, right);
      }
    }
  }
  const cols = [...byOffset.values()].sort((a, b) => cmp(a.offset, b.offset));
  for (const c of cols) c.ideal = idealColumnWidth(c.shortest);
  return cols;
}

// ---------------------------------------------------------------------------
// Barlines
// ---------------------------------------------------------------------------

/** Ink width a closing barline needs to the left of the measure boundary. */
export function barlineWidth(style: BarlineStyle, d: EngravingDefaults): number {
  switch (style) {
    case "double":
    case "repeat-start":
    case "repeat-end":
    case "repeat-both":
      return d.thinBarlineThickness * 2 + d.barlineSeparation;
    case "final":
      return d.thinBarlineThickness + d.barlineSeparation + d.thickBarlineThickness;
    default:
      return d.thinBarlineThickness;
  }
}

// ---------------------------------------------------------------------------
// Measure spacing
// ---------------------------------------------------------------------------

export interface MeasureSpacing {
  measureIndex: number;
  measureId: Id;
  prefix: MeasurePrefix;
  columns: SpacingColumn[];
  staves: StaffMeasureLayout[];
  barline: BarlineStyle;
  barlineWidth: number;
  /** Fixed width before the first column origin. */
  head: number;
  /** Stretchable advances: `advances[i]` leads from column i to column i+1 (or to the barline). */
  advances: number[];
  /** Spring weight for each advance (the column's ideal width). */
  weights: number[];
  /** head + sum(advances) + barlineWidth. */
  naturalWidth: number;
  /** Final measure width, assigned by `justifySystem`. */
  width: number;
  /** Final x within the system, assigned by `justifySystem`. */
  x: number;
}

export function buildMeasureSpacing(args: {
  measureIndex: number;
  measureId: Id;
  prefix: MeasurePrefix;
  staves: StaffMeasureLayout[];
  barline: BarlineStyle;
  defaults: EngravingDefaults;
  /** Extra fixed space before the first column (e.g. room for a tie continuing from the previous system). */
  extraLead?: number;
}): MeasureSpacing {
  const columns = buildColumns(args.staves);
  const bw = barlineWidth(args.barline, args.defaults);
  const lead = ENGRAVING.measureLeadSp + (args.extraLead ?? 0);

  const head =
    columns.length === 0
      ? args.prefix.width + lead
      : args.prefix.width + lead + columns[0]!.left;

  const advances: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i]!;
    const next = columns[i + 1];
    const min = next
      ? c.right + ENGRAVING.minColumnGapSp + next.left
      : c.right + ENGRAVING.barlineLeadSp;
    advances.push(Math.max(c.ideal, min));
    weights.push(c.ideal);
  }

  const naturalWidth = head + advances.reduce((a, b) => a + b, 0) + bw;
  return {
    measureIndex: args.measureIndex,
    measureId: args.measureId,
    prefix: args.prefix,
    columns,
    staves: args.staves,
    barline: args.barline,
    barlineWidth: bw,
    head,
    advances,
    weights,
    naturalWidth,
    width: naturalWidth,
    x: 0,
  };
}

/**
 * Stretch a system's measures to exactly `targetWidth`, distributing the slack
 * across every column of every measure in proportion to its ideal width, and
 * assign each column its measure-local x.
 *
 * When `targetWidth` is below the natural width nothing is compressed; the
 * system simply keeps its natural width (the breaker should have avoided this).
 */
export function justifySystem(measures: MeasureSpacing[], targetWidth: number): void {
  const natural = measures.reduce((a, m) => a + m.naturalWidth, 0);
  const weight = measures.reduce((a, m) => a + m.weights.reduce((x, y) => x + y, 0), 0);
  const slack = targetWidth - natural;
  const perWeight = slack > 0 && weight > 0 ? slack / weight : 0;

  let x = 0;
  for (const [mi, m] of measures.entries()) {
    m.x = x;
    let cx = m.head;
    for (let i = 0; i < m.columns.length; i++) {
      m.columns[i]!.x = cx;
      cx += m.advances[i]! + perWeight * m.weights[i]!;
    }
    m.width = cx + m.barlineWidth;
    // Absorb floating point drift in the last measure so the system closes exactly.
    if (perWeight > 0 && mi === measures.length - 1) m.width = targetWidth - x;
    x += m.width;
  }
}
