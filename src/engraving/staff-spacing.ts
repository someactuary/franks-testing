/**
 * Per-staff vertical extents of one system: how far everything drawn for each
 * staff reaches above its top line and below its bottom line. vertical.ts turns
 * these into content-aware gaps between the staves.
 *
 * The input is a system laid out on `provisionalSlots` (staves far apart), so a
 * primitive belongs to the staff whose band holds its vertical middle — the
 * same attribution rule skyline.ts uses, but with no neighbour close enough to
 * steal ink. Everything counts: noteheads, ledger lines, stems, beams, flags,
 * accidentals, dots, articulations, fingering, dynamics, hairpins, slurs, ties,
 * ottava and pedal lines, tuplet brackets and lyric lanes. Only the ink that
 * belongs to the system rather than a staff is skipped: staff lines and
 * barlines (the frame — brace, bracket, labels — is not emitted in the
 * provisional pass at all).
 */
import type { SmuflFontData } from "@/render/smufl/types";
import { dynamicBox } from "./attachments";
import { STAFF_HEIGHT } from "./geometry";
import type { Primitive } from "./layout-types";
import { inkBox, type Ink } from "./skyline";
import type { StaffExtent, StaffSlot } from "./vertical";

/** Ink box of a primitive for extent purposes, or undefined if it has none. */
function extentInk(p: Primitive, font: SmuflFontData): Ink | undefined {
  if (p.type === "staffLines") return undefined;
  if (p.ref?.role === "barline") return undefined;
  if (p.type === "text" && p.style === "dynamic") {
    // Dynamics are drawn as SMuFL glyphs; the generic text estimate would
    // overstate their height by more than a staff space.
    const box = dynamicBox(font, p.text, p.size);
    const ink = inkBox(p, font);
    return ink ? { ...ink, minY: p.y - box.up, maxY: p.y + box.down } : undefined;
  }
  return inkBox(p, font);
}

/** Index of the slot whose band (half way to each neighbour) holds `y`. */
function slotAt(slots: readonly StaffSlot[], y: number): number {
  for (let i = 0; i < slots.length - 1; i++) {
    const boundary = (slots[i]!.y + STAFF_HEIGHT + slots[i + 1]!.y) / 2;
    if (y < boundary) return i;
  }
  return slots.length - 1;
}

/** Above/below extent of every staff slot of a provisionally laid-out system. */
export function measureStaffExtents(
  primitives: readonly Primitive[],
  slots: readonly StaffSlot[],
  font: SmuflFontData,
): StaffExtent[] {
  const extents: StaffExtent[] = slots.map(() => ({ above: 0, below: 0 }));
  if (slots.length === 0) return extents;
  for (const p of primitives) {
    const ink = extentInk(p, font);
    if (!ink) continue;
    const i = slotAt(slots, (ink.minY + ink.maxY) / 2);
    const top = slots[i]!.y;
    const ext = extents[i]!;
    ext.above = Math.max(ext.above, top - ink.minY);
    ext.below = Math.max(ext.below, ink.maxY - (top + STAFF_HEIGHT));
  }
  return extents;
}
