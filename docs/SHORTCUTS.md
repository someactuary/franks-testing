# Keyboard Shortcuts

These are the bindings implemented in `src/input/step-entry.ts` (M1/M2); several of
them (marked below) go through the same `handleAction` used by the UI palettes, so
they behave identically to clicking the equivalent palette button. The status bar
shows the current measure, staff, voice, duration, and whether note entry is ON or
OFF.

## Modes

| Key | Action |
|-----|--------|
| `N` | Toggle note entry mode (required before typing notes) |
| `Esc` | Leave note entry, clear selection |

## Durations (note entry on)

Noteflight-style digit mapping:

| Key | Duration |
|-----|----------|
| `1` | Whole |
| `2` | Half |
| `4` | Quarter |
| `8` | Eighth |
| `6` | Sixteenth |
| `3` | Thirty-second |
| `.` | Toggle dot (`Alt+.` double dot) |

With note entry **OFF** and a non-empty selection, a duration digit or `.` instead
changes the *selected* events' durations directly (`setDuration/toggleDot`), leaving
the pending entry duration alone.

(`5`, `7`, `9` are unused as plain duration digits; see mod+digit tuplet shortcuts
below.)

## Pitches and rests (note entry on)

| Key | Action |
|-----|--------|
| `A` … `G` | Enter that pitch at the cursor, nearest octave to the previous note, with the key signature's sharp/flat applied. Cursor advances. |
| `Shift+A` … `Shift+G` | Add that pitch to the chord just entered (cursor stays) |
| `0` | Enter a rest of the current duration |
| `+` or `=` | Next note gets a sharp (or sharpen selected notes) |
| `-` | Next note gets a flat (or flatten selected notes) |
| `T` | Toggle tie on the last entered / selected note |
| `Backspace` | Erase the note before the cursor |
| `Delete` | Erase the note at the cursor |

Typing past the end of the last measure appends a new measure automatically.
A note that would cross the barline is refused (message in the status bar).

## Changing pitches

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move the selected note (or last entered note) up / down a semitone |
| `Shift+↑` / `Shift+↓` | Up / down an octave |

## Voices

| Key | Action |
|-----|--------|
| `V` | Cycle the cursor's voice 0 ↔ 1 (status bar shows "Voice 1"/"Voice 2") |
| `⌘⌥1` … `⌘⌥4` | Set the cursor's voice directly (voices 1–4) |
| `H` | Toggle whether the selected rest(s) are drawn (they still occupy time) |

Writing into a voice that doesn't exist yet creates it (filled with a measure rest)
in the same step. Voice 0 always exists.

## Notation

| Key | Action |
|-----|--------|
| `S` | Slur: between the first/last selected notes, or from one selected note to the next |
| `<` (Shift+`,`) | Crescendo hairpin (same endpoints as slur) |
| `>` (Shift+`.`) | Diminuendo hairpin |
| `⌘3` | Triplet (3:2) of the selected note/event |
| `⌘5` | Quintuplet (5:4) |
| `⌘6` | Sextuplet (6:4) |
| `⌘7` | Septuplet (7:4) |
| `⌘2` | Duplet (2:3) |
| `⌘9` | 9:8 tuplet |

Dynamics, pedal, ottava, fermata, tempo/expression text, fingering, and staff
management (add/remove/rename a staff, bracket) don't have dedicated keys yet —
they're `PaletteAction`s meant to be triggered from the UI palettes / staves panel,
which call the same `handleAction` as the keys above.

## Lyrics

| Key | Action |
|-----|--------|
| `L` or `⌘L` | Enter lyric mode on the selected note (or the note before the cursor) |
| `⌘⇧L` | Enter lyric mode on the next verse (current verse + 1, or verse 1 if not already in lyric mode) |

While in lyric mode, every other key is either one of the following or has no
effect (so typing never accidentally enters notes):

| Key | Action |
|-----|--------|
| Any printable character | Append it to the syllable being typed |
| `Backspace` | Delete the last character (removes the syllable once empty) |
| `Space` | Commit the syllable and move to the next note in the voice (skips rests, crosses barlines; stays put at the end of the score) |
| `-` | Commit the syllable with a hyphen (syllabic begin, or middle if continuing a hyphenated word) and move on; the syllable on the note that follows is then marked as ending the word unless it's also followed by `-` |
| `_` | Mark a melisma extender on the current syllable and move on |
| `←` / `→` | Move to the previous / next note without editing |
| `Enter` / `Esc` | Leave lyric mode (the typed text is kept either way) |

## Navigation

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / next note (crosses barlines) |
| `Home` / `End` | Start / end of the measure |
| `⌘←` / `⌘→` | Previous / next measure |
| `Tab` | Cycle through all staves of the part (0 → 1 → … → n−1 → 0) |
| Click a note | Select it and move the cursor there |
| Click empty staff | Move the cursor there |

## History

| Key | Action |
|-----|--------|
| `⌘Z` | Undo |
| `⌘⇧Z` | Redo |

(`⌘` is `Ctrl` on Windows/Linux.)

## Not yet implemented

MIDI input. Mouse dragging of notes (`dragPitch`) and the UI palettes/staves panel
that would trigger dynamics/articulations/ottava/fermata/tempo/text/fingering/staff
actions from a click are `PaletteAction`s already wired up in `src/input/actions.ts`,
but need `src/ui` to expose them. See PLAN.md milestones M2–M4.
