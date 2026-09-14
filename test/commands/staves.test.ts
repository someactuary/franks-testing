import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { newPianoScore, note, type Anchor, type Attachment, type Spanner } from "@/model";
import { addStaff, removeStaff, setBracket, setClef, setStaffName } from "@/commands/staves";

function measureAnchor(measureIndex: number): Anchor {
  return { kind: "measure", measureIndex, offset: { num: 0, den: 1 } };
}

function pedalAt(id: string, staffIndex: number): Spanner {
  return {
    id,
    kind: "pedal",
    style: "line",
    partIndex: 0,
    staffIndex,
    start: measureAnchor(0),
    end: measureAnchor(0),
  };
}

function dynamicAt(id: string, staffIndex: number): Attachment {
  return { id, kind: "dynamic", text: "p", partIndex: 0, staffIndex, anchor: measureAnchor(0) };
}

describe("addStaff", () => {
  it("inserts a StaffDef and a matching measure-rest StaffMeasure in every PartMeasure", () => {
    const score = newPianoScore({ measureCount: 2 }); // treble, bass

    const next = produce(score, (d) => addStaff(1, "alto", "Viola").apply(d));

    const part = next.parts[0]!;
    expect(part.staves).toHaveLength(3);
    expect(part.staves.map((s) => s.initialClef)).toEqual(["treble", "alto", "bass"]);
    expect(part.staves[1]!.name).toBe("Viola");

    for (const pm of part.measures) {
      expect(pm.staves).toHaveLength(3);
      const inserted = pm.staves[1]!;
      expect(inserted.voices).toHaveLength(1);
      expect(inserted.voices[0]!.items).toHaveLength(1);
      const item = inserted.voices[0]!.items[0]!;
      expect(item.kind).toBe("rest");
      if (item.kind === "rest") expect(item.measureRest).toBe(true);
    }
  });

  it("shifts staffIndex on spanners/attachments at or after atIndex", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.spanners.push(pedalAt("below-insert", 1), pedalAt("above-insert", 0));
    score.attachments.push(dynamicAt("d-below", 1), dynamicAt("d-above", 0));

    // Insert a new staff at index 1 (between treble and bass).
    const next = produce(score, (d) => addStaff(1, "bass").apply(d));

    const byId = (id: string) => next.spanners.find((s) => s.id === id) ?? next.attachments.find((a) => a.id === id);
    expect(byId("above-insert")!.staffIndex).toBe(0); // before the insertion point: untouched
    expect(byId("below-insert")!.staffIndex).toBe(2); // at/after: shifted up
    expect(byId("d-above")!.staffIndex).toBe(0);
    expect(byId("d-below")!.staffIndex).toBe(2);
  });

  it("shifts `staff` cross-staff overrides on events and notes at or after atIndex", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    ev.staff = 1; // was displayed on the bass staff
    ev.notes[0]!.staff = 1;
    voice.items = [ev];

    const next = produce(score, (d) => addStaff(1, "alto").apply(d));

    const updated = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (updated.kind !== "note") throw new Error("expected a note event");
    expect(updated.staff).toBe(2); // shifted past the newly inserted staff
    expect(updated.notes[0]!.staff).toBe(2);
  });

  it("clamps atIndex into range", () => {
    const score = newPianoScore({ measureCount: 1 });
    const next = produce(score, (d) => addStaff(99, "alto").apply(d));
    expect(next.parts[0]!.staves).toHaveLength(3);
    expect(next.parts[0]!.staves[2]!.initialClef).toBe("alto");
  });
});

describe("removeStaff", () => {
  it("removes the StaffDef and its StaffMeasure from every PartMeasure, shifting later indices", () => {
    const score = newPianoScore({ measureCount: 2 });
    const next = produce(score, (d) => addStaff(1, "alto").apply(d)); // treble, alto, bass
    const afterRemove = produce(next, (d) => removeStaff(0).apply(d)); // drop treble

    const part = afterRemove.parts[0]!;
    expect(part.staves).toHaveLength(2);
    expect(part.staves.map((s) => s.initialClef)).toEqual(["alto", "bass"]);
    for (const pm of part.measures) expect(pm.staves).toHaveLength(2);
  });

  it("refuses to remove the last staff", () => {
    const score = newPianoScore({ measureCount: 1 });
    const oneStaff = produce(score, (d) => removeStaff(1).apply(d)); // down to just treble
    expect(() => produce(oneStaff, (d) => removeStaff(0).apply(d))).toThrow(/last staff/i);
  });

  it("drops spanners/attachments on the removed staff and shifts later ones down", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.spanners.push(pedalAt("on-treble", 0), pedalAt("on-bass", 1));
    score.attachments.push(dynamicAt("d-treble", 0), dynamicAt("d-bass", 1));

    const next = produce(score, (d) => removeStaff(0).apply(d)); // drop treble (index 0)

    expect(next.spanners.find((s) => s.id === "on-treble")).toBeUndefined();
    expect(next.attachments.find((a) => a.id === "d-treble")).toBeUndefined();
    expect(next.spanners.find((s) => s.id === "on-bass")!.staffIndex).toBe(0);
    expect(next.attachments.find((a) => a.id === "d-bass")!.staffIndex).toBe(0);
  });

  it("clears `staff` overrides pointing at the removed staff and shifts later ones down", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const ev = note("C4", 4);
    ev.staff = 1; // points at the bass staff, which is about to be removed
    voice.items = [ev];

    const next = produce(score, (d) => removeStaff(1).apply(d));

    const updated = next.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    if (updated.kind !== "note") throw new Error("expected a note event");
    expect(updated.staff).toBeUndefined();
  });
});

describe("setClef / setStaffName / setBracket", () => {
  it("setClef sets the initial clef of the given staff", () => {
    const score = newPianoScore({ measureCount: 1 });
    const next = produce(score, (d) => setClef(1, "tenor").apply(d));
    expect(next.parts[0]!.staves[1]!.initialClef).toBe("tenor");
    expect(next.parts[0]!.staves[0]!.initialClef).toBe("treble"); // untouched
  });

  it("setStaffName sets the name, and the abbreviation only when given", () => {
    const score = newPianoScore({ measureCount: 1 });
    const withName = produce(score, (d) => setStaffName(0, "Right Hand").apply(d));
    expect(withName.parts[0]!.staves[0]!.name).toBe("Right Hand");

    const withAbbrev = produce(withName, (d) => setStaffName(0, "Right Hand", "R.H.").apply(d));
    expect(withAbbrev.parts[0]!.staves[0]!.abbreviation).toBe("R.H.");

    const renamedOnly = produce(withAbbrev, (d) => setStaffName(0, "Treble").apply(d));
    expect(renamedOnly.parts[0]!.staves[0]!.name).toBe("Treble");
    expect(renamedOnly.parts[0]!.staves[0]!.abbreviation).toBe("R.H."); // left untouched
  });

  it("setBracket sets the part's bracket symbol", () => {
    const score = newPianoScore({ measureCount: 1 });
    const next = produce(score, (d) => setBracket("bracket").apply(d));
    expect(next.parts[0]!.bracket).toBe("bracket");
  });
});
