import { useEffect, useMemo, useState } from "react";
import { BRAVURA } from "@/render/smufl";
import { ensureFontLoaded } from "@/render/fonts";
import { ScoreView } from "./ScoreView";
// TEMPORARY: the real engraver (src/engraving) is being built in parallel.
// Until `engrave(score, opts)` lands, the app shell displays the same
// hand-written fixture LayoutResult the renderer's tests are built against.
import { FIXTURE_LAYOUT } from "../../test/render/fixture-layout";
import "./app.css";
import "./print.css";

export function App() {
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureFontLoaded()
      .then(() => {
        if (!cancelled) setFontReady(true);
      })
      .catch(() => {
        // Best effort: the glyphs will still show once the browser finishes
        // loading the font face, just not guaranteed before first paint.
        if (!cancelled) setFontReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // @page size must match the score's page size in mm; it depends on layout
  // data, so it's injected as a <style> instead of living in print.css.
  const pageSizeCss = useMemo(() => {
    const page = FIXTURE_LAYOUT.pages[0];
    if (!page) return "";
    const widthMm = page.widthSp * FIXTURE_LAYOUT.staffSpaceMm;
    const heightMm = page.heightSp * FIXTURE_LAYOUT.staffSpaceMm;
    return `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
  }, []);

  return (
    <div className="app" data-font-ready={fontReady}>
      <style>{pageSizeCss}</style>
      <header className="toolbar">
        <span className="toolbar-title">Personal Music Notation</span>
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
      </header>
      <main>
        <ScoreView layout={FIXTURE_LAYOUT} font={BRAVURA} />
      </main>
    </div>
  );
}
