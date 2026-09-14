// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { frac, pitchToString, positionedEvents, type NoteEvent, type Score, type VoiceItem } from "@/model";
import { exportMusicXml, importMusicXml } from "@/io/musicxml";
import { validateScore } from "@/io/validate";
import { structuralDigest } from "./digest";

function load(name: string): Score {
  return importMusicXml(readFileSync(path.join(process.cwd(), "test/corpus", name), "utf8"));
}

function notesOf(items: VoiceItem[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const item of items) {
    if (item.kind === "tuplet") out.push(...notesOf(item.items));
    else if (item.kind === "note") out.push(item);
  }
  return out;
}

describe("corpus: piano-excerpt.musicxml", () => {
  const score = load("piano-excerpt.musicxml");
  const part = score.parts[0]!;

  it("validates cleanly", () => {
    expect(validateScore(score)).toEqual([]);
  });

  it("is one two-staff part with a brace", () => {
    expect(score.parts).toHaveLength(1);
    expect(part.name).toBe("Piano");
    expect(part.abbreviation).toBe("Pno.");
    expect(part.staves.map((s) => s.initialClef)).toEqual(["treble", "bass"]);
    expect(part.bracket).toBe("brace");
    expect(score.meta).toMatchObject({ title: "Nocturne Fragment", composer: "Anon." });
  });

  it("has two voices on the treble staff and one on the bass", () => {
    const m0 = part.measures[0]!;
    expect(m0.staves[0]!.voices.map((v) => v.index)).toEqual([0, 1]);
    expect(m0.staves[1]!.voices).toHaveLength(1);
  });

  it("reads the triplet as a 3:2 group of eighths", () => {
    const items = part.measures[0]!.staves[0]!.voices[0]!.items;
    const tuplet = items.find((i) => i.kind === "tuplet");
    expect(tuplet?.kind).toBe("tuplet");
    if (tuplet?.kind !== "tuplet") return;
    expect(tuplet.ratio).toEqual({ actual: 3, normal: 2, unit: 8 });
    expect(tuplet.bracket).toBe("hide");
    expect(notesOf(tuplet.items).map((n) => pitchToString(n.notes[0]!.pitch))).toEqual(["F5", "G5", "A5"]);
  });

  it("keeps the tie over the barline", () => {
    const last = notesOf(part.measures[0]!.staves[0]!.voices[0]!.items).at(-1)!;
    expect(pitchToString(last.notes[0]!.pitch)).toBe("B5");
    expect(last.notes[0]!.tieStart).toBe(true);
    const next = notesOf(part.measures[1]!.staves[0]!.voices[0]!.items)[0]!;
    expect(pitchToString(next.notes[0]!.pitch)).toBe("B5");
    expect(next.notes[0]!.tieStart).toBeUndefined();
  });

  it("fills the forward gap in voice 2 with an invisible rest", () => {
    const alto = part.measures[0]!.staves[0]!.voices[1]!.items;
    expect(alto).toHaveLength(2);
    expect(alto[1]).toMatchObject({ kind: "rest", invisible: true, duration: { base: 2, dots: 0 } });
  });

  it("reads stems, the dynamic and the pedal bracket", () => {
    const first = notesOf(part.measures[0]!.staves[0]!.voices[0]!.items)[0]!;
    expect(first.stem).toBe("up");
    const dyn = score.attachments.find((a) => a.kind === "dynamic");
    expect(dyn).toMatchObject({ text: "p", staffIndex: 0, anchor: { kind: "event", eventId: first.id } });

    const pedal = score.spanners.find((s) => s.kind === "pedal");
    expect(pedal).toMatchObject({ kind: "pedal", style: "line", staffIndex: 1 });
    const bassStart = part.measures[0]!.staves[1]!.voices[0]!.items[0]!;
    const bassEnd = part.measures[1]!.staves[1]!.voices[0]!.items[1]!;
    expect(pedal?.start).toEqual({ kind: "event", eventId: bassStart.id });
    expect(pedal?.end).toEqual({ kind: "event", eventId: bassEnd.id });
    expect(score.measures[1]!.barline).toBe("final");
  });
});

describe("corpus: hymn-satb.musicxml", () => {
  const score = load("hymn-satb.musicxml");
  const part = score.parts[0]!;
  const soprano = (mi: number) => notesOf(part.measures[mi]!.staves[0]!.voices[0]!.items);

  it("validates cleanly", () => {
    expect(validateScore(score)).toEqual([]);
  });

  it("merges four parts into one bracketed part with named staves", () => {
    expect(score.parts).toHaveLength(1);
    expect(part.bracket).toBe("bracket");
    expect(part.staves.map((s) => s.name)).toEqual(["Soprano", "Alto", "Tenor", "Bass"]);
    expect(part.staves.map((s) => s.abbreviation)).toEqual(["S.", "A.", "T.", "B."]);
    expect(part.staves.map((s) => s.initialClef)).toEqual(["treble", "treble", "treble8vb", "bass"]);
    expect(score.meta).toMatchObject({ title: "Evening Hymn", composer: "Trad.", lyricist: "Anon." });
  });

  it("has one voice per staff", () => {
    for (const pm of part.measures) for (const sm of pm.staves) expect(sm.voices).toHaveLength(1);
  });

  it("reads both verses with hyphenation", () => {
    const verse = (v: number) =>
      [...soprano(0), ...soprano(1)].map((n) => n.lyrics?.find((l) => l.verse === v)?.text ?? null);
    expect(verse(0)).toEqual(["Glo", "ry", "be", null, "A", "men"]);
    expect(verse(1)).toEqual(["Praise", "the", "Lord", null, "ev", "er"]);
    const first = soprano(0)[0]!.lyrics!;
    expect(first.find((l) => l.verse === 0)?.syllabic).toBe("begin");
    expect(soprano(0)[1]!.lyrics!.find((l) => l.verse === 0)?.syllabic).toBe("end");
  });

  it("marks the melisma with an extender and a slur", () => {
    const be = soprano(0)[2]!;
    expect(be.lyrics!.every((l) => l.extend === true)).toBe(true);
    const slur = score.spanners.find((s) => s.kind === "slur");
    expect(slur).toMatchObject({ staffIndex: 0, start: { kind: "event", eventId: be.id } });
    expect(slur?.end).toEqual({ kind: "event", eventId: soprano(0)[3]!.id });
  });

  it("reads the fermata as an attachment on the last soprano note", () => {
    const fermata = score.attachments.find((a) => a.kind === "fermata");
    expect(fermata?.anchor).toEqual({ kind: "event", eventId: soprano(1)[1]!.id });
  });
});

describe("corpus: form-pickup-repeats.musicxml", () => {
  const score = load("form-pickup-repeats.musicxml");
  const part = score.parts[0]!;

  it("validates cleanly", () => {
    expect(validateScore(score)).toEqual([]);
  });

  it("reads the pickup as a short measure numbered 0", () => {
    expect(score.measures[0]!.actualLength).toEqual(frac(1, 4));
    expect(score.measures[0]!.numberOverride).toBeUndefined();
    expect(score.measures[0]!.timeSig).toEqual({ numerator: 3, denominator: 4 });
    expect(score.measures[0]!.keySig).toEqual({ fifths: 1, mode: "major" });
  });

  it("reads repeats and the 1st/2nd endings", () => {
    expect(score.measures[1]!.startBarline).toBe("repeat-start");
    expect(score.measures[1]!.rehearsalMark).toBe("A");
    expect(score.measures[3]!.ending).toEqual({ numbers: [1], type: "start" });
    expect(score.measures[3]!.barline).toBe("repeat-end");
    expect(score.measures[4]!.ending).toEqual({ numbers: [2], type: "start" });
    expect(score.measures[4]!.barline).toBe("double");
    expect(score.measures[6]!.barline).toBe("final");
  });

  it("reads the key change and the mid-measure clef change", () => {
    expect(score.measures[5]!.keySig).toEqual({ fifths: -1, mode: "major" });
    expect(score.measures.filter((m) => m.keySig)).toHaveLength(2);
    expect(part.measures[5]!.staves[0]!.clefChanges).toEqual([{ at: frac(1, 4), clef: "bass" }]);
    const events = positionedEvents(part.measures[5]!.staves[0]!.voices[0]!);
    expect(events.map((e) => (e.event.kind === "note" ? pitchToString(e.event.notes[0]!.pitch) : "r"))).toEqual([
      "F4",
      "A3",
      "Bb3",
    ]);
  });

  it("reads the tempo text together with its metronome mark", () => {
    const tempo = score.attachments.find((a) => a.kind === "tempo");
    expect(tempo).toMatchObject({ text: "Moderato", bpm: 96, beatUnit: { base: 4, dots: 0 } });
  });

  it("names the single part from part-name and leaves the staff unnamed", () => {
    expect(part.name).toBe("Melody");
    expect(part.staves).toHaveLength(1);
    expect(part.staves[0]!.name).toBeUndefined();
  });
});

describe("corpus files survive export and re-import", () => {
  for (const name of ["piano-excerpt.musicxml", "hymn-satb.musicxml", "form-pickup-repeats.musicxml"]) {
    it(name, () => {
      const score = load(name);
      const back = importMusicXml(exportMusicXml(score));
      expect(validateScore(back)).toEqual([]);
      expect(structuralDigest(back)).toEqual(structuralDigest(score));
    });
  }
});
