import { useMemo } from "react";
import type { LayoutResult } from "@/engraving/layout-types";
import { renderPages } from "@/render/svg";
import type { SmuflFontData } from "@/render/smufl/types";

export interface ScoreViewProps {
  layout: LayoutResult;
  font: SmuflFontData;
  /** Show data-id/data-role attributes for hit-testing. Default false. */
  idAttributes?: boolean;
}

/**
 * Renders every page of a LayoutResult as inline SVG, stacked vertically,
 * each wrapped for a page-shadow look on screen (see app.css/print.css).
 */
export function ScoreView({ layout, font, idAttributes }: ScoreViewProps) {
  const pageSvgs = useMemo(
    () =>
      renderPages(layout, {
        font,
        staffSpaceMm: layout.staffSpaceMm,
        unit: "px",
        idAttributes: idAttributes ?? false,
      }),
    [layout, font, idAttributes],
  );

  return (
    <div className="page-stack">
      {layout.pages.map((page, i) => (
        <div className="page-shadow" key={page.index}>
          {/* SVG string comes from the pure renderer (src/render/svg.ts), not user input. */}
          <div className="page" dangerouslySetInnerHTML={{ __html: pageSvgs[i]! }} />
        </div>
      ))}
    </div>
  );
}
