"use client";
/* Raspberry — which objects are selected (B35)
   --------------------------------------------
   BlockNote's own selection manager cannot express "one block is selected":
   `editor.setSelection(a, b)` builds a MultipleNodeSelection and throws outright
   when a === b ("Attempting to set selection with the same anchor and head
   blocks"). I found that by running it, not by reading the types.

   So the selection here is Raspberry's: block ids, painted with a
   `data-obj-selected` attribute on the block's own DOM node — reachable because
   BlockNote renders `data-id` on `.bn-block-outer`.

   Two consequences worth stating:

   1. It is not a ProseMirror selection, so it never moves the caret and cannot
      fight the editor for focus. The menu can hold focus and the tint stays.
   2. Because it is not a ProseMirror selection, the clipboard does not read it
      for free. Copy and paste are handled here through BlockNote's own lossy
      serialisers, so what lands on the clipboard is the HTML a block-level copy
      would have produced.

   The state lives in a module-level store rather than React context on purpose.
   BlockNote renders its floating UI (including the drag-handle menu) into a
   separate React root, so context does not reach it — the menu would read `null`
   for the selection while the provider happily held one. A store with
   `useSyncExternalStore` works across render roots because it is not part of the
   tree. */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { copyDocument } from "@/lib/document";
import type { AnyBlock } from "./selection";

/* The last internal copy, kept as blocks rather than as the HTML we hand out.
   `blocksToHTMLLossy` is lossy exactly where our schema is ours: a callout has no
   HTML mapping, so it serialises the callout's children and the container is gone
   before paste can see it — "Ctrl+V pasted the contents, not the block". Pasting
   our own copy therefore rebuilds it from the blocks, and only foreign HTML goes
   through the parser.

   `html` is stored *bare*, without the token, so the fallback comparison is
   like-for-like: a clipboard sanitizer is free to drop a data attribute, and when
   it does the payload is still byte-identical to what we wrote. */
const COPY_ATTR = "data-raspberry-copy";

/* BlockNote has no HTML mapping for a `layoutOnly` frame, so it serialises the
   frame's *rendered* DOM. With a frame menu open that means the menu would travel
   to the clipboard as "Color Fill Text Duplicate…", and the columns frame would
   carry its own exit button. Our chrome is removed before the HTML is handed out:
   the verbs are ours, not the document's. */
function cleanChrome(markup: string): string {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  for (const chrome of parsed.querySelectorAll(".frame-anchor, .columns-exit")) chrome.remove();
  return parsed.body.innerHTML;
}

const PAYLOAD_ATTR = "data-raspberry-blocks";

let copied: { token: string; blocks: AnyBlock[]; html: string } | null = null;

/* ---------- the payload travels in the clipboard ----------
   The token alone only says "this HTML is ours"; it cannot rebuild a frame that
   has no HTML mapping. That was survivable while the blocks also sat in module
   memory, but module memory and the clipboard do not have the same lifetime:
   copy in one tab and paste in another, or copy, hit Ctrl+R, then paste, and the
   payload was gone — the paste then fell through to the HTML parser and landed
   as the frame's *contents*. So the blocks ride along in the markup itself.

   Base64 of UTF-8 JSON, in an attribute, because attributes are what survive a
   clipboard round-trip: the token has come back intact in every measurement. */
function encodePayload(blocks: AnyBlock[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(blocks));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodePayload(html: string): AnyBlock[] | null {
  const raw = html.match(new RegExp(`${PAYLOAD_ATTR}="([^"]*)"`))?.[1];
  if (!raw) return null;
  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(parsed) && parsed.length ? (parsed as AnyBlock[]) : null;
  } catch {
    return null;
  }
}

/** Our own copy, or null for anything that came from somewhere else.
 *  Self-contained payload first; module memory and the exact-string comparison
 *  are what remains if a sanitizer strips the attribute on the way through. */
function internalCopy(html: string): AnyBlock[] | null {
  const carried = decodePayload(html);
  if (carried) return copyDocument(carried);
  if (!copied) return null;
  const token = html.match(new RegExp(`${COPY_ATTR}="([^"]+)"`))?.[1] ?? null;
  const mine = token ? token === copied.token : html.trim() === copied.html.trim();
  return mine ? copyDocument(copied.blocks) : null;
}

let currentIds: string[] = [];
const listeners = new Set<() => void>();

function setIds(next: string[]) {
  if (next === currentIds) return;
  currentIds = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const getSnapshot = () => currentIds;

export type SelectionApi = {
  ids: string[];
  select: (ids: string[]) => void;
  clear: () => void;
};

export function useObjectSelection(): SelectionApi {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const select = useCallback((next: string[]) => setIds(next), []);
  const clear = useCallback(() => setIds([]), []);
  return useMemo(() => ({ ids, select, clear }), [ids, select, clear]);
}

/** Wires the behaviours that are not React's business: painting the blocks,
 *  dismissing the selection, and the clipboard. Renders nothing.
 *
 *  This is a *sibling* of `BlockNoteView`, not a wrapper around it. That is the
 *  whole point: while the subscription lived in the wrapper, every selection
 *  change re-rendered the entire editor subtree, BlockNote's renderer rebuilt
 *  the block DOM, and the tint was wiped off the nodes it had just been painted
 *  onto. Measured, not guessed — the painted node was detached from the document
 *  within a frame of being painted. A null-rendering sibling subscribes to the
 *  selection without pulling the editor along with it. */
export function ObjectSelectionEffects({ editor }: { editor: BlockNoteEditor<any, any, any> }) {
  const { ids, select } = useObjectSelection();
  const idsRef = useRef(ids);
  idsRef.current = ids;

  /* Paint. A generated stylesheet rather than an attribute on the block node —
     see the note in editor-blocks.css for why the attribute route could not
     work: BlockNote rebuilds its block DOM as the editor re-renders, so the
     attribute ends up on a detached element. Rules survive that.

     The declarations are generated per selected block rather than sitting in the
     stylesheet, because `::after` on the block content is BlockNote's placeholder
     slot. A rule that exists for every block takes that slot away from empty
     blocks — which is exactly what the first attempt did. */
  const paint = useMemo(
    () =>
      ids
        .map((id) => {
          const key = JSON.stringify(id);
          /* BlockNote renders a block in one of two shapes, and only the first was
             painted:

               normal   .bn-block-outer[data-id] > .bn-block > .bn-block-content
               frame    .bn-block-group > <frame data-id> (no outer, no container)

           A `layoutOnly` spec — callout, columns, column — is injected straight
           into the block group, so it has no `.bn-block-outer` and nothing named
           `.bn-block-content`; the id sits on the frame itself. That is the whole
           reason a selected callout showed no tint while the menu above it worked
           perfectly: the selection was right and the rule never matched. */
          const frames = [
            [`.bn-editor .bn-block-outer[data-id=${key}] > .bn-block > :first-child`, "1px -6px"],
            [`.bn-editor [data-node-type][data-id=${key}]:not(.bn-block-outer):not(.bn-block)`, "0"],
          ] as const;
          return frames
            .map(
              ([frame, inset]) =>
                `${frame} { position: relative; }\n` +
                `${frame}::after { content: ""; position: absolute; inset: ${inset}; border-radius: 4px; ` +
                `background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent-line); pointer-events: none; }`,
            )
            .join("\n");
        })
        .join("\n"),
    [ids],
  );

  /* Dismissal. Escape clears; a press anywhere that is not the menu or the handle
     clears, in capture phase, so the selection is gone before whatever was
     clicked acts. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIds([]);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(".obj-menu, .bn-side-menu")) return;
      setIds([]);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  /* Clipboard. Document-level, not editor-level: while the menu is open the focus
     is in the menu, so an editor-scoped listener would never see the keystroke —
     which is the exact case the wishlist describes ("select, then Ctrl+C"). */
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const current = idsRef.current;
      if (!current.length || !event.clipboardData) return;
      const blocks = current.map((id) => editor.getBlock(id)).filter(Boolean) as AnyBlock[];
      if (!blocks.length) return;
      const html = cleanChrome(editor.blocksToHTMLLossy(blocks));
      const token = crypto.randomUUID();
      copied = { token, blocks, html };
      /* The token rides on the first tag rather than on a wrapper element, so the
         markup handed out stays exactly what the serialiser produced — the same
         string another app receives, and the same string the fallback parses.
         The payload takes the same route, for the same reason. */
      const attrs = `${COPY_ATTR}="${token}" ${PAYLOAD_ATTR}="${encodePayload(blocks)}"`;
      const decorated = html.replace(/^(\s*<[a-zA-Z][^\s/>]*)/, `$1 ${attrs}`);
      const markup = /^\s*<[a-zA-Z]/.test(html)
        ? decorated
        : /* A frame can serialise to nothing at all; then there is no tag to hang
             the payload on, so it gets a carrier of its own. `hidden` keeps it out
             of the way in whatever other app the markup lands in. */
          `<div ${attrs} hidden></div>${decorated}`;
      event.clipboardData.setData("text/html", markup);
      event.clipboardData.setData("text/plain", editor.blocksToMarkdownLossy(blocks));
      event.preventDefault();
      event.stopPropagation();
    };

    /* Where the paste lands, in order of how deliberate each signal is:
       a selected block (the user pointed at it), then the caret, then the end of
       the document. The selected-block case used to be the *only* case, which
       made the feature depend on not having clicked anywhere since the copy. */
    const pasteSpot = (current: string[]) => {
      const last = current[current.length - 1];
      if (last && editor.getBlock(last)) return { id: last, empty: false };
      try {
        const block = editor.getTextCursorPosition().block;
        const content = (block as { content?: unknown }).content;
        const empty =
          Array.isArray(content) && content.length === 0 && (block.children?.length ?? 0) === 0;
        return { id: block.id, empty };
      } catch {
        /* `getTextCursorPosition` throws when the editor holds no cursor. */
      }
      const document_ = editor.document;
      return document_.length
        ? { id: document_[document_.length - 1].id, empty: false }
        : null;
    };

    const onPaste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");
      const own = internalCopy(html);
      const current = idsRef.current;
      /* Our own copy is block-level wherever the caret happens to be. Anything
         else is only ours to place when a block is selected; with no selection
         the editor's normal paste (including pasted files) stays intact. */
      if (!own && !current.length) return;
      if (!own && !html && !text) return;
      const paste = own ?? (html ? editor.tryParseHTMLToBlocks(html) : editor.tryParseMarkdownToBlocks(text));
      if (!paste.length) return;
      const spot = pasteSpot(current);
      if (!spot) return;
      /* Before inserting, not after: ProseMirror's own paste handler runs inside
         this event and mutates the document as it goes, so `preventDefault` after
         the fact suppresses the browser and not the editor. */
      event.preventDefault();
      event.stopPropagation();
      const inserted = editor.insertBlocks(paste, spot.id, "after");
      /* Pasting into an empty paragraph should read as "this appeared here",
         not as "an empty line opened above it". */
      if (spot.empty) editor.removeBlocks([spot.id]);
      if (inserted.length) select(inserted.map((block) => block.id));
    };

    /* Capture, deliberately. A document-level bubble listener is behind the
       editor's own handlers in the event path, and the editor's paste handler has
       already edited the document by the time it runs. Capture is the first node
       after `window`, and `stopPropagation` keeps the editor from ever seeing an
       event we have handled. */
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("paste", onPaste, true);
    return () => {
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("paste", onPaste, true);
    };
  }, [editor, select]);

  return <style>{paint}</style>;
}

/** Composition only — deliberately holds no state of its own, so it cannot
 *  re-render the editor when the selection changes. */
export function ObjectSelectionProvider({
  editor,
  children,
}: {
  editor: BlockNoteEditor<any, any, any>;
  children: ReactNode;
}) {
  return (
    <>
      {children}
      <ObjectSelectionEffects editor={editor} />
    </>
  );
}
