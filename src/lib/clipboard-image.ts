/* Raspberry — clipboard images (B29)
   ---------------------------------------------------------------------------
   Why this file exists at all.

   BlockNote asks a list of clipboard flavours in a fixed order and stops at the
   first one it finds (`acceptedMIMETypes` in @blocknote/core):

       vscode-editor-data · blocknote/html · text/markdown · text/html ·
       text/plain · Files

   `Files` is LAST. A file insertion only happens if `Files` is the first flavour
   present — the routine reads `types`, takes the first match, and bails with
   `if (flavour !== "Files") return`.

   That is fine for a screenshot, which puts only `Files` on the clipboard. It is
   not fine for the far more common "right-click an image on a page → Copy image",
   where Chrome puts `text/html` *and* the image bytes. `text/html` wins, so the
   editor inserts an <img> pointing at the ORIGINAL REMOTE URL — which our content
   security policy then refuses to load (`img-src 'self' data: blob:`), leaving a
   broken image on the page.

   Measured, not assumed — see scripts/cdp-paste.mjs: the "files only" shape
   uploads to /api/files/… and decodes; the "text/html + Files" shape produced
   `https://example.com/…png` plus a CSP violation.

   So: when the clipboard carries image bytes, we take the paste ourselves and
   upload them. Copying an image should put the image in the document, not a
   hyperlink to somebody else's server.

   The one thing we must not break. BlockNote prefers `text/html` for a reason:
   it preserves formatting. Preferring files unconditionally would silently throw
   away the text when someone copies a paragraph that happens to contain an
   inline image. So the preference is narrowed to the case it was meant for —
   a clipboard whose HTML is nothing but image(s) — and everything else is handed
   straight back to the default handler.
*/

/** Entity references that decode to nothing visible. Everything else is text. */
const BLANK_ENTITIES = /&(?:nbsp|ensp|emsp|thinsp|zwnj|zwj|#160|#8203|#65279);/gi;

/**
 * True when an HTML clipboard payload contains images and nothing else.
 *
 * Deliberately not a DOM parse. This runs on every paste, on the main thread, and
 * a detached `DOMParser` document per keystroke is a cost with no benefit: the
 * question is only "is there visible text in here", and tags are the only thing
 * that can hide it. Comments are removed first, because their bodies would
 * otherwise survive tag-stripping and read as text.
 */
export function isImageOnlyHtml(html: string): boolean {
  if (!/<img\b/i.test(html)) return false;
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(BLANK_ENTITIES, "");
  return text.trim() === "";
}

/**
 * Does the clipboard hold a file at all?
 *
 * `Files` is the usual marker, but it is not universal — some platforms report
 * the concrete MIME type instead ("image/png"). Accepting both costs one check
 * and avoids a silent no-op on those platforms.
 */
export function clipboardHasFiles(types: readonly string[]): boolean {
  return types.some((type) => type === "Files" || /^image\//i.test(type));
}

/**
 * Should this paste be handled by uploading the clipboard's image files instead
 * of letting BlockNote's HTML/markdown path run?
 *
 * Only when the clipboard holds files AND the HTML carries no text of its own.
 * A missing or empty HTML payload also qualifies: that is the screenshot case,
 * whose bytes are the only thing on the clipboard.
 */
export function shouldUploadClipboardImages(
  types: readonly string[],
  html: string | null | undefined,
): boolean {
  if (!clipboardHasFiles(types)) return false;
  if (!html || html.trim() === "") return true;
  return isImageOnlyHtml(html);
}
