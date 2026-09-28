import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { frac, newPianoScore, note, rest, type Score, type VoiceItem } from "@/model";
import { makeTuplet, removeTuplet, writeEvent, WriteRefused } from "@/commands/edit";
import type { Cursor } from "@/input/types";

function cursorAt(measureIndex: number, offset = frac(0)): Cursor {
  return { partIndex: 0, measureIndex, staffIndex: 0, voiceIndex: 0, offset };
}

function voiceOf(score: Score, measureIndex: number, staffIndex = 0) {
  return score.parts[0]!.measures[measureIndex]!.staves[staffIndex]!.voices[0]!;
}

function asEvent(item: VoiceItem) {
  if (item.kind === "tuplet") throw new Error("expected a note/rest event, got a tuplet");
  return item;
}

describe("makeTuplet", () => {
  it("turns a quarter into a triplet of eighths: original note first, then actual-1 rests", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const ev = note("C4", 4);
    const noteId = ev.notes[0]!.id;
    voice.items = [ev, rest(4), rest(2)];

    const next = produce(score, (d) => makeTuplet(ev.id, 3, 2).apply(d));

    const items = voiceOf(next, 0).items;
    expect(items).toHaveLength(3); // tuplet + the two untouched rests
    const group = items[0]!;
    if (group.kind !== "tuplet") throw new Error("expected a tuplet");
    expect(group.ratio).toEqual({ actual: 3, normal: 2, unit: 8 });
    expect(group.items).toHaveLength(3);
    const [first, second, third] = group.items;
    expect(first!.kind).toBe("note");
    expect(asEvent(first!).duration).toEqual({ base: 8, dots: 0 });
    if (first!.kind !== "note") throw new Error("expected a note");
    expect(first!.id).toBe(ev.id); // same identity
    expect(first!.notes[0]!.id).toBe(noteId);
    expect(second!.kind).toBe("rest");
    expect(asEvent(second!).duration).toEqual({ base: 8, dots: 0 });
    expect(third!.kind).toBe("rest");
    expect(asEvent(third!).duration).toEqual({ base: 8, dots: 0 });
  });

  it("occupies exactly the same sounding span as the original event, leaving surrounding events untouched", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const before = note("B3", 4);
    const ev = note("C4", 4);
    const after = note("D4", 2);
    voice.items = [before, ev, after]; // 1/4 + 1/4 + 1/2 = 1

    const next = produce(score, (d) => makeTuplet(ev.id, 3, 2).apply(d));

    const items = voiceOf(next, 0).items;
    expect(items).toHaveLength(3);
    expect(items[0]!.id).toBe(before.id);
    expect(items[2]!.id).toBe(after.id);
  });

  it("refuses a dotted duration", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const ev = note("C4", 4, 1); // dotted quarter
    voice.items = [ev, rest(8)];

    expect(() => produce(score, (d) => makeTuplet(ev.id, 3, 2).apply(d))).toThrow(WriteRefused);
  });

  it("refuses a ratio that doesn't divide the duration into a plain note value", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const ev = note("C4", 4); // quarter / 3 = twelfth, not a supported note value
    voice.items = [ev, rest(4), rest(2)];

    expect(() => produce(score, (d) => makeTuplet(ev.id, 5, 3).apply(d))).toThrow(WriteRefused);
  });
});

describe("removeTuplet", () => {
  it("replaces the group by its first note stretched to the group's total notated length", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const n1 = note("C4", 8);
    const n2 = note("D4", 8);
    const n3 = note("E4", 8);
    voice.items = [
      { kind: "tuplet", id: "tup", ratio: { actual: 3, normal: 2, unit: 8 }, items: [n1, n2, n3] }, // sounds 1/4
      rest(2),
      rest(4),
    ];

    const next = produce(score, (d) => removeTuplet("tup").apply(d));

    const items = voiceOf(next, 0).items;
    expect(items).toHaveLength(3); // stretched note + the two untouched rests
    expect(items[0]!.kind).toBe("note");
    expect(asEvent(items[0]!).duration).toEqual({ base: 4, dots: 0 }); // 1/4, single plain value
    if (items[0]!.kind !== "note") throw new Error("expected a note");
    expect(items[0]!.notes[0]!.pitch.step).toBe("C");
    expect(items[0]!.id).toBe(n1.id);
  });

  it("falls back to rests when the group's total length isn't a single notated value", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    // Nesting a tuplet as the group's first item means there's no single leaf event
    // to stretch, so removeTuplet must fall back to rests regardless of whether the
    // total length happens to be representable as one notated value.
    const inner: VoiceItem = {
      kind: "tuplet",
      id: "inner",
      ratio: { actual: 3, normal: 2, unit: 16 },
      items: [note("C4", 16), note("D4", 16), note("E4", 16)],
    };
    // A real note elsewhere in the voice keeps the voice from collapsing to a bare
    // measureRest, so the rest fallback for the tuplet's own slot is directly visible.
    const anchor = note("B3", 2);
    voice.items = [
      { kind: "tuplet", id: "outer", ratio: { actual: 3, normal: 2, unit: 8 }, items: [inner, note("F4", 8), note("G4", 8)] },
      anchor,
      rest(4),
    ];

    const next = produce(score, (d) => removeTuplet("outer").apply(d));

    const items = voiceOf(next, 0).items;
    // first item can't be stretched (it's a tuplet, not a plain event) -> rests
    expect(items[0]!.kind).toBe("rest");
    expect(asEvent(items[0]!).duration).toEqual({ base: 4, dots: 0 }); // outer sounds 1/4, representable as a single rest anyway
    expect(items[1]!.id).toBe(anchor.id); // untouched
  });

  it("collapses the voice to a canonical measureRest when the stretched replacement is an all-rest voice", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    // actual=3, normal=1, unit=1 (whole note): sounds normal*unit = 1 * 1 = the whole measure.
    voice.items = [{ kind: "tuplet", id: "solo", ratio: { actual: 3, normal: 1, unit: 1 }, items: [rest(1), rest(1), rest(1)] }];

    const next = produce(score, (d) => removeTuplet("solo").apply(d));

    const items = voiceOf(next, 0).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("rest");
    if (items[0]!.kind !== "rest") throw new Error("expected a rest");
    expect(items[0]!.measureRest).toBe(true); // normalizeVoice replaced the stretched rest with the canonical shape
  });
});

describe("writeEvent into a tuplet (canWrite/writeSpan tuplet-grid extension)", () => {
  it("a cursor inside a tuplet writes into its own items instead of refusing, and reports a tuplet-specific refusal past its end", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const n1 = note("C4", 8);
    const n2 = note("D4", 8);
    const n3 = note("E4", 8);
    voice.items = [
      { kind: "tuplet", id: "tup", ratio: { actual: 3, normal: 2, unit: 8 }, items: [n1, n2, n3] },
      rest(2),
      rest(4),
    ];

    // second slot of the triplet: sounding offset 1/12
    const cursor = cursorAt(0, frac(1, 12));
    const next = produce(score, (d) => writeEvent(cursor, note("F4", 8)).apply(d));
    const group = voiceOf(next, 0).items[0]!;
    if (group.kind !== "tuplet") throw new Error("expected a tuplet");
    const second = group.items[1]!;
    if (second.kind !== "note") throw new Error("expected a note");
    expect(second.notes[0]!.pitch.step).toBe("F");

    // writing a duration too big for what's left in the tuplet (from its last slot) refuses with a tuplet-specific message
    const lastSlotCursor = cursorAt(0, frac(1, 6)); // third slot's sounding offset (2 * 1/12)
    expect(() => produce(score, (d) => writeEvent(lastSlotCursor, note("F4", 4)).apply(d))).toThrow(WriteRefused);
    expect(() => produce(score, (d) => writeEvent(lastSlotCursor, note("F4", 4)).apply(d))).toThrowError(/tuplet/i);
  });
});
