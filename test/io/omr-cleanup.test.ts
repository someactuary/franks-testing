import { describe, expect, it } from "vitest";
import { newId, newPianoScore, note, rest, type RestEvent, type Spanner, type Attachment } from "@/model";
import { cleanupOmrScore } from "@/io/omr-cleanup";

describe("cleanupOmrScore: essentials vs all", () => {
  function scoreWithEverything() {
    const score = newPianoScore({ measureCount: 1 });
    const part = score.parts[0]!;
    const melody = note("C5", 4);
    melody.notes[0]!.tieStart = true;
    melody.notes[0]!.fingering = "1";
    melody.lyrics = [{ verse: 0, text: "la", syllabic: "single" }];
    melody.articulations = ["staccato", "accent"];
    melody.ornaments = ["trill"];
    const rest1: RestEvent = { ...rest(4) };
    const closer = note("E5", 2);
    part.measures[0]!.staves[0]!.voices[0]!.items = [melody, rest1, closer];

    const slur: Spanner = {
      id: newId(),
      kind: "slur",
      partIndex: 0,
      staffIndex: 0,
      start: { kind: "event", eventId: melody.id },
      end: { kind: "event", eventId: closer.id },
    };
    const dynamic: Attachment = {
      id: newId(),
      kind: "dynamic",
      text: "mf",
      partIndex: 0,
      staffIndex: 0,
      anchor: { kind: "event", eventId: melody.id },
    };
    score.spanners.push(slur);
    score.attachments.push(dynamic);
    return { score, melody, closer };
  }

  it("essentials keeps ties but drops slurs, dynamics, lyrics, articulations, ornaments and fingering", () => {
    const { score, melody } = scoreWithEverything();
    const { score: cleaned } = cleanupOmrScore(score, { keep: "essentials", keepLayout: true });

    expect(cleaned.spanners).toEqual([]);
    expect(cleaned.attachments).toEqual([]);

    const cleanedMelody = cleaned.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    expect(cleanedMelody.kind).toBe("note");
    if (cleanedMelody.kind !== "note") throw new Error("expected a note");
    expect(cleanedMelody.notes[0]!.tieStart).toBe(true); // ties survive essentials
    expect(cleanedMelody.notes[0]!.fingering).toBeUndefined();
    expect(cleanedMelody.lyrics).toBeUndefined();
    expect(cleanedMelody.articulations).toBeUndefined();
    expect(cleanedMelody.ornaments).toBeUndefined();

    // The input itself must never be mutated.
    expect(score.spanners).toHaveLength(1);
    expect(score.attachments).toHaveLength(1);
    const originalMelody = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (originalMelody.kind !== "note") throw new Error("expected a note");
    expect(originalMelody.lyrics).toBeDefined();
    expect(originalMelody.notes[0]!.fingering).toBe("1");
    expect(melody.lyrics).toBeDefined(); // sanity: our own reference is unaffected too
  });

  it("all keeps everything recognized", () => {
    const { score } = scoreWithEverything();
    const { score: cleaned } = cleanupOmrScore(score, { keep: "all", keepLayout: true });

    expect(cleaned.spanners).toHaveLength(1);
    expect(cleaned.attachments).toHaveLength(1);
    const cleanedMelody = cleaned.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (cleanedMelody.kind !== "note") throw new Error("expected a note");
    expect(cleanedMelody.lyrics).toEqual([{ verse: 0, text: "la", syllabic: "single" }]);
    expect(cleanedMelody.articulations).toEqual(["staccato", "accent"]);
    expect(cleanedMelody.ornaments).toEqual(["trill"]);
    expect(cleanedMelody.notes[0]!.fingering).toBe("1");
    expect(cleanedMelody.notes[0]!.tieStart).toBe(true);
  });

  it("strips essentials inside tuplets and grace notes too", () => {
    const score = newPianoScore({ measureCount: 1 });
    const grace = note("B4", 8);
    grace.articulations = ["staccato"];
    const host = note("C5", 4);
    host.grace = { id: newId(), events: [grace], slash: true };
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [host, note("D5", 4), note("E5", 2)];

    const { score: cleaned } = cleanupOmrScore(score, { keep: "essentials", keepLayout: true });
    const cleanedHost = cleaned.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (cleanedHost.kind !== "note" || !cleanedHost.grace) throw new Error("expected a note with grace");
    expect(cleanedHost.grace.events[0]!.articulations).toBeUndefined();
  });
});

describe("cleanupOmrScore: generic part/staff names", () => {
  it("blanks generic Audiveris part names and drops generic staff labels", () => {
    const score = newPianoScore({ measureCount: 1 });
    const part = score.parts[0]!;
    part.name = "Piano";
    part.abbreviation = "P1";
    part.staves[0]!.name = "Voice 1";
    part.staves[0]!.abbreviation = "MusicXML Part";
    part.staves[1]!.name = "Staff 2";
    part.staves[1]!.abbreviation = "Instrument";

    const { score: cleaned } = cleanupOmrScore(score, { keep: "all", keepLayout: true });
    const cleanedPart = cleaned.parts[0]!;
    expect(cleanedPart.name).toBe("");
    expect(cleanedPart.abbreviation).toBeUndefined();
    expect(cleanedPart.staves[0]!.name).toBeUndefined();
    expect(cleanedPart.staves[0]!.abbreviation).toBeUndefined();
    expect(cleanedPart.staves[1]!.name).toBeUndefined();
    expect(cleanedPart.staves[1]!.abbreviation).toBeUndefined();
  });

  it("keeps real instrument names", () => {
    const score = newPianoScore({ measureCount: 1 });
    const part = score.parts[0]!;
    part.name = "Right Hand";
    part.staves[0]!.name = "Soprano";
    const { score: cleaned } = cleanupOmrScore(score, { keep: "all", keepLayout: true });
    expect(cleaned.parts[0]!.name).toBe("Right Hand");
    expect(cleaned.parts[0]!.staves[0]!.name).toBe("Soprano");
  });

  it("recognizes P1..P99 and numbered Part/Staff labels case-insensitively", () => {
    const score = newPianoScore({ measureCount: 1 });
    const part = score.parts[0]!;
    part.name = "p42";
    part.staves[0]!.name = "PART 3";
    part.staves[1]!.name = "staff 12";
    const { score: cleaned } = cleanupOmrScore(score, { keep: "all", keepLayout: true });
    expect(cleaned.parts[0]!.name).toBe("");
    expect(cleaned.parts[0]!.staves[0]!.name).toBeUndefined();
    expect(cleaned.parts[0]!.staves[1]!.name).toBeUndefined();
  });
});

describe("cleanupOmrScore: keepLayout", () => {
  it("keeps system/page breaks when keepLayout is true", () => {
    const score = newPianoScore({ measureCount: 3 });
    score.layout.systemBreaks = [1];
    score.layout.pageBreaks = [2];
    const { score: cleaned } = cleanupOmrScore(score, { keep: "all", keepLayout: true });
    expect(cleaned.layout.systemBreaks).toEqual([1]);
    expect(cleaned.layout.pageBreaks).toEqual([2]);
  });

  it("clears system/page breaks when keepLayout is false", () => {
    const score = newPianoScore({ measureCount: 3 });
    score.layout.systemBreaks = [1];
    score.layout.pageBreaks = [2];
    const { score: cleaned } = cleanupOmrScore(score, { keep: "all", keepLayout: false });
    expect(cleaned.layout.systemBreaks).toEqual([]);
    expect(cleaned.layout.pageBreaks).toEqual([]);
    // Original untouched.
    expect(score.layout.systemBreaks).toEqual([1]);
  });
});

describe("cleanupOmrScore: review items", () => {
  it("flags a (measure, staff) whose voice the importer padded with invisible rests", () => {
    const score = newPianoScore({ measureCount: 1 }); // 4/4
    const invisibleGap: RestEvent = { ...rest(4), invisible: true }; // quarter, padded
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [note("C4", 4), invisibleGap, note("D4", 2)];

    const { review } = cleanupOmrScore(score, { keep: "essentials", keepLayout: true });
    const padded = review.filter((r) => r.reason === "padded-voice");
    expect(padded).toHaveLength(1);
    expect(padded[0]).toMatchObject({ measureIndex: 0, staffIndex: 0, reason: "padded-voice" });
    expect(padded[0]!.detail).toMatch(/1\/4/);
  });

  it("does not flag an ordinary whole-measure rest as padding", () => {
    const score = newPianoScore({ measureCount: 1 });
    const { review } = cleanupOmrScore(score, { keep: "essentials", keepLayout: true });
    expect(review.filter((r) => r.reason === "padded-voice")).toEqual([]);
  });

  it("maps a validateScore issue back to its measure and staff", () => {
    const score = newPianoScore({ measureCount: 1 }); // 4/4
    // A single quarter note leaves the voice short of the 4/4 measure length.
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [note("C4", 4)];

    const { review } = cleanupOmrScore(score, { keep: "essentials", keepLayout: true });
    const validation = review.filter((r) => r.reason === "validation");
    expect(validation).toHaveLength(1);
    expect(validation[0]).toMatchObject({ measureIndex: 0, staffIndex: 0, reason: "validation" });
    expect(validation[0]!.detail).toMatch(/does not match measure length/);
  });

  it("sorts the combined review list by measure, even when items arrive out of order", () => {
    const score = newPianoScore({ measureCount: 3 }); // 4/4 each

    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [
      note("C4", 4),
      { ...rest(4), invisible: true },
      note("D4", 2),
    ];
    score.parts[0]!.measures[2]!.staves[0]!.voices[0]!.items = [
      note("C4", 4),
      { ...rest(4), invisible: true },
      note("D4", 2),
    ];
    // Measure 1 gets a validation issue (short voice) instead of padding, so the
    // concatenation order (padded reviews for measures 0, 2, then the validation
    // review for measure 1) is not already sorted going in.
    score.parts[0]!.measures[1]!.staves[0]!.voices[0]!.items = [note("C4", 4)];

    const { review } = cleanupOmrScore(score, { keep: "essentials", keepLayout: true });
    const measureIndices = review.map((r) => r.measureIndex);
    const sorted = [...measureIndices].sort((a, b) => a - b);
    expect(measureIndices).toEqual(sorted);
    expect(measureIndices).toEqual([0, 1, 2]);
  });
});

describe("cleanupOmrScore: purity", () => {
  it("never mutates the input score", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.parts[0]!.name = "Piano";
    score.layout.systemBreaks = [0];
    const slur: Spanner = {
      id: newId(),
      kind: "slur",
      partIndex: 0,
      staffIndex: 0,
      start: { kind: "measure", measureIndex: 0, offset: { num: 0, den: 1 } },
      end: { kind: "measure", measureIndex: 0, offset: { num: 1, den: 4 } },
    };
    score.spanners.push(slur);

    cleanupOmrScore(score, { keep: "essentials", keepLayout: false });

    expect(score.parts[0]!.name).toBe("Piano");
    expect(score.spanners).toHaveLength(1);
    expect(score.layout.systemBreaks).toEqual([0]);
  });
});
