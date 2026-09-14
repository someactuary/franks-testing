/**
 * Thin wrapper around the Web MIDI API (`navigator.requestMIDIAccess`). See
 * docs/ARCHITECTURE.md "M3 contracts > MIDI input". Owns: permission request,
 * the list of visible input ports, which one is selected, per-input held-note
 * tracking (for chord building), and parsing raw MIDI bytes into `MidiNoteOn`
 * events (src/input/types.ts).
 *
 * Every entry point is guarded for browsers without Web MIDI (Safari and most
 * non-Chromium browsers): `isSupported()` reports false instead of throwing,
 * and `request()` rejects with `WEB_MIDI_UNSUPPORTED_MESSAGE` rather than
 * calling a global that doesn't exist.
 */
import type { MidiNoteOn } from "@/input/types";

export const WEB_MIDI_UNSUPPORTED_MESSAGE = "Web MIDI not available in this browser (use Chrome)";

export interface MidiInputInfo {
  id: string;
  name: string;
}

type StateChangeListener = () => void;
type NoteOnListener = (ev: MidiNoteOn) => void;

export class MidiInputs {
  private access: MIDIAccess | null = null;
  private boundInput: MIDIInput | null = null;
  private readonly held = new Set<number>();
  private readonly stateListeners = new Set<StateChangeListener>();
  private readonly noteOnListeners = new Set<NoteOnListener>();

  /** False in browsers without the Web MIDI API. Check before showing a "Connect MIDI" control. */
  isSupported(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  }

  /**
   * Requests MIDI access (sysex off — this is a notation editor, not a MIDI utility).
   * Rejects with `WEB_MIDI_UNSUPPORTED_MESSAGE` if `isSupported()` is false, and
   * re-throws whatever the browser rejects with otherwise (e.g. permission denied).
   */
  async request(): Promise<void> {
    if (!this.isSupported()) throw new Error(WEB_MIDI_UNSUPPORTED_MESSAGE);
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.emitStateChange();
    this.emitStateChange();
  }

  /** Currently visible input ports. Empty until `request()` resolves. */
  inputs(): MidiInputInfo[] {
    if (!this.access) return [];
    return Array.from(this.access.inputs.values()).map((input) => ({ id: input.id, name: input.name ?? input.id }));
  }

  /** Selects the input to listen to (or `null` for none). Always clears held-note state. */
  select(id: string | null): void {
    if (this.boundInput) this.boundInput.onmidimessage = null;
    this.boundInput = null;
    this.held.clear();
    if (id === null || !this.access) return;
    const input = this.access.inputs.get(id) ?? null;
    if (!input) return;
    this.boundInput = input;
    input.onmidimessage = (event) => {
      if (event.data) this.handleMessage(event.data);
    };
  }

  /** Fires on any port connect/disconnect (hot-plug), so the UI can refresh its input list. */
  onStateChange(cb: StateChangeListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /** Fires once per note-on (status 0x90, velocity > 0) parsed from the selected input. */
  onNoteOn(cb: NoteOnListener): () => void {
    this.noteOnListeners.add(cb);
    return () => this.noteOnListeners.delete(cb);
  }

  private emitStateChange(): void {
    for (const cb of this.stateListeners) cb();
  }

  /**
   * Parses one raw MIDI message and updates held-note state / fires `onNoteOn`.
   * Internal (not the public "wrap Web MIDI" surface) but deliberately not made
   * JS-private, so tests can drive it directly with fake bytes and no `navigator`
   * at all — see test/ui/midi.test.ts.
   *
   * status 0x90 (note on) with velocity > 0 is a note-on; status 0x80 (note off),
   * or 0x90 with velocity 0 (the common "running status" note-off idiom), releases
   * the note. The channel nibble is ignored (masked with 0xf0).
   */
  handleMessage(data: Uint8Array): void {
    if (data.length < 2) return;
    const status = data[0]! & 0xf0;
    const note = data[1]!;
    const velocity = data.length > 2 ? data[2]! : 0;

    if (status === 0x90 && velocity > 0) {
      const held = Array.from(this.held);
      this.held.add(note);
      const ev: MidiNoteOn = { note, velocity, held };
      for (const cb of this.noteOnListeners) cb(ev);
      return;
    }
    if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      this.held.delete(note);
    }
  }
}
