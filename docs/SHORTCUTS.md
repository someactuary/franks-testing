# Keyboard Shortcuts

These are the bindings implemented in `src/input/step-entry.ts` (M1). The status bar
shows the current measure, staff, duration, and whether note entry is ON or OFF.

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

(`5`, `7`, `9` are unused.)

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

## Navigation

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / next note (crosses barlines) |
| `Home` / `End` | Start / end of the measure |
| `⌘←` / `⌘→` | Previous / next measure |
| `Tab` | Switch between treble and bass staff |
| Click a note | Select it and move the cursor there |
| Click empty staff | Move the cursor there |

## History

| Key | Action |
|-----|--------|
| `⌘Z` | Undo |
| `⌘⇧Z` | Redo |

(`⌘` is `Ctrl` on Windows/Linux.)

## Not yet implemented

Mouse dragging of notes, voices 2–4, tuplets, slurs, dynamics, articulations,
pedal, MIDI input. See PLAN.md milestones M2–M4.
