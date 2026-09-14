import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { eq, newPianoScore, notated, note, rest, voiceLength, type Pitch } from "@/model";
import {
  addMeasures,
  deleteEvent,
  insertEventAfter,
  removeMeasure,
  replaceEvent,
  setEventDuration,
  setMeta,
  setNotePitch,
  setTitle,
  toggleTie,
} from "@/commands/basic";

describe("basic commands", () => {
  it("setMeta merges fields into score.meta without clobbering the rest", () => {
    const score = newPianoScore({ title: "A" });
    const next = produce(score, (d) => setMeta({ composer: "Bach" }).apply(d));
    expect(next.meta.title).toBe("A");
    expect(next.meta.composer).toBe("Bach");
  });

  it("setTitle sets meta.title", () => {
    const score = newPianoScore();
    const next = produce(score, (d) => setTitle("New Title").apply(d));
    expect(next.meta.title).toBe("New Title");
  });

  it("insertEventAfter(afterEventId: null) inserts at the start of the voice", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const originalFirstId = voice.items[0]!.id;
    const newEvent = rest(4);

    const next = produce(score, (d) => {
      insertEventAfter({
        partIndex: 0,
        measureIndex: 0,
        staffIndex: 0,
        voiceIndex: 0,
        afterEventId: null,
        event: newEvent,
      }).apply(d);
    });

    const items = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items;
    expect(items[0]!.id).toBe(newEvent.id);
    expect(items[1]!.id).toBe(originalFirstId);
  });

  it("insertEventAfter inserts right after the named event, including inside a tuplet", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const n1 = note("C4", 8);
    const n2 = note("D4", 8);
    voice.items = [{ kind: "tuplet", id: "tup", ratio: { actual: 3, normal: 2, unit: 8 }, items: [n1, n2] }];
    const inserted = note("E4", 8);

    const next = produce(score, (d) => {
      insertEventAfter({
        partIndex: 0,
        measureIndex: 0,
        staffIndex: 0,
        voiceIndex: 0,
        afterEventId: n1.id,
        event: inserted,
      }).apply(d);
    });

    const tuplet = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (tuplet.kind !== "tuplet") throw new Error("expected a tuplet");
    expect(tuplet.items.map((i) => i.id)).toEqual([n1.id, inserted.id, n2.id]);
  });

  it("replaceEvent replaces the content but keeps the original id", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const original = voice.items[0]!; // the initial measureRest
    const replacement = note("G4", 4);

    const next = produce(score, (d) => replaceEvent(original.id, replacement).apply(d));

    const updated = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    expect(updated.id).toBe(original.id);
    expect(updated.kind).toBe("note");
  });

  it("deleteEvent replaces the event with a rest of the same duration, preserving voice length", () => {
    const score = newPianoScore({ measureCount: 1 }); // 4/4
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    voice.items = [note("C4", 4), note("D4", 4), rest(2)]; // 1/4 + 1/4 + 1/2 = 1
    const targetId = voice.items[1]!.id;
    const before = voiceLength(voice);

    const next = produce(score, (d) => deleteEvent(targetId).apply(d));

    const nextVoice = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    expect(eq(voiceLength(nextVoice), before)).toBe(true);
    const replaced = nextVoice.items[1]!;
    if (replaced.kind !== "rest") throw new Error("expected a rest event");
    expect(replaced.id).not.toBe(targetId);
    expect(replaced.duration).toEqual({ base: 4, dots: 0 });
  });

  it("setNotePitch changes a note's pitch", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const noteId = ev.notes[0]!.id;
    const newPitch: Pitch = { step: "G", alter: 1, octave: 5 };

    const next = produce(score, (d) => setNotePitch(noteId, newPitch).apply(d));

    const updatedEvent = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (updatedEvent.kind !== "note") throw new Error("expected a note event");
    expect(updatedEvent.notes[0]!.pitch).toEqual(newPitch);
  });

  it("setEventDuration changes the notated duration without touching other events", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];

    const next = produce(score, (d) => setEventDuration(ev.id, notated(2, 1)).apply(d));

    const nextVoice = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const updated = nextVoice.items[0]!;
    if (updated.kind === "tuplet") throw new Error("expected an event, not a tuplet");
    expect(updated.duration).toEqual({ base: 2, dots: 1 });
    expect(nextVoice.items).toHaveLength(3);
  });

  it("toggleTie flips tieStart on and off", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const noteId = ev.notes[0]!.id;

    const once = produce(score, (d) => toggleTie(noteId).apply(d));
    const twice = produce(once, (d) => toggleTie(noteId).apply(d));

    const getTieStart = (s: typeof score) => {
      const e = s.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
      if (e.kind !== "note") throw new Error("expected a note event");
      return e.notes[0]!.tieStart;
    };
    expect(getTieStart(once)).toBe(true);
    expect(getTieStart(twice)).toBe(false);
  });

  it("addMeasures appends empty measures with a measureRest in every staff", () => {
    const score = newPianoScore({ measureCount: 2 });
    const next = produce(score, (d) => addMeasures(2).apply(d));

    expect(next.measures).toHaveLength(4);
    expect(next.parts[0]!.measures).toHaveLength(4);
    for (const staff of next.parts[0]!.measures[2]!.staves) {
      expect(staff.voices).toHaveLength(1);
      expect(staff.voices[0]!.items).toHaveLength(1);
      const item = staff.voices[0]!.items[0]!;
      expect(item.kind).toBe("rest");
      if (item.kind === "rest") expect(item.measureRest).toBe(true);
    }
  });

  it("addMeasures inserts at a given index rather than appending", () => {
    const score = newPianoScore({ measureCount: 2 });
    const originalSecondId = score.measures[1]!.id;

    const next = produce(score, (d) => addMeasures(1, 1).apply(d));

    expect(next.measures).toHaveLength(3);
    expect(next.measures[2]!.id).toBe(originalSecondId);
  });

  it("removeMeasure drops the measure from the score and every part", () => {
    const score = newPianoScore({ measureCount: 3 });
    const next = produce(score, (d) => removeMeasure(1).apply(d));
    expect(next.measures).toHaveLength(2);
    expect(next.parts[0]!.measures).toHaveLength(2);
  });

  it("removeMeasure drops spanners/attachments anchored to that measure", () => {
    const score = newPianoScore({ measureCount: 3 });
    score.spanners.push({
      id: "sp1",
      kind: "pedal",
      style: "line",
      partIndex: 0,
      staffIndex: 0,
      start: { kind: "measure", measureIndex: 1, offset: { num: 0, den: 1 } },
      end: { kind: "measure", measureIndex: 1, offset: { num: 1, den: 1 } },
    });
    score.attachments.push({
      id: "att1",
      kind: "text",
      text: "rit.",
      partIndex: 0,
      staffIndex: 0,
      anchor: { kind: "measure", measureIndex: 1, offset: { num: 0, den: 1 } },
    });

    const next = produce(score, (d) => removeMeasure(1).apply(d));

    expect(next.spanners).toHaveLength(0);
    expect(next.attachments).toHaveLength(0);
  });
});

describe("removeMeasure anchor handling", () => {
  it("drops event-anchored spanners in the removed measure and shifts later measure anchors and breaks", async () => {
    const { newPianoScore, note } = await import("@/model");
    const { removeMeasure } = await import("@/commands/basic");
    const { produce } = await import("immer");
    const score = newPianoScore({ measureCount: 3 });
    const n = note("C4", 1);
    score.parts[0]!.measures[1]!.staves[0]!.voices[0]!.items = [n];
    score.spanners.push({
      kind: "slur", id: "s1", partIndex: 0, staffIndex: 0,
      start: { kind: "event", eventId: n.id }, end: { kind: "event", eventId: n.id },
    });
    score.attachments.push(
      { kind: "dynamic", id: "d1", partIndex: 0, staffIndex: 0, text: "p", anchor: { kind: "measure", measureIndex: 2, offset: { num: 0, den: 1 } } },
      { kind: "dynamic", id: "d2", partIndex: 0, staffIndex: 0, text: "f", anchor: { kind: "measure", measureIndex: 0, offset: { num: 0, den: 1 } } },
    );
    score.layout.systemBreaks = [1, 2];
    const next = produce(score, (d) => removeMeasure(1).apply(d));
    expect(next.measures).toHaveLength(2);
    expect(next.spanners).toHaveLength(0);
    expect(next.attachments.map((a) => (a.anchor.kind === "measure" ? a.anchor.measureIndex : -1))).toEqual([1, 0]);
    expect(next.layout.systemBreaks).toEqual([1]);
  });
});
