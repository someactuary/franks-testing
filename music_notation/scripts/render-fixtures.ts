/**
 * Engrave every fixture and write one HTML file per page (with Bravura embedded via @font-face)
 * plus the raw SVGs, for visual checks. Usage: npx tsx scripts/render-fixtures.ts <outDir>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { engrave } from "../src/engraving";
import { renderPages } from "../src/render/svg";
import { BRAVURA } from "../src/render/smufl";
import { FIXTURES } from "../test/fixtures";

const outDir = process.argv[2] ?? "out";
mkdirSync(outDir, { recursive: true });
const fontUrl = "file://" + resolve("public/fonts/Bravura.otf");

for (const [name, make] of Object.entries(FIXTURES)) {
  const layout = engrave(make(), { font: BRAVURA });
  const svgs = renderPages(layout, { font: BRAVURA, staffSpaceMm: layout.staffSpaceMm, unit: "px" });
  svgs.forEach((svg, i) => {
    writeFileSync(`${outDir}/${name}-${i}.svg`, svg);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Bravura";src:url("${fontUrl}") format("opentype")}
body{margin:0;background:#fff}</style></head><body>${svg}</body></html>`;
    writeFileSync(`${outDir}/${name}-${i}.html`, html);
  });
  console.log(`${name}: ${svgs.length} page(s)`);
}
