/**
 * MusicXML 3.1/4.0 import and export (partwise). Implemented in M3.
 * Contract: pure functions; `importMusicXml` accepts uncompressed XML text or a compressed
 * .mxl ArrayBuffer; `exportMusicXml` returns partwise XML text.
 *
 * The implementation lives in ./musicxml/{import,export,common}.ts.
 */
export { MusicXmlError } from "./musicxml/common";
export { importMusicXml } from "./musicxml/import";
export { exportMusicXml } from "./musicxml/export";
