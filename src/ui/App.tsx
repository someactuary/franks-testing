import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { BRAVURA } from "@/render/smufl";
import { ensureFontLoaded } from "@/render/fonts";
import { engrave } from "@/engraving";
import type { Ref } from "@/engraving/layout-types";
import { newPianoScore } from "@/model/factory";
import type { NoteValue, TimeSignature } from "@/model/duration";
import { parseScore, serializeScore } from "@/io/pscore";
import type { KeyStroke } from "@/input/types";
import { FIXTURES } from "../../test/fixtures";
import { ScoreView } from "./ScoreView";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { useEditorStore } from "./store";
import { handleKey } from "@/input/step-entry";
import { hitTestPoint, locateEvent } from "./layout-utils";
import "./app.css";
import "./print.css";

const FIXTURE_NAMES = Object.keys(FIXTURES);

const TIME_SIG_OPTIONS: { label: string; value: TimeSignature }[] = [
  { label: "4/4", value: { numerator: 4, denominator: 4 } },
  { label: "3/4", value: { numerator: 3, denominator: 4 } },
  { label: "2/4", value: { numerator: 2, denominator: 4 } },
  { label: "6/8", value: { numerator: 6, denominator: 8 } },
];

const MEASURE_COUNT_OPTIONS = [8, 16, 32];

const KEY_SIG_OPTIONS = Array.from({ length: 15 }, (_, i) => i - 7); // -7..7

const DURATION_NAMES: Record<NoteValue, string> = {
  1: "whole",
  2: "half",
  4: "quarter",
  8: "eighth",
  16: "16th",
  32: "32nd",
  64: "64th",
  128: "128th",
  256: "256th",
};

function clefLabel(clef: string): string {
  if (clef.startsWith("treble")) return "treble";
  if (clef.startsWith("bass")) return "bass";
  if (clef.startsWith("alto")) return "alto";
  if (clef.startsWith("tenor")) return "tenor";
  return clef;
}

function keySigLabel(fifths: number): string {
  if (fifths === 0) return "0";
  return fifths > 0 ? `${fifths}♯` : `${-fifths}♭`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

interface NewScoreFormProps {
  onCreate: (opts: { measureCount: number; timeSig: TimeSignature; keySigFifths: number }) => void;
  onCancel: () => void;
}

function NewScoreForm({ onCreate, onCancel }: NewScoreFormProps) {
  const [measureCount, setMeasureCount] = useState(8);
  const [timeSigLabel, setTimeSigLabel] = useState(TIME_SIG_OPTIONS[0]!.label);
  const [keySigFifths, setKeySigFifths] = useState(0);

  function handleSubmit() {
    const timeSig = TIME_SIG_OPTIONS.find((o) => o.label === timeSigLabel)?.value ?? TIME_SIG_OPTIONS[0]!.value;
    onCreate({ measureCount, timeSig, keySigFifths });
  }

  return (
    <form
      className="new-score-form"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <label>
        Measures:{" "}
        <select value={measureCount} onChange={(e) => setMeasureCount(Number(e.target.value))}>
          {MEASURE_COUNT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Time:{" "}
        <select value={timeSigLabel} onChange={(e) => setTimeSigLabel(e.target.value)}>
          {TIME_SIG_OPTIONS.map((o) => (
            <option key={o.label} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Key:{" "}
        <select value={keySigFifths} onChange={(e) => setKeySigFifths(Number(e.target.value))}>
          {KEY_SIG_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {keySigLabel(f)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Create</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

export function App() {
  const [fontReady, setFontReady] = useState(false);
  const [sampleName, setSampleName] = useState("");
  const [newFormOpen, setNewFormOpen] = useState(false);
  const [ioMessage, setIoMessage] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const initialScore = useMemo(() => newPianoScore(), []);
  const editor = useEditorStore(initialScore, handleKey);

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

  const layout = useMemo(() => engrave(editor.score, { font: BRAVURA }), [editor.score]);

  // @page size must match the score's page size in mm; it depends on layout
  // data, so it's injected as a <style> instead of living in print.css.
  const pageSizeCss = useMemo(() => {
    const page = layout.pages[0];
    if (!page) return "";
    const widthMm = page.widthSp * layout.staffSpaceMm;
    const heightMm = page.heightSp * layout.staffSpaceMm;
    return `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
  }, [layout]);

  const { applyKey } = editor;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const stroke: KeyStroke = {
        key: e.key,
        shift: e.shiftKey,
        mod: isMac() ? e.metaKey : e.ctrlKey,
        alt: e.altKey,
      };
      const handled = applyKey(stroke);
      if (handled) e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyKey]);

  const handleSampleChange = useCallback(
    (name: string) => {
      setSampleName(name);
      const make = FIXTURES[name];
      if (!make) return;
      setIoMessage(null);
      editor.loadScore(make());
    },
    [editor],
  );

  function handleNewScore(opts: { measureCount: number; timeSig: TimeSignature; keySigFifths: number }) {
    setIoMessage(null);
    setSampleName("");
    editor.newScore({
      measureCount: opts.measureCount,
      timeSig: opts.timeSig,
      keySig: { fifths: opts.keySigFifths, mode: "major" },
    });
    setNewFormOpen(false);
  }

  async function handleFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const score = parseScore(text);
      setIoMessage(null);
      setSampleName("");
      editor.loadScore(score);
    } catch (err) {
      setIoMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function handleSave() {
    const text = serializeScore(editor.score);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${editor.score.meta.title || "score"}.pscore`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const handleClickElement = useCallback(
    (id: string, _role: Ref["role"], modifiers: { shift: boolean; mod: boolean }) => {
      if (modifiers.shift || modifiers.mod) {
        const ids = editor.selection.ids;
        const next = ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
        editor.setSelection({ ids: next });
      } else {
        editor.setSelection({ ids: [id] });
      }
      const loc = locateEvent(editor.score, id);
      if (!loc) return;
      editor.setCursor({
        partIndex: loc.partIndex,
        measureIndex: loc.measureIndex,
        staffIndex: loc.staffIndex,
        voiceIndex: loc.voiceIndex,
        offset: loc.offset,
      });
    },
    [editor],
  );

  const handleSelectMany = useCallback(
    (ids: string[], additive: boolean) => {
      if (!additive) {
        editor.setSelection({ ids });
        return;
      }
      const merged = new Set(editor.selection.ids);
      for (const id of ids) merged.add(id);
      editor.setSelection({ ids: Array.from(merged) });
    },
    [editor],
  );

  const handleClickEmpty = useCallback(
    (pageIndex: number, xSp: number, ySp: number) => {
      const hit = hitTestPoint(layout, pageIndex, xSp, ySp);
      if (!hit) return;
      editor.setSelection({ ids: [] });
      editor.setCursor({
        ...editor.cursor,
        measureIndex: hit.measureIndex,
        staffIndex: hit.staffIndex,
        offset: hit.offset,
      });
    },
    [editor, layout],
  );

  const cursor = editor.cursor;
  const currentStaffDef = editor.score.parts[cursor.partIndex]?.staves[cursor.staffIndex];
  const clef = currentStaffDef ? clefLabel(currentStaffDef.initialClef) : "?";
  const durationName = DURATION_NAMES[editor.entry.base] ?? String(editor.entry.base);
  const dots = ".".repeat(editor.entry.dots);
  const statusMessage = ioMessage ?? editor.message;

  return (
    <div className="app" data-font-ready={fontReady}>
      <style>{pageSizeCss}</style>
      <header className="toolbar">
        <span className="toolbar-title">Personal Music Notation</span>
        <button type="button" onClick={() => setNewFormOpen((v) => !v)}>
          New
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Open
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pscore,application/json"
          style={{ display: "none" }}
          onChange={(e) => void handleFileChosen(e)}
        />
        <button type="button" onClick={handleSave}>
          Save
        </button>
        <button type="button" onClick={editor.undo} disabled={!editor.canUndo}>
          Undo
        </button>
        <button type="button" onClick={editor.redo} disabled={!editor.canRedo}>
          Redo
        </button>
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" onClick={() => setHelpOpen((v) => !v)} aria-pressed={helpOpen}>
          Shortcuts
        </button>
        <label>
          Samples:{" "}
          <select value={sampleName} onChange={(e) => handleSampleChange(e.target.value)}>
            <option value="">(choose)</option>
            {FIXTURE_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </header>
      {newFormOpen && <NewScoreForm onCreate={handleNewScore} onCancel={() => setNewFormOpen(false)} />}
      {helpOpen && <ShortcutsPanel onClose={() => setHelpOpen(false)} />}
      <main>
        <ScoreView
          layout={layout}
          font={BRAVURA}
          idAttributes
          cursor={editor.cursor}
          selection={editor.selection}
          entryActive={editor.entry.active}
          onClickElement={handleClickElement}
          onClickEmpty={handleClickEmpty}
          onSelectMany={handleSelectMany}
        />
      </main>
      <footer className="status-bar">
        <span>
          Measure {cursor.measureIndex + 1} &middot; Staff {clef} &middot; Voice {cursor.voiceIndex + 1} &middot;
          Duration {durationName}
          {dots} &middot;{" "}
          <span className={editor.entry.active ? "entry-on" : "entry-off"}>
            {editor.entry.active ? "Note entry ON" : "Note entry OFF"}
          </span>
        </span>
        {statusMessage ? (
          <span className="status-bar-message">{statusMessage}</span>
        ) : (
          !editor.entry.active && (
            <span className="status-bar-hint">Press N to start entering notes, or click Shortcuts.</span>
          )
        )}
      </footer>
    </div>
  );
}
