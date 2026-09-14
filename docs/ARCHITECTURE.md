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
