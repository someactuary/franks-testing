/**
 * Shared helpers for MusicXML import and export: the error type, the mapping
 * tables between our model's enums and MusicXML element names, and a tiny XML
 * writer. Nothing here touches the DOM, so it is safe to import from both sides.
 */
import { frac, NOTE_VALUES, notatedToFraction, type Fraction, type NotatedDuration, type NoteValue } from "@/model";
import type { Articulation, ClefKind, Ornament } from "@/model";

export class MusicXmlError extends Error {}

// ---------------------------------------------------------------------------
// Note values
// ---------------------------------------------------------------------------

const TYPE_BY_VALUE: Record<NoteValue, string> = {
  1: "whole",
  2: "half",
  4: "quarter",
  8: "eighth",
  16: "16th",
  32: "32nd",
  64: "64th",
  128: "128th",
  256: "256th",
};

const VALUE_BY_TYPE: Record<string, NoteValue> = Object.fromEntries(
  (Object.entries(TYPE_BY_VALUE) as [string, string][]).map(([value, type]) => [type, Number(value) as NoteValue]),
);

export function noteTypeName(base: NoteValue): string {
  return TYPE_BY_VALUE[base];
}

/** MusicXML `<type>` text to a note value. Unknown or absent types return undefined. */
export function noteValueFromType(type: string | undefined): NoteValue | undefined {
  if (!type) return undefined;
  return VALUE_BY_TYPE[type.trim()];
}

/**
 * The notated duration whose plain length is exactly `len`, or — when `len` is
 * not representable at all — the largest plain value that is not longer.
 * Used when a note has no `<type>` (or an unknown one).
 */
export function notatedFromFraction(len: Fraction): NotatedDuration {
  for (const dots of [0, 1, 2, 3] as const) {
    for (const base of NOTE_VALUES) {
      const d: NotatedDuration = { base, dots };
      const f = notatedToFraction(d);
      if (f.num * len.den === len.num * f.den) return d;
    }
  }
  let best: NotatedDuration = { base: 256, dots: 0 };
  for (const base of NOTE_VALUES) {
    const f = notatedToFraction({ base, dots: 0 });
    if (f.num * len.den <= len.num * f.den) {
      best = { base, dots: 0 };
      break;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Clefs
// ---------------------------------------------------------------------------

export interface ClefSpec {
  sign: "G" | "F" | "C";
  line: number;
  octaveChange?: number;
}

const CLEFS: Record<ClefKind, ClefSpec> = {
  treble: { sign: "G", line: 2 },
  bass: { sign: "F", line: 4 },
  alto: { sign: "C", line: 3 },
  tenor: { sign: "C", line: 4 },
  treble8vb: { sign: "G", line: 2, octaveChange: -1 },
  treble8va: { sign: "G", line: 2, octaveChange: 1 },
  bass8vb: { sign: "F", line: 4, octaveChange: -1 },
  bass8va: { sign: "F", line: 4, octaveChange: 1 },
};

export function clefSpec(kind: ClefKind): ClefSpec {
  return CLEFS[kind];
}

export function clefKindFrom(sign: string, line: number | undefined, octaveChange: number): ClefKind | undefined {
  const s = sign.toUpperCase();
  if (s === "G") {
    if (octaveChange === -1) return "treble8vb";
    if (octaveChange === 1) return "treble8va";
    return "treble";
  }
  if (s === "F") {
    if (octaveChange === -1) return "bass8vb";
    if (octaveChange === 1) return "bass8va";
    return "bass";
  }
  if (s === "C") return line === 4 ? "tenor" : "alto";
  // percussion / TAB / none: no equivalent in our model.
  return undefined;
}

// ---------------------------------------------------------------------------
// Articulations, ornaments, noteheads, dynamics
// ---------------------------------------------------------------------------

export const ARTICULATION_ELEMENTS: Record<Articulation, string> = {
  staccato: "staccato",
  staccatissimo: "staccatissimo",
  tenuto: "tenuto",
  accent: "accent",
  marcato: "strong-accent",
  portato: "detached-legato",
};

export const ARTICULATION_BY_ELEMENT: Record<string, Articulation> = Object.fromEntries(
  (Object.entries(ARTICULATION_ELEMENTS) as [Articulation, string][]).map(([k, v]) => [v, k]),
);

export const ORNAMENT_ELEMENTS: Record<Ornament, string> = {
  trill: "trill-mark",
  mordent: "mordent",
  invertedMordent: "inverted-mordent",
  turn: "turn",
  invertedTurn: "inverted-turn",
};

export const ORNAMENT_BY_ELEMENT: Record<string, Ornament> = Object.fromEntries(
  (Object.entries(ORNAMENT_ELEMENTS) as [Ornament, string][]).map(([k, v]) => [v, k]),
);

export type NoteheadKind = "normal" | "x" | "diamond" | "slash" | "none";

export const NOTEHEADS: readonly NoteheadKind[] = ["normal", "x", "diamond", "slash", "none"];

/** The dynamics marks MusicXML has a dedicated element for. Anything else goes in `<other-dynamics>`. */
export const DYNAMIC_ELEMENTS: ReadonlySet<string> = new Set([
  "p",
  "pp",
  "ppp",
  "pppp",
  "ppppp",
  "pppppp",
  "f",
  "ff",
  "fff",
  "ffff",
  "fffff",
  "ffffff",
  "mp",
  "mf",
  "sf",
  "sfp",
  "sfpp",
  "fp",
  "rf",
  "rfz",
  "sfz",
  "sffz",
  "fz",
  "n",
  "pf",
  "sfzp",
]);

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

/** `len` (in whole notes) expressed in MusicXML divisions, rounded to the nearest tick. */
export function toDivisions(len: Fraction, divisions: number): number {
  return Math.round((len.num * divisions * 4) / len.den);
}

/** MusicXML divisions back to a fraction of a whole note. */
export function fromDivisions(duration: number, divisions: number): Fraction {
  return frac(Math.round(duration), Math.max(1, divisions) * 4);
}

// ---------------------------------------------------------------------------
// XML writing
// ---------------------------------------------------------------------------

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type Attrs = Record<string, string | number | undefined>;

function attrString(attrs: Attrs | undefined): string {
  if (!attrs) return "";
  let out = "";
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    out += ` ${k}="${escapeXml(String(v))}"`;
  }
  return out;
}

/** Minimal indentation-aware XML writer; the exporter's only output channel. */
export class XmlWriter {
  private readonly lines: string[] = [];
  private depth = 0;

  raw(line: string): void {
    this.lines.push(line);
  }

  open(name: string, attrs?: Attrs): void {
    this.lines.push(`${"  ".repeat(this.depth)}<${name}${attrString(attrs)}>`);
    this.depth += 1;
  }

  close(name: string): void {
    this.depth -= 1;
    this.lines.push(`${"  ".repeat(this.depth)}</${name}>`);
  }

  /** `<name attrs>text</name>`, or `<name attrs/>` when `text` is undefined. */
  leaf(name: string, text?: string | number, attrs?: Attrs): void {
    const indent = "  ".repeat(this.depth);
    if (text === undefined) this.lines.push(`${indent}<${name}${attrString(attrs)}/>`);
    else this.lines.push(`${indent}<${name}${attrString(attrs)}>${escapeXml(String(text))}</${name}>`);
  }

  toString(): string {
    return this.lines.join("\n");
  }
}
