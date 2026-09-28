/**
 * Export every fixture (and re-export every corpus file) to MusicXML for external checks,
 * e.g. schema validation with xmllint or opening in MuseScore.
 * Usage: npx tsx scripts/export-musicxml.ts <outDir>
 */
import { JSDOM } from "jsdom";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const dom = new JSDOM("");
Object.assign(globalThis, { DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer });

const { exportMusicXml, importMusicXml } = await import("../src/io/musicxml");
const { FIXTURES } = await import("../test/fixtures");

const out = process.argv[2] ?? "out-musicxml";
mkdirSync(out, { recursive: true });
for (const [name, make] of Object.entries(FIXTURES)) {
  writeFileSync(`${out}/${name}.musicxml`, exportMusicXml(make()));
}
const corpus = "test/corpus";
for (const f of readdirSync(corpus)) {
  writeFileSync(`${out}/corpus-${f}`, exportMusicXml(importMusicXml(readFileSync(`${corpus}/${f}`, "utf8"))));
}
console.log(`${readdirSync(out).length} files written to ${out}`);
