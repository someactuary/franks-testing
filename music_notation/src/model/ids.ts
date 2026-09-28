import { nanoid } from "nanoid";

/** Stable identifier for any addressable score element. */
export type Id = string;

export function newId(): Id {
  return nanoid(10);
}
