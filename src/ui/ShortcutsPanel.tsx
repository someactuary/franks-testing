/** Keyboard reference shown in-app. Keep in sync with src/input/step-entry.ts and docs/SHORTCUTS.md. */
const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Modes",
    rows: [
      ["N", "Toggle note entry (required before typing notes)"],
      ["Esc", "Leave note entry, clear selection"],
    ],
  },
  {
    title: "Durations (entry on)",
    rows: [
      ["1 / 2 / 4", "Whole / half / quarter"],
      ["8 / 6 / 3", "Eighth / 16th / 32nd"],
      [".", "Toggle dot (Alt+. double dot)"],
    ],
  },
  {
    title: "Pitches and rests (entry on)",
    rows: [
      ["A … G", "Enter pitch (nearest octave, key signature applied), cursor advances"],
      ["Shift+A … G", "Add pitch to the chord just entered"],
      ["0", "Rest of the current duration"],
      ["+ / -", "Next note sharp / flat (or alter selected notes)"],
      ["T", "Toggle tie on last entered / selected note"],
      ["Backspace / Delete", "Erase note before / at the cursor"],
    ],
  },
  {
    title: "Change pitch",
    rows: [
      ["↑ / ↓", "Selected (or last) note up / down a semitone"],
      ["Shift+↑ / ↓", "Up / down an octave"],
    ],
  },
  {
    title: "Navigate",
    rows: [
      ["← / →", "Previous / next note"],
      ["Home / End", "Start / end of measure"],
      ["⌘← / ⌘→", "Previous / next measure"],
      ["Tab", "Switch treble / bass staff"],
      ["Click", "Select a note or place the cursor"],
    ],
  },
  {
    title: "History",
    rows: [
      ["⌘Z / ⌘⇧Z", "Undo / redo"],
    ],
  },
];

export function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="shortcuts-panel" aria-label="Keyboard shortcuts">
      <div className="shortcuts-header">
        <strong>Keyboard shortcuts</strong>
        <button type="button" onClick={onClose} aria-label="Close shortcuts">
          ×
        </button>
      </div>
      {SECTIONS.map((s) => (
        <section key={s.title}>
          <h4>{s.title}</h4>
          <table>
            <tbody>
              {s.rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="shortcut-key">{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="shortcuts-footnote">Typing past the last measure appends a new one. ⌘ is Ctrl on Windows/Linux.</p>
    </aside>
  );
}
