import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { BRAVURA } from "@/render/smufl";
import { ensureFontLoaded } from "@/render/fonts";
import { engrave } from "@/engraving";
import type { Ref } from "@/engraving/layout-types";
import { newPianoScore } from "@/model/factory";
import type { NoteValue, TimeSignature } from "@/model/duration";
import type { Score } from "@/model";
import { allEvents, findEvent } from "@/model/traverse";
import { parseScore, serializeScore } from "@/io/pscore";
import { importMusicXml, exportMusicXml, MusicXmlError } from "@/io/musicxml";
import type { OmrReviewItem } from "@/io/omr-cleanup";
import { frac } from "@/model/duration";
import { DEFAULT_ENTRY_STATE } from "@/input/types";
import type { KeyStroke, MidiNoteOn } from "@/input/types";
import { FIXTURES } from "../../test/fixtures";
import { ScoreView } from "./ScoreView";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { StavesPanel } from "./StavesPanel";
import { ImportPdfDialog } from "./ImportPdfDialog";
import type { ImportedFromOmr } from "./ImportPdfDialog";
import { ComparePanel } from "./ComparePanel";
import { Palettes } from "./Palettes";
import { newSatbScore } from "./presets";
import { useEditorStore } from "./store";
import { handleKey } from "@/input/step-entry";
import { handleAction } from "@/input/actions";
import { handleMidiNote } from "@/input/midi-entry";
import { MidiInputs, WEB_MIDI_UNSUPPORTED_MESSAGE } from "./midi";
import type { MidiInputInfo } from "./midi";
import { hitTestPoint, locateEvent } from "./layout-utils";
import "./app.css";
import "./print.css";

const MIDI_INPUT_STORAGE_KEY = "pmn.midiInput";

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

/** Lowercased file extension without the dot, or "" if there isn't one. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** Best-effort localStorage read/write: private-mode/disabled storage never throws out here. */
function readStoredMidiInput(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(MIDI_INPUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredMidiInput(id: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(MIDI_INPUT_STORAGE_KEY, id);
  } catch {
    // best-effort only
  }
}

/** Triggers a browser download of `content` as `filename`. */
function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface NewScoreFormProps {
  onCreate: (opts: { measureCount: number; timeSig: TimeSignature; keySigFifths: number }) => void;
  onCreateSatb: (opts: { measureCount: number; timeSig: TimeSignature; keySigFifths: number }) => void;
  onCancel: () => void;
}

function NewScoreForm({ onCreate, onCreateSatb, onCancel }: NewScoreFormProps) {
  const [measureCount, setMeasureCount] = useState(8);
  const [timeSigLabel, setTimeSigLabel] = useState(TIME_SIG_OPTIONS[0]!.label);
  const [keySigFifths, setKeySigFifths] = useState(0);

  function currentOpts() {
    const timeSig = TIME_SIG_OPTIONS.find((o) => o.label === timeSigLabel)?.value ?? TIME_SIG_OPTIONS[0]!.value;
    return { measureCount, timeSig, keySigFifths };
  }

  function handleSubmit() {
    onCreate(currentOpts());
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
      <button type="button" onClick={() => onCreateSatb(currentOpts())} title="4 staves: Soprano/Alto/Tenor/Bass">
        New SATB
      </button>
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
  const [stavesOpen, setStavesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  // The imported PDF's bytes and the OMR review list, kept for the "Compare with
  // PDF" panel — in memory only, never persisted (docs/ARCHITECTURE.md "M4 contracts").
  const [pdfSession, setPdfSession] = useState<{ bytes: ArrayBuffer; filename: string } | null>(null);
  const [omrReview, setOmrReview] = useState<OmrReviewItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const initialScore = useMemo(() => newPianoScore(), []);
  const editor = useEditorStore(initialScore, handleKey, handleAction, handleMidiNote);

  const [midi] = useState(() => new MidiInputs());
  const [midiSupported] = useState(() => midi.isSupported());
  const [midiGranted, setMidiGranted] = useState(false);
  const [midiInputsList, setMidiInputsList] = useState<MidiInputInfo[]>([]);
  const [midiSelectedId, setMidiSelectedId] = useState<string | null>(null);
  const [midiError, setMidiError] = useState<string | null>(null);
  const midiSelectedRef = useRef<string | null>(null);

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

  const selectMidiInput = useCallback(
    (id: string | null) => {
      midi.select(id);
      midiSelectedRef.current = id;
      setMidiSelectedId(id);
      if (id) writeStoredMidiInput(id);
    },
    [midi],
  );

  /** Re-reads the visible input ports (initial grant, and every hot-plug event) and keeps a valid selection: the previous pick if it's still there, else the remembered localStorage id, else the first input. */
  const refreshMidiInputs = useCallback(() => {
    const list = midi.inputs();
    setMidiInputsList(list);
    const current = midiSelectedRef.current;
    if (current && list.some((i) => i.id === current)) return; // still connected, MidiInputs already has it selected
    const stored = readStoredMidiInput();
    const next = (stored && list.some((i) => i.id === stored) ? stored : list[0]?.id) ?? null;
    selectMidiInput(next);
  }, [midi, selectMidiInput]);

  async function handleConnectMidi() {
    setMidiError(null);
    try {
      await midi.request();
      setMidiGranted(true);
      refreshMidiInputs();
    } catch (err) {
      setMidiError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    return midi.onStateChange(() => refreshMidiInputs());
  }, [midi, refreshMidiInputs]);

  const { applyMidi } = editor;
  useEffect(() => {
    return midi.onNoteOn((ev) => {
      applyMidi(ev);
    });
  }, [midi, applyMidi]);

  // Dev-only test hook (see docs on window.__pmnMidiTest): lets a Playwright/console
  // script push a synthetic MidiNoteOn straight into the store, without a real MIDI
  // device — Web MIDI reports zero devices in headless/CI browsers. Lives here (not
  // main.tsx) because that's where the store is; never present in a production build.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __pmnMidiTest?: (ev: MidiNoteOn) => void };
    w.__pmnMidiTest = (ev: MidiNoteOn) => applyMidi(ev);
    return () => {
      delete w.__pmnMidiTest;
    };
  }, [applyMidi]);

  // Dev-only test hook to preview lyric-mode UI: the real L-key handler
  // (src/input/step-entry.ts) hasn't landed yet, so there's no in-app way to enter
  // lyric mode. Tags the first note event in the score with a lyric and points
  // entry.lyric at it, via the same store.setEntry used for App's own state.
  const { loadScore, setEntry } = editor;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __pmnDevSetLyric?: (verse: number, text: string) => void };
    w.__pmnDevSetLyric = (verse: number, text: string) => {
      const cloned = structuredClone(editor.score) as Score;
      const firstNote = Array.from(allEvents(cloned)).find((e) => e.positioned.event.kind === "note");
      if (!firstNote) return;
      const event = firstNote.positioned.event;
      if (event.kind !== "note") return;
      event.lyrics = [{ verse, text, syllabic: "single" }];
      loadScore(cloned);
      setEntry({ ...DEFAULT_ENTRY_STATE, active: true, lyric: { eventId: event.id, verse } });
    };
    return () => {
      delete w.__pmnDevSetLyric;
    };
  }, [editor.score, loadScore, setEntry]);

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

  function handleNewSatb(opts: { measureCount: number; timeSig: TimeSignature; keySigFifths: number }) {
    setIoMessage(null);
    setSampleName("");
    editor.loadScore(
      newSatbScore({
        measureCount: opts.measureCount,
        timeSig: opts.timeSig,
        keySig: { fifths: opts.keySigFifths, mode: "major" },
      }),
    );
    setNewFormOpen(false);
  }

  async function handleFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    const ext = extensionOf(file.name);
    try {
      let score: Score;
      if (ext === "mxl") {
        score = importMusicXml(await file.arrayBuffer());
      } else if (ext === "musicxml" || ext === "xml") {
        score = importMusicXml(await file.text());
      } else {
        // .pscore, or anything unrecognized: try our own JSON format.
        score = parseScore(await file.text());
      }
      setIoMessage(null);
      setSampleName("");
      editor.loadScore(score);
    } catch (err) {
      if (err instanceof MusicXmlError) setIoMessage(err.message);
      else setIoMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function handleSave() {
    downloadFile(`${editor.score.meta.title || "score"}.pscore`, serializeScore(editor.score), "application/json");
  }

  function handleExportMusicXml() {
    try {
      const text = exportMusicXml(editor.score);
      downloadFile(`${editor.score.meta.title || "score"}.musicxml`, text, "application/vnd.recordare.musicxml+xml");
      setIoMessage(null);
    } catch (err) {
      if (err instanceof MusicXmlError) setIoMessage(err.message);
      else setIoMessage(err instanceof Error ? err.message : String(err));
    }
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

  const handleDragPitch = useCallback(
    (noteId: string, diatonicDelta: number) => {
      editor.applyAction({ kind: "dragPitch", noteId, diatonicDelta });
    },
    [editor],
  );

  const handleOmrImported = useCallback(
    (result: ImportedFromOmr) => {
      editor.loadScore(result.score);
      setOmrReview(result.review);
      setPdfSession(result.pdfBytes ? { bytes: result.pdfBytes, filename: result.pdfFilename } : null);
      setImportOpen(false);
      setIoMessage(null);
      setSampleName("");
    },
    [editor],
  );

  const handleReviewClick = useCallback(
    (item: OmrReviewItem) => {
      editor.setSelection({ ids: [] });
      editor.setCursor({
        partIndex: 0,
        measureIndex: item.measureIndex,
        staffIndex: item.staffIndex,
        voiceIndex: 0,
        offset: frac(0),
      });
    },
    [editor],
  );

  const cursor = editor.cursor;
  const currentStaffDef = editor.score.parts[cursor.partIndex]?.staves[cursor.staffIndex];
  const clef = currentStaffDef ? clefLabel(currentStaffDef.initialClef) : "?";
  const durationName = DURATION_NAMES[editor.entry.base] ?? String(editor.entry.base);
  const dots = ".".repeat(editor.entry.dots);
  const statusMessage = ioMessage ?? editor.message;

  // Lyric mode (docs/ARCHITECTURE.md "M3 contracts > Lyrics"): reads the syllable text
  // straight from the score so it always matches what's engraved. Not note entry, so
  // the entry cursor line is hidden below (`entryActive`).
  const lyric = editor.entry.lyric;
  const lyricInfo = useMemo(() => {
    if (!lyric) return null;
    const event = findEvent(editor.score, lyric.eventId);
    const text = event && event.kind === "note" ? (event.lyrics?.find((l) => l.verse === lyric.verse)?.text ?? "") : "";
    return { verse: lyric.verse, text };
  }, [editor.score, lyric]);

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
          accept=".pscore,.musicxml,.xml,.mxl,application/json"
          style={{ display: "none" }}
          onChange={(e) => void handleFileChosen(e)}
        />
        <button type="button" onClick={handleSave}>
          Save
        </button>
        <button type="button" onClick={handleExportMusicXml}>
          Export MusicXML
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
        <button type="button" onClick={() => setStavesOpen((v) => !v)} aria-pressed={stavesOpen}>
          Staves
        </button>
        <button type="button" onClick={() => setImportOpen(true)}>
          Import PDF…
        </button>
        <button
          type="button"
          onClick={() => setCompareOpen((v) => !v)}
          aria-pressed={compareOpen}
          disabled={!pdfSession}
          title={pdfSession ? "Toggle the original-PDF compare panel" : "Import a PDF this session to enable comparing"}
        >
          Compare with PDF
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
        <div className="toolbar-midi">
          {!midiSupported ? (
            <span className="toolbar-hint">{WEB_MIDI_UNSUPPORTED_MESSAGE}</span>
          ) : !midiGranted ? (
            <button type="button" onClick={() => void handleConnectMidi()}>
              Connect MIDI
            </button>
          ) : (
            <>
              <span
                className={`midi-dot${midiSelectedId ? " midi-dot-on" : ""}`}
                title={midiSelectedId ? "MIDI input connected" : "No MIDI input selected"}
                aria-hidden="true"
              />
              {midiInputsList.length === 0 ? (
                <span className="toolbar-hint">No MIDI inputs</span>
              ) : (
                <select
                  aria-label="MIDI input"
                  value={midiSelectedId ?? ""}
                  onChange={(e) => selectMidiInput(e.target.value || null)}
                >
                  {midiInputsList.map((input) => (
                    <option key={input.id} value={input.id}>
                      {input.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          {midiError && <span className="toolbar-hint">{midiError}</span>}
        </div>
      </header>
      {newFormOpen && (
        <NewScoreForm onCreate={handleNewScore} onCreateSatb={handleNewSatb} onCancel={() => setNewFormOpen(false)} />
      )}
      <Palettes font={BRAVURA} onApplyAction={editor.applyAction} />
      {helpOpen && <ShortcutsPanel onClose={() => setHelpOpen(false)} />}
      {stavesOpen && editor.score.parts[cursor.partIndex] && (
        <StavesPanel
          part={editor.score.parts[cursor.partIndex]!}
          onApplyAction={editor.applyAction}
          onClose={() => setStavesOpen(false)}
        />
      )}
      <div className={`workspace${compareOpen && pdfSession ? " workspace-with-compare" : ""}`}>
        <main>
          <ScoreView
            layout={layout}
            font={BRAVURA}
            idAttributes
            cursor={editor.cursor}
            selection={editor.selection}
            entryActive={editor.entry.active && !lyricInfo}
            onClickElement={handleClickElement}
            onClickEmpty={handleClickEmpty}
            onSelectMany={handleSelectMany}
            onDragPitch={handleDragPitch}
          />
        </main>
        {compareOpen && pdfSession && (
          <ComparePanel
            pdfBytes={pdfSession.bytes}
            pageBreaks={editor.score.layout.pageBreaks}
            cursorMeasureIndex={cursor.measureIndex}
            review={omrReview}
            onReviewClick={handleReviewClick}
            onClose={() => setCompareOpen(false)}
          />
        )}
      </div>
      {importOpen && <ImportPdfDialog onClose={() => setImportOpen(false)} onImported={handleOmrImported} />}
      <footer className="status-bar">
        {lyricInfo ? (
          <span className="lyric-status">
            Lyrics &middot; verse {lyricInfo.verse + 1} &middot; {lyricInfo.text}
          </span>
        ) : (
          <span>
            Measure {cursor.measureIndex + 1} &middot; Staff {clef} &middot; Voice {cursor.voiceIndex + 1}{" "}
            <button
              type="button"
              className="voice-toggle"
              title="Toggle voice 1 / 2"
              onClick={() => editor.applyAction({ kind: "setVoice", voiceIndex: cursor.voiceIndex === 1 ? 0 : 1 })}
            >
              Voice 1/2
            </button>
            &middot; Duration {durationName}
            {dots} &middot;{" "}
            <span className={editor.entry.active ? "entry-on" : "entry-off"}>
              {editor.entry.active ? "Note entry ON" : "Note entry OFF"}
            </span>
          </span>
        )}
        {statusMessage ? (
          <span className="status-bar-message">{statusMessage}</span>
        ) : (
          !editor.entry.active &&
          !lyricInfo && <span className="status-bar-hint">Press N to start entering notes, or click Shortcuts.</span>
        )}
      </footer>
    </div>
  );
}
