import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { newPianoScore, note, rest } from "@/model";
import { removeLyric, setLyric, setLyricExtend, setLyricSyllabic } from "@/commands/lyrics";

function scoreWithNote() {
  const score = newPianoScore({ measureCount: 1 });
  const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
  const ev = note("C4", 4);
  voice.items = [ev, rest(4), rest(2)];
  return { score, ev };
}

describe("setLyric", () => {
  it("creates a lyric on a verse with no lyric yet, defaulting syllabic to single", () => {
    const { score, ev } = scoreWithNote();
    const next = produce(score, (d) => setLyric(ev.id, 0, { text: "Hel" }).apply(d));
    const item = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics).toEqual([{ verse: 0, text: "Hel", syllabic: "single" }]);
  });

  it("replaces an existing verse's lyric wholesale (not merged)", () => {
    const { score, ev } = scoreWithNote();
    const withFirst = produce(score, (d) => setLyric(ev.id, 0, { text: "Hel", syllabic: "begin", extend: true }).apply(d));
    const replaced = produce(withFirst, (d) => setLyric(ev.id, 0, { text: "lo" }).apply(d));
    const item = replaced.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    // syllabic/extend reset to defaults since the new call didn't specify them
    expect(item.lyrics).toEqual([{ verse: 0, text: "lo", syllabic: "single" }]);
  });

  it("keeps verses sorted and independent", () => {
    const { score, ev } = scoreWithNote();
    const withVerse1 = produce(score, (d) => setLyric(ev.id, 1, { text: "second" }).apply(d));
    const withBoth = produce(withVerse1, (d) => setLyric(ev.id, 0, { text: "first" }).apply(d));
    const item = withBoth.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics!.map((l) => l.verse)).toEqual([0, 1]);
    expect(item.lyrics!.map((l) => l.text)).toEqual(["first", "second"]);
  });

  it("empty text removes the verse's lyric", () => {
    const { score, ev } = scoreWithNote();
    const withLyric = produce(score, (d) => setLyric(ev.id, 0, { text: "Hel" }).apply(d));
    const removed = produce(withLyric, (d) => setLyric(ev.id, 0, { text: "" }).apply(d));
    const item = removed.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics).toBeUndefined();
  });

  it("empty text on a verse with no lyric is a no-op", () => {
    const { score, ev } = scoreWithNote();
    const next = produce(score, (d) => setLyric(ev.id, 0, { text: "" }).apply(d));
    const item = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics).toBeUndefined();
  });

  it("throws for a rest event (rests never carry lyrics)", () => {
    const { score } = scoreWithNote();
    const restId = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[1]!.id;
    expect(() => produce(score, (d) => setLyric(restId, 0, { text: "x" }).apply(d))).toThrow();
  });
});

describe("removeLyric", () => {
  it("removes the lyric at a verse, leaving other verses intact", () => {
    const { score, ev } = scoreWithNote();
    const withBoth = produce(score, (d) => {
      setLyric(ev.id, 0, { text: "one" }).apply(d);
      setLyric(ev.id, 1, { text: "two" }).apply(d);
    });
    const removed = produce(withBoth, (d) => removeLyric(ev.id, 0).apply(d));
    const item = removed.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics).toEqual([{ verse: 1, text: "two", syllabic: "single" }]);
  });

  it("is a no-op when there is no lyric at that verse", () => {
    const { score, ev } = scoreWithNote();
    const next = produce(score, (d) => removeLyric(ev.id, 0).apply(d));
    const item = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics).toBeUndefined();
  });
});

describe("setLyricSyllabic / setLyricExtend", () => {
  it("sets the syllabic value on an existing lyric", () => {
    const { score, ev } = scoreWithNote();
    const withLyric = produce(score, (d) => setLyric(ev.id, 0, { text: "Hel" }).apply(d));
    const next = produce(withLyric, (d) => setLyricSyllabic(ev.id, 0, "begin").apply(d));
    const item = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.syllabic).toBe("begin");
  });

  it("sets and clears extend on an existing lyric", () => {
    const { score, ev } = scoreWithNote();
    const withLyric = produce(score, (d) => setLyric(ev.id, 0, { text: "ah" }).apply(d));
    const extended = produce(withLyric, (d) => setLyricExtend(ev.id, 0, true).apply(d));
    let item = extended.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.extend).toBe(true);

    const unextended = produce(extended, (d) => setLyricExtend(ev.id, 0, false).apply(d));
    item = unextended.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.extend).toBeUndefined();
  });

  it("throws when the verse has no lyric yet", () => {
    const { score, ev } = scoreWithNote();
    expect(() => produce(score, (d) => setLyricSyllabic(ev.id, 0, "begin").apply(d))).toThrow();
    expect(() => produce(score, (d) => setLyricExtend(ev.id, 0, true).apply(d))).toThrow();
  });
});
