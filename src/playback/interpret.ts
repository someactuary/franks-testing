/**
 * How notation *text* and marks become sound: dynamics to MIDI velocity, tempo words
 * to a metronome speed, articulations to note length and attack, rit./accel. words to
 * a tempo change. Pure lookup tables and small parsers with no timeline logic — the
 * timeline (./timeline.ts) decides *when*, this file decides *how much*.
 *
 * The numbers are the conventional ones notation programs use (MuseScore/Sibelius-like)
 * rather than anything measured; they're deliberately kept in one place so they're easy
 * to retune by ear.
 */
import { frac, type Fraction } from "@/model/duration";
import type { Articulation } from "@/model/score";

export const DEFAULT_BPM = 120;
/** Velocity of the music before any dynamic marking: mf. */
export const DEFAULT_VELOCITY = 80;

// ---------------------------------------------------------------------------
// Dynamics
// ---------------------------------------------------------------------------

const LEVELS: Record<string, number> = {
  pppp: 14,
  ppp: 24,
  pp: 36,
  p: 49,
  mp: 64,
  mf: 80,
  f: 96,
  ff: 112,
  fff: 122,
  ffff: 127,
};

/** Per-note accents (sforzando family): loud on that note only, the level underneath is unchanged. */
const ACCENT_MARKS = new Set(["sf", "sfz", "sffz", "fz", "rf", "rfz", "sfp", "sfpp"]);
/** How much louder than the prevailing level an accent mark's note is played. */
export const SFORZANDO_BUMP = 30;

export interface ParsedDynamic {
  /** Sets the prevailing level from here on. */
  level?: number;
  /** Accents just the notes starting here. */
  accent?: number;
  /** "fp"/"sfp": a second level that takes over `after` later. */
  then?: { level: number; after: Fraction };
}

/** Reads a dynamic marking's text ("mf", "ff", "sfz", "fp", ...); undefined if it isn't one. */
export function parseDynamic(raw: string): ParsedDynamic | undefined {
  const text = raw.trim().toLowerCase().replace(/[.\s]+$/g, "");
  if (text === "fp") return { level: LEVELS.f!, then: { level: LEVELS.p!, after: frac(1, 8) } };
  if (text === "sfp") return { accent: SFORZANDO_BUMP, then: { level: LEVELS.p!, after: frac(1, 8) } };
  if (text === "sfpp") return { accent: SFORZANDO_BUMP, then: { level: LEVELS.pp!, after: frac(1, 8) } };
  if (ACCENT_MARKS.has(text)) return { accent: SFORZANDO_BUMP };
  const level = LEVELS[text];
  return level === undefined ? undefined : { level };
}

/** How far a hairpin with no dynamic marking at its end moves the level. */
export const HAIRPIN_DEFAULT_DELTA = 22;

// ---------------------------------------------------------------------------
// Articulations
// ---------------------------------------------------------------------------

/** Velocity added to the attack by each articulation. */
export const ARTICULATION_VELOCITY: Record<Articulation, number> = {
  staccato: 0,
  staccatissimo: 4,
  tenuto: 0,
  accent: 16,
  marcato: 26,
  portato: 0,
};

/**
 * How long a note sounds, as a function of its notated length `len` (whole notes).
 * Staccato is capped in *absolute* value rather than being a fixed fraction: a
 * staccato half note is short, not a quarter note long.
 */
export function articulatedLength(articulations: readonly Articulation[] | undefined, len: Fraction): Fraction {
  if (!articulations || articulations.length === 0) return len;
  let out = len;
  for (const a of articulations) {
    let next: Fraction;
    switch (a) {
      case "staccato":
        next = minFrac(frac(len.num, len.den * 2), frac(1, 8));
        break;
      case "staccatissimo":
        next = minFrac(frac(len.num, len.den * 4), frac(1, 16));
        break;
      case "portato":
        next = frac(len.num * 3, len.den * 4);
        break;
      case "marcato":
        next = frac(len.num * 17, len.den * 20);
        break;
      default:
        next = len; // tenuto/accent: full value
    }
    out = minFrac(out, next);
  }
  // Never shorter than a 64th note, or never longer than the note itself.
  return minFrac(len, maxFrac(out, minFrac(len, frac(1, 64))));
}

function minFrac(a: Fraction, b: Fraction): Fraction {
  return a.num * b.den <= b.num * a.den ? a : b;
}
function maxFrac(a: Fraction, b: Fraction): Fraction {
  return a.num * b.den >= b.num * a.den ? a : b;
}

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/** Italian (and a few English) tempo words -> quarter-note beats per minute. Longer phrases first. */
const TEMPO_WORDS: [RegExp, number][] = [
  [/\ballegro\s+moderato\b/, 116],
  [/\ballegro\s+assai\b/, 150],
  [/\bmolto\s+allegro\b/, 152],
  [/\ballegro\s+con\s+brio\b/, 140],
  [/\bandante\s+moderato\b/, 92],
  [/\bprestissimo\b/, 200],
  [/\bpresto\b/, 180],
  [/\bvivacissimo\b/, 168],
  [/\bvivace\b/, 156],
  [/\ballegretto\b/, 112],
  [/\ballegro\b/, 132],
  [/\bmoderato\b/, 108],
  [/\bmoderately\b/, 108],
  [/\bandantino\b/, 84],
  [/\bandante\b/, 76],
  [/\badagietto\b/, 72],
  [/\badagio\b/, 66],
  [/\blarghetto\b/, 62],
  [/\blargo\b/, 52],
  [/\blento\b/, 56],
  [/\bgrave\b/, 44],
  [/\bslowly\b/, 60],
  [/\bfast\b/, 144],
  [/\bquickly\b/, 144],
];

/**
 * A metronome mark written as text — "♩ = 72", "♩. = 60", "♪ = 120" — as a quarter-note
 * tempo. Scanned scores often come through OCR with the note symbol misread as a letter
 * ("J = 110", "q = 72"), so those count too; without a note symbol there's nothing to say
 * what is being counted, so a bare "= 72" is only trusted by `tempoFromText`.
 */
export function metronomeFromText(raw: string): number | undefined {
  const m = /(?:^|[\s(])([♩♪]|[qQjJ])(\.?)\s*=\s*(\d+(?:\.\d+)?)/.exec(raw);
  if (!m) return undefined;
  const bpm = Number(m[3]);
  if (!(bpm > 0)) return undefined;
  return bpm * (m[1] === "♪" ? 0.5 : 1) * (m[2] === "." ? 1.5 : 1);
}

/**
 * A quarter-note tempo from a tempo mark's text: an explicit "♩ = 72" if it has one,
 * else a tempo word ("Andante"), else undefined.
 */
export function tempoFromText(raw: string): number | undefined {
  const text = raw.toLowerCase();
  const withSymbol = metronomeFromText(raw);
  if (withSymbol !== undefined) return withSymbol;
  const bare = /=\s*(\d+(?:\.\d+)?)/.exec(text);
  if (bare) return Number(bare[1]) > 0 ? Number(bare[1]) : undefined;
  for (const [re, bpm] of TEMPO_WORDS) if (re.test(text)) return bpm;
  return undefined;
}

export type TempoChange = { kind: "rit" | "accel"; factor: number } | { kind: "atempo" };

/**
 * Tempo *changes* named in expression text: "rit.", "molto rall.", "accel.", "a tempo".
 * `factor` is the fraction of the current tempo the change works toward.
 */
export function tempoChangeFromText(raw: string): TempoChange | undefined {
  const text = raw.toLowerCase();
  if (/\ba\s+tempo\b|\btempo\s+(primo|i)\b/.test(text)) return { kind: "atempo" };
  if (/\b(rit|ritard|ritardando|rall|rallentando|allarg|allargando)\b/.test(text)) {
    const factor = /\bmolto\b/.test(text) ? 0.55 : /\bpoco\b/.test(text) ? 0.85 : 0.7;
    return { kind: "rit", factor };
  }
  if (/\baccel(erando)?\b/.test(text)) {
    return { kind: "accel", factor: /\bpoco\b/.test(text) ? 1.12 : 1.25 };
  }
  return undefined;
}

/** How much longer a fermata holds its note (and everything sounding under it). */
export const FERMATA_HOLD = 2;
