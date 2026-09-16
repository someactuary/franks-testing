import { describe, expect, it } from "vitest";
import { frac, newPianoScore, note, rest, type Score } from "@/model";
import { History } from "@/commands/history";
import { writeEvent } from "@/commands/edit";
import { defaultEditorState } from "@/input/step-entry";
import { handleAction } from "@/input/actions";
import type { Cursor, EditorState, KeyResult, PaletteAction, Selection } from "@/input/types";

/** Same tiny store stand-in as test/input/step-entry.test.ts, but driving `handleAction`. */
class Harness {
  history: History;
  cursor: Cursor;
  selection: Selection;
  entry: EditorState["entry"];

  constructor(score: Score) {
    const initial = defaultEditorState(score);
    this.history = new History(score);
    this.cursor = initial.cursor;
    this.selection = initial.selection;
    this.entry = initial.entry;
  }

  private state(): EditorState {
    return { score: this.history.current, cursor: this.cursor, selection: this.selection, entry: this.entry, clipboard: null };
  }

  act(action: PaletteAction): KeyResult | null {
    const result = handleAction(this.state(), action);
    if (result === null) return null;
    for (const cmd of result.commands) this.history.execute(cmd);
    if (result.cursor) this.cursor = result.cursor;
    if (result.selection) this.selection = result.selection;
    if (result.entry) this.entry = result.entry;
    return result;
  }

  voiceItems(measureIndex = 0, staffIndex = 0) {
    return this.history.current.parts[0]!.measures[measureIndex]!.staves[staffIndex]!.voices[0]!.items;
  }
}

describe("handleAction: dynamic / fermata / tempo / text", () => {
  it("dynamic adds an attachment anchored at the first selected event, below, on its staff", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [ev.notes[0]!.id] };

    h.act({ kind: "dynamic", text: "mf" });

    const att = h.history.current.attachments[0]!;
    expect(att.kind).toBe("dynamic");
    if (att.kind !== "dynamic") throw new Error("expected a dynamic");
    expect(att.text).toBe("mf");
    expect(att.placement).toBe("below");
    expect(att.staffIndex).toBe(0);
    expect(att.anchor).toEqual({ kind: "event", eventId: ev.id });
  });

  it("fermata attaches to the first selected event", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id, d.notes[0]!.id] };

    h.act({ kind: "fermata" });

    expect(h.history.current.attachments).toHaveLength(1);
    const att = h.history.current.attachments[0]!;
    expect(att.kind).toBe("fermata");
    expect(att.anchor).toEqual({ kind: "event", eventId: c.id });
  });

  it("tempo anchors at the cursor's measure/offset when nothing is selected", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.cursor = { ...h.cursor, offset: frac(1, 4) };

    h.act({ kind: "tempo", bpm: 120 });

    const att = h.history.current.attachments[0]!;
    expect(att.kind).toBe("tempo");
    expect(att.anchor).toEqual({ kind: "measure", measureIndex: 0, offset: frac(1, 4) });
    if (att.kind === "tempo") expect(att.bpm).toBe(120);
  });

  it("text anchors at the first selected event when something is selected", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [ev.notes[0]!.id] };

    h.act({ kind: "text", text: "rit.", style: "expression", placement: "above" });

    const att = h.history.current.attachments[0]!;
    expect(att.anchor).toEqual({ kind: "event", eventId: ev.id });
    if (att.kind === "text") {
      expect(att.text).toBe("rit.");
      expect(att.placement).toBe("above");
    }
  });
});

describe("handleAction: articulation", () => {
  it("toggles on when at least one selected event lacks it, off when all have it", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id, d.notes[0]!.id] };

    h.act({ kind: "articulation", articulation: "staccato" });
    let items = h.voiceItems(0);
    expect(items[0]!.kind === "note" && items[0]!.articulations).toEqual(["staccato"]);
    expect(items[1]!.kind === "note" && items[1]!.articulations).toEqual(["staccato"]);

    h.act({ kind: "articulation", articulation: "staccato" });
    items = h.voiceItems(0);
    expect(items[0]!.kind === "note" && items[0]!.articulations).toEqual([]);
  });
});

describe("handleAction: slur / hairpin / pedal / ottava", () => {
  it("slur connects the first and last of two selected notes", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id, d.notes[0]!.id] };

    h.act({ kind: "slur" });

    expect(h.history.current.spanners).toHaveLength(1);
    const sp = h.history.current.spanners[0]!;
    expect(sp.kind).toBe("slur");
    expect(sp.start).toEqual({ kind: "event", eventId: c.id });
    expect(sp.end).toEqual({ kind: "event", eventId: d.id });
    expect(sp.staffIndex).toBe(0);
  });

  it("slur with a single selected note extends to the next event", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id] };

    h.act({ kind: "slur" });

    const sp = h.history.current.spanners[0]!;
    expect(sp.start).toEqual({ kind: "event", eventId: c.id });
    expect(sp.end).toEqual({ kind: "event", eventId: d.id });
  });

  it("slur with nothing to span to reports a message and adds nothing", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const whole = note("C4", 1);
    voice.items = [whole];
    const h = new Harness(score);
    h.selection = { ids: [whole.notes[0]!.id] };

    const result = h.act({ kind: "slur" });

    expect(result?.message).toBeTruthy();
    expect(h.history.current.spanners).toHaveLength(0);
  });

  it("hairpin adds a cresc/dim spanner between two selected notes", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id, d.notes[0]!.id] };

    h.act({ kind: "hairpin", shape: "cresc" });

    const sp = h.history.current.spanners[0]!;
    expect(sp.kind).toBe("hairpin");
    if (sp.kind === "hairpin") expect(sp.shape).toBe("cresc");
  });

  it("pedal spanner renders on the bottom staff of the part regardless of which staff is selected", () => {
    const score = newPianoScore({ measureCount: 1 }); // treble (0), bass (1)
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!; // treble
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id, d.notes[0]!.id] };

    h.act({ kind: "pedal" });

    const sp = h.history.current.spanners[0]!;
    expect(sp.kind).toBe("pedal");
    expect(sp.staffIndex).toBe(1); // bottom staff, not the selected (treble) one
    if (sp.kind === "pedal") expect(sp.style).toBe("line");
  });

  it("ottava adds a shifted spanner", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id, d.notes[0]!.id] };

    h.act({ kind: "ottava", shift: 8 });

    const sp = h.history.current.spanners[0]!;
    expect(sp.kind).toBe("ottava");
    if (sp.kind === "ottava") expect(sp.shift).toBe(8);
  });
});

describe("handleAction: fingering", () => {
  it("sets fingering on all selected notes, and clears it with empty text", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id, d.notes[0]!.id] };

    h.act({ kind: "fingering", text: "1" });
    let items = h.voiceItems(0);
    expect(items[0]!.kind === "note" && items[0]!.notes[0]!.fingering).toBe("1");
    expect(items[1]!.kind === "note" && items[1]!.notes[0]!.fingering).toBe("1");

    h.act({ kind: "fingering", text: "" });
    items = h.voiceItems(0);
    expect(items[0]!.kind === "note" && items[0]!.notes[0]!.fingering).toBeUndefined();
  });
});

describe("handleAction: tuplet / setDuration / toggleDot", () => {
  it("tuplet turns the selected event into a triplet", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [ev.notes[0]!.id] };

    h.act({ kind: "tuplet", actual: 3, normal: 2 });

    const group = h.voiceItems(0)[0]!;
    expect(group.kind).toBe("tuplet");
    if (group.kind === "tuplet") expect(group.ratio).toEqual({ actual: 3, normal: 2, unit: 8 });
  });

  it("tuplet on the event before the cursor when nothing is selected but entry is active", () => {
    const score = newPianoScore({ measureCount: 1 });
    const h = new Harness(score);
    h.entry = { ...h.entry, active: true };
    // enter a quarter note via a direct write so the cursor lands right after it
    const ev = note("C4", 4);
    h.history.execute(writeEvent(h.cursor, ev));
    h.cursor = { ...h.cursor, offset: frac(1, 4) };

    h.act({ kind: "tuplet", actual: 3, normal: 2 });

    const group = h.voiceItems(0)[0]!;
    expect(group.kind).toBe("tuplet");
  });

  it("setDuration applies to every selected event, turning refusals into a message while the rest still apply", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const a = note("C4", 8);
    const b = note("D4", 4); // b starts at offset 1/8; lengthening it to a whole would overflow
    voice.items = [a, b, rest(2), rest(8)]; // 1/8 + 1/4 + 1/2 + 1/8 = 1
    const h = new Harness(score);
    h.selection = { ids: [a.notes[0]!.id, b.notes[0]!.id] };

    const result = h.act({ kind: "setDuration", base: 1, dots: 0 });

    expect(result?.message).toBeTruthy(); // b's change was refused
    const items = h.voiceItems(0);
    if (items[0]!.kind !== "note") throw new Error("expected a note");
    expect(items[0]!.duration).toEqual({ base: 1, dots: 0 }); // a: applied (fits, overwrites the rest of the measure)
  });

  it("toggleDot cycles dots on every selected event", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const h = new Harness(score);
    h.selection = { ids: [ev.notes[0]!.id] };

    h.act({ kind: "toggleDot" });

    const items = h.voiceItems(0);
    if (items[0]!.kind !== "note") throw new Error("expected a note");
    expect(items[0]!.duration).toEqual({ base: 4, dots: 1 });
  });
});

describe("handleAction: removeAttachment / removeSpanner", () => {
  it("removes an attachment and a spanner by id", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.attachments.push({ id: "att1", kind: "fermata", partIndex: 0, staffIndex: 0, anchor: { kind: "measure", measureIndex: 0, offset: frac(0) } });
    score.spanners.push({ id: "sp1", kind: "slur", partIndex: 0, staffIndex: 0, start: { kind: "measure", measureIndex: 0, offset: frac(0) }, end: { kind: "measure", measureIndex: 0, offset: frac(1) } });
    const h = new Harness(score);

    h.act({ kind: "removeAttachment", id: "att1" });
    h.act({ kind: "removeSpanner", id: "sp1" });

    expect(h.history.current.attachments).toHaveLength(0);
    expect(h.history.current.spanners).toHaveLength(0);
  });
});

describe("handleAction: dragPitch", () => {
  it("in D major, dragging D4 by +2 diatonic steps gives F#4 (the key signature's alteration for F)", () => {
    const score = newPianoScore({ measureCount: 1, keySig: { fifths: 2, mode: "major" } }); // D major: F#, C#
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("D4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const h = new Harness(score);

    h.act({ kind: "dragPitch", noteId: ev.notes[0]!.id, diatonicDelta: 2 });

    const items = h.voiceItems(0);
    if (items[0]!.kind !== "note") throw new Error("expected a note");
    expect(items[0]!.notes[0]!.pitch).toEqual({ step: "F", alter: 1, octave: 4 });
  });
});

describe("handleAction: staves", () => {
  it("addStaff inserts a staff and shifts the cursor's staffIndex when it's at or after the insertion point", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 })); // treble (0), bass (1)
    h.cursor = { ...h.cursor, staffIndex: 1 };

    h.act({ kind: "addStaff", atIndex: 1, clef: "alto", name: "Viola" });

    expect(h.history.current.parts[0]!.staves).toHaveLength(3);
    expect(h.cursor.staffIndex).toBe(2); // followed the bass staff, now shifted past the insertion
  });

  it("removeStaff refuses on the last staff and otherwise clamps the cursor", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.cursor = { ...h.cursor, staffIndex: 1 };

    h.act({ kind: "removeStaff", staffIndex: 1 });
    expect(h.history.current.parts[0]!.staves).toHaveLength(1);
    expect(h.cursor.staffIndex).toBe(0);

    const result = h.act({ kind: "removeStaff", staffIndex: 0 });
    expect(result?.message).toMatch(/last staff/i);
    expect(h.history.current.parts[0]!.staves).toHaveLength(1);
  });

  it("setClef / setStaffName / setBracket map straight to the Task 1 commands", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));

    h.act({ kind: "setClef", staffIndex: 1, clef: "tenor" });
    expect(h.history.current.parts[0]!.staves[1]!.initialClef).toBe("tenor");

    h.act({ kind: "setStaffName", staffIndex: 0, name: "Right Hand", abbreviation: "R.H." });
    expect(h.history.current.parts[0]!.staves[0]!.name).toBe("Right Hand");
    expect(h.history.current.parts[0]!.staves[0]!.abbreviation).toBe("R.H.");

    h.act({ kind: "setBracket", bracket: "bracket" });
    expect(h.history.current.parts[0]!.bracket).toBe("bracket");
  });
});

describe("handleAction: setVoice", () => {
  it("sets the cursor's voice and reports it", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    const result = h.act({ kind: "setVoice", voiceIndex: 1 });
    expect(h.cursor.voiceIndex).toBe(1);
    expect(result?.message).toBe("Voice 2");
  });
});

describe("handleAction: setKeySignature / clearKeySignature", () => {
  it("sets a key change at the cursor's measure and clearing it lets the previous key continue", () => {
    const h = new Harness(newPianoScore({ measureCount: 4, keySig: { fifths: 0, mode: "major" } }));
    h.cursor = { ...h.cursor, measureIndex: 2 };

    h.act({ kind: "setKeySignature", keySig: { fifths: 4, mode: "major" } });
    expect(h.history.current.measures[2]!.keySig).toEqual({ fifths: 4, mode: "major" });

    h.act({ kind: "clearKeySignature" });
    expect(h.history.current.measures[2]!.keySig).toBeUndefined();
  });
});

describe("handleAction: manual layout control", () => {
  it("toggleSystemBreak / togglePageBreak act on the cursor's measure and refuse nothing", () => {
    const h = new Harness(newPianoScore({ measureCount: 6 }));
    h.cursor = { ...h.cursor, measureIndex: 3 };

    h.act({ kind: "toggleSystemBreak" });
    expect(h.history.current.layout.systemBreaks).toEqual([3]);
    h.act({ kind: "toggleSystemBreak" });
    expect(h.history.current.layout.systemBreaks).toEqual([]);

    h.act({ kind: "togglePageBreak" });
    expect(h.history.current.layout.pageBreaks).toEqual([3]);
  });

  it("setMeasuresPerSystem / setSystemsPerPage set or clear the global caps", () => {
    const h = new Harness(newPianoScore({ measureCount: 4 }));

    h.act({ kind: "setMeasuresPerSystem", value: 3 });
    expect(h.history.current.layout.measuresPerSystem).toBe(3);
    h.act({ kind: "setMeasuresPerSystem", value: null });
    expect(h.history.current.layout.measuresPerSystem).toBeUndefined();

    h.act({ kind: "setSystemsPerPage", value: 2 });
    expect(h.history.current.layout.systemsPerPage).toBe(2);
  });

  it("clearForcedBreaks empties both break lists and reports it", () => {
    const h = new Harness(newPianoScore({ measureCount: 6 }));
    h.cursor = { ...h.cursor, measureIndex: 2 };
    h.act({ kind: "toggleSystemBreak" });
    h.cursor = { ...h.cursor, measureIndex: 4 };
    h.act({ kind: "togglePageBreak" });

    const result = h.act({ kind: "clearForcedBreaks" });

    expect(h.history.current.layout.systemBreaks).toEqual([]);
    expect(h.history.current.layout.pageBreaks).toEqual([]);
    expect(result?.message).toMatch(/cleared/i);
  });
});

describe("handleAction: setNudge / clearNudge", () => {
  it("setNudge writes the given absolute offset to layout.nudges by id", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.act({ kind: "setNudge", id: "slur-1", dx: 0.5, dy: -0.25 });
    expect(h.history.current.layout.nudges["slur-1"]).toEqual({ dx: 0.5, dy: -0.25 });
  });

  it("clearNudge removes it", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.act({ kind: "setNudge", id: "slur-1", dx: 0.5, dy: -0.25 });
    h.act({ kind: "clearNudge", id: "slur-1" });
    expect(h.history.current.layout.nudges["slur-1"]).toBeUndefined();
  });
});
