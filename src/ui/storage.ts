/** Best-effort localStorage for small per-browser settings: private-mode or blocked storage never throws out of here. */

export function readSetting(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores `value`, or forgets the setting when it is null. */
export function writeSetting(key: string, value: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // best-effort only
  }
}
