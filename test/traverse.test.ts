import { describe, expect, it } from "vitest";
import { frac, newPianoScore, note, positionedEvents, rest, voiceLength, type TupletGroup } from "@/model";

describe("traverse", () => {
  it("positions events including tuplets", () => {
    const triplet: TupletGroup = {
      kind: "tuplet",
      id: "t1",
      ratio: { actual: 3, normal: 2, unit: 8 },
      items: [note("C4", 8), note("D4", 8), note("E4", 8)],
    };
    const voice = { id: "v", index: 0, items: [note("C4", 4), triplet, rest(2)] };
    const pos = positionedEvents(voice);
    expect(pos.map((p) => `${p.offset.num}/${p.offset.den}`)).toEqual(["0/1", "1/4", "1/3", "5/12", "1/2"]);
    expect(voiceLength(voice)).toEqual(frac(1));
  });
  it("new piano score has two staves per measure", () => {
    const s = newPianoScore({ measureCount: 2 });
    expect(s.parts[0]!.measures).toHaveLength(2);
    expect(s.parts[0]!.measures[0]!.staves).toHaveLength(2);
  });
});
