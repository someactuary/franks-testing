import { describe, expect, it } from "vitest";
import { diatonic, fromDiatonic, keyAlter, parsePitch, pitchToString, toMidi } from "@/model/pitch";

describe("pitch", () => {
  it("middle C is MIDI 60", () => {
    expect(toMidi(parsePitch("C4"))).toBe(60);
    expect(toMidi(parsePitch("A4"))).toBe(69);
    expect(toMidi(parsePitch("Bb3"))).toBe(58);
    expect(toMidi(parsePitch("B#3"))).toBe(60);
  });
  it("diatonic round trip", () => {
    expect(diatonic(parsePitch("C4"))).toBe(28);
    expect(pitchToString(fromDiatonic(29))).toBe("D4");
    expect(pitchToString(fromDiatonic(27))).toBe("B3");
  });
  it("key signature alterations", () => {
    expect(keyAlter({ fifths: 2, mode: "major" }, "F")).toBe(1);
    expect(keyAlter({ fifths: 2, mode: "major" }, "G")).toBe(0);
    expect(keyAlter({ fifths: -3, mode: "major" }, "A")).toBe(-1);
  });
});
