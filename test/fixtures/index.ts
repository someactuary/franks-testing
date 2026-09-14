import { scale } from "./scale";
import { rhythms } from "./rhythms";
import { keys } from "./keys";
import { chords } from "./chords";
import { compound } from "./compound";
import { minuet } from "./minuet";
import { ties } from "./ties";
import { voices } from "./voices";
import { tuplets } from "./tuplets";
import { satb } from "./satb";
import type { Score } from "@/model";

export const FIXTURES: Record<string, () => Score> = {
  scale,
  rhythms,
  keys,
  chords,
  compound,
  minuet,
  ties,
  voices,
  tuplets,
  satb,
};
