import { describe, expect, it } from "vitest";
import { note } from "@/model/factory";
import type { Score, StaffGroupSymbol } from "@/model/score";
import { STAFF_HEIGHT } from "@/engraving/geometry";
import { satb } from "../fixtures/satb";
import {
  FONT,
  allSystems,
  glyphs,
  lines,
  makeScore,
  run,
  setStaff,
  staffTop,
  system,
  texts,
  withRole,
} from "./helpers";

/** A grand-staff score with a chosen group symbol and optional staff labels. */
function pianoWith(opts: {
  bracket?: StaffGroupSymbol;
  names?: [string, string];
  abbreviations?: [string, string];
  singleStaff?: boolean;
}): Score {
  const score = makeScore({ measureCount: 2 });
  const part = score.parts[0]!;
  if (opts.bracket) part.bracket = opts.bracket;
  if (opts.singleStaff) {
    part.staves = [part.staves[0]!];
    for (const m of part.measures) m.staves = [m.staves[0]!];
  }
  for (const [i, staff] of part.staves.entries()) {
    const name = opts.names?.[i];
    const abbreviation = opts.abbreviations?.[i];
    if (name !== undefined) staff.name = name;
    if (abbreviation !== undefined) staff.abbreviation = abbreviation;
  }
  setStaff(score, 0, 0, [note("C5", 1)]);
  return score;
}

function symbolGlyphs(score: Score, glyph: string) {
  return glyphs(system(run(score)).primitives, glyph);
}

describe("group symbols", () => {
  it("braces a two-staff part by default", () => {
    expect(symbolGlyphs(pianoWith({}), "brace")).toHaveLength(1);
    expect(symbolGlyphs(pianoWith({}), "bracketTop")).toHaveLength(0);
  });

  it("draws bracket tips joined by a thick line for bracket: bracket", () => {
    const score = pianoWith({ bracket: "bracket" });
    const sys = system(run(score));
    expect(glyphs(sys.primitives, "brace")).toHaveLength(0);
    const top = glyphs(sys.primitives, "bracketTop");
    const bottom = glyphs(sys.primitives, "bracketBottom");
    expect(top).toHaveLength(1);
    expect(bottom).toHaveLength(1);
    expect(top[0]!.x).toBeCloseTo(bottom[0]!.x, 6);
    expect(top[0]!.x).toBeLessThan(0);

    const thickness = FONT.engravingDefaults.bracketThickness;
    const spine = lines(sys.primitives).filter((l) => l.thickness === thickness && l.x1 < 0);
    expect(spine).toHaveLength(1);
    expect(spine[0]!.y1).toBeCloseTo(staffTop(sys, 0), 6);
    expect(spine[0]!.y2).toBeCloseTo(staffTop(sys, 1) + STAFF_HEIGHT, 6);
    expect(top[0]!.y).toBeCloseTo(spine[0]!.y1, 6);
    expect(bottom[0]!.y).toBeCloseTo(spine[0]!.y2, 6);
  });

  it("draws no symbol at all for bracket: none", () => {
    const sys = system(run(pianoWith({ bracket: "none" })));
    expect(glyphs(sys.primitives, "brace")).toHaveLength(0);
    expect(glyphs(sys.primitives, "bracketTop")).toHaveLength(0);
  });

  it("draws nothing for a one-staff part unless asked", () => {
    expect(symbolGlyphs(pianoWith({ singleStaff: true }), "brace")).toHaveLength(0);
    expect(symbolGlyphs(pianoWith({ singleStaff: true, bracket: "brace" }), "brace")).toHaveLength(
      1,
    );
    expect(
      symbolGlyphs(pianoWith({ singleStaff: true, bracket: "bracket" }), "bracketTop"),
    ).toHaveLength(1);
  });
});

describe("staff names", () => {
  it("draws the name left of the staff, right-aligned and centred on it", () => {
    const score = pianoWith({ names: ["Right hand", "Left hand"] });
    const sys = system(run(score));
    const labels = texts(withRole(sys.primitives, "text"));
    expect(labels.map((t) => t.text)).toEqual(["Right hand", "Left hand"]);
    for (const [i, label] of labels.entries()) {
      expect(label.anchor).toBe("end");
      expect(label.size).toBeCloseTo(1.6, 6);
      expect(label.x).toBeLessThan(0);
      const top = staffTop(sys, i);
      expect(label.y).toBeGreaterThan(top);
      expect(label.y).toBeLessThan(top + STAFF_HEIGHT);
    }
    // Right-aligned to the same edge, a clear gap left of the brace.
    expect(labels[0]!.x).toBeCloseTo(labels[1]!.x, 6);
  });

  it("grows the system indent to fit the labels", () => {
    const bare = system(run(pianoWith({}))).x;
    const named = system(run(pianoWith({ names: ["Right hand", "Left hand"] }))).x;
    expect(named).toBeGreaterThan(bare);
  });

  it("draws nothing when a staff has no label", () => {
    const sys = system(run(pianoWith({})));
    expect(texts(withRole(sys.primitives, "text"))).toHaveLength(0);
  });

  it("switches to abbreviations after the first system", () => {
    const systems = allSystems(run(satb()));
    expect(systems.length).toBeGreaterThan(1);
    const labelsOf = (i: number) =>
      texts(withRole(systems[i]!.primitives, "text")).map((t) => t.text);
    expect(labelsOf(0)).toEqual(["Soprano", "Alto", "Tenor", "Bass"]);
    expect(labelsOf(1)).toEqual(["S.", "A.", "T.", "B."]);
  });

  it("brackets every system of the SATB fixture", () => {
    for (const sys of allSystems(run(satb()))) {
      expect(glyphs(sys.primitives, "bracketTop")).toHaveLength(1);
      expect(glyphs(sys.primitives, "bracketBottom")).toHaveLength(1);
      expect(sys.staves).toHaveLength(4);
    }
  });
});
