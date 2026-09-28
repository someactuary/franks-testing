/**
 * Engrave a sample score and print a summary for eyeballing.
 *
 *   npx tsx scripts/dump-layout.ts            # default sample
 *   npx tsx scripts/dump-layout.ts --long     # enough measures to break pages
 *   npx tsx scripts/dump-layout.ts --verbose  # list primitives per system
 */
import { engrave } from "../src/engraving/engrave";
import type { LayoutResult, Primitive } from "../src/engraving/layout-types";
import { notated } from "../src/model/duration";
import { chord, newPianoScore, note, rest } from "../src/model/factory";
import { newId } from "../src/model/ids";
import type { NoteEvent, Score, VoiceItem } from "../src/model/score";
import { BRAVURA } from "../src/render/smufl/generated/bravura";

function voice(items: VoiceItem[]) {
  return { id: newId(), index: 0, items };
}

function dotted(ev: NoteEvent, dots: 1 | 2): NoteEvent {
  return { ...ev, duration: notated(ev.duration.base, dots) };
}

function sample(measureCount: number): Score {
  const score = newPianoScore({
    measureCount,
    timeSig: { numerator: 4, denominator: 4 },
    keySig: { fifths: 3, mode: "major" },
    title: "Layout Probe",
    composer: "Engraving Tier 1",
  });

  const rhs: VoiceItem[][] = [
    [note("C4", 4), note("E4", 4), note("G4", 4), note("C5", 4)],
    [note("D5", 8), note("E5", 8), note("F5", 8), note("G5", 8), note("A5", 4), rest(4)],
    [chord(["C4", "E4", "G4"], 2), chord(["D4", "E4", "A4"], 2)],
    [dotted(note("B4", 8), 1), note("C5", 16), note("A4", 4), note("F5", 2)],
  ];
  const lhs: VoiceItem[][] = [
    [note("C3", 2), note("G2", 2)],
    [note("F2", 4), note("A2", 4), note("C3", 2)],
    [note("C2", 1)],
    [rest(4), note("G2", 4), note("C3", 2)],
  ];

  for (let m = 0; m < measureCount; m++) {
    const pm = score.parts[0]!.measures[m]!;
    pm.staves[0]!.voices = [voice(rhs[m % rhs.length]!.map(cloneItem))];
    pm.staves[1]!.voices = [voice(lhs[m % lhs.length]!.map(cloneItem))];
  }
  return score;
}

function cloneItem(item: VoiceItem): VoiceItem {
  const copy = structuredClone(item);
  copy.id = newId();
  if (copy.kind === "note") for (const n of copy.notes) n.id = newId();
  return copy;
}

function countPrimitives(prims: Primitive[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of prims) {
    const key = p.type === "glyph" ? `glyph:${p.glyph}` : p.type;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function summarize(result: LayoutResult, verbose: boolean): void {
  console.log(`staffSpaceMm=${result.staffSpaceMm}  pages=${result.pages.length}`);
  for (const page of result.pages) {
    console.log(
      `\nPAGE ${page.index}  ${page.widthSp.toFixed(1)} x ${page.heightSp.toFixed(1)} sp  ` +
        `systems=${page.systems.length}  pagePrims=${page.primitives.length}`,
    );
    for (const t of page.primitives) if (t.type === "text") console.log(`   text[${t.style}] "${t.text}"`);
    for (const sys of page.systems) {
      console.log(
        `  SYSTEM ${sys.index}  x=${sys.x.toFixed(2)} y=${sys.y.toFixed(2)} ` +
          `w=${sys.width.toFixed(2)} h=${sys.height.toFixed(2)}  ` +
          `staves=${sys.staves.map((s) => s.y.toFixed(1)).join(",")}  prims=${sys.primitives.length}`,
      );
      const sum = sys.measures.reduce((a, m) => a + m.width, 0);
      console.log(`    measures sum=${sum.toFixed(3)} (system width ${sys.width.toFixed(3)})`);
      for (const m of sys.measures) {
        console.log(`      m${m.measureIndex}: x=${m.x.toFixed(2)} w=${m.width.toFixed(2)}`);
      }
      const counts = countPrimitives(sys.primitives);
      const line = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      console.log(`    ${line}`);
      if (verbose) {
        for (const p of sys.primitives) console.log(`      ${JSON.stringify(p)}`);
      }
    }
  }
}

const args = process.argv.slice(2);
const measureCount = args.includes("--long") ? 40 : 8;
const score = sample(measureCount);
summarize(engrave(score, { font: BRAVURA }), args.includes("--verbose"));
