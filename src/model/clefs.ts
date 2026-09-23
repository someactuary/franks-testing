/**
 * Clef changes: which clef is in force at a point in the score, and the stable ids the
 * editor uses to select one. See docs/ARCHITECTURE.md "Clef changes".
 *
 * A staff starts in `StaffDef.initialClef`; `StaffMeasure.clefChanges` switch it at a
 * measure-relative offset (0 = from the start of that measure). A change applies to
 * everything at or after its offset, including an event that starts exactly there.
 */
import { cmp, frac, fracToString, type Fraction } from "./duration";
import type { ClefKind, Score, StaffMeasure } from "./score";

/** Changes of one staff-measure, in time order. */
export function sortedClefChanges(
  sm: StaffMeasure | undefined,
): { at: Fraction; clef: ClefKind }[] {
  return [...(sm?.clefChanges ?? [])].sort((a, b) => cmp(a.at, b.at));
}

/** The clef in force at `offset` of this staff-measure, given the clef it started in. */
export function clefInMeasureAt(
  sm: StaffMeasure | undefined,
  entering: ClefKind,
  offset: Fraction,
): ClefKind {
  let clef = entering;
  for (const c of sortedClefChanges(sm)) {
    if (cmp(c.at, offset) > 0) break;
    clef = c.clef;
  }
  return clef;
}

/** The clef a staff is in when `measureIndex` begins, before any change at its offset 0. */
export function clefEnteringMeasure(
  score: Score,
  partIndex: number,
  staffIndex: number,
  measureIndex: number,
): ClefKind {
  const part = score.parts[partIndex];
  let clef: ClefKind = part?.staves[staffIndex]?.initialClef ?? "treble";
  if (!part) return clef;
  for (let mi = 0; mi < measureIndex; mi++) {
    const changes = sortedClefChanges(part.measures[mi]?.staves[staffIndex]);
    if (changes.length > 0) clef = changes[changes.length - 1]!.clef;
  }
  return clef;
}

/** The clef in force for a staff at a measure-relative `offset` (a change exactly there counts). */
export function clefAt(
  score: Score,
  partIndex: number,
  staffIndex: number,
  measureIndex: number,
  offset: Fraction,
): ClefKind {
  const entering = clefEnteringMeasure(score, partIndex, staffIndex, measureIndex);
  return clefInMeasureAt(
    score.parts[partIndex]?.measures[measureIndex]?.staves[staffIndex],
    entering,
    offset,
  );
}

/** Where one clef change sits; `clefChangeId`/`parseClefChangeId` round-trip it. */
export interface ClefChangeLocation {
  measureId: string;
  partIndex: number;
  staffIndex: number;
  at: Fraction;
}

const CLEF_CHANGE_PREFIX = "clefchange";

/**
 * Selection id of a clef change. Clef changes carry no id of their own in the model, so
 * the id encodes the change's position: its measure's (stable) id, part, staff and offset.
 */
export function clefChangeId(loc: ClefChangeLocation): string {
  const at = fracToString(frac(loc.at.num, loc.at.den)); // unreduced offsets give the same id
  return [CLEF_CHANGE_PREFIX, loc.measureId, loc.partIndex, loc.staffIndex, at].join("|");
}

export function parseClefChangeId(id: string): ClefChangeLocation | null {
  const parts = id.split("|");
  if (parts.length !== 5 || parts[0] !== CLEF_CHANGE_PREFIX) return null;
  const [, measureId, partIndex, staffIndex, at] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const m = /^(\d+)(?:\/([1-9]\d*))?$/.exec(at);
  if (!m || !/^\d+$/.test(partIndex) || !/^\d+$/.test(staffIndex)) return null;
  return {
    measureId,
    partIndex: Number(partIndex),
    staffIndex: Number(staffIndex),
    at: frac(Number(m[1]), m[2] ? Number(m[2]) : 1),
  };
}
