// TEMPORARY: replaced by @/input/actions at merge.
/**
 * Minimal `ActionHandler` stub so the UI (palettes, staves panel, notehead
 * dragging) can be built and screenshotted before the real `handleAction`
 * (src/input/actions.ts, landing from a parallel work stream) exists. Only
 * "setVoice" and "setClef" actually do anything; every other action reports
 * "not wired yet" in the status bar so the buttons are visibly present
 * without pretending to work.
 */
import type { ActionHandler } from "@/input/types";

export const stubActionHandler: ActionHandler = (state, action) => {
  switch (action.kind) {
    case "setVoice":
      return { commands: [], cursor: { ...state.cursor, voiceIndex: action.voiceIndex } };

    case "setClef": {
      const { staffIndex, clef } = action;
      const partIndex = state.cursor.partIndex;
      return {
        commands: [
          {
            label: "Set clef",
            apply(draft) {
              const staff = draft.parts[partIndex]?.staves[staffIndex];
              if (!staff) throw new Error(`setClef: no staff at index ${staffIndex} in part ${partIndex}`);
              staff.initialClef = clef;
            },
          },
        ],
      };
    }

    default:
      return { commands: [], message: "not wired yet" };
  }
};
