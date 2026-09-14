import { describe, expect, it } from "vitest";
import { note, rest } from "@/model/factory";
import type { NoteEvent } from "@/model/score";
import {
  glyphs,
  lines,
  makeScore,
  polygons,
  run,
  setStaff,
  system,
  withRef,
  withRole,
} from "./helpers";

function beamOverride(ev: NoteEvent, beam: NonNullable<NoteEvent["beam"]>): NoteEvent {
  return { ...ev, beam };
}

function dotted(ev: NoteEvent): NoteEvent {
  return { ...ev, duration: { base: ev.duration.base, dots: 1 } };
}

/** Beam polygons in system 0, grouped by the ref id of the group's first event. */
function beamPolys(score: Parameters<typeof run>[0]) {
  const prims = system(run(score)).primitives;
  return polygons(withRole(prims, "beam"));
}

describe("automatic beam groups in 4/4", () => {
  it("beams four eighths as one group", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [note("C4", 8), note("D4", 8), note("E4", 8), note("F4", 8), rest(2)]);
    expect(beamPolys(score)).toHaveLength(1);
  });

  it("beams eight eighths as two half-measure groups", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(
      score,
      0,
      0,
      ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"].map((p) => note(p, 8)),
    );
    expect(beamPolys(score)).toHaveLength(2);
  });

  it("beams sixteenths by beat, with a secondary beam", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [
      ...["C4", "D4", "E4", "F4"].map((p) => note(p, 16)),
      ...["G4", "A4", "B4", "C5"].map((p) => note(p, 16)),
      rest(2),
    ]);
    const polys = beamPolys(score);
    // Two groups, each with a primary and a secondary beam.
    expect(polys).toHaveLength(4);
  });

  it("breaks a group at a rest", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [
      note("C4", 8),
      note("D4", 8),
      rest(8),
      rest(8),
      note("E4", 8),
      note("F4", 8),
      rest(4),
    ]);
    expect(beamPolys(score)).toHaveLength(2);
  });

  it("removes flags from beamed notes", () => {
    const score = makeScore({ measureCount: 1 });
    const a = note("C4", 8);
    const b = note("D4", 8);
    setStaff(score, 0, 0, [a, b, rest(4), rest(2)]);
    const prims = system(run(score)).primitives;
    expect(withRef(prims, a.id, "flag")).toHaveLength(0);
    expect(withRef(prims, b.id, "flag")).toHaveLength(0);
    expect(polygons(withRole(prims, "beam"))).toHaveLength(1);
  });

  it("does not beam a single eighth", () => {
    const score = makeScore({ measureCount: 1 });
    const a = note("C4", 8);
    setStaff(score, 0, 0, [a, rest(8), rest(4), rest(2)]);
    const prims = system(run(score)).primitives;
    expect(polygons(withRole(prims, "beam"))).toHaveLength(0);
    expect(glyphs(withRef(prims, a.id, "flag"))).toHaveLength(1);
  });
});

describe("compound and simple meters", () => {
  it("groups 6/8 by dotted-quarter beats", () => {
    const score = makeScore({ measureCount: 1, timeSig: { numerator: 6, denominator: 8 } });
    setStaff(
      score,
      0,
      0,
      ["C4", "D4", "E4", "F4", "G4", "A4"].map((p) => note(p, 8)),
    );
    expect(beamPolys(score)).toHaveLength(2);
  });

  it("groups 3/4 by quarter beats", () => {
    const score = makeScore({ measureCount: 1, timeSig: { numerator: 3, denominator: 4 } });
    setStaff(
      score,
      0,
      0,
      ["C4", "D4", "E4", "F4", "G4", "A4"].map((p) => note(p, 8)),
    );
    expect(beamPolys(score)).toHaveLength(3);
  });

  it("groups 9/8 by dotted-quarter beats", () => {
    const score = makeScore({ measureCount: 1, timeSig: { numerator: 9, denominator: 8 } });
    setStaff(
      score,
      0,
      0,
      ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5"].map((p) => note(p, 8)),
    );
    expect(beamPolys(score)).toHaveLength(3);
  });
});

describe("beam overrides", () => {
  it('"none" forces flags instead of a beam', () => {
    const score = makeScore({ measureCount: 1 });
    const a = beamOverride(note("C4", 8), "none");
    const b = beamOverride(note("D4", 8), "none");
    setStaff(score, 0, 0, [a, b, rest(4), rest(2)]);
    const prims = system(run(score)).primitives;
    expect(polygons(withRole(prims, "beam"))).toHaveLength(0);
    expect(glyphs(withRef(prims, a.id, "flag"))).toHaveLength(1);
    expect(glyphs(withRef(prims, b.id, "flag"))).toHaveLength(1);
  });

  it('"begin" starts a new group mid-beat', () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [
      note("C4", 8),
      beamOverride(note("D4", 8), "begin"),
      note("E4", 8),
      note("F4", 8),
      rest(2),
    ]);
    // 1st eighth is left alone (a group of one becomes a flag), then D-E-F beam.
    expect(beamPolys(score)).toHaveLength(1);
  });

  it('"continue" joins across a beat boundary', () => {
    const score = makeScore({ measureCount: 1, timeSig: { numerator: 3, denominator: 4 } });
    setStaff(score, 0, 0, [
      note("C4", 8),
      note("D4", 8),
      beamOverride(note("E4", 8), "continue"),
      note("F4", 8),
      note("G4", 8),
      note("A4", 8),
    ]);
    // Beats 1 and 2 merge, beat 3 stays separate.
    expect(beamPolys(score)).toHaveLength(2);
  });
});

describe("beam geometry", () => {
  it("is horizontal when the first and last notes are at the same height", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [note("C4", 8), note("E4", 8), note("D4", 8), note("C4", 8), rest(2)]);
    const poly = beamPolys(score)[0]!;
    expect(poly.points[0]![1]).toBeCloseTo(poly.points[1]![1], 6);
  });

  it("slopes with the melodic direction", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [note("C4", 8), note("D4", 8), note("E4", 8), note("F4", 8), rest(2)]);
    const poly = beamPolys(score)[0]!;
    // Rising melody, y grows downwards, so the right end is higher (smaller y).
    expect(poly.points[1]![1]).toBeLessThan(poly.points[0]![1]);
  });

  it("limits the slope to 1 sp across the group", () => {
    const score = makeScore({ measureCount: 1 });
    const a = note("C4", 8);
    const b = note("G5", 8);
    setStaff(score, 0, 0, [a, b, rest(4), rest(2)]);
    const prims = system(run(score)).primitives;
    const poly = polygons(withRole(prims, "beam"))[0]!;
    const [x1, y1] = poly.points[0]!;
    const [x2, y2] = poly.points[1]!;
    const beamY = (x: number) => y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
    // Measured between the outer stems, which is where the limit applies.
    const stems = [a, b].map((e) => lines(withRef(prims, e.id, "stem"))[0]!);
    const rise = Math.abs(beamY(stems[1]!.x1) - beamY(stems[0]!.x1));
    expect(rise).toBeLessThanOrEqual(1.0 + 1e-9);
  });

  it("uses the font's beam thickness", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [note("C4", 8), note("D4", 8), rest(4), rest(2)]);
    const poly = beamPolys(score)[0]!;
    const thickness = Math.abs(poly.points[3]![1] - poly.points[0]![1]);
    expect(thickness).toBeCloseTo(0.5, 6); // Bravura beamThickness
  });

  it("makes every stem reach the beam and stay at least 2.5 sp long", () => {
    const score = makeScore({ measureCount: 1 });
    const evs = [note("C4", 8), note("C5", 8), note("C4", 8), note("D4", 8)];
    setStaff(score, 0, 0, [...evs, rest(2)]);
    const prims = system(run(score)).primitives;
    const poly = polygons(withRole(prims, "beam"))[0]!;
    const [x1, y1] = poly.points[0]!;
    const [x2, y2] = poly.points[1]!;
    const beamY = (x: number) => y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);

    for (const ev of evs) {
      const stem = lines(withRef(prims, ev.id, "stem"))[0]!;
      expect(stem.y2).toBeCloseTo(beamY(stem.x1), 6);
      const head = glyphs(withRef(prims, ev.notes[0]!.id, "notehead"))[0]!;
      expect(Math.abs(stem.y2 - head.y)).toBeGreaterThanOrEqual(2.5 - 1e-9);
    }
  });

  it("adds a fractional beam for a dotted eighth plus a sixteenth", () => {
    const score = makeScore({ measureCount: 1 });
    const long = dotted(note("C4", 8));
    const short = note("D4", 16);
    setStaff(score, 0, 0, [long, short, rest(2), rest(4)]);
    const prims = system(run(score)).primitives;
    const polys = polygons(withRole(prims, "beam"));
    expect(polys).toHaveLength(2); // primary + fractional

    const stems = [long, short].map((e) => lines(withRef(prims, e.id, "stem"))[0]!);
    const primary = polys[0]!;
    const partial = polys[1]!;
    const primaryWidth = primary.points[1]![0] - primary.points[0]![0];
    const partialWidth = partial.points[1]![0] - partial.points[0]![0];
    expect(partialWidth).toBeLessThan(primaryWidth);
    // The fractional beam hangs off the sixteenth's stem, pointing back left.
    expect(partial.points[1]![0]).toBeCloseTo(stems[1]!.x1 + stems[1]!.thickness / 2, 6);
    expect(partial.points[0]![0]).toBeLessThan(stems[1]!.x1);
  });
});
