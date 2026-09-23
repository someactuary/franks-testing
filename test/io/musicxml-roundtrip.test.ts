// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { FIXTURES } from "../fixtures";
import { frac, newId, newPianoScore, note, rest, type RestEvent } from "@/model";
import { exportMusicXml, importMusicXml, MusicXmlError } from "@/io/musicxml";
import { validateScore } from "@/io/validate";
import { structuralDigest } from "./digest";

describe("MusicXML round trip: import(export(fixture))", () => {
  it("runs under jsdom (DOMParser available)", () => {
    expect(typeof DOMParser).toBe("function");
  });

  for (const [name, make] of Object.entries(FIXTURES)) {
    it(`${name} survives structurally`, () => {
      const score = make();
      const xml = exportMusicXml(score);
      const back = importMusicXml(xml);
      expect(validateScore(back)).toEqual([]);
      expect(structuralDigest(back)).toEqual(structuralDigest(score));
    });

    it(`${name} is stable on a second trip`, () => {
      const once = exportMusicXml(importMusicXml(exportMusicXml(make())));
      const twice = exportMusicXml(importMusicXml(once));
      expect(twice).toBe(once);
    });
  }
});

describe("MusicXML round trip: mappings the fixtures do not exercise", () => {
  it("keeps grace notes, courtesy accidentals, ornaments, noteheads, stems, clef changes and repeats", () => {
    const score = newPianoScore({ measureCount: 1 });
    const part = score.parts[0]!;
    const withGrace = note("C5", 4);
    withGrace.grace = { id: newId(), events: [note("D5", 8)], slash: true };
    withGrace.lyrics = [{ verse: 0, text: "la", syllabic: "single", extend: true }];
    const fancy = note("F#5", 4);
    fancy.notes[0]!.accidental = "courtesy";
    fancy.notes[0]!.notehead = "x";
    fancy.ornaments = ["trill", "invertedMordent"];
    fancy.stem = "down";
    fancy.arpeggio = "up";
    const hidden: RestEvent = { ...rest(4), invisible: true };
    const last = note("Bb4", 4);
    last.notes[0]!.accidental = "cautionary-parens";
    last.articulations = ["staccato", "marcato", "portato"];
    part.measures[0]!.staves[0]!.voices[0]!.items = [withGrace, fancy, hidden, last];
    part.measures[0]!.staves[1]!.voices[0]!.items = [note("C3", 2), note("G4", 2)];
    part.measures[0]!.staves[1]!.clefChanges = [{ at: frac(1, 2), clef: "treble" }];
    score.measures[0]!.startBarline = "repeat-start";
    score.measures[0]!.barline = "repeat-end";

    const back = importMusicXml(exportMusicXml(score));
    expect(validateScore(back)).toEqual([]);
    expect(structuralDigest(back)).toEqual(structuralDigest(score));
  });
});

describe("MusicXML export shape", () => {
  it("writes a piano score as one part with two staves", () => {
    const xml = exportMusicXml(FIXTURES.scale!());
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.documentElement.tagName).toBe("score-partwise");
    expect(doc.documentElement.getAttribute("version")).toBe("4.0");
    expect(doc.getElementsByTagName("score-part")).toHaveLength(1);
    expect(doc.getElementsByTagName("staves")[0]?.textContent).toBe("2");
  });

  it("writes one score-part per staff inside a bracket group for SATB", () => {
    const xml = exportMusicXml(FIXTURES.satb!());
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const names = Array.from(doc.getElementsByTagName("part-name")).map((e) => e.textContent);
    expect(names).toEqual(["Soprano", "Alto", "Tenor", "Bass"]);
    expect(doc.getElementsByTagName("group-symbol")[0]?.textContent).toBe("bracket");
  });

  it("picks divisions that make nested tuplets exact", () => {
    const xml = exportMusicXml(FIXTURES.tuplets!());
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const divisions = Number(doc.getElementsByTagName("divisions")[0]?.textContent);
    // a 16th inside two nested triplets lasts 1/36 of a whole note
    expect((divisions * 4) % 36).toBe(0);
    for (const d of Array.from(doc.getElementsByTagName("duration"))) {
      expect(Number.isInteger(Number(d.textContent))).toBe(true);
    }
  });

  it("writes an accidental where the pitch departs from the key, and ties with tie + tied", () => {
    const keysXml = exportMusicXml(FIXTURES.keys!());
    const doc = new DOMParser().parseFromString(keysXml, "application/xml");
    const accs = Array.from(doc.getElementsByTagName("accidental")).map((a) => a.textContent);
    // D major: F natural once, G# three times; F#/C# come from the key.
    expect(accs.sort()).toEqual(["natural", "sharp", "sharp", "sharp"]);

    const tiesXml = exportMusicXml(FIXTURES.ties!());
    const tdoc = new DOMParser().parseFromString(tiesXml, "application/xml");
    expect(tdoc.getElementsByTagName("tie").length).toBe(tdoc.getElementsByTagName("tied").length);
    expect(tdoc.getElementsByTagName("tie").length).toBeGreaterThan(0);
  });

  it("transposes ottava notes to sounding pitch and back", () => {
    const xml = exportMusicXml(FIXTURES.expressive!());
    expect(xml).toContain('<octave-shift type="down" size="8"');
    // C6 is written under the 8va; MusicXML carries the sounding C7.
    expect(xml).toMatch(/<step>C<\/step>\s*<octave>7<\/octave>/);
  });
});

describe("MusicXML import input handling", () => {
  it("reads a compressed .mxl via META-INF/container.xml", () => {
    const xml = exportMusicXml(FIXTURES.minuet!());
    const container = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="score/minuet.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
    const zipped = zipSync({
      mimetype: strToU8("application/vnd.recordare.musicxml"),
      "META-INF/container.xml": strToU8(container),
      "score/minuet.musicxml": strToU8(xml),
    });
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
    const score = importMusicXml(buffer);
    expect(structuralDigest(score)).toEqual(structuralDigest(FIXTURES.minuet!()));
  });

  it("decodes an uncompressed ArrayBuffer as UTF-8", () => {
    const xml = exportMusicXml(FIXTURES.scale!());
    const bytes = strToU8(xml);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(structuralDigest(importMusicXml(buffer))).toEqual(structuralDigest(FIXTURES.scale!()));
  });

  it("keeps the part's MIDI program (1-based in MusicXML, 0-based in the model)", () => {
    const score = FIXTURES.scale!();
    score.parts[0]!.midiProgram = 40; // violin
    const xml = exportMusicXml(score);
    expect(xml).toContain("<midi-program>41</midi-program>");
    expect(importMusicXml(xml).parts[0]!.midiProgram).toBe(40);
  });

  it("defaults to program 0 when the part names none", () => {
    const xml = exportMusicXml(FIXTURES.scale!()).replace(/<midi-instrument[\s\S]*?<\/midi-instrument>/g, "");
    expect(importMusicXml(xml).parts[0]!.midiProgram).toBe(0);
  });

  it("throws MusicXmlError on malformed XML", () => {
    expect(() => importMusicXml("<score-partwise><part-list>")).toThrow(MusicXmlError);
  });

  it("throws MusicXmlError on a non-MusicXML root", () => {
    expect(() => importMusicXml("<html><body/></html>")).toThrow(MusicXmlError);
  });
});
