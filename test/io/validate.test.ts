import { describe, expect, it } from "vitest";
import { newPianoScore } from "@/model";
import { validateScore } from "@/io/validate";

describe("validateScore", () => {
  it("passes for a freshly built piano score", () => {
    const score = newPianoScore({ measureCount: 2 });
    expect(validateScore(score)).toEqual([]);
  });

  it("flags a voice whose length doesn't match the measure length", () => {
    const score = newPianoScore({ measureCount: 1 }); // 4/4
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [
      { kind: "note", id: "n1", duration: { base: 4, dots: 0 }, notes: [{ id: "p1", pitch: { step: "C", alter: 0, octave: 4 } }] },
    ];
    const issues = validateScore(score);
    expect(issues.some((i) => i.message.includes("does not match measure length"))).toBe(true);
  });

  it("allows a measureRest regardless of the time signature", () => {
    const score = newPianoScore({ measureCount: 1, timeSig: { numerator: 7, denominator: 8 } });
    // newPianoScore already fills every voice with a measureRest; length mismatch should not be flagged.
    expect(validateScore(score)).toEqual([]);
  });

  it("flags a dangling spanner anchor", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.spanners.push({
      id: "sp1",
      kind: "slur",
      partIndex: 0,
      staffIndex: 0,
      start: { kind: "event", eventId: "does-not-exist" },
      end: { kind: "event", eventId: "also-missing" },
    });
    const issues = validateScore(score);
    const danglers = issues.filter((i) => i.message.includes("unknown event id"));
    expect(danglers).toHaveLength(2);
  });

  it("flags a dangling attachment anchor", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.attachments.push({
      id: "att1",
      kind: "fermata",
      partIndex: 0,
      staffIndex: 0,
      anchor: { kind: "event", eventId: "nope" },
    });
    const issues = validateScore(score);
    expect(issues.some((i) => i.path === "attachments[0].anchor")).toBe(true);
  });

  it("flags duplicate ids", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.parts[0]!.staves[0]!.id = score.parts[0]!.id;
    const issues = validateScore(score);
    expect(issues.some((i) => i.message.includes("duplicate id"))).toBe(true);
  });

  it("flags a part with a different number of measures than the score", () => {
    const score = newPianoScore({ measureCount: 2 });
    score.parts[0]!.measures.pop();
    const issues = validateScore(score);
    expect(issues.some((i) => i.path === "parts[0].measures")).toBe(true);
  });

  it("flags a measure with a different number of staves than the part", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.parts[0]!.measures[0]!.staves.pop();
    const issues = validateScore(score);
    expect(issues.some((i) => i.path === "parts[0].measures[0].staves")).toBe(true);
  });
});
