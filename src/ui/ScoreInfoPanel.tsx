import type { ScoreMeta } from "@/model";
import type { PaletteAction } from "@/input/types";

export interface ScoreInfoPanelProps {
  meta: ScoreMeta;
  onApplyAction: (action: PaletteAction) => void;
  onClose: () => void;
}

const FIELDS: { key: keyof ScoreMeta; label: string; placeholder: string }[] = [
  { key: "title", label: "Title", placeholder: "(untitled)" },
  { key: "subtitle", label: "Subtitle", placeholder: "(none)" },
  { key: "composer", label: "Composer", placeholder: "(none)" },
  { key: "lyricist", label: "Lyricist", placeholder: "(none)" },
];

/**
 * Edits `score.meta`'s title-block fields (title/subtitle/composer/lyricist) — the
 * text engraved at the top of page 1 (src/engraving/engrave.ts's `emitTitleBlock`),
 * previously set only by import or the New Score form and otherwise stuck. Each
 * field commits on blur as its own `setScoreMeta` action/undo step, same pattern as
 * StavesPanel's staff-name fields.
 */
export function ScoreInfoPanel({ meta, onApplyAction, onClose }: ScoreInfoPanelProps) {
  return (
    <aside className="staves-panel score-info-panel" aria-label="Score info">
      <div className="staves-panel-header">
        <strong>Score info</strong>
        <button type="button" onClick={onClose} aria-label="Close score info">
          ×
        </button>
      </div>
      {FIELDS.map(({ key, label, placeholder }) => (
        <label className="staves-panel-row score-info-row" key={key}>
          <span className="score-info-label">{label}:</span>
          <input
            type="text"
            // Re-mount when the model's value changes underneath us (undo, another
            // edit) so the field doesn't show stale text; committed on blur.
            key={meta[key] ?? ""}
            defaultValue={meta[key] ?? ""}
            placeholder={placeholder}
            onBlur={(e) => {
              const value = e.target.value;
              if (value !== (meta[key] ?? "")) onApplyAction({ kind: "setScoreMeta", patch: { [key]: value } });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </label>
      ))}
    </aside>
  );
}
