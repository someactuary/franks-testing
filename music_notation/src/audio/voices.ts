/**
 * Note bookkeeping for a polyphonic instrument, independent of Web Audio: which notes are
 * held, which are only ringing because the sustain pedal is down, retriggering a key, and
 * stealing the oldest voice when there are too many. Voices are supplied by a spawner, so
 * this is tested with fakes; times are audio-context seconds and arrive in chronological
 * order (the player hands messages over in order).
 */

export interface Voice {
  /** Start the note's natural release at time `t`; the voice frees itself when it has faded. */
  release(t: number): void;
  /** Cut the voice off quickly at time `t` (stolen, retriggered, or panic). */
  kill(t: number): void;
}

export interface VoiceSpawner {
  /** Begins a note; `onFinished` must be called exactly once when the voice is gone. */
  start(pitch: number, velocity: number, t: number, onFinished: () => void): Voice;
}

interface Entry {
  voice: Voice;
  pitch: number;
  /** The key is still down (as opposed to released but ringing on under the pedal). */
  held: boolean;
}

export class VoiceManager {
  private readonly entries: Entry[] = [];
  private pedalDown = false;

  constructor(
    private readonly spawner: VoiceSpawner,
    private readonly maxVoices = 40,
  ) {}

  get activeCount(): number {
    return this.entries.length;
  }

  noteOn(pitch: number, velocity: number, t: number): void {
    // Striking a key again re-excites the same string: the previous sound of that key ends.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.pitch === pitch) {
        this.entries.splice(i, 1); // cut, so a later pedal lift doesn't "release" it again
        e.voice.kill(t);
      }
    }
    while (this.entries.length >= this.maxVoices) {
      const oldest = this.entries.shift();
      oldest?.voice.kill(t);
    }
    let finishedAlready = false;
    const entry: Entry = { voice: undefined as unknown as Voice, pitch, held: true };
    entry.voice = this.spawner.start(pitch, velocity, t, () => {
      finishedAlready = true;
      const i = this.entries.indexOf(entry);
      if (i >= 0) this.entries.splice(i, 1);
    });
    // A voice can finish before `start` even returns (a fake, or a zero-length note).
    if (!finishedAlready) this.entries.push(entry);
  }

  noteOff(pitch: number, t: number): void {
    // Release the most recently struck key of this pitch that is still down.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.pitch === pitch && e.held) {
        e.held = false;
        if (!this.pedalDown) e.voice.release(t);
        return;
      }
    }
  }

  pedal(down: boolean, t: number): void {
    if (down === this.pedalDown) return;
    this.pedalDown = down;
    if (down) return;
    for (const e of this.entries) if (!e.held) e.voice.release(t);
  }

  /** MIDI "all notes off": every held key is released (still ringing if the pedal is down). */
  allNotesOff(t: number): void {
    for (const e of this.entries) {
      if (e.held) {
        e.held = false;
        if (!this.pedalDown) e.voice.release(t);
      }
    }
  }

  /** Silences everything at once, including notes that were scheduled but haven't started, and lifts the pedal. */
  clear(t: number): void {
    this.pedalDown = false;
    for (const e of this.entries.splice(0)) e.voice.kill(t);
  }
}
