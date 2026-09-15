/** Shared between App.tsx's New Score form and Palettes.tsx's key-signature control. */

/** -7..7 sharps/flats, the full range a key signature can hold. */
export const KEY_SIG_OPTIONS = Array.from({ length: 15 }, (_, i) => i - 7);

export function keySigLabel(fifths: number): string {
  if (fifths === 0) return "0";
  return fifths > 0 ? `${fifths}♯` : `${-fifths}♭`;
}
