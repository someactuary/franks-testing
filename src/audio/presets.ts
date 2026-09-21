/** The built-in sounds, as data the UI can list without touching Web Audio. Implementations: ./instruments.ts. */

export interface SoundPreset {
  id: string;
  name: string;
  /** One line under the name in the picker. */
  blurb: string;
  /** How much of the sound goes through the shared reverb (0..1). */
  reverb: number;
}

export const SOUND_PRESETS: readonly SoundPreset[] = [
  { id: "grand-piano", name: "Grand Piano", blurb: "Sampled concert grand", reverb: 0.16 },
  { id: "electric-piano", name: "Electric Piano", blurb: "Warm tine piano", reverb: 0.14 },
  { id: "organ", name: "Organ", blurb: "Drawbar organ", reverb: 0.2 },
  { id: "harpsichord", name: "Harpsichord", blurb: "Plucked, baroque", reverb: 0.18 },
  { id: "strings", name: "Strings", blurb: "Bowed ensemble", reverb: 0.26 },
  { id: "warm-pad", name: "Warm Pad", blurb: "Slow, soft synth", reverb: 0.3 },
  { id: "harp", name: "Harp", blurb: "Plucked strings", reverb: 0.24 },
  { id: "vibraphone", name: "Vibraphone", blurb: "Mallet bars", reverb: 0.22 },
  { id: "music-box", name: "Music Box", blurb: "Bright little tines", reverb: 0.22 },
];

export const DEFAULT_PRESET_ID = "grand-piano";

export const presetById = (id: string): SoundPreset =>
  SOUND_PRESETS.find((p) => p.id === id) ?? SOUND_PRESETS[0]!;
