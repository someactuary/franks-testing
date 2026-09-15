import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { newPianoScore } from "@/model";
import { keySignatureAt } from "@/input/navigation";
import { setKeySignature } from "@/commands/keysig";

describe("setKeySignature", () => {
  it("sets an explicit key change at a measure, in effect from there on", () => {
    const score = newPianoScore({ measureCount: 4, keySig: { fifths: 0, mode: "major" } });

    const next = produce(score, (d) => setKeySignature(2, { fifths: -3, mode: "major" }).apply(d));

    expect(next.measures[0]!.keySig).toEqual({ fifths: 0, mode: "major" });
    expect(next.measures[1]!.keySig).toBeUndefined();
    expect(next.measures[2]!.keySig).toEqual({ fifths: -3, mode: "major" });
    expect(keySignatureAt(next, 1)).toEqual({ fifths: 0, mode: "major" });
    expect(keySignatureAt(next, 2)).toEqual({ fifths: -3, mode: "major" });
    expect(keySignatureAt(next, 3)).toEqual({ fifths: -3, mode: "major" });
  });

  it("overwrites an existing explicit key change at the same measure", () => {
    const score = newPianoScore({ measureCount: 3 });
    const withChange = produce(score, (d) => setKeySignature(1, { fifths: 5, mode: "minor" }).apply(d));

    const next = produce(withChange, (d) => setKeySignature(1, { fifths: -2, mode: "major" }).apply(d));

    expect(next.measures[1]!.keySig).toEqual({ fifths: -2, mode: "major" });
  });

  it("removing (keySig: null) lets the previous key continue instead of erasing the key entirely", () => {
    const score = newPianoScore({ measureCount: 4, keySig: { fifths: 2, mode: "major" } });
    const withChange = produce(score, (d) => setKeySignature(2, { fifths: -4, mode: "major" }).apply(d));
    expect(keySignatureAt(withChange, 3)).toEqual({ fifths: -4, mode: "major" });

    const next = produce(withChange, (d) => setKeySignature(2, null).apply(d));

    expect(next.measures[2]!.keySig).toBeUndefined();
    expect(keySignatureAt(next, 2)).toEqual({ fifths: 2, mode: "major" });
    expect(keySignatureAt(next, 3)).toEqual({ fifths: 2, mode: "major" });
  });

  it("removing the key at measure 0 falls back to the keySignatureAt default (C major)", () => {
    const score = newPianoScore({ measureCount: 2, keySig: { fifths: 3, mode: "major" } });

    const next = produce(score, (d) => setKeySignature(0, null).apply(d));

    expect(next.measures[0]!.keySig).toBeUndefined();
    expect(keySignatureAt(next, 0)).toEqual({ fifths: 0, mode: "major" });
  });

  it("throws on an out-of-range measure index", () => {
    const score = newPianoScore({ measureCount: 2 });
    expect(() => produce(score, (d) => setKeySignature(5, { fifths: 1, mode: "major" }).apply(d))).toThrow();
  });
});
