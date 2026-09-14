import { useEffect, useMemo, useState } from "react";
import { BRAVURA } from "@/render/smufl";
import { ensureFontLoaded } from "@/render/fonts";
import { engrave } from "@/engraving";
import { FIXTURES } from "../../test/fixtures";
import { ScoreView } from "./ScoreView";
import "./app.css";
import "./print.css";

const FIXTURE_NAMES = Object.keys(FIXTURES);

export function App() {
  const [fontReady, setFontReady] = useState(false);
  const [fixtureName, setFixtureName] = useState(FIXTURE_NAMES[0] ?? "");

  useEffect(() => {
    let cancelled = false;
    ensureFontLoaded()
      .then(() => {
        if (!cancelled) setFontReady(true);
      })
      .catch(() => {
        if (!cancelled) setFontReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // M0: the "document" is one of the sample fixtures. M1 replaces this with an editable score + History.
  const layout = useMemo(() => {
    const make = FIXTURES[fixtureName];
    const score = make ? make() : FIXTURES[FIXTURE_NAMES[0]!]!();
    return engrave(score, { font: BRAVURA });
  }, [fixtureName]);

  // @page size must match the score's page size in mm; it depends on layout
  // data, so it's injected as a <style> instead of living in print.css.
  const pageSizeCss = useMemo(() => {
    const page = layout.pages[0];
    if (!page) return "";
    const widthMm = page.widthSp * layout.staffSpaceMm;
    const heightMm = page.heightSp * layout.staffSpaceMm;
    return `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
  }, [layout]);

  return (
    <div className="app" data-font-ready={fontReady}>
      <style>{pageSizeCss}</style>
      <header className="toolbar">
        <span className="toolbar-title">Personal Music Notation</span>
        <label>
          Sample:{" "}
          <select value={fixtureName} onChange={(e) => setFixtureName(e.target.value)}>
            {FIXTURE_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
      </header>
      <main>
        <ScoreView layout={layout} font={BRAVURA} />
      </main>
    </div>
  );
}
