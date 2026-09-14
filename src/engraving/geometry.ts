/**
 * Staff geometry: clefs, staff steps, glyph metrics.
 *
 * Coordinates follow docs/ARCHITECTURE.md: y is DOWN, the top staff line is at
 * `staffY`, lines are 1 sp apart, the middle line is `staffY + 2`. A "staff step"
 * is a diatonic position measured from the middle line, positive UP (so one step
 * is half a staff space).
 *
 * SMuFL metadata uses y UP; every read of a bbox or anchor here flips it.
 */
import type { NoteValue } from "@/model/duration";
import { diatonic, type Alter, type KeySignature, type Pitch, type Step } from "@/model/pitch";
import type { ClefKind } from "@/model/score";
import type { GlyphData, SmuflFontData } from "@/render/smufl/types";

/** Number of staff lines we support in M0. */
export const STAFF_LINES = 5;
/** Distance from the top line to the bottom line of a 5-line staff. */
export const STAFF_HEIGHT = STAFF_LINES - 1;

// ---------------------------------------------------------------------------
// Clefs
// ---------------------------------------------------------------------------

/**
 * Diatonic number of the pitch that sits on the middle line of the staff.
 * (treble B4 = 34, bass D3 = 22, alto C4 = 28, tenor A3 = 26.)
 * Octave-transposing clefs shift the reference so that the *sounding* pitch in
 * the model lands on the written position a player expects.
 */
export function clefMiddleDiatonic(clef: ClefKind): number {
  switch (clef) {
    case "treble":
      return 34; // B4
    case "treble8vb":
      return 34 - 7;
    case "treble8va":
      return 34 + 7;
    case "bass":
      return 22; // D3
    case "bass8vb":
      return 22 - 7;
    case "bass8va":
      return 22 + 7;
    case "alto":
      return 28; // C4
    case "tenor":
      return 26; // A3
  }
}

/** SMuFL glyph for a clef. */
export function clefGlyph(clef: ClefKind): string {
  switch (clef) {
    case "treble":
      return "gClef";
    case "treble8vb":
      return "gClef8vb";
    case "treble8va":
      return "gClef8va";
    case "bass":
      return "fClef";
    case "bass8vb":
      return "fClef8vb";
    case "bass8va":
      return "fClef8va";
    case "alto":
    case "tenor":
      return "cClef";
  }
}

/**
 * Staff step of the clef's own origin line: gClef sits on the G line (2nd from
 * the bottom, step -2), fClef on the F line (4th from the bottom, step +2),
 * cClef on the line it names (alto: middle line; tenor: 4th line from bottom).
 */
export function clefGlyphStep(clef: ClefKind): number {
  switch (clef) {
    case "treble":
    case "treble8vb":
    case "treble8va":
      return -2;
    case "bass":
    case "bass8vb":
    case "bass8va":
      return 2;
    case "alto":
      return 0;
    case "tenor":
      return 2;
  }
}

/** Diatonic staff step of a pitch on a staff with the given clef (0 = middle line, + = up). */
export function staffStep(p: Pitch, clef: ClefKind): number {
  return diatonic(p) - clefMiddleDiatonic(clef);
}

/** y (system coordinates) of a staff step on a staff whose top line is at `staffY`. */
export function stepToY(staffY: number, step: number): number {
  return staffY + 2 - step * 0.5;
}

// ---------------------------------------------------------------------------
// Key signatures
// ---------------------------------------------------------------------------

type ClefFamily = "treble" | "bass" | "alto" | "tenor";

function clefFamily(clef: ClefKind): ClefFamily {
  if (clef.startsWith("treble")) return "treble";
  if (clef.startsWith("bass")) return "bass";
  return clef === "tenor" ? "tenor" : "alto";
}

/**
 * Staff steps for the seven sharps (F C G D A E B) and seven flats (B E A D G C F)
 * in the conventional octave placement for each clef. Tenor clef uses the usual
 * exception that keeps the first sharp inside the staff.
 */
const SHARP_STEPS: Record<ClefFamily, readonly number[]> = {
  treble: [4, 1, 5, 2, -1, 3, 0],
  bass: [2, -1, 3, 0, -3, 1, -2],
  alto: [3, 0, 4, 1, -2, 2, -1],
  tenor: [-2, 2, -1, 3, 0, 4, 1],
};

const FLAT_STEPS: Record<ClefFamily, readonly number[]> = {
  treble: [0, 3, -1, 2, -2, 1, -3],
  bass: [-2, 1, -3, 0, -4, -1, -5],
  alto: [-1, 2, -2, 1, -3, 0, -4],
  tenor: [1, 4, 0, 3, -1, 2, -2],
};

export interface KeySigAccidental {
  step: Step;
  alter: Alter;
  staffStep: number;
  glyph: string;
}

/** The accidentals of a key signature in drawing order, with their staff steps. */
export function keySignatureLayout(key: KeySignature, clef: ClefKind): KeySigAccidental[] {
  const fam = clefFamily(clef);
  const sharps = key.fifths > 0;
  const count = Math.min(7, Math.abs(key.fifths));
  const order: readonly Step[] = sharps
    ? ["F", "C", "G", "D", "A", "E", "B"]
    : ["B", "E", "A", "D", "G", "C", "F"];
  const steps = sharps ? SHARP_STEPS[fam] : FLAT_STEPS[fam];
  const out: KeySigAccidental[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      step: order[i]!,
      alter: sharps ? 1 : -1,
      staffStep: steps[i]!,
      glyph: sharps ? "accidentalSharp" : "accidentalFlat",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Glyph metrics (SMuFL y-up → layout y-down)
// ---------------------------------------------------------------------------

export interface GlyphBox {
  /** Advance width; falls back to the bbox width. */
  width: number;
  /** Extent above the origin in layout coordinates (positive = upwards). */
  up: number;
  /** Extent below the origin in layout coordinates (positive = downwards). */
  down: number;
  left: number;
  right: number;
}

const EMPTY_BOX: GlyphBox = { width: 0, up: 0, down: 0, left: 0, right: 0 };

export function glyphData(font: SmuflFontData, name: string): GlyphData | undefined {
  return font.glyphs[name];
}

export function glyphBox(font: SmuflFontData, name: string): GlyphBox {
  const g = font.glyphs[name];
  if (!g) return EMPTY_BOX;
  const bbox = g.bbox;
  if (!bbox) return { width: g.adv ?? 0, up: 0, down: 0, left: 0, right: g.adv ?? 0 };
  return {
    width: g.adv ?? bbox.ne[0] - bbox.sw[0],
    up: bbox.ne[1],
    down: -bbox.sw[1],
    left: bbox.sw[0],
    right: bbox.ne[0],
  };
}

export function glyphWidth(font: SmuflFontData, name: string): number {
  return glyphBox(font, name).width;
}

/** A SMuFL anchor converted to layout coordinates (y flipped). */
export function glyphAnchor(font: SmuflFontData, name: string, anchor: string): { x: number; y: number } | undefined {
  const a = font.glyphs[name]?.anchors?.[anchor];
  return a ? { x: a[0], y: -a[1] } : undefined;
}

// ---------------------------------------------------------------------------
// Noteheads, flags, rests, accidentals
// ---------------------------------------------------------------------------

export function noteheadGlyph(base: NoteValue): string {
  if (base === 1) return "noteheadWhole";
  if (base === 2) return "noteheadHalf";
  return "noteheadBlack";
}

/** `base` 1 is a whole note; the model has no breve value, so doubleWhole is reachable only via this helper. */
export const NOTEHEAD_DOUBLE_WHOLE = "noteheadDoubleWhole";

/** Number of beams/flags a note value carries: quarter and longer = 0, eighth = 1, 16th = 2 ... */
export function beamCount(base: NoteValue): number {
  return base <= 4 ? 0 : Math.round(Math.log2(base / 4));
}

const FLAG_NAMES = ["", "8th", "16th", "32nd", "64th", "128th", "256th", "512th", "1024th"] as const;

export function flagGlyph(base: NoteValue, dir: "up" | "down"): string | undefined {
  const n = beamCount(base);
  const name = FLAG_NAMES[n];
  if (!name) return undefined;
  return `flag${name}${dir === "up" ? "Up" : "Down"}`;
}

export function restGlyph(base: NoteValue): string {
  switch (base) {
    case 1:
      return "restWhole";
    case 2:
      return "restHalf";
    case 4:
      return "restQuarter";
    case 8:
      return "rest8th";
    case 16:
      return "rest16th";
    case 32:
      return "rest32nd";
    case 64:
      return "rest64th";
    case 128:
      return "rest128th";
    case 256:
      return "rest256th";
  }
}

export function accidentalGlyph(alter: Alter): string {
  switch (alter) {
    case -2:
      return "accidentalDoubleFlat";
    case -1:
      return "accidentalFlat";
    case 0:
      return "accidentalNatural";
    case 1:
      return "accidentalSharp";
    case 2:
      return "accidentalDoubleSharp";
  }
}

export function timeSigDigitGlyphs(n: number): string[] {
  return String(Math.abs(Math.trunc(n)))
    .split("")
    .map((d) => `timeSig${d}`);
}
