/**
 * Small monochrome toolbar icons (16x16, stroke = currentColor so they inherit the
 * toolbar's text color). Hand-drawn rather than pulled from an icon library — there
 * isn't one in this project's dependencies, and pulling one in for six glyphs isn't
 * worth the bundle weight. Deliberately plain: no gradients/fills, just outlines.
 */
import type { ReactNode } from "react";

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A page with a folded corner: New. */
export function NewIcon() {
  return (
    <IconBase>
      <path d="M4 1.5h5.5L12 4v9.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5Z" />
      <path d="M9.5 1.5V4H12" />
    </IconBase>
  );
}

/** A folder: Open. */
export function OpenIcon() {
  return (
    <IconBase>
      <path d="M1.5 4a1 1 0 0 1 1-1h3l1.2 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4Z" />
    </IconBase>
  );
}

/** A floppy disk: Save. */
export function SaveIcon() {
  return (
    <IconBase>
      <path d="M2.5 1.5h8l3 3v9a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z" />
      <path d="M4.5 1.5v4h5v-4" />
      <path d="M4.5 9.5h7v4.5h-7Z" />
    </IconBase>
  );
}

/** A left-pointing triangle: Undo. */
export function UndoIcon() {
  return (
    <IconBase>
      <path d="M10.5 3.5 5 8l5.5 4.5Z" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

/** A right-pointing triangle: Redo. */
export function RedoIcon() {
  return (
    <IconBase>
      <path d="M5.5 3.5 11 8l-5.5 4.5Z" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

/** A printer: sheet feeding through a body onto a tray. */
export function PrintIcon() {
  return (
    <IconBase>
      <path d="M4.5 5.5v-4h6v4" />
      <path d="M2.5 10.5h-1v-5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v5h-1" />
      <path d="M4 8.5h8v6H4Z" />
    </IconBase>
  );
}
