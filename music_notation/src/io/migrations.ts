/**
 * Migration chain for `.pscore` files.
 *
 * Each migration function upgrades a raw (untyped) document from the format
 * version it is keyed by to the next version up, e.g. `migrations[1]` turns a
 * version-1 document into a version-2 document. `migrate()` walks this chain
 * until the document is at `FORMAT_VERSION`, then hands it to the zod schema
 * for real validation.
 *
 * Only format version 1 exists today (see `FORMAT_VERSION` in
 * `src/model/score.ts`), so there is nothing to upgrade yet and this file is
 * a skeleton. When a version 2 lands, add a step here, e.g.:
 *
 *   migrations[1] = (doc) => ({
 *     ...doc,
 *     formatVersion: 2,
 *     // ... shape changes for v1 -> v2 ...
 *   });
 *
 * Do not change or remove a migration once it has shipped: files saved by
 * older builds must continue to load.
 */
import { FORMAT_VERSION } from "@/model";

/** A single upgrade step: raw document at version N -> raw document at version N+1. */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Thrown when a document's `formatVersion` cannot be handled: missing/not a
 * number, older than we have a migration path for, or newer than this build
 * understands.
 */
export class UnsupportedFormatVersionError extends Error {
  constructor(public readonly version: unknown) {
    super(`Unsupported .pscore formatVersion: ${JSON.stringify(version) ?? String(version)}`);
    this.name = "UnsupportedFormatVersionError";
  }
}

/**
 * Migrations keyed by the version they upgrade FROM. There is only one
 * format version so far, so the only entry is a no-op that documents the
 * pattern; it is never actually invoked by `migrate` below since a document
 * already at `FORMAT_VERSION` skips the loop entirely. Replace it with a
 * real v1 -> v2 transform when the format changes, and add a `2: (doc) => ...`
 * entry alongside it for v2 -> v3, and so on.
 */
const migrations: Record<number, Migration> = {
  1: (doc) => doc,
};

/**
 * Brings an arbitrary parsed-JSON value up to the current `.pscore` shape by
 * running it through `migrations`. Does not validate the shape beyond
 * `formatVersion` itself — that is the schema's job (see `src/io/pscore.ts`).
 */
export function migrate(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new UnsupportedFormatVersionError(undefined);
  }
  let doc = raw as Record<string, unknown>;

  const readVersion = (d: Record<string, unknown>): number => {
    const v = d.formatVersion;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      throw new UnsupportedFormatVersionError(v);
    }
    return v;
  };

  let version = readVersion(doc);
  if (version > FORMAT_VERSION) {
    throw new UnsupportedFormatVersionError(version);
  }
  while (version < FORMAT_VERSION) {
    const step = migrations[version];
    if (!step) throw new UnsupportedFormatVersionError(version);
    doc = step(doc);
    version = readVersion(doc);
  }
  return doc;
}
