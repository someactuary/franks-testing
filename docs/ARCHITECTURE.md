# Architecture

Personal piano-score editor. TypeScript, React, SVG, Bravura (SMuFL). See PLAN.md
for the roadmap. This file is the contract every module is built against.

## Pipeline

```
Score (src/model)  --engrave-->  LayoutResult (src/engraving)  --render-->  SVG (src/render)
      ^                                                                        |
      | Command (src/commands)                <-- hit-test / input (src/input) -+
```

- `src/model` — the document. Types in `score.ts`; rational time in `duration.ts`;
  pitches in `pitch.ts`; traversal helpers in `traverse.ts`; builders in `factory.ts`.
- `src/engraving` — `engrave(score, {font}) => LayoutResult`. Pure. Owns all
  notation rules (stems, beams, accidentals, spacing, breaking, collision).
- `src/render` — `LayoutResult => SVG`. Pure. Knows nothing about music, only
  primitives and SMuFL glyphs. `smufl/` holds font metadata (`generated/bravura.ts`
  from `npm run smufl:gen`).
- `src/commands` — `Command { label, apply(draft) }` with immer; history keeps
  score snapshots. All edits go through commands.
- `src/io` — `.pscore` JSON (zod-validated, versioned, migrations), MusicXML, MIDI.
- `src/input` — keyboard step entry, MIDI input, mouse hit-testing → commands.
- `src/ui` — React shell: score view, palettes, inspector.
- `src/playback` — model → tempo map/sequence → Web Audio / Web MIDI.

## Invariants

1. **Never floats for musical time.** Use `Fraction` from `duration.ts`.
2. **Ids are stable.** Never regenerate an id on edit; spanners/attachments reference them.
3. **Content vs presentation.** Deleting `score.layout` must lose no music.
4. **Engrave and render are pure functions.** No DOM, no globals, deterministic output.
5. **Units.** Model: fractions of a whole note. Layout: staff spaces (sp), y down,
   system-local coordinates. Render: converts sp → mm/px. SMuFL metadata uses y UP;
   flip when reading anchors/bboxes.
6. **Piano first.** Part with 2 staves; `staff` overrides on events/notes for cross-staff.
7. **Tests or it didn't happen.** Engraving changes need golden SVG or structural tests.

## Coordinate conventions for engraving

- Staff line positions: top line at `staff.y`, lines every 1 sp downward.
  Middle line = `staff.y + 2`. A note on staff step `s` (0 = middle line, +1 = one
  step up = half a space) is drawn at `y = staff.y + 2 - s * 0.5`.
- Treble clef: middle line is B4 → diatonic(B4) = 34. Bass clef: middle line D3 → 22.
  Alto: C4 → 28. Tenor: A3 → 26.
- Noteheads are placed by SMuFL origin (left edge, vertical center on the staff position).
  Stem attaches at anchor `stemUpSE` / `stemDownNW` (flip y).
- Standard stem length 3.5 sp; extend to middle line for notes beyond ledger lines.

## Working rules for agents

- Do not change files under `src/model/*.ts`, `src/engraving/layout-types.ts`,
  `src/engraving/index.ts`, `src/commands/types.ts`, or `package.json` without saying
  so explicitly in your report. If a contract is blocking you, implement around it and
  report the gap; the architect will change the contract.
- Do not edit `src/render/smufl/generated/*`; change the generator instead.
- Run `npm run typecheck && npm test` before reporting. Report: what changed, tests
  added, known gaps.
- Path alias `@/` = `src/`.

## Editor contracts (M1)

- `src/input/types.ts` defines `Cursor`, `Selection`, `EntryState`, `EditorState`,
  `KeyStroke`, `KeyResult`, `KeyHandler`. The keystroke handler is a pure function;
  the React store applies its `commands` through `History`, then its cursor/entry updates.
- `MeasureLayout.columns` (system-coordinate x per onset) is how the UI places the cursor
  and hit-tests empty space. Elements are hit-tested via `data-id`/`data-role` on SVG nodes.
- Note entry semantics (MuseScore-like): the cursor sits at a time offset in one voice.
  Writing an event of length L at offset T replaces the span [T, T+L) in that voice:
  events fully inside are removed, an event straddling the span's end is shortened to the
  remainder and re-expressed as rests (notes are not preserved past a partial overwrite in
  M1). Writing never crosses the barline: if T+L exceeds the measure, the write is refused
  with a message. Voice contents always sum exactly to the measure length; a voice with
  no notes is a single `measureRest`.

## M2 contracts

### Actions
`src/input/types.ts` defines `PaletteAction` and `ActionHandler`. UI palettes, the staves
panel, and mouse drags produce actions; `handleAction` in `src/input/actions.ts` (pure)
turns them into a `KeyResult`; the store applies it exactly like a keystroke.

### Voices
- `Voice.index` 0..3. Voice 0 always exists. Other voices are created on demand when the
  cursor writes into them and are filled with rests to the measure length.
- Engraving: if a staff-measure has content in more than one voice, voice 0 (and 2) stems
  go up, voice 1 (and 3) stems go down, regardless of pitch; rests in voice 0 sit higher
  (shifted up by 1 sp), voice 1 rests sit lower (shifted down by 1 sp). A single-voice
  measure keeps the pitch-based stem rule. Accidental memory is shared per staff.
- Rests may be `invisible` (drawn nothing, still occupy time). `RestEvent.invisible`.

### Tuplets
- `TupletGroup` may nest. Sounding length = notated × normal/actual, see traverse.ts.
- Entry: `{kind:"tuplet", actual, normal}` on a selected event of duration d replaces it
  with a TupletGroup whose `unit` is d / normal (e.g. quarter → triplet of eighths), with
  the original note(s) first and rests for the remaining slots. Writing at a cursor that
  lies inside a tuplet writes into the tuplet's own grid (durations are notated in the
  tuplet's unit; the span-replace works on the tuplet's `items`); an event that does not fit
  inside the tuplet is refused.
- Engraving: bracket + number (tupletBracketThickness), on the stem side, bracket omitted
  when all notes are beamed as one group; number centred.

### Attachments and spanners (engraving)
- Live in `src/engraving/attachments.ts` and `src/engraving/spanners.ts`, called once each
  from engrave.ts after notes and ties, before vertical extents. They may add primitives to
  a system and must report their vertical extents so systems don't collide.
- Placement uses a per-staff skyline (`src/engraving/skyline.ts`): top/bottom ink profile
  of the staff's notes/stems/beams per x range; items are stacked outward from the skyline.
- Articulations: on the notehead side opposite the stem (staccato/tenuto/accent/marcato/
  staccatissimo/portato), 0.5 sp gap, never on a staff line (move to the next space);
  marcato always above. Fermata above the staff (below for voice 1). Fingering above the
  notehead (below for the lower staff's voice 1 optionally), small sans-serif digits.
- Dynamics below the staff for the upper staff, and below for the lower staff too (piano
  convention: dynamics go between the staves for the upper staff… keep it simple: below
  the anchored staff unless placement says above), Bravura dynamic glyphs, left-aligned to
  the anchored note's x. Hairpins on the same lane as dynamics, 1 sp opening, never
  overlapping a dynamic text (leave 0.5 sp).
- Pedal: "Ped." glyph (keyboardPedalPed) at the start and "*" (keyboardPedalUp) at the end
  for style "text"; a bracket line for style "line". Below the bottom staff of the part.
- Slurs: cubic Bézier from just outside the start notehead to the end notehead, side
  opposite the stems (above when stems differ), height grows with length (0.5–2.5 sp),
  raised to clear the skyline between the endpoints. Split at system breaks like ties.
- Tempo text bold with metronome glyph (metNoteQuarterUp etc. + " = 120") above the top
  staff at the anchored x. Expression text italic, placement above/below by `placement`.
- Ottava: "8va"/"8vb" glyph + dashed line with a hook, above/below.
- All new primitives carry refs with the roles already listed in layout-types.ts.

### Staves
- Commands: addStaff(atIndex, clef, name?), removeStaff(index) (refuse if last; drops
  spanners/attachments on that staff and shifts staffIndex of later ones), setClef(index,
  clef) (sets initialClef), setStaffName, setBracket. Cursor `staffIndex` clamps.
- Engraving: `Part.bracket` chooses brace (default for 2+ staves), a bracket (SMuFL
  bracket glyph top/bottom with a thick line), or nothing. Staff names left of the first
  system, right-aligned, abbreviations on later systems; the system indent grows to fit.
- Tab cycles through all staves of the part.

## M3 contracts

### Lyrics
- Model: `NoteEvent.lyrics: Lyric[]` (verse, text, syllabic, extend). Rests never carry lyrics.
- Engraving (`src/engraving/lyrics.ts`, called from engrave.ts after attachments): one lane
  per verse below the staff (verse 0 nearest), lane top = max(skyline bottom, staff bottom
  + 2 sp) + 1 sp; verse pitch 1.9 sp; text 1.7 sp serif, style "lyric", centred on the
  notehead x (left-aligned on the notehead for melismas is NOT done; always centred).
  Hyphens (single "-" text) centred between syllables with syllabic begin/middle; repeated
  every ~6 sp on long gaps; extender line (0.12 sp thick) from the end of an `extend`
  syllable to the last note of the melisma. Lyric widths must widen spacing columns:
  spacing.ts gets a per-column minimum from the widest lyric (estimated 0.55 × size × chars
  + 0.6 sp padding). Refs: role "lyric", id = event id.
- Entry (`src/input/step-entry.ts`): with a note selected, `L` (or ⌘L) enters lyric mode
  on that event (verse from `entry.lyric?.verse ?? 0`; `⌘⇧L` next verse). In lyric mode:
  printable characters append to the syllable (creating the Lyric if missing, syllabic
  "single"); Backspace deletes a character (an empty syllable is removed); Space commits
  and moves to the next NoteEvent in the voice (syllabic stays single/end); "-" commits
  as begin/middle (the next syllable becomes end or middle accordingly) and moves on; "_"
  marks `extend` and moves on; Left/Right move between notes without changing text; Enter
  or Escape leaves lyric mode. Every keystroke is one command (grouped undo).

### MIDI input
- `src/input/midi-entry.ts` exports `handleMidiNote: MidiHandler`. Spelling: choose the
  spelling of the MIDI number that matches the key signature at the cursor (its sharps or
  flats), else natural, else sharp for sharp keys / flat for flat keys / sharp in C major.
  With no keys held: write a NoteEvent of the current entry duration (same code path as a
  typed letter, cursor advances, chordMode ignored). With keys held: add the pitch to the
  event before the cursor (chord). Entry must be active; otherwise null.
- `src/ui/midi.ts` wraps Web MIDI (`navigator.requestMIDIAccess`), tracks held notes per
  device, and feeds `store.applyMidi(ev)`. A toolbar select lists inputs; the status bar
  shows the connection state.

### MusicXML
- `src/io/musicxml.ts`: `importMusicXml(xml | mxl ArrayBuffer): Score`,
  `exportMusicXml(score): string`. Partwise only. Parse with `DOMParser` (browser and
  jsdom); .mxl via `fflate` (unzip, read META-INF/container.xml rootfile).
- Import maps: parts → Parts (a part with `<staves>2` → two staves), divisions → Fraction,
  attributes (time, key, clef incl. octave-change, staves), notes/chords/rests (voice,
  staff, type+dots, tuplets via time-modification + tuplet notations, ties, accidentals
  incl. cautionary/parentheses, stem, beam hints ignored, notehead), grace notes,
  articulations, fermata, ornaments, fingering, lyrics (syllabic/extend), directions
  (dynamics, wedges, pedal, octave-shift, words, metronome), slurs (numbered), barlines
  (repeats, endings), measure numbers/implicit pickup, backup/forward (multi-voice),
  part names → staff names when a part has one staff and the score has several parts.
  Unknown elements are ignored, never fatal. Voice contents are re-validated with
  `validateScore`; gaps in a voice are filled with invisible rests.
- Export is the inverse, producing MusicXML 4.0 partwise with `<divisions>` = LCM of all
  denominators (capped sensibly), and must round-trip every fixture through
  import(export(score)) structurally (pitches, durations, voices, ties, tuplets, lyrics,
  dynamics, slurs).

### MusicXML schema check
`npx tsx scripts/export-musicxml.ts <dir>` exports every fixture and re-exports the corpus.
Validate with the W3C schema (github.com/w3c/musicxml, `schema/musicxml.xsd` plus
`xlink.xsd` and `xml.xsd`, imports pointed at the local copies):
`xmllint --noout --schema musicxml.xsd <dir>/*.musicxml`. As of 2026-09-14 all 16 exports
and the 3 corpus files validate. Not yet opened in MuseScore (not installed here).

## M4 contracts: PDF import (OMR)

Recognition is done by **Audiveris** (open source, Java, bundled runtime), installed at
`~/Applications/Audiveris.app` (or `/Applications`, or `$PMN_AUDIVERIS`), with Tesseract
English data in `~/Library/Application Support/AudiverisLtd/audiveris/tessdata/`.
`scripts/setup-omr.sh` installs both idempotently. Evaluated 2026-09-15 on two digital
PDFs: pitches, rhythms, keys, meters, pickups, clefs and voices correct on every page
checked; without OCR data, lyric glyphs are misread as dynamics/trills, so OCR data is
required.

Pipeline: PDF → local OMR service → .mxl → `importMusicXml` → `cleanupOmrScore` → editor.

- **Service** (`server/omr-service.ts`): framework-free `(req, res, next)` handler mounted by
  a Vite plugin in `vite.config.ts` (`configureServer`), so it exists wherever
  `npm run dev` runs; the dev server listens on localhost only. Spawns Audiveris with an
  argument array (never a shell): `-batch -export -output <jobDir> -- <jobDir>/input.pdf`.
  One job runs at a time (FIFO queue); job dirs under `.omr-jobs/` (gitignored), removed
  on DELETE or 1 h after completion; 10-minute timeout per job. Uploads: max 50 MB, magic
  bytes must be `%PDF`, PNG or JPEG. Progress comes from the Audiveris log (sheet count
  and per-sheet completion). API types in `src/io/omr-api.ts`.
- **Client** (`src/io/omr-client.ts`): fetch wrappers + polling.
- **Cleanup** (`src/io/omr-cleanup.ts`, pure): options keep essentials/all and keep layout;
  drops generic part/staff names ("Voice", "Piano", "P1", "Part 1", "Staff 1", "MusicXML
  Part"); when keepLayout is false clears systemBreaks/pageBreaks; produces a review list
  (voices the importer padded with invisible rests, overfull voices, validation issues).
- **UI**: "Import PDF…" → status check (setup hint if Audiveris missing) → upload →
  progress → options (essentials default, keep layout default on) → load. A "Compare"
  side panel renders the original PDF page with pdf.js (kept in memory for the session),
  synced to the page containing the cursor's measure via `layout.pageBreaks`; review items
  listed with click-to-jump.
- **Engraving fix**: staves inside a system are spaced by content: the gap between staff k
  and k+1 is max(default gap, below-extent of k + above-extent of k+1 + 1.5 sp), where
  extents include lyric lanes, dynamics, ledger-line notes, beams and slurs.
- Sample PDFs live in `sample_sheet_music/` (gitignored, third-party). Tests may use them
  only when present (`describe.skipIf`), and must never copy lyric text or other text from
  them into the repo: assert counts and structure only.

### Staff spacing internals (M4)
Engraving runs horizontal layout once, then the vertical passes twice
(`layoutSystems(slotsOf, withFrame)` in engrave.ts): a first pass with staves 1000 sp
apart and no frame, `measureStaffExtents` (src/engraving/staff-spacing.ts) to measure
each staff's ink above and below its lines, then `staffSlots(parts, settings, extents)`
(vertical.ts) and a second pass that draws everything, including brace/bracket, labels
and barlines, at the final positions. Every system carries its own staff positions in
`EmitSystem.slots`; `buildSites(systems)` and the skyline read them. Known limits: one
tall item anywhere widens the whole system; the brace indent is sized from the default
spacing; the rule assumes no item sits more than 500 sp from its staff.

### Running OMR tests
`npm test` skips the real-Audiveris test. Run it on purpose with
`PMN_OMR_REAL=1 npx vitest run server/omr-real-run.test.ts` (needs Audiveris and the
local sample PDF).
