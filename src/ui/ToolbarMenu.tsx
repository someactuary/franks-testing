/**
 * A toolbar icon button that opens a popover panel beneath it. The panel closes on a click
 * anywhere outside it or on Escape (handled before the app's own Escape shortcut, so
 * closing a menu doesn't also stop playback), which also means opening one menu closes any
 * other that was open.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

interface ToolbarMenuProps {
  title: string;
  icon: ReactNode;
  /** A small status light on the button (e.g. a MIDI device is connected). */
  lit?: boolean;
  /** The panel's contents; `close` dismisses it (for a menu whose actions end the visit). */
  children: (close: () => void) => ReactNode;
}

export function ToolbarMenu({ title, icon, lit, children }: ToolbarMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="toolbar-menu" ref={root}>
      <button
        type="button"
        className="icon-button"
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {lit && <span className="icon-light" aria-hidden="true" />}
      </button>
      {open && (
        <div className="toolbar-popover" role="dialog" aria-label={title}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
