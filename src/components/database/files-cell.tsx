"use client";
/* A Files & Media cell: what is attached, and one surface that attaches more.
   ---------------------------------------------------------------------------
   The owner asked for "an upload field that holds one or more files ... functional and
   good solid and simple ux". The shape below is the one this table already uses for a cell
   with a surface behind it — a tag cell, a date cell, a place cell — because a fourth
   interaction invented for the fourth column is how a table stops feeling like one table:

     press the cell  →  the surface opens, hanging off the cell
     press it again  →  it closes            (Escape and a press outside also close it)

   What is *not* borrowed is a text field. A Files column used to fall through to the shared
   `db-cell-input`, which meant typing "holiday.png" into it stored a file reference with
   that name and no bytes — an entry pointing at nothing. There is no text to type here, so
   the cell is a button and the surface is where the two real actions live: put a file in,
   take a file out.

   Three decisions worth the prose:

   **The cell shows the first file, not the list.** A table cell is 120–220px and a row is
   32px; five attachments cannot be read there, and a heap of thumbnails says "there are
   some" without saying *which*. So: one tile (a thumbnail for an image, an extension badge
   for anything else) plus the first name plus `+2`. The panel is where the list is.

   **Two ways in, and both of them are visible.** `Upload` opens the OS file picker; dropping
   files on the cell or on the open panel is the same call. Drag-and-drop alone would be
   invisible — it is a gesture you have to already know — so it is the *second* way in, never
   the only one, and the panel says "Drop files here, or press Upload" in the empty state.

   **One write per batch, and nothing is lost when one file fails.** Files go up one at a
   time through the app's one uploader (`editor/media.ts`'s `uploadFile`, the same function a
   pasted image uses), each spinner replacing the last, and the cell is written *once* at the
   end with everything that landed. A failed upload is a red line under the list naming the
   file and the server's own sentence ("larger than the 25 MB limit for image files"), and the
   files that did land are still committed — a batch that fails in the middle is not a batch
   that did nothing.

   Removing a file removes the *reference*. The bytes stay: the store is content-addressed, so
   the same photo can be attached to three rows and a delete that swept the blob would empty
   the other two cells. Nothing in this file deletes a file from disk. */
import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Download, FileText, X } from "lucide-react";
import { uploadFile } from "@/components/editor/media";
import {
  fileDownloadHref, fileExtension, fileHref, fileList, fileSizeText, isImageFile, type FileRef,
} from "@/lib/database/property-types/files";
import type { CellValue } from "@/lib/database/types";
import { FilePeek, useFilePeek } from "./file-peek";
import { MenuHeading, MenuSurface, useMenuDismiss } from "./menu";

/** A 22px square: the picture if there is one, the extension if there is not. `aria-hidden`
 *  because the name is always beside it — a screen reader announcing "PDF" and then
 *  "invoice.pdf" says one thing twice.
 *
 *  The two handlers are the peek's only entry point in a cell, and they are on the *tile*
 *  rather than the button: pressing the button opens the list, and a preview that appeared
 *  every time somebody reached for the cell would sit on top of the dropdown it just opened. */
function FileTile({ file, onPeek, onPeekEnd }: {
  file: FileRef;
  onPeek?: (node: Element) => void;
  onPeekEnd?: () => void;
}) {
  if (isImageFile(file)) {
    return (
      <img
        className="db-files-tile"
        src={fileHref(file.id)}
        alt=""
        loading="lazy"
        decoding="async"
        onMouseEnter={onPeek ? (event) => onPeek(event.currentTarget) : undefined}
        onMouseLeave={onPeekEnd}
      />
    );
  }
  const extension = fileExtension(file.name);
  return (
    <span className="db-files-tile db-files-badge" aria-hidden>
      {extension || <FileText size={11} />}
    </span>
  );
}

/**
 * What the cell reads when it is not open. `link` is for a read-only table, where there is no
 * field and no surface: the name is the control, and it opens the file in a new tab rather
 * than replacing a table somebody was reading.
 *
 * It is never used inside the cell's own button — a link inside a button is two controls in
 * one tab stop, and the browser has to guess which one Enter meant.
 */
export function FilesSummary({ value, link = false }: { value: CellValue; link?: boolean }) {
  const peek = useFilePeek();
  const files = fileList(value);
  if (!files.length) return <span className="db-cell-empty">Empty</span>;
  const [first] = files;
  const rest = files.length - 1;
  const name = link ? (
    <a className="db-files-first db-files-link" href={fileHref(first.id)} target="_blank" rel="noreferrer noopener" title={first.name}>
      {first.name}
    </a>
  ) : (
    <span className="db-files-first">{first.name}</span>
  );
  return (
    <span className="db-files-summary">
      <FileTile file={first} onPeek={(node) => peek.show(first, node)} onPeekEnd={peek.clear} />
      {name}
      {rest > 0 ? <span className="db-files-more">+{rest}</span> : null}
      <FilePeek peek={peek.peek} />
    </span>
  );
}

/** The read-only table's cell. Same summary, as a link. */
export function FilesText({ value }: { value: CellValue }) {
  return <FilesSummary value={value} link />;
}

type Pending = { key: string; name: string };

export function FilesCell({ value, onCommit }: {
  value: CellValue;
  onCommit: (value: CellValue) => void;
}) {
  const files = fileList(value);
  const signature = files.map((file) => file.id).join(" ");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  /* Destructured, not held as one object: `show` and `clear` are stable, so `close` keeps its
     identity and the dismiss listener is not torn down and rebuilt on every render. */
  const { peek: preview, show: peekShow, clear: peekClear } = useFilePeek();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const uid = useId().replace(/[:]/g, "");

  /* The list this cell will write next. It is a ref and not `files` for one reason: a batch
     of uploads commits once, but `setPending` re-renders between files, and a value read from
     props mid-batch is the *pre-batch* one — the second file would then be written over the
     first file's reference and one of them would vanish silently. */
  const latest = useRef<FileRef[]>(files);
  const running = useRef(false);

  /* Follow the stored value — a second tab, a reload, the server's own `coerce` — except
     while a batch is in flight, where the only thing that can change the signature is our own
     earlier write, which `latest` already holds. */
  useEffect(() => {
    if (running.current) return;
    latest.current = fileList(value);
  }, [signature, value]);

  const close = useCallback(() => {
    setOpen(false);
    setErrors([]);
    /* The list is gone, so a preview of one of its rows has nothing left to point at. */
    peekClear();
  }, [peekClear]);
  /* `trigger` as `keep`: a press on the cell is the toggle (below), and letting the dismiss
     listener close it first would make every second press a reopen — the surface would look
     stuck open. Every other menu in this app is opened by a button that toggles, which is why
     `keep` exists; the place cell is its other caller. */
  useMenuDismiss(open, close, trigger);

  const accept = useCallback(async (incoming: File[]) => {
    if (!incoming.length) return;
    running.current = true;
    setErrors([]);
    const added: FileRef[] = [];
    try {
      for (const file of incoming) {
        const key = `${file.name}:${file.size}:${Math.random().toString(36).slice(2, 8)}`;
        setPending((current) => [...current, { key, name: file.name }]);
        try {
          const stored = await uploadFile(file);
          added.push({ id: stored.id, name: stored.name, mime: stored.mime, size: stored.size });
        } catch (error) {
          setErrors((current) => [
            ...current,
            `${file.name} — ${error instanceof Error ? error.message : "could not be uploaded."}`,
          ]);
        } finally {
          setPending((current) => current.filter((entry) => entry.key !== key));
        }
      }
    } finally {
      running.current = false;
      if (added.length) {
        const held = new Set(latest.current.map((file) => file.id));
        const next = [...latest.current, ...added.filter((file) => !held.has(file.id))];
        latest.current = next;
        onCommit(next as CellValue);
      }
    }
  }, [onCommit]);

  const remove = (id: string) => {
    const next = latest.current.filter((file) => file.id !== id);
    latest.current = next;
    onCommit(next as CellValue);
  };

  /* A file drag is the only drag that carries `Files`; the row grip's reorder does not, so
     returning early here leaves every other drag in this table untouched. */
  const dropTarget = (event: DragEvent) => {
    const dropped = [...(event.dataTransfer?.files ?? [])];
    if (!dropped.length) return;
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    setOpen(true);
    void accept(dropped);
  };

  const over = (event: DragEvent) => {
    if (![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
    /* Without this the browser refuses the drop *and* navigates to the file, which loses a
       half-written table. It is the one line that makes a drop target a drop target. */
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const leave = (event: DragEvent) => {
    /* `dragleave` also fires when the pointer crosses into a child, so the check is against
       the element the pointer *entered*, not against the node the event names. */
    const into = event.relatedTarget as Node | null;
    if (into && event.currentTarget.contains(into)) return;
    setDragging(false);
  };

  const names = files.map((file) => file.name).join(", ");

  return (
    <div className="db-files-cell">
      <button
        ref={trigger}
        type="button"
        className={`db-files-trigger${dragging ? " is-dropping" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${uid}-files`}
        aria-label={`${names || "No files"}. Open the file list.`}
        title={names || undefined}
        /* The press is the toggle, as in a tag or date cell: a plain `onClick` arrives after
           the dismissal listener has already closed the surface. */
        onMouseDown={(event) => { event.preventDefault(); setOpen((was) => !was); }}
        /* …but `onMouseDown` is a mouse event, and a keyboard press on a button fires `click`
           with no button behind it. `detail === 0` is how that click identifies itself. */
        onClick={(event) => { if (event.detail === 0) setOpen((was) => !was); }}
        onDragOver={over}
        onDragLeave={leave}
        onDrop={dropTarget}
      >
        <FilesSummary value={value} />
      </button>

      <MenuSurface
        id={`${uid}-files`}
        anchor={trigger}
        open={open}
        onClose={close}
        /* A dialog, not a menu: it holds a file picker, links and a remove button. */
        role="dialog"
        className="db-files-menu"
        preferHeight={280}
        maxHeight={420}
      >
        <div className="db-files-panel" onDragOver={over} onDragLeave={leave} onDrop={dropTarget}>
          <div className="db-files-head">
            <MenuHeading>
              {files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "No files"}
            </MenuHeading>
            <button
              type="button"
              className="db-mini-btn db-files-upload"
              onClick={() => picker.current?.click()}
              disabled={pending.length > 0}
            >
              Upload
            </button>
          </div>

          {/* Visually hidden and not `display: none` behind a label — `click()` on a hidden
              input is what opens a picker without a second control to keep in sync. */}
          <input
            ref={picker}
            className="db-files-picker"
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const chosen = [...(event.currentTarget.files ?? [])];
              /* Cleared, or choosing the same file twice in a row fires no `change` at all. */
              event.currentTarget.value = "";
              void accept(chosen);
            }}
          />

          {files.length === 0 && pending.length === 0 ? (
            <p className="db-files-note">Drop files here, or press Upload.</p>
          ) : null}

          <div className="db-files-list">
            {files.map((file) => (
              <div
                className="db-files-row"
                key={file.id}
                /* The whole row is the hover target, not the 22px tile: aiming at a thumbnail to
                   find out what it is, is a game the pointer rarely wins. `focus` gives the peek
                   to the keyboard too, since the name and the two buttons are already tab stops. */
                onMouseEnter={(event) => peekShow(file, event.currentTarget)}
                onMouseLeave={peekClear}
                onFocus={(event) => peekShow(file, event.currentTarget)}
                onBlur={peekClear}
              >
                <FileTile file={file} />
                <a
                  className="db-files-name"
                  href={fileHref(file.id)}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={file.name}
                >
                  {file.name}
                </a>
                <span className="db-files-size">{fileSizeText(file.size)}</span>
                <a
                  className="db-prop-icon-btn db-menu-back db-files-download"
                  /* No `target`: a save is not a navigation, and the response's `attachment`
                     disposition is what keeps the page where it is. */
                  href={fileDownloadHref(file.id)}
                  aria-label={`Download ${file.name}`}
                  title="Download"
                >
                  <Download size={13} aria-hidden />
                </a>
                <button
                  type="button"
                  /* The bare glyph well — `.db-prop-icon-btn`'s geometry with `.db-menu-back`'s
                     dropped chrome. A boxed 24px button beside a line of text is the shape this
                     sheet already decided against for the place card's `×`. */
                  className="db-prop-icon-btn db-menu-back db-files-remove"
                  aria-label={`Remove ${file.name}`}
                  title="Remove"
                  onClick={() => remove(file.id)}
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
            ))}
            {pending.map((entry) => (
              <div className="db-files-row is-pending" key={entry.key}>
                <span className="db-files-tile db-files-badge db-files-spin" aria-hidden />
                <span className="db-files-name" title={entry.name}>{entry.name}</span>
                <span className="db-files-size">Uploading…</span>
              </div>
            ))}
          </div>

          {errors.length ? (
            <div className="db-files-errors" role="alert">
              {errors.map((message, index) => <p className="db-files-error" key={`${index}:${message}`}>{message}</p>)}
            </div>
          ) : null}

          {dragging ? <div className="db-files-drop" aria-hidden>Drop to attach</div> : null}
        </div>
      </MenuSurface>

      <FilePeek peek={preview} />
    </div>
  );
}
