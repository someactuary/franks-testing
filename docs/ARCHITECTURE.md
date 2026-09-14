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
