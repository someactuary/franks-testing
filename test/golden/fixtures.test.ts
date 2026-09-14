import { describe, expect, it } from "vitest";
import { engrave } from "@/engraving";
import { renderPages } from "@/render/svg";
import { BRAVURA } from "@/render/smufl";
import { FIXTURES } from "../fixtures";

/**
 * Golden renders: engrave + render every fixture and compare to test/golden/__snapshots__/.
 * When an engraving change is intentional, run `npx vitest run -u test/golden` and
 * eyeball the diff (scripts/render-fixtures.ts makes PNG-able HTML).
 */
describe("golden fixture renders", () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const layout = engrave(make(), { font: BRAVURA });
      const svgs = renderPages(layout, { font: BRAVURA, staffSpaceMm: layout.staffSpaceMm });
      for (const [i, svg] of svgs.entries()) {
        await expect(svg).toMatchFileSnapshot(`__snapshots__/${name}-${i}.svg`);
      }
    });
  }
});
