// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { frac, newPianoScore, note, ZERO } from "@/model";
import { exportMusicXml, importMusicXml } from "@/io/musicxml";

const BASS = "<clef><sign>F</sign><line>4</line></clef>";
const TREBLE = "<clef><sign>G</sign><line>2</line></clef>";

/** One treble staff, 4/4, divisions 1: `measures[i]` is the body of measure i+1 (after its attributes). */
function score(measures: string[]): string {
  const body = measures
    .map((m, i) => {
      const attrs =
        i === 0
          ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>${TREBLE}</attributes>`
          : "";
      return `<measure number="${i + 1}">${attrs}${m}</measure>`;
    })
    .join("");
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}

const q = (step: string, octave: number) =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type></note>`;
const fourQuarters = q("C", 5).repeat(4);

function clefChanges(xml: string) {
  return importMusicXml(xml).parts[0]!.measures.map((pm) => pm.staves[0]!.clefChanges);
}

describe("MusicXML import: clef changes", () => {
  it("keeps a clef change inside a measure where it is", () => {
    const xml = score([
      q("C", 5) + q("C", 5) + `<attributes>${BASS}</attributes>` + q("C", 3) + q("C", 3),
      fourQuarters,
    ]);
    expect(clefChanges(xml)).toEqual([[{ at: frac(1, 2), clef: "bass" }], undefined]);
  });

  it("moves a clef written at the very end of a measure to the start of the next", () => {
    const xml = score([fourQuarters + `<attributes>${BASS}</attributes>`, q("C", 3).repeat(4)]);
    expect(clefChanges(xml)).toEqual([undefined, [{ at: ZERO, clef: "bass" }]]);
  });

  it("moves a clef placed past the end of the measure (an OMR rhythm error) the same way", () => {
    const xml = score([
      q("C", 5).repeat(3) +
        "<forward><duration>3</duration></forward>" +
        `<attributes>${BASS}</attributes>` +
        "<backup><duration>2</duration></backup>",
      q("C", 3).repeat(4),
    ]);
    const changes = clefChanges(xml);
    expect(changes[1]).toEqual([{ at: ZERO, clef: "bass" }]);
    expect(changes[0]).toBeUndefined();
  });

  it("keeps the next measure's own opening clef over one carried from the barline", () => {
    const xml = score([
      fourQuarters + `<attributes>${BASS}</attributes>`,
      `<attributes>${TREBLE}</attributes>` + fourQuarters,
    ]);
    expect(clefChanges(xml)[1]).toEqual([{ at: ZERO, clef: "treble" }]);
  });

  it("drops a clef after the final barline", () => {
    const xml = score([fourQuarters + `<attributes>${BASS}</attributes>`]);
    expect(clefChanges(xml)).toEqual([undefined]);
  });

  it("round-trips clef changes through export: mid-measure and at a measure's start", () => {
    const original = newPianoScore({ measureCount: 2 });
    const lower = original.parts[0]!.measures;
    lower[0]!.staves[1]!.voices[0]!.items = [note("C3", 2), note("G4", 2)];
    lower[0]!.staves[1]!.clefChanges = [{ at: frac(1, 2), clef: "treble" }];
    lower[1]!.staves[1]!.clefChanges = [{ at: ZERO, clef: "bass" }];
    const back = importMusicXml(exportMusicXml(original)).parts[0]!.measures;
    expect(back[0]!.staves[1]!.clefChanges).toEqual([{ at: frac(1, 2), clef: "treble" }]);
    expect(back[1]!.staves[1]!.clefChanges).toEqual([{ at: ZERO, clef: "bass" }]);
  });
});
