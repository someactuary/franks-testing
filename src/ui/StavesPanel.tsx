import { useState } from "react";
import type { ClefKind, Part, StaffGroupSymbol } from "@/model";
import type { PaletteAction } from "@/input/types";

const CLEF_OPTIONS: { value: ClefKind; label: string }[] = [
  { value: "treble", label: "Treble" },
  { value: "bass", label: "Bass" },
  { value: "alto", label: "Alto" },
  { value: "tenor", label: "Tenor" },
  { value: "treble8vb", label: "Treble 8vb" },
  { value: "treble8va", label: "Treble 8va" },
  { value: "bass8vb", label: "Bass 8vb" },
];

const BRACKET_OPTIONS: { value: StaffGroupSymbol; label: string }[] = [
  { value: "brace", label: "Brace" },
  { value: "bracket", label: "Bracket" },
  { value: "none", label: "None" },
];

export interface StavesPanelProps {
  part: Part;
  onApplyAction: (action: PaletteAction) => void;
  onClose: () => void;
}

/**
 * Lists a part's staves (index, editable name, clef, add/remove) plus the
 * group symbol joining them. Every control dispatches a `PaletteAction`
 * (src/input/types.ts) through `onApplyAction`; this component owns no score
 * state of its own beyond the "new staff name" field.
 */
export function StavesPanel({ part, onApplyAction, onClose }: StavesPanelProps) {
  const [newName, setNewName] = useState("");

  function addStaff(atIndex: number, clef: ClefKind) {
    onApplyAction({ kind: "addStaff", atIndex, clef, ...(newName ? { name: newName } : {}) });
    setNewName("");
  }

  return (
    <aside className="staves-panel" aria-label="Staves">
      <div className="staves-panel-header">
        <strong>Staves</strong>
        <button type="button" onClick={onClose} aria-label="Close staves">
          ×
        </button>
      </div>

      <label className="staves-panel-row">
        Group symbol:{" "}
        <select
          value={part.bracket ?? "brace"}
          onChange={(e) => onApplyAction({ kind: "setBracket", bracket: e.target.value as StaffGroupSymbol })}
        >
          {BRACKET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <table className="staves-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Clef</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {part.staves.map((staff, i) => (
            <tr key={staff.id}>
              <td>{i + 1}</td>
              <td>
                <input
                  type="text"
                  // Re-mount when the model's name changes underneath us (undo,
                  // another agent's edit) so the field doesn't show stale text;
                  // otherwise it's an uncontrolled field, committed on blur.
                  key={staff.name ?? ""}
                  defaultValue={staff.name ?? ""}
                  placeholder={`Staff ${i + 1}`}
                  onBlur={(e) => {
                    const name = e.target.value;
                    if (name !== (staff.name ?? "")) onApplyAction({ kind: "setStaffName", staffIndex: i, name });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              </td>
              <td>
                <select
                  value={staff.initialClef}
                  onChange={(e) => onApplyAction({ kind: "setClef", staffIndex: i, clef: e.target.value as ClefKind })}
                >
                  {CLEF_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="staves-row-actions">
                <button type="button" onClick={() => addStaff(i, "treble")}>
                  Add above
                </button>
                <button type="button" onClick={() => addStaff(i + 1, "bass")}>
                  Add below
                </button>
                <button
                  type="button"
                  disabled={part.staves.length <= 1}
                  onClick={() => onApplyAction({ kind: "removeStaff", staffIndex: i })}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <label className="staves-panel-row">
        New staff name:{" "}
        <input
          type="text"
          value={newName}
          placeholder="(optional)"
          onChange={(e) => setNewName(e.target.value)}
        />
      </label>
    </aside>
  );
}
