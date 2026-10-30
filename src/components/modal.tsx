"use client";
/* Raspberry — workspace modal shell
   ---------------------------------------------------------------------------
   Lifted out of `workspace.tsx` for B25: "Move to" is a second caller living in
   its own file, and two copies of focus trapping is one copy too many.

   Focus handling is manual because this is a `<div>`, not a native `<dialog>`:
   the editor's own pickers use `<dialog>`, but a `<dialog>` here would go into
   the top layer above the editor, so opening it while the caret is in a block
   would take the editor's focus state with it.

   `variant` (B31) widened the shell instead of forking it. Settings is a large
   two-column surface, not a form you fill in and dismiss, but it still wants the
   same scrim, the same Esc, and the same focus trap — so it passes a variant
   and a header `actions` node, and everything else stays identical.

   The first focus target is `[data-autofocus]` when a caller marks one. Without
   it the old rule ("the first input") focused a range slider in the settings
   dialog, which meant the dialog opened with the arrow keys already re-writing
   the palette. Marking the active nav item instead makes the first keystroke
   land where it looks like it will.
*/

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export type ModalVariant = "panel" | "wide" | "settings";

export default function Modal({
  title,
  children,
  onClose,
  variant = "panel",
  actions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  variant?: ModalVariant;
  actions?: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  /* The effect must run once. It used to depend on `onClose`, and every caller
     passes an inline arrow — so it re-ran on every render, which meant the
     cleanup restored focus to whatever was focused before the dialog and the
     body then focused `[data-autofocus]`. In the settings dialog that stole
     focus back mid-interaction: a focused section tab lost the keyboard to the
     sidebar button behind the scrim. A ref keeps the latest handler without
     re-running the trap. */
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, a[href], [tabindex="0"]') ?? []);
    (dialog.current?.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.current?.querySelector<HTMLInputElement>("input") ?? focusable()[0] ?? dialog.current)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  return (
    <div className={`scrim${variant === "settings" ? " scrim-center" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`panel${variant === "wide" ? " panel-wide" : ""}${variant === "settings" ? " panel-settings" : ""}`}
      >
        <div className="panel-head">
          <h2>{title}</h2>
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
