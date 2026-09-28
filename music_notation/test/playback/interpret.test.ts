import { describe, expect, it } from "vitest";
import { frac } from "@/model/duration";
import {
  articulatedLength,
  metronomeFromText,
  parseDynamic,
  tempoChangeFromText,
  tempoFromText,
} from "@/playback/interpret";

describe("parseDynamic", () => {
  it("reads levels, ignoring case and trailing punctuation", () => {
    expect(parseDynamic("mf")).toEqual({ level: 80 });
    expect(parseDynamic(" PP. ")).toEqual({ level: 36 });
    expect(parseDynamic("fff")?.level).toBeGreaterThan(parseDynamic("ff")!.level!);
  });

  it("treats the sforzando family as per-note accents, not levels", () => {
    expect(parseDynamic("sfz")).toEqual({ accent: 30 });
    expect(parseDynamic("rfz")?.level).toBeUndefined();
  });

  it("reads fp as loud then soft", () => {
    expect(parseDynamic("fp")).toMatchObject({ level: 96, then: { level: 49 } });
  });

  it("returns undefined for text that isn't a dynamic", () => {
    expect(parseDynamic("dolce")).toBeUndefined();
    expect(parseDynamic("")).toBeUndefined();
  });
});

describe("tempo text", () => {
  it("reads metronome marks, dotted beats and OCR-mangled note symbols", () => {
    expect(metronomeFromText("♩ = 72")).toBe(72);
    expect(metronomeFromText("♩. = 60")).toBe(90);
    expect(metronomeFromText("♪ = 120")).toBe(60);
    expect(metronomeFromText("J=110")).toBe(110); // a note glyph OCR'd as a letter
    expect(metronomeFromText("Allegro ♩ = 132")).toBe(132);
  });

  it("does not mistake other text for a metronome mark", () => {
    expect(metronomeFromText("sub")).toBeUndefined();
    expect(metronomeFromText("120")).toBeUndefined();
    expect(metronomeFromText("m. d. = 5")).toBeUndefined();
  });

  it("reads tempo words, longest phrase first", () => {
    expect(tempoFromText("Allegro")).toBe(132);
    expect(tempoFromText("Allegro moderato")).toBe(116);
    expect(tempoFromText("Andante")).toBe(76);
    expect(tempoFromText("Andantino")).toBe(84);
    expect(tempoFromText("Rubato")).toBeUndefined();
  });

  it("recognises tempo changes and their strength", () => {
    expect(tempoChangeFromText("rit.")).toEqual({ kind: "rit", factor: 0.7 });
    expect(tempoChangeFromText("molto rall.")).toEqual({ kind: "rit", factor: 0.55 });
    expect(tempoChangeFromText("poco ritard.")).toEqual({ kind: "rit", factor: 0.85 });
    expect(tempoChangeFromText("accel.")).toMatchObject({ kind: "accel" });
    expect(tempoChangeFromText("a tempo")).toEqual({ kind: "atempo" });
    expect(tempoChangeFromText("dolce espressivo")).toBeUndefined();
  });
});

describe("articulatedLength", () => {
  it("leaves unmarked notes alone and never lengthens or zeroes a note", () => {
    expect(articulatedLength(undefined, frac(1, 4))).toEqual(frac(1, 4));
    expect(articulatedLength(["staccatissimo"], frac(1, 256))).toEqual(frac(1, 256)); // shorter than the 64th floor
    expect(articulatedLength(["staccato"], frac(1, 4))).toEqual(frac(1, 8));
  });

  it("takes the shortest when several apply", () => {
    expect(articulatedLength(["tenuto", "staccato"], frac(1, 4))).toEqual(frac(1, 8));
  });
});
