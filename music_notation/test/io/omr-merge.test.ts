import { describe, expect, it } from "vitest";
import { newId, newPianoScore, note, type Score } from "@/model";
import { mergeOmrPages } from "@/io/omr-merge";
import { cleanupOmrScore } from "@/io/omr-cleanup";
import { validateScore } from "@/io/validate";

/** A piano page whose first measure's treble staff starts with `pitch`, so pages are easy to tell apart. */
function pianoPage(pitch: string, measureCount = 2): Score {
  const score = newPianoScore({ measureCount });
  score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [note(pitch, 1)];
  return score;
}

/** Solo treble staff over a piano grand staff (e.g. violin and piano). */
function trioPage(measureCount = 2): Score {
  const score = pianoPage("G4", measureCount);
  const part = score.parts[0]!;
  part.staves.unshift({ id: newId(), lines: 5, initialClef: "treble" });
  for (const pm of part.measures)
    pm.staves.unshift({ voices: [{ id: newId(), index: 0, items: [note("D5", 1)] }] });
  return score;
}

function firstPitch(score: Score, measureIndex: number, staffIndex: number): string | undefined {
  const item = score.parts[0]!.measures[measureIndex]!.staves[staffIndex]!.voices[0]!.items[0]!;
  if (item.kind !== "note") return undefined;
  const p = item.notes[0]!.pitch;
  return `${p.step}${p.octave}`;
}

describe("mergeOmrPages", () => {
  it("returns a single page unchanged, with no review", () => {
    const page = pianoPage("C5");
    const { score, review } = mergeOmrPages([page]);
    expect(score).toEqual(page);
    expect(score).not.toBe(page);
    expect(review).toEqual([]);
  });

  it("appends pages in order, starting each later page on a new page", () => {
    const { score, review } = mergeOmrPages([pianoPage("C5", 2), pianoPage("E5", 3)]);
    expect(score.measures).toHaveLength(5);
    expect(score.parts).toHaveLength(1);
    expect(score.parts[0]!.measures).toHaveLength(5);
    expect(firstPitch(score, 0, 0)).toBe("C5");
    expect(firstPitch(score, 2, 0)).toBe("E5");
    expect(score.layout.pageBreaks).toEqual([2]);
    expect(review).toEqual([]);
    expect(validateScore(score)).toEqual([]);
  });

  it("drops a later page's restated key/time signature but keeps a real change", () => {
    const second = pianoPage("E5");
    const third = pianoPage("G5");
    third.measures[0]!.timeSig = { numerator: 3, denominator: 4 };
    third.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [note("G5", 2, 1)];
    for (const staff of third.parts[0]!.measures[1]!.staves)
      staff.voices[0]!.items = [note("C4", 2, 1)];
    third.parts[0]!.measures[0]!.staves[1]!.voices[0]!.items = [note("C3", 2, 1)];
    const { score } = mergeOmrPages([pianoPage("C5"), second, third]);
    expect(score.measures[0]!.timeSig).toEqual({ numerator: 4, denominator: 4 });
    expect(score.measures[2]!.timeSig).toBeUndefined();
    expect(score.measures[2]!.keySig).toBeUndefined();
    expect(score.measures[4]!.timeSig).toEqual({ numerator: 3, denominator: 4 });
  });

  it("lines up a page that lost its top staff by clef, fills the gap with rests, and flags it", () => {
    // homr on a violin + piano photo: page 1 misses the small violin staff, page 2 has all three.
    const { score, review } = mergeOmrPages([pianoPage("C5"), trioPage()]);
    const part = score.parts[0]!;
    expect(part.staves.map((s) => s.initialClef)).toEqual(["treble", "treble", "bass"]);
    // Page 1's piano lands on staves 1-2, not on the violin staff.
    expect(firstPitch(score, 0, 1)).toBe("C5");
    const filler = part.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    expect(filler).toMatchObject({ kind: "rest", measureRest: true });
    expect(firstPitch(score, 2, 0)).toBe("D5");
    expect(firstPitch(score, 2, 1)).toBe("G4");
    expect(review).toEqual([
      expect.objectContaining({
        measureIndex: 0,
        staffIndex: 1,
        reason: "page-mismatch",
        detail: expect.stringMatching(/page 1 .* 2 of 3 staves/),
      }),
    ]);
    expect(validateScore(score)).toEqual([]);
  });

  it("shifts cross-staff events, markings, and measure anchors along with their page", () => {
    const first = pianoPage("C5");
    const second = pianoPage("E5");
    const lh = second.parts[0]!.measures[1]!.staves[1]!.voices[0]!;
    const crossing = note("F4", 1);
    crossing.staff = 0;
    lh.items = [crossing];
    second.attachments.push({
      id: newId(),
      kind: "dynamic",
      text: "p",
      partIndex: 0,
      staffIndex: 1,
      anchor: { kind: "measure", measureIndex: 1, offset: { num: 0, den: 1 } },
    });
    const { score } = mergeOmrPages([first, trioPage(), second]);
    // Page 3 (a two-staff page) sits under the violin staff: staff 0 -> 1, staff 1 -> 2.
    const moved = score.parts[0]!.measures[5]!.staves[2]!.voices[0]!.items[0]!;
    expect(moved).toMatchObject({ kind: "note", staff: 1 });
    expect(score.attachments[0]).toMatchObject({
      staffIndex: 2,
      anchor: { kind: "measure", measureIndex: 5 },
    });
  });

  it("adds a clef change where a page opens in a different clef than the staff was left in", () => {
    const second = pianoPage("E5");
    second.parts[0]!.staves[1]!.initialClef = "treble";
    const { score } = mergeOmrPages([pianoPage("C5"), second]);
    expect(score.parts[0]!.staves[1]!.initialClef).toBe("bass");
    expect(score.parts[0]!.measures[2]!.staves[1]!.clefChanges).toEqual([
      { at: { num: 0, den: 1 }, clef: "treble" },
    ]);
    expect(score.parts[0]!.measures[2]!.staves[0]!.clefChanges).toBeUndefined();
  });

  it("takes the title from the first page that has one", () => {
    const second = pianoPage("E5");
    second.meta.title = "Siciliano";
    const { score } = mergeOmrPages([pianoPage("C5"), second]);
    expect(score.meta.title).toBe("Siciliano");
  });
});

describe("cleanupOmrScore: instrument", () => {
  it("always plays an OMR import as piano, whatever program the engine guessed", () => {
    const score = pianoPage("C5");
    score.parts[0]!.midiProgram = 53; // "Voice Oohs", what Audiveris and homr write for a "Voice" part
    expect(
      cleanupOmrScore(score, { keep: "all", keepLayout: true }).score.parts[0]!.midiProgram,
    ).toBe(0);
  });
});
