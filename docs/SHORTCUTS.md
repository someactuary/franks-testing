# Keyboard Shortcuts

**Status: Planned — not yet implemented**

This is the planned keyboard reference for the piano score editor, drawn from the project roadmap. These shortcuts are not yet available in the current version.

## Step Entry — Duration

| Key | Action |
|-----|--------|
| `1` | Whole note |
| `2` | Half note |
| `4` | Quarter note |
| `8` | Eighth note |
| `6` | Sixteenth note |
| `3` | Thirty-second note |
| `.` | Toggle dot on current duration |

## Step Entry — Pitch

| Key | Action |
|-----|--------|
| `A–G` | Enter note at that pitch (nearest octave) |
| `Shift + ↑` | Octave up |
| `Shift + ↓` | Octave down |
| `+` or `#` | Sharp |
| `-` or `b` | Flat |
| `Shift + Letter` | Add to chord (instead of replacing) |
| `0` | Rest |

## Navigation & Editing

| Key | Action |
|-----|--------|
| `Tab` | Move cursor forward |
| `Shift + Tab` | Move cursor backward |
| `↑` / `↓` | Move pitch up/down a staff line |
| `←` / `→` | Move cursor left/right in measure |
| `V` | Switch voice |
| `X` | Cross-staff (toggle between treble and bass) |
| `T` | Tie to next note |
| `Delete` | Delete note at cursor |

## Articulations & Ornaments

| Key | Action |
|-----|--------|
| Palette | Click to add articulations (staccato, tenuto, accent, etc.) |
| Palette | Click to add ornaments (trill, mordent, turn, etc.) |

## Other

| Key | Action |
|-----|--------|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+S` / `Cmd+S` | Save |
| `Ctrl+O` / `Cmd+O` | Open |

## MIDI Keyboard Input

When MIDI keyboard input is enabled:
- Press keys on your MIDI device to enter pitches
- Duration comes from the current keyboard-selected value
- Hold multiple keys simultaneously to create chords

---

For the full specification, see [PLAN.md](../PLAN.md) section 5 "User Input".
