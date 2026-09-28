import { describe, expect, it } from "vitest";
import { newPianoScore } from "@/model";
import { parseScore, serializeScore, ScoreParseError, ScoreSchema } from "@/io/pscore";

describe("pscore serialization", () => {
  it("round-trips newPianoScore through serialize/parse", () => {
    const score = newPianoScore({ measureCount: 3, title: "Sonata", composer: "Someone" });
    const text = serializeScore(score);
    const parsed = parseScore(text);
    expect(parsed).toEqual(score);
  });

  it("round-trips a score with spanners, attachments, tuplets and grace notes", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const noteEventId = "ev-note-1";
    voice.items = [
      {
        kind: "note",
        id: noteEventId,
        duration: { base: 4, dots: 0 },
        notes: [{ id: "n1", pitch: { step: "C", alter: 0, octave: 4 }, tieStart: true }],
        grace: {
          id: "grace-1",
          slash: true,
          events: [
            {
              kind: "note",
              id: "grace-ev-1",
              duration: { base: 16, dots: 0 },
              notes: [{ id: "grace-n1", pitch: { step: "B", alter: 0, octave: 3 } }],
            },
          ],
        },
      },
      {
        kind: "tuplet",
        id: "tup-1",
        ratio: { actual: 3, normal: 2, unit: 8 },
        items: [
          { kind: "note", id: "t-n1", duration: { base: 8, dots: 0 }, notes: [{ id: "tn1", pitch: { step: "D", alter: 1, octave: 4 } }] },
          { kind: "note", id: "t-n2", duration: { base: 8, dots: 0 }, notes: [{ id: "tn2", pitch: { step: "E", alter: 0, octave: 4 } }] },
          { kind: "rest", id: "t-r1", duration: { base: 8, dots: 0 } },
        ],
      },
      // Fills out the rest of the 4/4 measure: 1/4 (note) + 1/4 (tuplet, 3 eighths at 3:2) + 1/2 (this rest) = 1.
      { kind: "rest", id: "fill-r1", duration: { base: 2, dots: 0 } },
    ];
    score.spanners.push({
      id: "sp1",
      kind: "slur",
      partIndex: 0,
      staffIndex: 0,
      start: { kind: "event", eventId: noteEventId },
      end: { kind: "event", eventId: "t-n2" },
      placement: "above",
    });
    score.attachments.push({
      id: "att1",
      kind: "dynamic",
      partIndex: 0,
      staffIndex: 0,
      anchor: { kind: "event", eventId: noteEventId },
      text: "mf",
    });

    const parsed = parseScore(serializeScore(score));
    expect(parsed).toEqual(score);
  });

  it("rejects an unknown top-level field with a readable error", () => {
    const raw = JSON.parse(serializeScore(newPianoScore()));
    raw.bogusField = 42;
    let thrown: unknown;
    try {
      parseScore(JSON.stringify(raw));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ScoreParseError);
    expect((thrown as ScoreParseError).message).toMatch(/bogusField/);
  });

  it("rejects an unknown nested field with a readable error naming its path", () => {
    const raw = JSON.parse(serializeScore(newPianoScore()));
    raw.parts[0].staves[0].bogus = true;
    let thrown: unknown;
    try {
      parseScore(JSON.stringify(raw));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ScoreParseError);
    expect((thrown as ScoreParseError).message).toMatch(/parts\.0\.staves\.0/);
  });

  it("rejects a formatVersion that is too new, with a readable error", () => {
    const raw = JSON.parse(serializeScore(newPianoScore()));
    raw.formatVersion = 999;
    let thrown: unknown;
    try {
      parseScore(JSON.stringify(raw));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ScoreParseError);
    expect((thrown as ScoreParseError).message).toMatch(/formatVersion/i);
  });

  it("rejects a non-numeric formatVersion, with a readable error", () => {
    const raw = JSON.parse(serializeScore(newPianoScore()));
    raw.formatVersion = "one";
    expect(() => parseScore(JSON.stringify(raw))).toThrow(ScoreParseError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseScore("{ not json")).toThrow(ScoreParseError);
  });

  it("ScoreSchema round-trips through safeParse directly", () => {
    const score = newPianoScore();
    const result = ScoreSchema.safeParse(JSON.parse(serializeScore(score)));
    expect(result.success).toBe(true);
  });
});
