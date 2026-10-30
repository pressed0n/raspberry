"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Native `<dialog>` wrapper for the in-editor pickers (emoji, page link).
 *
 * `<dialog>.showModal()` is used rather than a hand-rolled overlay because it
 * gives focus containment, Escape handling, and the `::backdrop` layer for
 * free — all three of which are hard to get right by hand.
 */
export function EditorDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLInputElement>("input")?.focus();
    return () => element.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="editor-dialog"
      aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        // A click on the backdrop reports the dialog itself as the target.
        // Comparing coordinates distinguishes it from a click on the padding.
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
        }
      }}
    >
      <div className="panel-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={16} /></button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
