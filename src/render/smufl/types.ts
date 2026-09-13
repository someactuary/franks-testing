/** SMuFL font metadata subset used by the engraver and renderer. All units are staff spaces. */
export type Vec2 = [number, number];

export interface GlyphData {
  /** Unicode codepoint (Private Use Area for SMuFL). */
  cp: number;
  /** Bounding box relative to glyph origin, y up. */
  bbox?: { ne: Vec2; sw: Vec2 };
  /** SMuFL anchors, e.g. stemUpSE, stemDownNW, cutOutNE, opticalCenter. */
  anchors?: Record<string, Vec2>;
  /** Advance width. */
  adv?: number;
}

export interface EngravingDefaults {
  staffLineThickness: number;
  stemThickness: number;
  beamThickness: number;
  beamSpacing: number;
  legerLineThickness: number;
  legerLineExtension: number;
  slurEndpointThickness: number;
  slurMidpointThickness: number;
  tieEndpointThickness: number;
  tieMidpointThickness: number;
  thinBarlineThickness: number;
  thickBarlineThickness: number;
  barlineSeparation: number;
  hairpinThickness: number;
  pedalLineThickness: number;
  octaveLineThickness: number;
  bracketThickness: number;
  subBracketThickness: number;
  textEnclosureThickness: number;
  tupletBracketThickness: number;
  repeatBarlineDotSeparation: number;
  [key: string]: number;
}

export interface SmuflFontData {
  fontName: string;
  fontVersion: string;
  engravingDefaults: EngravingDefaults;
  glyphs: Record<string, GlyphData>;
}
