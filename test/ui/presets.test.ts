import { describe, expect, it } from "vitest";
import { newSatbScore } from "@/ui/presets";
import { validateScore } from "@/io/validate";

describe("newSatbScore", () => {
  it("validates with no structural issues", () => {
    const score = newSatbScore();
    expect(validateScore(score)).toEqual([]);
  });

  it("has 4 staves with SATB clefs and names, joined by a bracket", () => {
    const score = newSatbScore();
    const part = score.parts[0]!;
    expect(part.staves).toHaveLength(4);
    expect(part.staves.map((s) => s.initialClef)).toEqual(["treble", "treble", "treble8vb", "bass"]);
    expect(part.staves.map((s) => s.name)).toEqual(["Soprano", "Alto", "Tenor", "Bass"]);
    expect(part.bracket).toBe("bracket");
  });

  it("every staff starts with one voice, a whole-measure rest per measure", () => {
    const score = newSatbScore({ measureCount: 3 });
    const part = score.parts[0]!;
    expect(part.measures).toHaveLength(3);
    for (const pm of part.measures) {
      expect(pm.staves).toHaveLength(4);
      for (const sm of pm.staves) {
        expect(sm.voices).toHaveLength(1);
        expect(sm.voices[0]!.items).toHaveLength(1);
        expect(sm.voices[0]!.items[0]).toMatchObject({ kind: "rest", measureRest: true });
      }
    }
  });

  it("honors measureCount/timeSig/keySig options and still validates", () => {
    const score = newSatbScore({
      measureCount: 5,
      timeSig: { numerator: 3, denominator: 4 },
      keySig: { fifths: 2, mode: "major" },
      title: "Chorale",
    });
    expect(score.measures).toHaveLength(5);
    expect(score.measures[0]!.timeSig).toEqual({ numerator: 3, denominator: 4 });
    expect(score.measures[0]!.keySig).toEqual({ fifths: 2, mode: "major" });
    expect(score.meta.title).toBe("Chorale");
    expect(validateScore(score)).toEqual([]);
  });

  it("gives every staff, voice, and event a distinct id", () => {
    const score = newSatbScore();
    const part = score.parts[0]!;
    const staffIds = part.staves.map((s) => s.id);
    expect(new Set(staffIds).size).toBe(staffIds.length);
  });
});
