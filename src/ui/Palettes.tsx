import { useState } from "react";
import { glyphChar } from "@/render/smufl";
import type { SmuflFontData } from "@/render/smufl/types";
import type { Articulation, NotatedDuration, Placement } from "@/model";
import type { PaletteAction } from "@/input/types";

export interface PalettesProps {
  font: SmuflFontData;
  onApplyAction: (action: PaletteAction) => void;
}

/** A single glyph rendered in the Bravura font, for notation-like button labels. */
function Smufl({ font, glyph }: { font: SmuflFontData; glyph: string }) {
  return (
    <span className="smufl" aria-hidden="true">
      {glyphChar(font, glyph)}
    </span>
  );
}

const DYNAMICS: { text: string; glyph: string }[] = [
  { text: "pp", glyph: "dynamicPP" },
  { text: "p", glyph: "dynamicPiano" },
  { text: "mp", glyph: "dynamicMP" },
  { text: "mf", glyph: "dynamicMF" },
  { text: "f", glyph: "dynamicForte" },
  { text: "ff", glyph: "dynamicFF" },
  { text: "sfz", glyph: "dynamicSforzato" },
];

const ARTICULATIONS: { articulation: Articulation; label: string; glyph: string }[] = [
  { articulation: "staccato", label: "Staccato", glyph: "articStaccatoAbove" },
  { articulation: "tenuto", label: "Tenuto", glyph: "articTenutoAbove" },
  { articulation: "accent", label: "Accent", glyph: "articAccentAbove" },
  { articulation: "marcato", label: "Marcato", glyph: "articMarcatoAbove" },
];

const FINGERINGS = ["1", "2", "3", "4", "5"];

const TUPLETS: { label: string; actual: number; normal: number }[] = [
  { label: "3", actual: 3, normal: 2 },
  { label: "5", actual: 5, normal: 4 },
  { label: "6", actual: 6, normal: 4 },
  { label: "7", actual: 7, normal: 4 },
  { label: "2", actual: 2, normal: 3 },
  { label: "9", actual: 9, normal: 8 },
];

const DURATIONS: { key: string; label: string; base: NotatedDuration["base"] }[] = [
  { key: "1", label: "Whole", base: 1 },
  { key: "2", label: "Half", base: 2 },
  { key: "4", label: "Quarter", base: 4 },
  { key: "8", label: "Eighth", base: 8 },
  { key: "6", label: "16th", base: 16 },
  { key: "3", label: "32nd", base: 32 },
];

const BEAT_UNITS: { label: string; duration: NotatedDuration }[] = [
  { label: "quarter", duration: { base: 4, dots: 0 } },
  { label: "half", duration: { base: 2, dots: 0 } },
  { label: "eighth", duration: { base: 8, dots: 0 } },
  { label: "dotted quarter", duration: { base: 4, dots: 1 } },
];

function TempoForm({ onApplyAction, onDone }: { onApplyAction: (a: PaletteAction) => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [bpm, setBpm] = useState("");
  const [beatUnitLabel, setBeatUnitLabel] = useState(BEAT_UNITS[0]!.label);

  function submit() {
    const beatUnit = BEAT_UNITS.find((u) => u.label === beatUnitLabel)?.duration;
    const bpmNum = bpm.trim() === "" ? undefined : Number(bpm);
    onApplyAction({
      kind: "tempo",
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(bpmNum !== undefined && Number.isFinite(bpmNum) ? { bpm: bpmNum } : {}),
      ...(beatUnit ? { beatUnit } : {}),
    });
    onDone();
  }

  return (
    <form
      className="palette-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input type="text" placeholder="Text (optional)" value={text} onChange={(e) => setText(e.target.value)} />
      <input
        type="number"
        placeholder="BPM"
        value={bpm}
        onChange={(e) => setBpm(e.target.value)}
        style={{ width: "4.5em" }}
      />
      <select value={beatUnitLabel} onChange={(e) => setBeatUnitLabel(e.target.value)}>
        {BEAT_UNITS.map((u) => (
          <option key={u.label} value={u.label}>
            {u.label}
          </option>
        ))}
      </select>
      <button type="submit">Add</button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

const TEXT_STYLES: { value: "expression" | "technique" | "plain"; label: string }[] = [
  { value: "expression", label: "Expression" },
  { value: "technique", label: "Technique" },
  { value: "plain", label: "Plain" },
];

function TextForm({ onApplyAction, onDone }: { onApplyAction: (a: PaletteAction) => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [style, setStyle] = useState<"expression" | "technique" | "plain">("expression");
  const [placement, setPlacement] = useState<"" | Placement>("");

  function submit() {
    if (!text.trim()) return;
    onApplyAction({ kind: "text", text: text.trim(), style, ...(placement ? { placement } : {}) });
    onDone();
  }

  return (
    <form
      className="palette-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input type="text" placeholder="Text" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <select value={style} onChange={(e) => setStyle(e.target.value as "expression" | "technique" | "plain")}>
        {TEXT_STYLES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <select value={placement} onChange={(e) => setPlacement(e.target.value as "" | Placement)}>
        <option value="">(default)</option>
        <option value="above">above</option>
        <option value="below">below</option>
      </select>
      <button type="submit">Add</button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

/**
 * Second toolbar row: grouped notation palettes. Every button calls
 * `onApplyAction` with a `PaletteAction` (src/input/types.ts); this component
 * holds no score state, only the two inline forms' own draft fields.
 */
export function Palettes({ font, onApplyAction }: PalettesProps) {
  const [openForm, setOpenForm] = useState<"tempo" | "text" | null>(null);

  return (
    <div className="palette-row" role="toolbar" aria-label="Notation palettes">
      <div className="palette-group" aria-label="Dynamics">
        <span className="palette-group-label">Dynamics</span>
        {DYNAMICS.map((d) => (
          <button
            key={d.text}
            type="button"
            title={d.text}
            onClick={() => onApplyAction({ kind: "dynamic", text: d.text })}
          >
            <Smufl font={font} glyph={d.glyph} />
          </button>
        ))}
      </div>

      <div className="palette-group" aria-label="Articulations">
        <span className="palette-group-label">Artic.</span>
        {ARTICULATIONS.map((a) => (
          <button
            key={a.articulation}
            type="button"
            title={a.label}
            onClick={() => onApplyAction({ kind: "articulation", articulation: a.articulation })}
          >
            <Smufl font={font} glyph={a.glyph} />
          </button>
        ))}
      </div>

      <div className="palette-group" aria-label="Lines">
        <span className="palette-group-label">Lines</span>
        <button type="button" onClick={() => onApplyAction({ kind: "slur" })}>
          Slur
        </button>
        <button type="button" onClick={() => onApplyAction({ kind: "hairpin", shape: "cresc" })}>
          Cresc.
        </button>
        <button type="button" onClick={() => onApplyAction({ kind: "hairpin", shape: "dim" })}>
          Dim.
        </button>
        <button type="button" onClick={() => onApplyAction({ kind: "pedal" })}>
          Pedal
        </button>
        <button type="button" onClick={() => onApplyAction({ kind: "ottava", shift: 8 })}>
          8va
        </button>
        <button type="button" onClick={() => onApplyAction({ kind: "ottava", shift: -8 })}>
          8vb
        </button>
      </div>

      <div className="palette-group" aria-label="Marks">
        <span className="palette-group-label">Marks</span>
        <button type="button" onClick={() => onApplyAction({ kind: "fermata" })}>
          Fermata
        </button>
        <button type="button" aria-pressed={openForm === "tempo"} onClick={() => setOpenForm(openForm === "tempo" ? null : "tempo")}>
          Tempo…
        </button>
        <button type="button" aria-pressed={openForm === "text"} onClick={() => setOpenForm(openForm === "text" ? null : "text")}>
          Text…
        </button>
        {openForm === "tempo" && <TempoForm onApplyAction={onApplyAction} onDone={() => setOpenForm(null)} />}
        {openForm === "text" && <TextForm onApplyAction={onApplyAction} onDone={() => setOpenForm(null)} />}
      </div>

      <div className="palette-group" aria-label="Fingering">
        <span className="palette-group-label">Finger</span>
        {FINGERINGS.map((f) => (
          <button key={f} type="button" onClick={() => onApplyAction({ kind: "fingering", text: f })}>
            {f}
          </button>
        ))}
        <button type="button" onClick={() => onApplyAction({ kind: "fingering", text: "" })}>
          clear
        </button>
      </div>

      <div className="palette-group" aria-label="Tuplet">
        <span className="palette-group-label">Tuplet</span>
        {TUPLETS.map((t) => (
          <button
            key={t.label}
            type="button"
            title={`${t.actual}:${t.normal}`}
            onClick={() => onApplyAction({ kind: "tuplet", actual: t.actual, normal: t.normal })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="palette-group" aria-label="Duration">
        <span className="palette-group-label">Duration</span>
        {DURATIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            title={d.label}
            onClick={() => onApplyAction({ kind: "setDuration", base: d.base, dots: 0 })}
          >
            {d.key}
          </button>
        ))}
        <button type="button" title="Toggle dot" onClick={() => onApplyAction({ kind: "toggleDot" })}>
          •
        </button>
      </div>
    </div>
  );
}
