import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { newPianoScore, note, rest, type Attachment, type Spanner } from "@/model";
import {
  addAttachment,
  clearEventDecorations,
  addSpanner,
  eventAnchor,
  locateEventAnchor,
  removeAttachment,
  removeSpanner,
  setFingering,
  toggleArticulation,
  toggleStemDirection,
} from "@/commands/notation";

describe("addAttachment / removeAttachment", () => {
  it("adds and then removes an attachment by id", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];

    const att: Attachment = { id: "a1", kind: "dynamic", text: "mf", partIndex: 0, staffIndex: 0, anchor: eventAnchor(ev.id) };
    const withAtt = produce(score, (d) => addAttachment(att).apply(d));
    expect(withAtt.attachments).toHaveLength(1);
    expect(withAtt.attachments[0]).toEqual(att);

    const removed = produce(withAtt, (d) => removeAttachment("a1").apply(d));
    expect(removed.attachments).toHaveLength(0);
  });

  it("removeAttachment is a no-op for an unknown id", () => {
    const score = newPianoScore({ measureCount: 1 });
    const next = produce(score, (d) => removeAttachment("nope").apply(d));
    expect(next.attachments).toEqual([]);
  });
});

describe("addSpanner / removeSpanner", () => {
  it("adds and then removes a spanner by id", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const first = note("C4", 4);
    const second = note("D4", 4);
    voice.items = [first, second, rest(2)];

    const sp: Spanner = {
      id: "s1",
      kind: "slur",
      partIndex: 0,
      staffIndex: 0,
      start: eventAnchor(first.id),
      end: eventAnchor(second.id),
    };
    const withSp = produce(score, (d) => addSpanner(sp).apply(d));
    expect(withSp.spanners).toHaveLength(1);
    expect(withSp.spanners[0]).toEqual(sp);

    const removed = produce(withSp, (d) => removeSpanner("s1").apply(d));
    expect(removed.spanners).toHaveLength(0);
  });
});

describe("toggleArticulation", () => {
  it("adds the articulation to every note event when at least one lacks it", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    d.articulations = ["staccato"];
    voice.items = [c, d, rest(2)];

    const next = produce(score, (draft) => toggleArticulation([c.id, d.id], "staccato").apply(draft));

    const items = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items;
    expect(items[0]!.kind === "note" && items[0]!.articulations).toEqual(["staccato"]);
    expect(items[1]!.kind === "note" && items[1]!.articulations).toEqual(["staccato"]);
  });

  it("removes the articulation from every note event when all of them already have it", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    c.articulations = ["staccato"];
    d.articulations = ["staccato", "accent"];
    voice.items = [c, d, rest(2)];

    const next = produce(score, (draft) => toggleArticulation([c.id, d.id], "staccato").apply(draft));

    const items = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items;
    expect(items[0]!.kind === "note" && items[0]!.articulations).toEqual([]);
    expect(items[1]!.kind === "note" && items[1]!.articulations).toEqual(["accent"]);
  });

  it("ignores ids that resolve to a rest or nothing at all", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const r = rest(4);
    voice.items = [r, rest(4), rest(2)];

    const next = produce(score, (draft) => toggleArticulation([r.id, "unknown"], "accent").apply(draft));

    expect(next).toBe(score); // no-op: nothing to toggle
  });
});

describe("toggleStemDirection", () => {
  it("flips a single note event from down to up", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const a = note("A4", 4);
    a.stem = "down";
    voice.items = [a, rest(4), rest(2)];

    const next = produce(score, (draft) => toggleStemDirection([a.id]).apply(draft));

    const items = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items;
    expect(items[0]!.kind === "note" && items[0]!.stem).toBe("up");
  });

  it("flips back to down on a second toggle", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const a = note("A4", 4);
    a.stem = "down";
    voice.items = [a, rest(4), rest(2)];

    const next = produce(score, (draft) => {
      toggleStemDirection([a.id]).apply(draft);
      toggleStemDirection([a.id]).apply(draft);
    });

    const items = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items;
    expect(items[0]!.kind === "note" && items[0]!.stem).toBe("down");
  });

  it("sets a note with no explicit stem override to up", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    voice.items = [c, rest(4), rest(2)];

    const next = produce(score, (draft) => toggleStemDirection([c.id]).apply(draft));

    const items = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items;
    expect(items[0]!.kind === "note" && items[0]!.stem).toBe("up");
  });

  it("converges a mixed selection to up unless every one is already down", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    c.stem = "down";
    d.stem = "up";
    voice.items = [c, d, rest(2)];

    const next = produce(score, (draft) => toggleStemDirection([c.id, d.id]).apply(draft));

    const items = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items;
    expect(items[0]!.kind === "note" && items[0]!.stem).toBe("up");
    expect(items[1]!.kind === "note" && items[1]!.stem).toBe("up");
  });

  it("ignores ids that resolve to a rest or nothing at all", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const r = rest(4);
    voice.items = [r, rest(4), rest(2)];

    const next = produce(score, (draft) => toggleStemDirection([r.id, "unknown"]).apply(draft));

    expect(next).toBe(score); // no-op: nothing to flip
  });
});

describe("setFingering", () => {
  it("sets and then clears a note's fingering", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const noteId = ev.notes[0]!.id;

    const withFingering = produce(score, (d) => setFingering(noteId, "3").apply(d));
    const setEvent = withFingering.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (setEvent.kind !== "note") throw new Error("expected a note");
    expect(setEvent.notes[0]!.fingering).toBe("3");

    const cleared = produce(withFingering, (d) => setFingering(noteId, null).apply(d));
    const clearedEvent = cleared.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (clearedEvent.kind !== "note") throw new Error("expected a note");
    expect(clearedEvent.notes[0]!.fingering).toBeUndefined();
  });
});

describe("locateEventAnchor", () => {
  it("returns an event anchor plus the event's part/staff index", () => {
    const score = newPianoScore({ measureCount: 1 });
    const bassVoice = score.parts[0]!.measures[0]!.staves[1]!.voices[0]!;
    const ev = note("C3", 4);
    bassVoice.items = [ev, rest(4), rest(2)];

    const loc = locateEventAnchor(score, ev.id);
    expect(loc).toEqual({ anchor: { kind: "event", eventId: ev.id }, partIndex: 0, staffIndex: 1 });
  });

  it("uses the event's cross-staff `staff` override when set", () => {
    const score = newPianoScore({ measureCount: 1 });
    const trebleVoice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C3", 4);
    ev.staff = 1; // displayed on the bass staff even though it's stored on the treble one
    trebleVoice.items = [ev, rest(4), rest(2)];

    const loc = locateEventAnchor(score, ev.id);
    expect(loc?.staffIndex).toBe(1);
  });

  it("returns undefined for an unknown event id", () => {
    const score = newPianoScore({ measureCount: 1 });
    expect(locateEventAnchor(score, "nope")).toBeUndefined();
  });
});

describe("clearEventDecorations", () => {
  it("removes articulations, ornaments, arpeggio and tremolo from a note event", () => {
    const score = newPianoScore({ measureCount: 1 });
    const ev = note("C4", 4);
    ev.articulations = ["staccato", "accent"];
    ev.ornaments = ["trill"];
    ev.arpeggio = "up";
    ev.tremolo = 2;
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [ev, rest(4), rest(2)];

    const next = produce(score, (d) => clearEventDecorations(ev.id).apply(d));

    const result = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    expect(result).toMatchObject({ kind: "note" });
    expect(result.kind === "note" && result.articulations).toBeUndefined();
    expect(result.kind === "note" && result.ornaments).toBeUndefined();
    expect(result.kind === "note" && result.arpeggio).toBeUndefined();
    expect(result.kind === "note" && result.tremolo).toBeUndefined();
    // The note itself, and its pitch, are untouched.
    expect(result.kind === "note" && result.notes[0]!.pitch).toEqual({ step: "C", alter: 0, octave: 4 });
  });

  it("is a no-op on a rest, and on a note with no decorations", () => {
    const score = newPianoScore({ measureCount: 1 });
    const ev = note("D4", 4);
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [ev, rest(4), rest(2)];

    const next = produce(score, (d) => clearEventDecorations(ev.id).apply(d));
    expect(next).toEqual(score);

    const restEvent = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[1]!;
    const next2 = produce(score, (d) => clearEventDecorations(restEvent.id).apply(d));
    expect(next2).toEqual(score);
  });

  it("throws nothing and does nothing for an id that doesn't exist", () => {
    const score = newPianoScore({ measureCount: 1 });
    expect(() => produce(score, (d) => clearEventDecorations("no-such-id").apply(d))).not.toThrow();
  });
});
