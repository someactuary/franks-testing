# Piano Score Editor — Project Plan

Personal-use music notation software focused on piano scores: create, edit,
engrave, print, and (optionally) play back.

Status: M0 in progress (started 2026-09-13). All section-10 decisions confirmed by Frank.

---

## 1. Guiding constraints

- Single user, macOS, pianist. Optimize for fast entry and good-looking piano
  output, not for orchestral breadth or collaboration.
- Grand staff is the default and first-class object. Cross-staff notes,
  pedal marks, fingering, voices per staff, and hand-splitting are core, not
  afterthoughts.
- Output quality target: "looks like a real published edition" (Henle-ish),
  because you will be reading these at the piano.
- Everything must be testable without a human eye where possible: golden SVG
  renders, model round-trips, MusicXML corpus round-trips.

## 2. Technology stack **[confirm]**

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language for model, layout, UI, and playback; huge ecosystem for SVG/MIDI/audio. |
| Rendering | Hand-rolled SVG engraver using a SMuFL font (Bravura or Leland) | Piano notation (cross-staff beams, voices, pedal, ottava) fights VexFlow's abstractions. SMuFL gives glyph metrics + engraving defaults from `*_metadata.json`. |
| App shell | Vite web app first; wrap in Tauri later for a native .app | Browser gives print-to-PDF, Web MIDI, Web Audio for free. Tauri adds native file dialogs and a dock icon when wanted. |
| UI framework | Solid or React (lean toward Solid for fine-grained updates on a big score) | The score canvas is custom SVG anyway; the framework only drives panels/palettes. |
| State/undo | Immutable score model + command pattern | Undo/redo is non-negotiable in a notation editor. |
| Tests | Vitest + snapshot SVG tests + a small MusicXML corpus | Layout regressions are visual; snapshots catch them. |
| Print/PDF | Paginated SVG → `window.print()` initially; `svg2pdf.js`/`pdf-lib` later for direct export | Browser print with `@page` CSS is good enough to start. |

Alternative considered: VexFlow for rendering. Faster to first pixel, but we would
hit its walls on piano-specific layout within weeks. Rejected unless you want
a quick prototype first.

Alternative considered: LilyPond as the engraver (write a LilyPond file, shell
out, show the PDF). Best-looking output on day one, but no interactive editing,
slow feedback loop. Could be an *export* target later.

## 2a. Reference software (what to borrow)

| Software | Borrow | Avoid |
|---|---|---|
| **Noteflight** (browser, you've used it) | Browser-native SVG score, keyboard step entry with auto-advancing cursor, MIDI step input, simple palettes. Closest existing model to this plan. | Cloud dependency, limited engraving control, weak cross-staff/pedal handling. |
| **Cakewalk Score Writer** (older, you've used it) | Staff-and-cursor mental model; piano-first defaults. | Its MIDI-first model where notation is a view of a MIDI track; we keep notation as the source of truth and derive playback. |
| **MuseScore 4** | Keyboard shortcuts (number = duration, letter = pitch), voice handling, palettes, Leland font, MusicXML behavior as the de-facto reference. | UI sprawl. |
| **Dorico** | Best-in-class semantic model: content vs. layout separation, "flows", auto engraving with minimal manual nudging, popovers for text entry of dynamics/tempo. Our model/layout split and the command bar idea come from here. | Complexity of its multi-layout system. |
| **Sibelius / Finale** | Keypad-driven entry (Sibelius), mature engraving rules. | Legacy formats. |
| **LilyPond** | Engraving quality benchmark; its spacing and slur algorithms are documented and worth reading. Possible export target. | Text-only workflow for interactive use. |
| **Verovio / MEI** | Clean rendering-engine architecture (data → layout → SVG), SMuFL usage. Good code to study for engraving/. | MEI as native format is overkill here. |

Rule of thumb: Noteflight for the *feel*, Dorico for the *model*, LilyPond and
Verovio for the *engraving math*, MuseScore for *shortcuts and MusicXML compatibility*.

## 3. File format

### 3.1 Native format: versioned JSON (`.pscore`)
- Human-readable, diffable, trivially loaded in TS. Schema versioned with a
  `formatVersion` and migration functions.
- Durations are exact rationals (numerator/denominator of a whole note), never
  floats. Tuplets carry an explicit ratio. Ticks are a playback-only concept.
- Every element has a stable `id` so spanners (slurs, hairpins, pedal lines,
  ottava) reference endpoints by id and survive edits.

### 3.2 Document model (sketch)
```
Score
  meta: title, composer, copyright, page/engraving settings
  parts[]              # piano = one Part with staves = 2
    staves[]           # clef per staff, staff lines, default
    measures[]         # measure-level: time sig, key sig, barline, repeats, rehearsal
      voices[]         # up to 4 per staff; each voice is a sequence
        events[]       # Note | Chord | Rest | (grace group, tuplet group)
          Note: pitch{step, alter, octave}, duration, tie, accidental
                (explicit / courtesy / auto), staffOverride (cross-staff),
                fingering, articulations[], notehead, stemDir override
  spanners[]           # slur, hairpin, pedal, ottava, trill line, tie-across-system
  attachments[]        # dynamics, tempo, text, fermata → anchored to event/measure ids
  layout hints         # forced system/page breaks, manual nudges (kept separate
                       # from musical content so "reset layout" is trivial)
```
Principle: musical content and presentation overrides live in separate trees.

### 3.3 Interchange
- **MusicXML** import/export (partwise). This unlocks MuseScore, Dorico,
  Finale, IMSLP-derived files. Aim for a correct subset (notes, voices,
  articulations, dynamics, slurs, ties, tuplets, pedal, fingering, repeats).
- **MIDI** export (and import with quantization, later).
- PDF/SVG export for printing.

## 4. Display / engraving pipeline

Model → **Semantic pass** → **Horizontal spacing** → **Line breaking** →
**Vertical layout** → **SVG render**.

1. Semantic pass (per measure, per staff)
   - Stem direction rules (single voice: by average pitch; two voices: up/down).
   - Beaming groups from time signature (and manual overrides).
   - Accidental logic: what to show given key signature and earlier notes in
     the measure; courtesy accidentals; ties across barlines.
   - Chord notehead stacking (seconds offset to the right), accidental
     stacking columns.
   - Rest positioning in multi-voice contexts.
   - Cross-staff notes: note belongs to a voice on staff A but is drawn on
     staff B; beams may span staves.

2. Horizontal spacing
   - Duration-based ideal widths (width ∝ log of duration, standard
     engraving practice) with minimum distances from glyph bounding boxes.
   - Align simultaneous onsets across both staves (and voices) into columns.
   - Prefix items (clef, key, time, accidentals) get fixed widths.

3. Line breaking
   - Start greedy (fill system to max width, then justify). Upgrade to
     Knuth–Plass style optimal breaking if greedy looks uneven.
   - Honor forced breaks from layout hints.

4. Vertical layout
   - Staff-to-staff distance for the grand staff; system spacing on page.
   - Place dynamics, pedal, text, and slurs in "lanes" with collision
     avoidance against note skylines (compute a simple skyline per staff).
   - Slurs as cubic Béziers with endpoints/heights chosen from the skyline.

5. Render
   - Pure function: `LayoutResult → SVG string/DOM`. Glyphs from a SMuFL font
     via `<text>` with the font family, metrics from the SMuFL metadata JSON.
   - Interactive mode: each element carries `data-id` for hit-testing.
   - Print mode: paginated pages at real physical size (mm), `@page` CSS.

Engraving defaults (staff line thickness, stem width, beam thickness, etc.)
come straight from the SMuFL font metadata and are user-tweakable in settings.

## 5. User input

Selection model first: a cursor (position in time × staff × voice) plus a
selection (single element, list, or a rectangular range of measures×staves).
Every edit is a Command with `apply`/`invert` for undo.

Entry modes (all can be mixed):

1. **Step entry via computer keyboard** (Dorico/MuseScore-style, primary):
   - Number keys pick duration (e.g. 5 = quarter, 6 = half, 4 = eighth).
   - Letters A–G enter pitch; nearest-octave rule; `Shift+Up/Down` octave;
     `+`/`-` sharp/flat; `.` dot; `0` rest; `T` tie; `Shift+letter` adds to
     chord; `Tab`/arrows move cursor; `V` switches voice; `X` flips staff for
     cross-staff.
   - Cursor advances automatically after each entry.
2. **MIDI keyboard step entry**: pitch(es) from the MIDI device, duration from
   the current keyboard-selected value. Holding several keys at once = chord.
   Cheap to add on top of mode 1 via Web MIDI.
3. **Mouse/trackpad**: click to select, drag to move pitch, drag handles on
   slurs/hairpins, palettes for articulations/dynamics/ornaments, context
   menus for properties.
4. **Text mini-language** in a command bar (optional, later): e.g. type
   `c4 e g c5` or `mf` or `ped` at the cursor. Fast for a pianist who thinks
   in notes.
5. **Real-time MIDI recording** with quantization (later, with playback).

Annotations: dynamics (text + hairpins), tempo (text + metronome mark),
articulations, fingering (1–5 with hand awareness), pedal (Ped./* and line
style), slurs/phrasing, ottava, expressive text, rehearsal marks, repeats.

## 6. Playback (optional, later)

- Tempo map from tempo marks; dynamics → velocity; pedal → CC64; ties merge;
  repeats/endings expanded to a linear playback sequence.
- Output: Web MIDI to an external synth/DAW, **or** Web Audio with a piano
  soundfont (e.g. via a small sampler library) so it works standalone.
- Look-ahead scheduler (Web Audio clock), moving playhead, click on a note to
  start there. Playback sequence is derived from the model, never stored.

## 7. Milestones

| # | Milestone | Definition of done |
|---|---|---|
| M0 | Skeleton + model + single staff | Repo, CI, JSON schema v1, load/save, render one staff of notes/rests with correct spacing and stems. Golden SVG tests. |
| M1 | Grand staff editor MVP | Two staves, multiple measures, key/time sigs, accidentals, beams, chords, ties, dots, line breaking. Keyboard step entry, cursor, undo/redo. |
| M2 | Expressive notation + print | Voices, tuplets, slurs, dynamics, hairpins, articulations, pedal, fingering, tempo, text. Pagination and print-to-PDF at real size. |
| M3 | Interchange + MIDI input | MusicXML import/export with corpus tests; MIDI keyboard step entry. |
| M4 | Playback | Tempo map, Web Audio piano, playhead, MIDI export. |
| M5 | Piano polish | Cross-staff beaming, ottava, grace notes, tremolo, repeats/endings, arpeggio, trills, layout nudging, Tauri packaging. |

M0 and M1 produce something you can actually use to write a short piece.

## 8. Agent plan: tiers and thinking depth

The tiering rule: **the harder it is to know when you're wrong, the higher
the tier.** Engraving algorithms fail silently (output looks "off"); UI
plumbing fails loudly (test fails, button doesn't work).

### Tier 0 — Architect / integrator (Fable, highest reasoning; this session)
- Owns: architecture, the score model schema, the TypeScript interface
  contracts between modules (`Score`, `Command`, `LayoutResult`, `Renderer`,
  `Importer/Exporter`, `PlaybackSequence`).
- Writes the contracts and a handful of reference tests *before* fanning out
  work, so lower tiers build against fixed interfaces.
- Reviews everything from Tier 1; spot-reviews Tier 2; merges worktrees;
  resolves cross-module conflicts.
- Personally verifies any subagent claim about notation correctness.

### Tier 1 — Domain specialists (Opus, high reasoning effort)
Tasks where music-engraving knowledge and algorithmic judgment matter:
- Horizontal spacing and column alignment.
- Beaming, stem direction, multi-voice rest placement.
- Accidental logic and stacking.
- Line breaking and justification.
- Slur/hairpin/pedal placement with skyline collision avoidance.
- Cross-staff beaming.
- MusicXML semantic mapping (what maps to what, and what's lossy).
- Playback tempo/dynamics/pedal interpretation.
Each task gets: the contract, a reference (Gould's *Behind Bars* rules
summarized in the prompt), and a golden-test expectation. One agent per
task, isolated worktree, must deliver tests.

### Tier 2 — Feature implementers (Sonnet, medium reasoning)
Well-specified, testable work:
- Command implementations (insert note, delete, change duration, transpose,
  add articulation…) and undo/redo.
- Keyboard step-entry state machine and key bindings.
- Web MIDI input adapter.
- Selection and hit-testing over the rendered SVG.
- Palettes, inspector panel, file open/save, settings UI.
- Pagination and print CSS; PDF export wiring.
- MusicXML parser/serializer plumbing (given Tier 1's mapping spec).
- Web Audio scheduler and soundfont loading.
Can run several in parallel in separate worktrees because they touch
different directories.

### Tier 3 — Mechanical tasks (Haiku, low reasoning)
- Generate glyph/metrics tables from SMuFL metadata JSON.
- Test fixtures: sample scores in JSON and MusicXML.
- Boilerplate: component scaffolds, config, lint/format fixes.
- Docs: keyboard shortcut reference, README.
- Bulk renames and dependency bumps.

### Supporting roles
- **Explore agents** (read-only) for "where is X handled" questions once the
  codebase is large.
- **Reviewers**: Opus for anything under `engraving/` or `model/`; Sonnet
  `/code-review` for the rest. Reviews check tests exist and pass, not just
  that code reads well.

### Workflow per milestone
1. Tier 0 writes/updates contracts + milestone task list with acceptance tests.
2. Fan out: Tier 1 tasks first (they gate the rest), Tier 2 in parallel where
   contracts allow, Tier 3 whenever.
3. Each agent works in its own git worktree on a branch, runs the full test
   suite, and reports with: what changed, tests added, known gaps.
4. Tier 0 reviews, runs golden renders, merges, updates this plan.

Rough cost shape: most tokens go to Tier 1 in M0–M2 (engraving is the hard
part), shifting to Tier 2 in M3–M5.

## 9. Proposed repository layout

```
personal_music_notation/
  src/
    model/        score types, ids, durations (rational), schema + migrations
    commands/     Command interface, undo stack, all edit commands
    engraving/    semantic pass, spacing, breaking, vertical layout, skyline
    render/       LayoutResult → SVG; SMuFL glyph tables; print pagination
    input/        keyboard step entry, MIDI input, mouse/hit-testing
    io/           .pscore load/save, MusicXML, MIDI export
    playback/     tempo map, sequence builder, Web Audio/Web MIDI output
    ui/           app shell, panels, palettes, inspector
  fonts/          Bravura or Leland (OFL) + metadata JSON
  test/
    golden/       reference SVGs
    corpus/       MusicXML sample files
  docs/           engraving rules cheat-sheet, shortcuts
```

## 10. Decisions (confirmed 2026-09-13)

1. Stack: TypeScript + own SVG engraver + SMuFL font. Confirmed.
2. Project name: `personal_music_notation`.
3. Font: Bravura.
4. Frank has a digital piano but will connect it later; MIDI input stays at M3.
5. Browser-only until features are settled; port to a native app afterwards.

UI framework: React (chosen over Solid for agent fluency and ecosystem; the
score canvas is custom SVG either way).

## 11. Progress log

- 2026-09-13: Scaffold + Tier 0 contracts committed. M0 fanned out to four
  agents in worktrees: Opus engraver (`src/engraving`), Sonnet renderer + app
  shell (`src/render`, `src/ui`), Sonnet file format + command history
  (`src/io`, `src/commands`), Haiku fixtures + docs (`test/fixtures`, README).
