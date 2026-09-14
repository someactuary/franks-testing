/**
 * MusicXML 3.1/4.0 import and export (partwise). Implemented in M3.
 * Contract: pure functions; `importMusicXml` accepts uncompressed XML text or a compressed
 * .mxl ArrayBuffer; `exportMusicXml` returns partwise XML text.
 */
import type { Score } from "@/model";

export class MusicXmlError extends Error {}

export function importMusicXml(_input: string | ArrayBuffer): Score {
  throw new MusicXmlError("MusicXML import not implemented yet");
}

export function exportMusicXml(_score: Score): string {
  throw new MusicXmlError("MusicXML export not implemented yet");
}
