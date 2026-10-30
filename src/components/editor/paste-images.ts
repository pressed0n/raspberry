"use client";
/* Raspberry — pasting and dropping an image (B29)
   ---------------------------------------------------------------------------
   BlockNote asks a list of clipboard flavours in a fixed order and stops at the
   first it finds (`acceptedMIMETypes` in @blocknote/core):

       vscode-editor-data · blocknote/html · text/markdown · text/html ·
       text/plain · Files

   `Files` is last. So "right-click an image → Copy image" — which puts
   `text/html` AND the image bytes on the clipboard — took the HTML path and
   inserted an <img> aimed at the original remote URL. Our CSP is
   `img-src 'self' data: blob:`, so the result was a broken image. The same
   preference ordering governs the drop handler, so dragging an image in from a
   web page behaved identically.

   The judgement about which payloads belong here lives in
   src/lib/clipboard-image.ts, with tests. This file is the effect: claim the
   event, upload the bytes, insert image blocks.

   Two constraints from the shipped code, both load-bearing:

   1. `pasteHandler` must return `boolean | undefined`, NOT a promise
      (BlockNoteEditor.d.ts:165). So the paste is claimed synchronously and the
      upload runs afterwards. Claiming it first is also what stops the browser
      inserting the HTML as well.

   2. A ClipboardEvent's DataTransfer is inert once the handler returns, and a
      drag's is inert once the drop handler returns. The Files have to be pulled
      out BEFORE the first `await`, or `getAsFile()` returns null and the paste
      silently does nothing.
*/
import type { Block, BlockNoteEditor, PartialBlock } from "@blocknote/core";
import { shouldUploadClipboardImages } from "@/lib/clipboard-image";
import { uploadFile } from "./media";

type AnyEditor = BlockNoteEditor<any, any, any>;
type Placement = "before" | "after";

/** Where the new image blocks should go. */
type InsertTarget = { id: string | null; placement: Placement };

/** `getData` throws for flavours the clip is not allowed to expose; treat as absent. */
export function readType(data: DataTransfer, type: string): string {
  try { return data.getData(type) ?? ""; } catch { return ""; }
}

/** Image files on a clipboard or drag payload, read synchronously. */
export function imageFilesFrom(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && /^image\//i.test(file.type)) files.push(file);
  }
  // `items` is the modern path; `files` is the fallback for payloads that expose
  // only the file list.
  if (!files.length) {
    for (const file of Array.from(data.files ?? [])) {
      if (/^image\//i.test(file.type)) files.push(file);
    }
  }
  return files;
}

/**
 * A block is a usable insert target only if it is empty. Pasting into a
 * paragraph that already has text must add blocks beside it, never replace what
 * the user wrote.
 */
function isEmptyBlock(block: Block<any, any, any> | undefined): boolean {
  if (!block || !Array.isArray(block.content)) return false;
  return block.content.every(
    (item: any) => item?.type === "text" && String(item.text ?? "").trim() === "",
  );
}

/**
 * Put the caret somewhere typing can continue.
 *
 * A text cursor cannot live inside an image block — BlockNote warns
 * "TextSelection endpoint not pointing into a node with inline content" — and a
 * brand-new image left node-selected means the next keystroke replaces it. So the
 * caret goes to the next text block if there is one, and otherwise a paragraph is
 * added after the images to type into.
 */
function focusAfterInsert(editor: AnyEditor, last: Block<any, any, any>): void {
  const doc = editor.document;
  const index = doc.findIndex((block) => block.id === last.id);
  const next = index >= 0 ? doc[index + 1] : undefined;
  if (next && Array.isArray(next.content)) {
    editor.setTextCursorPosition(next, "end");
    return;
  }
  const [paragraph] = editor.insertBlocks([{ type: "paragraph" }], last, "after");
  if (paragraph) editor.setTextCursorPosition(paragraph, "end");
}

async function insertImageFiles(editor: AnyEditor, files: File[], target: InsertTarget): Promise<void> {
  const urls: string[] = [];
  for (const file of files) urls.push((await uploadFile(file)).url);
  const blocks: PartialBlock<any, any, any>[] = urls.map((url) => ({ type: "image", props: { url } }));

  // The target may be gone by the time the upload finishes (page switched, block
  // deleted). Falling back to the end of the document beats dropping the upload.
  const anchor = target.id ? editor.getBlock(target.id) : undefined;
  const tail = editor.document[editor.document.length - 1];

  // `replaceBlocks` answers with inserted/removed pairs; `insertBlocks` answers
  // with the blocks themselves. Normalising here keeps the cursor logic single.
  let inserted: Block<any, any, any>[] = [];
  if (anchor && isEmptyBlock(anchor) && target.placement === "after") {
    // Dropping "after" an empty paragraph would leave a blank line above the
    // image for no reason. Fill it instead.
    inserted = editor.replaceBlocks([anchor], blocks).insertedBlocks;
  } else if (anchor) {
    inserted = editor.insertBlocks(blocks, anchor, target.placement);
  } else if (tail) {
    inserted = editor.insertBlocks(blocks, tail, "after");
  }

  const last = inserted[inserted.length - 1];
  if (last) focusAfterInsert(editor, last);
}

/**
 * `pasteHandler` for the editor: upload clipboard images instead of hotlinking
 * them, and hand every other paste back to BlockNote untouched.
 */
export function imagePasteHandler() {
  return ({ event, editor, defaultPasteHandler }: {
    event: ClipboardEvent;
    editor: AnyEditor;
    defaultPasteHandler: (context?: {
      prioritizeMarkdownOverHTML?: boolean;
      plainTextAsMarkdown?: boolean;
    }) => boolean | undefined;
  }): boolean | undefined => {
    const data = event.clipboardData;
    if (!data) return defaultPasteHandler();

    // Read everything synchronously — see constraint 2 at the top of the file.
    const files = imageFilesFrom(data);
    if (!files.length) return defaultPasteHandler();
    if (!shouldUploadClipboardImages(Array.from(data.types ?? []), readType(data, "text/html"))) {
      return defaultPasteHandler();
    }

    let target: InsertTarget = { id: null, placement: "after" };
    try { target = { id: editor.getTextCursorPosition().block.id, placement: "after" }; } catch { /* no selection */ }

    event.preventDefault();
    void insertImageFiles(editor, files, target).catch((err: unknown) => {
      // The paste was already claimed, so this cannot fall through to the HTML
      // path; the only honest thing left is to say so loudly.
      console.error("Could not paste image", err);
    });
    return true;
  };
}

/** The block under the pointer and which side of it the drop landed on. */
function dropTarget(editor: AnyEditor, event: DragEvent): InsertTarget {
  const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-id]");
  const id = hit?.getAttribute("data-id") ?? null;
  if (!hit || !id || !editor.getBlock(id)) return { id: null, placement: "after" };
  const rect = hit.getBoundingClientRect();
  const placement: Placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  return { id, placement };
}

/**
 * Dragging an image in from a web page carries the same `text/html` + `Files`
 * payload as copying one, and BlockNote's drop handler runs the same preference
 * order — so it hotlinked too. BlockNote exposes no `dropHandler` option, so this
 * listens in the capture phase, ahead of the editor's own handler on the same
 * element, and stands down for every payload it does not own.
 *
 * Returns a cleanup function for the effect that installs it.
 */
export function installImageDrop(editor: AnyEditor): () => void {
  const dom = editor.domElement;
  if (!dom) return () => {};

  const onDrop = (event: DragEvent) => {
    if (!editor.isEditable) return;
    const data = event.dataTransfer;
    if (!data) return;

    const files = imageFilesFrom(data); // synchronous — see constraint 2
    if (!files.length) return;
    if (!shouldUploadClipboardImages(Array.from(data.types ?? []), readType(data, "text/html"))) return;

    // Claim it before the editor's own drop handler sees it, or ProseMirror will
    // also insert the hotlinked HTML.
    event.preventDefault();
    event.stopImmediatePropagation();

    const target = dropTarget(editor, event);
    void insertImageFiles(editor, files, target).catch((err: unknown) => {
      console.error("Could not drop image", err);
    });
  };

  dom.addEventListener("drop", onDrop, true);
  return () => dom.removeEventListener("drop", onDrop, true);
}
