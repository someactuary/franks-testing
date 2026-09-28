/**
 * Import a MusicXML (.musicxml/.xml/.mxl) file with our importer, engrave it, and write one
 * HTML page per engraved page (Bravura embedded) plus a validation summary, for visual
 * comparison against the source (e.g. an OMR result against the original PDF).
 * Usage: npx tsx scripts/render-musicxml.ts <file> <outDir>
 */
import { JSDOM } from "jsdom";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const dom = new JSDOM("");
Object.assign(globalThis, { DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer });

const { importMusicXml } = await import("../src/io/musicxml");
const { validateScore } = await import("../src/io/validate");
const { engrave } = await import("../src/engraving");
const { renderPages } = await import("../src/render/svg");
const { BRAVURA } = await import("../src/render/smufl");
const { allEvents } = await import("../src/model/traverse");

const [file, out = "out-render"] = process.argv.slice(2);
if (!file) throw new Error("usage: render-musicxml.ts <file> <outDir>");
mkdirSync(out, { recursive: true });
const bytes = readFileSync(file);
const input = /\.mxl$/i.test(file) ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes.toString("utf8");
const score = importMusicXml(input);
const issues = validateScore(score);
const part = score.parts[0]!;
console.log(`${basename(file)}: parts=${score.parts.length} staves=${part.staves.length} measures=${score.measures.length} issues=${issues.length}`);
for (const i of issues.slice(0, 10)) console.log(`  issue ${i.path}: ${i.message}`);
const keys = score.measures.map((m, i) => (m.keySig ? `m${i + 1}:${m.keySig.fifths}` : "")).filter(Boolean);
const times = score.measures.map((m, i) => (m.timeSig ? `m${i + 1}:${m.timeSig.numerator}/${m.timeSig.denominator}` : "")).filter(Boolean);
const pickup = score.measures[0]?.actualLength;
console.log(`  keys ${keys.join(" ")} | times ${times.join(" ")} | clefs ${part.staves.map((s) => s.initialClef).join(",")} | pickup ${pickup ? `${pickup.num}/${pickup.den}` : "none"}`);
const per = new Map<number, { events: number; heads: number; chords: number; rests: number; voices: Set<number> }>();
for (const e of allEvents(score)) {
  const r = per.get(e.staffIndex) ?? { events: 0, heads: 0, chords: 0, rests: 0, voices: new Set<number>() };
  per.set(e.staffIndex, r);
  r.events++;
  r.voices.add(e.voice.index);
  const ev = e.positioned.event;
  if (ev.kind === "note") {
    r.heads += ev.notes.length;
    if (ev.notes.length > 1) r.chords++;
  } else if (!ev.invisible) r.rests++;
}
for (const [staff, r] of [...per.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  staff ${staff + 1}: ${r.events} events, ${r.heads} noteheads, ${r.chords} chords, ${r.rests} rests, voices ${[...r.voices].join(",")}`);
}
const kinds = new Map<string, number>();
for (const x of [...score.attachments, ...score.spanners]) kinds.set(x.kind, (kinds.get(x.kind) ?? 0) + 1);
console.log(`  markings: ${[...kinds.entries()].map(([k, n]) => `${k}=${n}`).join(" ") || "none"}`);
const layout = engrave(score, { font: BRAVURA });
const svgs = renderPages(layout, { font: BRAVURA, staffSpaceMm: layout.staffSpaceMm, unit: "px" });
const fontUrl = "file://" + resolve("public/fonts/Bravura.otf");
svgs.forEach((svg, i) => {
  writeFileSync(
    `${out}/page-${i + 1}.html`,
    `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:"Bravura";src:url("${fontUrl}") format("opentype")}body{margin:0;background:#fff}</style></head><body>${svg}</body></html>`,
  );
});
console.log(`wrote ${svgs.length} page(s) to ${out}`);
