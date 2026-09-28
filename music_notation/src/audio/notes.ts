/** Small pure helpers shared by the sound engine's instruments. */

export const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** MIDI velocity (1..127) to a 0..1 amplitude: a gentle curve so soft playing is clearly softer. */
export function velocityGain(velocity: number, exponent = 1.7): number {
  return (Math.max(1, Math.min(127, velocity)) / 127) ** exponent;
}

/** The piano samples: one every three semitones from A0 (MIDI 21) to C8 (MIDI 108). */
export const PIANO_SAMPLE_FIRST = 21;
export const PIANO_SAMPLE_LAST = 108;
export const PIANO_SAMPLE_STEP = 3;

const SHARP_NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"];

/** File-name stem of the sample at MIDI note `midi` ("Ds1", "C4", ...); "s" stands for sharp. */
export function pianoSampleName(midi: number): string {
  return `${SHARP_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Every sample's MIDI note, in order. */
export function pianoSampleNotes(): number[] {
  const out: number[] = [];
  for (let n = PIANO_SAMPLE_FIRST; n <= PIANO_SAMPLE_LAST; n += PIANO_SAMPLE_STEP) out.push(n);
  return out;
}

/** The sample closest to `pitch`, and the playback rate that turns it into `pitch`. */
export function nearestPianoSample(pitch: number): { note: number; rate: number } {
  const clamped = Math.max(PIANO_SAMPLE_FIRST, Math.min(PIANO_SAMPLE_LAST, pitch));
  const note =
    PIANO_SAMPLE_FIRST +
    PIANO_SAMPLE_STEP * Math.round((clamped - PIANO_SAMPLE_FIRST) / PIANO_SAMPLE_STEP);
  return { note, rate: 2 ** ((pitch - note) / 12) };
}
