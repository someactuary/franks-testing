/**
 * Durations are exact rationals measured in whole notes. 1/4 = quarter note.
 * Never use floats for musical time. Ticks exist only in the playback layer.
 */

export interface Fraction {
  readonly num: number;
  readonly den: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function frac(num: number, den = 1): Fraction {
  if (!Number.isInteger(num) || !Number.isInteger(den)) throw new Error(`non-integer fraction ${num}/${den}`);
  if (den === 0) throw new Error("zero denominator");
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

export const ZERO: Fraction = frac(0, 1);
export const WHOLE: Fraction = frac(1, 1);
export const QUARTER: Fraction = frac(1, 4);

export function add(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den + b.num * a.den, a.den * b.den);
}
export function sub(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den - b.num * a.den, a.den * b.den);
}
export function mul(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.num, a.den * b.den);
}
export function div(a: Fraction, b: Fraction): Fraction {
  return frac(a.num * b.den, a.den * b.num);
}
export function cmp(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}
export function eq(a: Fraction, b: Fraction): boolean {
  return cmp(a, b) === 0;
}
export function lt(a: Fraction, b: Fraction): boolean {
  return cmp(a, b) < 0;
}
export function sum(fs: Iterable<Fraction>): Fraction {
  let acc = ZERO;
  for (const f of fs) acc = add(acc, f);
  return acc;
}
export function toNumber(f: Fraction): number {
  return f.num / f.den;
}
export function fracToString(f: Fraction): string {
  return `${f.num}/${f.den}`;
}

/** Notated base value as the denominator of a whole note: 1 = whole, 4 = quarter, 8 = eighth ... */
export type NoteValue = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256;
export const NOTE_VALUES: readonly NoteValue[] = [1, 2, 4, 8, 16, 32, 64, 128, 256];

/** What is written on the page: base value plus augmentation dots. Tuplet scaling lives on the enclosing TupletGroup. */
export interface NotatedDuration {
  readonly base: NoteValue;
  readonly dots: 0 | 1 | 2 | 3;
}

export function notated(base: NoteValue, dots: 0 | 1 | 2 | 3 = 0): NotatedDuration {
  return { base, dots };
}

/** Rational length of a notated duration ignoring tuplets: base * (2 - 1/2^dots). */
export function notatedToFraction(d: NotatedDuration): Fraction {
  // 1/base * (2^(dots+1) - 1) / 2^dots
  const p = 2 ** d.dots;
  return frac(2 * p - 1, d.base * p);
}

/** Time signature as written, e.g. 3/4, 6/8, 2/2. */
export interface TimeSignature {
  readonly numerator: number;
  readonly denominator: NoteValue;
}

export function measureLength(ts: TimeSignature): Fraction {
  return frac(ts.numerator, ts.denominator);
}
