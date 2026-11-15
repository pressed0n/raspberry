"use client";
/* The hover preview of a file.
   ---------------------------------------------------------------------------
   The owner: *"if hovering over a file a preview box appears which shows the image (only if
   an image file or svg)"*. Three things follow from "only if", and they are the whole design:

   **The rule lives in one place.** `isImageFile` is the same function the 22px tile uses, and
   `image/svg+xml` already starts with `image/`, so an SVG previews without a second list of
   types to keep in step. A PDF gets no peek — not a grey box, not a spinner, nothing.

   **A peek is not a menu.** It is portalled to `document.body` because it hangs *outside* the
   dropdown, which clips and scrolls; it is `pointer-events: none` and `aria-hidden`, because it
   carries no controls and repeating the row's name to a screen reader twice is noise. It
   appears after a short rest (300ms) so sweeping the pointer down a list of attachments does
   not flash eight pictures, and it disappears the instant the pointer leaves.

   **It does not follow the pointer.** See `lib/peek-place.ts` for the arithmetic; here it is
   only the anchor's rect, re-read on scroll and resize so a peek beside a row that scrolls
   stays beside it. */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fileHref, fileSizeText, isImageFile, type FileRef } from "@/lib/database/property-types/files";
import { placePeek } from "@/lib/peek-place";

/**
 * The box, fixed rather than measured. A peek whose height followed its picture would move
 * under the pointer when the next row's image is a different shape, and a fixed box also lets
 * the placement be arithmetic instead of a layout round-trip.
 */
export const PEEK_SIZE = { width: 268, height: 224 };

/** Long enough that a pointer passing over a row on its way somewhere else shows nothing. */
const PEEK_DELAY = 300;

type PeekState = { file: FileRef; anchor: Element };

/**
 * Which file is being previewed, and after what delay. Returned as one object so a caller
 * cannot hold `show` and forget `clear` — the two are used together in every case (the panel
 * clears on close, the row clears on leave, the cell clears on press).
 */
export function useFilePeek() {
  const [peek, setPeek] = useState<PeekState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    cancel();
    setPeek(null);
  }, [cancel]);

  /* `anchor` is the element hovered, so the peek lines up with the row that was actually under
     the pointer rather than with the list it lives in. */
  const show = useCallback((file: FileRef, anchor: Element) => {
    cancel();
    /* Not an image: nothing is scheduled, and anything on screen from the previous row goes
       away now. A peek that lingered over a PDF would be a picture of the file before it. */
    if (!isImageFile(file)) {
      setPeek(null);
      return;
    }
    timer.current = setTimeout(() => setPeek({ file, anchor }), PEEK_DELAY);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return { peek, show, clear };
}

export function FilePeek({ peek }: { peek: PeekState | null }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!peek) {
      setAt(null);
      return;
    }
    const place = () => {
      const rect = peek.anchor.getBoundingClientRect();
      setAt(placePeek(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        PEEK_SIZE,
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };
    place();
    /* Capture, so the panel's own scrolling counts too — its list can be taller than the
       surface. */
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [peek]);

  if (!peek || !at) return null;

  return createPortal(
    <div
      className="db-file-peek"
      data-file-peek={peek.file.mime ?? ""}
      style={{ left: at.left, top: at.top, width: PEEK_SIZE.width, height: PEEK_SIZE.height }}
      /* Decoration. The row already says the name, the size and whether it is an image. */
      aria-hidden
    >
      {failed ? (
        <p className="db-file-peek-note">This file can no longer be opened.</p>
      ) : (
        <img
          className="db-file-peek-img"
          src={fileHref(peek.file.id)}
          alt=""
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      <span className="db-file-peek-cap">
        <span className="db-file-peek-name">{peek.file.name}</span>
        <span className="db-file-peek-size">{fileSizeText(peek.file.size)}</span>
      </span>
    </div>,
    document.body,
  );
}
